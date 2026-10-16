# Decodes all 20 original recordings with the on-device model, bypassing the app, and
# writes them as a results file the scorer reads ("local-direct").
#   pwsh e2e/bench/local-direct.ps1 [-Method greedy_search]
param([string] $Method = 'greedy_search')
$ErrorActionPreference = 'Stop'
$bench = Join-Path $env:LOCALAPPDATA 'vocette-bench'
$a16 = Join-Path $bench 'audio16'
New-Item -ItemType Directory -Force $a16 | Out-Null
$files = foreach ($i in 1..20) {
  $id = 'p{0:D2}' -f $i
  $dst = Join-Path $a16 "$id.wav"
  if (-not (Test-Path $dst)) { & ffmpeg -v error -y -i (Join-Path $bench "audio\$id.wav") -ar 16000 -ac 1 -c:a pcm_s16le $dst }
  $dst
}
$lines = & node (Join-Path $PSScriptRoot 'local-direct.cjs') $Method @files
$out = Join-Path $bench 'results\local-direct.jsonl'
Set-Content -Path $out -Value $null
foreach ($line in $lines) {
  $sep = $line.IndexOf('.wav:')
  if ($sep -lt 0) { continue }
  $row = [ordered]@{ id = $line.Substring(0, $sep); engine = 'local-direct'; pasted = $true; firstTextMs = 0; text = $line.Substring($sep + 5).Trim() }
  ($row | ConvertTo-Json -Compress) | Add-Content -Path $out -Encoding utf8
}
"Wrote $out"
