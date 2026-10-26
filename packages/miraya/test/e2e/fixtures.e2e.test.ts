import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import AxeBuilder from '@axe-core/playwright'
import { chromium, type Browser } from '@playwright/test'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  audit,
  exitCode,
  parseConfig,
  ReportSchema,
  writeHtmlReport,
  writeReport,
  type Report,
} from '../../src'
import { crawl, signIn } from '../../src/core'
import { FIXTURE_URL } from './fixture-server'

// The precision test: every fixture page must produce exactly its labelled findings,
// from every rule. Good pages expect none, so any finding there is a false positive.
const pagesDir = fileURLToPath(new URL('../../../../fixtures/site/pages/', import.meta.url))
const manifests = readdirSync(pagesDir, { recursive: true, encoding: 'utf8' })
  .filter((f) => f.endsWith('.expect.json'))
  .map(
    (f) =>
      JSON.parse(readFileSync(join(pagesDir, f), 'utf8')) as {
        route: string
        expect: { rule: string; selector: string }[]
      },
  )

const config = parseConfig({
  baseUrl: FIXTURE_URL,
  locale: { strategy: 'path-prefix', ltr: '/en', rtl: '/ar' },
  allow: { latinText: ['Miraya', 'Visa', 'Apple', 'Watch'] },
  // Experimental rules run on every page here, so a false positive anywhere fails the suite.
  experimental: ['bidi-isolation'],
  // The fixture pages are about layout; SEO has its own page, /seo, below.
  checks: ['localization'],
})

let browser: Browser
let report: Report

beforeAll(async () => {
  browser = await chromium.launch()
  report = await audit({
    config,
    routes: manifests.map((m) => m.route),
    browser,
    outDir: process.env.MIRAYA_E2E_OUT ?? mkdtempSync(join(tmpdir(), 'miraya-e2e-')),
    keepArtifacts: !!process.env.MIRAYA_E2E_OUT,
  })
  // Set MIRAYA_E2E_OUT to keep the report and screenshots for inspection.
  if (process.env.MIRAYA_E2E_OUT) writeReport(report, process.env.MIRAYA_E2E_OUT)
})
afterAll(() => browser?.close())

describe('fixture site', () => {
  it('produces a report that matches the published schema', () => {
    expect(ReportSchema.safeParse(report).success).toBe(true)
  })

  for (const manifest of manifests) {
    it(`${manifest.route} has exactly its labelled findings`, () => {
      const route = report.routes.find((r) => r.route === manifest.route)
      expect(route?.errors).toEqual([])
      const actual = (route?.findings ?? []).map((f) => `${f.rule} ${f.selector}`).sort()
      const expected = manifest.expect.map((e) => `${e.rule} ${e.selector}`).sort()
      expect(
        actual,
        JSON.stringify(
          route?.findings.map((f) => f.message),
          null,
          2,
        ),
      ).toEqual(expected)
    })
  }

  it('exits 1 because bad pages have new errors', () => {
    expect(exitCode(report)).toBe(1)
  })
})

describe('failures and other switchers', () => {
  it('marks a missing route as failed and exits 2', async () => {
    const result = await audit({
      config,
      routes: ['/does-not-exist'],
      browser,
      outDir: mkdtempSync(join(tmpdir(), 'miraya-e2e-')),
    })
    expect(result.routes[0]?.errors).toMatchObject([
      { kind: 'failed', message: expect.stringContaining('HTTP 404') },
    ])
    expect(exitCode(result)).toBe(2)
    expect(exitCode(result, { allowErrors: true })).toBe(0)
  })

  it('audits with the attribute strategy when the app has no locale switch', async () => {
    const result = await audit({
      config: parseConfig({ baseUrl: FIXTURE_URL, locale: { strategy: 'attribute' } }),
      routes: ['/en/not-mirrored/bad/'],
      browser,
      outDir: mkdtempSync(join(tmpdir(), 'miraya-e2e-')),
    })
    const route = result.routes[0]
    expect(route?.errors).toEqual([])
    // The physical CSS is caught, and the forced dir and lang satisfy document-direction.
    const rules = route?.findings.map((f) => f.rule) ?? []
    expect(rules).toContain('not-mirrored')
    expect(rules).not.toContain('document-direction')
  })
})

