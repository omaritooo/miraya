import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { GLYPHS, plural, ruleTitle } from './copy'
import {
  areaOf,
  AREAS,
  isKnown,
  matches,
  readHash,
  SEVERITIES,
  worst,
  writeHash,
  type Filters,
  type Finding,
  type Report as ReportJson,
  type ReportData,
  type RouteResult,
  type Status,
} from './data'
import { Inspector, type Tab } from './Inspector'
import { Segmented, SeverityCounts } from './ui'
import { SeoStage } from './SeoStage'
import { Stage } from './Stage'

function useHashFilters(): [Filters, (next: Partial<Filters>) => void] {
  const [filters, setFilters] = useState(() => readHash(location.hash))
  useEffect(() => {
    const onHash = () => setFilters(readHash(location.hash))
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])
  const update = useCallback((next: Partial<Filters>) => {
    setFilters((current) => {
      const merged = { ...current, ...next }
      history.replaceState(null, '', writeHash(merged))
      return merged
    })
  }, [])
  return [filters, update]
}

function toggle<T>(list: T[], value: T): T[] {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value]
}

const typing = (target: EventTarget | null) =>
  target instanceof HTMLElement && /^(INPUT|SELECT|TEXTAREA)$/.test(target.tagName)

const SEVERITY_FILTERS = { error: 'Errors', warn: 'Warnings', info: 'Info' } as const
const STATUS_LABELS: Record<Status, string> = { new: 'New', known: 'Known', all: 'All' }
// Below this many clean pages they're listed; above it they fold into one row.
const CLEAN_LISTED = 3

export function App({ data }: { data: ReportData | null }) {
  const [filters, update] = useHashFilters()
  if (!data) {
    return (
      <main className="empty">
        <h1>No report data</h1>
        <p>Miraya fills this viewer in when it writes report.html.</p>
      </main>
    )
  }
  return <Report report={data.report} images={data.images} filters={filters} update={update} />
}

