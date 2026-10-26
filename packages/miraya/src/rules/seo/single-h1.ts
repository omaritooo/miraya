import * as z from 'zod'
import { defineRule } from '../util'
import { report, sides, type Issue } from './shared'

export default defineRule({
  meta: {
    id: 'single-h1',
    area: 'seo',
    defaultSeverity: 'warn',
    needs: 'rtl',
    fingerprintKeys: ['check', 'side'],
    docs: 'single-h1',
  },
  options: z.object({}),
  check(pair, ctx) {
    const issues: Record<string, Issue[]> = {}
    for (const { dir, head } of sides(pair)) {
      const list: Issue[] = (issues[dir] = [])
      if (head.h1.length === 0) {
        list.push({
          check: 'missing',
          message: 'The page has no <h1>, so nothing names its main topic.',
        })
      } else if (head.h1.length > 1) {
        list.push({
          check: 'several',
          severity: 'info',
          message: `The page has ${head.h1.length} <h1> elements: ${head.h1.map((t) => `“${t}”`).join(', ')}.`,
          evidence: { count: head.h1.length },
        })
      }
    }
    return report(pair, ctx, 'single-h1', 'h1', issues)
  },
})
