import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { GLYPHS, plural } from './copy'
import { engineWords, type DashboardData, type HistoryRun, type View } from './data'
import {
  channelOf,
  channels,
  comparison,
  countBy,
  day,
  diff,
  failed,
  findingsOf,
  inArea,
  lcpOf,
  moment,
  open,
  overBudget,
  runName,
  took,
  type Compare,
  type RunFinding,
} from './history'
import { ByEngine } from './CrossStage'
import { Links, Titles } from './SiteView'
import { Segmented } from './ui'

type Tab = 'overview' | 'runs' | 'pages' | 'trends' | 'site'
const TABS: { id: Tab; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'runs', label: 'Runs' },
  { id: 'pages', label: 'Pages' },
  { id: 'trends', label: 'Trends' },
  { id: 'site', label: 'Site views' },
]

const AREAS: { id: View; label: string; short: string; color: string }[] = [
  { id: 'localization', label: 'Localization', short: 'Localization', color: 'var(--a-l10n)' },
  { id: 'seo', label: 'SEO', short: 'SEO', color: 'var(--a-seo)' },
  { id: 'performance', label: 'Performance', short: 'Perf', color: 'var(--a-perf)' },
  { id: 'cross-browser', label: 'Cross-browser', short: 'XB', color: 'var(--a-xb)' },
]

type State = { tab: Tab; channel?: string; compare: Compare }

