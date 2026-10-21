import { defineConfig } from '../src'

// Hadeed keeps the locale in a cookie (Nuxt i18n, strategy: no_prefix). Pages other
// than /login need a signed-in session: save one with Playwright's storageState and
// pass its path in HADEED_STORAGE_STATE.
// Run from packages/miraya after `pnpm build`:
//   HADEED_URL=http://localhost:3998 node dist/cli.js audit -c dev/hadeed.config.ts
export default defineConfig({
  baseUrl: process.env.HADEED_URL ?? 'http://localhost:3000',
  routes: process.env.HADEED_STORAGE_STATE
    ? ['/', '/workouts', '/nutrition', '/stats', '/profile']
    : ['/login'],
  locale: { strategy: 'cookie', name: 'i18n_locale', ltr: 'en', rtl: 'ar' },
  auth: {
    ...(process.env.HADEED_STORAGE_STATE ? { storageState: process.env.HADEED_STORAGE_STATE } : {}),
    loginUrlPattern: '/login',
  },
  allow: { latinText: ['Hadeed'] },
})
