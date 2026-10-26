import * as z from 'zod'
import { defineRule } from '../util'
import { isLocal, report, sides, type Issue } from './shared'

export default defineRule({
  meta: {
    id: 'robots-noindex',
    area: 'seo',
    defaultSeverity: 'error',
    needs: 'rtl',
    fingerprintKeys: ['check', 'side', 'source'],
    docs: 'robots-noindex',
  },
  options: z.object({}),
  check(pair, ctx) {
    const issues: Record<string, Issue[]> = {}
    for (const { dir, head, url } of sides(pair)) {
      const list: Issue[] = (issues[dir] = [])
      // A dev or preview server that hides itself from search engines is doing its job.
      const local = isLocal(url)
      for (const [source, value] of [
        ['meta', head.robots],
        ['header', head.http?.robots],
      ] as const) {
        if (!value || !/\b(noindex|none)\b/.test(value)) continue
        const where = source === 'meta' ? '<meta name="robots">' : 'the X-Robots-Tag header'
        list.push({
          check: 'noindex',
          message: local
            ? `${where} says "${value}". Expected on a development server; check it on the production site.`
            : `${where} says "${value}", so search engines drop this page from their results.`,
          evidence: { source, value, local },
          ...(local ? { severity: 'info' as const } : {}),
        })
      }
    }
    return report(pair, ctx, 'robots-noindex', 'meta[name="robots"]', issues)
  },
})
