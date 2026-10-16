# Speed A/B: the same passages on Wispr Flow then Vocette, back to back, so both see the
# same network. Prints each engine's median wait.
#   pwsh e2e/bench/ab.ps1 [-First 11] [-Last 20]
param([int] $First = 11, [int] $Last = 20)
$ErrorActionPreference = 'Stop'
$results = Join-Path $env:LOCALAPPDATA 'vocette-bench\results'
$ids = $First..$Last | ForEach-Object { 'p{0:D2}' -f $_ }
$runs = @(@{ name = 'ab-wispr'; keys = @('LCtrl', 'LAlt') }, @{ name = 'ab-vocette'; keys = @('LCtrl', 'LShift') })
foreach ($run in $runs) {
  $file = Join-Path $results "$($run.name).jsonl"
  if (Test-Path $file) { Remove-Item $file }
  & (Join-Path $PSScriptRoot 'run.ps1') -Engine $run.name -Keys $run.keys -Only $ids -Device 'CABLE Input' -TimeoutMs 15000 | Out-Null
}
foreach ($run in $runs) {
  $waits = Get-Content (Join-Path $results "$($run.name).jsonl") | ConvertFrom-Json |
    Where-Object { $_.firstTextMs } | ForEach-Object { [int]$_.firstTextMs } | Sort-Object
  $mid = $waits[[math]::Floor(($waits.Count - 1) / 2)]
  '{0}: n={1} median={2} ms  each={3}' -f $run.name, $waits.Count, $mid, ($waits -join ',')
}
