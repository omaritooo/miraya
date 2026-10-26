import { createHash } from 'node:crypto'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { availableParallelism } from 'node:os'
import { join, resolve } from 'node:path'
import { chromium, type Browser, type BrowserContext } from '@playwright/test'
import pkg from '../../package.json'
import { CollectorError } from '../collector'
import { builtinRules } from '../rules'
import type {
  Finding,
  Report,
  ResolvedConfig,
  RouteError,
  RouteResult,
  Rule,
  SnapshotPair,
} from '../types'
import { ConfigError, resolveRules, runRules } from './engine'
import { applyBaseline, readBaseline } from './baseline'
import { buildCrops, screenshotFrame } from './crops'
import { loadTranslations } from './translations'
import { pairSnapshots, type PairingStats } from './pair'
import { canMeasure, measureRoute, NETWORK_NAMES } from './perf'
import {
  openContexts,
  type Contexts,
  RedirectError,
  renderRoute,
  type BeforeCollect,
  type RenderResult,
} from './render'

export type AuditOptions = {
  config: ResolvedConfig
  /** Overrides config.routes. */
  routes?: string[]
  /** Default: .miraya */
  outDir?: string
  rtlOnly?: boolean
  /** Run only these rule ids. */
  only?: string[]
  headed?: boolean
  /** Routes audited in parallel, each worker with its own contexts. Default: min(4, CPUs / 2). */
  concurrency?: number
  /** Keep the lossless PNG screenshots (used for crops) next to the report. */
  keepArtifacts?: boolean
  /** Reuse a browser instead of launching one. */
  browser?: Browser
  /** Audit inside this context (a Playwright test's), leaving it as it was found. */
  context?: BrowserContext
  beforeCollect?: BeforeCollect
  /** For tests; defaults to the built-in rules. */
  rules?: Rule<unknown>[]
  /** Overrides config.baseline: a path, or false to ignore baselines. */
  baseline?: string | false
}

class RouteTimeout extends Error {}

const defaultConcurrency = () => Math.max(1, Math.min(4, Math.floor(availableParallelism() / 2)))

/** Every ignore should document itself (US-6), and name a rule that exists. */
function markerWarnings(markers: RenderResult['markers'], rules: Rule<unknown>[]) {
  const known = new Set(['*', ...rules.map((r) => r.meta.id)])
  const warnings: string[] = []
  for (const { selector, rules: ignored } of markers) {
    for (const [id, reason] of Object.entries(ignored)) {
      if (!known.has(id))
        warnings.push(`data-rtl-ignore on ${selector} names an unknown rule "${id}"`)
      else if (!reason)
        warnings.push(
          `data-rtl-ignore on ${selector} ignores "${id}" without a reason; write "${id}: why"`,
        )
    }
  }
  return warnings
}

const EMPTY_PAIRING: PairingStats = {
  testid: 0,
  path: 0,
  heuristic: 0,
  pathRejected: 0,
  unmatched: { ltr: 0, rtl: 0 },
}

function configHash(config: ResolvedConfig) {
  const json = JSON.stringify(config, (_key, value) =>
    typeof value === 'function' ? '[function]' : value,
  )
  return `sha1:${createHash('sha1').update(json).digest('hex')}`
}

function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new RouteTimeout(`Route timed out after ${ms}ms`)), ms)
  })
  return Promise.race([work, timeout]).finally(() => clearTimeout(timer))
}

