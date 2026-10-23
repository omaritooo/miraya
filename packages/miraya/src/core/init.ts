import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import type { ConfigInput } from '../types'

/** What `miraya init` found in a project, and why it chose each value. */
export type Detected = {
  baseUrl: string
  locale: NonNullable<ConfigInput['locale']>
  routes: string[]
  /** Routes with parameters, like /products/[id]: written commented out, to fill in. */
  dynamicRoutes: string[]
  locales?: { ltr: string; rtl: string }
  typescript: boolean
  /** One line per decision, printed by the CLI and written as comments in the config. */
  notes: string[]
}

type Framework = 'next' | 'nuxt' | 'sveltekit' | 'astro' | 'vite'

const DEFAULT_PORT: Record<Framework, number> = {
  next: 3000,
  nuxt: 3000,
  sveltekit: 5173,
  astro: 4321,
  vite: 5173,
}
const RTL_CODE = /^(ar|he|fa|ur)([-_][\w-]+)?$/i
const LTR_CODE = /^en([-_][\w-]+)?$/i
const LOCALE_DIRS = [
  'locales',
  'src/locales',
  'messages',
  'src/messages',
  'i18n/locales',
  'src/i18n/locales',
  'public/locales',
  'lang',
  'src/lang',
  'i18n',
  'src/i18n',
]
// Segments that hold the locale itself, not a page: dropped from routes.
const LOCALE_SEGMENT = /^\[{1,2}(locale|lang|lng)\]{1,2}$/i
const MAX_ROUTES = 50

function readText(path: string): string | undefined {
  return existsSync(path) ? readFileSync(path, 'utf8') : undefined
}

function files(dir: string): string[] {
  if (!existsSync(dir)) return []
  return readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    if (d.name.startsWith('.') || d.name === 'node_modules') return []
    const path = join(dir, d.name)
    return d.isDirectory() ? files(path) : [path]
  })
}

function frameworkOf(deps: Record<string, string>): Framework | undefined {
  if (deps.next) return 'next'
  if (deps.nuxt) return 'nuxt'
  if (deps['@sveltejs/kit']) return 'sveltekit'
  if (deps.astro) return 'astro'
  if (deps.vite) return 'vite'
  return undefined
}

/**
 * Turns file-based routing into routes. `segments` are the path parts under the routes
 * folder, already without the page file's own name where the framework uses one.
 */
function toRoute(segments: string[]): { route: string; dynamic: boolean } | undefined {
  const kept: string[] = []
  let dynamic = false
  for (const segment of segments) {
    if (/^\(.*\)$/.test(segment) || segment.startsWith('@') || LOCALE_SEGMENT.test(segment)) {
      continue
    }
    if (segment.startsWith('_') && segment !== '_') return undefined
    if (/\[.+\]/.test(segment)) dynamic = true
    kept.push(segment)
  }
  return { route: `/${kept.join('/')}`, dynamic }
}

function routesFrom(dir: string, framework: Framework | undefined) {
  const found: { route: string; dynamic: boolean }[] = []
  const add = (root: string, match: (parts: string[]) => string[] | undefined) => {
    for (const file of files(join(dir, root))) {
      const segments = match(relative(join(dir, root), file).split(/[\\/]/))
      const route = segments && toRoute(segments)
      if (route) found.push(route)
    }
  }
  const pageFile = (name: RegExp) => (parts: string[]) =>
    name.test(parts.at(-1) ?? '') ? parts.slice(0, -1) : undefined
  // index.tsx is the folder's own route; about.tsx is /about.
  const fileRoute = (ext: RegExp) => (parts: string[]) => {
    const last = parts.at(-1) ?? ''
    if (!ext.test(last)) return undefined
    const name = last.replace(ext, '')
    return name === 'index' ? parts.slice(0, -1) : [...parts.slice(0, -1), name]
  }

  if (framework === 'next') {
    for (const root of ['app', 'src/app']) add(root, pageFile(/^page\.(tsx|ts|jsx|js|mdx)$/))
    for (const root of ['pages', 'src/pages']) {
      add(root, (parts) =>
        parts[0] === 'api' || (parts.at(-1) ?? '').startsWith('_')
          ? undefined
          : fileRoute(/\.(tsx|ts|jsx|js|mdx)$/)(parts),
      )
    }
  } else if (framework === 'nuxt') {
    for (const root of ['pages', 'app/pages']) add(root, fileRoute(/\.vue$/))
  } else if (framework === 'sveltekit') {
    add('src/routes', pageFile(/^\+page\.svelte$/))
  } else if (framework === 'astro') {
    add('src/pages', fileRoute(/\.(astro|md|mdx)$/))
  }
  const unique = (list: string[]) => [...new Set(list)].sort()
  return {
    routes: unique(found.filter((r) => !r.dynamic).map((r) => r.route)),
    dynamic: unique(found.filter((r) => r.dynamic).map((r) => r.route)),
  }
}

