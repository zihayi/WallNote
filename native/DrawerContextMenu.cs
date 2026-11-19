using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Runtime.InteropServices;
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
    [DllImport("user32.dll")] private static extern bool IsWindow(IntPtr hwnd);
    [DllImport("user32.dll")] private static extern bool EndMenu();
    [DllImport("user32.dll")] private static extern IntPtr GetClipboardOwner();
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
        protected override void WndProc(ref Message m) {
            if(m.Msg==0x117 || m.Msg==0x2B || m.Msg==0x2C || m.Msg==0x120){ // init submenu, owner-draw, menu char
                IntPtr result;
                if(menu3!=null && menu3.HandleMenuMsg2((uint)m.Msg,m.WParam,m.LParam,out result)==0){m.Result=result;return;}
                if(menu3==null && menu2!=null && menu2.HandleMenuMsg((uint)m.Msg,m.WParam,m.LParam)==0){m.Result=IntPtr.Zero;return;}
            }
            base.WndProc(ref m);
        }
    }
    public static object Show(string[] args) {
        if(args.Length!=6)throw new ArgumentException("Invalid file menu request.");
        var widget=new IntPtr(long.Parse(args[1]));uint pid;GetWindowThreadProcessId(widget,out pid);
        if(!IsWindow(widget)||pid!=uint.Parse(args[2]))throw new InvalidOperationException("Drawer is no longer available.");
        int x=int.Parse(args[3]),y=int.Parse(args[4]);
        Console.InputEncoding=new System.Text.UTF8Encoding(false);string file=Console.ReadLine();
        if(String.IsNullOrEmpty(file)||!Path.IsPathRooted(file)||(!File.Exists(file)&&!Directory.Exists(file)))throw new FileNotFoundException();
        int ole=OleInitialize(IntPtr.Zero);Marshal.ThrowExceptionForHR(ole);
        IShellItem item=null;IContextMenu context=null;IntPtr popup=IntPtr.Zero;
        var lifetime=new ShellLifetime();
        try {
            var iid=typeof(IShellItem).GUID;SHCreateItemFromParsingName(file,IntPtr.Zero,ref iid,out item);
            var handler=new Guid("3981E225-F559-11D3-8E3A-00C04F6837D5");iid=typeof(IContextMenu).GUID; // BHID_SFUIObject (ShlGuid.h)
            item.BindToHandler(IntPtr.Zero,ref handler,ref iid,out context);
            popup=CreatePopupMenu();if(popup==IntPtr.Zero)throw new InvalidOperationException();
            Marshal.ThrowExceptionForHR(context.QueryContextMenu(popup,0,1,0x6FFF,args[5]=="extended"?0x100U:0U));
            using(var host=new MenuOwner()) using(var timer=new Timer()) using(var owner=Process.GetProcessById((int)pid)) {
                host.ShowInTaskbar=false;host.FormBorderStyle=FormBorderStyle.None;host.StartPosition=FormStartPosition.Manual;
                host.Bounds=new Rectangle(x,y,1,1);host.Opacity=0;host.TopMost=true;host.menu3=context as IContextMenu3;host.menu2=context as IContextMenu2;
                host.Show();SetForegroundWindow(host.Handle);
                timer.Interval=300;timer.Tick+=delegate{if(owner.HasExited || !IsWindow(widget)) EndMenu();};timer.Start();
                uint cmd=TrackPopupMenuEx(popup,0x100U|2U,x,y,host.Handle,IntPtr.Zero); // TPM_RETURNCMD | TPM_RIGHTBUTTON
                timer.Stop();
                Console.WriteLine("menu-closed");Console.Out.Flush();
                if(cmd>=1 && cmd<=0x6FFF && IsWindow(widget) && !owner.HasExited){
                    var info=new InvokeInfo();info.size=Marshal.SizeOf(typeof(InvokeInfo));info.mask=0x4000U|0x20000000U|0x100U;
                    info.hwnd=widget;info.verb=info.verbW=new IntPtr(cmd-1);info.show=1;info.x=x;info.y=y;
                    context.InvokeCommand(ref info);
                    // Delayed OLE data from Copy/Cut must outlive this small helper.
                    uint clipOwner; GetWindowThreadProcessId(GetClipboardOwner(),out clipOwner);
                    if(clipOwner==GetCurrentProcessId())OleFlushClipboard();
                }
                host.menu2=null;host.menu3=null;return new { chosen=cmd!=0 };
            }
        } finally { if(popup!=IntPtr.Zero)DestroyMenu(popup);if(context!=null)Marshal.FinalReleaseComObject(context);if(item!=null)Marshal.FinalReleaseComObject(item);lifetime.Dispose();OleUninitialize(); }
    }
    [DllImport("kernel32.dll")] private static extern uint GetCurrentProcessId();
}
