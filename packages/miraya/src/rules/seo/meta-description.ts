import * as z from 'zod'
import { defineRule } from '../util'
import { report, sides, type Issue } from './shared'

export default defineRule({
  meta: {
    id: 'meta-description',
    area: 'seo',
    defaultSeverity: 'warn',
    needs: 'rtl',
    fingerprintKeys: ['check', 'side'],
    docs: 'meta-description',
  },
  // Search results show about 160 characters of a description.
  options: z.object({
    maxLength: z.number().int().default(160),
    minLength: z.number().int().default(50),
  }),
  check(pair, ctx) {
    const { maxLength, minLength } = ctx.options
    const issues: Record<string, Issue[]> = {}
    for (const { dir, head } of sides(pair)) {
      const text = head.description ?? ''
      const list: Issue[] = (issues[dir] = [])
      if (!text) {
        list.push({
          check: 'missing',
          message:
            'The page has no meta description, so search results quote whatever text they pick.',
        })
      } else if (text.length > maxLength) {
        list.push({
          check: 'long',
          message: `The description is ${text.length} characters, ${text.length - maxLength} over ${maxLength}; search results cut the end: “${text.slice(maxLength).trim()}”.`,
          evidence: { length: text.length, max: maxLength },
        })
      } else if (text.length < minLength) {
        list.push({
          check: 'short',
          severity: 'info',
          message: `The description is only ${text.length} characters, under ${minLength}.`,
          evidence: { length: text.length, min: minLength },
        })
      }
    }
    const { locale } = ctx.config
    const layoutOnly = typeof locale === 'object' && locale.strategy === 'attribute'
    const english = pair.ltr?.head.description
    if (!layoutOnly && english && english === pair.rtl.head.description) {
      ;(issues.rtl ??= []).push({
        check: 'untranslated',
        message: 'The description is the same as on the English page.',
      })
    }
    return report(pair, ctx, 'meta-description', 'meta[name="description"]', issues)
  },
})