describe('SEO', () => {
  it('reads the head tags of both pages and finds what the Arabic one gets wrong', async () => {
    const result = await audit({
      config: parseConfig({ ...config, checks: ['seo'] }),
      routes: ['/seo'],
      browser,
      outDir: mkdtempSync(join(tmpdir(), 'miraya-seo-')),
    })
    const route = result.routes[0]
    expect(route?.errors).toEqual([])
    expect(route?.head?.rtl).toMatchObject({
      title: 'الأسعار · مرايا',
      canonical: [`${FIXTURE_URL}/en/seo/`],
      h1: ['خطط تنمو مع فريقك'],
      http: { status: 200 },
    })
    expect(route?.head?.ltr?.jsonLd).toEqual([{ types: ['Product'] }])
    expect(
      route?.findings.map((f) => `${f.rule} ${f.evidence.check} ${f.evidence.side}`).sort(),
    ).toEqual([
      'canonical points-at-twin rtl',
      'meta-description missing rtl',
      'structured-data invalid 1 rtl',
    ])
    expect(route?.findings.every((f) => f.area === 'seo')).toBe(true)
  })
})

describe('performance', () => {
  it('measures both pages and flags what only the Arabic one does, in the report too', async () => {
    const outDir = mkdtempSync(join(tmpdir(), 'miraya-perf-'))
    // Unthrottled, one load: the fixture's slow parts are wall-clock waits, not CPU work.
    const result = await audit({
      config: parseConfig({
        ...config,
        checks: ['performance'],
        performance: { runs: 1, warmUp: 0, cpuSlowdown: 1, network: 'none' },
      }),
      routes: ['/perf'],
      browser,
      outDir,
    })
    const route = result.routes[0]
    expect(route?.errors).toEqual([])
    expect(result.performance).toMatchObject({ network: 'Unthrottled', runs: 1 })
    expect(route?.perf?.ltr?.lcp?.ms).toBeLessThan(2500)
    // Vite's dev server sends its hot-reload client, so the findings are for reference only.
    expect(route?.perf?.rtl?.devServer).toBe(true)
    expect(new Set(route?.findings.map((f) => f.severity))).toEqual(new Set(['info']))
    expect(route?.perf?.rtl?.lcp).toMatchObject({ selector: expect.stringContaining('h1') })
    expect(route?.perf?.rtl?.oversizedImages[0]).toMatchObject({
      natural: { w: 400, h: 300 },
      shown: { w: 100, h: 75 },
    })
    expect(route?.findings.map((f) => `${f.rule} ${f.evidence.side}`).sort()).toEqual([
      'cls-budget rtl',
      'lcp-budget rtl',
      'oversized-images rtl',
      'render-blocking both',
      'tbt-budget rtl',
    ])

    const { file } = writeHtmlReport(result, outDir)
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
    const page = await context.newPage()
    try {
      await page.goto(`${pathToFileURL(file).href}#area=performance`)
      await expect.poll(() => page.locator('.metrics tbody tr').count()).toBe(6)
      await expect.poll(() => page.locator('.lcp-box').count()).toBe(1)
      await page.getByRole('tab', { name: /Requests/ }).click()
      await expect.poll(() => page.locator('#panel-requests tbody tr').count()).toBeGreaterThan(3)
      const axe = await new AxeBuilder({ page }).analyze()
      expect(axe.violations.map((v) => `${v.id}: ${v.help}`)).toEqual([])
    } finally {
      await context.close()
    }
  })
})

describe('cross-browser', () => {
  it('audits in each engine and marks what only WebKit gets wrong, in the report too', async () => {
    const outDir = mkdtempSync(join(tmpdir(), 'miraya-xb-'))
    const result = await audit({
      config: parseConfig({ ...config, browsers: ['chromium', 'webkit', 'firefox'] }),
      routes: ['/cross-browser', '/fallback-font/bad'],
      browser,
      outDir,
    })
    expect(result.engines).toEqual(['chromium', 'webkit', 'firefox'])
    const [page, fonts] = result.routes
    expect(page?.errors).toEqual([])
    expect(page?.engines?.webkit?.status).toBe('ok')
    expect(
      page?.findings.filter((f) => f.engines).map((f) => `${f.rule} ${f.selector} ${f.engines}`),
    ).toEqual(['not-mirrored [data-testid="badge"] webkit'])
    // fallback-font needs Chromium; the others skip it instead of disagreeing.
    expect(fonts?.findings.some((f) => f.rule === 'fallback-font' && !f.engines)).toBe(true)
    expect(fonts?.findings.filter((f) => f.engines)).toEqual([])

    const { file } = writeHtmlReport(result, outDir)
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
    const tab = await context.newPage()
    try {
      await tab.goto(`${pathToFileURL(file).href}#area=cross-browser`)
      await expect
        .poll(() => tab.locator('.pane-name').allTextContents())
        .toEqual(['Chromium · RTL', 'WebKit · RTL'])
      await expect.poll(() => tab.locator('.callout').count()).toBe(1)
      const axe = await new AxeBuilder({ page: tab }).analyze()
      expect(axe.violations.map((v) => `${v.id}: ${v.help}`)).toEqual([])
    } finally {
      await context.close()
    }
  })
})

