import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { viteSingleFile } from 'vite-plugin-singlefile'

// Builds the report viewer into one HTML file with everything inlined, including the
// fonts, so it opens from disk, a CI artifact or an email with no server (NFR-4).
// core/report.ts fills the miraya-data script with the report at run time.
export default defineConfig({
  root: import.meta.dirname,
  plugins: [react(), viteSingleFile()],
  build: {
    outDir: '../dist/report',
    emptyOutDir: true,
    assetsInlineLimit: Number.MAX_SAFE_INTEGER,
  },
})
