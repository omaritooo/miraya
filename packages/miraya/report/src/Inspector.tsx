import { useState } from 'react'
import type { Finding, RouteResult } from './data'

const SHAPE: Record<Finding['severity'], string> = { error: '■', warn: '▲', info: '●' }

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
        {hidden > 0 ? <span className="muted"> · {hidden} filtered out</span> : null}
      </h2>
      {findings.length === 0 ? (
        <p className="all-clear">
          {route.findings.length === 0
            ? 'No RTL problems on this route.'
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
                    <span className="severity">
                      <span aria-hidden="true">{SHAPE[f.severity]}</span> {f.severity}
                    </span>
                    <code className="rule">{f.rule}</code>
                    {f.status === 'baselined' ? <span className="tag">baselined</span> : null}
                    {f.possiblyMoved ? <span className="tag tag-moved">possibly moved</span> : null}
                    {!f.boxes.ltr && !f.boxes.rtl ? <span className="tag">page</span> : null}
                  </span>
                  <span className="message">{f.message}</span>
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

function Detail({ finding }: { finding: Finding }) {
  const command = `npx miraya explain ${finding.id}`
  const [copied, setCopied] = useState(false)
  return (
    <article className="detail" aria-labelledby="detail-title">
      <h3 id="detail-title">
        <code>{finding.rule}</code>
      </h3>
      <p className="detail-message">{finding.message}</p>
      <dl className="detail-facts">
        <div>
          <dt>Element</dt>
          <dd>
            <code dir="ltr">{finding.selector}</code>
          </dd>
        </div>
        {finding.match ? (
          <div>
            <dt>Paired by</dt>
            <dd>{finding.match}</dd>
          </div>
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
      <table className="evidence">
        <caption>Evidence</caption>
        <tbody>
          {Object.entries(finding.evidence).map(([key, value]) => (
            <tr key={key}>
              <th scope="row">{key}</th>
              <td dir="ltr">{String(value)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="detail-actions">
        <a href={finding.docsUrl} target="_blank" rel="noreferrer">
          How to fix this <span className="visually-hidden">(opens in a new tab)</span>
        </a>
        <span className="explain">
          <code dir="ltr">{command}</code>
          <button
            type="button"
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
