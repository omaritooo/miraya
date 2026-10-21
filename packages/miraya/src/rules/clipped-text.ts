import { z } from 'zod'
import type { ElementSnap, Finding } from '../types'
import { defineRule, isIgnored } from './util'

const ID = 'clipped-text'
const CLIPS = new Set(['hidden', 'clip'])
const SCROLLS = new Set(['auto', 'scroll'])

/**
 * Vertical clipping is measured two ways (DESIGN.md › clipped-text). Ink taller than
 * the box means glyphs are cut: Arabic ascenders, descenders and diacritics. Layout
 * overflow only counts from half a line up, because every font's content area pokes a
 * few pixels past a tight line-height, in Latin text too, without cutting any ink.
 */
function clipsVertically(el: ElementSnap): 'ink' | 'lines' | undefined {
  if (!CLIPS.has(el.style.overflowY) || el.style.display === 'inline' || !el.text) return undefined
  const { sh, ch } = el.scroll
  if (el.text.inkHeight !== undefined && el.text.inkHeight > ch + 1) return 'ink'
  if (sh > ch + 0.5 * (el.style.fontSize ?? 16)) return 'lines'
  return undefined
}

function overflowsHorizontally(el: ElementSnap) {
  if (SCROLLS.has(el.style.overflowX) || el.style.display === 'inline' || !el.text) return false
  return el.scroll.sw > el.scroll.cw + 1
}

const ellipsis = (el: ElementSnap) =>
  el.style.textOverflow === 'ellipsis' && el.style.whiteSpace === 'nowrap'

export default defineRule({
  meta: { id: ID, defaultSeverity: 'warn', needs: 'rtl', fingerprintKeys: ['axis'], docs: ID },
  options: z.object({}),
  check(pair, ctx) {
    const findings: Finding[] = []
    const report = (
      el: ElementSnap | undefined,
      axis: 'x' | 'y' | 'page',
      message: string,
      evidence: Record<string, number | string | boolean>,
    ) =>
      findings.push(
        ctx.finding({
          rule: ID,
          route: pair.route,
          selector: el?.selector ?? 'html',
          ...(el ? { el } : {}),
          boxes: el ? { rtl: el.box } : {},
          message,
          evidence: { axis, ...evidence },
        }),
      )

    for (const el of pair.rtl.elements) {
      if (!el.text || el.text.arabic === 0 || isIgnored(el, ID)) continue
      const twin = pair.ltr ? ctx.twin(el.key)?.el : undefined

      const vertical = clipsVertically(el)
      if (vertical && !(twin && clipsVertically(twin))) {
        report(
          el,
          'y',
          vertical === 'ink'
            ? `Arabic glyphs are cut off: the text is ${el.text.inkHeight}px tall in a ${el.scroll.ch}px box with overflow hidden.`
            : `Arabic text overflows its box: ${el.scroll.sh}px of content in ${el.scroll.ch}px with overflow hidden.`,
          {
            scroll: el.scroll.sh,
            client: el.scroll.ch,
            inkHeight: el.text.inkHeight ?? 0,
            ltrClipped: false,
            check: vertical,
          },
        )
      }

      if (overflowsHorizontally(el) && !ellipsis(el) && !(twin && overflowsHorizontally(twin))) {
        report(
          el,
          'x',
          `Text overflows its box in RTL: ${el.scroll.sw}px of content in ${el.scroll.cw}px.`,
          {
            scroll: el.scroll.sw,
            client: el.scroll.cw,
            ltrClipped: false,
          },
        )
      }
    }

    // The classic leftover margin-left: -Npx or translateX: the page scrolls sideways only in RTL.
    const { rtl, ltr } = pair
    if (
      ltr &&
      rtl.docWidth.scroll > rtl.docWidth.client + 1 &&
      ltr.docWidth.scroll <= ltr.docWidth.client + 1
    ) {
      report(
        undefined,
        'page',
        `The page scrolls horizontally in RTL but not in LTR: ${rtl.docWidth.scroll}px wide in a ${rtl.docWidth.client}px viewport.`,
        {
          scroll: rtl.docWidth.scroll,
          client: rtl.docWidth.client,
          ltrClipped: false,
        },
      )
    }
    return findings
  },
})
