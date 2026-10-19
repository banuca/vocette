# Starts the development build (out/, after `npm run build`) on the benchmark profile,
# in place of the installed Vocette, which would answer the same shortcut.
#   pwsh e2e/bench/dev-app.ps1            start it (stops the installed app first)
#   pwsh e2e/bench/dev-app.ps1 -Restore   stop it and start the installed app again
param([switch] $Restore, [string] $DumpDir)
$ErrorActionPreference = 'Stop'
$repo = Resolve-Path (Join-Path $PSScriptRoot '..\..')
$bench = Join-Path $env:LOCALAPPDATA 'vocette-bench'
$installed = Join-Path $env:LOCALAPPDATA 'Programs\Vocette\Vocette.exe'
$electron = Join-Path $repo 'node_modules\electron\dist\electron.exe'

# Every app process runs as Vocette.exe (installed) or electron.exe (this repo's build).
Get-Process Vocette -ErrorAction SilentlyContinue | Stop-Process
Get-Process electron -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $electron } | Stop-Process
Start-Sleep -Seconds 2

if ($Restore) {
  Start-Process $installed
  'Installed Vocette started again.'
  return
}

$env:MURMUR_PROFILE_DIR = Join-Path $bench 'profile'
# Its own models folder, so the bench never mixes its model with the installed app's.
$env:MURMUR_MODELS_DIR = Join-Path $bench 'app-models'
if ($DumpDir) { $env:MURMUR_DEBUG_AUDIO_DIR = $DumpDir } else { Remove-Item Env:MURMUR_DEBUG_AUDIO_DIR -ErrorAction SilentlyContinue }
Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
Start-Process $electron -ArgumentList "`"$repo`"" -WorkingDirectory $repo
Start-Sleep -Seconds 8
"Development build running on $env:MURMUR_PROFILE_DIR" + $(if ($DumpDir) { ", saving takes to $DumpDir" } else { '' })
