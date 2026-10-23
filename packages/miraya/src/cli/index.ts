import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { chromium } from '@playwright/test'
import { Command, Option } from 'commander'
import pkg from '../../package.json'
import {
  audit,
  builtinRules,
  ConfigError,
  crawl,
  detectProject,
  DOCS_BASE_URL,
  exitCode,
  findConfig,
  parseConfig,
  readBaseline,
  readConfigFile,
  renderConfig,
  resolveRules,
  routeSlug,
  updateBaseline,
  writeBaseline,
  writeGithubOutput,
  writeHtmlReport,
  writeReport,
} from '../core'
import { ReportSchema, type Report, type ResolvedConfig } from '../types'

type CommonOptions = { config?: string; baseUrl?: string }

async function loadCliConfig(opts: CommonOptions): Promise<ResolvedConfig> {
  const file = opts.config ?? findConfig()
  if (!file) {
    throw new ConfigError(
      'No config file: create miraya.config.ts (see the README), or pass --config <path>',
    )
  }
  const input = await readConfigFile(file)
  return parseConfig(
    { ...input, ...(opts.baseUrl ? { baseUrl: opts.baseUrl } : {}) },
    resolve(file),
  )
}

const out = (line = ''): void => {
  process.stdout.write(`${line}\n`)
}
const err = (line = ''): void => {
  process.stderr.write(`${line}\n`)
}

function printSummary(report: Report) {
  for (const route of report.routes) {
    const p = route.pairing
    out(
      `\n${route.route}  ${route.status}  ${route.durationMs}ms  paired ${p.testid + p.path + p.heuristic}, unmatched ${p.unmatched.ltr}/${p.unmatched.rtl}`,
    )
    for (const note of route.notes) out(`  note: ${note}`)
    for (const e of route.errors) out(`  error [${e.kind}]: ${e.message}`)
    for (const f of route.findings) {
      const status = f.status === 'baselined' ? ' (baselined)' : ''
      out(`  ${f.severity.padEnd(5)} ${f.rule.padEnd(21)} ${f.selector}${status}`)
      out(`        ${f.message}`)
    }
  }
  const s = report.summary
  out(
    `\n${s.routes} routes · ${s.findings.error} errors · ${s.findings.warn} warnings · ${s.findings.info} info · ${s.new} new · ${s.baselined} baselined · ${s.fixed} fixed`,
  )
}

/** Routes from --route, --crawl or the config, in that order of precedence. */
async function routesFor(
  opts: { route?: string[]; crawl?: boolean },
  config: ResolvedConfig,
  browser: import('@playwright/test').Browser,
) {
  if (opts.route?.length) return opts.route
  if (opts.crawl) {
    const routes = await crawl(browser, config)
    err(`Crawled ${routes.length} routes from ${config.crawl?.start ?? '/'}`)
    return routes
  }
  return config.routes
}

const program = new Command()
  .name('miraya')
  .description('Finds the bugs that only exist in the right-to-left version of a web app.')
  .version(pkg.version)
  .showHelpAfterError()

program
  .command('init')
  .description('Write a miraya.config for this project, from its framework, i18n setup and pages.')
  .option('--crawl', 'with the app running, find routes by following its links')
  .option('--base-url <url>', 'where the app runs (default: guessed from the dev script)')
  .option('--force', 'overwrite an existing config file')
  .action(async (opts) => {
    const dir = process.cwd()
    const existing = findConfig(dir)
    if (existing && !opts.force) {
      throw new ConfigError(`${existing} already exists; pass --force to replace it`)
    }
    const detected = detectProject(dir)
    if (opts.baseUrl) detected.baseUrl = opts.baseUrl
    if (opts.crawl) {
      const config = parseConfig({
        baseUrl: detected.baseUrl,
        locale: detected.locale,
        crawl: {},
      })
      const browser = await chromium.launch()
      try {
        detected.routes = await crawl(browser, config)
        detected.notes = detected.notes.filter((n) => !n.startsWith('No page files found'))
      } finally {
        await browser.close()
      }
      detected.notes.push(`${detected.routes.length} routes found by following links from /.`)
    }
    const file = join(dir, detected.typescript ? 'miraya.config.ts' : 'miraya.config.mjs')
    writeFileSync(file, renderConfig(detected))
    out(`Wrote ${file}`)
    for (const note of detected.notes) out(`  ${note}`)

    const gitignore = join(dir, '.gitignore')
    const ignored = existsSync(gitignore) ? readFileSync(gitignore, 'utf8') : ''
    if (!/^\/?\.miraya\/?$/m.test(ignored)) {
      appendFileSync(gitignore, `${ignored && !ignored.endsWith('\n') ? '\n' : ''}.miraya/\n`)
      out('Added .miraya/ to .gitignore')
    }
    out('\nStart your app, then run: npx miraya audit')
  })

