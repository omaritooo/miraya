import { z } from 'zod'
import type { ElementSnap, Finding } from '../types'
import { ancestors, defineRule, isIgnored, shortHash } from './util'

const ID = 'untranslated-text'
const CODE_TAGS = new Set(['code', 'kbd', 'samp', 'pre', 'textarea', 'input'])
const WORD = /\p{L}{2,}/gu
const URL_OR_EMAIL =
  /^(https?:\/\/\S+|www\.\S+|[^\s@]+@[^\s@]+\.[^\s@]+|[\w-]+(\.[\w-]+)*\.(com|net|org|dev|io|eg|sa|ae)(\/\S*)?)$/i

export default defineRule({
  meta: {
    id: ID,
    defaultSeverity: 'warn',
    needs: 'rtl',
    fingerprintKeys: ['textHash'],
    docs: ID,
  },
  options: z.object({ minWords: z.number().int().min(1).default(2) }),
  check(pair, ctx) {
    const allowed = new Set(
      ctx.config.allow.latinText.flatMap((s) => s.toLowerCase().match(WORD) ?? []),
    )
    // Identical strings on a route report once, with a count (DESIGN.md › untranslated-text).
    const byText = new Map<string, { el: ElementSnap; text: string; count: number }>()
    for (const el of pair.rtl.elements) {
      const value = el.text?.value
      if (!value || (el.text?.arabic ?? 0) > 0 || isIgnored(el, ID)) continue
      if (el.explicitDir === 'ltr' || URL_OR_EMAIL.test(value)) continue
      const words = value.match(WORD) ?? []
      if (words.length < ctx.options.minWords) continue
      if (words.every((w) => allowed.has(w.toLowerCase()))) continue
      if (CODE_TAGS.has(el.tag) || [...ancestors(el, 'rtl', ctx)].some((a) => CODE_TAGS.has(a.tag)))
        continue
      const normalised = value.toLowerCase()
      const seen = byText.get(normalised)
      if (seen) seen.count++
      else byText.set(normalised, { el, text: value, count: 1 })
    }

    const findings: Finding[] = []
    for (const [normalised, { el, text, count }] of byText) {
      findings.push(
        ctx.finding({
          rule: ID,
          route: pair.route,
          selector: el.selector,
          boxes: { rtl: el.box },
          message:
            count > 1
              ? `English text in the Arabic UI, ${count} times: "${text.slice(0, 80)}".`
              : `English text in the Arabic UI: "${text.slice(0, 80)}".`,
          evidence: { text: text.slice(0, 80), textHash: shortHash(normalised), count },
        }),
      )
    }
    return findings
  },
})
