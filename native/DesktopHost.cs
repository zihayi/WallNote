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
    [DllImport("user32.dll")] private static extern bool SetForegroundWindow(IntPtr window);
    [DllImport("user32.dll")] private static extern bool GetCursorPos(out Point point);
    [DllImport("user32.dll")] private static extern short GetAsyncKeyState(int key);
    [DllImport("user32.dll")] private static extern uint GetDpiForWindow(IntPtr window);
    [DllImport("user32.dll")] private static extern IntPtr MonitorFromPoint(Point point, uint flags);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern bool GetMonitorInfo(IntPtr monitor, ref MonitorInfo info);
    [DllImport("user32.dll")] private static extern int SetWindowRgn(IntPtr window, IntPtr region, bool redraw);
    [DllImport("gdi32.dll")] private static extern IntPtr CreateRoundRectRgn(int left, int top, int right, int bottom, int ellipseWidth, int ellipseHeight);
    [DllImport("gdi32.dll")] private static extern bool DeleteObject(IntPtr obj);

    private static double Scale(IntPtr window, string[] args, int index) {
        return args.Length > index ? double.Parse(args[index], System.Globalization.CultureInfo.InvariantCulture) : GetDpiForWindow(window) / 96.0;
    }

    // Chromium's rounded card has transparent corners. After a WorkerW child becomes
    // a popup, Windows can composite those pixels as opaque white. Clip the *floating*
    // HWND as well, in physical pixels, matching the renderer's 20 DIP radius.
    private static void ClipFloatingWidget(IntPtr window, int width, int height, double scale) {
        int diameter = Math.Max(1, Math.Min(Math.Min(width, height), (int)Math.Round(40 * scale)));
        var region = CreateRoundRectRgn(0, 0, width + 1, height + 1, diameter, diameter);
        if (region == IntPtr.Zero) throw new InvalidOperationException("Could not create widget outline.");
        if (SetWindowRgn(window, region, true) == 0) {
            DeleteObject(region); // On success the region belongs to Windows.
            throw new InvalidOperationException("Could not apply widget outline.");
        }
    }

    private static string ClassName(IntPtr window) { var value = new StringBuilder(256); GetClassName(window, value, value.Capacity); return value.ToString(); }
    private static object Describe(IntPtr window)
    {
        Rect rect; GetWindowRect(window, out rect);
        uint pid; GetWindowThreadProcessId(window, out pid);
        int cloaked; DwmGetWindowAttribute(window, 14, out cloaked, 4);
        return new { handle = window.ToInt64().ToString(), parent = GetParent(window).ToInt64().ToString(), className = ClassName(window), visible = IsWindowVisible(window), minimized = IsIconic(window), pid = pid,
            child = (GetWindowLongPtr(window, -16).ToInt64() & 0x40000000L) != 0,
            dpi = GetDpiForWindow(window),
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
        if (parent != IntPtr.Zero) ScreenToClient(parent, ref point);
        // The parent already defines the desktop layer; keep this app above older wallpaper children.
        if (!SetWindowPos(window, IntPtr.Zero, point.X, point.Y, width, height, 0x0010 | 0x0020 | 0x0040)) throw new Win32Exception();
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
            var parent = hosts[3];
            if (parent == IntPtr.Zero) throw new InvalidOperationException("The wallpaper WorkerW layer could not be created.");
            ShowWindow(window, 0);
            var style = GetWindowLongPtr(window, -16).ToInt64();
            var extended = GetWindowLongPtr(window, -20).ToInt64();
            SetWindowPos(window, new IntPtr(-2), 0, 0, 0, 0, 0x0010 | 0x0001 | 0x0002);
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
            // Embedded cards already use a wallpaper-matched underlay, including corners.
            SetWindowRgn(window, IntPtr.Zero, false);
            Place(window, parent, args, 4, background);
            if (GetParent(window) != parent) throw new InvalidOperationException("Desktop attachment did not succeed.");
            RedrawWindow(parent, IntPtr.Zero, IntPtr.Zero, 0x0001 | 0x0080);
            return new { attached = true, layer = args[3], window = Describe(window), host = Describe(parent), iconView = Describe(hosts[2]) };
        }
        if (args[0] == "position")
        {
            var window = OwnedWindow(args[1], args[2]);
            var parent = GetParent(window);
            Place(window, parent, args, 3, false);
            if (parent == IntPtr.Zero) ClipFloatingWidget(window, int.Parse(args[5]), int.Parse(args[6]), Scale(window, args, 7));
            return Describe(window);
        }
        if (args[0] == "outline")
        {
            var window = OwnedWindow(args[1], args[2]);
            Rect rect;
            if (GetParent(window) == IntPtr.Zero && GetWindowRect(window, out rect))
                ClipFloatingWidget(window, rect.Right - rect.Left, rect.Bottom - rect.Top, Scale(window, args, 3));
            return Describe(window);
        }
        if (args[0] == "topmost")
        {
            var window = OwnedWindow(args[1], args[2]);
            Rect rect; GetWindowRect(window, out rect);
            ShowWindow(window, 0);
            SetParent(window, IntPtr.Zero);
            var style = GetWindowLongPtr(window, -16).ToInt64();
            SetWindowLongPtr(window, -16, new IntPtr((style & ~0x40000000L) | 0x80000000L));
            ClipFloatingWidget(window, rect.Right - rect.Left, rect.Bottom - rect.Top, Scale(window, args, 3));
            if (!SetWindowPos(window, new IntPtr(-1), rect.Left, rect.Top, rect.Right - rect.Left, rect.Bottom - rect.Top, 0x0010 | 0x0020 | 0x0040)) throw new Win32Exception();
            return Describe(window);
        }
        if (args[0] == "route-check") return DesktopInputBridge.CheckRoute(args[1], uint.Parse(args[2]), int.Parse(args[3]), int.Parse(args[4]));
        if (args[0] == "icon-rects") return DesktopInputBridge.IconRectangles();
        if (args[0] == "focus")
        {
            var window = OwnedWindow(args[1], args[2]);
            uint unused;
            uint currentThread = GetCurrentThreadId();
            uint targetThread = GetWindowThreadProcessId(window, out unused);
            uint desktopThread = GetWindowThreadProcessId(FindWindow("Progman", null), out unused);
            bool embedded = GetParent(window) != IntPtr.Zero;
            if (embedded) AttachThreadInput(targetThread, desktopThread, true);
            bool targetAttached = AttachThreadInput(currentThread, targetThread, true);
            uint foregroundThread = GetWindowThreadProcessId(GetForegroundWindow(), out unused);
            bool foregroundAttached = foregroundThread != 0 && foregroundThread != targetThread && AttachThreadInput(currentThread, foregroundThread, true);
            try
            {
                SetForegroundWindow(embedded ? FindWindow("Progman", null) : window);
                var renderer = FindWindowEx(window, IntPtr.Zero, "Chrome_RenderWidgetHostHWND", null);
                SetFocus(renderer != IntPtr.Zero ? renderer : window);
            }
            finally
            {
                if (foregroundAttached) AttachThreadInput(currentThread, foregroundThread, false);
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
        if (args[0] == "arrange")
        {
            var window = OwnedWindow(args[1], args[2]);
            SetThreadDpiAwarenessContext(new IntPtr(-4)); // Pipe coordinates are physical screen pixels.
            var parent = GetParent(window);
            int lastWidth = 0, lastHeight = 0; double lastScale = 0; bool released = false;
            string line;
            while ((line = Console.ReadLine()) != null && IsWindow(window) && GetParent(window) == parent) {
                if (line != ".") {
                    var fields = line.Split(' '); if (fields.Length != 5) throw new ArgumentException("Invalid placement.");
                    var point = new Point { X = int.Parse(fields[0]), Y = int.Parse(fields[1]) };
                    int w = int.Parse(fields[2]), h = int.Parse(fields[3]);
                    double scale = double.Parse(fields[4], System.Globalization.CultureInfo.InvariantCulture);
                    if (w < 1 || h < 1 || w > 32000 || h > 32000 || !(scale > 0 && scale <= 12)) throw new ArgumentException("Invalid size.");
                    if (parent == IntPtr.Zero && (w != lastWidth || h != lastHeight || scale != lastScale)) ClipFloatingWidget(window, w, h, scale);
                    if (parent != IntPtr.Zero) ScreenToClient(parent, ref point);
                    if (!SetWindowPos(window, IntPtr.Zero, point.X, point.Y, w, h, 0x0010 | 0x0004)) throw new Win32Exception();
                    lastWidth = w; lastHeight = h; lastScale = scale;
                }
                bool cancel = (GetAsyncKeyState(27) & 0x8000) != 0;
                // Embedded clicks are consumed and routed by DesktopInputBridge. Their
                // mouse-up packet, not the foreground application's button state, ends a drag.
                if (!released && (cancel || (parent == IntPtr.Zero && (GetAsyncKeyState(1) & 0x8000) == 0))) {
                    released = true; Console.WriteLine(cancel ? "cancel" : "release"); Console.Out.Flush();
                }
            }
            return new { arranged = true };
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

    [STAThread]
    public static int Main(string[] args)
    {
        Console.OutputEncoding = new UTF8Encoding(false);
        try { if (args.Length > 0 && args[0] == "bridge") return DesktopInputBridge.Run(uint.Parse(args[1])); Console.WriteLine(new JavaScriptSerializer().Serialize(Run(args))); return 0; }
        catch (Exception error) { Console.Error.WriteLine(error.Message); return 1; }
    }
}
