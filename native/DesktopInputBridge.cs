using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;

// Embedded windows sit below the Explorer icon layer. A press belongs to the
// visible rounded card under it, including its blank space, or entirely to Windows.
internal static class DesktopInputBridge {
    [StructLayout(LayoutKind.Sequential)] private struct Point { public int X, Y; }
    [StructLayout(LayoutKind.Sequential)] private struct Rect { public int Left, Top, Right, Bottom; }
    [StructLayout(LayoutKind.Sequential)] private struct MouseData { public Point Point; public uint Data, Flags, Time; public UIntPtr Extra; }
    [StructLayout(LayoutKind.Sequential)] private struct Message { public IntPtr Window; public uint Id; public UIntPtr W; public IntPtr L; public uint Time; public Point Pt; public uint Private; }
    [StructLayout(LayoutKind.Sequential)] private struct GuiInfo { public int Size; public uint Flags; public IntPtr Active, Focus, Capture, MenuOwner, MoveSize, Caret; public Rect CaretRect; }
    private delegate IntPtr HookProc(int code, IntPtr message, IntPtr data);
    [DllImport("user32.dll")] private static extern IntPtr SetWindowsHookEx(int type, HookProc callback, IntPtr module, uint thread);
    [DllImport("user32.dll")] private static extern bool UnhookWindowsHookEx(IntPtr hook);
    [DllImport("user32.dll")] private static extern IntPtr CallNextHookEx(IntPtr hook, int code, IntPtr message, IntPtr data);
    [DllImport("kernel32.dll", CharSet=CharSet.Unicode)] private static extern IntPtr GetModuleHandle(string module);
    [DllImport("kernel32.dll")] private static extern uint GetCurrentThreadId();
    [DllImport("user32.dll")] private static extern bool PostThreadMessage(uint thread, uint id, UIntPtr w, IntPtr l);
    [DllImport("user32.dll")] private static extern bool PostMessage(IntPtr hwnd,uint msg,IntPtr w,IntPtr l);
    [DllImport("user32.dll")] private static extern int GetMessage(out Message msg, IntPtr window, uint first, uint last);
    [DllImport("user32.dll")] private static extern bool PeekMessage(out Message msg, IntPtr window, uint first, uint last, uint remove);
    [DllImport("user32.dll")] private static extern IntPtr DispatchMessage(ref Message msg);
    [DllImport("user32.dll")] private static extern IntPtr WindowFromPoint(Point point);
    [DllImport("user32.dll")] private static extern IntPtr GetAncestor(IntPtr window, uint flags);
    [DllImport("user32.dll")] private static extern IntPtr GetShellWindow();
    [DllImport("user32.dll")] private static extern IntPtr GetParent(IntPtr window);
    [DllImport("user32.dll")] private static extern IntPtr GetWindow(IntPtr window, uint cmd);
    [DllImport("user32.dll")] private static extern bool IsWindowVisible(IntPtr window);
    [DllImport("user32.dll")] private static extern bool IsChild(IntPtr parent,IntPtr window);
    [DllImport("user32.dll")] private static extern bool GetWindowRect(IntPtr window, out Rect rect);
    [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr window, out uint process);
    [DllImport("user32.dll")] private static extern bool GetGUIThreadInfo(uint thread, ref GuiInfo info);
    [DllImport("user32.dll")] private static extern short GetAsyncKeyState(int key);
    [DllImport("user32.dll")] private static extern uint GetDoubleClickTime();
    [DllImport("user32.dll")] private static extern int GetSystemMetricsForDpi(int index, uint dpi);
    [DllImport("user32.dll")] private static extern uint GetDpiForWindow(IntPtr hwnd);
    [DllImport("user32.dll", CharSet=CharSet.Unicode)] private static extern int GetClassName(IntPtr window, StringBuilder name, int size);
    [DllImport("user32.dll")] private static extern IntPtr SetThreadDpiAwarenessContext(IntPtr context);

