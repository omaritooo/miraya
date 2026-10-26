import { useState } from 'react'
import { plural } from './copy'
import { inView, isKnown, type Report, type View } from './data'

/** Whether an area ran, and how far to trust it. */
export type AreaState = 'on' | 'off' | 'dev'

export function areaState(report: Report, area: View): AreaState {
  if (area === 'cross-browser') return (report.engines?.length ?? 1) > 1 ? 'on' : 'off'
  const checks = report.config.checks
  if (checks && area !== 'localization' && !checks.includes(area)) return 'off'
  if (area === 'performance' && !checks && !report.performance) return 'off'
  if (
    area === 'performance' &&
    report.routes.some((r) => r.perf?.rtl?.devServer || r.perf?.ltr?.devServer)
  )
    return 'dev'
  return 'on'
}

const AREA_WORDS: Record<View, string> = {
  localization: 'Localization',
  seo: 'SEO',
  performance: 'Performance',
  'cross-browser': 'Cross-browser',
}

/** What switching an area on looks like in miraya.config. */
const SWITCH_ON: Record<View, { why: string; config: string }> = {
  localization: { why: '', config: '' },
  seo: {
    why: 'Checks titles, descriptions, canonical and language links on both languages.',
    config: "checks: ['localization', 'seo']",
  },
  performance: {
    why: 'Loads each page on a throttled phone profile and checks paint, layout shift, blocking time and weight against budgets. Needs a production build.',
    config: "checks: ['localization', 'seo', 'performance']",
  },
  'cross-browser': {
    why: 'Add engines to run every area on each one. Each engine is about 100 MB to download and multiplies the run time.',
    config: "browsers: ['chromium', 'webkit', 'firefox']",
  },
}

export function CommandBlock({ text, prompt = false }: { text: string; prompt?: boolean }) {
  const [copied, setCopied] = useState(false)
  return (
    <div className="command-row" dir="ltr">
      <code>
        {prompt ? <span className="muted">$ </span> : null}
        {text}
      </code>
      <button
        type="button"
        className="button button-sm"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(text)
            setCopied(true)
            setTimeout(() => setCopied(false), 1500)
          } catch {
            // Blocked for some file:// pages; the text stays selectable.
          }
        }}
      >
        {copied ? 'Copied' : 'Copy'}
      </button>
      <span className="sr" role="status">
        {copied ? 'Copied' : ''}
      </span>
    </div>
  )
}

/** An area the config left out: what it would check, and the line that turns it on. */
export function SwitchedOff({ area }: { area: View }) {
  const on = SWITCH_ON[area]
  return (
    <main className="stage state-page" id="inspector" tabIndex={-1} aria-label="Stage">
      <section className="state-card" aria-labelledby="off-title">
        <span className="state-mark" aria-hidden="true">
          ○
        </span>
        <h1 id="off-title">{AREA_WORDS[area]} was switched off in the config</h1>
        <p>{on.why}</p>
        <CommandBlock text={on.config} />
      </section>
    </main>
  )
}

/** Every page passed this area: say so instead of opening an empty page. */
export function AreaPassed({
  report,
  area,
  onKnown,
  onBrowse,
}: {
  report: Report
  area: View
  onKnown: () => void
  onBrowse: () => void
}) {
  const all = report.routes.flatMap((r) => r.findings.filter((f) => inView(f, area)))
  const known = all.filter(isKnown).length
  const pages = report.routes.filter((r) => r.status === 'ok').length
  const both = report.config.mode === 'pair' ? 'English and Arabic' : 'Arabic'
  return (
    <main className="stage state-page" id="inspector" tabIndex={-1} aria-label="Stage">
      <section className="state-card" aria-labelledby="passed-title">
        <span className="state-mark pos" aria-hidden="true">
          ✓
        </span>
        <h1 id="passed-title">
          {AREA_WORDS[area]} checks passed on {plural(pages, 'page')}
        </h1>
        <p>
          Checked on {both}.
          {known
            ? ` ${plural(known, 'known finding')} ${known === 1 ? 'is' : 'are'} still accepted in the baseline.`
            : ''}
        </p>
        <p className="state-actions">
          {known ? (
            <button type="button" className="button" onClick={onKnown}>
              Show known findings
            </button>
          ) : null}
          <button type="button" className="button" onClick={onBrowse}>
            Browse pages
          </button>
        </p>
      </section>
    </main>
  )
}

/** The first run has nothing to compare with, so everything reads as new. */
export function FirstRun({ report }: { report: Report }) {
  const count = report.routes.flatMap((r) => r.findings).length
  if (!count) return null
  return (
    <section className="banner banner-info" aria-label="Baseline">
      <p>
        <strong>No baseline yet, so all {plural(count, 'finding')} show as new.</strong> Fix what
        you can, then accept the rest. Later runs fail only on findings that weren't there.
      </p>
      <CommandBlock text="npx miraya baseline update" prompt />
    </section>
  )
}
