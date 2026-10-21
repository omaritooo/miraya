// The part of the Unicode Bidirectional Algorithm (UAX #9) that decides how text
// displays inside a right-to-left paragraph with no explicit embeddings or isolates:
// character classes, weak types (W1–W7), neutrals (N1–N2), implicit levels (I1–I2)
// and reordering (L2). Pure, so bidi-isolation can stay pure (ADR-002). Checked
// against Chromium's rendering in test/e2e/bidi.e2e.test.ts.

type BidiClass = 'L' | 'R' | 'AL' | 'EN' | 'AN' | 'ES' | 'ET' | 'CS' | 'NSM' | 'WS' | 'ON'

const ARABIC_INDIC_DIGIT = /[٠-٩]/u
const ARABIC_LETTER = /[\u0600-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-\uFEFF]/u
const HEBREW = /[֐-׿]/u
const MARK = /\p{M}/u
const ET = /[#$%°¢£¤¥€₤₪₹٪‰‱±−]/u

export function bidiClass(ch: string): BidiClass {
  if (/[0-9۰-۹]/u.test(ch)) return 'EN'
  if (ARABIC_INDIC_DIGIT.test(ch) || ch === '٫' || ch === '٬') return 'AN'
  if (MARK.test(ch)) return 'NSM'
  if (ARABIC_LETTER.test(ch)) return 'AL'
  if (HEBREW.test(ch)) return 'R'
  if (ch === '+' || ch === '-') return 'ES'
  if (ET.test(ch)) return 'ET'
  if (ch === ',' || ch === '.' || ch === '/' || ch === ':' || ch === '\u00A0' || ch === '،') return 'CS'
  if (/\s/u.test(ch)) return 'WS'
  if (/\p{L}/u.test(ch)) return 'L'
  return 'ON'
}

const strongOf = (c: BidiClass) => (c === 'L' ? 'L' : 'R')
const isNeutral = (c: BidiClass) => c === 'WS' || c === 'ON'

/** Resolved embedding levels for each character of a line in an RTL paragraph (level 1). */
export function rtlLevels(text: string): number[] {
  const chars = [...text]
  const t: BidiClass[] = chars.map(bidiClass)
  const n = t.length
  // W1: a mark takes the type of the character before it (sos is R).
  for (let i = 0; i < n; i++) if (t[i] === 'NSM') t[i] = i === 0 ? 'R' : (t[i - 1] as BidiClass)
  // W2: European numbers after an Arabic letter are Arabic numbers.
  let last: BidiClass = 'R'
  for (let i = 0; i < n; i++) {
    const c = t[i] as BidiClass
    if (c === 'L' || c === 'R' || c === 'AL') last = c
    else if (c === 'EN' && last === 'AL') t[i] = 'AN'
  }
  // W3: Arabic letters are R from here on.
  for (let i = 0; i < n; i++) if (t[i] === 'AL') t[i] = 'R'
  // W4: one separator between two numbers of the same kind joins them.
  for (let i = 1; i < n - 1; i++) {
    const [a, c, b] = [t[i - 1], t[i], t[i + 1]]
    if (c === 'ES' && a === 'EN' && b === 'EN') t[i] = 'EN'
    else if (c === 'CS' && a === 'EN' && b === 'EN') t[i] = 'EN'
    else if (c === 'CS' && a === 'AN' && b === 'AN') t[i] = 'AN'
  }
  // W5: terminators next to European numbers join them.
  for (let i = 0; i < n; i++) {
    if (t[i] !== 'ET') continue
    let j = i
    while (j < n && t[j] === 'ET') j++
    if (t[i - 1] === 'EN' || t[j] === 'EN') for (let k = i; k < j; k++) t[k] = 'EN'
    i = j - 1
  }
  // W6: remaining separators and terminators are neutral.
  for (let i = 0; i < n; i++) if (t[i] === 'ES' || t[i] === 'ET' || t[i] === 'CS') t[i] = 'ON'
  // W7: European numbers after L are L.
  last = 'R'
  for (let i = 0; i < n; i++) {
    const c = t[i] as BidiClass
    if (c === 'L' || c === 'R') last = c
    else if (c === 'EN' && last === 'L') t[i] = 'L'
  }
  // N1/N2: neutrals between two strong types of the same direction (numbers count as R)
  // take that direction; the rest take the paragraph direction, R. sos and eos are R.
  for (let i = 0; i < n; i++) {
    if (!isNeutral(t[i] as BidiClass)) continue
    let j = i
    while (j < n && isNeutral(t[j] as BidiClass)) j++
    const before = i === 0 ? 'R' : strongOf(t[i - 1] as BidiClass)
    const after = j === n ? 'R' : strongOf(t[j] as BidiClass)
    const resolved: BidiClass = before === after ? before : 'R'
    for (let k = i; k < j; k++) t[k] = resolved
    i = j - 1
  }
  // I2: in an odd (RTL) level, L and numbers go up one level.
  return t.map((c) => (c === 'L' || c === 'EN' || c === 'AN' ? 2 : 1))
}

/** Logical indexes in the order they appear on screen, left to right (L2). */
export function visualOrder(levels: number[]): number[] {
  const order = levels.map((_, i) => i)
  const max = Math.max(0, ...levels)
  for (let level = max; level >= 1; level--) {
    for (let i = 0; i < order.length;) {
      if ((levels[order[i] as number] as number) < level) {
        i++
        continue
      }
      let j = i
      while (j < order.length && (levels[order[j] as number] as number) >= level) j++
      order.splice(i, j - i, ...order.slice(i, j).reverse())
      i = j
    }
  }
  return order
}

/**
 * How the characters [start, end) of a line appear on screen, left to right, when
 * the line sits in an RTL paragraph. Equal to the logical text when it displays in order.
 */
export function displayedAs(text: string, start: number, end: number): string {
  const chars = [...text]
  const order = visualOrder(rtlLevels(text))
  return order
    .filter((i) => i >= start && i < end)
    .map((i) => chars[i])
    .join('')
}
