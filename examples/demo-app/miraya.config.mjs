// The demo app's Miraya config. CI serves the app on port 4400 and runs `miraya audit`.
export default {
  baseUrl: 'http://localhost:4400',
  routes: ['/'],
  locale: { strategy: 'path-prefix', ltr: '/en', rtl: '/ar' },
  fonts: { arabic: ['IBM Plex Sans Arabic'], latin: ['IBM Plex Sans Arabic'] },
  allow: { latinText: ['Miraya'] },
}