program
  .command('audit')
  .description('Render each route in LTR and RTL, run the rules and write the reports.')
  .option('-c, --config <path>', 'config file (default: miraya.config.{ts,mts,js,mjs})')
  .option('-r, --route <route...>', 'audit these routes instead of the config routes')
  .option('--base-url <url>', 'override the config baseUrl')
  .option('--crawl', 'crawl from config.crawl.start instead of a route list')
  .option('-o, --out <dir>', 'output folder', '.miraya')
  .option('--format <list>', 'json,html,github; github is added on GitHub Actions', 'json,html')
  .option('--rule <id...>', 'run only these rules')
  .option('--rtl-only', 'skip the LTR render and the rules that need it')
  .addOption(
    new Option('--concurrency <n>', 'routes audited in parallel').argParser((v) => Number(v)),
  )
  .option('--keep-artifacts', 'keep PNG screenshots and snapshot JSON for every route')
  .option('--allow-errors', "route errors don't force exit code 2")
  .option('--headed', 'show the browser')
  .action(async (opts) => {
    const config = await loadCliConfig(opts)
    const browser = await chromium.launch({ headless: !opts.headed })
    let report: Report
    try {
      report = await audit({
        config,
        routes: await routesFor(opts, config, browser),
        outDir: opts.out,
        browser,
        rtlOnly: !!opts.rtlOnly,
        keepArtifacts: !!opts.keepArtifacts,
        ...(opts.rule ? { only: opts.rule } : {}),
        ...(opts.concurrency ? { concurrency: opts.concurrency } : {}),
      })
    } finally {
      await browser.close()
    }
    const formats = new Set(
      String(opts.format)
        .split(',')
        .map((f) => f.trim()),
    )
    if (process.env.GITHUB_ACTIONS === 'true') formats.add('github')
    const json = writeReport(report, opts.out)
    printSummary(report)
    out(`Report: ${json}`)
    if (formats.has('html')) {
      const html = writeHtmlReport(report, opts.out, {
        maxInlineBytes: config.report.maxInlineBytes,
      })
      out(
        `        ${html.file}${html.inlined ? '' : ' (screenshots referenced, not inlined: keep the routes/ folder with it)'}`,
      )
    }
    if (formats.has('github')) writeGithubOutput(report)
    process.exitCode = exitCode(report, { allowErrors: !!opts.allowErrors })
  })

const baseline = program
  .command('baseline')
  .description('Manage the baseline of accepted findings.')
baseline
  .command('update')
  .description('Accept the current findings. Only the audited routes are replaced; notes are kept.')
  .option('-c, --config <path>', 'config file')
  .option('-r, --route <route...>', 'update only these routes')
  .option('--base-url <url>', 'override the config baseUrl')
  .option('-o, --out <dir>', 'output folder for screenshots', '.miraya')
  .action(async (opts) => {
    const config = await loadCliConfig(opts)
    if (config.baseline === false)
      throw new ConfigError('Baselines are switched off in the config (baseline: false)')
    const path = resolve(config.baseline)
    const existing = readBaseline(path)
    const browser = await chromium.launch()
    let report: Report
    try {
      report = await audit({
        config,
        routes: await routesFor(opts, config, browser),
        outDir: opts.out,
        browser,
        baseline: false,
      })
    } finally {
      await browser.close()
    }
    const failed = report.routes.filter((r) => r.status === 'error')
    if (failed.length) {
      for (const r of failed)
        err(`${r.route}: ${r.errors.map((e) => `${e.kind}: ${e.message}`).join('; ')}`)
      throw new ConfigError("Some routes couldn't be audited, so the baseline wasn't changed")
    }
    const next = updateBaseline(existing, report)
    writeBaseline(path, next)
    out(`Wrote ${next.entries.length} entries to ${path} (${report.routes.length} routes updated).`)
  })

