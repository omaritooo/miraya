import * as z from 'zod'
import type { Dir } from '../../types'
import { report, type Issue } from '../page-findings'
import { defineRule } from '../util'
import { kb, measured } from './budgets'

export default defineRule({
  meta: {
    id: 'oversized-images',
    area: 'performance',
    defaultSeverity: 'info',
    needs: 'rtl',
    fingerprintKeys: ['check', 'side'],
    docs: 'oversized-images',
  },
  options: z.object({}),
  check(pair, ctx) {
    const issues: Partial<Record<Dir, Issue[]>> = {}
    for (const { dir, perf } of measured(pair)) {
      const images = perf.oversizedImages
      if (images.length === 0) continue
      const wasted = kb(images.reduce((sum, i) => sum + i.wastedBytes, 0))
      const [top] = images
      issues[dir] = [
        {
          check: 'oversized',
          message: `${images.length} ${images.length === 1 ? 'image is' : 'images are'} larger than drawn, ${wasted} KB more than needed. The largest: ${top?.natural.w}×${top?.natural.h} drawn at ${top?.shown.w}×${top?.shown.h}.`,
          evidence: { count: images.length, wastedKb: wasted },
        },
      ]
    }
    return report(pair, ctx, 'oversized-images', 'img', issues)
  },
})
