import { useEffect, useRef, useState } from 'react'
import { GLYPHS, plural } from './copy'
import type { Finding, PagePerf, Report, ResourceType, RouteResult, Severity } from './data'
import { Segmented } from './ui'

type Dir = 'ltr' | 'rtl'
type Budgets = NonNullable<Report['performance']>['budgets']

const LANGUAGES: Record<Dir, { short: string; name: string }> = {
  ltr: { short: 'EN', name: 'English' },
  rtl: { short: 'AR', name: 'Arabic' },
}

const num = (n: number) => Math.round(n).toLocaleString('en-US')
export const kb = (bytes: number) => Math.round(bytes / 1024)
/** "3.1 s", for the page list. */
export const seconds = (ms: number) => `${(ms / 1000).toFixed(1)} s`

type Row = {
  label: string
  /** The rule that holds this metric to its budget. */
  rule?: string
  budget?: number
  value: (perf: PagePerf) => number | undefined
  show: (n: number) => string
  unit?: string
}

const ROWS = (b: Budgets | undefined): Row[] => [
  {
    label: 'Largest paint',
    rule: 'lcp-budget',
    budget: b?.lcpMs,
    value: (p) => p.lcp?.ms,
    show: num,
    unit: 'ms',
  },
  {
    label: 'Layout shift',
    rule: 'cls-budget',
    budget: b?.cls,
    value: (p) => p.cls,
    show: (n) => String(Math.round(n * 1000) / 1000),
  },
  {
    label: 'Blocking time',
    rule: 'tbt-budget',
    budget: b?.tbtMs,
    value: (p) => p.tbtMs,
    show: num,
    unit: 'ms',
  },
  {
    label: 'JavaScript',
    rule: 'js-budget',
    budget: b?.scriptKb,
    value: (p) => kb(p.bytes.script),
    show: num,
    unit: 'KB',
  },
  {
    label: 'Render-blocking',
    rule: 'render-blocking',
    budget: b?.renderBlocking,
    value: (p) => p.renderBlocking.length,
    show: num,
  },
  {
    label: 'Page weight',
    value: (p) => kb(total(p)),
    show: num,
    unit: 'KB',
  },
]

const total = (p: PagePerf) => Object.values(p.bytes).reduce((sum, n) => sum + n, 0)

export const TYPES: { id: ResourceType; label: string }[] = [
  { id: 'script', label: 'Scripts' },
  { id: 'style', label: 'Styles' },
  { id: 'font', label: 'Fonts' },
  { id: 'image', label: 'Images' },
  { id: 'document', label: 'Document' },
  { id: 'other', label: 'Other' },
]

