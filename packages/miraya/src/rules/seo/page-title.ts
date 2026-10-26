import * as z from 'zod'
import { defineRule } from '../util'
import { report, sides, type Issue } from './shared'

export default defineRule({
  meta: {
    id: 'page-title',
    area: 'seo',
    defaultSeverity: 'error',
    needs: 'rtl',
    fingerprintKeys: ['check', 'side'],
    docs: 'page-title',
  },
  // Search results show about 60 characters of a title before cutting it.
  options: z.object({
    maxLength: z.number().int().default(60),
    minLength: z.number().int().default(10),
  }),
  check(pair, ctx) {
    const { maxLength, minLength } = ctx.options
    const issues: Record<string, Issue[]> = {}
    for (const { dir, head } of sides(pair)) {
      const title = head.title ?? ''
      const list: Issue[] = (issues[dir] = [])
      if (!title) {
        list.push({
          check: 'missing',
          message: 'The page has no <title>, so search results make one up.',
        })
      } else if (title.length > maxLength) {
        list.push({
          check: 'long',
          severity: 'warn',
          message: `The title is ${title.length} characters; search results cut it after about ${maxLength}.`,
          evidence: { length: title.length, max: maxLength },
        })
      } else if (title.length < minLength) {
        list.push({
          check: 'short',
          severity: 'info',
          message: `The title is only ${title.length} characters ("${title}"); it says little about the page.`,
          evidence: { length: title.length, min: minLength },
        })
      }
    }
    const { locale } = ctx.config
    const layoutOnly = typeof locale === 'object' && locale.strategy === 'attribute'
    const english = pair.ltr?.head.title
    if (!layoutOnly && english && english === pair.rtl.head.title) {
      ;(issues.rtl ??= []).push({
        check: 'untranslated',
        severity: 'warn',
        message: `The title is the same as on the English page ("${english}").`,
      })
    }
    return report(pair, ctx, 'page-title', 'head > title', issues)
  },
})
