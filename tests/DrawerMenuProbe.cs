using System;
using System.Diagnostics;
using System.IO;
using System.Management;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Windows.Automation;

// Only operate on the isolated test app's Shell menu. The Open fixture is a
// shortcut to this probe; its sole effect is to write a marker beside the exe.
internal static class DrawerMenuProbe {
    [StructLayout(LayoutKind.Sequential)] struct GuiInfo {
        public uint size, flags; public IntPtr active,focus,capture,menu,move,caret; public int l,t,r,b;
    }
    [DllImport("user32.dll")] static extern bool GetGUIThreadInfo(uint tid,ref GuiInfo info);
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr hwnd,out uint pid);
    [DllImport("user32.dll")] static extern bool PostMessage(IntPtr hwnd,uint msg,IntPtr wp,IntPtr lp);
    [DllImport("user32.dll",CharSet=CharSet.Unicode)] static extern IntPtr FindWindowEx(IntPtr parent,IntPtr after,string cls,string title);
    [StructLayout(LayoutKind.Sequential)] struct Point {public int x,y;}
    [StructLayout(LayoutKind.Sequential)] struct Rect {public int l,t,r,b;}
    [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll",CharSet=CharSet.Unicode)] static extern int GetClassName(IntPtr hwnd,StringBuilder name,int length);
    [DllImport("user32.dll")] static extern IntPtr SetThreadDpiAwarenessContext(IntPtr value);
    [DllImport("user32.dll")] static extern bool GetCursorPos(out Point p);
    [DllImport("user32.dll")] static extern bool SetCursorPos(int x,int y);
    [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr hwnd,out Rect r);
    [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr hwnd);
    [DllImport("user32.dll")] static extern IntPtr WindowFromPoint(Point p);
    [DllImport("user32.dll")] static extern IntPtr GetAncestor(IntPtr hwnd,uint flag);
    [DllImport("user32.dll")] static extern bool IsChild(IntPtr parent,IntPtr child);
    [DllImport("user32.dll")] static extern IntPtr GetShellWindow();
    [DllImport("user32.dll")] static extern void mouse_event(uint flag,uint x,uint y,uint data,UIntPtr extra);
    [DllImport("user32.dll")] static extern void keybd_event(byte key,byte scan,uint flags,UIntPtr extra);
    private static uint Pid(IntPtr w){uint pid;GetWindowThreadProcessId(w,out pid);return pid;}
    private static bool ForegroundMenu(IntPtr owner,uint pid) {
        var g=new GuiInfo { size=(uint)Marshal.SizeOf(typeof(GuiInfo)) };
        return GetGUIThreadInfo(0,ref g) && g.menu==owner && Pid(GetForegroundWindow())==pid;
    }
    // Start BEFORE the UI action. Sample the visible Win32 popup, not its helper's
    // start/exit or the first React menu. Verify identity before sending Cancel.
    private static int TimePopup(uint app) {
        Console.WriteLine("ready");Console.Out.Flush();var clock=Stopwatch.StartNew();
        while(clock.ElapsedMilliseconds<12000){
            var g=new GuiInfo{size=(uint)Marshal.SizeOf(typeof(GuiInfo))};
            if(GetGUIThreadInfo(0,ref g) && g.menu!=IntPtr.Zero){
                uint pid=Pid(g.menu);var w=IntPtr.Zero;
                while((w=FindWindowEx(IntPtr.Zero,w,"#32768",null))!=IntPtr.Zero){
                    if(Pid(w)!=pid||!IsWindowVisible(w))continue;
                    long at=DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
                    using(var q=new ManagementObjectSearcher("SELECT CommandLine FROM Win32_Process WHERE ProcessId="+pid+" AND ParentProcessId="+app+" AND Name='WallNote.DesktopHost.exe'"))using(var rows=q.Get()){
                        foreach(ManagementObject row in rows)using(row){
                            if(Convert.ToString(row["CommandLine"]).IndexOf("drawer-menu",StringComparison.Ordinal)<0 || !ForegroundMenu(g.menu,pid))continue;
                            if(!PostMessage(g.menu,0x001F,IntPtr.Zero,IntPtr.Zero))return 2;
                            Console.WriteLine("visible="+at+" pid="+pid);return 0;
                        }
                    }
                }
            }
            Thread.Sleep(3);
        }
        Console.Error.WriteLine("Timed out waiting for the fixture's visible Windows file menu.");return 1;
    }
    // UI Automation is used only to locate a known item of the test menu. In
    // physical modes both selection and dismissal must go through Windows input.
    private static bool Click(Point p,IntPtr root,IntPtr menu,uint menuPid,Func<IntPtr,bool> cardHit=null) {
        Func<bool> safe=delegate {
            var hit=WindowFromPoint(p);bool active=ForegroundMenu(menu,menuPid);
            if(active && (cardHit!=null?cardHit(hit):GetAncestor(hit,2)==root))return true;
            Console.Error.WriteLine("Click withheld at "+p.x+","+p.y+": expected root="+root+", hit root="+GetAncestor(hit,2)+", hit pid="+Pid(hit)+", foreground menu="+active);return false;
        };
        Point old,now;if(!safe()||!GetCursorPos(out old))return false;bool down=false;
        try{if(!SetCursorPos(p.x,p.y))return false;Thread.Sleep(120);
            if(!GetCursorPos(out now)||now.x!=p.x||now.y!=p.y){Console.Error.WriteLine("Cursor moved; click cancelled.");return false;}
            if(!safe())return false;
            mouse_event(2,0,0,0,UIntPtr.Zero);down=true;Thread.Sleep(60);mouse_event(4,0,0,0,UIntPtr.Zero);down=false;Thread.Sleep(120);return true;
        }finally{if(down)mouse_event(4,0,0,0,UIntPtr.Zero);SetCursorPos(old.x,old.y);}
    }
    private static bool OpenFixture(uint pid,IntPtr owner,bool physical) {
        IntPtr w=IntPtr.Zero;
        while((w=FindWindowEx(IntPtr.Zero,w,"#32768",null))!=IntPtr.Zero){
            uint menuPid;GetWindowThreadProcessId(w,out menuPid);if(menuPid!=pid)continue;
            var menu=AutomationElement.FromHandle(w);
            foreach(AutomationElement el in menu.FindAll(TreeScope.Descendants,new PropertyCondition(AutomationElement.ControlTypeProperty,ControlType.MenuItem))){
                var name=el.Current.Name.Replace("&","").Trim();
                if(!(name=="Open"||name=="\u6253\u5f00"||name=="\u6253\u5f00(O)"))continue;
                if(physical){var r=el.Current.BoundingRectangle;return !r.IsEmpty&&Click(new Point{x=(int)(r.Left+r.Width/2),y=(int)(r.Top+r.Height/2)},w,owner,pid);}
                object invoke;if(el.TryGetCurrentPattern(InvokePattern.Pattern,out invoke)){((InvokePattern)invoke).Invoke();return true;}
            }
        }
        return false;
    }
    public static int Main(string[] args) {
        if(args.Length==1 && args[0]=="fixture-marker"){File.WriteAllText(Path.Combine(AppDomain.CurrentDomain.BaseDirectory,"menu-opened.txt"),"ok");return 0;}
        SetThreadDpiAwarenessContext(new IntPtr(-4));
        if(args.Length==2 && args[1]=="popup-time")return TimePopup(uint.Parse(args[0]));
        if(args.Length==2 && args[0]=="icon-point") {
            // Read only public UI Automation geometry. Never click or change an Explorer icon.
            var list=new IntPtr(long.Parse(args[1]));if(Pid(list)!=Pid(GetShellWindow()))return 1;
            foreach(AutomationElement el in AutomationElement.FromHandle(list).FindAll(TreeScope.Children,new PropertyCondition(AutomationElement.ControlTypeProperty,ControlType.ListItem))) {
                var r=el.Current.BoundingRectangle;if(r.IsEmpty || el.Current.IsOffscreen)continue;
                var p=new Point{x=(int)(r.Left+r.Width/2),y=(int)(r.Top+r.Height/2)};
                if(WindowFromPoint(p)==list){Console.WriteLine(p.x+" "+p.y);break;}
            }
            return 0;
        }
        uint owner=uint.Parse(args[0]);var end=DateTime.UtcNow.AddSeconds(12);bool found=false;uint flags=0;
        while(DateTime.UtcNow<end) {
            using(var q=new ManagementObjectSearcher("SELECT ProcessId,CommandLine FROM Win32_Process WHERE ParentProcessId="+owner+" AND Name='WallNote.DesktopHost.exe'")) using(var rows=q.Get()) {
                foreach(ManagementObject row in rows) using(row) {
                    if(Convert.ToString(row["CommandLine"]).IndexOf("drawer-menu",StringComparison.Ordinal)<0)continue;
                    found=true;
                    try { using(var helper=Process.GetProcessById(Convert.ToInt32(row["ProcessId"]))) {
                        foreach(ProcessThread thread in helper.Threads) using(thread) {
                            var g=new GuiInfo();g.size=(uint)Marshal.SizeOf(typeof(GuiInfo));uint pid;
                            if(!GetGUIThreadInfo((uint)thread.Id,ref g))continue; flags|=g.flags;
                            if((g.flags&4)!=0 && g.menu!=IntPtr.Zero && GetWindowThreadProcessId(g.menu,out pid)!=0 && pid==(uint)helper.Id) {
                                IntPtr fg=GetForegroundWindow();var cls=new StringBuilder(128);GetClassName(fg,cls,cls.Capacity);
                                Console.Error.WriteLine("Fixture menu owner="+g.menu+" (pid="+pid+"), foreground="+fg+" ("+cls+", pid="+Pid(fg)+"), capture="+g.capture);
                                if(args.Length==2 && args[1]=="observe"){Console.WriteLine(g.menu+" "+pid);return ForegroundMenu(g.menu,pid)?0:4;}
                                if(args.Length==2 && args[1]=="escape"){
                                    if(!ForegroundMenu(g.menu,pid)){Console.Error.WriteLine("No foreground keyboard; Escape would reach another app.");return 4;}
                                    keybd_event(0x1B,0,0,UIntPtr.Zero);keybd_event(0x1B,0,2,UIntPtr.Zero);
                                }else if(args.Length==5 && args[1]=="outside-card"){
                                    var card=new IntPtr(long.Parse(args[2]));var p=new Point{x=int.Parse(args[3]),y=int.Parse(args[4])};
                                    // WindowFromPoint sees Explorer above an embedded card. Verify both the
                                    // fixture geometry and the foreground menu, also immediately before pressing.
                                    if(!Click(p,card,g.menu,pid,delegate(IntPtr hit){
                                        Rect r;if(Pid(card)!=owner||!GetWindowRect(card,out r)||p.x<r.l+20||p.y<r.t+20||p.x>=r.r-20||p.y>=r.b-20)return false;
                                        if(hit==card || IsChild(card,hit))return true;
                                        var name=new StringBuilder(80);GetClassName(hit,name,80);
                                        return Pid(hit)==Pid(GetShellWindow()) && (name.ToString()=="SysListView32"||name.ToString()=="SHELLDLL_DefView"||name.ToString()=="WorkerW"||name.ToString()=="Progman");
                                    }))return 5;
                                }else if(args.Length==3 && args[1]=="outside"){
                                    IntPtr plate=new IntPtr(long.Parse(args[2]));Rect rect;
                                    if(Pid(plate)!=owner||!GetWindowRect(plate,out rect)||!Click(new Point{x=(rect.l+rect.r)/2,y=(rect.t+rect.b)/2},plate,g.menu,pid))return 5;
                                }else if(args.Length==2 && (args[1]=="open"||args[1]=="mouse-open")){if(OpenFixture(pid,g.menu,args[1]=="mouse-open"))return 0;continue;}
                                else if(args.Length!=1||!PostMessage(g.menu,0x001F,IntPtr.Zero,IntPtr.Zero))return 2;
                                var until=Stopwatch.StartNew();while(ForegroundMenu(g.menu,pid)&&until.ElapsedMilliseconds<4000)Thread.Sleep(15);
                                if(ForegroundMenu(g.menu,pid)){PostMessage(g.menu,0x001F,IntPtr.Zero,IntPtr.Zero);return 3;}
                                Console.WriteLine("Verified and dismissed the test file's Windows menu.");return 0;
                            }
                        }
                    }}catch(ArgumentException){}catch(InvalidOperationException){}
                }
            }
            Thread.Sleep(80);
        }
        Console.Error.WriteLine("No Windows file menu from test process. Helper seen: "+found+", GUI flags: "+flags);return 1;
    }
}
