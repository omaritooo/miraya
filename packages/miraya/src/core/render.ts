import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import type { Browser, BrowserContext, Page } from '@playwright/test'
import { collectPage, DEFAULT_GENERATED_ID_PATTERNS, type PageCollection } from '../collector'
import type { Dir, ResolvedConfig, Snapshot } from '../types'

const FREEZE_CSS = `*, *::before, *::after {
  animation: none !important;
  transition: none !important;
  caret-color: transparent !important;
  scroll-behavior: auto !important;
}`
const QUIET_MS = 500

export class RedirectError extends Error {
  override name = 'RedirectError'
  constructor(
    message: string,
    readonly finalUrl: string,
  ) {
    super(message)
  }
}

/** Runs after the page settles and before collection, e.g. to open what a frozen transition left half-shut. */
export type BeforeCollect = (page: Page, dir: Dir) => Promise<void>

export type Contexts = { forDir(dir: Dir): BrowserContext; close(): Promise<void> }

/**
 * One context, or one per direction for the context-locale strategy (DESIGN.md › section 1).
 * Given an existing context (a Playwright test's), audits run inside it and leave it as
 * they found it: the cookie strategy restores the cookie, and context-locale, whose
 * locale is fixed per context, creates two contexts from the test's storage state, so
 * a login done earlier in the test carries over.
 */
export async function openContexts(
  browser: Browser,
  config: ResolvedConfig,
  existing?: BrowserContext,
): Promise<Contexts> {
  const locale = config.locale
  const storageState = existing ? await existing.storageState() : config.auth.storageState
  const options = {
    viewport: { width: config.viewport.w, height: config.viewport.h },
    deviceScaleFactor: config.deviceScaleFactor,
    reducedMotion: 'reduce' as const,
    ...(storageState ? { storageState } : {}),
  }
  if (typeof locale === 'object' && locale.strategy === 'context-locale') {
    const ltr = await browser.newContext({ ...options, locale: locale.ltr })
    const rtl = await browser.newContext({ ...options, locale: locale.rtl })
    return {
      forDir: (dir) => (dir === 'ltr' ? ltr : rtl),
      close: async () => {
        await Promise.all([ltr.close(), rtl.close()])
      },
    }
  }
  if (!existing) {
    const context = await browser.newContext(options)
    return { forDir: () => context, close: () => context.close() }
  }
  const cookieName =
    typeof locale === 'object' && locale.strategy === 'cookie' ? locale.name : undefined
  const before = cookieName
    ? (await existing.cookies(config.baseUrl)).find((c) => c.name === cookieName)
    : undefined
  return {
    forDir: () => existing,
    close: async () => {
      if (!cookieName) return
      if (before) await existing.addCookies([before])
      else await existing.clearCookies({ name: cookieName })
    },
  }
}

/** Removes the locale prefix and trailing slash, so /en/cart/ and /cart compare equal. */
function normalisePath(pathname: string, config: ResolvedConfig) {
  let path = pathname
  const locale = config.locale
  if (typeof locale === 'object' && locale.strategy === 'path-prefix') {
    for (const prefix of [locale.ltr, locale.rtl]) {
      if (path === prefix || path.startsWith(`${prefix}/`)) path = path.slice(prefix.length)
    }
  }
  return path.replace(/\/+$/, '') || '/'
}

/** Opens the route in the given direction using the app's own switching mechanism. Returns the requested URL, if known. */
export async function open(
  page: Page,
  route: string,
  dir: Dir,
  config: ResolvedConfig,
): Promise<string | undefined> {
  const locale = config.locale
  const goto = async (path: string) => {
    const url = new URL(path, config.baseUrl).href
    const response = await page.goto(url, { waitUntil: 'load', timeout: config.timeouts.routeMs })
    // Auditing an error page twice teaches nobody anything.
    if (response && response.status() >= 400) {
      throw new Error(`HTTP ${response.status()} for ${url}`)
    }
    return url
  }
  if (typeof locale === 'function') {
    const target = await locale(dir, { page, route })
    return typeof target === 'string' ? goto(target) : undefined
  }
  switch (locale.strategy) {
    case 'path-prefix':
      return goto(`${dir === 'ltr' ? locale.ltr : locale.rtl}${route === '/' ? '/' : route}`)
    case 'query': {
      const url = new URL(route, config.baseUrl)
      url.searchParams.set(locale.param, dir === 'ltr' ? locale.ltr : locale.rtl)
      return goto(url.href)
    }
    case 'cookie':
      await page.context().addCookies([
        {
          name: locale.name,
          value: dir === 'ltr' ? locale.ltr : locale.rtl,
          ...(locale.domain ? { domain: locale.domain, path: '/' } : { url: config.baseUrl }),
        },
      ])
      return goto(route)
    case 'context-locale':
      return goto(route)
    case 'attribute': {
      const url = await goto(route)
      const lang = dir === 'rtl' ? (config.languages.rtl[0] ?? 'ar') : 'en'
      await page.evaluate(
        ([d, l]) => {
          document.documentElement.setAttribute('dir', d)
          document.documentElement.setAttribute('lang', l)
        },
        [dir, lang] as const,
      )
      return url
    }
  }
}

