import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'

const shared = fileURLToPath(new URL('./src/shared', import.meta.url))

export default defineConfig({
  main: {
    resolve: { alias: { '@shared': shared } },
    build: { rollupOptions: { external: ['better-sqlite3'] } },
  },
  preload: {
    resolve: { alias: { '@shared': shared } },
  },
  renderer: {
    resolve: { alias: { '@shared': shared } },
    plugins: [react()],
  },
})
