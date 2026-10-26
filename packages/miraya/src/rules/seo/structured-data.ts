import * as z from 'zod'
import { defineRule } from '../util'
import { report, sides, type Issue } from './shared'

export default defineRule({
  meta: {
    id: 'structured-data',
    area: 'seo',
    defaultSeverity: 'error',
    needs: 'rtl',
    fingerprintKeys: ['check', 'side', 'block'],
    docs: 'structured-data',
  },
  options: z.object({}),
  check(pair, ctx) {
    const issues: Record<string, Issue[]> = {}
    for (const { dir, head } of sides(pair)) {
      const list: Issue[] = (issues[dir] = [])
      head.jsonLd.forEach((block, i) => {
        const n = `${i + 1}`
        if (block.error) {
          list.push({
            check: `invalid ${n}`,
            message: `JSON-LD block ${n} isn't valid JSON (${block.error}), so search engines ignore it.`,
            evidence: { block: n, error: block.error },
          })
        } else if (!block.types.length) {
          list.push({
            check: `untyped ${n}`,
            severity: 'warn',
            message: `JSON-LD block ${n} has no @type, so search engines can't tell what it describes.`,
            evidence: { block: n },
          })
        }
      })
    }
    return report(pair, ctx, 'structured-data', 'script[type="application/ld+json"]', issues)
  },
})
