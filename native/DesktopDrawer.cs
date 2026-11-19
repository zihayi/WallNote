using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Threading;
using System.Text;

internal static class DesktopDrawer {
    // DesktopDirectory and CommonDesktopDirectory respect Windows Known Folder redirection.
    // Only enumerate immediate children. Never resolve junctions, recurse or read file bodies.
    public static object Files(string[] args) {
        string[] roots = args.Length == 3 ? new[]{args[1],args[2]} : new[]{Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory),Environment.GetFolderPath(Environment.SpecialFolder.CommonDesktopDirectory)};
        var result = new List<object>();
        var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        for (int i=0; i<roots.Length; i++) {
            var root=roots[i]; if (String.IsNullOrEmpty(root) || !seen.Add(root)) continue;
            var entries = new List<object>(); bool ok=true, truncated=false;
            try {
                foreach (var file in new DirectoryInfo(root).EnumerateFileSystemInfos()) {
                    var name=file.Name;
                    if (name.StartsWith(".") || name.StartsWith("~$") || name.Equals("desktop.ini",StringComparison.OrdinalIgnoreCase) || name.Equals("thumbs.db",StringComparison.OrdinalIgnoreCase)) continue;
                    var attr=file.Attributes; if ((attr & (FileAttributes.Hidden|FileAttributes.System))!=0) continue;
                    if(entries.Count>=2000) { truncated=true; break; }
                    entries.Add(new { name=name, directory=(attr & FileAttributes.Directory)!=0 });
                }
            } catch (DirectoryNotFoundException) { if(i==0)ok=false; }
              catch (IOException) { ok=false; } catch(UnauthorizedAccessException) {ok=false;}
            result.Add(new {root=root, origin=i==0?"user":"public", ok=ok, truncated=truncated, entries=entries});
        }
        return result;
    }

    private const string Mark="WallNote.FileDrawer.IconLease.v1";
    private const string Lock=@"Local\WallNote.FileDrawer.IconLease.v1";
    private delegate bool EnumProc(IntPtr w, IntPtr data);
    [DllImport("user32.dll")] private static extern IntPtr GetShellWindow();
    [DllImport("user32.dll")] private static extern bool EnumWindows(EnumProc f, IntPtr data);
    [DllImport("user32.dll", CharSet=CharSet.Unicode)] private static extern int GetClassName(IntPtr w,StringBuilder name,int length);
    [DllImport("user32.dll", CharSet=CharSet.Unicode)] private static extern IntPtr FindWindowEx(IntPtr parent, IntPtr after, string cls, string title);
    [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr w,out uint pid);
    [DllImport("user32.dll")] private static extern bool IsWindowVisible(IntPtr w);
    [DllImport("user32.dll")] private static extern bool IsWindow(IntPtr w);
    [DllImport("user32.dll")] private static extern bool ShowWindow(IntPtr w,int command);
    [DllImport("user32.dll", CharSet=CharSet.Unicode)] private static extern bool SetProp(IntPtr w,string key,IntPtr value);
    [DllImport("user32.dll", CharSet=CharSet.Unicode)] private static extern IntPtr GetProp(IntPtr w,string key);
    [DllImport("user32.dll", CharSet=CharSet.Unicode)] private static extern IntPtr RemoveProp(IntPtr w,string key);
    private static IntPtr IconList() {
        var shell=GetShellWindow(); uint shellPid; GetWindowThreadProcessId(shell,out shellPid);
        if(shell==IntPtr.Zero || shellPid==0)return IntPtr.Zero;
        IntPtr found=IntPtr.Zero;
        EnumWindows(delegate(IntPtr w,IntPtr unused){
            uint pid; GetWindowThreadProcessId(w,out pid); if(pid!=shellPid)return true;
            var cls=new StringBuilder(64);GetClassName(w,cls,cls.Capacity);
            if(w!=shell && cls.ToString()!="Progman" && cls.ToString()!="WorkerW")return true;
            var view=FindWindowEx(w,IntPtr.Zero,"SHELLDLL_DefView",null);
            if(view!=IntPtr.Zero)found=FindWindowEx(view,IntPtr.Zero,"SysListView32","FolderView");
            return found==IntPtr.Zero;
        },IntPtr.Zero);
        return found;
    }
    private static void Restore(IntPtr list,Func<IntPtr> resolve) {
        if (list==IntPtr.Zero || !IsWindow(list) || GetProp(list,Mark)==IntPtr.Zero || resolve()!=list) return;
        ShowWindow(list,8); RemoveProp(list,Mark); // SW_SHOWNA: do not take focus.
    }
    public static object Lease(string[] args) {
        return Hold(args,IconList,Lock);
    }
    // Tests use offscreen list controls and their own mutex. The shipped command
    // always discovers Explorer itself; it never accepts an icon-list HWND from IPC.
    internal static object Hold(string[] args,Func<IntPtr> resolve,string mutexName) {
        using(var mutex=new Mutex(false,mutexName)) {
            bool held=false; IntPtr list=IntPtr.Zero;
            try {
                try {held=mutex.WaitOne(0);} catch(AbandonedMutexException){held=true;}
                if(!held) { if(args[0]=="drawer-recover")return new {recovered=false}; throw new InvalidOperationException("Desktop icons are managed by another instance."); }
                list=resolve(); Restore(list,resolve); // Recover a marked window if a previous helper was interrupted.
                if(args[0]=="drawer-recover")return new {recovered=true};
                if(list==IntPtr.Zero)throw new InvalidOperationException("Desktop icon view unavailable.");
                var target=new IntPtr(long.Parse(args[1])); uint pid; GetWindowThreadProcessId(target,out pid);
                if(pid!=uint.Parse(args[2]) || !IsWindowVisible(target))throw new InvalidOperationException("File drawer is not visible.");
                using(var owner=Process.GetProcessById((int)pid)) using(var stop=new ManualResetEvent(false)) {
                    bool wasVisible=IsWindowVisible(list);
                    if(wasVisible) {
                        if(!SetProp(list,Mark,new IntPtr(1)))throw new InvalidOperationException("Cannot mark the desktop icon view.");
                        ShowWindow(list,0);
                        if(IsWindowVisible(list))throw new InvalidOperationException("Cannot hide desktop icons.");
                    }
                    Console.WriteLine(wasVisible?"hidden":"already-hidden");Console.Out.Flush();
                    new Thread(delegate(){try{Console.ReadLine();}catch{}finally{try{stop.Set();}catch(ObjectDisposedException){}}}){IsBackground=true}.Start();
                    while(!stop.WaitOne(400) && !owner.HasExited && IsWindowVisible(target) && IsWindow(list)) {
                        if(wasVisible && IsWindowVisible(list))break; // Respect an external Show command.
                    }
                }
                return new {released=true};
            } finally { if(held){Restore(list,resolve);mutex.ReleaseMutex();} }
        }
    }
}
