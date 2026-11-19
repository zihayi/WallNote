using System;
using System.Drawing;
using System.Drawing.Imaging;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Web.Script.Serialization;

// Ask the Shell about concrete items, not just their extensions. Look up an explicit
// shortcut icon before the type association; extract resources without launching targets.
internal static class DrawerArtwork {
    public sealed class Source {
        public string file { get; set; }
        public bool directory { get; set; }
        public string target { get; set; }
        public string icon { get; set; }
        public int index { get; set; }
    }
    [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)]
    private struct FileInfoW {
        public IntPtr hIcon;
        public int iIcon;
        public uint attributes;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst=260)] public string displayName;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst=80)] public string typeName;
    }
    [DllImport("ole32.dll")] private static extern int CoInitializeEx(IntPtr reserved,uint flags);
    [DllImport("ole32.dll")] private static extern void CoUninitialize();
    [DllImport("shell32.dll", CharSet=CharSet.Unicode, ExactSpelling=true)]
    private static extern IntPtr SHGetFileInfoW(string file, uint attributes, ref FileInfoW info, uint size, uint flags);
    [DllImport("user32.dll", CharSet=CharSet.Unicode, ExactSpelling=true)]
    private static extern uint PrivateExtractIconsW(string file, int index, int width, int height, out IntPtr handle, IntPtr resourceId, uint count, uint flags);
    [DllImport("user32.dll")] private static extern bool DestroyIcon(IntPtr handle);
    [DllImport("kernel32.dll", CharSet=CharSet.Unicode, ExactSpelling=true)] private static extern uint GetDriveTypeW(string root);

    private static string LocalResource(string raw, string item) {
        if (String.IsNullOrWhiteSpace(raw)) return null;
        string value = Environment.ExpandEnvironmentVariables(raw.Trim().Trim('"'));
        // Don't fetch favicons or resolve a network/device icon location.
        if (value.StartsWith(@"\") || value.StartsWith("/") || value.Contains("://") || value.Length>1 && value[1]==':' && (value.Length<3 || value[2]!='\\' && value[2]!='/')) return null;
        if (!Path.IsPathRooted(value)) value = Path.Combine(Path.GetDirectoryName(item), value);
        value = Path.GetFullPath(value);
        return value.Length >= 3 && Char.IsLetter(value[0]) && value[1] == ':' && value[2] == '\\' && GetDriveTypeW(Path.GetPathRoot(value))!=4 ? value : null;
    }
    private static bool HasPixels(Bitmap b) {
        if (b.GetPixel(b.Width/2,b.Height/2).A!=0) return true;
        for (int y=0;y<b.Height;y++) for (int x=0;x<b.Width;x++) if(b.GetPixel(x,y).A!=0) return true;
        return false;
    }
    private static string Png(IntPtr hIcon) {
        if (hIcon == IntPtr.Zero) return "";
        try {
            using (Icon icon=Icon.FromHandle(hIcon)) using (Bitmap bitmap=icon.ToBitmap()) using (var stream=new MemoryStream()) {
                if(!HasPixels(bitmap)) return "";
                bitmap.Save(stream, ImageFormat.Png);
                return Convert.ToBase64String(stream.ToArray());
            }
        } finally { DestroyIcon(hIcon); }
    }
    private static string Extract(string file, int index) {
        if (String.IsNullOrEmpty(file)) return "";
        IntPtr hIcon;
        uint count=PrivateExtractIconsW(file,index,64,64,out hIcon,IntPtr.Zero,1,0);
        if(count != 1) { if(hIcon!=IntPtr.Zero)DestroyIcon(hIcon); return ""; }
        return Png(hIcon);
    }
    private static void UrlIcon(string file, out string location, out int index) {
        location=null;index=0;
        // Parse only the two icon fields of a local .url, never its destination. Internet
        // shortcuts may be UTF-8 (including non-ASCII resource paths), UTF-16 or legacy ANSI.
        string meta;
        using(var f=new FileStream(file,FileMode.Open,FileAccess.Read,FileShare.ReadWrite|FileShare.Delete)) {
            if(f.Length>32768)return;
            try { using(var reader=new StreamReader(f,new UTF8Encoding(false,true),true,1024,true))meta=reader.ReadToEnd(); }
            catch(DecoderFallbackException) { f.Position=0;using(var reader=new StreamReader(f,Encoding.Default,true,1024,true))meta=reader.ReadToEnd(); }
        }
        bool section=false;
        using(var lines=new StringReader(meta)) { string raw;while((raw=lines.ReadLine())!=null){
            string line=raw.Trim();if(line.StartsWith("[")){section=line.Equals("[InternetShortcut]",StringComparison.OrdinalIgnoreCase);continue;}
            int eq=line.IndexOf('=');if(!section||eq<=0)continue;
            string key=line.Substring(0,eq).Trim(),value=line.Substring(eq+1).Trim();
            if(key.Equals("IconFile",StringComparison.OrdinalIgnoreCase))location=value;
            else if(key.Equals("IconIndex",StringComparison.OrdinalIgnoreCase))Int32.TryParse(value,out index);
        }}
    }
    private static string Read(Source item) {
        if (item==null || String.IsNullOrEmpty(item.file) || !Path.IsPathRooted(item.file)) return "";
        string ext=Path.GetExtension(item.file).ToLowerInvariant();
        bool local=LocalResource(item.file,item.file)!=null;
        bool associationOnly=!local;
        if(!item.directory && (ext==".lnk" || ext==".url")) {
            string location=item.icon; int index=item.index;
            if(local && ext==".url") UrlIcon(item.file,out location,out index);
            string resource=LocalResource(location,item.file);
            string image=Extract(resource,index); if(image.Length!=0)return image;
            string target=LocalResource(item.target,item.file);
            if(target!=null && String.Equals(Path.GetExtension(target),".exe",StringComparison.OrdinalIgnoreCase)) {
                image=Extract(target,0); if(image.Length!=0)return image;
            }
            // A .url with no local resource uses its Windows file-type icon; never
            // dereference its URL. For local Shell links allow special Shell icons too.
            associationOnly |= ext==".url" || (!String.IsNullOrEmpty(location) && resource==null) || (!String.IsNullOrEmpty(item.target) && target==null);
        } else if(!item.directory && local && (ext==".exe" || ext==".ico")) {
            string image=Extract(item.file,0); if(image.Length!=0)return image;
        }
        var info=new FileInfoW();
        SHGetFileInfoW(associationOnly?"item"+ext:item.file,associationOnly?(item.directory?0x10U:0x80U):0U,ref info,(uint)Marshal.SizeOf(typeof(FileInfoW)),0x100U | (associationOnly?0x10U:0U));
        return Png(info.hIcon);
    }
    public static string[] Batch() {
        Console.InputEncoding=new UTF8Encoding(false);
        var items=new JavaScriptSerializer { MaxJsonLength=2097152 }.Deserialize<Source[]>(Console.In.ReadToEnd());
        if(items==null || items.Length>16)throw new ArgumentException("Invalid icon batch.");
        var result=new string[items.Length];int com=CoInitializeEx(IntPtr.Zero,2);
        try {for(int i=0;i<items.Length;i++){ try {result[i]=Read(items[i]);} catch {result[i]="";} }return result;}
        finally { if(com>=0)CoUninitialize(); }
    }
}
