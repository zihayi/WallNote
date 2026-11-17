using System;
using System.Runtime.InteropServices;
using System.Threading;
using System.Windows.Forms;
using System.Text;

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
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern int GetClassName(IntPtr window, StringBuilder value, int max);
    private static string Describe(IntPtr window) { var name = new StringBuilder(256); GetClassName(window, name, 256); return window.ToInt64() + ":" + name.ToString(); }
    [STAThread]
    public static void Main(string[] args)
    {
        SetThreadDpiAwarenessContext(new IntPtr(-4));
        Point original; GetCursorPos(out original);
        int x = int.Parse(args[1]), y = int.Parse(args[2]);
        try {
            SetCursorPos(x, y); Thread.Sleep(120);
            Console.WriteLine("hit=" + Describe(WindowFromPoint(new Point { X = x, Y = y })));
            mouse_event(2, 0, 0, 0, UIntPtr.Zero); Thread.Sleep(120);
            if (args[0] == "drag") {
                int dx = int.Parse(args[3]), dy = int.Parse(args[4]);
                for (int i = 1; i <= 15; i++) { SetCursorPos(x + dx * i / 15, y + dy * i / 15); Thread.Sleep(30); }
            }
            mouse_event(4, 0, 0, 0, UIntPtr.Zero); Thread.Sleep(150);
            if (args[0] == "type") SendKeys.SendWait(args[3]);
            Console.WriteLine("foreground=" + Describe(GetForegroundWindow()));
        } finally { mouse_event(4, 0, 0, 0, UIntPtr.Zero); SetCursorPos(original.X, original.Y); }
    }
}