/** Audits each route: render twice, collect, pair, run rules. Writes nothing; see writeReport. */
export async function audit(options: AuditOptions): Promise<Report> {
  const { config } = options
  const started = Date.now()
  const outDir = resolve(options.outDir ?? '.miraya')
  const routes = options.routes ?? config.routes ?? []
  if (routes.length === 0) throw new ConfigError('No routes to audit: set `routes` in the config')
  const rtlOnly = options.rtlOnly ?? false

  const rules = options.rules ?? builtinRules
  const only = options.only
  if (only) {
    const unknown = only.filter((id) => !rules.some((r) => r.meta.id === id))
    if (unknown.length) throw new ConfigError(`Unknown rule(s): ${unknown.join(', ')}`)
  }
  // Resolve against every rule, so the config may name rules that `only` leaves out.
  const resolved = resolveRules(rules, config).filter((r) => !only || only.includes(r.rule.meta.id))
  // Read the baseline up front, so a broken file fails the run before any browser work.
  const baselinePath = options.baseline ?? config.baseline
  const baseline = baselinePath === false ? undefined : readBaseline(resolve(baselinePath))
  const translations = loadTranslations(config)
  const measuring = config.checks.includes('performance')

  const given = options.context?.browser() ?? options.browser
  const browser = given ?? (await chromium.launch({ headless: !options.headed }))
  // Inside a Playwright test the runner owns parallelism, so the helper uses one worker.
  const workers = options.context
    ? 1
    : Math.max(1, Math.min(options.concurrency ?? defaultConcurrency(), routes.length))
  const pools: Contexts[] = []
  try {
    // Each worker owns its contexts, which isolates cookies (DESIGN.md › section 11).
    for (let i = 0; i < workers; i++)
      pools.push(await openContexts(browser, config, options.context))
    const first = pools[0]
    if (!first) throw new ConfigError('No browser context could be opened')
    // Abort before the queue starts if the app isn't reachable.
    try {
      await first.forDir('ltr').request.get(config.baseUrl, { timeout: 10_000 })
    } catch (error) {
      throw new ConfigError(`Base URL ${config.baseUrl} is unreachable: ${String(error)}`)
    }

    // Results keep route order whatever order workers finish in, so reports stay deterministic.
    const results: RouteResult[] = new Array(routes.length)
    let next = 0
    await Promise.all(
      pools.map(async (contexts) => {
        while (next < routes.length) {
          const index = next++
          results[index] = await auditRoute(routes[index] as string, contexts)
        }
      }),
    )

    const name = browser.browserType().name()
    const engine = `${name[0]?.toUpperCase()}${name.slice(1)} ${browser.version().split('.')[0]}`
    const performance: Report['performance'] = measuring
      ? {
          engine,
          cpuSlowdown: config.performance.cpuSlowdown,
          network: NETWORK_NAMES[config.performance.network],
          runs: config.performance.runs,
          warmUp: config.performance.warmUp,
          budgets: config.performance.budgets,
        }
      : undefined
    const findings = results.flatMap((r) => r.findings)
    const count = (severity: Finding['severity']) =>
      findings.filter((f) => f.severity === severity).length
    return applyBaseline(
      {
        schemaVersion: 1,
        tool: { name: 'miraya', version: pkg.version },
        startedAt: new Date(started).toISOString(),
        durationMs: Date.now() - started,
        config: {
          hash: configHash(config),
          viewport: config.viewport,
          mode: rtlOnly ? 'rtl-only' : 'pair',
        },
        summary: {
          routes: results.length,
          routeErrors: results.filter((r) => r.status === 'error').length,
          findings: { error: count('error'), warn: count('warn'), info: count('info') },
          new: findings.length,
          baselined: 0,
          fixed: 0,
        },
        ...(performance ? { performance } : {}),
        routes: results,
        fixed: [],
      },
      baseline,
    )
  } finally {
    await Promise.all(pools.map((c) => c.close()))
    if (!given) await browser.close()
  }

  async function auditRoute(route: string, contexts: Contexts): Promise<RouteResult> {
    const routeStart = Date.now()
    const base = {
      route,
      pairing: EMPTY_PAIRING,
      skippedRules: [] as string[],
      notes: [] as string[],
      screenshots: { rtl: '', truncated: false } as RouteResult['screenshots'],
      findings: [] as Finding[],
      errors: [] as RouteError[],
    }
    try {
      return await withTimeout(
        (async (): Promise<RouteResult> => {
          const ltr = rtlOnly
            ? undefined
            : await renderRoute(
                contexts.forDir('ltr'),
                route,
                'ltr',
                config,
                outDir,
                options.beforeCollect,
              )
          const rtl = await renderRoute(
            contexts.forDir('rtl'),
            route,
            'rtl',
            config,
            outDir,
            options.beforeCollect,
          )

          let pair: SnapshotPair
          let pairing = EMPTY_PAIRING
          if (ltr) {
            const paired = pairSnapshots(route, ltr.snapshot, rtl.snapshot)
            pair = paired.pair
            pairing = paired.stats
          } else {
            pair = {
              route,
              rtl: rtl.snapshot,
              matches: [],
              unmatched: { ltr: [], rtl: rtl.snapshot.elements.map((el) => el.key) },
            }
          }
          const crops = Object.fromEntries(
            (
              [
                ['ltr', ltr],
                ['rtl', rtl],
              ] as const
            ).flatMap(([dir, r]) => {
              if (!r) return []
              const png = join(outDir, r.snapshot.screenshot.png)
              const cache = buildCrops(
                png,
                r.snapshot,
                resolved.map((x) => x.rule),
                config.deviceScaleFactor,
              )
              if (!options.keepArtifacts) rmSync(png, { force: true })
              return [[dir, cache]]
            }),
          )
          if (options.keepArtifacts) {
            for (const r of [ltr, rtl]) {
              if (!r) continue
              const file = join(
                outDir,
                r.snapshot.screenshot.png.replace(/\.png$/, '.snapshot.json'),
              )
              writeFileSync(file, `${JSON.stringify(r.snapshot, null, 2)}\n`)
            }
          }
          // A page that threw and drew next to nothing crashed: checking it would report
          // on an empty document, so the route fails with the page's own error instead.
          for (const r of [ltr, rtl]) {
            if (!r) continue
            const drawn = r.snapshot.elements.filter(
              (el) => el.tag !== 'html' && el.tag !== 'body' && el.box.w > 0 && el.box.h > 0,
            )
            const [first] = r.snapshot.pageErrors ?? []
            const textless = !drawn.some((el) => el.text?.value?.trim())
            if (drawn.length === 0 || (first !== undefined && textless)) {
              throw new Error(
                `The ${r.snapshot.dir.toUpperCase()} page rendered ${drawn.length === 0 ? 'nothing' : 'no text'}${first ? `, after a page error: ${first}` : ''}. Nothing was checked.`,
              )
            }
          }
          const perfNotes: string[] = []
          if (measuring) {
            for (const [dir, r] of [
              ['ltr', ltr],
              ['rtl', rtl],
            ] as const) {
              if (!r) continue
              const context = contexts.forDir(dir)
              if (!canMeasure(context)) {
                if (dir === 'rtl')
                  perfNotes.push('Performance needs Chromium, so it was not measured')
                continue
              }
              r.snapshot.perf = await measureRoute(context, route, dir, config)
            }
          }
          const run = runRules(pair, resolved, config, crops, translations)

          const notes = [
            ...(ltr?.notes ?? []),
            ...rtl.notes,
            ...markerWarnings(rtl.markers, builtinRules),
            ...perfNotes,
          ]
          for (const [dir, r] of [
            ['ltr', ltr],
            ['rtl', rtl],
          ] as const) {
            for (const message of r?.snapshot.pageErrors ?? [])
              notes.push(`${dir}: page error: ${message}`)
          }
          if (ltr) {
            const total = ltr.snapshot.elements.length + rtl.snapshot.elements.length
            const unmatched = pairing.unmatched.ltr + pairing.unmatched.rtl
            if (total > 0 && unmatched / total > 0.2) {
              notes.push(
                `${Math.round((unmatched / total) * 100)}% of elements couldn't be paired; add test ids, or use --rtl-only if the locales use different markup`,
              )
            }
          }

          return {
            ...base,
            status: run.errors.length ? 'error' : 'ok',
            durationMs: Date.now() - routeStart,
            pairing,
            skippedRules: run.skippedRules,
            notes,
            screenshots: {
              ...(ltr ? { ltr: ltr.snapshot.screenshot.jpeg } : {}),
              rtl: rtl.snapshot.screenshot.jpeg,
              frames: {
                ...(ltr ? { ltr: screenshotFrame(ltr.snapshot) } : {}),
                rtl: screenshotFrame(rtl.snapshot),
              },
              truncated: !!ltr?.snapshot.screenshot.truncated || rtl.snapshot.screenshot.truncated,
            },
            head: { ...(ltr ? { ltr: ltr.snapshot.head } : {}), rtl: rtl.snapshot.head },
            ...(rtl.snapshot.perf || ltr?.snapshot.perf
              ? {
                  perf: {
                    ...(ltr?.snapshot.perf ? { ltr: ltr.snapshot.perf } : {}),
                    ...(rtl.snapshot.perf ? { rtl: rtl.snapshot.perf } : {}),
                  },
                }
              : {}),
            findings: run.findings,
            errors: run.errors,
          }
        })(),
        // Each measured load gets the time a route gets, so slow throttled pages still finish.
        config.timeouts.routeMs *
          (measuring
            ? 1 + (config.performance.runs + config.performance.warmUp) * (rtlOnly ? 1 : 2)
            : 1),
      )
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const routeError: RouteError =
        error instanceof RedirectError
          ? { kind: 'redirected', message, finalUrl: error.finalUrl }
          : error instanceof CollectorError && /CDP is unavailable/.test(message)
            ? { kind: 'cdp-unavailable', message }
            : error instanceof RouteTimeout
              ? { kind: 'timeout', message }
              : { kind: 'failed', message }
      return { ...base, status: 'error', durationMs: Date.now() - routeStart, errors: [routeError] }
    }
  }
}

/** Writes report.json into outDir and returns its path. */
export function writeReport(report: Report, outDir = '.miraya'): string {
  const dir = resolve(outDir)
  mkdirSync(dir, { recursive: true })
  const file = join(dir, 'report.json')
  writeFileSync(file, `${JSON.stringify(report, null, 2)}\n`)
  return file
}

/**
 * 0 clean, 1 new errors, 2 incomplete results (DESIGN.md › section 12). 2 wins:
 * a run with a crashed route shouldn't read as "here are all the problems".
 */
export function exitCode(report: Report, { allowErrors = false } = {}): 0 | 1 | 2 {
  const errors = report.routes.flatMap((r) => r.errors)
  if (errors.some((e) => e.kind === 'rule-crashed')) return 2
  if (!allowErrors && errors.length > 0) return 2
  const newErrors = report.routes.some((r) =>
    r.findings.some((f) => f.severity === 'error' && f.status !== 'baselined'),
  )
  return newErrors ? 1 : 0
}
