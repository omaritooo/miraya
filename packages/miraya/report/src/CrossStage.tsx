import { useState, type CSSProperties } from 'react'
import {
  ENGINE_NAMES,
  engineWords,
  type Engine,
  type Finding,
  type Report,
  type RouteResult,
} from './data'
import { plural } from './copy'
import { Pane } from './Stage'
import { Segmented } from './ui'

/**
 * Differences between engines: the main engine's Arabic render beside another one's, each
 * outlining what it found, and every page's findings by engine.
 */
export function CrossStage({
  report,
  route,
  findings,
  selected,
  images,
  viewportWidth,
  onSelect,
  instant,
}: {
  report: Report
  route: RouteResult
  findings: Finding[]
  selected: Finding | undefined
  images: Record<string, string>
  viewportWidth: number
  onSelect: (id: string) => void
  instant: boolean
}) {
  const engines = (report.engines ?? []) as Engine[]
  const [main, ...others] = engines
  // Compare with the engine the selected finding is about, unless one was picked.
  const [picked, setPicked] = useState<Engine>()
  const about =
    selected?.engines?.find((e) => e !== main) ??
    others.find((e) => !selected?.engines?.includes(e))
  const other = picked ?? about ?? others[0]
  const shots = other ? route.engines?.[other] : undefined
  if (!main || !other) return <main className="stage" aria-label="Stage" />

  const frame = (f: { x: number; w: number } | undefined) => f ?? { x: 0, w: viewportWidth }
  const failed = route.status === 'error' || shots?.status === 'error'

  return (
    <main className="stage" aria-label="Stage">
      <div className="toolbar" role="toolbar" aria-label="View">
        {others.length > 1 ? (
          <Segmented
            label="Compare with"
            options={others}
            value={other}
            text={(e) => ENGINE_NAMES[e]}
            onChange={setPicked}
          />
        ) : null}
      </div>

      <div className="stage-head">
        <h1>
          <bdi dir="ltr">{route.route}</bdi>
        </h1>
        <span className="muted">
          {failed
            ? `Not compared: ${shots?.errors[0]?.message ?? route.errors[0]?.message ?? 'the page failed'}`
            : findings.length
              ? `${plural(findings.length, 'difference')} · ${ENGINE_NAMES[main]} and ${ENGINE_NAMES[other]}, Arabic`
              : `The same in ${engineWords(engines)}`}
        </span>
      </div>

      {!failed && shots ? (
        <div className="screens" style={{ '--panes': 2 } as CSSProperties}>
          {(
            [
              [main, route.screenshots.rtl, route.screenshots.frames?.rtl],
              [other, shots.screenshots.rtl, shots.screenshots.frames?.rtl],
            ] as const
          ).map(([engine, shot, f]) => (
            <Pane
              key={`${route.route}-${engine}`}
              dir="rtl"
              label={ENGINE_NAMES[engine]}
              route={route.route}
              src={images[shot] ?? ''}
              frame={frame(f)}
              findings={findings.filter((x) => x.engines?.includes(engine))}
              selected={selected}
              onSelect={onSelect}
              zoom="fit"
              focus={false}
              instant={instant}
            />
          ))}
        </div>
      ) : null}

      <ByEngine report={report} engines={engines} current={route} />
    </main>
  )
}

/** Findings on each page in each engine, in the areas every engine checks. */
function ByEngine({
  report,
  engines,
  current,
}: {
  report: Report
  engines: Engine[]
  current: RouteResult
}) {
  const [main] = engines
  const count = (r: RouteResult, e: Engine) =>
    e === main
      ? r.status === 'ok'
        ? r.findings.filter(
            (f) => f.area !== 'performance' && (!f.engines || f.engines.includes(e)),
          ).length
        : undefined
      : r.engines?.[e]?.status === 'ok'
        ? r.engines[e].findings
        : undefined
  return (
    <section className="by-engine" aria-labelledby="by-engine-title">
      <h2 id="by-engine-title" className="seo-h2">
        Findings by engine
      </h2>
      <div className="table-box">
        <table className="evidence">
          <thead>
            <tr>
              <th scope="col">Page</th>
              {engines.map((e) => (
                <th scope="col" key={e}>
                  {ENGINE_NAMES[e]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {report.routes.map((r) => {
              const counts = engines.map((e) => count(r, e))
              const differs = new Set(counts.filter((c) => c !== undefined)).size > 1
              return (
                <tr key={r.route} aria-current={r === current ? 'true' : undefined}>
                  <th scope="row">
                    <bdi dir="ltr">
                      <code>{r.route}</code>
                    </bdi>
                  </th>
                  {counts.map((c, i) => (
                    <td key={engines[i]} className={differs ? 'differs' : undefined}>
                      {c ?? <span className="muted">failed</span>}
                    </td>
                  ))}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      {engines.some((e) => e !== 'chromium') ? (
        <p className="caption">
          Firefox and WebKit skip <code>fallback-font</code>, which needs Chromium, so they can show
          fewer findings without a difference.
        </p>
      ) : null}
    </section>
  )
}
