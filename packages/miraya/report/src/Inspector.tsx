import { useEffect, useRef, useState } from 'react'
import {
  elementLabel,
  GLYPHS,
  headline,
  ruleFix,
  SEVERITY_WORDS,
  SIDE_WORDS,
  TRANSLATION_STATUS,
} from './copy'
import { kb, TYPES } from './PerfStage'
import {
  engineWords,
  inView,
  isKnown,
  type Finding,
  type PagePerf,
  type RouteResult,
  type RunInfo,
  type View,
} from './data'

export type Tab = 'findings' | 'notes' | 'requests'

export function Inspector({
  route,
  findings,
  selected,
  onSelect,
  tab,
  onTab,
  area,
  run,
}: {
  route: RouteResult
  findings: Finding[]
  selected: Finding | undefined
  onSelect: (id: string) => void
  tab: Tab
  onTab: (tab: Tab) => void
  area: View
  run?: RunInfo | undefined
}) {
  const notes = [
    ...route.notes,
    ...route.skippedRules.map((rule) => `Skipped ${rule} on this page.`),
  ]
  // The slower language's requests: the ones worth trimming.
  const requests = area === 'performance' ? (route.perf?.rtl ?? route.perf?.ltr) : undefined
  const tabs: [Tab, string, number][] = [
    ['findings', 'Findings', findings.length],
    ...(requests ? [['requests', 'Requests', requests.requests] as [Tab, string, number]] : []),
    ['notes', 'Notes', notes.length],
  ]
  const current = tab === 'requests' && !requests ? 'findings' : tab
  return (
    <aside className="inspector" id="inspector" tabIndex={-1} aria-label="Inspector">
      <div className="tabs" role="tablist" aria-label="Inspector">
        {tabs.map(([id, label, count]) => (
          <button
            type="button"
            role="tab"
            key={id}
            id={`tab-${id}`}
            aria-selected={current === id}
            aria-controls={`panel-${id}`}
            onClick={() => onTab(id)}
          >
            {label} <span className="tab-count">{count}</span>
          </button>
        ))}
      </div>
      {current === 'requests' && requests ? (
        <div role="tabpanel" id="panel-requests" aria-labelledby="tab-requests">
          <Requests perf={requests} arabic={!!route.perf?.rtl} />
        </div>
      ) : current === 'findings' ? (
        <div role="tabpanel" id="panel-findings" aria-labelledby="tab-findings">
          <Findings
            route={route}
            area={area}
            findings={findings}
            selected={selected}
            onSelect={onSelect}
            run={run}
          />
        </div>
      ) : (
        <div role="tabpanel" id="panel-notes" aria-labelledby="tab-notes" className="notes">
          {notes.length ? (
            <ul>
              {notes.map((n, i) => (
                <li key={i}>{n}</li>
              ))}
            </ul>
          ) : (
            <p className="muted">No notes on this page.</p>
          )}
        </div>
      )}
    </aside>
  )
}

function Findings({
  route,
  area,
  findings,
  selected,
  onSelect,
  run,
}: {
  route: RouteResult
  area: View
  findings: Finding[]
  selected: Finding | undefined
  onSelect: (id: string) => void
  run?: RunInfo | undefined
}) {
  const inArea = route.findings.filter((f) => inView(f, area))
  const hidden = inArea.length - findings.length
  const list = useRef<HTMLOListElement>(null)
  // Numbers match the outlines on the screenshots; SEO and performance have none.
  const numbered = area === 'localization' || area === 'cross-browser'

  // Keep the selected row in view as j / k move through a long list.
  useEffect(() => {
    list.current?.querySelector('[aria-pressed="true"]')?.scrollIntoView({ block: 'nearest' })
  }, [selected])

  if (findings.length === 0) {
    return (
      <div className="all-clear" id="findings">
        {route.status === 'error' ? (
          <p>Nothing was checked on this page.</p>
        ) : inArea.length === 0 ? (
          <>
            <span className="state-mark pos" aria-hidden="true">
              ✓
            </span>
            <p>
              {area === 'seo'
                ? 'No SEO problems on this page.'
                : area === 'performance'
                  ? 'Every metric is within budget.'
                  : area === 'cross-browser'
                    ? 'Every engine found the same on this page.'
                    : 'Nothing to fix. The Arabic page matches the English one.'}
            </p>
          </>
        ) : (
          <p>
            No findings match these filters. {hidden} {hidden === 1 ? 'is' : 'are'} hidden.
          </p>
        )}
      </div>
    )
  }

  return (
    <>
      <ol className="finding-list" id="findings" aria-label="Findings" ref={list}>
        {findings.map((f, n) => (
          <li key={f.id}>
            <button
              type="button"
              className={`finding sev-${f.severity}`}
              aria-pressed={f === selected}
              onClick={() => onSelect(f.id)}
            >
              {numbered ? <span className="finding-number">{n + 1}</span> : null}
              <span className="glyph" aria-hidden="true">
                {GLYPHS[f.severity]}
              </span>
              <span className="sr">{SEVERITY_WORDS[f.severity]}, </span>
              <code className="finding-rule">{f.rule}</code>
              <span className="finding-label">{elementLabel(f)}</span>
              <StatusTag finding={f} />
              {f.engines ? <span className="tag">{engineWords(f.engines)} only</span> : null}
              {f.possiblyMoved ? <span className="tag tag-warn">Moved?</span> : null}
            </button>
          </li>
        ))}
      </ol>
      {hidden > 0 ? <p className="caption list-note">{hidden} filtered out</p> : null}
      {selected ? <Detail finding={selected} run={run} /> : null}
    </>
  )
}

