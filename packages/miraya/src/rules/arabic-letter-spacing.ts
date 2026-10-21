import { z } from 'zod'
import type { Finding } from '../types'
import { ancestors, defineRule, isIgnored } from './util'

const ID = 'arabic-letter-spacing'

/** Computed letter-spacing is "normal" or a px length. */
const spacingPx = (value: string) => (value === 'normal' ? 0 : parseFloat(value) || 0)

export default defineRule({
  meta: {
    id: ID,
    defaultSeverity: 'error',
    needs: 'rtl',
    fingerprintKeys: ['letterSpacing'],
    docs: ID,
  },
  options: z.object({ minArabicRatio: z.number().min(0).max(1).default(0.5) }),
  check(pair, ctx) {
    const findings: Finding[] = []
    const reported = new Set<string>()
    for (const el of pair.rtl.elements) {
      const text = el.text
      if (!text || isIgnored(el, ID)) continue
      const ratio = text.arabic / Math.max(text.arabic + text.latin, 1)
      if (ratio < ctx.options.minArabicRatio || spacingPx(el.style.letterSpacing) === 0) continue
      // Report where the value starts, which may be a wrapper without text of its own,
      // once, not on every descendant that inherits it.
      let origin = el
      for (const parent of ancestors(el, 'rtl', ctx)) {
        if (parent.style.letterSpacing !== el.style.letterSpacing) break
        origin = parent
      }
      if (reported.has(origin.key)) continue
      reported.add(origin.key)
      findings.push(
        ctx.finding({
          rule: ID,
          route: pair.route,
          selector: origin.selector,
          el: origin,
          boxes: { rtl: origin.box },
          message: `letter-spacing: ${el.style.letterSpacing} breaks how Arabic letters join.`,
          evidence: {
            letterSpacing: el.style.letterSpacing,
            arabicRatio: Math.round(ratio * 100) / 100,
          },
        }),
      )
    }
    return findings
  },
})
