import { GLYPHS } from './copy'
import { SEVERITIES, type Severity } from './data'

export function SeverityCounts({ findings }: { findings: { severity: Severity }[] }) {
  const counts = SEVERITIES.map((sev) => [sev, findings.filter((f) => f.severity === sev).length])
  const shown = counts.filter(([, n]) => n)
  if (!shown.length) {
    return (
      <span className="counts counts-pos">
        <span aria-hidden="true">✓</span>
        <span className="sr"> no new findings</span>
      </span>
    )
  }
  return (
    <span className="counts">
      {shown.map(([sev, n]) => (
        <span key={sev} className={`sev-${sev}`}>
          <span aria-hidden="true">{GLYPHS[sev as Severity]}</span> {n}
          <span className="sr">
            {' '}
            {sev === 'warn' ? 'warnings' : sev === 'info' ? 'info' : 'errors'}
          </span>
        </span>
      ))}
    </span>
  )
}

export function Segmented<T extends string>({
  label,
  options,
  value,
  text,
  title,
  onChange,
}: {
  label: string
  options: readonly T[]
  value: T
  text: (v: T) => string
  title?: (v: T) => string
  onChange: (v: T) => void
}) {
  return (
    <div className="segmented" role="group" aria-label={label}>
      {options.map((option) => (
        <button
          type="button"
          key={option}
          aria-pressed={option === value}
          title={title?.(option)}
          onClick={() => onChange(option)}
        >
          {text(option)}
        </button>
      ))}
    </div>
  )
}
