import { test, type Page } from '@playwright/test'
import {
  audit,
  findConfig,
  parseConfig,
  readConfigFile,
  writeHtmlReport,
  writeReport,
  type Area,
  type ConfigInput,
  type Dir,
  type Finding,
  type RouteResult,
  type RuleSetting,
  type Severity,
  type SwitchTo,
} from '@miraya/cli'

export interface AuditOptions {
  /** The route, resolved against Playwright's baseURL. */
  url: string
  /** How this app switches direction. Defaults to the config file's locale, else 'attribute'. */
  switchTo?: SwitchTo
  /** Merged over the config file's rules. */
  rules?: Record<string, RuleSetting>
  /** A baseline path, or false to ignore baselines in this test. */
  baseline?: string | false
  rtlOnly?: boolean
  /**
   * The areas to check. Defaults to the config file's `checks`, else localization only:
   * `rtl.expectClean` is about the RTL layout, so SEO runs only when asked for.
   */
  checks?: Area[]
  /** Runs after the page settles and before collection, in both directions. */
  beforeCollect?: (page: Page, dir: Dir) => Promise<void>
  /** Path to a config file. Defaults to miraya.config.{ts,mts,js,mjs} in the working directory. */
  config?: string
}

export interface AuditResult {
  /** The same shape as report.json routes[n]. */
  route: RouteResult
  /** New findings at error severity. */
  newErrors: Finding[]
}

const RANK: Record<Severity, number> = { info: 0, warn: 1, error: 2 }
const SHOWN_IN_MESSAGE = 10

async function configFor(opts: AuditOptions) {
  const file = opts.config ?? findConfig()
  const fromFile: Partial<ConfigInput> = file ? await readConfigFile(file) : {}
  const baseURL = test.info().project.use.baseURL
  const baseUrl = baseURL ?? fromFile.baseUrl
  if (!baseUrl) {
    throw new Error(
      'Miraya needs a base URL: set `use.baseURL` in playwright.config, or `baseUrl` in miraya.config.ts',
    )
  }
  return parseConfig(
    {
      ...fromFile,
      baseUrl,
      ...(opts.switchTo ? { locale: opts.switchTo } : {}),
      rules: { ...fromFile.rules, ...opts.rules },
      checks: opts.checks ?? fromFile.checks ?? ['localization'],
      ...(opts.baseline !== undefined ? { baseline: opts.baseline } : {}),
    },
    file ?? 'Miraya options',
  )
}

/**
 * Audits one route in LTR and RTL. Opens its own pages in the test's context, so the
 * test can keep using `page`, and attaches the report to the test result.
 */
async function auditPage(page: Page, opts: AuditOptions): Promise<AuditResult> {
  const info = test.info()
  const outDir = info.outputPath('miraya')
  const resolved = await configFor(opts)
  const report = await audit({
    config: resolved,
    routes: [opts.url],
    context: page.context(),
    outDir,
    ...(opts.rtlOnly !== undefined ? { rtlOnly: opts.rtlOnly } : {}),
    ...(opts.beforeCollect ? { beforeCollect: opts.beforeCollect } : {}),
  })
  await info.attach('miraya-report.json', {
    path: writeReport(report, outDir),
    contentType: 'application/json',
  })
  const html = writeHtmlReport(report, outDir, { maxInlineBytes: resolved.report.maxInlineBytes })
  await info.attach('miraya-report.html', { path: html.file, contentType: 'text/html' })
  const route = report.routes[0]
  if (!route) throw new Error(`Miraya returned no result for ${opts.url}`)
  for (const [dir, file] of Object.entries(route.screenshots)) {
    if (typeof file === 'string' && file) {
      await info.attach(`miraya-${dir}.jpg`, {
        path: `${outDir}/${file}`,
        contentType: 'image/jpeg',
      })
    }
  }
  const newErrors = route.findings.filter((f) => f.status === 'new' && f.severity === 'error')
  return { route, newErrors }
}

/** Fails the test when the route has new findings at or above `failOn` (default: error), or couldn't be audited. */
async function expectClean(page: Page, opts: AuditOptions & { failOn?: Severity }): Promise<void> {
  const { route } = await auditPage(page, opts)
  if (route.errors.length > 0) {
    throw new Error(
      `Miraya couldn't audit ${opts.url}:\n${route.errors.map((e) => `  ${e.kind}: ${e.message}`).join('\n')}`,
    )
  }
  const threshold = RANK[opts.failOn ?? 'error']
  const failing = route.findings.filter((f) => f.status === 'new' && RANK[f.severity] >= threshold)
  if (failing.length === 0) return
  const lines = failing
    .slice(0, SHOWN_IN_MESSAGE)
    .map(
      (f, i) =>
        `  ${i + 1}. ${f.rule} (${f.severity}) ${f.selector}\n     ${f.message}\n     ${f.docsUrl}`,
    )
  const more =
    failing.length > SHOWN_IN_MESSAGE ? `\n  ...and ${failing.length - SHOWN_IN_MESSAGE} more.` : ''
  const noun = failing.length === 1 ? 'problem' : 'problems'
  throw new Error(
    `Miraya found ${failing.length} new RTL ${noun} on ${opts.url}:\n${lines.join('\n')}${more}\nThe full report is attached to this test.`,
  )
}

export const rtl = { audit: auditPage, expectClean }