program
  .command('explain')
  .description('Show the measurements behind one finding.')
  .argument('<id>', 'finding id, or a unique prefix of it')
  .option('--report <path>', 'report to read', '.miraya/report.json')
  .option('-c, --config <path>', 'config file, for the resolved rule options')
  .action(async (id: string, opts) => {
    const file = resolve(opts.report)
    if (!existsSync(file)) throw new ConfigError(`No report at ${file}; run \`miraya audit\` first`)
    const report = ReportSchema.parse(JSON.parse(readFileSync(file, 'utf8')))
    const all = report.routes.flatMap((r) => r.findings)
    const hits = all.filter((f) => f.id.startsWith(id))
    if (hits.length === 0) throw new ConfigError(`No finding with id ${id} in ${file}`)
    if (hits.length > 1) {
      throw new ConfigError(
        `"${id}" matches ${hits.length} findings; use more characters:\n${hits.map((f) => `  ${f.id}  ${f.rule} ${f.selector}`).join('\n')}`,
      )
    }
    const f = hits[0] as (typeof hits)[number]
    out(`${f.rule} (${f.severity}${f.status ? `, ${f.status}` : ''}) on ${f.route}`)
    out(`Element:  ${f.selector}`)
    if (f.match) out(`Paired by: ${f.match}`)
    if (f.sourceHint) out(`Source:   ${f.sourceHint}`)
    if (f.possiblyMoved) out(`Possibly moved from baseline entry ${f.possiblyMoved}`)
    out(`\n${f.message}\n`)
    out('Evidence')
    const width = Math.max(...Object.keys(f.evidence).map((k) => k.length))
    for (const [k, v] of Object.entries(f.evidence)) out(`  ${k.padEnd(width)}  ${String(v)}`)
    for (const dir of ['ltr', 'rtl'] as const) {
      const b = f.boxes[dir]
      const r = (n: number) => Math.round(n * 10) / 10
      if (b) out(`Box ${dir}:  x ${r(b.x)}, y ${r(b.y)}, w ${r(b.w)}, h ${r(b.h)}`)
    }

    const rule = builtinRules.find((r) => r.meta.id === f.rule)
    if (rule) {
      const configFile = opts.config ?? findConfig()
      const config = configFile
        ? parseConfig({ ...(await readConfigFile(configFile)), baseUrl: 'http://localhost' })
        : parseConfig({ baseUrl: 'http://localhost' })
      const resolved = resolveRules([rule], config)[0]
      out(`\nRule options${configFile ? '' : ' (defaults; no config file found)'}`)
      out(`  ${JSON.stringify(resolved?.options ?? {})}`)
    }
    const snapshots = join(resolve(opts.report, '..'), 'routes', routeSlug(f.route))
    for (const dir of ['ltr', 'rtl']) {
      const snap = join(snapshots, `${dir}.snapshot.json`)
      if (existsSync(snap)) out(`Snapshot: ${snap}`)
    }
    out(`\nDocs: ${f.docsUrl}`)
  })

program
  .command('rules')
  .description('List the rules with their defaults.')
  .option('--json', 'machine-readable output')
  .action((opts) => {
    const rows = builtinRules.map((r) => ({
      id: r.meta.id,
      severity: r.meta.defaultSeverity,
      needs: r.meta.needs,
      experimental: !!r.meta.experimental,
      docs: `${DOCS_BASE_URL}${r.meta.docs}`,
    }))
    if (opts.json) return out(JSON.stringify(rows, null, 2))
    for (const r of rows) {
      out(
        `${r.id.padEnd(22)} ${r.severity.padEnd(6)} needs ${r.needs.padEnd(5)}${r.experimental ? ' experimental' : ''}  ${r.docs}`,
      )
    }
  })

program.parseAsync().catch((error: unknown) => {
  err(error instanceof Error ? error.message : String(error))
  process.exitCode = 2
})
