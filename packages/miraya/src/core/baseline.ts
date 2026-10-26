import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { BaselineSchema, type Baseline, type Finding, type Report } from '../types'
import { ConfigError, zodIssuePath } from './engine'

type Entry = Baseline['entries'][number]

export function readBaseline(path: string): Baseline | undefined {
  if (!existsSync(path)) return undefined
  let json: unknown
  try {
    json = JSON.parse(readFileSync(path, 'utf8'))
  } catch (error) {
    throw new ConfigError(
      `Baseline ${path} isn't valid JSON (${String(error)}); run \`miraya baseline update\` to recreate it`,
    )
  }
  const parsed = BaselineSchema.safeParse(json)
  if (!parsed.success) {
    throw new ConfigError(
      `Baseline ${path} doesn't match schema version 1:\n${zodIssuePath(parsed.error)}\nRun \`miraya baseline update\` to recreate it`,
    )
  }
  return parsed.data
}

const byRouteRuleFingerprint = (a: Entry, b: Entry) =>
  a.route.localeCompare(b.route) ||
  a.rule.localeCompare(b.rule) ||
  a.fingerprint.localeCompare(b.fingerprint)

/** Sorted, one entry per line, so diffs in review stay readable and merges usually clean. */
export function writeBaseline(path: string, baseline: Baseline) {
  const entries = [...baseline.entries].sort(byRouteRuleFingerprint)
  const lines = entries.map((e) => `    ${JSON.stringify(e)}`)
  writeFileSync(
    path,
    `{\n  "schemaVersion": 1,\n  "entries": [\n${lines.join(',\n')}${lines.length ? '\n' : ''}  ]\n}\n`,
  )
}

/**
 * Splits a report's findings into new, baselined and fixed (DESIGN.md › section 8).
 * Only routes in this report can have fixed entries: a partial run says nothing about
 * the routes it didn't audit. A new finding that shares rule and route with a fixed
 * entry is marked "possibly moved"; it can't be merged automatically, because that
 * would let the baseline hide real regressions.
 */
export function applyBaseline(report: Report, baseline: Baseline | undefined): Report {
  const known = new Set(baseline?.entries.map((e) => e.fingerprint))
  const audited = new Set(report.routes.map((r) => r.route))
  const found = new Set(report.routes.flatMap((r) => r.findings.map((f) => f.id)))
  const fixed = (baseline?.entries ?? [])
    .filter((e) => audited.has(e.route) && !found.has(e.fingerprint))
    .map(({ fingerprint, rule, route }) => ({ fingerprint, rule, route }))

  const routes = report.routes.map((route) => ({
    ...route,
    findings: route.findings.map((f): Finding => {
      if (known.has(f.id)) return { ...f, status: 'baselined' }
      const moved = fixed.find((e) => e.rule === f.rule && e.route === f.route)
      return { ...f, status: 'new', ...(moved ? { possiblyMoved: moved.fingerprint } : {}) }
    }),
  }))
  const all = routes.flatMap((r) => r.findings)
  return {
    ...report,
    routes,
    fixed,
    summary: {
      ...report.summary,
      new: all.filter((f) => f.status === 'new').length,
      baselined: all.filter((f) => f.status === 'baselined').length,
      fixed: fixed.length,
    },
  }
}

/**
 * Accepts the current findings. Replaces entries only for the routes in this report,
 * keeps every other route's entries, and keeps notes for fingerprints still present.
 */
export function updateBaseline(baseline: Baseline | undefined, report: Report): Baseline {
  const audited = new Set(report.routes.map((r) => r.route))
  const notes = new Map(baseline?.entries.filter((e) => e.note).map((e) => [e.fingerprint, e.note]))
  const kept = (baseline?.entries ?? []).filter((e) => !audited.has(e.route))
  const seen = new Set<string>()
  const current: Entry[] = []
  for (const f of report.routes.flatMap((r) => r.findings)) {
    if (seen.has(f.id)) continue
    seen.add(f.id)
    const note = notes.get(f.id)
    current.push({ fingerprint: f.id, rule: f.rule, route: f.route, ...(note ? { note } : {}) })
  }
  return { schemaVersion: 1, entries: [...kept, ...current].sort(byRouteRuleFingerprint) }
}

/**
 * Accepts single findings from a report, by fingerprint, leaving the rest of the baseline
 * alone. Returns the fingerprints the report didn't have, so a typo isn't silently ignored.
 */
export function acceptFindings(
  baseline: Baseline | undefined,
  report: Report,
  fingerprints: string[],
): { baseline: Baseline; missing: string[] } {
  const entries = [...(baseline?.entries ?? [])]
  const have = new Set(entries.map((e) => e.fingerprint))
  const findings = new Map(report.routes.flatMap((r) => r.findings).map((f) => [f.id, f]))
  const missing: string[] = []
  for (const id of fingerprints) {
    const f: Finding | undefined = findings.get(id)
    if (!f) missing.push(id)
    else if (!have.has(id)) {
      have.add(id)
      entries.push({ fingerprint: id, rule: f.rule, route: f.route })
    }
  }
  return { baseline: { schemaVersion: 1, entries: entries.sort(byRouteRuleFingerprint) }, missing }
}
