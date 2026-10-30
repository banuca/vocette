// Windows only: a transcript Vocette puts on the clipboard carries the three
// formats that keep it out of clipboard history and cloud sync
// (ExcludeClipboardContentFromMonitorProcessing, and CanIncludeInClipboardHistory
// and CanUploadToCloudClipboard as DWORD 0), read back by Windows PowerShell
// through .NET. Checks a dictation's delivery and a copy from History, and
// that the text reads back exactly, which putting the user's clipboard back
// after a paste relies on.
//
//   node e2e/clipboard-privacy-check.mjs
//
// It uses the real clipboard, briefly: the harness puts back what was there
// when the app closes. The shortcut is off and no window shows, so a
// dictation in the owner's own Vocette cannot start a take here. The take is
// started from the window, so nothing is pasted anywhere.
import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { AUDIO, freshProfile, launchApp, sleep } from './harness.mjs'

let ok = true
const expect = (label, actual, wanted) => {
  const pass = typeof wanted === 'function' ? wanted(actual) : actual === wanted
  if (!pass) ok = false
  console.log(`${pass ? 'ok  ' : 'FAIL'} ${label}: ${JSON.stringify(actual)}`)
}

/** The clipboard as another program sees it: its format names and the two DWORDs. */
function readClipboard() {
  const script = [
    'Add-Type -AssemblyName System.Windows.Forms',
    '$d = [Windows.Forms.Clipboard]::GetDataObject()',
    "$o = [ordered]@{ formats = @($d.GetFormats()); text = [Windows.Forms.Clipboard]::GetText() }",
    "foreach ($n in 'CanIncludeInClipboardHistory', 'CanUploadToCloudClipboard') {",
    '  $s = $d.GetData($n)',
    '  if ($s -is [IO.MemoryStream]) { $o[$n] = [BitConverter]::ToUInt32($s.ToArray(), 0) }',
    '}',
    '$o | ConvertTo-Json -Compress'
  ].join('\n')
  const json = execFileSync('powershell.exe', ['-NoProfile', '-STA', '-Command', script], { encoding: 'utf8' })
  return JSON.parse(json)
}

function expectPrivate(what, clipboard, text) {
  expect(`${what}: the text reads back exactly`, clipboard.text, text)
  for (const format of ['ExcludeClipboardContentFromMonitorProcessing', 'CanIncludeInClipboardHistory', 'CanUploadToCloudClipboard']) {
    expect(`${what}: ${format} present`, clipboard.formats.includes(format), true)
  }
  expect(`${what}: CanIncludeInClipboardHistory is 0`, clipboard.CanIncludeInClipboardHistory, 0)
  expect(`${what}: CanUploadToCloudClipboard is 0`, clipboard.CanUploadToCloudClipboard, 0)
}

if (process.platform !== 'win32') {
  console.log('Windows only.')
  process.exit(0)
}

const profileDir = freshProfile('clipboard-privacy')
writeFileSync(
  join(profileDir, 'settings.json'),
  JSON.stringify({
    engine: 'local',
    hotkeyEnabled: false,
    autoPaste: false,
    playSounds: false,
    restingPill: false,
    launchAtLogin: false,
    welcomeAnswered: true
  })
)
const { app, main } = await launchApp({
  profileDir,
  audioFile: `${AUDIO}%noloop`,
  extraArgs: ['--background'],
  env: { MURMUR_MODELS_DIR: join(process.env.LOCALAPPDATA, 'vocette-bench', 'app-models') }
})
try {
  await app.evaluate(({ BrowserWindow, Tray }) => {
    for (const window of BrowserWindow.getAllWindows()) {
      window.hide()
      window.show = () => undefined
      window.showInactive = () => undefined
      window.focus = () => undefined
    }
    Tray.prototype.setImage = () => undefined
  })
  await main.waitForSelector('.app-shell', { timeout: 30_000 })
  await main.evaluate(() => {
    window.__s = []
    window.murmur.onWorkflowStatus((s) => window.__s.push(s))
  })

  await main.evaluate(() => window.murmur.startRecording())
  await sleep(4000)
  await main.evaluate(() => window.murmur.stopRecording())
  let done = null
  for (let i = 0; i < 600 && !done; i += 1) {
    done = (await main.evaluate(() => window.__s)).findLast((s) => ['success', 'error', 'cancelled'].includes(s.phase))
    if (!done) await sleep(100)
  }
  expect('dictation delivered to the clipboard', done?.phase, 'success')
  const said = (await main.evaluate(() => window.murmur.getHistory()))[0]?.text ?? ''
  expectPrivate('dictation', readClipboard(), said)
  // What the app itself reads back: the paste's clipboard restore compares
  // this with the transcript before putting the user's clipboard back.
  expect('dictation: Electron reads the same text', await app.evaluate(({ clipboard }) => clipboard.readText()), said)

  const copied = 'Copied from History, line one.\nLine two: Zürich, 😀.'
  await main.evaluate((text) => window.murmur.copyText(text), copied)
  expectPrivate('copy from History', readClipboard(), copied)
} finally {
  await app.close()
}
console.log(ok ? 'PASS' : 'FAIL')
process.exitCode = ok ? 0 : 1
