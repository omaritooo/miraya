import type { Browser } from '@playwright/test'
import picomatch from 'picomatch'
import type { ResolvedConfig } from '../types'
import { ConfigError } from './engine'
import { closePage, open, openContexts } from './render'

const DEFAULT_EXCLUDE = [
  '/logout',
  '/logout/**',
  '/signout',
  '/signout/**',
  '/sign-out',
  '/sign-out/**',
]
const NOT_HTML =
  /\.(png|jpe?g|gif|svg|webp|avif|ico|pdf|zip|gz|mp4|webm|mp3|css|js|mjs|json|xml|txt|woff2?)$/i

/**
 * Turns a link into a locale-free route, or undefined when it shouldn't be audited:
 * hash removed, query removed unless an include pattern names it, locale prefix
 * stripped (so /en/cart and /ar/cart are one route), trailing slashes collapsed.
 */
export function normaliseLink(
  href: string,
  config: ResolvedConfig,
  keepQuery: (route: string) => boolean,
): string | undefined {
  let url: URL
  try {
    url = new URL(href, config.baseUrl)
  } catch {
    return undefined
  }
  const base = new URL(config.baseUrl)
  if (url.origin !== base.origin || !/^https?:$/.test(url.protocol)) return undefined
  let path = url.pathname
  const locale = config.locale
  if (typeof locale === 'object' && locale.strategy === 'path-prefix') {
    for (const prefix of [locale.ltr, locale.rtl]) {
      if (path === prefix || path.startsWith(`${prefix}/`)) path = path.slice(prefix.length) || '/'
    }
  }
  path = path.replace(/\/+$/, '') || '/'
  if (NOT_HTML.test(path)) return undefined
  return url.search && keepQuery(`${path}${url.search}`) ? `${path}${url.search}` : path
}

/**
 * Breadth-first crawl from crawl.start, following same-origin links found in the LTR
 * render only. Opt-in, because a crawler that follows /logout ends every authenticated
 * run on its first route (DESIGN.md › Crawl).
 */
export async function crawl(browser: Browser, config: ResolvedConfig): Promise<string[]> {
  const settings = config.crawl
  if (!settings) throw new ConfigError('--crawl needs a `crawl` section in the config')
  const included = settings.include.length ? picomatch(settings.include) : () => true
  // A query string is part of the route only when an include pattern names it.
  const keepQuery = settings.include.length ? picomatch(settings.include) : () => false
  const excluded = picomatch([...DEFAULT_EXCLUDE, ...settings.exclude])
  const allowed = (route: string) => included(route) && !excluded(route.split('?')[0] ?? route)

  const start = normaliseLink(settings.start, config, () => false) ?? '/'
  const seen = new Set([start])
  const found: string[] = []
  let frontier = [start]
  const contexts = await openContexts(browser, config)
  try {
    for (let depth = 0; depth <= settings.maxDepth && frontier.length; depth++) {
      const nextFrontier: string[] = []
      for (const route of frontier) {
        if (found.length >= settings.maxRoutes) return found
        if (!allowed(route)) continue
        found.push(route)
        if (depth === settings.maxDepth) continue
        const page = await contexts.forDir('ltr').newPage()
        try {
          await open(page, route, 'ltr', config)
          const hrefs = await page.$$eval('a[href]', (links) =>
            links.map((a) => a.getAttribute('href') ?? ''),
          )
          for (const href of hrefs) {
            if (/^(mailto|tel|javascript):/i.test(href)) continue
            const next = normaliseLink(href, config, keepQuery)
            if (next && !seen.has(next)) {
              seen.add(next)
              nextFrontier.push(next)
            }
          }
        } catch {
          // A route that fails to open is still audited, and reported there.
        } finally {
          await closePage(page)
        }
      }
      frontier = nextFrontier
    }
    return found
  } finally {
    await contexts.close()
  }
}
