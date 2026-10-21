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

export default defineConfig({
  plugins: [directoryIndex],
  build: { rollupOptions: { input: pages } },
})
