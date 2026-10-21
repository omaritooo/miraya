import { useEffect, useRef, useState, type CSSProperties } from 'react'
import type { Finding, RouteResult } from './data'

type Dir = 'ltr' | 'rtl'
type Frame = { x: number; w: number }

const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches

/** Fit shrinks the page to the pane; the others are fractions of the real page width. Keys 1 to 4. */
const ZOOMS = [
  { value: 'fit', label: 'Fit', key: '1' },
  { value: '0.5', label: '50%', key: '2' },
  { value: '0.75', label: '75%', key: '3' },
  { value: '1', label: '100%', key: '4' },
] as const
type Zoom = (typeof ZOOMS)[number]['value']

const typing = (target: EventTarget | null) =>
  target instanceof HTMLElement && /^(INPUT|SELECT|TEXTAREA)$/.test(target.tagName)

/** The two renders side by side. Findings are numbered outlines in document coordinates, scaled to the image. */
export function Stage({
  route,
  findings,
  selected,
  images,
  viewportWidth,
  onSelect,
  instant,
}: {
  route: RouteResult
  findings: Finding[]
  selected: Finding | undefined
  images: Record<string, string>
  viewportWidth: number
  onSelect: (id: string) => void
  /** Scroll without easing, as when moving by keyboard. */
  instant: boolean
}) {
  const sides: Dir[] = route.screenshots.ltr ? ['ltr', 'rtl'] : ['rtl']
  const [zoom, setZoom] = useState<Zoom>('0.5')

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (typing(e.target) || e.metaKey || e.ctrlKey || e.altKey) return
      const preset = ZOOMS.find((z) => z.key === e.key)
      if (preset) setZoom(preset.value)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <section
      className="stage"
      aria-label="Screenshots"
      style={{ '--panes': sides.length } as CSSProperties}
    >
      <div className="stage-tools">
        <div className="segmented" role="radiogroup" aria-label="Zoom">
          {ZOOMS.map((z) => (
            <label key={z.value} title={`Zoom ${z.label} (${z.key})`}>
              <input
                type="radio"
                name="zoom"
                value={z.value}
                checked={zoom === z.value}
                onChange={() => setZoom(z.value)}
              />
              {z.label}
            </label>
          ))}
        </div>
      </div>
      {sides.map((dir) => (
        <Pane
          key={`${route.route}-${dir}`}
          dir={dir}
          src={images[route.screenshots[dir] ?? ''] ?? ''}
          frame={route.screenshots.frames?.[dir] ?? { x: 0, w: viewportWidth }}
          findings={findings}
          selected={selected}
          onSelect={onSelect}
          zoom={zoom}
          instant={instant}
        />
      ))}
      {route.screenshots.truncated ? (
        <p className="stage-note">
          Screenshots stop at the maximum page height; findings below it aren't drawn.
        </p>
      ) : null}
    </section>
  )
}

function Pane({
  dir,
  src,
  frame,
  findings,
  selected,
  onSelect,
  zoom,
  instant,
}: {
  dir: Dir
  src: string
  frame: Frame
  findings: Finding[]
  selected: Finding | undefined
  onSelect: (id: string) => void
  zoom: Zoom
  instant: boolean
}) {
  const scroller = useRef<HTMLDivElement>(null)
  // CSS px per screenshot px is unknown until the image loads; the outlines need the height.
  const [docHeight, setDocHeight] = useState<number>()
  const canvasWidth = zoom === 'fit' ? undefined : frame.w * Number(zoom)

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

  return (
    <figure className={`pane pane-${dir}`}>
      <figcaption>
        {dir === 'ltr' ? 'English' : 'Arabic'} <span className="muted">{dir.toUpperCase()}</span>
      </figcaption>
      {/* Focusable so keyboard users can pan a zoomed screenshot with the arrow keys. */}
      <div
        className="pane-scroll"
        ref={scroller}
        tabIndex={0}
        role="region"
        aria-label={`${dir === 'ltr' ? 'English' : 'Arabic'} screenshot`}
      >
        {/* A screenshot is a physical image, so its canvas never mirrors with the report. */}
        <div
          className={`canvas${selected ? ' has-selection' : ''}`}
          dir="ltr"
          style={canvasWidth ? { inlineSize: `${canvasWidth}px` } : undefined}
        >
          {src ? (
            <img
              src={src}
              alt={`The page rendered ${dir === 'ltr' ? 'left to right' : 'right to left'}`}
              onLoad={(e) => {
                const img = e.currentTarget
                setDocHeight((img.naturalHeight * frame.w) / img.naturalWidth)
              }}
            />
          ) : (
            <p className="missing">Screenshot not available.</p>
          )}
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
