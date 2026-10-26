import * as z from 'zod'
import { defineRule } from '../util'
import { report, sides, type Issue } from './shared'

/** What a link preview in chat apps and social networks is drawn from. */
const TAGS = ['og:title', 'og:description', 'og:image'] as const

export default defineRule({
  meta: {
    id: 'social-preview',
    area: 'seo',
    defaultSeverity: 'info',
    needs: 'rtl',
    fingerprintKeys: ['check', 'side', 'missing'],
    docs: 'social-preview',
  },
  options: z.object({}),
  check(pair, ctx) {
    const issues: Record<string, Issue[]> = {}
    for (const { dir, head } of sides(pair)) {
      const missing = TAGS.filter((tag) => !head.social[tag])
      if (!missing.length) continue
      issues[dir] = [
        {
          check: `missing ${missing.join(', ')}`,
          message: `No ${missing.join(', ')}, so shared links show ${missing.includes('og:image') ? 'no image and ' : ''}whatever text the app guesses.`,
          evidence: { missing: missing.join(', ') },
        },
      ]
    }
    return report(pair, ctx, 'social-preview', 'meta[property^="og:"]', issues)
  },
})
