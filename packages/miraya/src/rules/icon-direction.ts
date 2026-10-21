import pixelmatch from 'pixelmatch'
import { z } from 'zod'
import type { Finding, RGBAImage } from '../types'
import { defineRule, isIgnored, round } from './util'

const ID = 'icon-direction'
const DIRECTIONAL =
  '(chevron|arrow|caret|angle)[-_]?(left|right|start|end)|back|forward|next|prev(ious)?|send|reply|undo|redo|external|log[-_]?(out|in)|exit'
const NEVER_FLIP =
  'logo(?!ut)|brand|check|tick|play|pause|clock|time|media|music|search|question|help'

/** Greyscale, padded to width × height and centred on the crop's corner colour. */
function normalise(img: RGBAImage, width: number, height: number): Uint8Array {
  const out = new Uint8Array(width * height * 4)
  const d = img.data
  const grey = (i: number) =>
    Math.round(0.299 * (d[i] ?? 0) + 0.587 * (d[i + 1] ?? 0) + 0.114 * (d[i + 2] ?? 0))
  const background = grey(0)
  out.fill(background)
  const dx = Math.floor((width - img.width) / 2)
  const dy = Math.floor((height - img.height) / 2)
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      const g = grey((y * img.width + x) * 4)
      const o = ((y + dy) * width + (x + dx)) * 4
      out[o] = out[o + 1] = out[o + 2] = g
    }
  }
  for (let i = 3; i < out.length; i += 4) out[i] = 255
  return out
}

function flipHorizontal(data: Uint8Array, width: number, height: number): Uint8Array {
  const out = new Uint8Array(data.length)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const from = (y * width + x) * 4
      out.set(data.subarray(from, from + 4), (y * width + (width - 1 - x)) * 4)
    }
  }
  return out
}

/** Algorithm: SPEC.md › Icon flip. */
export default defineRule({
  meta: {
    id: ID,
    defaultSeverity: 'error',
    needs: 'pair',
    // Pixels decide, so a wrong pair usually fails the "same icon" check and is skipped.
    minMatch: 'heuristic',
    fingerprintKeys: ['iconName', 'verdict'],
    needsCrop: (el) => el.icon?.name !== undefined,
    docs: ID,
  },
  options: z.object({
    symmetricBelow: z.number().default(0.1),
    sameBelow: z.number().default(0.15),
    minSize: z.number().default(12),
    directional: z.string().default(DIRECTIONAL),
    neverFlip: z.string().default(NEVER_FLIP),
    overrides: z.record(z.string(), z.enum(['flip', 'fixed'])).default({}),
  }),
  check(pair, ctx) {
    const opts = ctx.options
    const directional = new RegExp(opts.directional, 'i')
    const neverFlip = new RegExp(opts.neverFlip, 'i')
    const findings: Finding[] = []
    for (const m of pair.matches) {
      const R = ctx.el('rtl', m.rtl)
      const L = ctx.el('ltr', m.ltr)
      const name = R?.icon?.name
      if (!R || !L || !name || isIgnored(R, ID)) continue
      // neverFlip wins when a name matches both lists.
      const kind =
        opts.overrides[name] ??
        (neverFlip.test(name) ? 'fixed' : directional.test(name) ? 'flip' : undefined)
      if (!kind) continue
      const a = ctx.crop('ltr', L.key)
      const b = ctx.crop('rtl', R.key)
      if (!a || !b || Math.min(L.box.w, L.box.h) < opts.minSize) continue

      const w = Math.max(a.width, b.width)
      const h = Math.max(a.height, b.height)
      const na = normalise(a, w, h)
      const nb = normalise(b, w, h)
      const flipped = flipHorizontal(na, w, h)
      // Mismatched pixels as a share of the icon's ink, not of the crop: a thin-stroke icon
      // covers little of its box, and an area ratio would push every score towards zero.
      const background = na[0] ?? 255
      const inked = (x: Uint8Array, i: number) => Math.abs((x[i] ?? 0) - background) > 40
      const diff = (x: Uint8Array, y: Uint8Array) => {
        let ink = 0
        for (let i = 0; i < x.length; i += 4) if (inked(x, i) || inked(y, i)) ink++
        return (
          pixelmatch(x, y, undefined, w, h, { threshold: 0.1, includeAA: false }) / Math.max(ink, 1)
        )
      }
      if (diff(na, flipped) < opts.symmetricBelow) continue // flipping changes nothing
      const diffFlipped = diff(nb, flipped)
      const diffSame = diff(nb, na)

      let verdict: 'not-flipped' | 'wrongly-flipped' | undefined
      if (kind === 'flip' && diffFlipped >= opts.sameBelow && diffSame < opts.sameBelow)
        verdict = 'not-flipped'
      if (kind === 'fixed' && diffFlipped < opts.sameBelow && diffSame >= opts.sameBelow)
        verdict = 'wrongly-flipped'
      if (!verdict) continue // flipped correctly, or a different icon in RTL: assume intentional

      findings.push(
        ctx.finding({
          rule: ID,
          route: pair.route,
          selector: R.selector,
          el: R,
          boxes: { ltr: L.box, rtl: R.box },
          match: m.method,
          message:
            verdict === 'not-flipped'
              ? `The "${name}" icon points the same way in RTL; directional icons should flip.`
              : `The "${name}" icon is flipped in RTL; it should keep its LTR orientation.`,
          evidence: {
            iconName: name,
            verdict,
            diffFlipped: round(diffFlipped * 100) / 100,
            diffSame: round(diffSame * 100) / 100,
          },
        }),
      )
    }
    return findings
  },
})
