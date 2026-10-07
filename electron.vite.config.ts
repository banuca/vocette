import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import type { Plugin } from 'vite'

/**
 * The production CSP has `connect-src 'none'` (renderers never touch the
 * network). In development that same CSP blocks Vite's HMR websocket, so hot
 * reload silently died on `npm run dev`. The dev server also injects imported
 * stylesheets as inline `<style>` elements, which `style-src 'self'` refuses,
 * so the window rendered unstyled under `npm run dev`. This plugin relaxes
 * both for the dev server only; built pages keep the strict policy.
 */
function devCspAllowHmr(): Plugin {
  let serving = false
  return {
    name: 'murmur-dev-csp',
    configResolved(config) {
      serving = config.command === 'serve'
    },
    transformIndexHtml(html) {
      if (!serving) return html
      return html
        .replace("connect-src 'none'", "connect-src 'self' ws://localhost:* ws://127.0.0.1:*")
        .replace("style-src 'self'", "style-src 'self' 'unsafe-inline'")
    }
  }
}

export default defineConfig({
  main: {
    // Dependencies stay `require()`s in the output, so the speech addon is
    // loaded from node_modules (unpacked from the asar) rather than bundled.
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/main/index.ts'),
          // The on-device speech engine runs as its own utility process,
          // forked from out/main/engine-worker.js.
          'engine-worker': resolve(__dirname, 'src/main/engine/worker.ts')
        }
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
