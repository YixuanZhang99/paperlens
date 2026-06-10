import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'

const shared = fileURLToPath(new URL('./src/shared', import.meta.url))

export default defineConfig({
  main: {
    resolve: { alias: { '@shared': shared } },
    // pdfjs-dist 必须外部化：打包进 bundle 后其运行时按相对路径找 pdf.worker.mjs 会失败
    // （fake worker setup）。外部化后从 node_modules 真实加载（生产依赖，会进安装包）。
    build: { rollupOptions: { external: ['better-sqlite3', 'pdfjs-dist', /^pdfjs-dist\//] } },
  },
  preload: {
    resolve: { alias: { '@shared': shared } },
  },
  renderer: {
    resolve: { alias: { '@shared': shared } },
    plugins: [react()],
  },
})
