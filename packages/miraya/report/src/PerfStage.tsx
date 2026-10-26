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
    label: 'Page weight',
    value: (p) => kb(total(p)),
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
]

const total = (p: PagePerf) => Object.values(p.bytes).reduce((sum, n) => sum + n, 0)

export const TYPES: { id: ResourceType; label: string }[] = [
  { id: 'script', label: 'Scripts' },
  { id: 'style', label: 'Styles' },
  { id: 'font', label: 'Fonts' },
  { id: 'image', label: 'Images' },
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
            <div
              role="table"
              aria-label="Metrics against budget"
              className={`metric-cards${dev ? ' dev' : ''}`}
            >
              {rows.map((row) => {
                const finding = row.rule ? findings.find((f) => f.rule === row.rule) : undefined
                return (
                  <div role="row" className="metric-card" key={row.label}>
                    <div role="rowheader" className="metric-head">
                      <span className="metric-name">{row.label}</span>
                      <span className="muted">
                        {row.budget === undefined
                          ? 'no budget'
                          : row.rule === 'render-blocking'
                            ? row.show(row.budget)
                            : `≤ ${row.show(row.budget)}${row.unit ? ` ${row.unit}` : ''}`}
                      </span>
                    </div>
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
                  </div>
                )
              })}
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
      <div role="cell" className="metric-cell">
        <span className="metric-lang">{LANGUAGES[dir].short}</span>
        <span className="muted">not measured</span>
      </div>
    )
  }
  const over = row.budget !== undefined && value > row.budget
  const theirs = other ? row.value(other) : undefined
  // Without a budget, how much heavier one language is than the other is the useful part.
  const vsOther =
    row.budget === undefined && theirs && dir === 'rtl' && value > theirs * 1.1
      ? `+${Math.round((value / theirs - 1) * 100)}%`
      : ''
  const sev = severity ?? 'warn'
  return (
    <div role="cell" className="metric-cell">
      <span className="metric-lang">
        {LANGUAGES[dir].short}
        <span className="sr"> {LANGUAGES[dir].name}</span>
      </span>
      <span className={`metric-value${over ? ` sev-${sev}` : ''}`}>{row.show(value)}</span>
      {row.budget === undefined ? (
        <span className="metric-unit">
          {row.unit}
          {vsOther ? `, ${vsOther}` : ''}
        </span>
      ) : over ? (
        <span className={`metric-note sev-${sev}`}>
          <span aria-hidden="true">{GLYPHS[sev]}</span> +{row.show(value - row.budget)}
          <span className="sr"> over budget</span>
        </span>
      ) : (
        <span className="metric-note pos">
          <span aria-hidden="true">✓</span> under
        </span>
      )}
    </div>
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

const CROP_HEIGHT = 220

/**
 * Where to draw the screenshot so the element is large and in view. A small element is
 * shown whole and centred; a wide one, like a full-width heading, at up to its real size,
 * from the side its text starts on.
 */
function cropAround(
  box: { x: number; y: number; w: number; h: number },
  frame: { x: number; w: number },
  width: number,
  height: number,
  dir: Dir,
) {
  const fits = Math.min((width * 0.9) / box.w, (height * 0.6) / box.h)
  const scale = Math.min(1, Math.max(fits, (height * 0.3) / box.h, width / frame.w))
  const b = { x: (box.x - frame.x) * scale, y: box.y * scale, w: box.w * scale, h: box.h * scale }
  const left =
    b.w <= width - 24
      ? (width - b.w) / 2 - b.x
      : dir === 'rtl'
        ? width - 12 - (b.x + b.w)
        : 12 - b.x
  const top = (height - b.h) / 2 - b.y
  return {
    imageWidth: frame.w * scale,
    left,
    top,
    box: { x: b.x + left, y: b.y + top, w: b.w, h: b.h },
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
  const shot = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)
  const box = perf.lcp?.box
  useEffect(() => {
    const el = shot.current
    if (!el) return
    const observer = new ResizeObserver(() => setWidth(el.clientWidth))
    observer.observe(el)
    return () => observer.disconnect()
  }, [])
  const crop = box && width ? cropAround(box, frame, width, CROP_HEIGHT, dir) : undefined
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
            <div className="lcp-shot" ref={shot} style={{ blockSize: CROP_HEIGHT }}>
              {crop ? (
                <>
                  <img
                    src={src}
                    alt={`${lang} render, cropped to the largest paint element`}
                    style={{ inlineSize: crop.imageWidth, left: crop.left, top: crop.top }}
                  />
                  <span
                    className="lcp-box"
                    style={{
                      left: crop.box.x,
                      top: crop.box.y,
                      width: crop.box.w,
                      height: crop.box.h,
                    }}
                  >
                    <span className="lcp-label" dir="ltr">
                      LCP {num(perf.lcp.ms)} ms
                    </span>
                  </span>
                </>
              ) : null}
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

/** Bytes of a type; the document counts as other, as in the design. */
const bytesOf = (p: PagePerf, type: ResourceType) =>
  type === 'other' ? p.bytes.other + p.bytes.document : p.bytes[type]

function Weight({ perf, dirs }: { perf: NonNullable<RouteResult['perf']>; dirs: Dir[] }) {
  const max = Math.max(...dirs.map((d) => total(perf[d] as PagePerf)))
  const types = TYPES.filter((t) => dirs.some((d) => (perf[d] ? bytesOf(perf[d], t.id) : 0) > 0))
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
                bytesOf(p, t.id) ? (
                  <span
                    key={t.id}
                    className={`weight-${t.id}`}
                    style={{ flexGrow: bytesOf(p, t.id) }}
                    title={`${t.label} ${num(kb(bytesOf(p, t.id)))} KB`}
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
                <td key={d}>{num(kb(perf[d] ? bytesOf(perf[d], t.id) : 0))}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  )
}
