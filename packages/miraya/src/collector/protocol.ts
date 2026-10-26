import type { Dir, ElementSnap, PageHead, Snapshot } from '../types'

/** Options passed from Node into the in-page collector. Must be JSON-serialisable. */
export type CollectorOptions = {
  testIdAttribute: string
  /** Regex sources; an id matching any of them isn't used as a path anchor. */
  generatedIdPatterns: string[]
  sourceAttribute?: string
  maxElements: number
  /** An ancestor counts as a container when it's wider than the element by more than this. */
  containerTolerancePx: number
}

/** What the in-page collector returns. Node adds URLs, screenshots and page errors. */
export type PageCollection = {
  /** Walk indexes of the elements to look up fonts for (DESIGN.md › section 3). */
  fontSamples: number[]
  /** Each data-rtl-ignore attribute where it's declared: rule id (or "*") to reason. */
  markers: { selector: string; rules: Record<string, string> }[]
  dir: Dir
  lang: string
  viewport: { w: number; h: number }
  docHeight: number
  docWidth: Snapshot['docWidth']
  elements: ElementSnap[]
  /** Node adds the response status and headers. */
  head: Omit<PageHead, 'http'>
  stats: Snapshot['stats']
}

/** React useId output, common UI-library prefixes, and any run of three or more digits. */
export const DEFAULT_GENERATED_ID_PATTERNS = [
  '^:r[0-9a-z]+:$',
  '^«r[0-9a-z]+»$',
  '^(radix|headlessui|mui)-',
  '[0-9]{3,}',
]
