import * as z from 'zod'
import { defineRule } from '../util'
import { LANGUAGE, report, sameUrl, sharedUrl, sides, type Issue } from './shared'

export default defineRule({
  meta: {
    id: 'canonical',
    area: 'seo',
    defaultSeverity: 'error',
    needs: 'rtl',
    fingerprintKeys: ['check', 'side'],
    docs: 'canonical',
  },
  options: z.object({}),
  check(pair, ctx) {
    const issues: Record<string, Issue[]> = {}
    const separate = !!pair.ltr && !sharedUrl(pair)
    for (const { dir, head, url } of sides(pair)) {
      const list: Issue[] = (issues[dir] = [])
      const [target, ...more] = head.canonical
      if (!target) {
        list.push({
          check: 'missing',
          severity: 'info',
          message:
            'The page has no canonical link, so copies of it under other URLs compete with it.',
        })
        continue
      }
      if (more.length) {
        list.push({
          check: 'several',
          message: `The page has ${head.canonical.length} canonical links; search engines ignore them all.`,
          evidence: { count: head.canonical.length },
        })
        continue
      }
      // Each language is its own page: one that names its twin as canonical drops out of results.
      const other = dir === 'ltr' ? pair.rtl : pair.ltr
      if (separate && other && sameUrl(target, other.finalUrl) && !sameUrl(target, url)) {
        list.push({
          check: 'points-at-twin',
          message: `The canonical is ${target}, the ${LANGUAGE[other.dir]} page. Search engines treat this page as a copy and drop it from results. Point it at this page's own URL.`,
          evidence: { target, expected: url },
        })
        continue
      }
      try {
        if (new URL(target).origin !== new URL(url).origin) {
          list.push({
            check: 'other-origin',
            severity: 'warn',
            message: `The canonical is on another origin: ${target}.`,
            evidence: { target },
          })
        }
      } catch {
        list.push({
          check: 'invalid',
          message: `The canonical "${target}" isn't a valid URL.`,
          evidence: { target },
        })
      }
    }
    return report(pair, ctx, 'canonical', 'link[rel="canonical"]', issues)
  },
})
