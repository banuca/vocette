# Changes one or more settings in the benchmark profile (never the owner's real one).
#   pwsh e2e/bench/set-profile.ps1 -Set @{ model = 'gpt-4o-transcribe'; engine = 'cloud' }
# Stop the development app first (dev-app.ps1 does it); it rewrites settings on exit.
param([Parameter(Mandatory)] [hashtable] $Set)
$ErrorActionPreference = 'Stop'
$file = Join-Path $env:LOCALAPPDATA 'vocette-bench\profile\settings.json'
# Edited as text-level JSON through Node, so dates and nested values keep their exact form.
$json = ($Set | ConvertTo-Json -Compress)
node -e "const fs=require('fs');const f=process.argv[1];const s=JSON.parse(fs.readFileSync(f,'utf8'));Object.assign(s,JSON.parse(process.argv[2]));fs.writeFileSync(f,JSON.stringify(s,null,2));console.log('profile:',Object.keys(JSON.parse(process.argv[2])).map(k=>k+'='+JSON.stringify(s[k])).join(' '))" $file $json
