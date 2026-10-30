# Moves a window (by title) to x,y (screen pixels), keeping its size.
param([string]$title, [int]$x, [int]$y)
Add-Type @"
using System; using System.Runtime.InteropServices;
public static class MW {
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern IntPtr FindWindow(string c, string t);
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h, IntPtr a, int x, int y, int cx, int cy, uint f);
}
"@
[void][MW]::SetProcessDPIAware()
$h = [MW]::FindWindow([NullString]::Value, $title)
if ($h -eq [IntPtr]::Zero) { throw "no window '$title'" }
[void][MW]::SetWindowPos($h, [IntPtr]::Zero, $x, $y, 0, 0, 0x15)  # NOSIZE|NOZORDER|NOACTIVATE
"moved"
