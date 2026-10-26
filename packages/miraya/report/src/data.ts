import type {
  Area,
  Engine,
  Finding,
  PageHead,
  PagePerf,
  Report,
  ResourceType,
  RouteResult,
  Severity,
} from '../../src/types'

export type {
  Area,
  Engine,
  Finding,
  PageHead,
  PagePerf,
  Report,
  ResourceType,
  RouteResult,
  Severity,
}

/** What core/report.ts inlines into the page. */
export type ReportData = {
  report: Report
  /** Screenshot path from report.json to a data: URI, or to the relative path when not inlined. */
  images: Record<string, string>
}

export const SEVERITIES: Severity[] = ['error', 'warn', 'info']
export const STATUSES = ['new', 'known', 'all'] as const
export type Status = (typeof STATUSES)[number]

/** A tab: an area, or cross-browser, which gathers the findings only some engines saw. */
export type View = Area | 'cross-browser'

export const AREAS: { id: View; label: string }[] = [
  { id: 'localization', label: 'Localization' },
  { id: 'seo', label: 'SEO' },
  { id: 'performance', label: 'Performance' },
  { id: 'cross-browser', label: 'Cross-browser' },
]
/** Reports from before areas existed only have localization findings. */
export const areaOf = (f: Finding): Area => f.area ?? 'localization'
/** Whether a finding belongs on a tab. A cross-browser difference shows in its area's tab too. */
export const inView = (f: Finding, view: View) =>
  view === 'cross-browser' ? !!f.engines : areaOf(f) === view

export const ENGINE_NAMES: Record<Engine, string> = {
  chromium: 'Chromium',
  firefox: 'Firefox',
  webkit: 'WebKit',
}
/** "Chromium, WebKit and Firefox" */
export function engineWords(engines: Engine[]) {
  const names = engines.map((e) => ENGINE_NAMES[e])
  return names.length > 1
    ? `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`
    : (names[0] ?? '')
}

export type Filters = {
  area: View
  route?: string
  finding?: string
  /** Severities to show; empty shows all. */
  severity: Severity[]
  rule?: string
  /** One of New, Known or All. New is the default: it's what fails the run. */
  status: Status
  /** A site-wide SEO table instead of one page. */
  site?: 'titles' | 'links'
}

const list = <T extends string>(value: string | null, allowed: readonly T[]): T[] =>
  (value ? value.split(',') : []).filter((v): v is T => allowed.includes(v as T))

/** Filters live in the URL hash, so a link to a filtered view works (DESIGN.md › report.html). */
export function readHash(hash: string): Filters {
  const params = new URLSearchParams(hash.replace(/^#/, ''))
  const status = params.get('status') as Status | null
  const area = params.get('area')
  return {
    area: AREAS.find((a) => a.id === area)?.id ?? 'localization',
    ...(params.get('route') ? { route: params.get('route') as string } : {}),
    ...(params.get('finding') ? { finding: params.get('finding') as string } : {}),
    ...(params.get('rule') ? { rule: params.get('rule') as string } : {}),
    severity: list(params.get('severity'), SEVERITIES),
    status: status && STATUSES.includes(status) ? status : 'new',
    ...(params.get('site') === 'titles' || params.get('site') === 'links'
      ? { site: params.get('site') as 'titles' | 'links' }
      : {}),
  }
}

export function writeHash(filters: Filters): string {
  const params = new URLSearchParams()
  if (filters.area !== 'localization') params.set('area', filters.area)
  if (filters.route) params.set('route', filters.route)
  if (filters.finding) params.set('finding', filters.finding)
  if (filters.severity.length) params.set('severity', filters.severity.join(','))
  if (filters.rule) params.set('rule', filters.rule)
  if (filters.status !== 'new') params.set('status', filters.status)
  if (filters.site) params.set('site', filters.site)
  return `#${params.toString()}`
}

export const isKnown = (f: Finding) => f.status === 'baselined'

export const matches = (f: Finding, filters: Filters) =>
  inView(f, filters.area) &&
  (!filters.severity.length || filters.severity.includes(f.severity)) &&
  (!filters.rule || filters.rule === f.rule) &&
  (filters.status === 'all' || (filters.status === 'known') === isKnown(f))

/** The worst severity among a page's open findings, or undefined when nothing is open. */
export const worst = (findings: Finding[]) =>
  SEVERITIES.find((sev) => findings.some((f) => f.severity === sev && !isKnown(f)))
