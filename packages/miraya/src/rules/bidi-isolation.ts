import { z } from 'zod'
import type { ElementSnap, Finding } from '../types'
import { displayedAs } from './bidi'
import { ancestors, defineRule, isIgnored, shortHash } from './util'

const ID = 'bidi-isolation'

/**
 * Left-to-right content that the bidi algorithm can scramble inside RTL text.
 * Percentages aren't here: "25%" showing the sign on the left is correct Arabic typography.
 */
const FAMILIES = {
  phone: /\+?\d[\d\s-]{6,}\d/gu,
  price: /(?:(?:EGP|SAR|AED|USD|US\$|\$|€|£)\s?\d[\d.,]*|\d[\d.,]*\s?(?:EGP|SAR|AED|USD|\$|€|£))/gu,
  email: /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/gu,
  url: /(?:https?:\/\/|www\.)\S+|\b[\w-]+(?:\.[\w-]+)*\.[a-z]{2,}(?:\/\S*)?/gu,
  // Only inside Arabic text: an element that is all Latin is untranslated-text's case.
  'latin-phrase': /\p{Script=Latin}+(?:[\s'’-]+\p{Script=Latin}+)+/gu,
} as const
type Kind = keyof typeof FAMILIES

const NUMBER = /\d[\d.,]*/u

/**
 * Whether the display is wrong for this kind of content. Phone numbers, emails, URLs and
 * Latin phrases are left-to-right identifiers, so any change is wrong. For prices only
 * the number matters: where a Latin currency code sits varies by convention.
 */
function scrambled(kind: Kind, match: string, shown: string): boolean {
  if (kind !== 'price') return shown !== match
  const number = NUMBER.exec(match)?.[0]
  return !!number && !shown.includes(number)
}

/**
 * Whether the text takes its direction from its own content: <bdi> (dir="auto") or
 * unicode-bidi: plaintext, on the element or an inline ancestor in the same paragraph.
 * Plain isolation isn't enough: every block element is isolate by default (HTML's UA
 * stylesheet), and isolated RTL content still scrambles a phone number.
 */
function directionFromContent(el: ElementSnap, chain: ElementSnap[]) {
  for (const e of [el, ...chain]) {
    if (e.tag === 'bdi' || e.style.unicodeBidi === 'plaintext') return true
    if (!e.style.display.startsWith('inline') && e.style.display !== 'contents') return false
  }
  return false
}

/** Algorithm: the bidi resolver in ./bidi, checked against Chromium. See DESIGN.md › bidi-isolation. */
export default defineRule({
  meta: {
    id: ID,
    defaultSeverity: 'warn',
    needs: 'rtl',
    experimental: true,
    fingerprintKeys: ['kind', 'textHash'],
    docs: ID,
  },
  options: z.object({
    families: z
      .array(z.enum(Object.keys(FAMILIES) as [Kind, ...Kind[]]))
      .default(Object.keys(FAMILIES) as Kind[]),
  }),
  check(pair, ctx) {
    const findings: Finding[] = []
    for (const el of pair.rtl.elements) {
      const value = el.text?.value
      if (!value || el.style.direction !== 'rtl' || isIgnored(el, ID)) continue
      // A dir="ltr" element (or its LTR-styled descendant) is skipped by the direction check above.
      if (directionFromContent(el, [...ancestors(el, 'rtl', ctx)])) continue
      const reported = new Set<string>()
      for (const kind of ctx.options.families) {
        if (kind === 'latin-phrase' && (el.text?.arabic ?? 0) === 0) continue
        for (const m of value.matchAll(FAMILIES[kind])) {
          const match = m[0].trim()
          if (!match || reported.has(match)) continue
          // Indexes in code points, as the resolver works on code points.
          const start = [...value.slice(0, (m.index ?? 0) + m[0].indexOf(match))].length
          const end = start + [...match].length
          const shown = displayedAs(value, start, end)
          if (!scrambled(kind, match, shown)) continue
          reported.add(match)
          findings.push(
            ctx.finding({
              rule: ID,
              route: pair.route,
              selector: el.selector,
              el,
              boxes: { rtl: el.box },
              message: `"${match}" displays as "${shown}" in this right-to-left text. Wrap it in <bdi> or a dir="ltr" element.`,
              evidence: { kind, match, displayed: shown, textHash: shortHash(match) },
            }),
          )
        }
      }
    }
    return findings
  },
})
