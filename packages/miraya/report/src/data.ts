import type { Finding, Report, RouteResult, Severity } from '../../src/types'

export type { Finding, Report, RouteResult, Severity }

/** What core/report.ts inlines into the page. */
export type ReportData = {
  report: Report
  /** Screenshot path from report.json to a data: URI, or to the relative path when not inlined. */
  images: Record<string, string>
}

export const SEVERITIES: Severity[] = ['error', 'warn', 'info']
export const STATUSES = ['new', 'baselined'] as const
export type Status = (typeof STATUSES)[number]

export type Filters = {
  route?: string
  finding?: string
  severity: Severity[]
  rule: string[]
  status: Status[]
}

const list = <T extends string>(value: string | null, allowed?: readonly T[]): T[] =>
  (value ? value.split(',') : []).filter(
    (v): v is T => !!v && (!allowed || allowed.includes(v as T)),
  )

/** Filters live in the URL hash, so a link to a filtered view works (DESIGN.md › report.html). */
export function readHash(hash: string): Filters {
  const params = new URLSearchParams(hash.replace(/^#/, ''))
  return {
    ...(params.get('route') ? { route: params.get('route') as string } : {}),
    ...(params.get('finding') ? { finding: params.get('finding') as string } : {}),
    severity: list(params.get('severity'), SEVERITIES),
    rule: list(params.get('rule')),
    status: list(params.get('status'), STATUSES),
  }
}

export function writeHash(filters: Filters): string {
  const params = new URLSearchParams()
  if (filters.route) params.set('route', filters.route)
  if (filters.finding) params.set('finding', filters.finding)
  if (filters.severity.length) params.set('severity', filters.severity.join(','))
  if (filters.rule.length) params.set('rule', filters.rule.join(','))
  if (filters.status.length) params.set('status', filters.status.join(','))
  return `#${params.toString()}`
}

export const matches = (f: Finding, filters: Filters) =>
  (!filters.severity.length || filters.severity.includes(f.severity)) &&
  (!filters.rule.length || filters.rule.includes(f.rule)) &&
  (!filters.status.length || filters.status.includes(f.status ?? 'new'))
