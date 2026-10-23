import { useEffect, useRef, useState } from 'react'
import { evidenceLabel, ruleFix, ruleTitle, SEVERITY_WORDS, TRANSLATION_STATUS } from './copy'
import type { Finding, RouteResult } from './data'

export function Inspector({
  route,
  findings,
  selected,
  onSelect,
}: {
  route: RouteResult
  findings: Finding[]
  selected: Finding | undefined
  onSelect: (id: string) => void
}) {
  const hidden = route.findings.length - findings.length
  const list = useRef<HTMLOListElement>(null)

  // Keep the selected row in view as j / k move through a long list.
  useEffect(() => {
    list.current?.querySelector('[aria-pressed="true"]')?.scrollIntoView({ block: 'nearest' })
  }, [selected])

  return (
    <section className="inspector" aria-labelledby="findings-title">
      <header className="inspector-head">
        <h2 id="findings-title" tabIndex={-1}>
          <span id="findings">Findings</span> <span className="muted">{findings.length}</span>
          {hidden > 0 ? <span className="muted"> · {hidden} filtered out</span> : null}
        </h2>
        {findings.length > 1 ? (
          <p className="keys" aria-hidden="true">
            <kbd>j</kbd> <kbd>k</kbd> to move
          </p>
        ) : null}
      </header>
      {findings.length === 0 ? (
        <p className="all-clear">
          {route.findings.length === 0
            ? 'Nothing to fix. The Arabic page matches the English one.'
            : 'No findings match these filters.'}
        </p>
      ) : (
        <ol className="finding-list" ref={list}>
          {findings.map((f, n) => (
            <li key={f.id}>
              <button
                type="button"
                className={`finding sev-${f.severity}`}
                aria-pressed={f === selected}
                onClick={() => onSelect(f.id)}
              >
                <span className="finding-number">{n + 1}</span>
                <span className="dot" aria-hidden="true" />
                <span className="finding-body">
                  <span className="finding-title">
                    {ruleTitle(f.rule)}
                    <span className="visually-hidden">, {SEVERITY_WORDS[f.severity]}</span>
                    {f.status === 'baselined' ? <span className="tag">known</span> : null}
                    {f.possiblyMoved ? <span className="tag">moved?</span> : null}
                  </span>
                  <code className="finding-element" dir="ltr">
                    {f.selector}
                  </code>
                </span>
              </button>
            </li>
          ))}
        </ol>
      )}
      {selected ? <Detail finding={selected} /> : null}
    </section>
  )
}

// Translation facts have their own rows in the detail.
const SHOWN_ABOVE = new Set(['translation', 'translationKey', 'translationFile'])

function Detail({ finding }: { finding: Finding }) {
  const command = `npx miraya explain ${finding.id.slice(0, 10)}`
  const [copied, setCopied] = useState(false)
  const fix = ruleFix(finding)
  const { translation, translationKey, translationFile } = finding.evidence
  return (
    <article className="detail" aria-labelledby="detail-title">
      <p className={`detail-severity sev-${finding.severity}`}>
        <span className="dot" aria-hidden="true" /> {SEVERITY_WORDS[finding.severity]}
        <code>{finding.rule}</code>
      </p>
      <h3 id="detail-title">{ruleTitle(finding.rule)}</h3>
      <p className="detail-message">{finding.message}</p>
      {fix ? (
        <section className="fix" aria-label="How to fix">
          <h4>How to fix</h4>
          <p>{fix}</p>
        </section>
      ) : null}
      <dl className="detail-facts">
        <div>
          <dt>Element</dt>
          <dd>
            <code dir="ltr">{finding.selector}</code>
          </dd>
        </div>
        {typeof translation === 'string' ? (
          <>
            {translationKey !== undefined ? (
              <div>
                <dt>Key</dt>
                <dd>
                  <code dir="ltr">{String(translationKey)}</code>
                </dd>
              </div>
            ) : null}
            <div>
              <dt>File</dt>
              <dd>
                {TRANSLATION_STATUS[translation] ?? translation}{' '}
                <code dir="ltr">{String(translationFile)}</code>
              </dd>
            </div>
          </>
        ) : null}
        {finding.sourceHint ? (
          <div>
            <dt>Source</dt>
            <dd>
              <code dir="ltr">{finding.sourceHint}</code>
            </dd>
          </div>
        ) : null}
      </dl>
      <details className="measurements">
        <summary>Measurements</summary>
        <table className="evidence">
          <tbody>
            {Object.entries(finding.evidence)
              .filter(([key]) => !SHOWN_ABOVE.has(key))
              .map(([key, value]) => (
                <tr key={key}>
                  <th scope="row">{evidenceLabel(key)}</th>
                  <td dir="ltr">{String(value)}</td>
                </tr>
              ))}
            {finding.match ? (
              <tr>
                <th scope="row">Matched to English by</th>
                <td>{finding.match === 'testid' ? 'test id' : finding.match}</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </details>
      <div className="detail-actions">
        <a href={finding.docsUrl} target="_blank" rel="noreferrer">
          Rule docs <span className="visually-hidden">(opens in a new tab)</span>
        </a>
        <span className="explain">
          <code dir="ltr">{command}</code>
          <button
            type="button"
            className="button"
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
          <span className="visually-hidden" role="status">
            {copied ? 'Command copied' : ''}
          </span>
        </span>
      </div>
    </article>
  )
}
