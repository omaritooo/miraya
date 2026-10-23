import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseConfig } from '../src/core/config'
import { detectProject, renderConfig } from '../src/core/init'

function project(files: Record<string, unknown>) {
  const dir = mkdtempSync(join(tmpdir(), 'miraya-init-'))
  for (const [path, data] of Object.entries(files)) {
    mkdirSync(join(dir, path, '..'), { recursive: true })
    writeFileSync(join(dir, path), typeof data === 'string' ? data : JSON.stringify(data))
  }
  return dir
}

/** Evaluates the object literal the way a config file would. */
function renderedInput(text: string) {
  const body = text.slice(
    text.indexOf('defineConfig({') + 'defineConfig('.length,
    text.lastIndexOf(')'),
  )
  return new Function(`return (${body})`)() as Record<string, unknown>
}

describe('detectProject', () => {
  it('reads a next-intl app: routes under [locale], path prefixes, translation files', () => {
    const dir = project({
      'package.json': {
        scripts: { dev: 'next dev -p 4000' },
        dependencies: { next: '15', 'next-intl': '4' },
      },
      'tsconfig.json': '{}',
      'app/[locale]/page.tsx': '',
      'app/[locale]/pricing/page.tsx': '',
      'app/[locale]/(shop)/cart/page.tsx': '',
      'app/[locale]/products/[id]/page.tsx': '',
      'app/[locale]/layout.tsx': '',
      'messages/en.json': {},
      'messages/ar.json': {},
    })
    const d = detectProject(dir)
    expect(d).toMatchObject({
      baseUrl: 'http://localhost:4000',
      locale: { strategy: 'path-prefix', ltr: '/en', rtl: '/ar' },
      routes: ['/', '/cart', '/pricing'],
      dynamicRoutes: ['/products/[id]'],
      locales: { ltr: './messages/en.json', rtl: './messages/ar.json' },
      typescript: true,
      server: { command: 'npm run dev' },
    })
  })

  it('starts the app with the package manager its lockfile names', () => {
    const dir = project({
      'package.json': { scripts: { start: 'vite' }, devDependencies: { vite: '7' } },
      'pnpm-lock.yaml': '',
    })
    const d = detectProject(dir)
    expect(d.server).toEqual({ command: 'pnpm run start' })
    expect(parseConfig(renderedInput(renderConfig(d))).server?.command).toBe('pnpm run start')
  })

  it('leaves out the server when there is no script to start the app', () => {
    expect(detectProject(project({ 'package.json': {} })).server).toBeUndefined()
  })

  it('reads a Nuxt app with a no_prefix cookie and folders of translations', () => {
    const dir = project({
      'package.json': { devDependencies: { nuxt: '4', '@nuxtjs/i18n': '9' } },
      'nuxt.config.ts':
        "export default { i18n: { strategy: 'no_prefix', detectBrowserLanguage: { cookieKey: 'lang' } } }",
      'pages/index.vue': '',
      'pages/login.vue': '',
      'pages/users/[id].vue': '',
      'i18n/locales/en-US/common.json': {},
      'i18n/locales/ar-EG/common.json': {},
    })
    const d = detectProject(dir)
    expect(d).toMatchObject({
      baseUrl: 'http://localhost:3000',
      locale: { strategy: 'cookie', name: 'lang', ltr: 'en-US', rtl: 'ar-EG' },
      routes: ['/', '/login'],
      dynamicRoutes: ['/users/[id]'],
      locales: { ltr: './i18n/locales/en-US', rtl: './i18n/locales/ar-EG' },
      typescript: false,
    })
  })

  it("uses Nuxt i18n's default strategy: English without a prefix", () => {
    const dir = project({
      'package.json': { dependencies: { nuxt: '4', '@nuxtjs/i18n': '9' } },
      'pages/index.vue': '',
    })
    expect(detectProject(dir).locale).toEqual({ strategy: 'path-prefix', ltr: '', rtl: '/ar' })
  })

  it('reads SvelteKit routes and skips groups', () => {
    const dir = project({
      'package.json': { devDependencies: { '@sveltejs/kit': '2', vite: '7' } },
      'src/routes/+page.svelte': '',
      'src/routes/(marketing)/about/+page.svelte': '',
      'src/routes/blog/[slug]/+page.svelte': '',
      'src/routes/+layout.svelte': '',
    })
    const d = detectProject(dir)
    expect(d.routes).toEqual(['/', '/about'])
    expect(d.dynamicRoutes).toEqual(['/blog/[slug]'])
    expect(d.baseUrl).toBe('http://localhost:5173')
  })

  it('skips Next pages-router internals and API routes', () => {
    const dir = project({
      'package.json': { dependencies: { next: '15' } },
      'pages/index.tsx': '',
      'pages/about.tsx': '',
      'pages/_app.tsx': '',
      'pages/api/hello.ts': '',
    })
    expect(detectProject(dir).routes).toEqual(['/', '/about'])
  })

  it('falls back to / and attribute switching when it recognises nothing', () => {
    const d = detectProject(project({ 'package.json': {} }))
    expect(d).toMatchObject({ routes: ['/'], locale: { strategy: 'attribute' } })
    expect(d.notes.join('\n')).toMatch(/Couldn't tell how the app switches language/)
  })
})

describe('renderConfig', () => {
  it('writes a config that parses, with notes and parameter routes commented out', async () => {
    const dir = project({
      'package.json': { dependencies: { next: '15', 'next-intl': '4' } },
      "app/[locale]/it's/page.tsx": '',
      'app/[locale]/products/[id]/page.tsx': '',
      'messages/en.json': {},
      'messages/ar.json': {},
    })
    const text = renderConfig(detectProject(dir))
    expect(text).toContain("import { defineConfig } from '@miraya/cli'")
    expect(text).toContain('// - next-intl: the locale is in the path.')
    expect(text).toContain("    // '/products/[id]',")
    const input = renderedInput(text)
    expect(parseConfig(input).routes).toEqual(["/it's"])
    expect(input.locales).toEqual({ ltr: './messages/en.json', rtl: './messages/ar.json' })
  })
})

describe('static sites', () => {
  it('reads one folder per language, and the port from any serve script', () => {
    const dir = project({
      'package.json': { scripts: { serve: 'vite --port 4400' }, devDependencies: { vite: '8' } },
      'en/index.html': '',
      'ar/index.html': '',
    })
    expect(detectProject(dir)).toMatchObject({
      baseUrl: 'http://localhost:4400',
      locale: { strategy: 'path-prefix', ltr: '/en', rtl: '/ar' },
    })
  })
})

describe('localStorage apps', () => {
  it("reads i18next's language detector", () => {
    const dir = project({
      'package.json': {
        dependencies: {
          react: '19',
          vite: '7',
          i18next: '25',
          'i18next-browser-languagedetector': '8',
        },
      },
    })
    expect(detectProject(dir).locale).toEqual({
      strategy: 'local-storage',
      key: 'i18nextLng',
      ltr: 'en',
      rtl: 'ar',
    })
  })

  it("finds the app's own key and translations kept somewhere unusual", () => {
    const dir = project({
      'package.json': { dependencies: { react: '19', vite: '7', i18next: '25' } },
      'src/components/LanguageSwitcher.tsx':
        'const saved = localStorage.getItem("selectedLanguage")',
      'src/data/locals/en/common/forms.json': {},
      'src/data/locals/ar/common/forms.json': {},
    })
    expect(detectProject(dir)).toMatchObject({
      locale: { strategy: 'local-storage', key: 'selectedLanguage' },
      locales: { ltr: './src/data/locals/en', rtl: './src/data/locals/ar' },
    })
  })
})
