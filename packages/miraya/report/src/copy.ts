import type { Finding, Severity } from './data'

/** What each rule means to a person: the problem in plain words, and what to do about it. */
const RULES: Record<string, { title: string; fix: string }> = {
  'document-direction': {
    title: "The page doesn't declare itself right-to-left",
    fix: 'Set both on the root element of the Arabic page: <html lang="ar" dir="rtl">.',
  },
  'not-mirrored': {
    title: 'Stays on the same side in Arabic',
    fix: 'Use logical CSS: inset-inline-start instead of left, margin-inline-start instead of margin-left.',
  },
  'icon-direction': {
    title: 'An icon points the wrong way',
    fix: "Flip directional icons in RTL ([dir='rtl'] .icon { transform: scaleX(-1) }), and remove flips from icons that must keep their orientation.",
  },
  'fallback-font': {
    title: 'Arabic is drawn in a fallback font',
    fix: 'Load a font with Arabic glyphs and add it to the font stack. Buttons and inputs need font: inherit.',
  },
  'arabic-letter-spacing': {
    title: 'Letter-spacing breaks Arabic letters apart',
    fix: 'Set letter-spacing: 0 for Arabic text; Arabic letters join, and spacing pulls them apart.',
  },
  'clipped-text': {
    title: 'Arabic text is cut off',
    fix: 'Give Arabic text room: a larger line-height, no fixed heights on text, and widths that grow with the label.',
  },
  'untranslated-text': {
    title: 'English left in the Arabic page',
    fix: 'Translate the string. Brand and product names that stay in English go in allow.latinText.',
  },
  'ltr-inputs': {
    title: 'This field is typed right-to-left',
    fix: 'Add dir="ltr" to inputs for emails, URLs, phone numbers and codes. The label stays Arabic.',
  },
  'mixed-digits': {
    title: 'The page mixes two kinds of digits',
    fix: 'Format every number with one locale, for example Intl.NumberFormat("ar-EG") everywhere.',
  },
  'page-title': {
    title: 'The title is missing, too long or untranslated',
    fix: 'Give every page its own <title> in its own language, under 60 characters, with the most specific words first.',
  },
  'meta-description': {
    title: 'The description is missing, too long or untranslated',
    fix: 'Write a meta description of 50 to 160 characters for each page, translated for each language.',
  },
  'robots-noindex': {
    title: 'Search engines are told not to index this page',
    fix: 'Remove noindex from <meta name="robots"> and the X-Robots-Tag header on pages meant to be found. Keep it on dev and preview servers.',
  },
  canonical: {
    title: 'The canonical link is missing or points elsewhere',
    fix: "Build the canonical from the current page's own URL, locale included: each language points at itself and lists the other in hreflang.",
  },
  hreflang: {
    title: "The language links don't connect the two pages",
    fix: 'On every page, link each language version, itself included, with <link rel="alternate" hreflang>, plus one hreflang="x-default".',
  },
  'single-h1': {
    title: 'The page has no h1, or several',
    fix: 'Give each page one <h1> that names its main topic; use h2 and below for sections.',
  },
  'social-preview': {
    title: 'Shared links have no preview',
    fix: 'Add og:title, og:description and og:image (an absolute URL, 1200×630) to each page, in its own language.',
  },
  'structured-data': {
    title: "Search engines can't read the structured data",
    fix: 'Make each <script type="application/ld+json"> valid JSON with an @type, and check it with a structured data validator.',
  },
  'bidi-isolation': {
    title: 'Displays scrambled inside Arabic text',
    fix: 'Wrap it in <bdi> or an element with dir="ltr".',
  },
}

export const ruleTitle = (rule: string) => RULES[rule]?.title ?? rule

/** untranslated-text with config.locales: the fix depends on where the string stands. */
const TRANSLATION_FIX: Record<string, string> = {
  missing: 'Add the key to the Arabic file with its translation.',
  copied: 'Replace the English value in the Arabic file with the translation.',
  fallback:
    'The Arabic file already translates this. Use the key in the component instead of the English text, and check that the Arabic file loads on this page.',
  'not-found':
    "The text isn't in the English file, so it's probably written into a component. Move it into the translation files and translate it.",
}

