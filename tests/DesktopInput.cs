using System;
using System.Runtime.InteropServices;
using System.Threading;
using System.Windows.Forms;
using System.Text;
using System.Collections.Generic;
using System.Web.Script.Serialization;

// OS-level input smoke test helper; not included in the release application.
internal static class DesktopInput
{
    [StructLayout(LayoutKind.Sequential)] private struct Point { public int X, Y; }
    [DllImport("user32.dll")] private static extern bool SetCursorPos(int x, int y);
    [DllImport("user32.dll")] private static extern bool GetCursorPos(out Point point);
    [DllImport("user32.dll")] private static extern void mouse_event(uint flags, uint x, uint y, uint data, UIntPtr extra);
    [DllImport("user32.dll")] private static extern IntPtr SetThreadDpiAwarenessContext(IntPtr context);
    [DllImport("user32.dll")] private static extern IntPtr WindowFromPoint(Point point);
    [DllImport("user32.dll")] private static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr window, out uint process);
    [StructLayout(LayoutKind.Sequential)] private struct Rect { public int Left, Top, Right, Bottom; }
    [DllImport("user32.dll")] private static extern bool GetWindowRect(IntPtr window, out Rect rect);
    [DllImport("user32.dll")] private static extern int GetWindowRgn(IntPtr window, IntPtr region);
    [DllImport("gdi32.dll")] private static extern IntPtr CreateRectRgn(int left, int top, int right, int bottom);
    [DllImport("gdi32.dll")] private static extern bool PtInRegion(IntPtr region, int x, int y);
    [DllImport("gdi32.dll")] private static extern bool DeleteObject(IntPtr region);
    [StructLayout(LayoutKind.Sequential)] private struct GuiInfo { public int Size; public uint Flags; public IntPtr Active, Focus, Capture, MenuOwner, MoveSize, Caret; public int Left, Top, Right, Bottom; }
    [DllImport("user32.dll")] private static extern bool GetGUIThreadInfo(uint thread, ref GuiInfo info);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern int GetClassName(IntPtr window, StringBuilder value, int max);
    private static string Describe(IntPtr window) { var name = new StringBuilder(256); GetClassName(window, name, 256); return window.ToInt64() + ":" + name.ToString(); }
    private static bool CanRoute(string handle, uint owner, int x, int y) {
        if (handle == null) return false;
        var parser = new JavaScriptSerializer();
        var result = parser.Deserialize<Dictionary<string, object>>(parser.Serialize(DesktopInputBridge.CheckRoute(handle, owner, x, y)));
        return result.ContainsKey("allowed") && result["allowed"] is bool && (bool)result["allowed"];
    }
    [STAThread]
    public static void Main(string[] args)
    {
        SetThreadDpiAwarenessContext(new IntPtr(-4));
        if (args[0] == "outline") {
            var window = new IntPtr(long.Parse(args[1])); uint pid; Rect box;
            GetWindowThreadProcessId(window, out pid);
            if (pid != uint.Parse(args[2]) || !GetWindowRect(window, out box)) throw new ArgumentException("Not a test widget.");
            var region = CreateRectRgn(0, 0, 0, 0);
            try {
                int w = box.Right - box.Left, h = box.Bottom - box.Top;
                int kind = GetWindowRgn(window, region);
                if (args[3] == "embedded") { if (kind != 0) throw new Exception("Desktop underlay is still clipped."); }
                else if (kind == 0 || PtInRegion(region, 2, 2) || PtInRegion(region, w-3, 2) || PtInRegion(region, 2, h-3) || PtInRegion(region, w-3, h-3)
                         || !PtInRegion(region, w/2, 2) || !PtInRegion(region, w/2, h-3) || !PtInRegion(region, w-3, h/2)) throw new Exception("Windows silhouette does not fit the current widget size.");
            } finally { DeleteObject(region); }
            return;
        }
        Point original; GetCursorPos(out original);
        int x = int.Parse(args[1]), y = int.Parse(args[2]);
        uint owner = uint.Parse(args[args.Length - 1]);
        string desktopHandle = args.Length > 4 && args[args.Length - 2].StartsWith("desktop:") ? args[args.Length - 2].Substring(8) : null;
        uint hitOwner; GetWindowThreadProcessId(WindowFromPoint(new Point { X = x, Y = y }), out hitOwner);
        if (hitOwner != owner && !CanRoute(desktopHandle, owner, x, y)) throw new InvalidOperationException("Test widget is covered; expected PID " + owner + ", hit " + hitOwner + ". No input was sent.");
        bool pressed = false, right = args[0] == "right";
        uint down = right ? 8U : 2U, up = right ? 16U : 4U;
        try {
            SetCursorPos(x, y); Thread.Sleep(120);
            GetWindowThreadProcessId(WindowFromPoint(new Point { X = x, Y = y }), out hitOwner);
            if (hitOwner != owner && !CanRoute(desktopHandle, owner, x, y)) throw new InvalidOperationException("Test widget lost visibility; input cancelled.");
            Console.WriteLine("hit=" + Describe(WindowFromPoint(new Point { X = x, Y = y })));
            if (args[0] == "wheel") { mouse_event(0x0800, 0, 0, unchecked((uint)int.Parse(args[3])), UIntPtr.Zero); Thread.Sleep(400); return; }
            mouse_event(down, 0, 0, 0, UIntPtr.Zero); pressed = true;
            Thread.Sleep(args[0] == "drag" ? 450 : 120); // Allow the native drag helper to acquire its initial point.
            if (args[0] == "drag") {
                int dx = int.Parse(args[3]), dy = int.Parse(args[4]);
                for (int i = 1; i <= 15; i++) { SetCursorPos(x + dx * i / 15, y + dy * i / 15); Thread.Sleep(30); }
            }
            var released=DateTime.UtcNow;mouse_event(up, 0, 0, 0, UIntPtr.Zero); pressed = false;
            if(right)Console.WriteLine("releaseMs="+(long)(released-new DateTime(1970,1,1,0,0,0,DateTimeKind.Utc)).TotalMilliseconds);
            if(args[0]=="double") {
                Thread.Sleep(30);
                GetWindowThreadProcessId(WindowFromPoint(new Point { X=x, Y=y }),out hitOwner);
                if(hitOwner!=owner && !CanRoute(desktopHandle,owner,x,y))throw new InvalidOperationException("Second click cancelled: test item is covered.");
                mouse_event(2,0,0,0,UIntPtr.Zero);pressed=true;Thread.Sleep(25);mouse_event(4,0,0,0,UIntPtr.Zero);pressed=false;
            }
            Thread.Sleep(350);
            if (args[0] == "type") {
                var info = new GuiInfo { Size = Marshal.SizeOf(typeof(GuiInfo)) };
                GetGUIThreadInfo(0, ref info);
                uint focusOwner; GetWindowThreadProcessId(info.Focus, out focusOwner);
                if (focusOwner != owner) throw new InvalidOperationException("Test widget lost keyboard focus; typing cancelled.");
                SendKeys.SendWait(args[3]);
            }
            Console.WriteLine("foreground=" + Describe(GetForegroundWindow()));
        } finally { if (pressed) mouse_event(up, 0, 0, 0, UIntPtr.Zero); Thread.Sleep(200); SetCursorPos(original.X, original.Y); }
    }
}