    public sealed class Target { public string handle; public double scale = 1; public bool pinned; internal IntPtr Window; }
    public sealed class Command { public string op, handle; public Target[] windows; public int id; public uint pid; }
    private const uint Move=0x200, LeftDown=0x201, LeftUp=0x202, RightDown=0x204, RightUp=0x205, Wheel=0x20A, Wake=0x8001;
    private static readonly HookProc Callback = HandleMouse;
    private static readonly BlockingCollection<object> Output = new BlockingCollection<object>();
    private static readonly ConcurrentQueue<Target[]> Updates = new ConcurrentQueue<Target[]>();
    private static readonly List<Target> Targets = new List<Target>();
    private static uint Owner, LoopThread, LastClickTime, LastMoveTime;
    private static volatile uint MenuPid;
    private static readonly IntPtr DismissedMenu=new IntPtr(-1);
    private static IntPtr Hook, Left, Right, Hovered, LastClick, LastPressed;
    private static Point LastClickPoint;
    private static int ClickCount = 1;

    private static bool Owned(IntPtr window) { uint pid; return window!=IntPtr.Zero && GetWindowThreadProcessId(window,out pid)!=0 && pid==Owner; }
    private static string ClassName(IntPtr window) { var n=new StringBuilder(80); GetClassName(window,n,n.Capacity); return n.ToString(); }
    private static bool ShellRoot(IntPtr root) {
        var shell=GetShellWindow(); if(shell==IntPtr.Zero)return false;
        if(root==shell)return true;
        uint s,r; GetWindowThreadProcessId(shell,out s); GetWindowThreadProcessId(root,out r);
        return s!=0 && s==r && ClassName(root)=="WorkerW";
    }
    private static bool DesktopAt(Point point) {
        var hit=WindowFromPoint(point);
        if(!ShellRoot(GetAncestor(hit,2)))return false;
        string cls=ClassName(hit);
        return cls=="SysListView32" || cls=="SHELLDLL_DefView" || cls=="Progman" || cls=="WorkerW";
    }
    private static bool InMenu(out IntPtr owner) {
        var info=new GuiInfo { Size=Marshal.SizeOf(typeof(GuiInfo)) };
        bool active=GetGUIThreadInfo(0,ref info) && (info.Flags & 0x1C)!=0;
        owner=info.MenuOwner;return active;
    }
    private static bool InMenu() { IntPtr owner;return InMenu(out owner); }
    private static bool Inside(Rect r, Point p, double scale) {
        int x=Math.Min(p.X-r.Left,r.Right-p.X-1), y=Math.Min(p.Y-r.Top,r.Bottom-p.Y-1);
        if(x<0 || y<0)return false;
        double radius=20*Math.Max(.5,scale);
        return x>=radius || y>=radius || (x-radius)*(x-radius)+(y-radius)*(y-radius)<=radius*radius;
    }
    private static bool Embedded(IntPtr h) {
        var parent=GetParent(h);if(parent==IntPtr.Zero)return false;string cls=ClassName(parent);
        return (cls=="WorkerW" || (cls=="SHELLDLL_DefView" && IsWindowVisible(parent))) && ShellRoot(GetAncestor(parent,2));
    }
    private static bool Covers(Target t, Point p) {
        Rect r;return GetWindowRect(t.Window,out r) && Inside(r,p,t.scale) && Owned(t.Window) && IsWindowVisible(t.Window) && Embedded(t.Window);
    }
    private static Target At(Point p) {
        if(!DesktopAt(p))return null;
        Target best=null;
        foreach(var t in Targets) {
            if(!Covers(t,p))continue;
            if(best==null){best=t;continue;}
            // Cards can overlap after a drag or an unpin. Match sibling paint order.
            for(var h=GetWindow(best.Window,3);h!=IntPtr.Zero;h=GetWindow(h,3))if(h==t.Window){best=t;break;}
        }
        return best;
    }
    public static object CheckRoute(string handle, uint owner, int x, int y) {
        SetThreadDpiAwarenessContext(new IntPtr(-4)); Owner=owner;
        var h=new IntPtr(long.Parse(handle));var p=new Point{X=x,Y=y};
        var hit=WindowFromPoint(p);bool direct=hit==h || IsChild(h,hit),menu=InMenu();
        return new {allowed=Covers(new Target{Window=h,scale=GetDpiForWindow(h)/96.0},p) && (direct || DesktopAt(p)) && !menu,direct=direct,menu=menu,hitClass=ClassName(hit)};
    }
    private static Target Find(IntPtr h) { if(h!=IntPtr.Zero)foreach(var t in Targets)if(t.Window==h && Owned(h))return t;return null; }
    private static bool Pressed(int key) { return (GetAsyncKeyState(key)&0x8000)!=0; }
    private static void Emit(Target t,string type,MouseData d,bool right=false) {
        Rect r;if(t==null || !GetWindowRect(t.Window,out r))return;
        Output.Add(new {handle=t.handle,type=type,x=d.Point.X-r.Left,y=d.Point.Y-r.Top,button=right?"right":"left",leftDown=Left!=IntPtr.Zero,rightDown=Right!=IntPtr.Zero,alt=Pressed(0x12),shift=Pressed(0x10),delta=(short)(d.Data>>16),clickCount=right?1:ClickCount});
    }
    private static bool Route(uint type,MouseData d) {
        bool right=type==RightDown || type==RightUp;
        if(type==LeftUp || type==RightUp) {
            var h=right?Right:Left;if(h==IntPtr.Zero)return false; // Press started elsewhere.
            if(right)Right=IntPtr.Zero;else Left=IntPtr.Zero;
            Emit(Find(h),"up",d,right); // Still swallow our release if the card disappeared.
            if(Targets.Count==0)PostThreadMessage(LoopThread,Wake,UIntPtr.Zero,IntPtr.Zero);
            return true;
        }
        if(type==Move && (Left==DismissedMenu || Right==DismissedMenu))return false;
        var t=type==Move ? Find(Left!=IntPtr.Zero?Left:Right) : null;
        if(t==null){
            t=At(d.Point);IntPtr menu;
            if(t!=null && InMenu(out menu)) {
                // Outside our Shell popup, but still on a card: dismiss without letting
                // Explorer replay this press on an icon. Other applications' menus win.
                uint pid;
                if((type==LeftDown || type==RightDown) && MenuPid!=0 && GetWindowThreadProcessId(menu,out pid)!=0 && pid==MenuPid) {
                    if(right)Right=DismissedMenu;else Left=DismissedMenu;
                    LastClick=IntPtr.Zero;PostMessage(menu,0x001F,IntPtr.Zero,IntPtr.Zero);return true; // WM_CANCELMODE
                }
                t=null;
            }
        }
        if(type==LeftDown || type==RightDown) {
            // WorkerW children don't always get a blur when the next click goes to Explorer.
            var pressed=t==null?IntPtr.Zero:t.Window;
            if(t==null){var hit=WindowFromPoint(d.Point);foreach(var target in Targets)if((hit==target.Window || IsChild(target.Window,hit)) && Owned(target.Window)){
                pressed=target.Window;
                // The pointer event is already on its way to Chromium. Repair keyboard
                // focus separately, without ever replaying or delaying that press.
                if(MenuPid==0 && !InMenu())Output.Add(new {handle=target.handle,type="native-down"});
                break;
            }}
            if(LastPressed!=IntPtr.Zero && pressed!=LastPressed && Find(LastPressed)!=null)
                Output.Add(new {handle=LastPressed.ToInt64().ToString(),type="outside"});
            LastPressed=pressed; // Observe native controls here; do not forward or suppress their click.
        }
        if(Hovered!=IntPtr.Zero && (t==null || Hovered!=t.Window)){Emit(Find(Hovered),"leave",d);Hovered=IntPtr.Zero;}
        if(type==Move) {
            if(t!=null && (Left!=IntPtr.Zero || Right!=IntPtr.Zero || (!Pressed(1) && !Pressed(2)))){Hovered=t.Window;Emit(t,"move",d);}
            return false;
        }
        if(t==null){if(type!=Wheel)LastClick=IntPtr.Zero;return false;}
        if(type==Wheel){Emit(t,"wheel",d);return true;}
        if(right){Right=t.Window;LastClick=IntPtr.Zero;}
        else {
            Left=t.Window;uint dpi=(uint)Math.Round(t.scale*96);
            ClickCount=LastClick==Left && ClickCount==1 && d.Time-LastClickTime<=GetDoubleClickTime() && Math.Abs(d.Point.X-LastClickPoint.X)<=GetSystemMetricsForDpi(36,dpi)/2 && Math.Abs(d.Point.Y-LastClickPoint.Y)<=GetSystemMetricsForDpi(37,dpi)/2 ? 2 : 1;
            LastClick=Left;LastClickTime=d.Time;LastClickPoint=d.Point;
        }
        Hovered=t.Window;Emit(t,"down",d,right);return true;
    }
    private static IntPtr HandleMouse(int code,IntPtr message,IntPtr address) {
        uint type=(uint)message.ToInt64();
        if(code>=0 && (type==Move || type==LeftDown || type==LeftUp || type==RightDown || type==RightUp || type==Wheel)) {
            var d=(MouseData)Marshal.PtrToStructure(address,typeof(MouseData));
            if(type!=Move || d.Time-LastMoveTime>=16) {
                if(type==Move)LastMoveTime=d.Time;
                // The low-level callback can enter a different DPI context than the loop.
                var prior=SetThreadDpiAwarenessContext(new IntPtr(-4));
                try { if(prior!=IntPtr.Zero && Route(type,d))return new IntPtr(1); }
                finally { if(prior!=IntPtr.Zero)SetThreadDpiAwarenessContext(prior); }
            }
        }
        return CallNextHookEx(Hook,code,message,address);
    }
    private static void ApplyUpdates() {
        Target[] windows;
        while(Updates.TryDequeue(out windows)) {
            Targets.Clear();foreach(var t in windows){t.Window=new IntPtr(long.Parse(t.handle));if(Owned(t.Window))Targets.Add(t);}
            if(Find(Hovered)==null)Hovered=IntPtr.Zero;
        }
        if(Hook==IntPtr.Zero && Targets.Count!=0) {
            Hook=SetWindowsHookEx(14,Callback,GetModuleHandle(null),0);
            if(Hook==IntPtr.Zero)throw new InvalidOperationException("Could not initialize desktop input.");
        } else if(Hook!=IntPtr.Zero && Targets.Count==0 && Left==IntPtr.Zero && Right==IntPtr.Zero){UnhookWindowsHookEx(Hook);Hook=IntPtr.Zero;}
    }
    public static int Run(uint owner,Action<string> focus) {
        Owner=owner;LoopThread=GetCurrentThreadId();SetThreadDpiAwarenessContext(new IntPtr(-4));
        Message msg;PeekMessage(out msg,IntPtr.Zero,0,0,0); // Create the thread message queue before reading stdin.
        var writer=new Thread(delegate(){var json=new JavaScriptSerializer();try{foreach(var item in Output.GetConsumingEnumerable())Console.WriteLine(json.Serialize(item));}catch{PostThreadMessage(LoopThread,0x12,UIntPtr.Zero,IntPtr.Zero);}}){IsBackground=true};
        writer.Start();
        var reader=new Thread(delegate(){
            try {
                var json=new JavaScriptSerializer();string line;
                while((line=Console.ReadLine())!=null) {
                    var c=json.Deserialize<Command>(line);
                    if(c.op=="menu"){MenuPid=c.pid;continue;}
                    if(c.op=="targets"){Updates.Enqueue(c.windows);PostThreadMessage(LoopThread,Wake,UIntPtr.Zero,IntPtr.Zero);continue;}
                    bool ok=false;
                    try {
                        if(c.op=="focus") {
                            var h=new IntPtr(long.Parse(c.handle));
                            if(Owned(h) && Embedded(h) && !InMenu()){
                                if(ClassName(GetParent(h))=="SHELLDLL_DefView"){
                                    var info=new GuiInfo{Size=Marshal.SizeOf(typeof(GuiInfo))};
                                    if(GetGUIThreadInfo(0,ref info)){
                                        if(info.Focus==h || IsChild(h,info.Focus))ok=true;
                                        else if(Owned(info.Active) || ShellRoot(GetAncestor(info.Active,2))){focus(c.handle);ok=true;}
                                    }
                                }else{focus(c.handle);ok=true;}
                            }
                        }
                        if(c.op=="check") ok=Array.TrueForAll(c.windows,delegate(Target t){var h=new IntPtr(long.Parse(t.handle));return Owned(h) && (t.pinned?GetParent(h)==IntPtr.Zero:Embedded(h));});
                    } catch { ok=false; }
                    Output.Add(new { reply=c.id,ok=ok });
                }
            } finally { PostThreadMessage(LoopThread,0x12,UIntPtr.Zero,IntPtr.Zero); }
        }){IsBackground=true};reader.Start();
        Output.Add(new {ready=true});
        try{while(GetMessage(out msg,IntPtr.Zero,0,0)>0){if(msg.Id==Wake)ApplyUpdates();else DispatchMessage(ref msg);}}
        finally{if(Hook!=IntPtr.Zero)UnhookWindowsHookEx(Hook);Output.CompleteAdding();writer.Join(500);}
        return 0;
    }
}
