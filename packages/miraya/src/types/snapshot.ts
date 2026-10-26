import * as z from 'zod'

export const DirSchema = z.enum(['ltr', 'rtl'])
export type Dir = z.infer<typeof DirSchema>

/** Document coordinates, CSS px. */
export const BoxSchema = z.object({ x: z.number(), y: z.number(), w: z.number(), h: z.number() })
export type Box = z.infer<typeof BoxSchema>

/**
 * Computed styles the rules read. Text-only properties are collected only for
 * elements with direct text (DESIGN.md › The walk); the rest always are.
 */
export const ElementStyleSchema = z.object({
  direction: DirSchema,
  transform: z.string(),
  letterSpacing: z.string(),
  overflowX: z.string(),
  overflowY: z.string(),
  unicodeBidi: z.string(),
  display: z.string(),
  position: z.string(),
  justifyContent: z.string(),
  textAlign: z.string().optional(),
  fontFamily: z.string().optional(),
  fontSize: z.number().optional(),
  lineHeight: z.string().optional(),
  textOverflow: z.string().optional(),
  whiteSpace: z.string().optional(),
})

export const ElementTextSchema = z.object({
  /** Direct text, whitespace-collapsed, max 200 chars. Kept only when it has Latin letters or digits. */
  value: z.string().max(200).optional(),
  arabic: z.number().int().nonnegative(),
  latin: z.number().int().nonnegative(),
  digits: z.object({
    arabicIndic: z.number().int().nonnegative(),
    western: z.number().int().nonnegative(),
  }),
  /** Glyph ink height (canvas measureText). Arabic text in overflow-hidden boxes only. */
  inkHeight: z.number().optional(),
})

export const ElementSnapSchema = z.object({
  /** Walk index, e.g. "e412". Unique within one render, meaningless across renders. */
  key: z.string(),
  parentKey: z.string().optional(),
  depth: z.number().int().nonnegative(),
  testId: z.string().optional(),
  /** tag:nth-of-type chain from the nearest stable id or test id anchor. */
  path: z.string(),
  /** Human-readable selector for messages. */
  selector: z.string(),
  tag: z.string(),
  role: z.string().optional(),
  /** Accessible name length; the name itself is not stored. */
  nameLength: z.number().int().nonnegative().optional(),
  box: BoxSchema,
  /** Nearest ancestor wider than the element, or "viewport" for position: fixed. */
  containerKey: z.string().optional(),
  style: ElementStyleSchema,
  scroll: z.object({ sw: z.number(), cw: z.number(), sh: z.number(), ch: z.number() }),
  text: ElementTextSchema.optional(),
  /** From CDP, sampled nodes only. */
  usedFonts: z
    .array(z.object({ family: z.string(), custom: z.boolean(), glyphs: z.number().int() }))
    .optional(),
  icon: z
    .object({
      name: z.string().optional(),
      label: z.string().optional(),
      directional: z.boolean().optional(),
      neverFlip: z.boolean().optional(),
    })
    .optional(),
  input: z
    .object({
      type: z.string(),
      name: z.string().optional(),
      autocomplete: z.string().optional(),
      inputMode: z.string().optional(),
    })
    .optional(),
  /** Rule id (or "*") to reason, inherited from ancestors. */
  ignore: z.record(z.string(), z.string()).optional(),
  /** Nearest ancestor-or-self dir attribute. */
  explicitDir: DirSchema.optional(),
  /** "src/components/Nav.vue:12:3" when a source attribute exists. */
  sourceHint: z.string().optional(),
})
export type ElementSnap = z.infer<typeof ElementSnapSchema>

/** What search engines and link previews read from a page: its <head> tags and its h1s. */
export const PageHeadSchema = z.object({
  title: z.string().optional(),
  description: z.string().optional(),
  /** The robots meta content, lower-cased; the X-Robots-Tag header is in `http`. */
  robots: z.string().optional(),
  /** Every rel=canonical href, resolved against the page URL. */
  canonical: z.array(z.string()),
  /** rel=alternate links with an hreflang, resolved. */
  alternates: z.array(z.object({ hreflang: z.string(), href: z.string() })),
  /** og:* and twitter:* meta tags, by property name. The first of each wins. */
  social: z.record(z.string(), z.string()),
  /** Each JSON-LD block: its @type values, or why it didn't parse. */
  jsonLd: z.array(z.object({ types: z.array(z.string()), error: z.string().optional() })),
  /** Text of each h1, whitespace-collapsed, 120 chars at most. */
  h1: z.array(z.string()),
  /** The main document's response; absent when the page wasn't loaded by a navigation. */
  http: z.object({ status: z.number().int(), robots: z.string().optional() }).optional(),
})
export type PageHead = z.infer<typeof PageHeadSchema>