describe('ignore markers', () => {
  it('honours a marker without a reason, and warns about it and about unknown rule ids', () => {
    const route = report.routes.find((r) => r.route === '/ignore-markers')
    expect(route?.findings).toEqual([])
    expect(route?.notes).toEqual(
      expect.arrayContaining([
        expect.stringContaining('ignores "not-mirrored" without a reason'),
        expect.stringContaining('unknown rule "not-mirored"'),
      ]),
    )
  })
})

describe('HTML report', () => {
  it('opens from disk, draws numbered outlines, shows details, and passes axe', async () => {
    const outDir = mkdtempSync(join(tmpdir(), 'miraya-html-'))
    const result = await audit({
      config: parseConfig({ ...config, checks: ['localization', 'seo'] }),
      routes: ['/not-mirrored/bad', '/not-mirrored/good'],
      browser,
      outDir,
    })
    const { file, inlined } = writeHtmlReport(result, outDir)
    expect(inlined).toBe(true)
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
    const page = await context.newPage()
    try {
      await page.goto(pathToFileURL(file).href)
      await expect.poll(() => page.locator('.callout').count()).toBe(6) // 3 findings × 2 panes
      await page
        .getByRole('button', { name: /not-mirrored.*sidebar/ })
        .first()
        .click()
      await expect.poll(() => page.locator('.evidence').textContent()).toContain('What failed')
      expect(new URL(page.url()).hash).toContain('finding=')
      // A filtered view survives a reload, because the filters live in the hash.
      await page.getByRole('link', { name: /not-mirrored\/good/ }).click()
      await page.reload()
      await expect
        .poll(() =>
          page.getByText('Nothing to fix. The Arabic page matches the English one.').count(),
        )
        .toBe(1)
      const axe = await new AxeBuilder({ page }).analyze()
      expect(axe.violations.map((v) => `${v.id}: ${v.help}`)).toEqual([])
      // The SEO tab shows the head tags of both renders, and passes axe too.
      await page.getByRole('link', { name: /^SEO/ }).click()
      await expect.poll(() => page.locator('.head-table tbody tr').count()).toBe(8)
      const seoAxe = await new AxeBuilder({ page }).analyze()
      expect(seoAxe.violations.map((v) => `${v.id}: ${v.help}`)).toEqual([])
      // Site views: both pages share an Arabic title, so they're grouped.
      await page.getByRole('link', { name: /Titles and descriptions/ }).click()
      await expect.poll(() => page.locator('.site-group').count()).toBe(1)
      const titlesAxe = await new AxeBuilder({ page }).analyze()
      expect(titlesAxe.violations.map((v) => `${v.id}: ${v.help}`)).toEqual([])
      await page.getByRole('link', { name: /Language links/ }).click()
      await expect.poll(() => page.locator('.site-table tbody tr').count()).toBe(2)
      const linksAxe = await new AxeBuilder({ page }).analyze()
      expect(linksAxe.violations.map((v) => `${v.id}: ${v.help}`)).toEqual([])
    } finally {
      await context.close()
    }
  })
})

describe('crawl and the CLI', () => {
  it('crawls the fixture index, skipping excluded routes', async () => {
    const routes = await crawl(
      browser,
      parseConfig({
        ...config,
        crawl: { start: '/', maxDepth: 1, exclude: ['/document-direction/**'] },
      }),
    )
    expect(routes[0]).toBe('/')
    expect(routes).toContain('/not-mirrored/bad')
    expect(routes.some((r) => r.startsWith('/document-direction'))).toBe(false)
    expect(routes.length).toBeGreaterThan(15)
  })

  it('runs `miraya audit` and exits 1 on new errors, writing both reports', () => {
    const dir = mkdtempSync(join(tmpdir(), 'miraya-cli-'))
    writeFileSync(
      join(dir, 'miraya.config.mjs'),
      `export default ${JSON.stringify({ baseUrl: FIXTURE_URL, routes: ['/not-mirrored/bad'], locale: { strategy: 'path-prefix', ltr: '/en', rtl: '/ar' } })}\n`,
    )
    const cli = fileURLToPath(new URL('../../dist/cli.js', import.meta.url))
    const run = spawnSync(process.execPath, [cli, 'audit'], {
      cwd: dir,
      encoding: 'utf8',
      env: { ...process.env, GITHUB_ACTIONS: '' },
    })
    expect(run.status, run.stderr).toBe(1)
    expect(run.stdout).toContain('not-mirrored')
    expect(existsSync(join(dir, '.miraya/report.json'))).toBe(true)
    expect(existsSync(join(dir, '.miraya/report.html'))).toBe(true)
  })
})

