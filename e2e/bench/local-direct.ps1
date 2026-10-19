# Decodes all 20 original recordings with the on-device model, bypassing the app, and
# writes them as a results file the scorer reads ("local-direct", or "local-direct-fp32" or "-fp16").
#   pwsh e2e/bench/local-direct.ps1 [-Method greedy_search] [-Model int8|fp32|fp16]
param([string] $Method = 'greedy_search', [ValidateSet('int8', 'fp32', 'fp16')] [string] $Model = 'int8')
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
$env:BENCH_MODEL = $Model
$lines = & node (Join-Path $PSScriptRoot 'local-direct.cjs') $Method @files
$engine = if ($Model -eq 'int8') { 'local-direct' } else { "local-direct-$Model" }
$out = Join-Path $bench "results\$engine.jsonl"
Set-Content -Path $out -Value $null
foreach ($line in $lines) {
  # "p01.wav 812ms 6.4s: text"
  if ($line -notmatch '^(p\d\d)\.wav (\d+)ms ([\d.]+)s: ?(.*)$') { continue }
  $row = [ordered]@{ id = $Matches[1]; engine = $engine; pasted = $true; firstTextMs = [int]$Matches[2]; audioSec = [double]$Matches[3]; text = $Matches[4].Trim() }
  ($row | ConvertTo-Json -Compress) | Add-Content -Path $out -Encoding utf8
}
"Wrote $out"