const ResourceTypeSchema = z.enum(['document', 'script', 'style', 'font', 'image', 'other'])
export type ResourceType = z.infer<typeof ResourceTypeSchema>

/** How fast a page loaded under throttling: the median of the measured runs. Chromium only. */
export const PagePerfSchema = z.object({
  /** Largest contentful paint, and the element that drew it. */
  lcp: z
    .object({
      ms: z.number(),
      selector: z.string().optional(),
      /** The element's box in document CSS px, when it was still on the page. */
      box: BoxSchema.optional(),
      /** The image or video behind it, if any. */
      url: z.string().optional(),
    })
    .optional(),
  fcpMs: z.number().optional(),
  /** Cumulative layout shift: the largest session window, as Core Web Vitals counts it. */
  cls: z.number(),
  /** Total blocking time: long-task time past 50 ms, after the first paint. */
  tbtMs: z.number(),
  requests: z.number().int(),
  /** Bytes over the network, by type. */
  bytes: z.object(
    Object.fromEntries(ResourceTypeSchema.options.map((t) => [t, z.number().int()])) as Record<
      ResourceType,
      z.ZodNumber
    >,
  ),
  renderBlocking: z.array(
    z.object({ url: z.string(), type: ResourceTypeSchema, bytes: z.number().int() }),
  ),
  /** Images drawn smaller than their file, and the bytes that costs. */
  oversizedImages: z.array(
    z.object({
      url: z.string(),
      selector: z.string(),
      natural: z.object({ w: z.number().int(), h: z.number().int() }),
      shown: z.object({ w: z.number().int(), h: z.number().int() }),
      bytes: z.number().int(),
      wastedBytes: z.number().int(),
    }),
  ),
  /** The heaviest requests, largest first. */
  resources: z.array(
    z.object({
      url: z.string(),
      type: ResourceTypeSchema,
      bytes: z.number().int(),
      blocking: z.boolean().optional(),
    }),
  ),
  runs: z.number().int(),
})
export type PagePerf = z.infer<typeof PagePerfSchema>

export const SnapshotSchema = z.object({
  url: z.string(),
  finalUrl: z.string(),
  dir: DirSchema,
  lang: z.string(),
  viewport: z.object({ w: z.number().int(), h: z.number().int() }),
  docHeight: z.number(),
  /** Document scrollWidth and clientWidth, for page-level horizontal overflow. */
  docWidth: z.object({ scroll: z.number(), client: z.number() }),
  elements: z.array(ElementSnapSchema),
  head: PageHeadSchema,
  /** Present when the performance check ran. */
  perf: PagePerfSchema.optional(),
  /** File paths. */
  screenshot: z.object({ png: z.string(), jpeg: z.string(), truncated: z.boolean() }),
  stats: z.object({
    visited: z.number().int(),
    collected: z.number().int(),
    skipped: z.number().int(),
    capped: z.boolean(),
    errors: z.number().int(),
  }),
  pageErrors: z.array(z.string()),
})
export type Snapshot = z.infer<typeof SnapshotSchema>

export const MatchMethodSchema = z.enum(['testid', 'path', 'heuristic'])
export type MatchMethod = z.infer<typeof MatchMethodSchema>

export const SnapshotPairSchema = z.object({
  route: z.string(),
  /** Absent in --rtl-only mode. */
  ltr: SnapshotSchema.optional(),
  rtl: SnapshotSchema,
  matches: z.array(z.object({ ltr: z.string(), rtl: z.string(), method: MatchMethodSchema })),
  unmatched: z.object({ ltr: z.array(z.string()), rtl: z.array(z.string()) }),
})
export type SnapshotPair = z.infer<typeof SnapshotPairSchema>