describe('pages that reload during the audit', () => {
  it('renders the page again and says so', () => {
    const route = report.routes.find((r) => r.route === '/reload')
    expect(route?.errors).toEqual([])
    expect(route?.notes.some((n) => n.includes('reloaded during the audit'))).toBe(true)
  })
})

describe('translation files', () => {
  it('names the key and the file for each untranslated string', async () => {
    const locales = fileURLToPath(new URL('../../../../fixtures/site/locales/', import.meta.url))
    const result = await audit({
      config: parseConfig({
        ...config,
        locales: { ltr: join(locales, 'en.json'), rtl: join(locales, 'ar.json') },
      }),
      routes: ['/untranslated-text/bad'],
      browser,
      only: ['untranslated-text'],
      outDir: mkdtempSync(join(tmpdir(), 'miraya-locales-')),
    })
    const findings = result.routes[0]?.findings ?? []
    expect(
      findings.map((f) => [f.evidence.text, f.evidence.translation, f.evidence.translationKey]),
    ).toEqual([
      ['Add to cart', 'missing', 'shop.addToCart'],
      ['Free shipping on all orders', 'not-found', undefined],
    ])
    expect(findings[0]?.evidence.translationFile).toMatch(/fixtures\/site\/locales\/ar\.json$/)
  })
})

describe('pages that crash', () => {
  it('fail the route with the page error instead of checking an empty page', async () => {
    const result = await audit({
      config,
      routes: ['/crash'],
      browser,
      outDir: mkdtempSync(join(tmpdir(), 'miraya-crash-')),
    })
    const route = result.routes[0]
    expect(route?.status).toBe('error')
    expect(route?.findings).toEqual([])
    expect(route?.errors[0]?.message).toMatch(
      /page rendered (nothing|no text), after a page error: .*Missing environment variables/,
    )
    expect(exitCode(result)).toBe(2)
  })
})

describe('the local-storage switch', () => {
  it('sets the key before the app reads it', async () => {
    const result = await audit({
      config: parseConfig({
        ...config,
        locale: { strategy: 'local-storage', key: 'appLanguage', ltr: 'en', rtl: 'ar' },
      }),
      routes: ['/storage'],
      browser,
      outDir: mkdtempSync(join(tmpdir(), 'miraya-storage-')),
    })
    const route = result.routes[0]
    expect(route?.errors).toEqual([])
    expect(route?.findings).toEqual([])
    expect(route?.skippedRules).toEqual([])
  })
})

describe('signing in', () => {
  // What a sign-in leaves behind: a session cookie and a token in localStorage.
  const signInOnPage = async (page: import('@playwright/test').Page) => {
    await page.evaluate(() => {
      document.cookie = 'session=abc; path=/'
      localStorage.setItem('token', 'xyz')
    })
  }

  it('saves the session when the person says they are done', async () => {
    let finish = () => {}
    const done = new Promise<void>((resolve) => (finish = resolve))
    const state = await signIn({
      browser,
      config,
      route: '/storage',
      done,
      onPage: async (page) => {
        await signInOnPage(page)
        finish()
      },
    })
    expect(state.cookies.map((c) => [c.name, c.value])).toEqual([['session', 'abc']])
    expect(state.origins[0]?.localStorage).toContainEqual({ name: 'token', value: 'xyz' })
  })

  it('keeps the session when the window is closed instead', async () => {
    const state = await signIn({
      browser,
      config,
      route: '/storage',
      done: new Promise(() => {}),
      onPage: async (page) => {
        await signInOnPage(page)
        // Give the copy a moment, as a person would take, then close the window.
        await page.waitForTimeout(700)
        await page.close()
      },
    })
    expect(state.cookies.map((c) => c.name)).toEqual(['session'])
  })
})
