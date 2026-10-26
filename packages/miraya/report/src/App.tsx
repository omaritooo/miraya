import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { GLYPHS, plural, ruleTitle } from './copy'
import {
  AREAS,
  engineWords,
  inView,
  isKnown,
  matches,
  readHash,
  SEVERITIES,
  worst,
  writeHash,
  type Filters,
  type Finding,
  type Report as ReportJson,
  isDashboard,
  type ReportData,
  type RouteResult,
  type Status,
  type View,
  type ViewerData,
} from './data'
import { Dashboard } from './Dashboard'
import { areaState, AreaPassed, FirstRun, SwitchedOff } from './States'
import { Inspector, type Tab } from './Inspector'
import { Segmented, SeverityCounts } from './ui'
import { CrossStage } from './CrossStage'
import { PerfStage, seconds } from './PerfStage'
import { SeoStage } from './SeoStage'
import { SITE_VIEWS, SiteView } from './SiteView'
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
// Above this many findings in an area, the sidebar opens grouped by rule; above the
// smaller one it offers the choice.
const GROUP_ABOVE = 300
const GROUP_TOGGLE = 40

export function App({ data }: { data: ViewerData | null }) {
  if (data && isDashboard(data)) return <Dashboard data={data} />
  return <ReportApp data={data} />
}

function ReportApp({ data }: { data: ReportData | null }) {
  const [filters, update] = useHashFilters()
  if (!data) {
    return (
      <main className="empty">
        <h1>No report data</h1>
        <p>Miraya fills this viewer in when it writes report.html.</p>
      </main>
    )
  }
  return (
    <Report
      report={data.report}
      images={data.images}
      dashboardHref={data.dashboardHref}
      filters={filters}
      update={update}
    />
  )
}