/** Finds an English and an RTL translation file, or folder of them, side by side. */
const BUILD_DIRS = new Set(['node_modules', 'dist', 'build', 'coverage', 'out'])

/** Folders up to `depth` levels down, skipping dependencies and build output. */
function folders(dir: string, depth: number, rel = ''): string[] {
  if (depth < 0) return []
  return readdirSync(join(dir, rel), { withFileTypes: true }).flatMap((d) => {
    if (!d.isDirectory() || d.name.startsWith('.') || BUILD_DIRS.has(d.name)) return []
    const sub = rel ? `${rel}/${d.name}` : d.name
    return [sub, ...folders(dir, depth - 1, sub)]
  })
}

function localesIn(dir: string) {
  // The usual places first; then any folder, a few levels down, with both languages in it.
  const candidates = [...LOCALE_DIRS, ...folders(dir, 4).filter((f) => !LOCALE_DIRS.includes(f))]
  for (const base of candidates) {
    const path = join(dir, base)
    if (!existsSync(path) || !statSync(path).isDirectory()) continue
    const entries = readdirSync(path, { withFileTypes: true })
    const pick = (code: RegExp) =>
      entries.find((e) =>
        e.isDirectory()
          ? code.test(e.name)
          : e.name.endsWith('.json') && code.test(e.name.slice(0, -5)),
      )
    const ltr = pick(LTR_CODE)
    const rtl = pick(RTL_CODE)
    if (ltr && rtl) {
      const code = (e: typeof ltr) => (e.isDirectory() ? e.name : e.name.slice(0, -5))
      return {
        files: { ltr: `./${base}/${ltr.name}`, rtl: `./${base}/${rtl.name}` },
        codes: { ltr: code(ltr), rtl: code(rtl) },
      }
    }
  }
  return undefined
}

