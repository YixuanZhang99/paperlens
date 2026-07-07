import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: 'node',
    setupFiles: ['./tests/setup.ts'],
    environmentMatchGlobs: [['tests/renderer/**', 'jsdom']],
  },
  resolve: { alias: { '@shared': new URL('./src/shared', import.meta.url).pathname } },
})
