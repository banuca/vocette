import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import type { Plugin } from 'vite'

/**
 * The production CSP has `connect-src 'none'` (renderers never touch the
 * network). In development that same CSP blocks Vite's HMR websocket, so hot
 * reload silently died on `npm run dev`. This plugin relaxes connect-src for
 * the dev server only; built pages keep the strict policy.
 */
function devCspAllowHmr(): Plugin {
  let serving = false
  return {
    name: 'voice-hotkey-dev-csp',
    configResolved(config) {
      serving = config.command === 'serve'
    },
    transformIndexHtml(html) {
      if (!serving) return html
      return html.replace(
        "connect-src 'none'",
        "connect-src 'self' ws://localhost:* ws://127.0.0.1:*"
      )
    }
  }
}

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/main/index.ts') }
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/preload/index.ts'),
          recorder: resolve(__dirname, 'src/preload/recorder.ts')
        }
      }
    }
  },
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    plugins: [devCspAllowHmr()],
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/renderer/index.html'),
          overlay: resolve(__dirname, 'src/renderer/overlay.html'),
          recorder: resolve(__dirname, 'src/renderer/recorder.html')
        }
      }
    }
  }
})