/** Load metrics for both languages against the config's budgets, what painted last, and where the bytes go. */
export function PerfStage({
  route,
  report,
  findings,
  images,
  viewportWidth,
}: {
  route: RouteResult
  report: Report
  findings: Finding[]
  images: Record<string, string>
  viewportWidth: number
}) {
  const [only, setOnly] = useState<'both' | Dir>('both')
  const measured = (['ltr', 'rtl'] as const).filter((d) => route.perf?.[d])
  const dirs = only === 'both' ? measured : measured.filter((d) => d === only)
  const conditions = report.performance
  const rows = ROWS(conditions?.budgets)
  // Show the slower language's paint: that's the one worth fixing.
  const slow = [...dirs].sort(
    (a, b) => (route.perf?.[b]?.lcp?.ms ?? 0) - (route.perf?.[a]?.lcp?.ms ?? 0),
  )[0]
  const over = findings.filter((f) => f.evidence.check === 'over')
  const dev = measured.some((d) => route.perf?.[d]?.devServer)

  return (
    <main className="stage perf" aria-label="Metrics">
      <div className="toolbar" role="toolbar" aria-label="View">
        {measured.length > 1 ? (
          <Segmented
            label="Language"
            options={['both', 'ltr', 'rtl'] as const}
            value={only}
            text={(o) => (o === 'both' ? 'Both' : LANGUAGES[o].name)}
            onChange={setOnly}
          />
        ) : null}
      </div>

      <div className="stage-head">
        <h1>
          <bdi dir="ltr">{route.route}</bdi>
        </h1>
        <span className="muted">
          {route.status === 'error'
            ? 'Not audited'
            : over.length
              ? `${plural(over.length, 'metric')} over budget`
              : 'Within budget'}
          {' · budgets from '}
          <code>miraya.config</code>
        </span>
      </div>

      <div className="seo-body">
        {dev ? (
          <div className="banner banner-warn" role="note">
            <span aria-hidden="true">▲</span>
            <p>
              This run used a development server, so the numbers only count against a production
              build. They're shown greyed for reference, and findings are listed as info that
              doesn't fail the run.
            </p>
          </div>
        ) : null}
        {!route.perf ? (
          <p className="state muted">
            {route.status === 'error'
              ? "This page couldn't be audited, so it wasn't measured."
              : conditions
                ? 'This page was not measured. Performance needs Chromium.'
                : "Performance wasn't checked in this run. Add 'performance' to checks, or run with --checks localization,seo,performance."}
          </p>
        ) : (
          <>
            <div className="table-box">
              <table className={`metrics${dev ? ' dev' : ''}`}>
                <caption className="sr">Metrics against budget</caption>
                <thead>
                  <tr>
                    <th scope="col">Metric</th>
                    {dirs.map((d) => (
                      <th scope="col" key={d}>
                        {LANGUAGES[d].name}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => {
                    const finding = row.rule ? findings.find((f) => f.rule === row.rule) : undefined
                    return (
                      <tr key={row.label}>
                        <th scope="row">
                          <span className="metric-name">{row.label}</span>
                          <span className="metric-budget muted">
                            {row.budget === undefined
                              ? 'no budget'
                              : `≤ ${row.show(row.budget)}${row.unit ? ` ${row.unit}` : ''}`}
                          </span>
                        </th>
                        {dirs.map((d) => (
                          <MetricCell
                            key={d}
                            row={row}
                            perf={route.perf?.[d]}
                            other={
                              measured.length > 1
                                ? route.perf?.[d === 'ltr' ? 'rtl' : 'ltr']
                                : undefined
                            }
                            dir={d}
                            severity={finding?.severity}
                          />
                        ))}
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            <AlsoMeasured
              perf={dirs.map((d) => route.perf?.[d]).filter((p): p is PagePerf => !!p)}
            />

            <div className="perf-panels">
              {slow ? (
                <LargestPaint
                  dir={slow}
                  perf={route.perf[slow] as PagePerf}
                  other={
                    measured.length > 1 ? route.perf[slow === 'ltr' ? 'rtl' : 'ltr'] : undefined
                  }
                  src={images[route.screenshots[slow] ?? ''] ?? ''}
                  frame={route.screenshots.frames?.[slow] ?? { x: 0, w: viewportWidth }}
                />
              ) : null}
              <Weight perf={route.perf} dirs={dirs} />
            </div>
          </>
        )}
        {conditions ? (
          <p className="caption">
            {conditions.engine}, {conditions.cpuSlowdown}× CPU slowdown, {conditions.network},
            median of {plural(conditions.runs, 'load')}
            {conditions.warmUp ? ` after ${plural(conditions.warmUp, 'warm-up')}` : ''}, cache off.
          </p>
        ) : null}
      </div>
    </main>
  )
}

function MetricCell({
  row,
  perf,
  other,
  dir,
  severity,
}: {
  row: Row
  perf: PagePerf | undefined
  other: PagePerf | undefined
  dir: Dir
  severity: Severity | undefined
}) {
  const value = perf ? row.value(perf) : undefined
  if (value === undefined) {
    return (
      <td>
        <span className="muted">not measured</span>
      </td>
    )
  }
  const over = row.budget !== undefined && value > row.budget
  const theirs = other ? row.value(other) : undefined
  // Without a budget, how much heavier one language is than the other is the useful part.
  const vsOther =
    row.budget === undefined && theirs && dir === 'rtl' && value > theirs * 1.1
      ? `+${Math.round((value / theirs - 1) * 100)}% over English`
      : ''
  return (
    <td className={over ? `row-${severity ?? 'warn'}` : undefined}>
      <span className="metric-lang muted" aria-hidden="true">
        {LANGUAGES[dir].short}
      </span>
      <span className="metric-value">{row.show(value)}</span>
      {row.unit ? <span className="muted"> {row.unit}</span> : null}{' '}
      {row.budget === undefined ? (
        vsOther ? (
          <span className="metric-note muted">{vsOther}</span>
        ) : null
      ) : over ? (
        <span className={`metric-note sev-${severity ?? 'warn'}`}>
          <span aria-hidden="true">{GLYPHS[severity ?? 'warn']}</span> +
          {row.show(value - row.budget)}
          <span className="sr"> over budget</span>
        </span>
      ) : (
        <span className="metric-note pos">
          <span aria-hidden="true">✓</span> under
        </span>
      )}
    </td>
  )
}

function AlsoMeasured({ perf }: { perf: PagePerf[] }) {
  if (perf.length === 0) return null
  const requests = perf.map((p) => p.requests).join(' and ')
  const images = perf.map((p) => p.oversizedImages)
  const counts = images.map((list) => list.length)
  const wasted = images.map((list) => kb(list.reduce((sum, i) => sum + i.wastedBytes, 0)))
  const fcp = perf.map((p) => (p.fcpMs === undefined ? '–' : num(p.fcpMs))).join(' and ')
  return (
    <p className="caption also">
      Also measured: first paint at {fcp} ms; {requests} requests
      {counts.some(Boolean)
        ? `; ${counts.join(' and ')} ${Math.max(...counts) === 1 ? 'image' : 'images'} larger than drawn, ${wasted.join(' and ')} KB more than needed`
        : ''}
      .
    </p>
  )
}

const file = (url: string) => {
  try {
    return new URL(url).pathname.split('/').filter(Boolean).at(-1) ?? url
  } catch {
    return url
  }
}

/** The screenshot around the largest paint element, outlined. */
function LargestPaint({
  dir,
  perf,
  other,
  src,
  frame,
}: {
  dir: Dir
  perf: PagePerf
  other: PagePerf | undefined
  src: string
  frame: { x: number; w: number }
}) {
  const scroller = useRef<HTMLDivElement>(null)
  const [docHeight, setDocHeight] = useState(0)
  const box = perf.lcp?.box
  useEffect(() => {
    const el = scroller.current
    if (!el || !box || !docHeight) return
    const scale = el.clientWidth / frame.w
    el.scrollTop = Math.max(0, box.y * scale - el.clientHeight / 3)
  }, [box, docHeight, frame.w])
  const lang = LANGUAGES[dir].name
  const blocking = perf.renderBlocking.filter((r) => r.type === 'font' || r.type === 'style')
  return (
    <section className="perf-panel" aria-labelledby="lcp-title">
      <h2 id="lcp-title" className="seo-h2">
        What painted last{other ? `, ${lang}` : ''}
      </h2>
      {perf.lcp ? (
        <>
          {src && box ? (
            <div className="lcp-shot" ref={scroller}>
              <div className="lcp-canvas">
                <img
                  src={src}
                  alt={`${lang} render with the largest paint element outlined`}
                  onLoad={(e) => {
                    const img = e.currentTarget
                    setDocHeight((img.naturalHeight * frame.w) / img.naturalWidth)
                  }}
                />
                {docHeight ? (
                  <span
                    className="lcp-box"
                    style={{
                      left: `${((box.x - frame.x) / frame.w) * 100}%`,
                      top: `${(box.y / docHeight) * 100}%`,
                      width: `${(box.w / frame.w) * 100}%`,
                      height: `${(box.h / docHeight) * 100}%`,
                    }}
                  >
                    <span className="lcp-label" dir="ltr">
                      LCP {num(perf.lcp.ms)} ms
                    </span>
                  </span>
                ) : null}
              </div>
            </div>
          ) : null}
          <p>
            {perf.lcp.selector ? (
              <bdi dir="ltr">
                <code>{perf.lcp.selector}</code>
              </bdi>
            ) : (
              'The element'
            )}{' '}
            painted at {num(perf.lcp.ms)} ms
            {perf.lcp.url ? (
              <>
                , showing{' '}
                <bdi dir="ltr">
                  <code>{file(perf.lcp.url)}</code>
                </bdi>
              </>
            ) : null}
            .
            {blocking.length ? (
              <>
                {' '}
                It waits for{' '}
                {blocking.slice(0, 2).map((r, i) => (
                  <span key={r.url}>
                    {i ? ' and ' : ''}
                    <bdi dir="ltr">
                      <code>{file(r.url)}</code>
                    </bdi>
                  </span>
                ))}
                .
              </>
            ) : null}
            {other?.lcp
              ? ` In ${dir === 'rtl' ? 'English' : 'Arabic'}, the largest paint is at ${num(other.lcp.ms)} ms.`
              : ''}
          </p>
        </>
      ) : (
        <p className="muted">The browser reported no largest paint for this page.</p>
      )}
    </section>
  )
}

function Weight({ perf, dirs }: { perf: NonNullable<RouteResult['perf']>; dirs: Dir[] }) {
  const max = Math.max(...dirs.map((d) => total(perf[d] as PagePerf)))
  const types = TYPES.filter((t) => dirs.some((d) => (perf[d]?.bytes[t.id] ?? 0) > 0))
  return (
    <section className="perf-panel" aria-labelledby="weight-title">
      <h2 id="weight-title" className="seo-h2">
        Weight by type
      </h2>
      {dirs.map((d) => {
        const p = perf[d] as PagePerf
        const sum = total(p)
        return (
          <div className="weight" key={d}>
            <div className="weight-head">
              <span>{LANGUAGES[d].name}</span>
              <span className="muted">{num(kb(sum))} KB</span>
            </div>
            <div
              className="weight-bar"
              aria-hidden="true"
              style={{ width: `${(sum / max) * 100}%` }}
            >
              {types.map((t) =>
                p.bytes[t.id] ? (
                  <span
                    key={t.id}
                    className={`weight-${t.id}`}
                    style={{ flexGrow: p.bytes[t.id] }}
                    title={`${t.label} ${num(kb(p.bytes[t.id]))} KB`}
                  />
                ) : null,
              )}
            </div>
          </div>
        )
      })}
      <table className="evidence weight-table">
        <caption className="sr">Kilobytes by type</caption>
        <thead>
          <tr>
            <th scope="col">Type</th>
            {dirs.map((d) => (
              <th scope="col" key={d}>
                {LANGUAGES[d].short} <span className="sr">KB</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {types.map((t) => (
            <tr key={t.id}>
              <th scope="row">
                <span className={`swatch weight-${t.id}`} aria-hidden="true" />
                {t.label}
              </th>
              {dirs.map((d) => (
                <td key={d}>{num(kb(perf[d]?.bytes[t.id] ?? 0))}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  )
}