function StatusTag({ finding }: { finding: Finding }) {
  return isKnown(finding) ? (
    <span className="tag">Known</span>
  ) : (
    <span className="tag tag-new">New</span>
  )
}

// Facts that have their own rows, so the measurements table skips them.
// check and side name the finding; the tags and heading already say them.
const SHOWN_ABOVE = new Set([
  'text',
  'translation',
  'translationKey',
  'translationFile',
  'check',
  'side',
])

type Measure = { key: string; en?: unknown; ar?: unknown; one?: unknown; off?: 'en' | 'ar' }

/** Gap names for the L / R evidence pairs, as the design writes them. */
const STEMS: Record<string, string> = { start: 'gapToStart', end: 'gapToEnd' }

/**
 * Evidence as rows. A value measured in both languages (fooL and fooR, or ltr and rtl)
 * is one row with an English and an Arabic column; anything else spans both.
 */
function measurementRows(evidence: Finding['evidence']): Measure[] {
  const keys = Object.keys(evidence).filter((k) => !SHOWN_ABOVE.has(k))
  const used = new Set<string>()
  const rows: Measure[] = []
  if ('ltr' in evidence || 'rtl' in evidence) {
    const budget = Number(evidence.budget)
    const over = (v: unknown) => typeof v === 'number' && Number.isFinite(budget) && v > budget
    rows.push({
      key: 'measured',
      en: evidence.ltr,
      ar: evidence.rtl,
      ...(over(evidence.rtl)
        ? { off: 'ar' as const }
        : over(evidence.ltr)
          ? { off: 'en' as const }
          : {}),
    })
    used.add('ltr').add('rtl')
  }
  for (const key of keys) {
    if (used.has(key)) continue
    const m = key.match(/^(.+)([LR])$/)
    const twin = m ? `${m[1]}${m[2] === 'L' ? 'R' : 'L'}` : undefined
    if (m && twin && twin in evidence) {
      const stem = m[1] as string
      rows.push({
        key: STEMS[stem] ?? stem,
        en: evidence[`${stem}L`],
        ar: evidence[`${stem}R`],
      })
      used.add(`${stem}L`).add(`${stem}R`)
      continue
    }
    rows.push({ key, one: evidence[key] })
    used.add(key)
  }
  return rows
}

const show = (value: unknown, key?: string) =>
  value === undefined
    ? '–'
    : key === 'side'
      ? (SIDE_WORDS[String(value)] ?? String(value))
      : typeof value === 'number' && !Number.isInteger(value)
        ? String(Math.round(value * 100) / 100)
        : String(value)
const MATCH_WORDS: Record<string, string> = {
  testid: 'by test id',
  path: 'by DOM path',
  heuristic: 'by position and text',
}

/** Copies text, saying so for a moment. Clipboard access can be blocked for file:// pages. */
function useCopy(): [string | undefined, (text: string, what: string) => void] {
  const [copied, setCopied] = useState<string>()
  const copy = async (text: string, what: string) => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(what)
      setTimeout(() => setCopied(undefined), 1500)
    } catch {
      // The command stays on screen to select by hand.
    }
  }
  return [copied, copy]
}

