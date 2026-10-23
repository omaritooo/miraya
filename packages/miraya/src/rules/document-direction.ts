import { z } from 'zod'
import { defineRule, rtlWrapper } from './util'

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
    const wrapper = rtlWrapper(rtl)
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
              : wrapper
                ? `<html> has no dir="rtl"; only ${wrapper.selector} is right-to-left. Set dir on <html>, so the scrollbar, dialogs and anything outside that element follow it.`
                : 'The RTL render isn\'t right-to-left: <html> has no dir="rtl". Other rules are skipped for this route.',
          evidence: { attr: 'dir', ...evidence },
        }),
      )
    }
    // The attribute switch flips the layout of the English page; its lang stays English.
    const { locale } = ctx.config
    if (typeof locale === 'object' && locale.strategy === 'attribute') return findings
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
