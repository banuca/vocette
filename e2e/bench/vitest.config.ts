import { defineConfig } from 'vitest/config'

// Bench checks that touch the network; never part of `npm test`.
export default defineConfig({
  test: {
    root: '.',
    include: ['e2e/bench/**/*.test.ts'],
    environment: 'node'
  }
})
