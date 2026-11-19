using System;
using System.Diagnostics;
using System.Drawing;
using System.Runtime.InteropServices;
using System.Threading;
using System.Windows.Forms;

// Built only by smoke-drawer-icons.mjs. Never resolves the user's Explorer window.
internal static class DrawerIconFixture {
    [DllImport("user32.dll")] private static extern bool IsWindowVisible(IntPtr window);
    private sealed class Plate : Form {
        protected override bool ShowWithoutActivation { get { return true; } }
        protected override CreateParams CreateParams {get {var p=base.CreateParams;p.ExStyle|=0x08000000;return p;}}
    }
    [STAThread] public static void Main(string[] args) {
        if(args[0]=="hold" || args[0]=="recover") {
            var list=new IntPtr(long.Parse(args[1]));
            DesktopDrawer.Hold(new[]{args[0]=="hold"?"drawer-lease":"drawer-recover",args[2],args[3]},()=>list,@"Local\WallNote.QA.Drawer."+args[3]);return;
        }
        using(var plate=new Plate()) using(var list=new ListView()) {
            plate.ShowInTaskbar=false;plate.StartPosition=FormStartPosition.Manual;plate.Location=new Point(-22000,-22000);plate.Size=new Size(80,80);
            plate.Controls.Add(list);list.Dock=DockStyle.Fill;
            plate.Shown+=delegate {
                var listHandle=list.Handle;if(args[0]=="hidden")list.Hide();
                Console.WriteLine(listHandle.ToInt64()+" "+plate.Handle.ToInt64()+" "+Process.GetCurrentProcess().Id);Console.Out.Flush();
                new Thread(delegate(){string cmd;while((cmd=Console.ReadLine())!=null){if(cmd=="visible"){Console.WriteLine(IsWindowVisible(listHandle)?"yes":"no");Console.Out.Flush();}else break;}plate.BeginInvoke((Action)(()=>plate.Close()));}){IsBackground=true}.Start();
            };Application.Run(plate);
        }
    }
}
