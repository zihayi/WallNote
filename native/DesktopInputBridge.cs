using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;
using System.Windows.Forms;

// Routes mouse input only through blank desktop areas to this process's wallpaper widgets.
// Desktop icons and other applications retain their normal mouse handling. No keyboard hook.
internal static class DesktopInputBridge
{
    [StructLayout(LayoutKind.Sequential)] private struct Point { public int X, Y; }
    [StructLayout(LayoutKind.Sequential)] private struct Rect { public int Left, Top, Right, Bottom; }
    [StructLayout(LayoutKind.Sequential)] private struct MouseData { public Point Point; public uint Data, Flags, Time; public UIntPtr Extra; }
    private delegate IntPtr HookProc(int code, IntPtr message, IntPtr data);
    private delegate bool EnumProc(IntPtr window, IntPtr data);
    [DllImport("user32.dll")] private static extern IntPtr SetWindowsHookEx(int type, HookProc callback, IntPtr module, uint thread);
    [DllImport("user32.dll")] private static extern bool UnhookWindowsHookEx(IntPtr hook);
    [DllImport("user32.dll")] private static extern IntPtr CallNextHookEx(IntPtr hook, int code, IntPtr message, IntPtr data);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] private static extern IntPtr GetModuleHandle(string module);
    [DllImport("user32.dll")] private static extern IntPtr WindowFromPoint(Point point);
    [DllImport("user32.dll")] private static extern IntPtr GetParent(IntPtr window);
    [DllImport("user32.dll")] private static extern bool IsWindow(IntPtr window);
    [DllImport("user32.dll")] private static extern bool IsWindowVisible(IntPtr window);
    [DllImport("user32.dll")] private static extern bool GetWindowRect(IntPtr window, out Rect rect);
    [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr window, out uint process);
    [DllImport("user32.dll")] private static extern bool ScreenToClient(IntPtr window, ref Point point);
    [DllImport("user32.dll")] private static extern bool ClientToScreen(IntPtr window, ref Point point);
    [DllImport("user32.dll")] private static extern bool GetCursorPos(out Point point);
    [DllImport("user32.dll")] private static extern short GetAsyncKeyState(int key);
    [DllImport("user32.dll")] private static extern uint GetDoubleClickTime();
    [DllImport("user32.dll")] private static extern bool EnumWindows(EnumProc callback, IntPtr data);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern IntPtr FindWindowEx(IntPtr parent, IntPtr after, string cls, string title);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern int GetClassName(IntPtr window, StringBuilder name, int size);
    [DllImport("user32.dll")] private static extern IntPtr SetThreadDpiAwarenessContext(IntPtr context);
    [DllImport("user32.dll")] private static extern bool SetWindowPos(IntPtr window, IntPtr after, int x, int y, int width, int height, uint flags);
    [DllImport("user32.dll")] private static extern IntPtr SendMessageTimeout(IntPtr window, uint message, IntPtr first, IntPtr second, uint flags, uint timeout, out IntPtr result);
    [DllImport("kernel32.dll")] private static extern IntPtr OpenProcess(uint access, bool inherit, uint process);
    [DllImport("kernel32.dll")] private static extern bool CloseHandle(IntPtr handle);
    [DllImport("kernel32.dll")] private static extern IntPtr VirtualAllocEx(IntPtr process, IntPtr address, UIntPtr size, uint allocation, uint protection);
    [DllImport("kernel32.dll")] private static extern bool VirtualFreeEx(IntPtr process, IntPtr address, UIntPtr size, uint type);
    [DllImport("kernel32.dll")] private static extern bool WriteProcessMemory(IntPtr process, IntPtr address, byte[] data, UIntPtr size, out UIntPtr written);
    [DllImport("kernel32.dll")] private static extern bool ReadProcessMemory(IntPtr process, IntPtr address, byte[] data, UIntPtr size, out UIntPtr read);

    public sealed class Target { public string handle; public bool pinned; public double scale = 1; public int minWidth = 260; public int minHeight = 240; }
    public sealed class Command { public string op; public Target[] windows; public string handle; }
    private static readonly JavaScriptSerializer Serializer = new JavaScriptSerializer();
    private static readonly BlockingCollection<object> Output = new BlockingCollection<object>();
    private static readonly ConcurrentQueue<Command> Commands = new ConcurrentQueue<Command>();
    private static readonly List<Target> Targets = new List<Target>();
    private static readonly HookProc Callback = HandleMouse;
    private static uint Owner;
    private static IntPtr Hook, Captured, Hovered, LastClick;
    private static Point DownPoint, LastClickPoint;
    private static Rect DownBounds;
    private static uint LastClickTime, LastMoveTime;
    private static int ClickCount = 1;
    private static string Manipulation;
    private static volatile bool Stopping;
    private static IconHitTester Icons;

    private static string ClassName(IntPtr window) { var name = new StringBuilder(128); GetClassName(window, name, name.Capacity); return name.ToString(); }
    private static bool Owned(IntPtr window) { uint pid; GetWindowThreadProcessId(window, out pid); return IsWindow(window) && pid == Owner; }
    private static IntPtr Handle(Target target) { long value; return long.TryParse(target.handle, out value) ? new IntPtr(value) : IntPtr.Zero; }
    private static Target FindTarget(IntPtr window) { return Targets.Find(target => Handle(target) == window); }
    private static bool DesktopAt(Point point) {
        string cls = ClassName(WindowFromPoint(point));
        return cls == "SysListView32" || cls == "SHELLDLL_DefView" || cls == "Progman" || cls == "WorkerW";
    }
    private static bool Inside(Rect rect, Point point, double scale) {
        if (point.X < rect.Left || point.Y < rect.Top || point.X >= rect.Right || point.Y >= rect.Bottom) return false;
        double radius = 20 * Math.Max(.5, scale);
        double x = Math.Min(point.X - rect.Left, rect.Right - point.X - 1), y = Math.Min(point.Y - rect.Top, rect.Bottom - point.Y - 1);
        return x >= radius || y >= radius || (x - radius) * (x - radius) + (y - radius) * (y - radius) <= radius * radius;
    }

    // LVM_HITTEST needs a buffer in the ListView process. Only our 24-byte scratch allocation
    // is read/written; no file names, item text, Explorer settings or existing memory are changed.
    private sealed class IconHitTester : IDisposable {
        private IntPtr list, process, buffer;
        private void Resolve() {
            if (IsWindow(list) && ClassName(list) == "SysListView32") return;
            Dispose();
            EnumWindows(delegate(IntPtr window, IntPtr unused) {
                IntPtr view = FindWindowEx(window, IntPtr.Zero, "SHELLDLL_DefView", null);
                if (view != IntPtr.Zero) list = FindWindowEx(view, IntPtr.Zero, "SysListView32", null);
                return list == IntPtr.Zero;
            }, IntPtr.Zero);
            if (list == IntPtr.Zero) return;
            uint pid; GetWindowThreadProcessId(list, out pid);
            process = OpenProcess(0x0038, false, pid);
            if (process != IntPtr.Zero) buffer = VirtualAllocEx(process, IntPtr.Zero, new UIntPtr(24), 0x3000, 0x04);
        }
        public bool Hit(Point point) {
            Resolve();
            if (list == IntPtr.Zero || !IsWindowVisible(list)) return false;
            if (buffer == IntPtr.Zero) return true; // Fail closed: preserve icon interaction.
            ScreenToClient(list, ref point);
            var bytes = new byte[24];
            Array.Copy(BitConverter.GetBytes(point.X), 0, bytes, 0, 4); Array.Copy(BitConverter.GetBytes(point.Y), 0, bytes, 4, 4);
            UIntPtr count;
            if (!WriteProcessMemory(process, buffer, bytes, new UIntPtr(24), out count)) return true;
            IntPtr result;
            if (SendMessageTimeout(list, 0x1012, IntPtr.Zero, buffer, 2, 25, out result) == IntPtr.Zero) return true;
            if (!ReadProcessMemory(process, buffer, bytes, new UIntPtr(24), out count)) return true;
            return result.ToInt64() >= 0 && (BitConverter.ToUInt32(bytes, 8) & 14) != 0;
        }
        public object Rectangles() {
            Resolve(); var rectangles = new List<object>();
            if (list == IntPtr.Zero || buffer == IntPtr.Zero || !IsWindowVisible(list)) return rectangles;
            IntPtr total; if (SendMessageTimeout(list, 0x1004, IntPtr.Zero, IntPtr.Zero, 2, 25, out total) == IntPtr.Zero) return rectangles;
            for (int index = 0; index < Math.Min(10, total.ToInt32()); index++) {
                var bytes = new byte[24]; bytes[0] = 1; // LVIR_ICON: only icon geometry, never item text.
                UIntPtr count; if (!WriteProcessMemory(process, buffer, bytes, new UIntPtr(24), out count)) break;
                IntPtr result; if (SendMessageTimeout(list, 0x100E, new IntPtr(index), buffer, 2, 25, out result) == IntPtr.Zero || result == IntPtr.Zero) continue;
                if (!ReadProcessMemory(process, buffer, bytes, new UIntPtr(24), out count)) continue;
                var start = new Point { X = BitConverter.ToInt32(bytes, 0), Y = BitConverter.ToInt32(bytes, 4) };
                var end = new Point { X = BitConverter.ToInt32(bytes, 8), Y = BitConverter.ToInt32(bytes, 12) };
                ClientToScreen(list, ref start); ClientToScreen(list, ref end);
                rectangles.Add(new { x = start.X, y = start.Y, width = end.X - start.X, height = end.Y - start.Y });
            }
            return rectangles;
        }
        public void Dispose() { if (buffer != IntPtr.Zero && process != IntPtr.Zero) VirtualFreeEx(process, buffer, UIntPtr.Zero, 0x8000); if (process != IntPtr.Zero) CloseHandle(process); buffer = process = list = IntPtr.Zero; }
    }

    public static object CheckRoute(string handle, uint owner, int x, int y) {
        SetThreadDpiAwarenessContext(new IntPtr(-4)); Owner = owner;
        var window = new IntPtr(long.Parse(handle)); var point = new Point { X = x, Y = y };
        Rect rect; GetWindowRect(window, out rect);
        using (var icons = new IconHitTester()) {
            bool icon = DesktopAt(point) && icons.Hit(point);
            return new { allowed = Owned(window) && IsWindowVisible(window) && DesktopAt(point) && !icon && Inside(rect, point, 1), iconPriority = icon, hitClass = ClassName(WindowFromPoint(point)) };
        }
    }
    public static object IconRectangles() { SetThreadDpiAwarenessContext(new IntPtr(-4)); using (var icons = new IconHitTester()) return icons.Rectangles(); }

    private static void Emit(IntPtr target, string type, MouseData data, bool down, int delta) {
        Rect rect; if (!GetWindowRect(target, out rect)) return;
        Output.Add(new { handle = target.ToInt64().ToString(), type = type, x = data.Point.X - rect.Left, y = data.Point.Y - rect.Top, width = rect.Right - rect.Left, height = rect.Bottom - rect.Top, leftDown = down, delta = delta, clickCount = ClickCount });
    }

    private static IntPtr HandleMouse(int code, IntPtr message, IntPtr address) {
        if (code < 0 || Targets.Count == 0) return CallNextHookEx(Hook, code, message, address);
        try {
            uint type = (uint)message.ToInt64();
            if (type != 0x0200 && type != 0x0201 && type != 0x0202 && type != 0x020A) return CallNextHookEx(Hook, code, message, address);
            var data = (MouseData)Marshal.PtrToStructure(address, typeof(MouseData));
            Target target = FindTarget(Captured);
            if (target == null || !Owned(Captured)) { Captured = IntPtr.Zero; Manipulation = null; target = null; }
            if (target == null && type != 0x0202) {
                uint hitPid; IntPtr hit = WindowFromPoint(data.Point); GetWindowThreadProcessId(hit, out hitPid);
                if (hitPid == Owner) {
                    // Observe pinned windows for dragging, but let Windows deliver their input normally.
                    for (var window = hit; window != IntPtr.Zero; window = GetParent(window)) { var candidate = FindTarget(window); if (candidate != null && candidate.pinned) { target = candidate; break; } }
                } else if (DesktopAt(data.Point)) {
                    for (int i = Targets.Count - 1; i >= 0; i--) {
                        var candidate = Targets[i]; IntPtr window = Handle(candidate); Rect rect;
                        if (candidate.pinned || !Owned(window) || !IsWindowVisible(window) || !GetWindowRect(window, out rect)) continue;
                        if (Inside(rect, data.Point, candidate.scale)) { target = candidate; break; }
                    }
                    if (target != null && Icons.Hit(data.Point)) target = null;
                }
            }
            if (target == null) {
                if (Hovered != IntPtr.Zero && Owned(Hovered)) Emit(Hovered, "leave", data, false, 0);
                Hovered = IntPtr.Zero;
                return CallNextHookEx(Hook, code, message, address);
            }
            IntPtr handle = Handle(target);
            if (type == 0x0201) {
                Captured = handle; DownPoint = data.Point; GetWindowRect(handle, out DownBounds);
                ClickCount = LastClick == handle && data.Time - LastClickTime <= GetDoubleClickTime() && Math.Abs(data.Point.X - LastClickPoint.X) < 5 && Math.Abs(data.Point.Y - LastClickPoint.Y) < 5 ? 2 : 1;
                LastClick = handle; LastClickTime = data.Time; LastClickPoint = data.Point;
            }
            if (type == 0x0200 && Captured != IntPtr.Zero && Manipulation != null) {
                Point point = new Point { X = DownBounds.Left, Y = DownBounds.Top };
                int width = DownBounds.Right - DownBounds.Left, height = DownBounds.Bottom - DownBounds.Top;
                if (Manipulation == "move") { point.X += data.Point.X - DownPoint.X; point.Y += data.Point.Y - DownPoint.Y; }
                else { width = Math.Max((int)Math.Ceiling(target.minWidth * target.scale), width + data.Point.X - DownPoint.X); height = Math.Max((int)Math.Ceiling(target.minHeight * target.scale), height + data.Point.Y - DownPoint.Y); }
                IntPtr parent = GetParent(handle); if (parent != IntPtr.Zero) ScreenToClient(parent, ref point);
                int maximum = (int)Math.Round(1600 * target.scale);
                SetWindowPos(handle, IntPtr.Zero, point.X, point.Y, Math.Min(width, maximum), Math.Min(height, maximum), 0x0010 | 0x0004 | (Manipulation == "move" ? 0x0001U : 0U));
            }
            if (!target.pinned) {
                if (type == 0x0200) {
                    if (Captured == IntPtr.Zero && (GetAsyncKeyState(1) & 0x8000) != 0) return CallNextHookEx(Hook, code, message, address);
                    if (data.Time - LastMoveTime >= 8) { Emit(handle, "move", data, Captured != IntPtr.Zero, 0); LastMoveTime = data.Time; }
                } else Emit(handle, type == 0x0201 ? "down" : type == 0x0202 ? "up" : "wheel", data, type == 0x0201, (short)(data.Data >> 16));
                Hovered = handle;
            }
            bool suppress = !target.pinned && type != 0x0200;
            if (type == 0x0202) { Captured = IntPtr.Zero; Manipulation = null; }
            return suppress ? new IntPtr(1) : CallNextHookEx(Hook, code, message, address);
        } catch { return CallNextHookEx(Hook, code, message, address); }
    }

    public static int Run(uint owner) {
        Owner = owner; SetThreadDpiAwarenessContext(new IntPtr(-4)); Icons = new IconHitTester();
        var writer = new Thread(delegate() { foreach (var item in Output.GetConsumingEnumerable()) { try { Console.WriteLine(Serializer.Serialize(item)); } catch { Stopping = true; break; } } }) { IsBackground = true };
        writer.Start();
        var reader = new Thread(delegate() {
            try { string line; var parser = new JavaScriptSerializer(); while ((line = Console.ReadLine()) != null) { if (line.Length < 200000) Commands.Enqueue(parser.Deserialize<Command>(line)); } } catch { }
            Stopping = true;
        }) { IsBackground = true };
        reader.Start();
        Hook = SetWindowsHookEx(14, Callback, GetModuleHandle(null), 0);
        if (Hook == IntPtr.Zero) throw new InvalidOperationException("Desktop mouse routing could not be initialized.");
        var timer = new System.Windows.Forms.Timer { Interval = 15 };
        timer.Tick += delegate {
            if (Stopping) { Application.ExitThread(); return; }
            Command command;
            while (Commands.TryDequeue(out command)) {
                if (command.op == "targets") {
                    Targets.Clear();
                    if (command.windows != null) foreach (var target in command.windows) if (Owned(Handle(target))) Targets.Add(target);
                    if (FindTarget(Captured) == null) { Captured = IntPtr.Zero; Manipulation = null; }
                } else if (command.op == "stop" && Captured.ToInt64().ToString() == command.handle) Manipulation = null;
                else if ((command.op == "move" || command.op == "resize") && Captured.ToInt64().ToString() == command.handle) Manipulation = command.op;
            }
        };
        timer.Start(); Output.Add(new { ready = true });
        try { Application.Run(); }
        finally { timer.Stop(); timer.Dispose(); UnhookWindowsHookEx(Hook); Icons.Dispose(); Output.CompleteAdding(); writer.Join(500); }
        return 0;
    }
}
