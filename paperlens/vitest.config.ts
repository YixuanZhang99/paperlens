import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    setupFiles: [],
    environmentMatchGlobs: [['tests/renderer/**', 'jsdom']],
  },
  resolve: { alias: { '@shared': new URL('./src/shared', import.meta.url).pathname } },
})
