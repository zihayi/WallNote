using System;
using System.Diagnostics;
using System.IO;
using System.Management;
using System.Runtime.InteropServices;
using System.Threading;
using System.Windows.Automation;

// Check and dismiss only the real Shell menu belonging to the supplied test app.
// No global key presses, file commands or clipboard changes.
internal static class DrawerMenuProbe {
    [StructLayout(LayoutKind.Sequential)] struct GuiInfo {
        public uint size, flags; public IntPtr active,focus,capture,menu,move,caret; public int l,t,r,b;
    }
    [DllImport("user32.dll")] static extern bool GetGUIThreadInfo(uint tid,ref GuiInfo info);
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr hwnd,out uint pid);
    [DllImport("user32.dll")] static extern bool PostMessage(IntPtr hwnd,uint msg,IntPtr wp,IntPtr lp);
    [DllImport("user32.dll",CharSet=CharSet.Unicode)] static extern IntPtr FindWindowEx(IntPtr parent,IntPtr after,string cls,string title);
    private static bool OpenFixture(uint pid) {
        IntPtr w=IntPtr.Zero;
        while((w=FindWindowEx(IntPtr.Zero,w,"#32768",null))!=IntPtr.Zero){
            uint menuPid;GetWindowThreadProcessId(w,out menuPid);if(menuPid!=pid)continue;
            var menu=AutomationElement.FromHandle(w);
            foreach(AutomationElement el in menu.FindAll(TreeScope.Descendants,new PropertyCondition(AutomationElement.ControlTypeProperty,ControlType.MenuItem))){
                var name=el.Current.Name.Replace("&","").Trim();
                if(!(name=="Open"||name=="\u6253\u5f00"||name=="\u6253\u5f00(O)"))continue;
                object invoke;if(el.TryGetCurrentPattern(InvokePattern.Pattern,out invoke)){((InvokePattern)invoke).Invoke();return true;}
            }
        }
        return false;
    }
    public static int Main(string[] args) {
        if(args.Length==1 && args[0]=="fixture-marker"){File.WriteAllText(Path.Combine(AppDomain.CurrentDomain.BaseDirectory,"menu-opened.txt"),"ok");return 0;}
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
                                if(args.Length==2 && args[1]=="open"){if(OpenFixture(pid))return 0;continue;}
                                if(!PostMessage(g.menu,0x001F,IntPtr.Zero,IntPtr.Zero))return 2; // WM_CANCELMODE
                                if(!helper.WaitForExit(4000))return 3;
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
