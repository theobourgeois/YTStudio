# Clicks at a point given in the 0.6-scaled screenshot's coordinates (shot.ps1), or types keys after.
param([double]$x, [double]$y, [string]$button = "left", [double]$scale = 0.6, [int]$count = 1)
Add-Type @'
using System; using System.Runtime.InteropServices;
public static class Mouse {
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint f, uint dx, uint dy, uint d, UIntPtr e);
}
'@
[void][Mouse]::SetProcessDPIAware()
[void][Mouse]::SetCursorPos([int]($x / $scale), [int]($y / $scale))
Start-Sleep -Milliseconds 80
if ($button -eq "right") { [Mouse]::mouse_event(8, 0, 0, 0, [UIntPtr]::Zero); [Mouse]::mouse_event(16, 0, 0, 0, [UIntPtr]::Zero) }
else { for ($i = 0; $i -lt $count; $i++) { [Mouse]::mouse_event(2, 0, 0, 0, [UIntPtr]::Zero); [Mouse]::mouse_event(4, 0, 0, 0, [UIntPtr]::Zero); Start-Sleep -Milliseconds 60 } }
