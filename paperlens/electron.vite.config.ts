import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: { build: { rollupOptions: { external: ['better-sqlite3'] } } },
  preload: {},
  renderer: { plugins: [react()] },
})