/** Waits until the page stops changing, then freezes motion (DESIGN.md › Settling the page). Returns true if the cap was hit. */
async function settle(page: Page, config: ResolvedConfig): Promise<boolean> {
  await page.evaluate(() => document.fonts.ready.then(() => undefined))
  await page.addStyleTag({ content: FREEZE_CSS })
  const quiet = () =>
    page.evaluate(
      ({ quietMs, capMs }) =>
        new Promise<boolean>((resolve) => {
          const start = performance.now()
          let last = start
          let height = document.documentElement.scrollHeight
          const bump = () => {
            last = performance.now()
          }
          const shifts = new PerformanceObserver((list) => {
            if (list.getEntries().length > 0) bump()
          })
          try {
            shifts.observe({ type: 'layout-shift' })
          } catch {
            // layout-shift is Chromium-only (ADR-001)
          }
          const mutations = new MutationObserver(bump)
          mutations.observe(document, {
            subtree: true,
            childList: true,
            attributes: true,
            characterData: true,
          })
          const tick = () => {
            const h = document.documentElement.scrollHeight
            if (h !== height) {
              height = h
              bump()
            }
            const now = performance.now()
            const capped = now - start >= capMs
            if (now - last >= quietMs || capped) {
              shifts.disconnect()
              mutations.disconnect()
              resolve(capped && now - last < quietMs)
            } else setTimeout(tick, 50)
          }
          tick()
        }),
      { quietMs: QUIET_MS, capMs: config.timeouts.settleCapMs },
    )
  let capped = await quiet()
  if (config.scrollToLoad) {
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))
    capped = (await quiet()) || capped
    await page.evaluate(() => window.scrollTo(0, 0))
  }
  await page.evaluate(
    () => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))),
  )
  return capped
}

/**
 * Throws a RedirectError when the page ended up somewhere other than the requested route.
 * Landing on the login page only counts when the login page wasn't what was requested.
 */
export function checkRedirect(
  requested: string | undefined,
  finalUrl: string,
  config: ResolvedConfig,
) {
  const pattern = config.auth.loginUrlPattern
  if (pattern && finalUrl.includes(pattern) && !requested?.includes(pattern)) {
    throw new RedirectError(
      `Redirected to the login page (${finalUrl}); is the storageState expired?`,
      finalUrl,
    )
  }
  if (requested) {
    const want = normalisePath(new URL(requested).pathname, config)
    const got = normalisePath(new URL(finalUrl).pathname, config)
    if (want !== got) throw new RedirectError(`Redirected from ${want} to ${got}`, finalUrl)
  }
}

const snapshotPart = ({ fontSamples: _samples, markers: _markers, ...rest }: PageCollection) => rest

export function routeSlug(route: string) {
  const slug = route.replace(/^\/+|\/+$/g, '').replace(/[^a-zA-Z0-9._-]+/g, '-')
  return slug || 'index'
}

export type RenderResult = {
  snapshot: Snapshot
  notes: string[]
  markers: PageCollection['markers']
}

/** Opens, settles, collects and screenshots one route in one direction. */
export async function renderRoute(
  context: BrowserContext,
  route: string,
  dir: Dir,
  config: ResolvedConfig,
  outDir: string,
  beforeCollect?: BeforeCollect,
): Promise<RenderResult> {
  const page = await context.newPage()
  const pageErrors: string[] = []
  page.on('pageerror', (error) => pageErrors.push(error.message))
  try {
    const requested = await open(page, route, dir, config)
    const finalUrl = page.url()
    checkRedirect(requested, finalUrl, config)

    const capped = await settle(page, config)
    if (beforeCollect) {
      await beforeCollect(page, dir)
      await page.evaluate(
        () =>
          new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))),
      )
    }
    const collected = await collectPage(page, {
      testIdAttribute: config.pairing.testIdAttribute,
      generatedIdPatterns: config.pairing.generatedIdPatterns ?? DEFAULT_GENERATED_ID_PATTERNS,
      ...(config.source.attribute ? { sourceAttribute: config.source.attribute } : {}),
      maxElements: 5000,
      containerTolerancePx: 4,
    })

    const relDir = join('routes', routeSlug(route))
    mkdirSync(join(outDir, relDir), { recursive: true })
    const truncated = collected.docHeight > config.maxPageHeight
    const shot = {
      fullPage: true,
      animations: 'disabled' as const,
      caret: 'hide' as const,
      ...(truncated
        ? { clip: { x: 0, y: 0, width: collected.docWidth.scroll, height: config.maxPageHeight } }
        : {}),
    }
    const png = join(relDir, `${dir}.png`)
    const jpeg = join(relDir, `${dir}.jpg`)
    await page.screenshot({ ...shot, type: 'png', path: join(outDir, png) })
    await page.screenshot({ ...shot, type: 'jpeg', quality: 70, path: join(outDir, jpeg) })

    const notes: string[] = []
    if (capped) notes.push(`${dir}: settle cap hit after ${config.timeouts.settleCapMs}ms`)
    if (collected.stats.capped)
      notes.push(`${dir}: element cap hit; elements after the first 5000 weren't checked`)
    if (truncated) notes.push(`${dir}: screenshot truncated at ${config.maxPageHeight}px`)

    return {
      snapshot: {
        ...snapshotPart(collected),
        url: requested ?? finalUrl,
        finalUrl,
        screenshot: { png, jpeg, truncated },
        pageErrors,
      },
      notes,
      markers: collected.markers,
    }
  } finally {
    await page.close()
  }
}
