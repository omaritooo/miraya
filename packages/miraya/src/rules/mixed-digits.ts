import * as z from 'zod'
import type { ElementSnap, Finding } from '../types'
import { ancestors, defineRule, isIgnored } from './util'

const ID = 'mixed-digits'
const EXCLUDED_TAGS = new Set(['code', 'kbd', 'samp', 'pre', 'input', 'textarea'])

export default defineRule({
  meta: { id: ID, defaultSeverity: 'info', needs: 'rtl', fingerprintKeys: ['prefer'], docs: ID },
  options: z.object({ prefer: z.enum(['western', 'arabic-indic']).optional() }),
  check(pair, ctx) {
    const counted: ElementSnap[] = []
    for (const el of pair.rtl.elements) {
      const d = el.text?.digits
      if (!d || d.arabicIndic + d.western === 0 || isIgnored(el, ID) || el.explicitDir === 'ltr')
        continue
      if (
        EXCLUDED_TAGS.has(el.tag) ||
        [...ancestors(el, 'rtl', ctx)].some((a) => EXCLUDED_TAGS.has(a.tag))
      )
        continue
      counted.push(el)
    }
    const arabic = counted.filter((el) => (el.text?.digits.arabicIndic ?? 0) > 0)
    const western = counted.filter((el) => (el.text?.digits.western ?? 0) > 0)
    const findings: Finding[] = []
    const prefer = ctx.options.prefer

    if (!prefer) {
      if (arabic.length === 0 || western.length === 0) return []
      const examples = (els: ElementSnap[]) =>
        els
          .slice(0, 5)
          .map((el) => el.selector)
          .join(', ')
      findings.push(
        ctx.finding({
          rule: ID,
          route: pair.route,
          selector: 'html',
          boxes: {},
          message: `The page mixes Arabic-Indic digits (${arabic.length} elements) and Western digits (${western.length} elements). Pick one with the "prefer" option.`,
          evidence: {
            prefer: 'none',
            arabicIndic: arabic.length,
            western: western.length,
            arabicExamples: examples(arabic),
            westernExamples: examples(western),
          },
        }),
      )
      return findings
    }

    for (const el of prefer === 'western' ? arabic : western) {
      findings.push(
        ctx.finding({
          rule: ID,
          route: pair.route,
          selector: el.selector,
          el,
          boxes: { rtl: el.box },
          message: `Uses ${prefer === 'western' ? 'Arabic-Indic' : 'Western'} digits; this app prefers ${prefer} digits.`,
          evidence: {
            prefer,
            arabicIndic: el.text?.digits.arabicIndic ?? 0,
            western: el.text?.digits.western ?? 0,
          },
        }),
      )
    }
    return findings
  },
})