const SOURCE_FILE = /\.(tsx?|jsx?|vue|svelte)$/
const STORAGE_READ = /localStorage\.getItem\(\s*['"`]([^'"`]*(?:lang|locale|lng)[^'"`]*)['"`]/i

/** A localStorage key the app's own code reads its language from, like selectedLanguage. */
function storageKey(dir: string): string | undefined {
  for (const file of files(join(dir, 'src'))) {
    if (!SOURCE_FILE.test(file)) continue
    const key = STORAGE_READ.exec(readFileSync(file, 'utf8'))?.[1]
    if (key) return key
  }
  return undefined
}

/** A static site with one folder per language: en/index.html and ar/index.html. */
function staticLocaleDirs(dir: string) {
  for (const base of ['', 'public', 'src']) {
    const root = join(dir, base)
    if (!existsSync(root)) continue
    const names = readdirSync(root, { withFileTypes: true })
      .filter((e) => e.isDirectory() && existsSync(join(root, e.name, 'index.html')))
      .map((e) => e.name)
    const ltr = names.find((n) => LTR_CODE.test(n))
    const rtl = names.find((n) => RTL_CODE.test(n))
    if (ltr && rtl) return { ltr, rtl }
  }
  return undefined
}

/** Reads a project and guesses a config. Reads files only; never runs the app. */
export function detectProject(dir: string): Detected {
  const notes: string[] = []
  const pkg = JSON.parse(readText(join(dir, 'package.json')) ?? '{}') as {
    scripts?: Record<string, string>
    dependencies?: Record<string, string>
    devDependencies?: Record<string, string>
  }
  const deps = { ...pkg.dependencies, ...pkg.devDependencies }
  const framework = frameworkOf(deps)
  notes.push(framework ? `Framework: ${framework}.` : 'No framework recognised.')

  const scripts = pkg.scripts ?? {}
  const script = scripts.dev ?? scripts.start ?? scripts.serve ?? scripts.preview ?? ''
  const port =
    Number(/(?:--port|-p)[\s=](\d+)/.exec(script)?.[1]) ||
    (framework ? DEFAULT_PORT[framework] : 3000)
  notes.push(
    /(?:--port|-p)[\s=]\d+/.test(script)
      ? `Port ${port}, from the package scripts.`
      : `Port ${port}, the ${framework ?? 'usual'} default. Change baseUrl if your app runs elsewhere.`,
  )

  const found = localesIn(dir)
  const codes = found?.codes ?? { ltr: 'en', rtl: 'ar' }
  if (found) notes.push(`Translation files: ${found.files.ltr} and ${found.files.rtl}.`)

  let locale: Detected['locale'] = { strategy: 'attribute' }
  const nuxtConfig = ['nuxt.config.ts', 'nuxt.config.js', 'nuxt.config.mjs']
    .map((f) => readText(join(dir, f)))
    .find(Boolean)
  if (deps['@nuxtjs/i18n']) {
    const strategy =
      /strategy:\s*['"](\w+)['"]/.exec(nuxtConfig ?? '')?.[1] ?? 'prefix_except_default'
    if (strategy === 'no_prefix') {
      const name = /cookieKey:\s*['"]([^'"]+)['"]/.exec(nuxtConfig ?? '')?.[1] ?? 'i18n_redirected'
      locale = { strategy: 'cookie', name, ltr: codes.ltr, rtl: codes.rtl }
      notes.push(`@nuxtjs/i18n with no_prefix: the locale is in the ${name} cookie.`)
    } else {
      const bare = strategy === 'prefix_except_default'
      locale = { strategy: 'path-prefix', ltr: bare ? '' : `/${codes.ltr}`, rtl: `/${codes.rtl}` }
      notes.push(
        `@nuxtjs/i18n with ${strategy}: the locale is in the path${bare ? ', English without a prefix (assuming English is the default locale)' : ''}.`,
      )
    }
  } else if (
    deps['next-intl'] ||
    deps['@inlang/paraglide-sveltekit'] ||
    deps['@inlang/paraglide-next']
  ) {
    const lib = deps['next-intl'] ? 'next-intl' : 'Paraglide'
    locale = { strategy: 'path-prefix', ltr: `/${codes.ltr}`, rtl: `/${codes.rtl}` }
    notes.push(`${lib}: the locale is in the path.`)
  } else if (
    framework === 'next' &&
    /i18n\s*:/.test(
      readText(join(dir, 'next.config.js')) ??
        readText(join(dir, 'next.config.mjs')) ??
        readText(join(dir, 'next.config.ts')) ??
        '',
    )
  ) {
    locale = { strategy: 'path-prefix', ltr: '', rtl: `/${codes.rtl}` }
    notes.push(
      'Next.js i18n routing: the locale is in the path, the default locale without a prefix.',
    )
  } else if (deps['i18next-browser-languagedetector']) {
    // The detector's default cache: localStorage, under i18nextLng.
    locale = { strategy: 'local-storage', key: 'i18nextLng', ltr: codes.ltr, rtl: codes.rtl }
    notes.push("i18next's language detector: the language is in localStorage, under i18nextLng.")
  } else if (storageKey(dir)) {
    const key = storageKey(dir) as string
    locale = { strategy: 'local-storage', key, ltr: codes.ltr, rtl: codes.rtl }
    notes.push(`The app reads its language from localStorage, under ${key}.`)
  } else if (staticLocaleDirs(dir)) {
    const found = staticLocaleDirs(dir) as { ltr: string; rtl: string }
    locale = { strategy: 'path-prefix', ltr: `/${found.ltr}`, rtl: `/${found.rtl}` }
    notes.push(`Pages in ${found.ltr}/ and ${found.rtl}/ folders: the locale is in the path.`)
  } else {
    notes.push(
      "Couldn't tell how the app switches language, so the config uses `attribute`: it flips the layout only. Set `locale` to how your app really switches to check fonts and translations too.",
    )
  }

  const { routes, dynamic } = routesFrom(dir, framework)
  let kept = routes.length ? routes : ['/']
  if (!routes.length)
    notes.push(
      'No page files found: starting with `/`. Run `miraya init --crawl` with the app running to find routes by following links.',
    )
  else
    notes.push(
      `${routes.length} routes from the page files${dynamic.length ? `, and ${dynamic.length} with parameters to fill in` : ''}.`,
    )
  if (kept.length > MAX_ROUTES) {
    notes.push(`Kept the first ${MAX_ROUTES} routes; add the rest if you need them.`)
    kept = kept.slice(0, MAX_ROUTES)
  }

  return {
    baseUrl: `http://localhost:${port}`,
    locale,
    routes: kept,
    dynamicRoutes: dynamic,
    ...(found ? { locales: found.files } : {}),
    typescript: existsSync(join(dir, 'tsconfig.json')),
    notes,
  }
}

const quote = (s: string) => `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`

function literal(value: unknown): string {
  if (typeof value === 'string') return quote(value)
  if (Array.isArray(value)) return `[${value.map(literal).join(', ')}]`
  if (value && typeof value === 'object') {
    return `{ ${Object.entries(value)
      .map(([k, v]) => `${/^\w+$/.test(k) ? k : quote(k)}: ${literal(v)}`)
      .join(', ')} }`
  }
  return String(value)
}

/** The config file's text, with each guess explained in a comment. */
export function renderConfig(d: Detected): string {
  const lines = [
    "import { defineConfig } from '@miraya/cli'",
    '',
    '// Written by `miraya init`. What it found:',
    ...d.notes.map((n) => `// - ${n}`),
    '// Every option: https://github.com/omaritooo/miraya/tree/main/packages/miraya#configuration',
    'export default defineConfig({',
    `  baseUrl: ${quote(d.baseUrl)},`,
    `  locale: ${literal(d.locale)},`,
    '  routes: [',
    ...d.routes.map((r) => `    ${quote(r)},`),
    ...(d.dynamicRoutes.length
      ? ['    // Routes with parameters: replace them with real pages, or remove them.']
      : []),
    ...d.dynamicRoutes.map((r) => `    // ${quote(r)},`),
    '  ],',
    ...(d.locales ? [`  locales: ${literal(d.locales)},`] : []),
    '})',
    '',
  ]
  return lines.join('\n')
}
