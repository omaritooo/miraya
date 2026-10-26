import { useEffect, useRef, useState } from 'react'
import {
  elementLabel,
  evidenceLabel,
  GLYPHS,
  ruleFix,
  ruleTitle,
  SEVERITY_WORDS,
  TRANSLATION_STATUS,
} from './copy'
import { areaOf, isKnown, type Area, type Finding, type RouteResult } from './data'

export type Tab = 'findings' | 'notes'

export function Inspector({
  route,
  findings,
  selected,
  onSelect,
  tab,
  onTab,
  area,
}: {
  route: RouteResult
  findings: Finding[]
  selected: Finding | undefined
  onSelect: (id: string) => void
  tab: Tab
  onTab: (tab: Tab) => void
  area: Area
}) {
  const notes = [
    ...route.notes,
    ...route.skippedRules.map((rule) => `Skipped ${rule} on this page.`),
  ]
  const tabs: [Tab, string, number][] = [
    ['findings', 'Findings', findings.length],
    ['notes', 'Notes', notes.length],
  ]
  return (
    <aside className="inspector" aria-label="Inspector">
      <div className="tabs" role="tablist" aria-label="Inspector">
        {tabs.map(([id, label, count]) => (
          <button
            type="button"
            role="tab"
            key={id}
            id={`tab-${id}`}
            aria-selected={tab === id}
            aria-controls={`panel-${id}`}
            onClick={() => onTab(id)}
          >
            {label} <span className="tab-count">{count}</span>
          </button>
        ))}
      </div>
      {tab === 'findings' ? (
        <div role="tabpanel" id="panel-findings" aria-labelledby="tab-findings">
          <Findings
            route={route}
            area={area}
            findings={findings}
            selected={selected}
            onSelect={onSelect}
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
}: {
  route: RouteResult
  area: Area
  findings: Finding[]
  selected: Finding | undefined
  onSelect: (id: string) => void
}) {
  const inArea = route.findings.filter((f) => areaOf(f) === area)
  const hidden = inArea.length - findings.length
  const list = useRef<HTMLOListElement>(null)

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
              <span className="finding-number">{n + 1}</span>
              <span className="glyph" aria-hidden="true">
                {GLYPHS[f.severity]}
              </span>
              <span className="sr">{SEVERITY_WORDS[f.severity]}, </span>
              <code className="finding-rule">{f.rule}</code>
              <span className="finding-label">{elementLabel(f)}</span>
              <StatusTag finding={f} />
              {f.possiblyMoved ? <span className="tag tag-warn">Moved?</span> : null}
            </button>
          </li>
        ))}
      </ol>
      {hidden > 0 ? <p className="caption list-note">{hidden} filtered out</p> : null}
      {selected ? <Detail finding={selected} /> : null}
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
const SHOWN_ABOVE = new Set(['text', 'translation', 'translationKey', 'translationFile'])
const MATCH_WORDS: Record<string, string> = {
  testid: 'by test id',
  path: 'by DOM path',
  heuristic: 'by position and text',
}

function Detail({ finding }: { finding: Finding }) {
  const command = `npx miraya explain ${finding.id.slice(0, 10)}`
  const [copied, setCopied] = useState(false)
  const fix = ruleFix(finding)
  const { text, translation, translationKey, translationFile } = finding.evidence
  const parts = finding.selector.split(/(?<=\s>\s)(?=[^>]*$)/)
  const parent = parts.length > 1 ? parts[0] : ''
  const own = parts.at(-1) ?? finding.selector
  const measurements = Object.entries(finding.evidence).filter(([key]) => !SHOWN_ABOVE.has(key))

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
        </p>
        <h2 id="detail-title">
          <bdi dir="ltr">
            <code>
              {parent ? <span className="muted">{parent}</span> : null}
              {own}
            </code>
          </bdi>
        </h2>
        <p className="detail-rule">{ruleTitle(finding.rule)}</p>
        <p>{finding.message}</p>
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
          <table className="evidence">
            <thead>
              <tr>
                <th scope="col">Key</th>
                <th scope="col">Value</th>
              </tr>
            </thead>
            <tbody>
              {measurements.map(([key, value]) => (
                <tr key={key}>
                  <th scope="row">{evidenceLabel(key)}</th>
                  <td dir="ltr">
                    <code>{String(value)}</code>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
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
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(command)
                setCopied(true)
                setTimeout(() => setCopied(false), 1500)
              } catch {
                // Clipboard access can be blocked for file:// pages; the command stays selectable.
              }
            }}
          >
            {copied ? 'Copied' : 'Copy'}
          </button>
          <span className="sr" role="status">
            {copied ? 'Command copied' : ''}
          </span>
        </div>
        <a className="docs-link" href={finding.docsUrl} target="_blank" rel="noreferrer">
          Why and how to fix <span aria-hidden="true">↗</span>
          <span className="sr"> (opens in a new tab)</span>
        </a>
      </div>
    </section>
  )
}
