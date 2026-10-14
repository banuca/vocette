// K11 in the built app: point at the resting pill and it fades; move away and
// it comes back. Moves the real mouse pointer with PowerShell (Windows only),
// and puts it back where it was at the end.
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import { mkdirSync } from 'node:fs'
import { findWindow, freshProfile, launchApp, sleep, WORK } from './harness.mjs'

const shots = join(WORK, 'peek')
mkdirSync(shots, { recursive: true })

const ps = (script) =>
  execFileSync('powershell.exe', ['-NoProfile', '-Command', `Add-Type -AssemblyName System.Windows.Forms; ${script}`], {
    encoding: 'utf8'
  }).trim()
const cursor = () => ps('$p=[System.Windows.Forms.Cursor]::Position; "$($p.X),$($p.Y)"').split(',').map(Number)
// Physical pixels for the cursor; the overlay's bounds are in DIPs, so scale by the display's factor.
const moveTo = (x, y) => ps(`[System.Windows.Forms.Cursor]::Position = New-Object System.Drawing.Point(${x}, ${y})`)

const home = cursor()
const { app, main } = await launchApp({ profileDir: freshProfile('peek'), extraArgs: ['--background'] })
try {
  await main.waitForSelector('.app-shell', { timeout: 20_000 })
  const overlay = await findWindow(app, 'overlay.html')
  await sleep(1500)
  const { bounds, scale } = await app.evaluate(({ BrowserWindow, screen }) => {
    const win = BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().includes('overlay.html'))
    const b = win.getBounds()
    return { bounds: b, scale: screen.getDisplayMatching(b).scaleFactor }
  })
  const state = () =>
    overlay.evaluate(() => ({
      peek: document.documentElement.classList.contains('peek'),
      bodyOpacity: Number(getComputedStyle(document.body).opacity).toFixed(2),
      pill: (() => {
        const r = document.querySelector('#overlay').getBoundingClientRect()
        return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) }
      })()
    }))
  const before = await state()
  console.log('overlay window (DIP):', JSON.stringify(bounds), 'scale', scale)
  console.log('resting, pointer away:', JSON.stringify(before))

  // The pill's centre on screen, in physical pixels for the cursor.
  const cx = Math.round((bounds.x + before.pill.x + before.pill.w / 2) * scale)
  const cy = Math.round((bounds.y + before.pill.y + before.pill.h / 2) * scale)
  moveTo(cx, cy)
  await sleep(500)
  const over = await state()
  console.log('pointer on the pill:', JSON.stringify(over))

  // In the window but beside the pill: no fade.
  moveTo(Math.round((bounds.x + 20) * scale), cy)
  await sleep(500)
  const beside = await state()
  console.log('pointer beside it, still in the window:', JSON.stringify(beside))

  moveTo(cx, Math.round((bounds.y - 200) * scale))
  await sleep(500)
  const away = await state()
  console.log('pointer gone again:', JSON.stringify(away))

  const ok = !before.peek && over.peek && over.bodyOpacity === '0.12' && !beside.peek && !away.peek && away.bodyOpacity === '1.00'
  console.log(ok ? 'PASS' : 'FAIL')
} finally {
  moveTo(home[0], home[1])
  await app.close()
}