/** A GitHub issue with the finding filled in, when the run knows its repository. */
function issueUrl(finding: Finding, repo: string) {
  const title = `${finding.rule} on ${finding.route}${finding.label ? `: ${finding.label}` : ''}`
  const body = [
    finding.message,
    '',
    `- Page: \`${finding.route}\``,
    `- Element: \`${finding.selector}\``,
    `- Fingerprint: \`${finding.id.slice(0, 10)}\``,
    ...(finding.sourceHint ? [`- Source: \`${finding.sourceHint}\``] : []),
    '',
    `Details: \`npx miraya explain ${finding.id.slice(0, 10)}\` · ${finding.docsUrl}`,
  ].join('\n')
  return `https://github.com/${repo}/issues/new?${new URLSearchParams({ title, body })}`
}

function Detail({ finding, run }: { finding: Finding; run?: RunInfo | undefined }) {
  const command = `npx miraya explain ${finding.id.slice(0, 10)}`
  const accept = `npx miraya baseline accept ${finding.id}`
  const [copied, copy] = useCopy()
  const fix = ruleFix(finding)
  const { text, translation, translationKey, translationFile } = finding.evidence
  const parts = finding.selector.split(/(?<=\s>\s)(?=[^>]*$)/)
  const parent = parts.length > 1 ? parts[0] : ''
  const own = parts.at(-1) ?? finding.selector
  const measurements = measurementRows(finding.evidence)
  const paired = measurements.some((r) => r.en !== undefined || r.ar !== undefined)
  // Page-level SEO and performance findings lead with what's wrong, in a sentence, as in
  // the design; there's no element to name.
  const side = finding.evidence.side
  const pageLevel = finding.area === 'seo' || finding.area === 'performance'
  const sentence = finding.message.replace(/^(English|Arabic): /, '')
  const split = sentence.match(/^(.+?[.!?])\s+(.*)$/s)
  const first = split?.[1] ?? sentence
  const after = split?.[2] ?? ''
  // A written headline when there is one; otherwise the message's first sentence leads.
  const written = pageLevel ? headline(finding) : undefined
  const title = pageLevel ? (written ?? first) : undefined
  const rest = pageLevel ? (written ? sentence : after) : ''

  return (
    <section className="detail" aria-labelledby="detail-title">
      <div className="detail-head">
        <p className="detail-tags">
          <span className={`sev-word sev-${finding.severity}`}>
            <span aria-hidden="true">{GLYPHS[finding.severity]}</span>
            {SEVERITY_WORDS[finding.severity]}
          </span>
          <code className="muted">{finding.rule}</code>
          <StatusTag finding={finding} />
          {title && typeof side === 'string' && SIDE_WORDS[side] ? (
            <span className="tag">{SIDE_WORDS[side]}</span>
          ) : null}
        </p>
        {title ? (
          <>
            <h2 id="detail-title" className="detail-headline">
              {title}
            </h2>
            {rest ? <p>{rest}</p> : null}
          </>
        ) : (
          <>
            <h2 id="detail-title">
              <bdi dir="ltr">
                <code>
                  {parent ? <span className="muted">{parent}</span> : null}
                  {own}
                </code>
              </bdi>
            </h2>
            <p>{finding.message}</p>
          </>
        )}
      </div>

      {fix ? (
        <div className="detail-section">
          <h3>How to fix</h3>
          <p>{fix}</p>
        </div>
      ) : null}

      <div className="detail-section">
        <h3>Facts</h3>
        <dl className="facts">
          {typeof text === 'string' && text ? (
            <>
              <dt>Text</dt>
              <dd>
                <bdi>{text}</bdi>
              </dd>
            </>
          ) : finding.text ? (
            <>
              <dt>Text</dt>
              <dd>
                <bdi>{finding.text}</bdi>
              </dd>
            </>
          ) : null}
          {finding.match ? (
            <>
              <dt>Paired</dt>
              <dd>{MATCH_WORDS[finding.match] ?? finding.match}</dd>
            </>
          ) : null}
          {typeof translation === 'string' ? (
            <>
              {translationKey !== undefined ? (
                <>
                  <dt>Key</dt>
                  <dd>
                    <code dir="ltr">{String(translationKey)}</code>
                  </dd>
                </>
              ) : null}
              <dt>File</dt>
              <dd>
                {TRANSLATION_STATUS[translation] ?? translation}{' '}
                <code dir="ltr">{String(translationFile)}</code>
              </dd>
            </>
          ) : null}
          {finding.sourceHint ? (
            <>
              <dt>Source</dt>
              <dd>
                <code dir="ltr">{finding.sourceHint}</code>
              </dd>
            </>
          ) : null}
          {finding.engines ? (
            <>
              <dt>Found in</dt>
              <dd>{engineWords(finding.engines)} only</dd>
            </>
          ) : null}
          <dt>Fingerprint</dt>
          <dd>
            <code>{finding.id.slice(0, 10)}</code>
          </dd>
          {finding.possiblyMoved ? (
            <>
              <dt>Maybe moved</dt>
              <dd>
                from fixed entry <code>{finding.possiblyMoved.slice(0, 10)}</code>
              </dd>
            </>
          ) : null}
        </dl>
      </div>

      {measurements.length ? (
        <div className="detail-section">
          <h3>Measurements</h3>
          {paired ? (
            <table className="evidence">
              <thead>
                <tr>
                  <th scope="col">Key</th>
                  <th scope="col">English</th>
                  <th scope="col">Arabic</th>
                </tr>
              </thead>
              <tbody>
                {measurements.map((r) => (
                  <tr key={r.key}>
                    <th scope="row">
                      <code>{r.key}</code>
                    </th>
                    {r.en !== undefined || r.ar !== undefined ? (
                      <>
                        <td dir="ltr" className={r.off === 'en' ? 'off' : undefined}>
                          <code>{show(r.en)}</code>
                        </td>
                        <td dir="ltr" className={r.off === 'ar' ? 'off' : undefined}>
                          <code>{show(r.ar)}</code>
                        </td>
                      </>
                    ) : (
                      <td dir="ltr" colSpan={2}>
                        <code>{show(r.one, r.key)}</code>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <dl className="measures">
              {measurements.map((r) => (
                <div key={r.key}>
                  <dt>
                    <code>{r.key}</code>
                  </dt>
                  <dd dir="ltr">
                    <code>{show(r.one, r.key)}</code>
                  </dd>
                </div>
              ))}
            </dl>
          )}
        </div>
      ) : null}

      <div className="detail-section">
        <div className="command-row" dir="ltr">
          <code>
            <span className="muted">$ </span>
            {command}
          </code>
          <button
            type="button"
            className="button button-sm"
            aria-label="Copy explain command"
            onClick={() => copy(command, 'explain')}
          >
            {copied === 'explain' ? 'Copied' : 'Copy'}
          </button>
          <span className="sr" role="status">
            {copied === 'explain'
              ? 'Command copied'
              : copied === 'accept'
                ? 'Accept command copied: run it in the project'
                : ''}
          </span>
        </div>
        <div className="detail-actions">
          {run?.repo ? (
            <a
              className="button button-primary"
              href={issueUrl(finding, run.repo)}
              target="_blank"
              rel="noreferrer"
            >
              Create issue<span className="sr"> on GitHub (opens in a new tab)</span>
            </a>
          ) : null}
          {isKnown(finding) ? null : (
            <button
              type="button"
              className="button"
              title={accept}
              onClick={() => copy(accept, 'accept')}
            >
              {copied === 'accept' ? 'Command copied' : 'Accept into baseline'}
            </button>
          )}
          <a className="docs-link" href={finding.docsUrl} target="_blank" rel="noreferrer">
            Why and how to fix <span aria-hidden="true">↗</span>
            <span className="sr"> (opens in a new tab)</span>
          </a>
        </div>
      </div>
    </section>
  )
}

const TYPE_LABELS: Record<string, string> = {
  ...Object.fromEntries(TYPES.map((t) => [t.id, t.label])),
  document: 'Document',
}

function Requests({ perf, arabic }: { perf: PagePerf; arabic: boolean }) {
  const shown = perf.resources
  return (
    <div className="requests">
      <p className="caption list-note">
        {arabic ? 'Arabic page' : 'English page'}, heaviest first
        {perf.requests > shown.length ? `; the ${shown.length} largest of ${perf.requests}` : ''}.
      </p>
      <table className="evidence">
        <thead>
          <tr>
            <th scope="col">File</th>
            <th scope="col">Type</th>
            <th scope="col">KB</th>
          </tr>
        </thead>
        <tbody>
          {shown.map((r, i) => (
            <tr key={`${r.url}${i}`}>
              <td dir="ltr" className="request-url">
                <code title={r.url}>{path(r.url)}</code>
                {r.blocking ? <span className="tag tag-warn">Blocking</span> : null}
              </td>
              <td>{TYPE_LABELS[r.type] ?? r.type}</td>
              <td>{kb(r.bytes).toLocaleString('en-US')}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

const path = (url: string) => {
  try {
    const u = new URL(url)
    return `${u.host === location.host ? '' : u.host}${u.pathname}`
  } catch {
    return url
  }
}
