# Dictation benchmark runner (see docs/research/benchmark-plan.md).
# Plays each recording through the speakers while holding an app's dictation shortcut,
# into a text box this script owns, and times when the text arrives.
#
#   pwsh e2e/bench/run.ps1 -Engine vocette-cloud -Keys LCtrl,LShift
#   pwsh e2e/bench/run.ps1 -Engine wispr -Keys LCtrl,LAlt -Only p19
#
# Results: %LOCALAPPDATA%\vocette-bench\results\<engine>.jsonl (one line per passage).
param(
  [Parameter(Mandatory)] [string] $Engine,
  [Parameter(Mandatory)] [string[]] $Keys,
  [string[]] $Only,
  # Part of the output device's name, e.g. 'CS42L43' (laptop speakers) or 'CABLE Input'.
  [string] $Device = 'CS42L43',
  [int] $PreRollMs = 500,
  [int] $TailMs = 300,
  [int] $SettleMs = 2000,
  [int] $TimeoutMs = 40000
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class Kb {
  [DllImport("user32.dll")] static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr extra);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, IntPtr pid);
  [DllImport("kernel32.dll")] static extern uint GetCurrentThreadId();
  [DllImport("user32.dll")] static extern bool AttachThreadInput(uint a, uint b, bool attach);
  [DllImport("user32.dll")] static extern bool BringWindowToTop(IntPtr h);
  public static void Down(byte vk, byte scan) { keybd_event(vk, scan, 0, UIntPtr.Zero); }
  public static void Up(byte vk, byte scan) { keybd_event(vk, scan, 2, UIntPtr.Zero); }
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  // The process that owns the foreground window (its name only, never the window title).
  public static uint ForegroundPid() { uint pid; GetWindowThreadProcessId(GetForegroundWindow(), out pid); return pid; }
  // Joins the foreground window's input queue for a moment so Windows lets us take focus.
  public static bool Front(IntPtr h) {
    uint fg = GetWindowThreadProcessId(GetForegroundWindow(), IntPtr.Zero), me = GetCurrentThreadId();
    if (fg != me) AttachThreadInput(me, fg, true);
    BringWindowToTop(h); SetForegroundWindow(h);
    if (fg != me) AttachThreadInput(me, fg, false);
    return GetForegroundWindow() == h;
  }
}
'@
Add-Type -Path (Join-Path $PSScriptRoot 'WaveOut.cs')

# Virtual-key and scan codes for the shortcut keys we need.
$KeyCodes = @{
  LCtrl  = @(0xA2, 0x1D)
  LShift = @(0xA0, 0x2A)
  LAlt   = @(0xA4, 0x38)
  LWin   = @(0x5B, 0x5B)
}
foreach ($k in $Keys) { if (-not $KeyCodes.ContainsKey($k)) { throw "Unknown key $k" } }

$root = Join-Path $env:LOCALAPPDATA 'vocette-bench'
$audio = Join-Path $root 'audio'
$playDir = Join-Path $root 'play'
$resultsDir = Join-Path $root 'results'
New-Item -ItemType Directory -Force $playDir, $resultsDir | Out-Null
$resultsFile = Join-Path $resultsDir "$Engine.jsonl"

# Where speech ends in a file: the start of its trailing silence, or the file's end.
function Get-SpeechEnd([string] $path) {
  $dur = [double](& ffprobe -v error -show_entries format=duration -of csv=p=0 $path)
  $lines = & ffmpeg -hide_banner -i $path -af 'silencedetect=noise=-38dB:d=0.2' -f null - 2>&1 |
    ForEach-Object { "$_" } | Where-Object { $_ -match 'silence_(start|end)' }
  $lastStart = $null; $lastEnd = $null
  foreach ($l in $lines) {
    if ($l -match 'silence_start: ([\d.]+)') { $lastStart = [double]$Matches[1]; $lastEnd = $null }
    elseif ($l -match 'silence_end: ([\d.]+)') { $lastEnd = [double]$Matches[1] }
  }
  if ($null -ne $lastStart -and ($null -eq $lastEnd -or $lastEnd -ge $dur - 0.05) -and $lastStart -gt 0.5) { return $lastStart }
  return $dur
}

$files = Get-ChildItem (Join-Path $audio 'p*.wav') | Sort-Object Name
if ($Only) { $files = $files | Where-Object { $Only -contains $_.BaseName } }
if (-not $files) { throw "No recordings found in $audio" }

