import * as z from 'zod'
import { defineRule } from '../util'
import { LANGUAGE, report, sameUrl, sharedUrl, sides, type Issue } from './shared'

const primary = (lang: string) => lang.toLowerCase().split('-')[0] ?? ''

/**
 * Language links between the two pages: each should list itself and its twin, and its own
 * entry should carry the language the page declares. Apps that keep one URL for both
 * languages (cookie, storage or attribute switches) can't use hreflang, so they're skipped.
 */
export default defineRule({
  meta: {
    id: 'hreflang',
    area: 'seo',
    defaultSeverity: 'warn',
    needs: 'pair',
    fingerprintKeys: ['check', 'side'],
    docs: 'hreflang',
  },
  options: z.object({}),
  check(pair, ctx) {
    if (!pair.ltr || sharedUrl(pair)) return []
    const issues: Record<string, Issue[]> = {}
    for (const { dir, head, url, lang } of sides(pair)) {
      const list: Issue[] = (issues[dir] = [])
      const twin = dir === 'ltr' ? pair.rtl : pair.ltr
      if (!head.alternates.length) {
        list.push({
          check: 'missing',
          message: `The page has no hreflang links, so search engines may show it to ${LANGUAGE[twin.dir]} readers.`,
        })
        continue
      }
      const toTwin = head.alternates.find((a) => sameUrl(a.href, twin.finalUrl))
      if (!toTwin) {
        const guess = head.alternates.find((a) => primary(a.hreflang) === primary(twin.lang))
        list.push({
          check: guess ? 'wrong-twin' : 'no-twin',
          message: guess
            ? `The hreflang="${guess.hreflang}" link points at ${guess.href}, not at the ${LANGUAGE[twin.dir]} version of this page (${twin.finalUrl}).`
            : `No hreflang link points at the ${LANGUAGE[twin.dir]} version of this page (${twin.finalUrl}).`,
          evidence: { expected: twin.finalUrl, ...(guess ? { found: guess.href } : {}) },
        })
      }
      if (toTwin && twin.lang && primary(toTwin.hreflang) !== primary(twin.lang)) {
        list.push({
          check: 'twin-lang',
          message: `The link to the ${LANGUAGE[twin.dir]} page says hreflang="${toTwin.hreflang}", but that page's <html lang> is "${twin.lang}".`,
          evidence: { hreflang: toTwin.hreflang, lang: twin.lang },
        })
      }
      const self = head.alternates.find((a) => sameUrl(a.href, url))
      if (!self) {
        list.push({
          check: 'no-self',
          severity: 'info',
          message:
            "The hreflang links don't include this page itself; each language should list every version, its own too.",
        })
      } else if (lang && primary(self.hreflang) !== primary(lang)) {
        list.push({
          check: 'lang-mismatch',
          message: `This page's own hreflang link says "${self.hreflang}", but <html lang> is "${lang}".`,
          evidence: { hreflang: self.hreflang, lang },
        })
      }
      if (!head.alternates.some((a) => a.hreflang === 'x-default')) {
        list.push({
          check: 'no-x-default',
          severity: 'info',
          message: 'No hreflang="x-default" link, the version for readers of any other language.',
        })
      }
    }
    return report(pair, ctx, 'hreflang', 'link[rel="alternate"][hreflang]', issues)
  },
})
