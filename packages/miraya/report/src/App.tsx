import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { routeVerdict, ruleTitle, SEVERITY_WORDS } from './copy'
import {
  matches,
  readHash,
  SEVERITIES,
  STATUSES,
  writeHash,
  type Filters,
  type ReportData,
} from './data'
import { Inspector } from './Inspector'
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
  const route = report.routes.find((r) => r.route === filters.route) ?? report.routes[0]
  const rules = useMemo(
    () => [...new Set(report.routes.flatMap((r) => r.findings.map((f) => f.rule)))].sort(),
    [report],
  )
  const visible = useMemo(
    () => (route ? route.findings.filter((f) => matches(f, filters)) : []),
    [route, filters],
  )
  // Something is always selected, so the details never wait for a first click.
  const selected = visible.find((f) => f.id === filters.finding) ?? visible[0]
  const [byKeyboard, setByKeyboard] = useState(false)
  const kindSelect = useRef<HTMLSelectElement>(null)

  const select = useCallback(
    (id: string, keyboard = false) => {
      setByKeyboard(keyboard)
      update({ finding: id })
    },
    [update],
  )

  // j / k move through findings, / jumps to the kind filter. Keyboard moves never animate.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (typing(e.target) || e.metaKey || e.ctrlKey || e.altKey) return
      if (e.key === '/') {
        e.preventDefault()
        kindSelect.current?.focus()
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

  const s = report.summary
  const open = report.routes.flatMap((r) => r.findings).filter((f) => f.status !== 'baselined')
  const mustFix = open.filter((f) => f.severity === 'error').length
  const shouldFix = open.filter((f) => f.severity === 'warn').length
  const pages = `${s.routes} ${s.routes === 1 ? 'page' : 'pages'}`
  const overall =
    mustFix + shouldFix === 0
      ? `Nothing new to fix on ${pages}`
      : `${[mustFix ? `${mustFix} to fix` : '', shouldFix ? `${shouldFix} worth fixing` : '']
          .filter(Boolean)
          .join(', ')} on ${pages}`

  return (
    <>
      <a className="skip" href="#findings">
        Skip to findings
      </a>
      <header className="topbar">
        <h1 className="brand">
          Miraya<span className="visually-hidden"> report</span>
        </h1>
        <p className="overall">{overall}</p>
        <div className="filters" role="toolbar" aria-label="Filter findings">
          <div className="group" role="group" aria-label="Severity">
            {SEVERITIES.map((sev) => (
              <button
                type="button"
                key={sev}
                className={`toggle sev-${sev}`}
                aria-pressed={filters.severity.includes(sev)}
                onClick={() =>
                  update({ severity: toggle(filters.severity, sev), finding: undefined })
                }
              >
                <span className="dot" aria-hidden="true" />
                {SEVERITY_WORDS[sev]}
              </button>
            ))}
          </div>
          <div className="group" role="group" aria-label="Status">
            {STATUSES.map((status) => (
              <button
                type="button"
                key={status}
                className="toggle"
                aria-pressed={filters.status.includes(status)}
                onClick={() =>
                  update({ status: toggle(filters.status, status), finding: undefined })
                }
              >
                {status === 'new' ? 'New' : 'Known'}
              </button>
            ))}
          </div>
          <select
            ref={kindSelect}
            aria-label="Kind of problem"
            value={filters.rule[0] ?? ''}
            onChange={(e) =>
              update({ rule: e.target.value ? [e.target.value] : [], finding: undefined })
            }
          >
            <option value="">All kinds</option>
            {rules.map((rule) => (
              <option key={rule} value={rule}>
                {ruleTitle(rule)}
              </option>
            ))}
          </select>
        </div>
      </header>

      <div className="layout">
        <nav className="routes" aria-label="Pages">
          <ul>
            {report.routes.map((r) => {
              const open = r.findings.filter((f) => f.status !== 'baselined')
              const worst = SEVERITIES.find((sev) => open.some((f) => f.severity === sev))
              return (
                <li key={r.route}>
                  <a
                    href={writeHash({ ...filters, route: r.route, finding: undefined })}
                    aria-current={r === route ? 'page' : undefined}
                    onClick={(e) => {
                      e.preventDefault()
                      update({ route: r.route, finding: undefined })
                    }}
                  >
                    <span
                      className={`dot ${r.status === 'error' ? 'sev-error' : worst ? `sev-${worst}` : 'is-clean'}`}
                      aria-hidden="true"
                    />
                    <span className="route-path">{r.route}</span>
                    <span className="route-count">
                      {r.status === 'error' ? 'failed' : open.length || ''}
                      <span className="visually-hidden">
                        {r.status === 'error' ? '' : open.length ? ' findings' : ' no findings'}
                      </span>
                    </span>
                  </a>
                </li>
              )
            })}
          </ul>
          {report.fixed.length > 0 ? (
            <p className="fixed">
              {report.fixed.length} fixed since the baseline. Run{' '}
              <code>miraya baseline update</code> to prune them.
            </p>
          ) : null}
          <p className="meta">
            {report.tool.name} {report.tool.version} · {new Date(report.startedAt).toLocaleString()}{' '}
            · {(report.durationMs / 1000).toFixed(1)}s · {report.config.viewport.w}×
            {report.config.viewport.h}
            {report.config.mode === 'rtl-only' ? ' · Arabic only' : ''}
          </p>
        </nav>

        {route ? (
          <>
            <main className="workspace">
              <div className="route-line">
                <code dir="ltr">{route.route}</code>
                <span className={route.findings.length === 0 ? 'is-clean' : ''}>
                  {routeVerdict(route.findings, route.status === 'error')}
                </span>
              </div>
              {route.errors.length > 0 ? (
                <div className="banner" role="alert">
                  {route.errors.map((e, i) => (
                    <p key={i}>
                      <code>{e.kind}</code> {e.message}
                    </p>
                  ))}
                </div>
              ) : null}
              {route.notes.length > 0 ? (
                <ul className="notes" aria-label="Notes">
                  {route.notes.map((n, i) => (
                    <li key={i}>{n}</li>
                  ))}
                </ul>
              ) : null}
              <Stage
                route={route}
                findings={visible}
                selected={selected}
                images={images}
                viewportWidth={report.config.viewport.w}
                onSelect={(id) => select(id)}
                instant={byKeyboard}
              />
            </main>
            <Inspector
              route={route}
              findings={visible}
              selected={selected}
              onSelect={(id) => select(id)}
            />
          </>
        ) : (
          <p className="empty">This report has no routes.</p>
        )}
      </div>
    </>
  )
}
