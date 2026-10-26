import * as z from 'zod'
import type { Dir } from '../../types'
import { report, type Issue } from '../page-findings'
import { defineRule } from '../util'
import { kb, measured } from './budgets'

const file = (url: string) => {
  try {
    return new URL(url).pathname.split('/').filter(Boolean).at(-1) ?? url
  } catch {
    return url
  }
}

export default defineRule({
  meta: {
    id: 'render-blocking',
    area: 'performance',
    defaultSeverity: 'warn',
    needs: 'rtl',
    fingerprintKeys: ['check', 'side'],
    docs: 'render-blocking',
  },
  options: z.object({}),
  check(pair, ctx) {
    const budget = ctx.config.performance.budgets.renderBlocking
    const issues: Partial<Record<Dir, Issue[]>> = {}
    for (const { dir, perf } of measured(pair)) {
      const blocking = perf.renderBlocking
      if (blocking.length <= budget) continue
      const names = blocking.slice(0, 3).map((r) => `${file(r.url)} (${kb(r.bytes)} KB)`)
      const more = blocking.length > 3 ? ` and ${blocking.length - 3} more` : ''
      issues[dir] = [
        {
          check: 'over',
          message: `${blocking.length} ${blocking.length === 1 ? 'file holds' : 'files hold'} up the first paint: ${names.join(', ')}${more}.`,
          evidence: { budget, count: blocking.length },
        },
      ]
    }
    return report(pair, ctx, 'render-blocking', 'head', issues)
  },
})
