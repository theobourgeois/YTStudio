# Brings a program's main window to the front (FL Studio by default, maximised) so a screenshot shows it.
param([string]$name = "FL64", [int]$cmd = 3)
Add-Type @'
using System; using System.Runtime.InteropServices;
public static class Win {
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int cmd);
  [DllImport("user32.dll")] public static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr extra);
}
'@
$p = Get-Process $name -ErrorAction Stop | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
[Win]::keybd_event(0x12, 0, 0, [UIntPtr]::Zero); [Win]::keybd_event(0x12, 0, 2, [UIntPtr]::Zero)  # Alt, so Windows lets us take focus
[void][Win]::ShowWindow($p.MainWindowHandle, $cmd)
[void][Win]::SetForegroundWindow($p.MainWindowHandle)
"front: $($p.MainWindowTitle)"
