# Screenshot of one window (by title) into the given PNG, at full size.
param([string]$title = "YTStudio Auto Mix", [string]$out = "C:\Users\goali\flrender\automix\test\app.png")
Add-Type -AssemblyName System.Drawing
Add-Type @'
using System; using System.Runtime.InteropServices;
public static class W {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L, T, R, B; }
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern IntPtr FindWindow(string c, string t);
  [DllImport("dwmapi.dll")] public static extern int DwmGetWindowAttribute(IntPtr h, int a, out RECT r, int s);
}
'@
[void][W]::SetProcessDPIAware()
$h = [W]::FindWindow([NullString]::Value, $title)
if ($h -eq [IntPtr]::Zero) { throw "no window '$title'" }
$r = New-Object W+RECT
[void][W]::DwmGetWindowAttribute($h, 9, [ref]$r, 16)  # the frame as drawn, without the invisible borders
$w = $r.R - $r.L; $hgt = $r.B - $r.T
$bmp = New-Object System.Drawing.Bitmap $w, $hgt
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen($r.L, $r.T, 0, 0, (New-Object System.Drawing.Size $w, $hgt))
$bmp.Save($out, [System.Drawing.Imaging.ImageFormat]::Png)
"$w x $hgt -> $out"
