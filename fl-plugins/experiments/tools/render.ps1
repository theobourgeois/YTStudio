# Renders an FLP to a WAV beside it with FL's command line; FL sometimes stays open after, so it's closed once the WAV is complete.
param([string]$flp, [int]$timeout = 900)
$wav = [IO.Path]::ChangeExtension($flp, '.wav')
Remove-Item $wav -ErrorAction SilentlyContinue
Get-Process FL64 -ErrorAction SilentlyContinue | Stop-Process -Force
$p = Start-Process -FilePath 'C:\Program Files\Image-Line\FL Studio 2025\FL64.exe' -ArgumentList '/R', '/Ewav', $flp -PassThru
$deadline = (Get-Date).AddSeconds($timeout); $last = -1; $same = 0
while ((Get-Date) -lt $deadline) {
  if ($p.HasExited) { break }
  if (Test-Path $wav) {
    try {
      $fs = [IO.File]::Open($wav, 'Open', 'Read', 'ReadWrite'); $br = New-Object IO.BinaryReader($fs)
      $fs.Seek(4, 'Begin') | Out-Null; $riff = $br.ReadUInt32(); $len = $fs.Length; $fs.Close()
      if ($len -eq $last) { $same++ } else { $same = 0 }; $last = $len
      if ($riff -eq $len - 8 -and $len -gt 1000 -and $same -ge 4) { break }
    } catch {}
  }
  Start-Sleep 2
}
if (-not $p.HasExited) { $p.Kill(); $p.WaitForExit(10000) | Out-Null }
if (Test-Path $wav) { Write-Output "OK $wav" } else { Write-Output "FAILED $flp"; exit 1 }