function readState(hash: string): State {
  const p = new URLSearchParams(hash.replace(/^#/, ''))
  const tab = TABS.find((t) => t.id === p.get('tab'))?.id ?? 'overview'
  const compare = p.get('compare')
  return {
    tab,
    ...(p.get('channel') ? { channel: p.get('channel') as string } : {}),
    compare:
      compare === 'previous' || compare === 'week' || compare?.startsWith('channel:')
        ? (compare as Compare)
        : 'week',
  }
}

function writeState(s: State) {
  const p = new URLSearchParams()
  if (s.tab !== 'overview') p.set('tab', s.tab)
  if (s.channel) p.set('channel', s.channel)
  if (s.compare !== 'week') p.set('compare', s.compare)
  return `#${p.toString()}`
}

function useDashboardState(): [State, (next: Partial<State>) => void] {
  const [state, setState] = useState(() => readState(location.hash))
  useEffect(() => {
    const onHash = () => setState(readState(location.hash))
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])
  return [
    state,
    (next) =>
      setState((current) => {
        const merged = { ...current, ...next }
        history.replaceState(null, '', writeState(merged))
        return merged
      }),
  ]
}

/** dashboard.html: many runs from the history folder, compared. */
export function Dashboard({ data }: { data: DashboardData }) {
  const [state, update] = useDashboardState()
  const names = useMemo(() => channels(data.runs), [data.runs])
  const channel = state.channel && names.includes(state.channel) ? state.channel : names[0]
  const runs = data.runs.filter((r) => channelOf(r) === channel)
  const latest = runs.at(-1)
  const project = data.runs.at(-1)?.run?.project ?? data.latest?.run?.project ?? 'This project'
  // The newest report.html only belongs to the newest run overall.
  const newest = data.runs.at(-1)
  const reportFor = (run: HistoryRun) =>
    run === newest && data.reportHref ? data.reportHref : run.run?.url

  return (
    <div className="dash">
      <a className="skip" href="#dash-main">
        Skip to the dashboard
      </a>
      <header className="dash-bar">
        <p className="brand">
          <span className="brand-mark" aria-hidden="true" />
          Miraya<span className="sr"> dashboard</span>
        </p>
        <span className="dash-project">{project}</span>
        <nav className="dash-nav" aria-label="Dashboard">
          {TABS.map((t) => (
            <a
              key={t.id}
              href={writeState({ ...state, tab: t.id })}
              aria-current={state.tab === t.id ? 'page' : undefined}
              onClick={(e) => {
                e.preventDefault()
                update({ tab: t.id })
              }}
            >
              {t.label}
            </a>
          ))}
        </nav>
        <span className="spacer" />
        {state.tab === 'site' && data.latest ? (
          <span className="dash-run muted">
            {data.latest.run?.pr
              ? `Pull request #${data.latest.run.pr}`
              : (data.latest.run?.channel ?? data.latest.run?.branch ?? 'Newest run')}{' '}
            · {moment(data.latest.startedAt)}
            {data.latest.run?.commit ? ` · ${data.latest.run.commit}` : ''}
          </span>
        ) : null}
        {names.length > 1 && state.tab !== 'site' && state.tab !== 'runs' ? (
          <Segmented
            label="Runs from"
            options={names}
            value={channel as string}
            text={(n) => n}
            onChange={(n) => update({ channel: n })}
          />
        ) : null}
      </header>

      <main className="dash-main" id="dash-main" tabIndex={-1}>
        {!latest ? (
          <section className="state-card dash-empty">
            <h1>No runs yet</h1>
            <p>
              Every <code>miraya audit</code> adds a run to the history folder; this page compares
              them.
            </p>
          </section>
        ) : state.tab === 'overview' ? (
          <Overview
            runs={runs}
            all={data.runs}
            latest={latest}
            channel={channel as string}
            channelNames={names}
            project={project}
            compare={state.compare}
            onCompare={(compare) => update({ compare })}
            onTab={(tab) => update({ tab })}
            reportFor={reportFor}
          />
        ) : state.tab === 'runs' ? (
          <RecentRuns runs={data.runs} reportFor={reportFor} />
        ) : state.tab === 'pages' ? (
          <PagesTable
            runs={runs}
            latest={latest}
            base={comparison(runs, data.runs, latest, state.compare)}
            reportHref={latest === newest ? data.reportHref : undefined}
          />
        ) : state.tab === 'trends' ? (
          <TrendTabs runs={runs} channel={channel as string} />
        ) : (
          <SiteTab data={data} />
        )}
      </main>
    </div>
  )
}

/* ------------------------------------------------------------------ overview */

const COMPARE_WORDS = { week: 'since last week', previous: 'since the previous run' }

function Overview({
  runs,
  all,
  latest,
  channel,
  channelNames,
  project,
  compare,
  onCompare,
  onTab,
  reportFor,
}: {
  runs: HistoryRun[]
  all: HistoryRun[]
  latest: HistoryRun
  channel: string
  channelNames: string[]
  project: string
  compare: Compare
  onCompare: (c: Compare) => void
  onTab: (t: Tab) => void
  reportFor: (r: HistoryRun) => string | undefined
}) {
  const base = comparison(runs, all, latest, compare)
  const { added, fixed, accepted } = diff(latest, base)
  const newErrors = added.filter((f) => f.severity === 'error')
  const since =
    compare === 'week' || compare === 'previous'
      ? COMPARE_WORDS[compare]
      : `compared with ${compare.slice('channel:'.length)}`
  const headline = !base
    ? 'No earlier run to compare with'
    : newErrors.length
      ? `${plural(newErrors.length, 'new error')} on ${channel} ${since}`
      : `No new errors on ${channel} ${since}`
  const switchedOff = AREAS.filter((a) => !areaOn(runs, a.id))

  return (
    <>
      <div className="dash-head">
        <div className="dash-title">
          <h1>{headline}</h1>
          <p className="muted">
            Last run {moment(latest.startedAt)}
            {latest.run?.commit ? (
              <>
                {' '}
                · <code>{latest.run.commit}</code>
              </>
            ) : null}{' '}
            · {plural(latest.routes.length, 'page')}
            {base ? (
              <>
                {' '}
                · compared with {day(base.startedAt)}
                {base.run?.commit ? (
                  <>
                    , <code>{base.run.commit}</code>
                  </>
                ) : null}
              </>
            ) : (
              ' · trends start from this run'
            )}
          </p>
        </div>
        <label className="field">
          Compare with
          <select value={compare} onChange={(e) => onCompare(e.target.value as Compare)}>
            <option value="week">A week ago</option>
            <option value="previous">The previous run</option>
            {channelNames
              .filter((n) => n !== channel)
              .map((n) => (
                <option key={n} value={`channel:${n}`}>
                  {n}
                </option>
              ))}
          </select>
        </label>
      </div>

      <section className="health" aria-label="Health by area">
        {AREAS.filter((a) => areaOn(runs, a.id)).map((a) => (
          <AreaCard
            key={a.id}
            area={a}
            runs={runs}
            latest={latest}
            base={base}
            added={added}
            href={reportFor(latest) === undefined ? undefined : reportFor(latest)}
          />
        ))}
      </section>
      {switchedOff.length ? (
        <p className="dash-note muted">
          {listWords(switchedOff.map((a) => a.label))}{' '}
          {switchedOff.length === 1 ? "isn't" : "aren't"} switched on for {project}.{' '}
          <a
            href="https://github.com/omaritooo/miraya/tree/main/packages/miraya#configuration"
            target="_blank"
            rel="noreferrer"
          >
            How to turn on an area
          </a>
        </p>
      ) : null}

      <div className="dash-row">
        <section className="panel dash-chart" aria-labelledby="trend-title">
          <Trend runs={runs} channel={channel} days={30} titleId="trend-title" />
        </section>
        <section className="panel dash-new" aria-labelledby="new-title">
          <div className="panel-head">
            <h2 id="new-title">
              {base ? `New since ${day(base.startedAt)}` : 'Findings in this run'}
            </h2>
          </div>
          <NewList added={added} />
          {base ? (
            <p className="panel-foot">
              <span className="pos">✓ {fixed.length} fixed</span> · {accepted.length} accepted into
              baseline
            </p>
          ) : null}
        </section>
      </div>

      <PagesTable
        runs={runs}
        latest={latest}
        base={base}
        limit={5}
        onAll={() => onTab('pages')}
        reportHref={reportFor(latest)?.endsWith('.html') ? reportFor(latest) : undefined}
      />
      <RecentRuns runs={all} limit={4} onAll={() => onTab('runs')} reportFor={reportFor} />
    </>
  )
}

const listWords = (words: string[]) =>
  words.length > 1 ? `${words.slice(0, -1).join(', ')} and ${words.at(-1)}` : (words[0] ?? '')

function areaOn(runs: HistoryRun[], area: View) {
  const last = runs.at(-1)
  if (!last) return false
  return area === 'cross-browser'
    ? runs.some((r) => r.engines.length > 1)
    : area === 'localization' || runs.some((r) => r.checks.includes(area))
}

/** One area's open findings, for a run. */
const areaFindings = (run: HistoryRun, area: View) => open(run).filter((f) => inArea(f, area))

/** The number a card's sparkline and verdict follow. */
function score(run: HistoryRun, area: View) {
  if (area === 'performance') return run.routes.filter(overBudget).length
  const fs = areaFindings(run, area)
  return countBy(fs, 'error') * 1000 + countBy(fs, 'warn')
}

function AreaCard({
  area,
  runs,
  latest,
  base,
  added,
  href,
}: {
  area: (typeof AREAS)[number]
  runs: HistoryRun[]
  latest: HistoryRun
  base: HistoryRun | undefined
  added: RunFinding[]
  href: string | undefined
}) {
  const fs = areaFindings(latest, area.id)
  const before = base ? areaFindings(base, area.id) : undefined
  const now = score(latest, area.id)
  const then = base ? score(base, area.id) : undefined
  const verdict =
    then === undefined ? undefined : now > then ? 'Worse' : now < then ? 'Better' : 'Same'
  const dev = area.id === 'performance' && latest.devServer
  const recent = runs.slice(-12)
  const series =
    area.id === 'performance'
      ? recent.map((r) => Math.max(0, ...r.routes.map(lcpOf)))
      : recent.map((r) => areaFindings(r, area.id).length)

  const numbers: { value: string; label: ReactNode; tone?: string }[] =
    area.id === 'performance'
      ? [
          {
            value: String(latest.routes.filter(overBudget).length),
            label: 'pages over budget',
            tone: latest.routes.some(overBudget) && !dev ? 'error' : undefined,
          },
          {
            value: Math.max(0, ...latest.routes.map(lcpOf)).toLocaleString('en-US'),
            label: 'worst LCP, ms',
          },
        ]
      : area.id === 'cross-browser'
        ? [
            {
              value: String(fs.length),
              label: fs.length
                ? `${engineWords(fs[0]?.engines ?? [])}${fs.every((f) => f.engines?.join() === fs[0]?.engines?.join()) ? ' only' : ''}`
                : 'differences',
              tone: fs.length ? 'warn' : undefined,
            },
            { value: String(latest.engines.length), label: 'engines' },
          ]
        : (['error', 'warn', 'info'] as const)
            .filter((s) => s !== 'info' || countBy(fs, 'info'))
            .map((s) => ({
              value: String(countBy(fs, s)),
              label: (
                <>
                  <span aria-hidden="true" className={`sev-${s}`}>
                    {GLYPHS[s]}
                  </span>{' '}
                  {s === 'error'
                    ? countBy(fs, s) === 1
                      ? 'error'
                      : 'errors'
                    : s === 'warn'
                      ? countBy(fs, s) === 1
                        ? 'warning'
                        : 'warnings'
                      : 'info'}
                </>
              ),
              ...(countBy(fs, s) && s !== 'info' ? { tone: s } : {}),
            }))

  const body = (
    <>
      <div className="card-head">
        <span className="area-dot" style={{ background: area.color }} aria-hidden="true" />
        <h2>{area.label}</h2>
        {dev ? (
          <span className="card-verdict muted">Dev server</span>
        ) : verdict ? (
          <span className={`card-verdict verdict-${verdict.toLowerCase()}`}>
            {verdict === 'Better' ? '✓ ' : ''}
            {verdict}
          </span>
        ) : null}
      </div>
      <div className={`card-numbers${dev ? ' greyed' : ''}`}>
        {numbers.map((n, i) => (
          <span key={i}>
            <span className={`metric ${n.tone ? `sev-${n.tone}` : ''}`}>{n.value}</span>
            <span className="caption">{n.label}</span>
          </span>
        ))}
      </div>
      <Spark values={series} color={area.color} />
      <p className="card-note">{cardNote(area.id, fs, before, added, latest)}</p>
    </>
  )
  return href ? (
    <a
      className="card"
      href={`${href}${href.endsWith('.html') ? `#area=${area.id === 'localization' ? '' : area.id}` : ''}`}
    >
      {body}
    </a>
  ) : (
    <div className="card">{body}</div>
  )
}

/** What changed in an area, in a sentence: "+3 errors, from not-mirrored on /pricing". */
function cardNote(
  area: View,
  now: RunFinding[],
  before: RunFinding[] | undefined,
  added: RunFinding[],
  latest: HistoryRun,
): ReactNode {
  if (area === 'performance') {
    if (latest.devServer) return 'Measured on a dev server, so these numbers don’t count.'
    const worst = [...latest.routes].sort((a, b) => lcpOf(b) - lcpOf(a))[0]
    if (!worst || lcpOf(worst) < 0) return 'No page was measured.'
    const ar = (worst.lcp?.rtl ?? -1) >= (worst.lcp?.ltr ?? -1)
    return (
      <>
        Slowest: <code>{worst.route}</code> in {ar ? 'Arabic' : 'English'}.
      </>
    )
  }
  if (area === 'cross-browser') {
    return latest.engines.includes('chromium') && latest.engines.length > 1 ? (
      <>
        <code>fallback-font</code> is skipped on{' '}
        {engineWords(latest.engines.filter((e) => e !== 'chromium'))}.
      </>
    ) : (
      `Compares ${engineWords(latest.engines)}.`
    )
  }
  if (!before) return plural(now.length, 'open finding')
  const delta = (s: 'error' | 'warn', word: string) => {
    const d = countBy(now, s) - countBy(before, s)
    return d ? `${d > 0 ? '+' : '−'}${plural(Math.abs(d), word)}` : ''
  }
  const parts = [delta('error', 'error'), delta('warn', 'warning')].filter(Boolean)
  const fresh = added.filter((f) => inArea(f, area))
  const rules = [...new Set(fresh.map((f) => f.rule))].slice(0, 2)
  const pages = [...new Set(fresh.map((f) => f.route))]
  if (!parts.length && !fresh.length) return 'No change.'
  return (
    <>
      {parts.join(', ') || 'Same counts'}
      {rules.length ? (
        <>
          , from{' '}
          {rules.map((r, i) => (
            <span key={r}>
              {i ? ' and ' : ''}
              <code>{r}</code>
            </span>
          ))}{' '}
          on{' '}
          {pages.length > 2
            ? plural(pages.length, 'page')
            : pages.map((p, i) => (
                <span key={p}>
                  {i ? ' and ' : ''}
                  <code>{p}</code>
                </span>
              ))}
        </>
      ) : null}
      .
    </>
  )
}

function Spark({ values, color }: { values: number[]; color: string }) {
  if (values.length < 2) return <div className="spark spark-empty" aria-hidden="true" />
  const max = Math.max(...values, 1)
  const min = Math.min(...values)
  const span = max - min || 1
  const points = values
    .map((v, i) => `${(i / (values.length - 1)) * 220},${32 - ((v - min) / span) * 26}`)
    .join(' ')
  return (
    <svg className="spark" aria-hidden="true" viewBox="0 0 220 36" preserveAspectRatio="none">
      <polyline
        points={points}
        fill="none"
        stroke={color}
        strokeWidth="2"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  )
}

const SIDES: Record<string, string> = {
  ltr: 'English only',
  rtl: 'Arabic only',
  both: 'both languages',
}

function NewList({ added }: { added: RunFinding[] }) {
  // Copies of one element merge, so a shared component reads as one problem.
  const groups = new Map<string, RunFinding[]>()
  for (const f of [...added].sort((a, b) => rank(a) - rank(b))) {
    const key = `${f.rule} ${f.label ?? f.side ?? f.route}`
    groups.set(key, [...(groups.get(key) ?? []), f])
  }
  const list = [...groups.values()]
  if (!list.length) return <p className="panel-empty muted">Nothing new.</p>
  return (
    <ul className="new-list">
      {list.slice(0, 8).map((g) => {
        const f = g[0] as RunFinding
        const pages = [...new Set(g.map((x) => x.route))]
        return (
          <li key={`${f.rule}${f.id}`}>
            <span className={`sev-${f.severity}`} aria-hidden="true">
              {GLYPHS[f.severity]}
            </span>
            <span className="new-what">
              <code>{f.rule}</code> on{' '}
              {pages.length > 2
                ? plural(pages.length, 'page')
                : pages.map((p, i) => (
                    <span key={p}>
                      {i ? ', ' : ''}
                      <code>{p}</code>
                    </span>
                  ))}
              <span className="new-sub">
                {[
                  g.length > 1 && f.label ? `${g.length} copies of ${f.label}` : f.label,
                  f.side ? SIDES[f.side] : undefined,
                  f.engines ? `${engineWords(f.engines)} only` : undefined,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </span>
            </span>
          </li>
        )
      })}
      {list.length > 8 ? <li className="muted">and {plural(list.length - 8, 'more')}</li> : null}
    </ul>
  )
}

const RANKS = { error: 0, warn: 1, info: 2 }
const rank = (f: RunFinding) => RANKS[f.severity]

/* ------------------------------------------------------------------ trend chart */

function Trend({
  runs,
  channel,
  days,
  titleId,
}: {
  runs: HistoryRun[]
  channel: string
  days: number
  titleId: string
}) {
  const [errorsOnly, setErrorsOnly] = useState(false)
  const last = runs.at(-1)
  const from = last ? Date.parse(last.startedAt) - days * 24 * 60 * 60 * 1000 : 0
  const shown = runs.filter((r) => Date.parse(r.startedAt) >= from)
  const lines = AREAS.filter((a) => areaOn(runs, a.id)).map((a) => ({
    ...a,
    values: shown.map(
      (r) =>
        findingsOf(r).filter(
          (f) => inArea(f, a.id) && (errorsOnly ? f.severity === 'error' : f.severity !== 'info'),
        ).length,
    ),
  }))
  const max = Math.max(4, ...lines.flatMap((l) => l.values))
  const step = niceStep(max)
  const top = Math.ceil(max / step) * step
  const t0 = shown[0] ? Date.parse(shown[0].startedAt) : 0
  const t1 = last ? Date.parse(last.startedAt) : 1
  const x = (r: HistoryRun) => 40 + ((Date.parse(r.startedAt) - t0) / (t1 - t0 || 1)) * 600
  const y = (v: number) => 210 - (v / top) * 190
  const ticks = Array.from({ length: Math.floor(top / step) + 1 }, (_, i) => i * step)
  const dates = shown.length > 1 ? [0, 1 / 3, 2 / 3, 1].map((p) => t0 + p * (t1 - t0)) : [t0]
  const summary = lines
    .map((l) => `${l.label} ${l.values[0] ?? 0} to ${l.values.at(-1) ?? 0}`)
    .join('. ')
  // End labels move apart so they never overlap.
  const ends = lines.map((l) => ({ ...l, at: y(l.values.at(-1) ?? 0) })).sort((a, b) => a.at - b.at)
  for (let i = 1; i < ends.length; i++) {
    const prev = ends[i - 1]
    const cur = ends[i]
    if (prev && cur && cur.at - prev.at < 14) cur.at = prev.at + 14
  }

  return (
    <>
      <div className="panel-head panel-head-inline">
        <h2 id={titleId}>
          {errorsOnly ? 'Errors' : 'Errors and warnings'} on {channel}, {days} days
        </h2>
        <Segmented
          label="Severity"
          options={['all', 'errors'] as const}
          value={errorsOnly ? 'errors' : 'all'}
          text={(v) => (v === 'all' ? 'Errors and warnings' : 'Errors')}
          onChange={(v) => setErrorsOnly(v === 'errors')}
        />
      </div>
      {shown.length < 2 ? (
        <p className="panel-empty muted">
          Trends start from this run: there’s one run in the last {days} days.
        </p>
      ) : (
        <svg
          className="chart"
          role="img"
          aria-label={`Findings per area over ${days} days. ${summary}.`}
          viewBox="0 0 740 240"
          direction="ltr"
        >
          {ticks.map((t) => (
            <g key={t}>
              <line className="grid" x1="40" x2="640" y1={y(t)} y2={y(t)} />
              <text x="32" y={y(t) + 4} textAnchor="end">
                {t}
              </text>
            </g>
          ))}
          {dates.map((d, i) => (
            <text
              key={d}
              x={40 + (i / Math.max(1, dates.length - 1)) * 600}
              y="232"
              textAnchor={i === 0 ? 'start' : i === dates.length - 1 ? 'end' : 'middle'}
            >
              {day(new Date(d).toISOString())}
            </text>
          ))}
          {lines.map((l) => (
            <polyline
              key={l.id}
              points={shown.map((r, i) => `${x(r)},${y(l.values[i] ?? 0)}`).join(' ')}
              fill="none"
              stroke={l.color}
              strokeWidth="2.5"
              strokeLinejoin="round"
            />
          ))}
          {ends.map((l) => (
            <text key={l.id} x="648" y={l.at + 4} className={`end-label end-${l.id}`}>
              {l.short} {l.values.at(-1) ?? 0}
            </text>
          ))}
        </svg>
      )}
    </>
  )
}

function niceStep(max: number) {
  const raw = max / 4
  const mag = 10 ** Math.floor(Math.log10(raw))
  const n = raw / mag
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * mag
}

function TrendTabs({ runs, channel }: { runs: HistoryRun[]; channel: string }) {
  const [range, setRange] = useState<'30' | '90'>('30')
  return (
    <section className="panel dash-chart" aria-labelledby="trends-title">
      <div className="dash-tools">
        <Segmented
          label="Range"
          options={['30', '90'] as const}
          value={range}
          text={(d) => `${d} days`}
          onChange={setRange}
        />
      </div>
      <Trend runs={runs} channel={channel} days={Number(range)} titleId="trends-title" />
    </section>
  )
}

/* ------------------------------------------------------------------ pages */

function PagesTable({
  runs,
  latest,
  base,
  limit,
  onAll,
  reportHref,
}: {
  runs: HistoryRun[]
  latest: HistoryRun
  base: HistoryRun | undefined
  limit?: number
  onAll?: () => void
  reportHref?: string | undefined
}) {
  const xb = latest.engines.length > 1
  const perf = latest.checks.includes('performance')
  const seo = latest.checks.includes('seo')
  const rows = latest.routes.map((r) => {
    const fs = r.findings.filter((f) => !f.known)
    const before = base?.routes.find((b) => b.route === r.route)
    const newErrors = before
      ? fs.filter((f) => f.severity === 'error' && !before.findings.some((b) => b.id === f.id))
          .length
      : 0
    return { r, fs, before, newErrors }
  })
  rows.sort(
    (a, b) =>
      Number(b.r.status === 'error') - Number(a.r.status === 'error') ||
      b.newErrors - a.newErrors ||
      countBy(b.fs, 'error') - countBy(a.fs, 'error') ||
      b.fs.length - a.fs.length,
  )
  const shown = limit ? rows.slice(0, limit) : rows
  // How many runs in a row a page has failed, newest back.
  const streak = (route: string) => {
    let n = 0
    for (const run of [...runs].reverse()) {
      if (run.routes.find((x) => x.route === route)?.status !== 'error') break
      n++
    }
    return n
  }
  const cells = (fs: RunFinding[] | HistoryRun['routes'][number]['findings'], area: View) => {
    const own = fs.filter((f) => inArea(f, area))
    const e = countBy(own, 'error')
    const w = countBy(own, 'warn')
    if (!e && !w) return <span className="muted">0</span>
    return (
      <>
        {e ? (
          <span className="sev-error">
            <span aria-hidden="true">◆</span> {e}
            <span className="sr"> {e === 1 ? 'error' : 'errors'}</span>
          </span>
        ) : null}
        {e && w ? <span aria-hidden="true"> · </span> : null}
        {w ? (
          <span className="sev-warn">
            <span aria-hidden="true">▲</span> {w}
            <span className="sr"> {w === 1 ? 'warning' : 'warnings'}</span>
          </span>
        ) : null}
      </>
    )
  }
  const cols = 3 + Number(seo) + Number(perf) + Number(xb)

  return (
    <section className="panel" aria-labelledby="pages-title">
      <div className="panel-head">
        <h2 id="pages-title">{limit ? 'Worst pages' : 'Pages'}</h2>
        <span className="muted">Sorted by new errors, then all errors</span>
        {onAll && rows.length > shown.length ? (
          <button type="button" className="link panel-link" onClick={onAll}>
            All {plural(rows.length, 'page')}
          </button>
        ) : null}
      </div>
      <div className="table-box table-flush">
        <table className="evidence dash-table">
          <thead>
            <tr>
              <th scope="col">Page</th>
              <th scope="col" className="num">
                <span className="area-dot area-localization" aria-hidden="true" /> Localization
              </th>
              {seo ? (
                <th scope="col" className="num">
                  <span className="area-dot area-seo" aria-hidden="true" /> SEO
                </th>
              ) : null}
              {perf ? (
                <th scope="col" className="num">
                  <span className="area-dot area-performance" aria-hidden="true" /> LCP en / ar
                </th>
              ) : null}
              {xb ? (
                <th scope="col" className="num">
                  <span className="area-dot area-cross-browser" aria-hidden="true" /> Cross-browser
                </th>
              ) : null}
              <th scope="col" className="num">
                {base ? `Since ${day(base.startedAt)}` : 'Change'}
              </th>
            </tr>
          </thead>
          <tbody>
            {shown.map(({ r, fs, before, newErrors }) => (
              <tr key={r.route}>
                <th scope="row">
                  {reportHref ? (
                    <a href={`${reportHref}#route=${encodeURIComponent(r.route)}`}>
                      <bdi dir="ltr">
                        <code>{r.route}</code>
                      </bdi>
                    </a>
                  ) : (
                    <bdi dir="ltr">
                      <code>{r.route}</code>
                    </bdi>
                  )}
                </th>
                {r.status === 'error' ? (
                  <>
                    <td colSpan={cols - 2} className="sev-error failed-cell">
                      <span aria-hidden="true">⊠</span> Not audited
                      {streak(r.route) > 1 ? ` for ${streak(r.route)} runs` : ''}: {r.error}
                    </td>
                    <td className="num muted">–</td>
                  </>
                ) : (
                  <>
                    <td className="num">{cells(fs, 'localization')}</td>
                    {seo ? <td className="num">{cells(fs, 'seo')}</td> : null}
                    {perf ? (
                      <td className="num">
                        <Lcp
                          ms={r.lcp?.ltr}
                          over={overBudget(r) && (r.lcp?.ltr ?? 0) >= (r.lcp?.rtl ?? 0)}
                        />
                        {' / '}
                        <Lcp
                          ms={r.lcp?.rtl}
                          over={overBudget(r) && (r.lcp?.rtl ?? 0) > (r.lcp?.ltr ?? 0)}
                        />
                      </td>
                    ) : null}
                    {xb ? (
                      <td className="num">
                        {fs.filter((f) => f.engines).length ? (
                          <span className="sev-warn">
                            <span aria-hidden="true">▲</span> {fs.filter((f) => f.engines).length}{' '}
                            <span className="muted">
                              {engineWords(fs.find((f) => f.engines)?.engines ?? [])} only
                            </span>
                          </span>
                        ) : (
                          <span className="muted">0</span>
                        )}
                      </td>
                    ) : null}
                    <td className="num">
                      <Change
                        fs={fs}
                        before={before}
                        newErrors={newErrors}
                        base={!!base}
                        over={overBudget(r)}
                      />
                    </td>
                  </>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

function Lcp({ ms, over }: { ms: number | undefined; over: boolean }) {
  if (ms === undefined) return <span className="muted">–</span>
  return (
    <span className={over ? 'sev-error strong' : undefined}>
      {Math.round(ms).toLocaleString('en-US')}
    </span>
  )
}

function Change({
  fs,
  before,
  newErrors,
  base,
  over,
}: {
  fs: HistoryRun['routes'][number]['findings']
  before: HistoryRun['routes'][number] | undefined
  newErrors: number
  base: boolean
  over: boolean
}) {
  if (!base) return <span className="muted">–</span>
  if (!before) return <span className="muted">new page</span>
  if (newErrors) return <span className="sev-error strong">+{plural(newErrors, 'error')}</span>
  const was = before.findings.filter((f) => !f.known)
  const dw = countBy(fs, 'warn') - countBy(was, 'warn')
  const de = countBy(fs, 'error') - countBy(was, 'error')
  if (de < 0) return <span className="pos strong">✓ −{plural(-de, 'error')}</span>
  if (dw < 0) return <span className="pos strong">✓ −{plural(-dw, 'warning')}</span>
  if (dw > 0) return <span className="sev-warn">+{plural(dw, 'warning')}</span>
  if (over) return <span className="sev-error">over budget</span>
  return <span className="muted">same</span>
}

/* ------------------------------------------------------------------ runs */

function RecentRuns({
  runs,
  limit,
  onAll,
  reportFor,
}: {
  runs: HistoryRun[]
  limit?: number
  onAll?: () => void
  reportFor: (r: HistoryRun) => string | undefined
}) {
  const newest = [...runs].reverse()
  const shown = limit ? newest.slice(0, limit) : newest
  return (
    <section className="panel" aria-labelledby="runs-title">
      <div className="panel-head">
        <h2 id="runs-title">{limit ? 'Recent runs' : `Runs · ${runs.length}`}</h2>
        {onAll && runs.length > shown.length ? (
          <button type="button" className="link panel-link" onClick={onAll}>
            All runs
          </button>
        ) : null}
      </div>
      <ul className="run-list">
        {shown.map((run) => {
          const bad = failed(run)
          const errors = countBy(open(run), 'error')
          const over = run.routes.filter(overBudget).length
          const down = run.routes.filter((r) => r.status === 'error').length
          const href = reportFor(run)
          const summary = [
            errors ? plural(errors, 'new error') : '0 new',
            run.fixed ? `${run.fixed} fixed` : '',
            over && !run.devServer ? `${plural(over, 'page')} over budget` : '',
            down ? `${plural(down, 'page')} not audited` : '',
            run.engines.length > 1 ? `${run.engines.length} engines` : '',
            plural(run.routes.length, 'page'),
            took(run.durationMs),
          ].filter(Boolean)
          return (
            <li key={run.startedAt}>
              <span className={`run-status ${bad ? 'sev-error' : 'pos'}`}>
                <span aria-hidden="true">{bad ? '◆' : '✓'}</span> {bad ? 'Failed' : 'Passed'}
              </span>
              <time dateTime={run.startedAt}>{moment(run.startedAt)}</time>
              <span className="run-name">{runName(run)}</span>
              <code className="run-commit">{run.run?.commit ?? ''}</code>
              <span className="run-summary muted">{summary.join(' · ')}</span>
              {href ? (
                <a className="run-open" href={href}>
                  Open report<span className="sr"> for {moment(run.startedAt)}</span>
                </a>
              ) : (
                <span className="run-open muted">No report kept</span>
              )}
            </li>
          )
        })}
      </ul>
    </section>
  )
}

/* ------------------------------------------------------------------ site views */

function SiteTab({ data }: { data: DashboardData }) {
  const report = data.latest
  if (!report) {
    return (
      <section className="state-card dash-empty">
        <h1>No report to show</h1>
        <p>
          Site views read the newest <code>report.json</code>. Run <code>miraya audit</code> with
          SEO switched on.
        </p>
      </section>
    )
  }
  const openPage = (route: string, finding?: string) => {
    if (!data.reportHref) return
    location.href = `${data.reportHref}#area=seo&route=${encodeURIComponent(route)}${finding ? `&finding=${finding}` : ''}`
  }
  const engines = report.engines ?? []
  const hasHead = report.routes.some((r) => r.head?.rtl)
  return (
    <>
      <h1 className="sr">Site views</h1>
      {hasHead ? (
        <>
          <Titles
            report={report}
            rules={['page-title', 'meta-description', 'duplicate-title']}
            onOpen={openPage}
          />
          <div className="dash-row">
            <Links report={report} rules={['hreflang', 'canonical']} onOpen={openPage} />
            {engines.length > 1 ? <ByEngine report={report} engines={engines} /> : null}
          </div>
        </>
      ) : (
        <>
          <section className="state-card dash-empty">
            <h1>SEO was switched off in the newest run</h1>
            <p>
              Site views compare every page’s head tags. Add <code>'seo'</code> to{' '}
              <code>checks</code> in the config.
            </p>
          </section>
          {engines.length > 1 ? <ByEngine report={report} engines={engines} /> : null}
        </>
      )}
    </>
  )
}
