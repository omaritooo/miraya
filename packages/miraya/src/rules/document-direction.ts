import { z } from 'zod'
import { defineRule } from './util'

export default defineRule({
  meta: {
    id: 'document-direction',
    defaultSeverity: 'error',
    needs: 'rtl',
    fingerprintKeys: ['attr'],
    docs: 'document-direction',
  },
  options: z.object({}),
  check(pair, ctx) {
    const { rtl } = pair
    const body = rtl.elements.find((el) => el.tag === 'body')
    const evidence = { dir: rtl.dir, lang: rtl.lang, bodyDirection: body?.style.direction ?? '' }
    const html = rtl.elements.find((el) => el.tag === 'html')
    const findings = []
    if (rtl.dir !== 'rtl') {
      findings.push(
        ctx.finding({
          rule: 'document-direction',
          route: pair.route,
          selector: 'html',
          boxes: html ? { rtl: html.box } : {},
          message:
            evidence.bodyDirection === 'rtl'
              ? '<html> has no dir="rtl", although the page is styled right-to-left.'
              : 'The RTL render isn\'t right-to-left: <html> has no dir="rtl". Other rules are skipped for this route.',
          evidence: { attr: 'dir', ...evidence },
        }),
      )
    }
    const languages = ctx.config.languages.rtl
    const lang = rtl.lang.toLowerCase()
    if (!languages.some((l) => lang === l || lang.startsWith(`${l}-`))) {
      findings.push(
        ctx.finding({
          rule: 'document-direction',
          route: pair.route,
          selector: 'html',
          boxes: html ? { rtl: html.box } : {},
          message: `<html lang="${rtl.lang}"> isn't one of the configured RTL languages (${languages.join(', ')}).`,
          evidence: { attr: 'lang', ...evidence },
        }),
      )
    }
    return findings
  },
})
