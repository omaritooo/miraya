import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { HistoryRunSchema, type HistoryRun, type Report } from '../types'
import { writeViewer } from './report'

/** Runs older than this many are dropped from the dashboard, never from the folder. */
const SHOWN = 200

/** The run as the dashboard keeps it: counts and fingerprints, no screenshots. */
export function historyRun(report: Report): HistoryRun {
  const run: HistoryRun = {
    schemaVersion: 1,
    startedAt: report.startedAt,
    durationMs: report.durationMs,
    checks: report.config.checks ?? ['localization'],
    engines: report.engines ?? ['chromium'],
    baselined: report.summary.baselined,
    fixed: report.fixed.length,
    routes: report.routes.map((r) => {
      const lcp = { ltr: r.perf?.ltr?.lcp?.ms, rtl: r.perf?.rtl?.lcp?.ms }
      return {
        route: r.route,
        status: r.status,
        ...(r.errors[0] && r.status === 'error' ? { error: r.errors[0].message } : {}),
        ...(lcp.ltr !== undefined || lcp.rtl !== undefined ? { lcp } : {}),
        findings: r.findings.map((f) => ({
          id: f.id,
          rule: f.rule,
          area: f.area ?? 'localization',
          severity: f.severity,
          ...(f.label ? { label: f.label } : {}),
          ...(f.status === 'baselined' ? { known: true } : {}),
          ...(f.engines ? { engines: f.engines } : {}),
          ...(typeof f.evidence.side === 'string' ? { side: f.evidence.side } : {}),
        })),
      }
    }),
  }
  if (report.run) run.run = report.run
  if (report.routes.some((r) => r.perf?.rtl?.devServer || r.perf?.ltr?.devServer))
    run.devServer = true
  return run
}

/** Adds the run to the folder, one file per run so concurrent CI jobs never conflict. */
export function appendHistory(report: Report, dir: string): string {
  mkdirSync(dir, { recursive: true })
  const stamp = report.startedAt.replace(/[:.]/g, '-')
  const file = join(dir, `${stamp}${report.run?.commit ? `-${report.run.commit}` : ''}.json`)
  writeFileSync(file, `${JSON.stringify(historyRun(report))}\n`)
  return file
}

/** Every readable run, oldest first. A file that doesn't parse is skipped, not fatal. */
export function readHistory(dir: string): HistoryRun[] {
  if (!existsSync(dir)) return []
  const runs: HistoryRun[] = []
  for (const name of readdirSync(dir).filter((n) => n.endsWith('.json'))) {
    try {
      const parsed = HistoryRunSchema.safeParse(JSON.parse(readFileSync(join(dir, name), 'utf8')))
      if (parsed.success) runs.push(parsed.data)
    } catch {
      // A half-written or hand-edited file only loses that run.
    }
  }
  return runs.sort((a, b) => a.startedAt.localeCompare(b.startedAt)).slice(-SHOWN)
}

/** What the viewer reads in dashboard mode. */
export type DashboardData = {
  kind: 'dashboard'
  runs: HistoryRun[]
  /** The newest full report, without screenshots, for the site views. */
  latest?: Report
  /** report.html beside the dashboard, for the newest run's "Open report". */
  reportHref?: string
}

/** Writes dashboard.html from the history folder, next to report.html. */
export function writeDashboard(
  outDir: string,
  historyDir: string,
  latest?: Report,
): { file: string; runs: number } {
  const runs = readHistory(historyDir)
  const file = join(outDir, 'dashboard.html')
  const data: DashboardData = {
    kind: 'dashboard',
    runs,
    ...(latest ? { latest } : {}),
    ...(existsSync(join(outDir, 'report.html')) ? { reportHref: 'report.html' } : {}),
  }
  mkdirSync(outDir, { recursive: true })
  writeViewer(file, data)
  return { file, runs: runs.length }
}
