import { defineConfig } from '@playwright/test'

const port = 4319

export default defineConfig({
  testDir: 'tests',
  timeout: 60_000,
  use: { baseURL: `http://localhost:${port}` },
  webServer: {
    command: `pnpm exec vite --port ${port} --strictPort`,
    cwd: '../../fixtures/site',
    url: `http://localhost:${port}/en/`,
    reuseExistingServer: !process.env.CI,
  },
})
