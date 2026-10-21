import { useEffect, useRef, useState, type CSSProperties } from 'react'
import type { Finding, RouteResult } from './data'

type Dir = 'ltr' | 'rtl'

const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches

/** Fit shrinks the page to the pane; the others are fractions of the real page width. */
const ZOOMS = [
  { value: 'fit', label: 'Fit' },
  { value: '0.5', label: '50%' },
  { value: '0.75', label: '75%' },
  { value: '1', label: '100%' },
] as const
type Zoom = (typeof ZOOMS)[number]['value']

/**
 * The two renders side by side, divided by the mirror seam. Findings are numbered
 * outlines positioned in document coordinates, scaled to the displayed image width.
 */
export function Stage({
  route,
  findings,
  selected,
  images,
  viewportWidth,
  onSelect,
}: {
  route: RouteResult
  findings: Finding[]
  selected: Finding | undefined
  images: Record<string, string>
  viewportWidth: number
  onSelect: (id: string) => void
}) {
  const sides: Dir[] = route.screenshots.ltr ? ['ltr', 'rtl'] : ['rtl']
  const [zoom, setZoom] = useState<Zoom>('0.5')
  return (
    <section
      className="stage"
      aria-label="Screenshots"
      style={{ '--panes': sides.length } as CSSProperties}
    >
      <div className="stage-tools">
        <span className="stage-tools-label" id="zoom-label">
          Zoom
        </span>
        <div className="segmented" role="radiogroup" aria-labelledby="zoom-label">
          {ZOOMS.map((z) => (
            <label key={z.value}>
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
      {sides.map((dir, i) => (
        <Pane
          key={`${route.route}-${dir}`}
          dir={dir}
          src={images[route.screenshots[dir] ?? ''] ?? ''}
          frame={route.screenshots.frames?.[dir] ?? { x: 0, w: viewportWidth }}
          findings={findings}
          selected={selected}
          onSelect={onSelect}
          seam={i === 0 && sides.length === 2}
          zoom={zoom}
        />
      ))}
      {route.screenshots.truncated ? (
        <p className="stage-note">
          Screenshots are cut off at the maximum page height; findings below it aren't drawn.
        </p>
      ) : null}
    </section>
  )
}

function Pane({
  dir,
  src,
  findings,
  selected,
  onSelect,
  seam,
  zoom,
  frame,
}: {
  dir: Dir
  src: string
  frame: { x: number; w: number }
  findings: Finding[]
  selected: Finding | undefined
  onSelect: (id: string) => void
  seam: boolean
  zoom: Zoom
}) {
  const scroller = useRef<HTMLDivElement>(null)
  // CSS px per screenshot px is unknown until the image loads; the outlines need the height.
  const [docHeight, setDocHeight] = useState<number>()

  const canvasWidth = zoom === 'fit' ? undefined : frame.w * Number(zoom)

  // Selecting a finding scrolls both panes to it, across and down.
  useEffect(() => {
    const box = selected?.boxes[dir]
    const el = scroller.current
    if (!box || !el || !docHeight) return
    const scale = (canvasWidth ?? el.clientWidth) / frame.w
    el.scrollTo({
      top: Math.max(0, box.y * scale - el.clientHeight / 3),
      left: Math.max(0, (box.x - frame.x + box.w / 2) * scale - el.clientWidth / 2),
      behavior: reducedMotion() ? 'auto' : 'smooth',
    })
  }, [selected, dir, docHeight, frame.x, frame.w, canvasWidth])

  return (
    <figure className={`pane pane-${dir}${seam ? ' has-seam' : ''}`}>
      <figcaption>
        <span className="pane-dir">{dir.toUpperCase()}</span>
        <span className="pane-label">{dir === 'ltr' ? 'Left to right' : 'Right to left'}</span>
      </figcaption>
      {/* Focusable so keyboard users can pan a zoomed screenshot with the arrow keys. */}
      <div
        className="pane-scroll"
        ref={scroller}
        tabIndex={0}
        role="region"
        aria-label={`${dir === 'ltr' ? 'Left-to-right' : 'Right-to-left'} screenshot`}
      >
        {/* The canvas holds a physical screenshot, so it never mirrors with the report. */}
        <div
          className="canvas"
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
                    // Screenshots are physical images, so outlines use physical coordinates,
                    // whatever the direction of the report itself.
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
