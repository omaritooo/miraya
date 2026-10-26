import { existsSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { defineConfig, type Plugin } from 'vite'

const root = fileURLToPath(new URL('.', import.meta.url))

// Every page exists twice, under /en/ and /ar/. Build them all as entry points.
const pages = ['en', 'ar'].flatMap((locale) =>
  readdirSync(`${root}${locale}`, { recursive: true, encoding: 'utf8' })
    .filter((file) => file.endsWith('.html'))
    .map((file) => `${root}${locale}/${file}`),
)

// Serve /en/page like /en/page/, as most static hosts do; Vite alone returns 404.
const directoryIndex: Plugin = {
  name: 'directory-index',
  configureServer(server) {
    server.middlewares.use((req, _res, next) => {
      const path = req.url?.split('?')[0] ?? ''
      if (!path.endsWith('/') && !path.includes('.') && existsSync(`${root}${path}/index.html`)) {
        req.url = `${path}/${req.url?.slice(path.length) ?? ''}`
      }
      next()
    })
  },
}

// /perf/photo.bmp?w=400: a photo-sized image, generated so no binary lives in the repo.
// BMP needs no compression or checksums, and its size is easy to predict: w × 0.75w × 3.
const photo: Plugin = {
  name: 'photo',
  configureServer(server) {
    server.middlewares.use((req, res, next) => {
      const url = new URL(req.url ?? '/', 'http://fixture')
      if (url.pathname !== '/perf/photo.bmp') return next()
      const w = Math.min(1600, Math.max(4, Number(url.searchParams.get('w')) || 100)) & ~3
      const h = (w * 3) / 4
      const pixels = w * h * 3
      const file = Buffer.alloc(54 + pixels)
      file.write('BM', 0, 'ascii')
      file.writeUInt32LE(file.length, 2)
      file.writeUInt32LE(54, 10)
      file.writeUInt32LE(40, 14)
      file.writeInt32LE(w, 18)
      file.writeInt32LE(h, 22)
      file.writeUInt16LE(1, 26)
      file.writeUInt16LE(24, 28)
      file.writeUInt32LE(pixels, 34)
      for (let i = 0; i < pixels; i++) file[54 + i] = (i * 37) % 251
      res.setHeader('Content-Type', 'image/bmp')
      res.end(file)
    })
  },
}

export default defineConfig({
  plugins: [directoryIndex, photo],
  build: { rollupOptions: { input: pages } },
})
