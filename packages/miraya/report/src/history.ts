import type { HistoryFinding, HistoryRun, Severity, View } from './data'

/** One row of a run's findings, with the page it's on. */
export type RunFinding = HistoryFinding & { route: string }

export const findingsOf = (run: HistoryRun): RunFinding[] =>
  run.routes.flatMap((r) => r.findings.map((f) => ({ ...f, route: r.route })))

export const inArea = (f: HistoryFinding, area: View) =>
  area === 'cross-browser' ? !!f.engines : f.area === area

export const open = (run: HistoryRun) => findingsOf(run).filter((f) => !f.known)

export const countBy = (findings: HistoryFinding[], severity: Severity) =>
  findings.filter((f) => f.severity === severity).length

/** Failed means what the exit code says: a new error, or a page that couldn't be audited. */
export const failed = (run: HistoryRun) =>
  run.routes.some((r) => r.status === 'error') ||
  open(run).some((f) => f.severity === 'error' && f.area !== 'performance') ||
  (!run.devServer && open(run).some((f) => f.severity === 'error'))

/** "Pull request #41", "Production nightly", "main". */
export const runName = (run: HistoryRun) =>
  run.run?.pr ? `Pull request #${run.run.pr}` : (run.run?.channel ?? run.run?.branch ?? 'Local')

export const channelOf = (run: HistoryRun) => run.run?.channel ?? run.run?.branch ?? 'Local'

/**
 * The channels runs came from, the busiest default branch first: "main", then the rest by
 * how recently they ran.
 */
export function channels(runs: HistoryRun[]): string[] {
  const latest = new Map<string, string>()
  for (const r of runs) latest.set(channelOf(r), r.startedAt)
  const names = [...latest.keys()].sort((a, b) =>
    (latest.get(b) ?? '').localeCompare(latest.get(a) ?? ''),
  )
  const main = names.find((n) => n === 'main' || n === 'master')
  return main ? [main, ...names.filter((n) => n !== main)] : names
}

export type Compare = 'week' | 'previous' | `channel:${string}`

const DAY = 24 * 60 * 60 * 1000

/** The run to compare the latest with, or undefined when there's none. */
export function comparison(
  runs: HistoryRun[],
  all: HistoryRun[],
  latest: HistoryRun,
  compare: Compare,
): HistoryRun | undefined {
  if (compare.startsWith('channel:')) {
    const name = compare.slice('channel:'.length)
    return all.filter((r) => channelOf(r) === name && r !== latest).at(-1)
  }
  const before = runs.filter((r) => r.startedAt < latest.startedAt)
  if (compare === 'previous') return before.at(-1)
  if (compare === 'week') {
    const cutoff = new Date(Date.parse(latest.startedAt) - 7 * DAY).toISOString()
    return before.filter((r) => r.startedAt <= cutoff).at(-1) ?? before[0]
  }
  return undefined
}

/** What changed between two runs, by fingerprint. Only pages both runs audited count as fixed. */
export function diff(latest: HistoryRun, base: HistoryRun | undefined) {
  const now = findingsOf(latest)
  if (!base) return { added: now.filter((f) => !f.known), fixed: [], accepted: [] }
  const before = findingsOf(base)
  const had = new Set(before.map((f) => f.id))
  const has = new Set(now.map((f) => f.id))
  const wasKnown = new Set(before.filter((f) => f.known).map((f) => f.id))
  const audited = new Set(latest.routes.filter((r) => r.status === 'ok').map((r) => r.route))
  return {
    added: now.filter((f) => !f.known && !had.has(f.id)),
    fixed: before.filter((f) => !has.has(f.id) && audited.has(f.route)),
    accepted: now.filter((f) => f.known && had.has(f.id) && !wasKnown.has(f.id)),
  }
}

/** The slower language's largest paint on a page, in ms. */
export const lcpOf = (r: HistoryRun['routes'][number]) =>
  Math.max(r.lcp?.ltr ?? -1, r.lcp?.rtl ?? -1)

export const overBudget = (r: HistoryRun['routes'][number]) =>
  r.findings.some((f) => f.rule === 'lcp-budget' && !f.known)

const MONTH = new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric' })
const MOMENT = new Intl.DateTimeFormat('en', {
  month: 'short',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
})
export const day = (iso: string) => MONTH.format(new Date(iso))
export const moment = (iso: string) => MOMENT.format(new Date(iso))
export const took = (ms: number) => {
  const s = Math.round(ms / 1000)
  return s >= 60 ? `${Math.floor(s / 60)} m ${s % 60} s` : `${s} s`
}
