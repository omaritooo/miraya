import { parseConfig } from '../src/core/config'
import type { Box, ElementSnap, PageHead, Snapshot } from '../src/types'

/** A translated app by default; pass `locale: { strategy: 'attribute' }` for layout-only runs. */
export const config = (input: Record<string, unknown> = {}) =>
  parseConfig({
    baseUrl: 'http://localhost:4000',
    locale: { strategy: 'path-prefix', ltr: '/en', rtl: '/ar' },
    ...input,
  })

let keyCounter = 0

/** An element with sensible defaults; override what the test is about. */
export function el(partial: Partial<ElementSnap> & { box: Box }): ElementSnap {
  const key = partial.key ?? `k${keyCounter++}`
  return {
    key,
    depth: 1,
    path: partial.path ?? `#${key}`,
    selector: partial.selector ?? `#${key}`,
    tag: 'div',
    style: {
      direction: 'ltr',
      transform: 'none',
      letterSpacing: 'normal',
      overflowX: 'visible',
      overflowY: 'visible',
      unicodeBidi: 'normal',
      display: 'block',
      position: 'static',
      justifyContent: 'normal',
    },
    scroll: { sw: 0, cw: 0, sh: 0, ch: 0 },
    ...partial,
  }
}

export function snapshot(
  dir: 'ltr' | 'rtl',
  elements: ElementSnap[],
  { head, ...extra }: Omit<Partial<Snapshot>, 'head'> & { head?: Partial<PageHead> } = {},
): Snapshot {
  return {
    url: 'http://localhost:4000/',
    finalUrl: 'http://localhost:4000/',
    dir,
    lang: dir === 'rtl' ? 'ar' : 'en',
    viewport: { w: 1000, h: 800 },
    docHeight: 800,
    docWidth: { scroll: 1000, client: 1000 },
    elements,
    head: { canonical: [], alternates: [], social: {}, jsonLd: [], h1: [], ...head },
    screenshot: { png: '', jpeg: '', truncated: false },
    stats: { visited: 0, collected: elements.length, skipped: 0, capped: false, errors: 0 },
    pageErrors: [],
    ...extra,
  }
}

/** Mirrors a box inside a container of the given width, as a correct RTL layout would. */
export const mirror = (b: Box, width = 1000): Box => ({ ...b, x: width - b.x - b.w })
