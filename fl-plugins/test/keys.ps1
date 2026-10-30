# Sends keystrokes (SendKeys syntax) to whatever window has focus.
param([string]$keys)
Add-Type -AssemblyName System.Windows.Forms
[System.Windows.Forms.SendKeys]::SendWait($keys)
