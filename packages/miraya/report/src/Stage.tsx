import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { Segmented } from './ui'
import { plural, routeSummary } from './copy'
import type { Finding, RouteResult } from './data'

type Dir = 'ltr' | 'rtl'
type Frame = { x: number; w: number }

const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches

/** Fit shrinks the page to the pane; the others are fractions of the real page width. Keys 1 to 4. */
const ZOOMS = ['fit', '0.5', '0.75', '1'] as const
const ZOOM_TEXT: Record<Zoom, string> = { fit: 'Fit', '0.5': '50', '0.75': '75', '1': '100' }

const typing = (target: EventTarget | null) =>
  target instanceof HTMLElement && /^(INPUT|SELECT|TEXTAREA)$/.test(target.tagName)

/** What a failed page's error means, and what to do about it. */
const FAILURES: Record<string, { title: string; command?: string }> = {
  redirected: { title: 'Redirected', command: 'npx miraya login' },
  timeout: { title: 'Timed out' },
  'rule-crashed': { title: 'A rule crashed' },
  'cdp-unavailable': { title: 'Chromium tools unavailable' },
  failed: { title: "Couldn't load" },
}

/** The page's heading and the two renders side by side, with numbered outlines in document coordinates. */
export type Zoom = (typeof ZOOMS)[number]

export function Stage({
  route,
  findings,
  selected,
  images,
  viewportWidth,
  onSelect,
  onNotes,
  instant,
}: {
  route: RouteResult
  findings: Finding[]
  selected: Finding | undefined
  images: Record<string, string>
  viewportWidth: number
  onSelect: (id: string) => void
  onNotes: () => void
  /** Scroll without easing, as when moving by keyboard. */
  instant: boolean
}) {
  const sides: Dir[] = route.screenshots.ltr ? ['ltr', 'rtl'] : ['rtl']
  const [zoom, setZoom] = useState<Zoom>('fit')
  const [focus, setFocus] = useState(false)
  const failed = route.status === 'error'

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (typing(e.target) || e.metaKey || e.ctrlKey || e.altKey) return
      const preset = ZOOMS[Number(e.key) - 1]
      if (preset) setZoom(preset)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const p = route.pairing
  const paired = p.testid + p.path + p.heuristic
  const total = paired + Math.max(p.unmatched.ltr, p.unmatched.rtl)
  const method =
    p.testid >= p.path && p.testid >= p.heuristic
      ? 'test id'
      : p.path >= p.heuristic
        ? 'DOM path'
        : 'position'
  const notes = route.notes.length + route.skippedRules.length

  return (
    <main className="stage" aria-label="Stage">
      <div className="toolbar" role="toolbar" aria-label="View">
        <Segmented
          label="Zoom"
          options={ZOOMS}
          value={zoom}
          text={(z) => ZOOM_TEXT[z]}
          title={(z) => `${z === 'fit' ? 'Fit' : `${ZOOM_TEXT[z]}%`} (${ZOOMS.indexOf(z) + 1})`}
          onChange={setZoom}
        />
        <span className="spacer" />
        <button
          type="button"
          className="button"
          aria-pressed={focus}
          disabled={!selected}
          onClick={() => setFocus(!focus)}
        >
          Focus finding
        </button>
      </div>

      <div className="stage-head">
        <h1>
          <bdi dir="ltr">{route.route}</bdi>
        </h1>
        <span className="muted">
          {failed ? 'Not audited' : routeSummary(route.findings, route.durationMs)}
        </span>
        {!failed && total > 0 ? (
          <span className="muted">
            Paired by {method}: {paired.toLocaleString('en')} of {total.toLocaleString('en')}{' '}
            elements
          </span>
        ) : null}
        {notes ? (
          <button type="button" className="link" onClick={onNotes}>
            {plural(notes, 'note')}
          </button>
        ) : null}
      </div>

      {!failed && selected?.rule === 'document-direction' ? (
        <WholePage finding={selected} route={route} />
      ) : null}

      <div className="screens" style={{ '--panes': sides.length } as CSSProperties}>
        {failed ? (
          <Failed route={route} />
        ) : (
          sides.map((dir) => (
            <Pane
              key={`${route.route}-${dir}`}
              dir={dir}
              route={route.route}
              src={images[route.screenshots[dir] ?? ''] ?? ''}
              frame={route.screenshots.frames?.[dir] ?? { x: 0, w: viewportWidth }}
              findings={findings}
              selected={selected}
              onSelect={onSelect}
              zoom={zoom}
              focus={focus}
              instant={instant}
            />
          ))
        )}
        {!failed && route.screenshots.truncated ? (
          <p className="screens-note">
            Screenshots stop at the maximum page height; findings below it aren't drawn.
          </p>
        ) : null}
      </div>
    </main>
  )
}

const pathOf = (url: string) => {
  try {
    const u = new URL(url)
    return `${u.pathname}${u.search}`
  } catch {
    return url
  }
}

function Failed({ route }: { route: RouteResult }) {
  return (
    <div className="state" role="alert">
      <h2 className="sr">Page couldn't be audited</h2>
      {route.errors.map((e, i) => {
        const failure = FAILURES[e.kind] ?? { title: e.kind }
        const landed = e.finalUrl ? pathOf(e.finalUrl) : undefined
        return (
          <div key={i} className="failure">
            <p className="failure-title">
              <span aria-hidden="true">⊠</span> {failure.title}
              {landed ? (
                <>
                  {' '}
                  to{' '}
                  <bdi dir="ltr">
                    <code>{landed.split('?')[0]}</code>
                  </bdi>
                </>
              ) : null}
            </p>
            <p>
              {landed ? (
                <>
                  Miraya asked for{' '}
                  <bdi dir="ltr">
                    <code>{route.route}</code>
                  </bdi>{' '}
                  and ended on{' '}
                  <bdi dir="ltr">
                    <code>{landed}</code>
                  </bdi>
                  . Save a session once, then rerun.
                </>
              ) : (
                e.message
              )}
            </p>
            {failure.command ? (
              <code className="command" dir="ltr">
                <span className="muted">$ </span>
                {failure.command}
              </code>
            ) : null}
          </div>
        )
      })}
      <p className="muted">
        Other pages report normally. The run exits with 2 and the header says how many pages
        couldn't be audited.
      </p>
    </div>
  )
}

