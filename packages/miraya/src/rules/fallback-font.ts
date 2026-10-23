import * as z from 'zod'
import type { ElementSnap, Finding } from '../types'

type UsedFont = NonNullable<ElementSnap['usedFonts']>[number]
import { defineRule, isIgnored } from './util'

const ID = 'fallback-font'

export default defineRule({
  meta: {
    id: ID,
    defaultSeverity: 'warn',
    needs: 'rtl',
    // The system font name differs by OS, so it's evidence, never part of the fingerprint.
    fingerprintKeys: ['fontStack'],
    docs: ID,
  },
  options: z.object({}),
  check(pair, ctx) {
    const { arabic, latin } = ctx.config.fonts
    const configured = arabic.length > 0
    const allowed = [...arabic, ...latin].map((f) => f.toLowerCase())
    // One finding per font stack and fallback font: elements sharing a style share the cause.
    const byCause = new Map<string, { el: ElementSnap; font: UsedFont; count: number }>()
    for (const el of pair.rtl.elements) {
      if (!el.usedFonts || !el.text || el.text.arabic === 0 || isIgnored(el, ID)) continue
      // Emoji always come from a system font; that's expected, not a fallback.
      const font = el.usedFonts.find(
        (f) =>
          !/emoji/i.test(f.family) &&
          (configured ? !allowed.some((a) => f.family.toLowerCase().startsWith(a)) : !f.custom),
      )
      if (!font) continue
      const cause = `${el.style.fontFamily ?? ''}|${font.family}`
      const seen = byCause.get(cause)
      if (seen) seen.count++
      else byCause.set(cause, { el, font, count: 1 })
    }

    const findings: Finding[] = []
    for (const { el, font, count } of byCause.values()) {
      const where = count > 1 ? ` (${count} sampled elements with this style)` : ''
      findings.push(
        ctx.finding({
          rule: ID,
          route: pair.route,
          selector: el.selector,
          el,
          boxes: { rtl: el.box },
          ...(configured ? {} : { severity: 'info' as const }),
          message: configured
            ? `Arabic text is drawn with "${font.family}", which isn't one of the configured fonts${where}.`
            : `Arabic text is drawn with the system font "${font.family}"; the font stack has no Arabic glyphs${where}. Set fonts.arabic to check against your fonts.`,
          evidence: {
            fontStack: el.style.fontFamily ?? '',
            usedFamily: font.family,
            custom: font.custom,
            glyphs: font.glyphs,
            count,
          },
        }),
      )
    }
    return findings
  },
})
