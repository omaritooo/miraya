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
  error: 'Must fix',
  warn: 'Should fix',
  info: 'Note',
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
}
export const evidenceLabel = (key: string) => EVIDENCE[key] ?? key

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

/** A one-line verdict for a route, in words people use. */
export function routeVerdict(findings: Finding[], failed: boolean): string {
  if (failed) return "This page couldn't be checked."
  const mustFix = findings.filter((f) => f.severity === 'error' && f.status !== 'baselined').length
  const shouldFix = findings.filter((f) => f.severity === 'warn' && f.status !== 'baselined').length
  if (findings.length === 0) return 'No right-to-left problems on this page.'
  if (mustFix + shouldFix === 0) return 'Nothing new to fix on this page.'
  const parts = [
    mustFix ? plural(mustFix, 'problem to fix', 'problems to fix') : '',
    shouldFix ? plural(shouldFix, 'thing worth fixing', 'things worth fixing') : '',
  ]
  return `${parts.filter(Boolean).join(' and ')}.`
}