# The window the apps type into.
$form = New-Object System.Windows.Forms.Form
$form.Text = "Vocette benchmark - $Engine"
$form.Width = 900; $form.Height = 320; $form.TopMost = $true
$form.StartPosition = 'CenterScreen'
$box = New-Object System.Windows.Forms.TextBox
$box.Multiline = $true; $box.Dock = 'Fill'; $box.Font = New-Object System.Drawing.Font('Segoe UI', 14)
$form.Controls.Add($box)
$clock = [System.Diagnostics.Stopwatch]::StartNew()
$state = @{ ignore = $false; first = $null; last = $null }
$box.add_TextChanged({ if (-not $state.ignore) { $now = $clock.ElapsedMilliseconds; if ($null -eq $state.first) { $state.first = $now }; $state.last = $now } })
$form.Show()

function Pump([int] $ms) {
  $until = $clock.ElapsedMilliseconds + $ms
  while ($clock.ElapsedMilliseconds -lt $until) { [System.Windows.Forms.Application]::DoEvents(); Start-Sleep -Milliseconds 5 }
}
function Focus-Box {
  [void][Kb]::Front($form.Handle); $form.Activate(); $box.Focus() | Out-Null
  Pump 300
  return ([Kb]::GetForegroundWindow() -eq $form.Handle)
}

$deviceId = [BenchAudio]::Find($Device)
if ($deviceId -lt 0) { throw "No output device matching '$Device'. Found: $([BenchAudio]::Devices() -join '; ')" }
"Playing on: $([BenchAudio]::Devices()[$deviceId])"

foreach ($f in $files) {
  $id = $f.BaseName
  $play = Join-Path $playDir "$id.wav"
  if (-not (Test-Path $play)) { & ffmpeg -v error -y -i $f.FullName -af 'volume=8dB' $play }
  $speechEnd = Get-SpeechEnd $f.FullName

  $state.ignore = $true; $box.Clear(); $state.ignore = $false
  $state.first = $null; $state.last = $null
  if (-not (Focus-Box)) { Write-Warning "$id : could not bring the test window to the front; skipped"; continue }
  Pump 1200

  foreach ($k in $Keys) { [Kb]::Down([byte]$KeyCodes[$k][0], [byte]$KeyCodes[$k][1]) }
  Pump $PreRollMs
  $player = [BenchAudio]::Start($play, $deviceId)
  Pump ([int]($speechEnd * 1000) + $TailMs)
  [array]::Reverse($Keys)
  foreach ($k in $Keys) { [Kb]::Up([byte]$KeyCodes[$k][0], [byte]$KeyCodes[$k][1]) }
  [array]::Reverse($Keys)
  $tRelease = $clock.ElapsedMilliseconds

  # Wait for text, then for it to stop changing. Note any other app that takes the focus.
  $stolenBy = [System.Collections.Generic.List[string]]::new()
  while ($clock.ElapsedMilliseconds - $tRelease -lt $TimeoutMs) {
    Pump 50
    if ([Kb]::GetForegroundWindow() -ne $form.Handle) {
      $name = (Get-Process -Id ([Kb]::ForegroundPid()) -ErrorAction SilentlyContinue).ProcessName
      $mark = "$name@$($clock.ElapsedMilliseconds - $tRelease)ms"
      if (-not ($stolenBy | Where-Object { $_ -like "$name@*" })) { $stolenBy.Add($mark) }
    }
    if ($null -ne $state.last -and $clock.ElapsedMilliseconds - $state.last -ge $SettleMs) { break }
  }
  $player.Dispose()
  Pump 300

  # An app that declines to paste (Vocette's focus check) leaves the text on the clipboard.
  $pasted = $box.Text.Length -gt 0
  $clip = if (-not $pasted) { Get-Clipboard -Raw } else { $null }
  $row = [ordered]@{
    pasted = $pasted
    clipboard = $clip
    focusTakenBy = ($stolenBy -join ', ')
    id = $id; engine = $Engine; at = (Get-Date).ToString('o')
    speechEndSec = [math]::Round($speechEnd, 3)
    firstTextMs = if ($null -ne $state.first) { $state.first - $tRelease } else { $null }
    lastTextMs = if ($null -ne $state.last) { $state.last - $tRelease } else { $null }
    text = $box.Text
  }
  ($row | ConvertTo-Json -Compress) | Add-Content -Path $resultsFile -Encoding utf8
  "{0} first {1} ms, last {2} ms, {3} chars" -f $id, $row.firstTextMs, $row.lastTextMs, $box.Text.Length
  Pump 1500
}
$form.Close()
"Saved to $resultsFile"
