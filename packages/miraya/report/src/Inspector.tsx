import { useState } from 'react'
import { evidenceLabel, ruleFix, ruleTitle, SEVERITY_WORDS } from './copy'
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
  return (
    <section className="inspector" aria-labelledby="findings-title">
      <h2 id="findings-title" tabIndex={-1}>
        <span id="findings">Findings</span> <span className="muted">{findings.length}</span>
        {hidden > 0 ? <span className="muted"> · {hidden} hidden by filters</span> : null}
      </h2>
      {findings.length === 0 ? (
        <p className="all-clear">
          {route.findings.length === 0
            ? 'Nothing to fix here. The Arabic page matches the English one.'
            : 'No findings match these filters.'}
        </p>
      ) : (
        <ol className="finding-list">
          {findings.map((f, n) => (
            <li key={f.id}>
              <button
                type="button"
                className={`finding sev-${f.severity}`}
                aria-pressed={f === selected}
                onClick={() => onSelect(f.id)}
              >
                <span className="finding-number" aria-hidden="true">
                  {n + 1}
                </span>
                <span className="finding-body">
                  <span className="finding-head">
                    <span className="severity">{SEVERITY_WORDS[f.severity]}</span>
                    {f.status === 'baselined' ? <span className="tag">Already known</span> : null}
                    {f.possiblyMoved ? <span className="tag tag-moved">Possibly moved</span> : null}
                  </span>
                  <span className="finding-title">{ruleTitle(f.rule)}</span>
                  <code className="finding-element" dir="ltr">
                    {f.selector}
                  </code>
                </span>
              </button>
            </li>
          ))}
        </ol>
      )}
      {selected ? <Detail key={selected.id} finding={selected} /> : null}
    </section>
  )
}

function Detail({ finding }: { finding: Finding }) {
  const command = `npx miraya explain ${finding.id.slice(0, 10)}`
  const [copied, setCopied] = useState(false)
  const fix = ruleFix(finding.rule)
  return (
    <article className="detail" aria-labelledby="detail-title">
      <p className={`detail-kicker sev-${finding.severity}`}>
        {SEVERITY_WORDS[finding.severity]} · <code>{finding.rule}</code>
      </p>
      <h3 id="detail-title">{ruleTitle(finding.rule)}</h3>
      <p className="detail-message">{finding.message}</p>
      {fix ? (
        <div className="fix">
          <p className="fix-label">How to fix</p>
          <p>{fix}</p>
        </div>
      ) : null}
      <dl className="detail-facts">
        <div>
          <dt>Element</dt>
          <dd>
            <code dir="ltr">{finding.selector}</code>
          </dd>
        </div>
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
            {Object.entries(finding.evidence).map(([key, value]) => (
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
          Read about this rule <span className="visually-hidden">(opens in a new tab)</span>
        </a>
        <span className="explain">
          <code dir="ltr">{command}</code>
          <button
            type="button"
            className="pressable"
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
