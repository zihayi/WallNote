using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Text;
using System.Web.Script.Serialization;
using System.Threading;

// A small out-of-process Win32 bridge. It never replaces Explorer or changes its icon view.
internal static class DesktopHost
{
    private delegate bool EnumProc(IntPtr window, IntPtr parameter);
    [StructLayout(LayoutKind.Sequential)] private struct Rect { public int Left, Top, Right, Bottom; }
    [StructLayout(LayoutKind.Sequential)] private struct Point { public int X, Y; }
    [StructLayout(LayoutKind.Sequential)] private struct MonitorInfo { public int Size; public Rect Monitor, Work; public uint Flags; }
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern IntPtr FindWindow(string cls, string title);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern IntPtr FindWindowEx(IntPtr parent, IntPtr after, string cls, string title);
    [DllImport("user32.dll")] private static extern bool EnumWindows(EnumProc callback, IntPtr parameter);
    [DllImport("user32.dll")] private static extern bool EnumChildWindows(IntPtr parent, EnumProc callback, IntPtr parameter);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern int GetClassName(IntPtr window, StringBuilder value, int max);
    [DllImport("user32.dll")] private static extern IntPtr GetParent(IntPtr window);
    [DllImport("user32.dll")] private static extern bool IsWindow(IntPtr window);
    [DllImport("user32.dll")] private static extern bool IsWindowVisible(IntPtr window);
    [DllImport("user32.dll")] private static extern bool IsIconic(IntPtr window);
    [DllImport("user32.dll")] private static extern bool GetWindowRect(IntPtr window, out Rect rect);
    [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr window, out uint process);
    [DllImport("user32.dll", SetLastError = true)] private static extern IntPtr SetParent(IntPtr child, IntPtr parent);
    [DllImport("user32.dll", EntryPoint = "GetWindowLongPtrW")] private static extern IntPtr GetWindowLongPtr(IntPtr window, int index);
    [DllImport("user32.dll", EntryPoint = "SetWindowLongPtrW", SetLastError = true)] private static extern IntPtr SetWindowLongPtr(IntPtr window, int index, IntPtr value);
    [DllImport("user32.dll", SetLastError = true)] private static extern bool SetWindowPos(IntPtr window, IntPtr after, int x, int y, int width, int height, uint flags);
    [DllImport("user32.dll")] private static extern bool ScreenToClient(IntPtr window, ref Point point);
    [DllImport("user32.dll")] private static extern bool ShowWindow(IntPtr window, int command);
    [DllImport("user32.dll")] private static extern IntPtr SendMessageTimeout(IntPtr window, uint message, IntPtr wParam, IntPtr lParam, uint flags, uint timeout, out IntPtr result);
    [DllImport("user32.dll")] private static extern bool RedrawWindow(IntPtr window, IntPtr rect, IntPtr region, uint flags);
    [DllImport("user32.dll")] private static extern IntPtr SetThreadDpiAwarenessContext(IntPtr context);
    [DllImport("user32.dll")] private static extern IntPtr GetWindowDpiAwarenessContext(IntPtr window);
    [DllImport("kernel32.dll")] private static extern void SetLastError(uint error);
    [DllImport("dwmapi.dll")] private static extern int DwmGetWindowAttribute(IntPtr window, int attribute, out int value, int size);
    [DllImport("kernel32.dll")] private static extern uint GetCurrentThreadId();
    [DllImport("user32.dll")] private static extern bool AttachThreadInput(uint first, uint second, bool attach);
    [DllImport("user32.dll")] private static extern IntPtr SetFocus(IntPtr window);
    [DllImport("user32.dll")] private static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] private static extern bool GetCursorPos(out Point point);
    [DllImport("user32.dll")] private static extern short GetAsyncKeyState(int key);
    [DllImport("user32.dll")] private static extern uint GetDpiForWindow(IntPtr window);
    [DllImport("user32.dll")] private static extern IntPtr MonitorFromPoint(Point point, uint flags);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern bool GetMonitorInfo(IntPtr monitor, ref MonitorInfo info);

    private static string ClassName(IntPtr window) { var value = new StringBuilder(256); GetClassName(window, value, value.Capacity); return value.ToString(); }
    private static object Describe(IntPtr window)
    {
        Rect rect; GetWindowRect(window, out rect);
        uint pid; GetWindowThreadProcessId(window, out pid);
        int cloaked; DwmGetWindowAttribute(window, 14, out cloaked, 4);
        return new { handle = window.ToInt64().ToString(), parent = GetParent(window).ToInt64().ToString(), className = ClassName(window), visible = IsWindowVisible(window), minimized = IsIconic(window), pid = pid,
            child = (GetWindowLongPtr(window, -16).ToInt64() & 0x40000000L) != 0,
            topmost = (GetWindowLongPtr(window, -20).ToInt64() & 0x00000008L) != 0, cloaked = cloaked != 0,
            bounds = new { x = rect.Left, y = rect.Top, width = rect.Right - rect.Left, height = rect.Bottom - rect.Top } };
    }

    private static IntPtr[] Locate(bool create)
    {
        var progman = FindWindow("Progman", null);
        if (progman == IntPtr.Zero) throw new InvalidOperationException("Windows Explorer desktop is not available.");
        IntPtr iconHost = IntPtr.Zero, view = IntPtr.Zero, wallpaperHost = IntPtr.Zero;
        EnumWindows(delegate(IntPtr window, IntPtr parameter) {
            var candidate = FindWindowEx(window, IntPtr.Zero, "SHELLDLL_DefView", null);
            if (candidate != IntPtr.Zero) { iconHost = window; view = candidate; }
            return true;
        }, IntPtr.Zero);
        if (iconHost == IntPtr.Zero) throw new InvalidOperationException("The desktop icon host is not available.");
        // Windows 11 24H2+ can keep WorkerW inside Progman. Older shells use a sibling WorkerW.
        wallpaperHost = FindWindowEx(progman, IntPtr.Zero, "WorkerW", null);
        if (wallpaperHost == IntPtr.Zero) wallpaperHost = FindWindowEx(IntPtr.Zero, iconHost, "WorkerW", null);
        if (wallpaperHost == IntPtr.Zero && create)
        {
            IntPtr result;
            // Sending this on every attachment destroys/replaces WorkerW on recent Windows 11.
            // Only request creation when the desktop has no wallpaper host yet.
            SendMessageTimeout(progman, 0x052C, new IntPtr(0xD), IntPtr.Zero, 2, 1500, out result);
            SendMessageTimeout(progman, 0x052C, new IntPtr(0xD), new IntPtr(1), 2, 1500, out result);
            var created = Locate(false);
            if (created[3] == IntPtr.Zero)
            {
                SendMessageTimeout(progman, 0x052C, IntPtr.Zero, IntPtr.Zero, 2, 1500, out result);
                created = Locate(false);
            }
            return created;
        }
        return new[] { progman, iconHost, view, wallpaperHost };
    }

    private static IntPtr OwnedWindow(string value, string owner)
    {
        var window = new IntPtr(long.Parse(value));
        uint pid; GetWindowThreadProcessId(window, out pid);
        if (!IsWindow(window) || pid != uint.Parse(owner)) throw new InvalidOperationException("Window does not belong to the requesting application.");
        SetThreadDpiAwarenessContext(GetWindowDpiAwarenessContext(window));
        return window;
    }

    private static void Place(IntPtr window, IntPtr parent, string[] args, int offset, bool bottom)
    {
        var point = new Point { X = int.Parse(args[offset]), Y = int.Parse(args[offset + 1]) };
        int width = int.Parse(args[offset + 2]), height = int.Parse(args[offset + 3]);
        if (width < 1 || height < 1 || width > 32000 || height > 32000) throw new ArgumentException("Invalid window size.");
        if (bottom)
        {
            // DIP rounding at 125/150% scaling otherwise leaves a one-pixel seam between displays.
            var monitor = MonitorFromPoint(new Point { X = point.X + width / 2, Y = point.Y + height / 2 }, 2);
            var info = new MonitorInfo { Size = Marshal.SizeOf(typeof(MonitorInfo)) };
            if (GetMonitorInfo(monitor, ref info)) { point.X = info.Monitor.Left; point.Y = info.Monitor.Top; width = info.Monitor.Right - info.Monitor.Left; height = info.Monitor.Bottom - info.Monitor.Top; }
        }
        ScreenToClient(parent, ref point);
        if (!SetWindowPos(window, bottom ? new IntPtr(1) : IntPtr.Zero, point.X, point.Y, width, height, 0x0010 | 0x0020 | 0x0040)) throw new Win32Exception();
    }

    private static object Run(string[] args)
    {
        SetThreadDpiAwarenessContext(new IntPtr(-4));
        if (args.Length == 0 || args[0] == "probe")
        {
            var windows = new List<object>();
            EnumWindows(delegate(IntPtr window, IntPtr parameter) {
                var cls = ClassName(window);
                if (cls == "Progman" || cls == "WorkerW")
                {
                    windows.Add(Describe(window));
                    EnumChildWindows(window, delegate(IntPtr child, IntPtr unused) { windows.Add(Describe(child)); return true; }, IntPtr.Zero);
                }
                return true;
            }, IntPtr.Zero);
            return new { windows = windows };
        }
        if (args[0] == "inspect")
        {
            var window = new IntPtr(long.Parse(args[1]));
            return new { exists = IsWindow(window), window = IsWindow(window) ? Describe(window) : null };
        }
        if (args[0] == "attach")
        {
            if (args.Length != 8) throw new ArgumentException("attach requires handle owner layer x y width height");
            var window = OwnedWindow(args[1], args[2]);
            bool background = args[3] == "wallpaper";
            var hosts = Locate(true);
            var parent = background ? hosts[3] : hosts[1];
            if (parent == IntPtr.Zero) throw new InvalidOperationException("The wallpaper WorkerW layer could not be created.");
            ShowWindow(window, 0);
            var style = GetWindowLongPtr(window, -16).ToInt64();
            var extended = GetWindowLongPtr(window, -20).ToInt64();
            SetWindowLongPtr(window, -16, new IntPtr((style & ~0x80000000L) | 0x40000000L));
            SetWindowLongPtr(window, -20, new IntPtr((extended & ~0x00040000L) | 0x00000080L));
            SetLastError(0);
            var previous = SetParent(window, parent);
            int error = Marshal.GetLastWin32Error();
            if (previous == IntPtr.Zero && error != 0) throw new Win32Exception(error);
            if (!background)
            {
                uint unused;
                uint widgetThread = GetWindowThreadProcessId(window, out unused);
                uint desktopThread = GetWindowThreadProcessId(parent, out unused);
                AttachThreadInput(widgetThread, desktopThread, true);
            }
            Place(window, parent, args, 4, background);
            if (GetParent(window) != parent) throw new InvalidOperationException("Desktop attachment did not succeed.");
            RedrawWindow(parent, IntPtr.Zero, IntPtr.Zero, 0x0001 | 0x0080);
            return new { attached = true, layer = args[3], window = Describe(window), host = Describe(parent), iconView = Describe(hosts[2]) };
        }
        if (args[0] == "position")
        {
            var window = OwnedWindow(args[1], args[2]);
            var parent = GetParent(window);
            if (parent == IntPtr.Zero) throw new InvalidOperationException("Window is not attached.");
            Place(window, parent, args, 3, false);
            return Describe(window);
        }
        if (args[0] == "focus")
        {
            var window = OwnedWindow(args[1], args[2]);
            uint unused;
            uint currentThread = GetCurrentThreadId();
            uint targetThread = GetWindowThreadProcessId(window, out unused);
            uint desktopThread = GetWindowThreadProcessId(FindWindow("Progman", null), out unused);
            AttachThreadInput(targetThread, desktopThread, true);
            bool targetAttached = AttachThreadInput(currentThread, targetThread, true);
            try
            {
                var renderer = FindWindowEx(window, IntPtr.Zero, "Chrome_RenderWidgetHostHWND", null);
                SetFocus(renderer != IntPtr.Zero ? renderer : window);
            }
            finally
            {
                if (targetAttached) AttachThreadInput(currentThread, targetThread, false);
            }
            return new { focused = true };
        }
        if (args[0] == "release-focus")
        {
            var window = OwnedWindow(args[1], args[2]);
            uint unused;
            uint widgetThread = GetWindowThreadProcessId(window, out unused);
            uint desktopThread = GetWindowThreadProcessId(FindWindow("Progman", null), out unused);
            if (desktopThread != 0) AttachThreadInput(widgetThread, desktopThread, false);
            return new { released = true };
        }
        if (args[0] == "move" || args[0] == "resize")
        {
            var window = OwnedWindow(args[1], args[2]);
            var parent = GetParent(window);
            if (parent == IntPtr.Zero) throw new InvalidOperationException("Window is not attached.");
            Point start; GetCursorPos(out start);
            Rect initial; GetWindowRect(window, out initial);
            double scale = GetDpiForWindow(window) / 96.0;
            DateTime deadline = DateTime.UtcNow.AddSeconds(10);
            while (IsWindow(window) && (GetAsyncKeyState(1) & 0x8000) != 0 && DateTime.UtcNow < deadline)
            {
                Point cursor; GetCursorPos(out cursor);
                int dx = cursor.X - start.X, dy = cursor.Y - start.Y;
                var point = new Point { X = initial.Left, Y = initial.Top };
                int width = initial.Right - initial.Left, height = initial.Bottom - initial.Top;
                if (args[0] == "move") { point.X += dx; point.Y += dy; }
                else { width = Math.Max((int)(260 * scale), Math.Min((int)(1600 * scale), width + dx)); height = Math.Max((int)(220 * scale), Math.Min((int)(1600 * scale), height + dy)); }
                ScreenToClient(parent, ref point);
                SetWindowPos(window, IntPtr.Zero, point.X, point.Y, width, height, 0x0010 | 0x0004);
                Thread.Sleep(16);
            }
            return new { moved = true };
        }
        if (args[0] == "refresh")
        {
            var hosts = Locate(false);
            RedrawWindow(hosts[0], IntPtr.Zero, IntPtr.Zero, 0x0001 | 0x0080 | 0x0400);
            RedrawWindow(hosts[1], IntPtr.Zero, IntPtr.Zero, 0x0001 | 0x0080 | 0x0400);
            return new { refreshed = true };
        }
        if (args[0] == "show-desktop" || args[0] == "restore-desktop" || args[0] == "toggle-desktop")
        {
            var shellType = Type.GetTypeFromProgID("Shell.Application");
            var shell = Activator.CreateInstance(shellType);
            try { shellType.InvokeMember(args[0] == "show-desktop" ? "MinimizeAll" : args[0] == "restore-desktop" ? "UndoMinimizeAll" : "ToggleDesktop", System.Reflection.BindingFlags.InvokeMethod, null, shell, null); }
            finally { Marshal.ReleaseComObject(shell); }
            return new { shown = true };
        }
        throw new ArgumentException("Unknown command.");
    }

    public static int Main(string[] args)
    {
        Console.OutputEncoding = new UTF8Encoding(false);
        try { Console.WriteLine(new JavaScriptSerializer().Serialize(Run(args))); return 0; }
        catch (Exception error) { Console.Error.WriteLine(error.Message); return 1; }
    }
}
