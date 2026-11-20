using System;
using System.Collections.Concurrent;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Windows.Forms;

// A real, per-item classic Shell menu. All command IDs come from TrackPopupMenuEx
// following the user's selection; the renderer never supplies a verb or a file path.
internal static class DrawerContextMenu {
    [ComImport, Guid("43826D1E-E718-42EE-BC55-A1E261C37BFE"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IShellItem {
        void BindToHandler(IntPtr bind,ref Guid handler,ref Guid iid,[MarshalAs(UnmanagedType.Interface)] out IContextMenu menu);
    }
    [ComImport, Guid("000214E4-0000-0000-C000-000000000046"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IContextMenu {
        [PreserveSig] int QueryContextMenu(IntPtr menu,uint index,uint first,uint last,uint flags);
        void InvokeCommand(ref InvokeInfo command);
        [PreserveSig] int GetCommandString(UIntPtr id,uint type,IntPtr reserved,IntPtr name,uint length);
    }
    // Explicit vtable order also works on the .NET Framework compiler shipped with Windows.
    [ComImport, Guid("000214F4-0000-0000-C000-000000000046"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IContextMenu2 {
        [PreserveSig] int QueryContextMenu(IntPtr menu,uint index,uint first,uint last,uint flags);
        [PreserveSig] int InvokeCommand(IntPtr command);
        [PreserveSig] int GetCommandString(UIntPtr id,uint type,IntPtr reserved,IntPtr name,uint length);
        [PreserveSig] int HandleMenuMsg(uint msg,IntPtr wp,IntPtr lp);
    }
    [ComImport, Guid("BCFCE0A0-EC17-11D0-8D10-00A0C90F2719"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IContextMenu3 {
        [PreserveSig] int QueryContextMenu(IntPtr menu,uint index,uint first,uint last,uint flags);
        [PreserveSig] int InvokeCommand(IntPtr command);
        [PreserveSig] int GetCommandString(UIntPtr id,uint type,IntPtr reserved,IntPtr name,uint length);
        [PreserveSig] int HandleMenuMsg(uint msg,IntPtr wp,IntPtr lp);
        [PreserveSig] int HandleMenuMsg2(uint msg,IntPtr wp,IntPtr lp,out IntPtr result);
    }
    [StructLayout(LayoutKind.Sequential)] private struct InvokeInfo {
        public int size; public uint mask; public IntPtr hwnd, verb, parameters, directory;
        public int show; public uint hotKey; public IntPtr icon,title,verbW,parametersW,directoryW,titleW;
        public int x,y;
    }
    [DllImport("shell32.dll",CharSet=CharSet.Unicode,ExactSpelling=true,PreserveSig=false)] private static extern void SHCreateItemFromParsingName(string file,IntPtr bind,ref Guid iid,[MarshalAs(UnmanagedType.Interface)] out IShellItem item);
    [DllImport("user32.dll")] private static extern IntPtr CreatePopupMenu();
    [DllImport("user32.dll")] private static extern bool DestroyMenu(IntPtr menu);
    [DllImport("user32.dll")] private static extern uint TrackPopupMenuEx(IntPtr menu,uint flags,int x,int y,IntPtr owner,IntPtr parameters);
    [DllImport("user32.dll")] private static extern bool SetForegroundWindow(IntPtr hwnd);
    [DllImport("user32.dll")] private static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] private static extern IntPtr GetAncestor(IntPtr hwnd,uint flags);
    [DllImport("user32.dll")] private static extern IntPtr GetShellWindow();
    [DllImport("user32.dll")] private static extern bool AttachThreadInput(uint first,uint second,bool attach);
    [DllImport("kernel32.dll")] private static extern uint GetCurrentThreadId();
    [DllImport("user32.dll")] private static extern bool IsWindow(IntPtr hwnd);
    [DllImport("user32.dll")] private static extern bool EndMenu();
    [DllImport("user32.dll")] private static extern IntPtr GetClipboardOwner();
    [DllImport("user32.dll")] private static extern uint GetClipboardSequenceNumber();
    [DllImport("user32.dll")] private static extern bool IsWindowVisible(IntPtr hwnd);
    [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr hwnd,out uint pid);
    [DllImport("ole32.dll")] private static extern int OleInitialize(IntPtr reserved);
    [DllImport("ole32.dll")] private static extern void OleUninitialize();
    [DllImport("ole32.dll")] private static extern int OleFlushClipboard();
    [DllImport("shlwapi.dll")] private static extern int SHCreateThreadRef(IntPtr refCount,out IntPtr unknown);
    [DllImport("shell32.dll")] private static extern void SHSetInstanceExplorer(IntPtr unknown);
    [DllImport("user32.dll")] private static extern uint MsgWaitForMultipleObjectsEx(uint count,IntPtr handles,uint delay,uint mask,uint flags);
    // A Shell verb can return before its property sheet or worker is finished.
    // Keep the STA dispatching messages only for as long as a handler holds a reference.
    private sealed class ShellLifetime : IDisposable {
        private IntPtr count, unknown;
        public ShellLifetime() {
            count=Marshal.AllocCoTaskMem(4);Marshal.WriteInt32(count,0);
            if(SHCreateThreadRef(count,out unknown)>=0)SHSetInstanceExplorer(unknown);
        }
        public void Dispose() {
            if(unknown!=IntPtr.Zero) {
                SHSetInstanceExplorer(IntPtr.Zero);Marshal.Release(unknown);
                while(Marshal.ReadInt32(count)>0){Application.DoEvents();MsgWaitForMultipleObjectsEx(0,IntPtr.Zero,200,0x4FF,4);}
            }
            Marshal.FreeCoTaskMem(count);
        }
    }
    private sealed class MenuOwner : Form {
        internal IContextMenu2 menu2; internal IContextMenu3 menu3;
        protected override bool ShowWithoutActivation { get { return true; } }
        internal bool TakeForeground(IntPtr widget,uint ownerPid) {
            var handle=Handle;
            var origin=GetForegroundWindow();uint pid;
            // The user may have switched apps while a slow extension built its menu.
            if(origin!=IntPtr.Zero && origin!=handle && GetWindowThreadProcessId(origin,out pid)!=0 && pid!=ownerPid && origin!=GetAncestor(widget,2) && origin!=GetShellWindow())return false;
            SetForegroundWindow(handle);
            var foreground=GetForegroundWindow();
            if(foreground==handle)return true;
            // A WorkerW child can have keyboard focus while Explorer owns the
            // foreground. Borrow only the initiating app/desktop input queue,
            // and never leave queues joined during the modal menu or its verb.
            uint thread=GetWindowThreadProcessId(foreground,out pid), current=GetCurrentThreadId();
            if(thread==0 || (pid!=ownerPid && foreground!=GetAncestor(widget,2) && foreground!=GetShellWindow()))return false;
            if(!AttachThreadInput(current,thread,true))return false;
            try { if(GetForegroundWindow()==foreground)SetForegroundWindow(handle); }
            finally { AttachThreadInput(current,thread,false); }
            return GetForegroundWindow()==handle;
        }
        protected override void WndProc(ref Message m) {
            if(m.Msg==0x117 || m.Msg==0x2B || m.Msg==0x2C || m.Msg==0x120){ // init submenu, owner-draw, menu char
                IntPtr result;
                if(menu3!=null && menu3.HandleMenuMsg2((uint)m.Msg,m.WParam,m.LParam,out result)==0){m.Result=result;return;}
                if(menu3==null && menu2!=null && menu2.HandleMenuMsg((uint)m.Msg,m.WParam,m.LParam)==0){m.Result=IntPtr.Zero;return;}
            }
            base.WndProc(ref m);
        }
    }
    private static volatile bool stopping,building;
    private static int wanted;
    private static readonly bool measure=Environment.GetEnvironmentVariable("WALLNOTE_MENU_TRACE")=="1";
    // Only the STA touches these flags or any COM/menu/window object.
    private static bool busy, tracking;
    private static void Reply(string state,int id) { Console.WriteLine(state+" "+id);Console.Out.Flush(); }
    private static bool Owned(IntPtr widget,Process owner) {
        uint pid;return !owner.HasExited && IsWindow(widget) && GetWindowThreadProcessId(widget,out pid)!=0 && pid==(uint)owner.Id;
    }
    private static bool Available(IntPtr widget,Process owner) {return !stopping && Owned(widget,owner) && IsWindowVisible(widget);}

    // At most one pending gesture. A displayed menu is consumed, never reused on a
    // later click (not even for the same file). No Shell verb runs during preparation.
    private sealed class FileMenu : IDisposable {
        internal int seq; internal string file; internal IntPtr widget,popup;
        internal IContextMenu context; private IShellItem item;
        private ShellLifetime lifetime=new ShellLifetime();
        private uint clipboard; private long ready;
        internal long parseMs,bindMs,queryMs;

        internal static FileMenu Build(int seq,string file,IntPtr widget,bool extended) {
            var m=new FileMenu{seq=seq,file=file,widget=widget,clipboard=GetClipboardSequenceNumber()};
            building=true;
            try {
                var clock=measure?Stopwatch.StartNew():null;
                var iid=typeof(IShellItem).GUID;SHCreateItemFromParsingName(file,IntPtr.Zero,ref iid,out m.item);
                m.parseMs=measure?clock.ElapsedMilliseconds:0;
                var handler=new Guid("3981E225-F559-11D3-8E3A-00C04F6837D5");iid=typeof(IContextMenu).GUID;
                m.item.BindToHandler(IntPtr.Zero,ref handler,ref iid,out m.context);
                m.bindMs=measure?clock.ElapsedMilliseconds-m.parseMs:0;
                m.popup=CreatePopupMenu();if(m.popup==IntPtr.Zero)throw new InvalidOperationException();
                Marshal.ThrowExceptionForHR(m.context.QueryContextMenu(m.popup,0,1,0x6FFF,0x400U|(extended?0x100U:0U)));
                m.queryMs=measure?clock.ElapsedMilliseconds-m.parseMs-m.bindMs:0;
                m.ready=Stopwatch.GetTimestamp();return m;
            } catch {m.Dispose();throw;} finally {building=false;}
        }
        internal bool Matches(int id,IntPtr hwnd,string path) {
            return id!=0 && id==seq && hwnd==widget && file==path && clipboard!=0 && clipboard==GetClipboardSequenceNumber() && Stopwatch.GetTimestamp()-ready<5L*Stopwatch.Frequency;
        }
        public void Dispose(){
            if(popup!=IntPtr.Zero)DestroyMenu(popup);
            if(context!=null)Marshal.FinalReleaseComObject(context);
            if(item!=null)Marshal.FinalReleaseComObject(item);
            lifetime.Dispose();
        }
    }
    private static FileMenu pending;
    private static void Drop() {var m=pending;pending=null;if(m!=null)m.Dispose();}
    private static string FileFrom(string field){var file=Encoding.UTF8.GetString(Convert.FromBase64String(field));if(!Path.IsPathRooted(file))throw new ArgumentException();return file;}

    private static void Show(MenuOwner host,Process owner,string[] args,int id) {
        var widget=new IntPtr(long.Parse(args[2]));int x=int.Parse(args[3]),y=int.Parse(args[4]),prepared=int.Parse(args[6]);
        bool extended=args[5]=="1";string file=FileFrom(args[7]);
        if(!Available(widget,owner))throw new OperationCanceledException();
        FileMenu m=null;
        if(!extended && pending!=null && pending.Matches(prepared,widget,file)){m=pending;pending=null;}else Drop();
        if(m==null)m=FileMenu.Build(0,file,widget,extended);
        using(m)try {
            if(!Available(widget,owner))throw new OperationCanceledException();
            var clock=measure?Stopwatch.StartNew():null;
            host.menu3=m.context as IContextMenu3;host.menu2=m.context as IContextMenu2;
            host.Bounds=new Rectangle(x,y,1,1);host.Show();
            if(!host.TakeForeground(widget,(uint)owner.Id))throw new InvalidOperationException();
            if(measure)Console.WriteLine("profile "+id+" "+m.parseMs+" "+m.bindMs+" "+m.queryMs+" "+clock.ElapsedMilliseconds);
            uint cmd;
            using(var timer=new System.Windows.Forms.Timer {Interval=300}) {
                timer.Tick+=delegate {uint fg;GetWindowThreadProcessId(GetForegroundWindow(),out fg);if(!Available(widget,owner)||fg!=GetCurrentProcessId())EndMenu();};
                timer.Start();tracking=true;
                try {
                    Reply("tracking",id);
                    cmd=TrackPopupMenuEx(m.popup,0x4102U,x,y,host.Handle,IntPtr.Zero); // NOANIMATION | RETURNCMD | RIGHTBUTTON
                } finally {tracking=false;Reply("closed",id);} // Before any verb, property sheet or STA teardown.
            }
            if(cmd>=1 && cmd<=0x6FFF && Owned(widget,owner)){
                var info=new InvokeInfo();info.size=Marshal.SizeOf(typeof(InvokeInfo));info.mask=0x4000U|0x20000000U|0x100U;
                info.hwnd=widget;info.verb=info.verbW=new IntPtr(cmd-1);info.show=1;info.x=x;info.y=y;
                m.context.InvokeCommand(ref info);
                uint clipOwner;GetWindowThreadProcessId(GetClipboardOwner(),out clipOwner);
                if(clipOwner==GetCurrentProcessId())OleFlushClipboard();
            }
        } finally {
            host.Hide();host.menu2=null;host.menu3=null;
        }
    }

    private static void Drain(ConcurrentQueue<string[]> commands,MenuOwner host,Process owner){
        if(busy)return; // Some Shell handlers pump messages reentrantly during Query/Invoke.
        busy=true;
        try {
            string[] a;
            while(!stopping && commands.TryDequeue(out a)){
                int id=int.Parse(a[1]);
                if(a[0]=="show"){
                    try {Show(host,owner,a,id);Reply("done",id);}catch{Drop();Reply("failed",id);}
                }else if(a[0]=="prepare" && Volatile.Read(ref wanted)==id){
                    Drop();var hwnd=new IntPtr(long.Parse(a[2]));
                    try {if(Available(hwnd,owner))pending=FileMenu.Build(id,FileFrom(a[3]),hwnd,false);}catch{/* Re-query on actual Show. */}
                    if(Volatile.Read(ref wanted)!=id)Drop();
                }else if(a[0]=="drop" && pending!=null && pending.seq==id)Drop();
            }
        } finally {busy=false;if(stopping)Application.ExitThread();}
    }

    public static int Run(uint pid) {
        Marshal.ThrowExceptionForHR(OleInitialize(IntPtr.Zero));
        try {
            using(var owner=Process.GetProcessById((int)pid))using(var host=new MenuOwner()) {
                host.ShowInTaskbar=false;host.FormBorderStyle=FormBorderStyle.None;host.StartPosition=FormStartPosition.Manual;
                host.Opacity=0;host.TopMost=true;var hwnd=host.Handle; // Hidden warm owner; never activate it until Show.
                var commands=new ConcurrentQueue<string[]>();var sta=Thread.CurrentThread;
                var reader=new Thread(delegate(){
                    try {
                        string line;
                        while((line=Console.ReadLine())!=null){
                            if(line.Length>200000)break;
                            var fields=line.Split(' ');int id;
                            if(fields.Length<2 || !int.TryParse(fields[1],out id) || id<=0)break;
                            if(fields[0]=="prepare" && fields.Length==4)Interlocked.Exchange(ref wanted,id);
                            else if(fields[0]=="drop" && fields.Length==2)Interlocked.CompareExchange(ref wanted,0,id);
                            else if(fields[0]=="show" && fields.Length==8)Interlocked.Exchange(ref wanted,int.Parse(fields[6]));
                            else break;
                            commands.Enqueue(fields);host.BeginInvoke((Action)delegate{Drain(commands,host,owner);});
                        }
                    } catch(InvalidOperationException){} catch(IOException){} catch(FormatException){}
                    finally {
                        stopping=true;
                        try {host.BeginInvoke((Action)delegate {if(tracking)EndMenu();if(!busy)Application.ExitThread();});}catch(InvalidOperationException){}
                        // An abandoned query can be stuck inside a third-party extension; only
                        // terminate a still-building worker, never one executing a Shell verb.
                        if(building && !sta.Join(2500) && building)Process.GetCurrentProcess().Kill();
                    }
                }){IsBackground=true};reader.Start();
                try{Application.Run();}finally{Drop();} // EOF (including parent death) releases the hidden owner.
            }
        } finally {OleUninitialize();}
        return 0;
    }
    [DllImport("kernel32.dll")] private static extern uint GetCurrentProcessId();
}