function Report({
  report,
  images,
  filters,
  update,
}: ReportData & { filters: Filters; update: (next: Partial<Filters>) => void }) {
  const inArea = useCallback((f: Finding) => areaOf(f) === filters.area, [filters.area])
  // Without a choice, open the first page with something to look at.
  const route =
    report.routes.find((r) => r.route === filters.route) ??
    report.routes.find((r) => r.status === 'error' || worst(r.findings.filter(inArea))) ??
    report.routes[0]
  const rules = useMemo(
    () =>
      [
        ...new Set(report.routes.flatMap((r) => r.findings.filter(inArea).map((f) => f.rule))),
      ].sort(),
    [report, inArea],
  )
  // SEO shows once a report has head tags: reports from before 0.4 have only localization.
  const areas = AREAS.filter(
    (a) =>
      a.id === 'localization' ||
      a.id === filters.area ||
      report.routes.some((r) => r.head || r.findings.some((f) => areaOf(f) === a.id)),
  )
  const visible = useMemo(
    () => (route ? route.findings.filter((f) => matches(f, filters)) : []),
    [route, filters],
  )
  // Something is always selected, so the details never wait for a first click.
  const selected = visible.find((f) => f.id === filters.finding) ?? visible[0]
  const [byKeyboard, setByKeyboard] = useState(false)
  const [tab, setTab] = useState<Tab>('findings')
  const pageFilter = useRef<HTMLInputElement>(null)

  const select = useCallback(
    (id: string, keyboard = false) => {
      setByKeyboard(keyboard)
      setTab('findings')
      update({ finding: id })
    },
    [update],
  )

  // j / k move through findings, / jumps to the page filter. Keyboard moves never animate.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (typing(e.target) || e.metaKey || e.ctrlKey || e.altKey) return
      if (e.key === '/') {
        e.preventDefault()
        pageFilter.current?.focus()
        return
      }
      if (e.key !== 'j' && e.key !== 'k') return
      const index = selected ? visible.indexOf(selected) : -1
      const next = visible.at(
        Math.min(visible.length - 1, Math.max(0, index + (e.key === 'j' ? 1 : -1))),
      )
      if (next) select(next.id, true)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [visible, selected, select])

  const all = report.routes.flatMap((r) => r.findings)
  const open = all.filter((f) => !isKnown(f))

  return (
    <div className="app">
      <a className="skip" href="#findings">
        Skip to findings
      </a>
      <header className="topbar">
        <div className="topbar-run">
          <p className="brand">
            <span className="brand-mark" aria-hidden="true" />
            Miraya<span className="sr"> report</span>
          </p>
          <RunFacts report={report} />
          <span className="spacer" />
          <Verdict report={report} />
        </div>
        <div className="topbar-areas">
          <nav className="areas" aria-label="Areas">
            {areas.map((a) => (
              <a
                key={a.id}
                href={writeHash({ ...filters, area: a.id, finding: undefined, rule: undefined })}
                aria-current={a.id === filters.area ? 'page' : undefined}
                className="area"
                onClick={(e) => {
                  e.preventDefault()
                  update({ area: a.id, finding: undefined, rule: undefined })
                }}
              >
                <span className={`area-dot area-${a.id}`} aria-hidden="true" />
                {a.label}
                <SeverityCounts findings={open.filter((f) => areaOf(f) === a.id)} />
              </a>
            ))}
          </nav>
          <span className="spacer" />
          <div className="filters" role="group" aria-label="Filters">
            <div className="chips" role="group" aria-label="Severity">
              {SEVERITIES.map((sev) => (
                <button
                  type="button"
                  key={sev}
                  className={`chip sev-${sev}`}
                  aria-pressed={!filters.severity.length || filters.severity.includes(sev)}
                  onClick={() =>
                    update({
                      severity: toggle(
                        filters.severity.length ? filters.severity : SEVERITIES,
                        sev,
                      ),
                      finding: undefined,
                    })
                  }
                >
                  <span aria-hidden="true">{GLYPHS[sev]}</span> {SEVERITY_FILTERS[sev]}
                </button>
              ))}
            </div>
            <Segmented
              label="Status"
              options={['new', 'known', 'all'] as const}
              value={filters.status}
              text={(s) => STATUS_LABELS[s]}
              onChange={(status) => update({ status, finding: undefined })}
            />
            <label className="field">
              Rule
              <select
                value={filters.rule ?? ''}
                onChange={(e) => update({ rule: e.target.value || undefined, finding: undefined })}
              >
                <option value="">All rules</option>
                {rules.map((rule) => (
                  <option key={rule} value={rule} title={ruleTitle(rule)}>
                    {rule}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </div>
      </header>

      <div className="layout">
        <Pages
          report={report}
          current={route}
          filters={filters}
          update={update}
          inputRef={pageFilter}
        />
        {route ? (
          <>
            {filters.area === 'seo' ? (
              <SeoStage
                route={route}
                findings={visible}
                selected={selected}
                onSelect={(id) => select(id)}
              />
            ) : (
              <Stage
                route={route}
                findings={visible}
                selected={selected}
                images={images}
                viewportWidth={report.config.viewport.w}
                onSelect={(id) => select(id)}
                onNotes={() => setTab('notes')}
                instant={byKeyboard}
              />
            )}
            <Inspector
              route={route}
              findings={visible}
              selected={selected}
              onSelect={(id) => select(id)}
              tab={tab}
              onTab={setTab}
              area={filters.area}
            />
          </>
        ) : (
          <p className="empty">This report has no pages.</p>
        )}
      </div>
    </div>
  )
}

function RunFacts({ report }: { report: ReportJson }) {
  const started = new Date(report.startedAt)
  const when = started.toLocaleString('en', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
  const seconds = Math.round(report.durationMs / 1000)
  const took = seconds >= 60 ? `${Math.floor(seconds / 60)} m ${seconds % 60} s` : `${seconds} s`
  return (
    <p className="run-facts">
      <span>
        {report.tool.name} {report.tool.version}
      </span>
      <span aria-hidden="true">·</span>
      <time dateTime={report.startedAt}>{when}</time>
      <span aria-hidden="true">·</span>
      <span>{took}</span>
    </p>
  )
}

/** The run's result in one line, the same rule the exit code follows. */
function Verdict({ report }: { report: ReportJson }) {
  const open = report.routes.flatMap((r) => r.findings).filter((f) => !isKnown(f))
  const errors = open.filter((f) => f.severity === 'error')
  const warnings = open.filter((f) => f.severity === 'warn')
  const errorPages = new Set(errors.map((f) => f.route)).size
  const failedPages = report.routes.filter((r) => r.status === 'error').length
  const failed = errors.length > 0 || failedPages > 0
  const parts = [
    errors.length
      ? `${plural(errors.length, 'new error')} on ${plural(errorPages, 'page')}`
      : warnings.length
        ? `No new errors, ${plural(warnings.length, 'new warning')}`
        : `Nothing new on ${plural(report.summary.routes, 'page')}`,
    failedPages ? `${plural(failedPages, 'page')} couldn't be audited` : '',
  ].filter(Boolean)
  return (
    <p className="verdict">
      <span className={`pill ${failed ? 'pill-error' : 'pill-pos'}`}>
        <span aria-hidden="true">{failed ? '◆' : '✓'}</span>
        {failed ? 'Failed' : 'Passed'}
      </span>
      <span>{parts.join(', ')}</span>
    </p>
  )
}

function Pages({
  report,
  current,
  filters,
  update,
  inputRef,
}: {
  report: ReportJson
  current: RouteResult | undefined
  filters: Filters
  update: (next: Partial<Filters>) => void
  inputRef: React.RefObject<HTMLInputElement>
}) {
  const [query, setQuery] = useState('')
  const [showClean, setShowClean] = useState(false)
  const shown = report.routes.filter((r) => r.route.toLowerCase().includes(query.toLowerCase()))
  const scoped = (r: RouteResult) => r.findings.filter((f) => areaOf(f) === filters.area)
  const isClean = (r: RouteResult) => r.status === 'ok' && !worst(scoped(r))
  const clean = shown.filter(isClean)
  // The current page always stays in the list, even when its group is folded.
  const fold = !query && !showClean && clean.length > CLEAN_LISTED
  const listed = fold ? shown.filter((r) => !isClean(r) || r === current) : shown
  const folded = fold ? clean.filter((r) => r !== current).length : 0
  const accepted = report.summary.baselined

  return (
    <aside className="pages" aria-label="Pages">
      <div className="search">
        <label className="sr" htmlFor="page-filter">
          Filter pages
        </label>
        <input
          id="page-filter"
          ref={inputRef}
          type="search"
          placeholder="Filter pages"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <kbd aria-hidden="true">/</kbd>
      </div>
      <h2 className="overline">Pages · {report.routes.length}</h2>
      <ul className="page-list">
        {listed.map((r) => {
          const open = scoped(r).filter((f) => !isKnown(f))
          const sev = worst(open)
          const failed = r.status === 'error'
          return (
            <li key={r.route}>
              <a
                href={writeHash({ ...filters, route: r.route, finding: undefined })}
                aria-current={r === current ? 'page' : undefined}
                onClick={(e) => {
                  e.preventDefault()
                  update({ route: r.route, finding: undefined })
                }}
              >
                <span
                  className={`glyph ${failed ? 'sev-error' : sev ? `sev-${sev}` : ''}`}
                  aria-hidden="true"
                >
                  {failed ? '⊠' : sev ? GLYPHS[sev] : '○'}
                </span>
                <bdi className="page-path" dir="ltr">
                  <code>{r.route}</code>
                </bdi>
                {failed ? (
                  <span className="page-count sev-error">failed</span>
                ) : open.length ? (
                  <span className="page-count">
                    {open.length}
                    <span className="sr"> {open.length === 1 ? 'finding' : 'findings'}</span>
                  </span>
                ) : (
                  <span className="sr">clean</span>
                )}
              </a>
            </li>
          )
        })}
        {folded ? (
          <li>
            <button
              type="button"
              className="page-fold"
              aria-expanded="false"
              onClick={() => setShowClean(true)}
            >
              <span className="glyph" aria-hidden="true">
                ○
              </span>
              {plural(folded, 'clean page')}
            </button>
          </li>
        ) : null}
        {shown.length === 0 ? <li className="page-none">No page matches “{query}”.</li> : null}
      </ul>

      {report.fixed.length > 0 ? (
        <>
          <h2 className="overline">Fixed · {report.fixed.length}</h2>
          <ul className="fixed-list">
            {report.fixed.map((f) => (
              <li key={f.fingerprint}>
                <span className="pos" aria-hidden="true">
                  ✓
                </span>
                <span>
                  <code>{f.rule}</code> <span className="muted">on</span>{' '}
                  <bdi dir="ltr">
                    <code>{f.route}</code>
                  </bdi>
                </span>
              </li>
            ))}
          </ul>
          <p className="caption">
            Run <code>npx miraya baseline update</code> to prune them.
          </p>
        </>
      ) : null}

      <h2 className="overline">Run</h2>
      <dl className="run">
        <dt>Engine</dt>
        <dd>Chromium</dd>
        <dt>Viewport</dt>
        <dd>
          {report.config.viewport.w}×{report.config.viewport.h}
        </dd>
        <dt>Locales</dt>
        <dd>{report.config.mode === 'rtl-only' ? 'Arabic only' : 'English → Arabic'}</dd>
        <dt>Baseline</dt>
        <dd>{accepted ? `${accepted} accepted` : 'none yet'}</dd>
        <dt>Config</dt>
        <dd>
          <code>{report.config.hash.replace(/^\w+:/, '').slice(0, 6)}</code>
        </dd>
      </dl>
    </aside>
  )
}