function Report({
  report,
  images,
  dashboardHref,
  filters,
  update,
}: ReportData & { filters: Filters; update: (next: Partial<Filters>) => void }) {
  const inArea = useCallback((f: Finding) => inView(f, filters.area), [filters.area])
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
  // Reports that list their checks show every area, saying which are off. Older ones show
  // only what they have: SEO once there are head tags, the rest once they have findings.
  const areas = AREAS.filter(
    (a) =>
      !!report.config.checks ||
      a.id === 'localization' ||
      a.id === filters.area ||
      (a.id === 'seo' && report.routes.some((r) => r.head)) ||
      (a.id === 'performance' && !!report.performance) ||
      (a.id === 'cross-browser' && (report.engines?.length ?? 0) > 1) ||
      report.routes.some((r) => r.findings.some((f) => inView(f, a.id))),
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
  const state = areaState(report, filters.area)
  // An area with nothing new anywhere opens on a summary, until someone asks for the pages.
  const [browsing, setBrowsing] = useState<View[]>([])
  const passed =
    state === 'on' &&
    !report.running &&
    filters.status === 'new' &&
    !filters.route &&
    !filters.site &&
    !browsing.includes(filters.area) &&
    report.routes.every((r) => r.status === 'ok') &&
    !open.some((f) => inView(f, filters.area))

  return (
    <div className="app">
      {filters.area === 'seo' && filters.site ? (
        <a className="skip" href="#site-view">
          Skip to the table
        </a>
      ) : (
        <a className="skip" href="#inspector">
          Skip to findings
        </a>
      )}
      <header className="topbar">
        <div className="topbar-run">
          <p className="brand">
            <span className="brand-mark" aria-hidden="true" />
            Miraya<span className="sr"> report</span>
          </p>
          <RunFacts report={report} />
          <span className="spacer" />
          <Verdict report={report} />
          {dashboardHref ? (
            <a className="dashboard-link" href={dashboardHref}>
              Open in dashboard
            </a>
          ) : null}
        </div>
        <div className="topbar-areas">
          <nav className="areas" aria-label="Areas">
            {areas.map((a) => {
              const st = areaState(report, a.id)
              return (
                <a
                  key={a.id}
                  href={writeHash({
                    ...filters,
                    area: a.id,
                    finding: undefined,
                    rule: undefined,
                    site: undefined,
                  })}
                  aria-current={a.id === filters.area ? 'page' : undefined}
                  className="area"
                  onClick={(e) => {
                    e.preventDefault()
                    update({ area: a.id, finding: undefined, rule: undefined, site: undefined })
                  }}
                >
                  <span
                    className={`area-dot area-${a.id}${st === 'off' ? ' area-dot-off' : ''}`}
                    aria-hidden="true"
                  />
                  {a.label}
                  {st === 'off' ? (
                    <span className="area-state">off</span>
                  ) : st === 'dev' ? (
                    <span className="area-state">greyed, dev server</span>
                  ) : (
                    <SeverityCounts findings={open.filter((f) => inView(f, a.id))} />
                  )}
                </a>
              )
            })}
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

      {!report.baseline && report.config.checks && !report.running ? (
        <FirstRun report={report} />
      ) : null}
      <div className="layout">
        <Pages
          report={report}
          current={route}
          filters={filters}
          update={update}
          inputRef={pageFilter}
        />
        {state === 'off' ? (
          <SwitchedOff area={filters.area} />
        ) : passed ? (
          <AreaPassed
            report={report}
            area={filters.area}
            onKnown={() => update({ status: 'all', finding: undefined })}
            onBrowse={() => setBrowsing([...browsing, filters.area])}
          />
        ) : filters.area === 'seo' && filters.site ? (
          <SiteView
            report={report}
            site={filters.site}
            onOpen={(r, finding) => update({ route: r, finding, site: undefined })}
          />
        ) : route ? (
          <>
            {filters.area === 'cross-browser' ? (
              <CrossStage
                report={report}
                route={route}
                findings={visible}
                selected={selected}
                images={images}
                viewportWidth={report.config.viewport.w}
                onSelect={(id) => select(id)}
                instant={byKeyboard}
              />
            ) : filters.area === 'performance' ? (
              <PerfStage
                route={route}
                report={report}
                findings={visible}
                images={images}
                viewportWidth={report.config.viewport.w}
              />
            ) : filters.area === 'seo' ? (
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
              run={report.run}
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
    hour12: false,
  })
  const seconds = Math.round(report.durationMs / 1000)
  const took = seconds >= 60 ? `${Math.floor(seconds / 60)} m ${seconds % 60} s` : `${seconds} s`
  const run = report.run
  const facts = [
    run?.pr
      ? `Pull request #${run.pr}`
      : run?.channel && run.channel !== run.branch
        ? run.channel
        : run?.branch,
    run?.commit,
  ].filter(Boolean)
  return (
    <p className="run-facts">
      {run?.project ? <strong className="run-project">{run.project}</strong> : null}
      {facts.map((f) => (
        <span key={f} className="run-fact">
          <span aria-hidden="true">·</span> {f}
        </span>
      ))}
      {run ? null : (
        <span>
          {report.tool.name} {report.tool.version}
        </span>
      )}
      <span aria-hidden="true">·</span>
      <time dateTime={report.startedAt}>{when}</time>
      <span aria-hidden="true">·</span>
      <span>{took}</span>
    </p>
  )
}

/** The run's result in one line, the same rule the exit code follows. */
function Verdict({ report }: { report: ReportJson }) {
  if (report.running) {
    return (
      <p className="verdict" role="status">
        <span className="pill pill-running">Running</span>
        <span>
          Auditing {report.routes.length} of {plural(report.running.total, 'page')}
        </span>
        {/* A count, never a spinner: one segment per page, up to 30. */}
        {report.running.total <= 30 ? (
          <span className="run-progress" aria-hidden="true">
            {Array.from({ length: report.running.total }, (_, i) => (
              <span key={i} className={i < report.routes.length ? 'done' : undefined} />
            ))}
          </span>
        ) : null}
      </p>
    )
  }
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
  const perf = filters.area === 'performance'
  // The slower of the two languages' largest paints.
  const lcp = (r: RouteResult) =>
    Math.max(...(['ltr', 'rtl'] as const).map((d) => r.perf?.[d]?.lcp?.ms ?? -1))
  const shown = report.routes
    .filter((r) => r.route.toLowerCase().includes(query.toLowerCase()))
    .sort((a, b) => (perf ? lcp(b) - lcp(a) : 0))
  const scoped = (r: RouteResult) =>
    r.findings.filter((f) => inView(f, filters.area) && (!filters.rule || f.rule === filters.rule))
  // Above a few hundred findings, rules say more than a list of pages does.
  const areaFindings = report.routes.flatMap((r) =>
    r.findings.filter((f) => inView(f, filters.area)),
  )
  const group = filters.group ?? (areaFindings.length > GROUP_ABOVE ? 'rule' : 'page')
  const byRule = [...new Set(areaFindings.map((f) => f.rule))]
    .map((rule) => {
      const fs = areaFindings.filter((f) => f.rule === rule)
      return {
        rule,
        fs,
        pages: new Set(fs.map((f) => f.route)).size,
        fresh: fs.filter((f) => !isKnown(f)).length,
      }
    })
    .sort((a, b) => b.fresh - a.fresh || b.fs.length - a.fs.length)
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
      {filters.area === 'seo' && report.routes.some((r) => r.head) ? (
        <>
          <h2 className="overline">Site</h2>
          <ul className="page-list">
            {SITE_VIEWS.map((v) => {
              const pages = report.routes.filter((r) =>
                r.findings.some((f) => v.rules.includes(f.rule) && !isKnown(f)),
              )
              const sev = worst(
                report.routes.flatMap((r) => r.findings.filter((f) => v.rules.includes(f.rule))),
              )
              return (
                <li key={v.id}>
                  <a
                    href={writeHash({ ...filters, site: v.id, finding: undefined })}
                    aria-current={filters.site === v.id ? 'page' : undefined}
                    onClick={(e) => {
                      e.preventDefault()
                      update({ site: v.id, finding: undefined })
                    }}
                  >
                    <span className={`glyph ${sev ? `sev-${sev}` : ''}`} aria-hidden="true">
                      {sev ? GLYPHS[sev] : '○'}
                    </span>
                    <span className="page-path">{v.label}</span>
                    {pages.length ? (
                      <span className="page-count">
                        {pages.length}
                        <span className="sr">
                          {' '}
                          {pages.length === 1 ? 'page' : 'pages'} with findings
                        </span>
                      </span>
                    ) : null}
                  </a>
                </li>
              )
            })}
          </ul>
        </>
      ) : null}
      {(byRule.length > 3 && areaFindings.length > GROUP_TOGGLE) || filters.group ? (
        <div className="group-by">
          <Segmented
            label="Group by"
            options={['page', 'rule'] as const}
            value={group}
            text={(g) => (g === 'page' ? 'Page' : 'Rule')}
            onChange={(g) => update({ group: g })}
          />
        </div>
      ) : null}
      {group === 'rule' && byRule.length > 1 && !perf ? (
        <>
          <h2 className="overline">Rules · {byRule.length}</h2>
          <ul className="group-list">
            {byRule.map((g) => {
              const sev = worst(g.fs) ?? g.fs[0]?.severity ?? 'info'
              return (
                <li key={g.rule}>
                  <button
                    type="button"
                    aria-pressed={filters.rule === g.rule}
                    onClick={() =>
                      update({
                        rule: filters.rule === g.rule ? undefined : g.rule,
                        group: 'page',
                        finding: undefined,
                        route: g.fs.find((f) => !isKnown(f))?.route ?? g.fs[0]?.route,
                      })
                    }
                  >
                    <span className={`glyph sev-${sev}`} aria-hidden="true">
                      {GLYPHS[sev]}
                    </span>
                    <span>
                      <code>{g.rule}</code>{' '}
                      <span className="muted">
                        {g.fs.length.toLocaleString('en-US')} on {plural(g.pages, 'page')}
                      </span>
                    </span>
                    <span className={`group-count${g.fresh ? ' strong' : ' muted'}`}>
                      {g.fresh.toLocaleString('en-US')} new
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
        </>
      ) : null}
      {filters.rule && group === 'page' ? (
        <p className="caption rule-scope">
          Pages with <code>{filters.rule}</code>.{' '}
          <button type="button" className="link" onClick={() => update({ rule: undefined })}>
            All rules
          </button>
        </p>
      ) : null}
      <h2 className="overline" hidden={group === 'rule' && byRule.length > 1 && !perf}>
        Pages · {report.routes.length}
      </h2>
      <ul className="page-list" hidden={group === 'rule' && byRule.length > 1 && !perf}>
        {listed.map((r) => {
          const open = scoped(r).filter((f) => !isKnown(f))
          const sev = worst(open)
          const failed = r.status === 'error'
          return (
            <li key={r.route}>
              <a
                href={writeHash({ ...filters, route: r.route, finding: undefined })}
                aria-current={r === current && !filters.site ? 'page' : undefined}
                onClick={(e) => {
                  e.preventDefault()
                  update({ route: r.route, finding: undefined, site: undefined })
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
                ) : perf && lcp(r) >= 0 ? (
                  <span className="page-count">
                    <span className="sr">largest paint </span>
                    {seconds(lcp(r))}
                  </span>
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
        {report.running && report.running.total > report.routes.length ? (
          <li className="page-none">
            {plural(report.running.total - report.routes.length, 'page')} waiting
          </li>
        ) : null}
        {shown.length === 0 && !report.running ? (
          <li className="page-none">No page matches “{query}”.</li>
        ) : null}
      </ul>
      {perf && report.performance ? (
        <p className="caption">Sorted by the slower of the two largest paints.</p>
      ) : null}

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

      {perf && report.performance ? (
        <>
          <h2 className="overline">Conditions</h2>
          <dl className="run">
            <dt>CPU</dt>
            <dd>{report.performance.cpuSlowdown}× slowdown</dd>
            <dt>Network</dt>
            <dd>{report.performance.network}</dd>
            <dt>Engine</dt>
            <dd>{report.performance.engine}</dd>
            <dt>Runs</dt>
            <dd>
              Median of {report.performance.runs}
              {report.performance.warmUp ? `, ${report.performance.warmUp} warm-up` : ''}
            </dd>
          </dl>
        </>
      ) : null}
      <h2 className="overline">Run</h2>
      <dl className="run">
        <dt>{(report.engines?.length ?? 1) > 1 ? 'Engines' : 'Engine'}</dt>
        <dd>{engineWords(report.engines ?? ['chromium'])}</dd>
        <dt>Viewport</dt>
        <dd>
          {report.config.viewport.w}×{report.config.viewport.h}
        </dd>
        <dt>Locales</dt>
        <dd>
          {report.config.mode === 'rtl-only'
            ? 'Arabic only'
            : (report.config.locale ?? 'English → Arabic')}
        </dd>
        <dt>Baseline</dt>
        <dd>
          {report.baseline
            ? `${plural(report.baseline.entries, 'entry', 'entries')}, ${accepted} matched`
            : accepted
              ? `${accepted} accepted`
              : 'none yet'}
        </dd>
        <dt>Config</dt>
        <dd>
          <code>{report.config.hash.replace(/^\w+:/, '').slice(0, 6)}</code>
        </dd>
      </dl>
    </aside>
  )
}