/** A finding about the whole document: the fix is one tag, so show the tag, not a screenshot. */
function WholePage({ finding, route }: { finding: Finding; route: RouteResult }) {
  const lang = String(finding.evidence.lang || 'ar')
  const skipped = route.skippedRules.length
  return (
    <section className="whole-page" aria-label="About the whole page">
      <p className="detail-tags">
        <span className={`sev-word sev-${finding.severity}`}>
          <span aria-hidden="true">◆</span> {finding.rule}
        </span>
        <span className="tag">Whole page</span>
      </p>
      <p>{finding.message}</p>
      <pre dir="ltr">
        {'<html lang="'}
        {lang}
        {'" '}
        <ins>dir="rtl"</ins>
        {'>'}
      </pre>
      {skipped ? (
        <p className="note">
          {plural(skipped, 'other rule')} {skipped === 1 ? 'was' : 'were'} skipped on this page
          until this is fixed. SEO and Performance still ran.
        </p>
      ) : null}
    </section>
  )
}

export function Pane({
  dir,
  label,
  route,
  src,
  frame,
  findings,
  selected,
  onSelect,
  zoom,
  focus,
  instant,
}: {
  dir: Dir
  /** Names the pane instead of its language, as the engine does in the cross-browser view. */
  label?: string
  route: string
  src: string
  frame: Frame
  findings: Finding[]
  selected: Finding | undefined
  onSelect: (id: string) => void
  zoom: Zoom
  focus: boolean
  instant: boolean
}) {
  const scroller = useRef<HTMLDivElement>(null)
  // CSS px per screenshot px is unknown until the image loads; the outlines need the height.
  const [docHeight, setDocHeight] = useState<number>()
  const canvasWidth = zoom === 'fit' ? undefined : frame.w * Number(zoom)
  const name = label ?? (dir === 'ltr' ? 'English' : 'Arabic')
  const drawn = findings.filter((f) => f.boxes[dir])

  // Selecting a finding brings it into view in both panes.
  useEffect(() => {
    const box = selected?.boxes[dir]
    const el = scroller.current
    if (!box || !el || !docHeight) return
    const scale = (canvasWidth ?? el.clientWidth) / frame.w
    el.scrollTo({
      top: Math.max(0, box.y * scale - el.clientHeight / 3),
      left: Math.max(0, (box.x - frame.x + box.w / 2) * scale - el.clientWidth / 2),
      behavior: instant || reducedMotion() ? 'auto' : 'smooth',
    })
  }, [selected, dir, docHeight, frame.x, frame.w, canvasWidth, instant])

  const focused = focus && selected?.boxes[dir] ? selected.boxes[dir] : undefined

  return (
    <figure className="pane">
      <figcaption>
        <span className="pane-name">
          {name} · {dir.toUpperCase()}
        </span>
        <span>{plural(drawn.length, 'outline')}</span>
      </figcaption>
      {/* Focusable so keyboard users can pan a zoomed screenshot with the arrow keys. */}
      <div
        className="pane-scroll"
        ref={scroller}
        tabIndex={0}
        role="region"
        aria-label={`${name} screenshot of ${route}`}
      >
        {/* A screenshot is a physical image, so its canvas never mirrors with the report. */}
        <div
          className="canvas"
          dir="ltr"
          style={canvasWidth ? { inlineSize: `${canvasWidth}px` } : undefined}
        >
          {src ? (
            <img
              src={src}
              alt={`${route} rendered ${dir === 'ltr' ? 'left to right' : 'right to left'}`}
              onLoad={(e) => {
                const img = e.currentTarget
                setDocHeight((img.naturalHeight * frame.w) / img.naturalWidth)
              }}
            />
          ) : (
            <p className="missing">Screenshot not available.</p>
          )}
          {docHeight && focused ? (
            <span
              className="scrim"
              aria-hidden="true"
              style={{
                left: `${((focused.x - frame.x) / frame.w) * 100}%`,
                top: `${(focused.y / docHeight) * 100}%`,
                width: `${(focused.w / frame.w) * 100}%`,
                height: `${(focused.h / docHeight) * 100}%`,
              }}
            />
          ) : null}
          {docHeight
            ? findings.map((f, n) => {
                const box = f.boxes[dir]
                if (!box) return null
                const isSelected = f === selected
                return (
                  <button
                    type="button"
                    key={f.id}
                    className={`callout sev-${f.severity}${isSelected ? ' is-selected' : ''}`}
                    style={{
                      left: `${((box.x - frame.x) / frame.w) * 100}%`,
                      top: `${(box.y / docHeight) * 100}%`,
                      width: `${(box.w / frame.w) * 100}%`,
                      height: `${(box.h / docHeight) * 100}%`,
                    }}
                    aria-pressed={isSelected}
                    aria-label={`Finding ${n + 1}: ${f.rule} on ${f.selector} (${dir.toUpperCase()})`}
                    onClick={() => onSelect(f.id)}
                  >
                    <span className="callout-number" aria-hidden="true">
                      {n + 1}
                    </span>
                  </button>
                )
              })
            : null}
        </div>
      </div>
    </figure>
  )
}
