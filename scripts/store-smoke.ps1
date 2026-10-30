<#
.SYNOPSIS
  Proves the Microsoft Store package installs, starts and transcribes.

.DESCRIPTION
  For GitHub Actions runners only: it trusts a throwaway certificate for the
  whole machine, which nobody should do on their own PC. The Store signs the
  real package; this signs a test copy so that Windows will install it.

  1. Signs the .appx with a new self-signed certificate whose subject is the
     manifest's Publisher, trusted in LocalMachine\TrustedPeople.
  2. Installs it with Add-AppxPackage.
  3. Starts it the way the Start menu does (shell:AppsFolder\<family>!Vocette)
     and checks that it runs from the package, keeps its data in the package's
     private AppData, switches its startup task with its setting, and hands a
     second launch over to the first.
  4. Runs the on-device engine through the package's `vocette` alias, the
     supported way to run a packaged executable with arguments, after copying
     the model to where the app's download puts it.
  5. Uninstalls, and checks that the package's data, model included, went too.

  Run from the repository root after `npm run pack:store`:
    ./scripts/store-smoke.ps1 -Package (Get-Item dist/*.appx).FullName
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory)] [string] $Package,
  [string] $AppId = 'Vocette',
  # Must match resources/appx-manifest.xml and src/main/platform/startup-task.ts.
  [string] $TaskId = 'VocetteStartup'
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 3

if ($env:GITHUB_ACTIONS -ne 'true') {
  throw 'store-smoke.ps1 trusts a new certificate machine-wide, so it only runs on CI runners.'
}

function Step([string] $Text) { Write-Host "`n== $Text" }
function Ok([string] $Text) { Write-Host "ok    $Text" }
function Fail([string] $Text) { throw "FAIL  $Text" }

function Wait-Until([scriptblock] $Condition, [int] $Seconds, [string] $What) {
  $deadline = (Get-Date).AddSeconds($Seconds)
  do {
    $value = & $Condition
    if ($value) { return $value }
    Start-Sleep -Milliseconds 500
  } while ((Get-Date) -lt $deadline)
  Fail "waited $Seconds s for $What"
}

# --- The identity, as the package's own manifest declares it ---------------
Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip = [System.IO.Compression.ZipFile]::OpenRead($Package)
try {
  $entry = $zip.Entries | Where-Object FullName -eq 'AppxManifest.xml'
  $reader = New-Object System.IO.StreamReader($entry.Open())
  [xml] $manifest = $reader.ReadToEnd()
  $reader.Close()
} finally {
  $zip.Dispose()
}
$name = $manifest.Package.Identity.Name
$publisher = $manifest.Package.Identity.Publisher
Ok "package $name $($manifest.Package.Identity.Version), publisher $publisher"
Ok "on $((Get-CimInstance Win32_OperatingSystem).Caption) $([Environment]::OSVersion.Version)"

$modelId = ([regex] "id: '([^']+)'").Match((Get-Content 'src/shared/speech-model.ts' -Raw)).Groups[1].Value
if (-not $modelId) { Fail 'could not read the model id from src/shared/speech-model.ts' }

$certificate = $null
$installed = $null
try {
  # --- 1. Sign ---------------------------------------------------------------
  Step 'Sign the package with a throwaway certificate'
  # As https://learn.microsoft.com/windows/msix/package/create-certificate-package-signing
  $certificate = New-SelfSignedCertificate -Type Custom -KeyUsage DigitalSignature `
    -CertStoreLocation 'Cert:\CurrentUser\My' -Subject $publisher -FriendlyName 'Vocette CI throwaway' `
    -TextExtension @('2.5.29.37={text}1.3.6.1.5.5.7.3.3', '2.5.29.19={text}')
  $cer = Join-Path $env:RUNNER_TEMP 'vocette-ci.cer'
  Export-Certificate -Cert $certificate -FilePath $cer | Out-Null
  Import-Certificate -FilePath $cer -CertStoreLocation 'Cert:\LocalMachine\TrustedPeople' | Out-Null
  $signtool = Get-ChildItem "${env:ProgramFiles(x86)}\Windows Kits\10\bin\*\x64\signtool.exe" |
    Sort-Object { [version] $_.Directory.Parent.Name } -Descending | Select-Object -First 1
  & $signtool.FullName sign /fd SHA256 /sha1 $certificate.Thumbprint /s My $Package
  if ($LASTEXITCODE -ne 0) { Fail "signtool exited with $LASTEXITCODE" }
  Ok "signed with $($signtool.FullName)"

  # --- 2. Install ------------------------------------------------------------
  Step 'Install it'
  Add-AppxPackage -Path $Package
  $installed = Get-AppxPackage -Name $name
  if (-not $installed) { Fail 'Get-AppxPackage does not list the package' }
  $family = $installed.PackageFamilyName
  $location = $installed.InstallLocation
  $exe = Join-Path $location 'app\Vocette.exe'
  $cache = Join-Path $env:LOCALAPPDATA "Packages\$family\LocalCache"
  $aumid = "$family!$AppId"
  Ok "installed $($installed.PackageFullName) in $location"

  function Get-AppProcesses {
    @(Get-CimInstance Win32_Process -Filter "Name = 'Vocette.exe'" | Where-Object { $_.ExecutablePath -eq $exe })
  }
  # Electron's helpers (GPU, renderers, the speech engine) carry --type=.
  function Get-MainProcesses {
    @(Get-AppProcesses | Where-Object { $_.CommandLine -notmatch '--type=' })
  }
  function Stop-App {
    Get-AppProcesses | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
    Wait-Until { @(Get-AppProcesses).Count -eq 0 } 30 'Vocette to exit' | Out-Null
  }
  $taskRoot = "HKCU:\Software\Classes\Local Settings\Software\Microsoft\Windows\CurrentVersion\AppModel\SystemAppData\$family"
  function Get-TaskState {
    try { (Get-ItemProperty -Path "$taskRoot\$TaskId" -Name State -ErrorAction Stop).State } catch { $null }
  }
  function Wait-TaskState([int] $Expected, [string] $Meaning) {
    $deadline = (Get-Date).AddSeconds(30)
    while ((Get-TaskState) -ne $Expected -and (Get-Date) -lt $deadline) { Start-Sleep -Milliseconds 500 }
    if ((Get-TaskState) -ne $Expected) {
      Get-ChildItem $taskRoot -Recurse -ErrorAction SilentlyContinue | ForEach-Object {
        Write-Host $_.Name
        $_ | Get-ItemProperty | Format-List | Out-String | Write-Host
      }
      Fail "the startup task's state is '$(Get-TaskState)', not $Expected ($Meaning)"
    }
  }

  # --- 3. Start it, as the Start menu does ------------------------------------
  Step 'Start it as the Start menu does'
  Start-Process "shell:AppsFolder\$aumid"
  $main = @(Wait-Until { Get-MainProcesses } 60 'Vocette to start from the package')
  Ok "running from the package: $exe (pid $($main[0].ProcessId))"

  $settings = Join-Path $cache 'Roaming\Murmur\settings.json'
  Wait-Until { Test-Path $settings } 60 "settings.json in the package's private AppData" | Out-Null
  if (Test-Path (Join-Path $env:APPDATA 'Murmur\settings.json')) { Fail 'settings.json went to the real AppData' }
  Ok "its data is in the package's private AppData: $settings"

  $diagnostics = Join-Path $cache 'Roaming\Murmur\diagnostics.json'
  Wait-Until { (Test-Path $diagnostics) -and ((Get-Content $diagnostics -Raw) -match '"kind":\s*"startup"') } 60 `
    'the startup event in diagnostics.json' | Out-Null
  Ok 'it finished starting: diagnostics.json has its startup event'
  Start-Sleep -Seconds 5
  if (@(Get-MainProcesses).Count -ne 1) { Fail 'Vocette did not keep running' }
  Ok 'still running 5 s later'

  Step 'Start with Windows goes through the startup task'
  # A new profile starts with Windows switched on, so the app enables the task.
  Wait-TaskState 2 'enabled'
  Ok "the startup task $TaskId is enabled"

  Step 'A second start hands over to the first'
  $first = @(Get-MainProcesses)[0].ProcessId
  Start-Process "shell:AppsFolder\$aumid"
  Start-Sleep -Seconds 10
  $mains = @(Get-MainProcesses)
  if ($mains.Count -ne 1 -or $mains[0].ProcessId -ne $first) {
    Fail "expected only the first Vocette ($first), found: $(($mains | ForEach-Object ProcessId) -join ', ')"
  }
  Ok 'still one Vocette: the single-instance lock holds inside the package'

  Step 'Switching the setting off switches the startup task off'
  Stop-App
  node -e "const fs = require('fs'); const f = process.argv[1]; const s = JSON.parse(fs.readFileSync(f, 'utf8')); s.launchAtLogin = false; fs.writeFileSync(f, JSON.stringify(s, null, 2))" $settings
  if ($LASTEXITCODE -ne 0) { Fail 'could not edit settings.json' }
  Start-Process "shell:AppsFolder\$aumid"
  Wait-Until { Get-MainProcesses } 60 'Vocette to start again' | Out-Null
  Wait-TaskState 0 'disabled'
  Ok "the startup task $TaskId is disabled"
  Stop-App

  # --- 4. The on-device engine, inside the package ----------------------------
  Step 'The on-device engine transcribes inside the package'
  $alias = Join-Path $env:LOCALAPPDATA 'Microsoft\WindowsApps\vocette.exe'
  if (-not (Test-Path $alias)) { Fail "the package's alias is missing: $alias" }
  $env:VOCETTE_SMOKE_EXE = $alias
  $env:VOCETTE_SMOKE_RESOURCES = Join-Path $location 'app\resources'
  # Where the app's own download goes; inside the package it is redirected.
  $env:VOCETTE_SMOKE_STAGE_TO = Join-Path $env:LOCALAPPDATA "Murmur\models\$modelId"
  $env:VOCETTE_SMOKE_PACKAGE = $name
  node scripts/engine-smoke.mjs
  if ($LASTEXITCODE -ne 0) { Fail 'the engine did not transcribe inside the package' }
  $private = Join-Path $cache "Local\Murmur\models\$modelId\encoder.int8.onnx"
  if (-not (Test-Path $private)) { Fail "the model is not in the package's private AppData: $private" }
  if (Test-Path (Join-Path $env:LOCALAPPDATA "Murmur\models\$modelId")) { Fail 'the model went to the real AppData' }
  Ok "the model the package wrote is in its private AppData ($([math]::Round((Get-Item $private).Length / 1MB)) MB encoder)"

  # --- 5. Uninstall ------------------------------------------------------------
  Step 'Uninstall'
  Remove-AppxPackage -Package $installed.PackageFullName
  $installed = $null
  if (Get-AppxPackage -Name $name) { Fail 'still installed after Remove-AppxPackage' }
  Wait-Until { -not (Test-Path (Join-Path $env:LOCALAPPDATA "Packages\$family")) } 60 `
    "the package's private AppData to be removed" | Out-Null
  if (Test-Path $alias) { Fail 'the alias outlived the package' }
  Ok 'uninstalling removed the app and all its data, the model included'

  Write-Host "`nThe Store package installs, starts, transcribes and uninstalls cleanly."
} catch {
  Write-Host $_
  if ($installed) {
    Write-Host "`n-- The package's private AppData:"
    Get-ChildItem (Join-Path $env:LOCALAPPDATA "Packages\$($installed.PackageFamilyName)") -Recurse -Depth 4 -ErrorAction SilentlyContinue |
      Select-Object -First 80 | ForEach-Object { Write-Host $_.FullName }
    Write-Host "`n-- Recent deployment events:"
    Get-WinEvent -LogName 'Microsoft-Windows-AppXDeploymentServer/Operational' -MaxEvents 15 -ErrorAction SilentlyContinue |
      Where-Object LevelDisplayName -ne 'Information' | Format-List TimeCreated, Message | Out-String | Write-Host
  }
  exit 1
} finally {
  Get-CimInstance Win32_Process -Filter "Name = 'Vocette.exe'" -ErrorAction SilentlyContinue |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
  if ($installed) { Remove-AppxPackage -Package $installed.PackageFullName -ErrorAction SilentlyContinue }
  if ($certificate) {
    Get-ChildItem 'Cert:\LocalMachine\TrustedPeople' | Where-Object Thumbprint -eq $certificate.Thumbprint | Remove-Item
    Remove-Item "Cert:\CurrentUser\My\$($certificate.Thumbprint)" -ErrorAction SilentlyContinue
  }
}