export function ruleFix(finding: Finding): string | undefined {
  const status = finding.evidence.translation
  if (typeof status === 'string' && TRANSLATION_FIX[status]) return TRANSLATION_FIX[status]
  return RULES[finding.rule]?.fix
}

export const TRANSLATION_STATUS: Record<string, string> = {
  missing: 'Missing from',
  copied: 'Still English in',
  fallback: 'Translated in',
  'not-found': 'Not in',
}

export const SEVERITY_WORDS: Record<Severity, string> = {
  error: 'Error',
  warn: 'Warning',
  info: 'Info',
}

/** Severity is never colour alone: each has a shape, as in the design system. */
export const GLYPHS: Record<Severity, string> = { error: '◆', warn: '▲', info: '●' }

/** Which language an SEO finding is about. */
export const SIDE_WORDS: Record<string, string> = {
  ltr: 'English only',
  rtl: 'Arabic only',
  both: 'both',
}

/** Evidence keys in plain words. Keys without an entry keep their own name. */
const EVIDENCE: Record<string, string> = {
  check: 'What failed',
  startL: 'Gap before it, in English',
  endR: 'The same gap, in Arabic',
  endL: 'Gap after it, in English',
  startR: 'The same gap, in Arabic (other side)',
  delta: 'Difference',
  tol: 'Allowed difference',
  anchorSelector: 'Measured from',
  containerSelector: 'Inside',
  iconName: 'Icon',
  verdict: 'Verdict',
  diffFlipped: 'Unlike its mirror image',
  diffSame: 'Unlike the English icon',
  fontStack: 'Fonts the CSS asks for',
  usedFamily: 'Font that drew it',
  custom: 'A web font',
  glyphs: 'Characters drawn',
  count: 'Times on this page',
  letterSpacing: 'Letter-spacing',
  arabicRatio: 'Share of Arabic letters',
  axis: 'Direction',
  scroll: 'Content size (px)',
  client: 'Box size (px)',
  inkHeight: 'Height of the letters (px)',
  ltrClipped: 'Also cut off in English',
  text: 'Text',
  textHash: 'Fingerprint',
  reason: 'Why it holds LTR content',
  type: 'Input type',
  direction: 'Typing direction',
  prefer: 'Preferred digits',
  arabicIndic: 'Arabic-Indic digits',
  western: 'Western digits',
  kind: 'Kind',
  match: 'As written',
  displayed: 'As displayed',
  attr: 'Attribute',
  dir: 'dir',
  lang: 'lang',
  bodyDirection: 'Direction of the page body',
  copies: 'Copies of this element',
  translation: 'Translation',
  translationKey: 'Key',
  translationFile: 'File',
  side: 'Language',
  length: 'Characters',
  max: 'Most allowed',
  min: 'Fewest allowed',
  target: 'Points at',
  expected: 'Expected',
  found: 'Found',
  source: 'Set in',
  value: 'Value',
  local: 'Development server',
  missing: 'Missing',
  block: 'Block',
  error: 'Parse error',
  hreflang: 'hreflang',
}
export const evidenceLabel = (key: string) => EVIDENCE[key] ?? key

export const plural = (n: number, one: string, many = `${one}s`) =>
  `${n.toLocaleString('en')} ${n === 1 ? one : many}`

/** The page's line under its path: "4 findings, 2 new · 1.8 s". */
export function routeSummary(findings: Finding[], durationMs: number): string {
  const fresh = findings.filter((f) => f.status !== 'baselined').length
  const count = findings.length
    ? `${plural(findings.length, 'finding')}${fresh < findings.length ? `, ${fresh} new` : ''}`
    : 'No findings'
  return `${count} · ${(durationMs / 1000).toFixed(1)} s`
}

/** What to call an element in a list row: its own text when it has some, else its selector's tail. */
export function elementLabel(finding: Finding): string {
  const side = finding.evidence.side
  if (typeof side === 'string' && SIDE_WORDS[side]) return SIDE_WORDS[side]
  const text = finding.evidence.text
  if (typeof text === 'string' && text.trim()) return text.trim()
  return finding.selector.split(/\s*>\s*/).at(-1) ?? finding.selector
}
