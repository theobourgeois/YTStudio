$jobs = Get-Content C:\Users\goali\flrender\out\jobs.txt | Where-Object { $_ }
$i = 0
foreach ($j in $jobs) {
  $i++; $wav = [IO.Path]::ChangeExtension($j, '.wav')
  if ((Test-Path $wav) -and ((Get-Item $wav).Length -gt 1000)) { continue }
  $t0 = Get-Date; $r = & C:\Users\goali\flrender\tools\render.ps1 -flp $j
  "$i/$($jobs.Count) $r $([int]((Get-Date) - $t0).TotalSeconds)s"
}
"DONE"
