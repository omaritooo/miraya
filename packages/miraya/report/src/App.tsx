import { useCallback, useEffect, useMemo, useState } from 'react'
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

export function App({ data }: { data: ReportData | null }) {
  const [filters, update] = useHashFilters()

  if (!data) {
    return (
      <main className="empty">
        <h1>No report data</h1>
        <p>This viewer is filled in by Miraya when it writes report.html.</p>
      </main>
    )
  }

  const { report, images } = data
  return <Report report={report} images={images} filters={filters} update={update} />
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
  const selected = visible.find((f) => f.id === filters.finding)
  const s = report.summary

  return (
    <>
      <a className="skip" href="#findings">
        Skip to findings
      </a>
      <header className="masthead">
        <h1 className="brand">
          <span className="wordmark">Miraya</span>
          <span className="wordmark-ar" lang="ar" dir="rtl">
            مرايا
          </span>
          <span className="visually-hidden"> report</span>
        </h1>
        <dl className="summary">
          <div>
            <dt>Routes</dt>
            <dd>{s.routes}</dd>
          </div>
          {SEVERITIES.map((sev) => (
            <div key={sev} className={`sev-${sev}`}>
              <dt>{sev === 'warn' ? 'Warnings' : sev === 'error' ? 'Errors' : 'Info'}</dt>
              <dd>{s.findings[sev]}</dd>
            </div>
          ))}
          <div>
            <dt>New</dt>
            <dd>{s.new}</dd>
          </div>
          <div>
            <dt>Baselined</dt>
            <dd>{s.baselined}</dd>
          </div>
          <div>
            <dt>Fixed</dt>
            <dd>{s.fixed}</dd>
          </div>
        </dl>
        <p className="meta">
          {report.tool.name} {report.tool.version} · {new Date(report.startedAt).toLocaleString()} ·{' '}
          {(report.durationMs / 1000).toFixed(1)}s · {report.config.viewport.w}×
          {report.config.viewport.h}
          {report.config.mode === 'rtl-only' ? ' · RTL only' : ''}
        </p>
      </header>

      <div className="layout">
        <nav className="routes" aria-label="Routes">
          <h2>Routes</h2>
          <ul>
            {report.routes.map((r) => {
              const count = (sev: string) => r.findings.filter((f) => f.severity === sev).length
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
                    <span className="route-path">{r.route}</span>
                    {r.status === 'error' ? (
                      <span className="tag tag-error">failed</span>
                    ) : (
                      <span className="counts">
                        {SEVERITIES.map((sev) =>
                          count(sev) ? (
                            <span key={sev} className={`count sev-${sev}`}>
                              {count(sev)} <span className="visually-hidden">{sev}</span>
                            </span>
                          ) : null,
                        )}
                        {r.findings.length === 0 ? (
                          <span className="count clean">clean</span>
                        ) : null}
                      </span>
                    )}
                  </a>
                </li>
              )
            })}
          </ul>
          {report.fixed.length > 0 ? (
            <section className="fixed" aria-labelledby="fixed-title">
              <h2 id="fixed-title">Fixed since the baseline</h2>
              <ul>
                {report.fixed.map((f) => (
                  <li key={f.fingerprint}>
                    <code>{f.rule}</code> on {f.route}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </nav>

        <main className="workspace">
          <fieldset className="filters">
            <legend className="visually-hidden">Filter findings</legend>
            <div className="filter-group" role="group" aria-label="Severity">
              {SEVERITIES.map((sev) => (
                <label key={sev} className={`chip sev-${sev}`}>
                  <input
                    type="checkbox"
                    checked={filters.severity.includes(sev)}
                    onChange={() =>
                      update({ severity: toggle(filters.severity, sev), finding: undefined })
                    }
                  />
                  {sev}
                </label>
              ))}
            </div>
            <div className="filter-group" role="group" aria-label="Status">
              {STATUSES.map((status) => (
                <label key={status} className="chip">
                  <input
                    type="checkbox"
                    checked={filters.status.includes(status)}
                    onChange={() =>
                      update({ status: toggle(filters.status, status), finding: undefined })
                    }
                  />
                  {status}
                </label>
              ))}
            </div>
            <label className="rule-select">
              <span>Rule</span>
              <select
                value={filters.rule[0] ?? ''}
                onChange={(e) =>
                  update({ rule: e.target.value ? [e.target.value] : [], finding: undefined })
                }
              >
                <option value="">All rules</option>
                {rules.map((rule) => (
                  <option key={rule} value={rule}>
                    {rule}
                  </option>
                ))}
              </select>
            </label>
          </fieldset>

          {route ? (
            <>
              {route.errors.length > 0 ? (
                <div className="banner banner-error" role="alert">
                  <strong>This route couldn't be audited.</strong>
                  <ul>
                    {route.errors.map((e, i) => (
                      <li key={i}>
                        <code>{e.kind}</code> {e.message}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {route.notes.length > 0 ? (
                <ul className="notes" aria-label="Notes">
                  {route.notes.map((n, i) => (
                    <li key={i}>{n}</li>
                  ))}
                </ul>
              ) : null}
              <div className="split">
                <Stage
                  route={route}
                  findings={visible}
                  selected={selected}
                  images={images}
                  viewportWidth={report.config.viewport.w}
                  onSelect={(id) => update({ finding: id })}
                />
                <Inspector
                  route={route}
                  findings={visible}
                  selected={selected}
                  onSelect={(id) => update({ finding: id })}
                />
              </div>
            </>
          ) : (
            <p className="empty">This report has no routes.</p>
          )}
        </main>
      </div>
    </>
  )
}
