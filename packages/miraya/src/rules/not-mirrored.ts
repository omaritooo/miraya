import * as z from 'zod'
import type { Box, ElementSnap, MatchMethod, Snapshot } from '../types'
import { defineRule, isIgnored, round } from './util'

const ID = 'not-mirrored'
const MEDIA = new Set(['img', 'video', 'canvas', 'iframe', 'pre', 'code'])

type Member = { L: ElementSnap; R: ElementSnap; method: MatchMethod }
type Container = { box: Box; el?: ElementSnap }

const viewport = (s: Snapshot): Container => ({
  box: { x: 0, y: 0, w: s.docWidth.client, h: s.viewport.h },
})

const sameLine = (a: Box, b: Box) => Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y) > 0

const distributesSpace = (c: Container) =>
  !!c.el && /flex|grid/.test(c.el.style.display) && c.el.style.justifyContent.startsWith('space-')

/** Algorithm: SPEC.md › Mirroring. */
export default defineRule({
  meta: {
    id: ID,
    defaultSeverity: 'error',
    needs: 'pair',
    minMatch: 'path',
    fingerprintKeys: ['check'],
    docs: ID,
  },
  options: z.object({
    tolerancePx: z.number().nonnegative().default(4),
    tolerancePct: z.number().min(0).max(1).default(0.02),
    minWidth: z.number().nonnegative().default(8),
    fullWidthRatio: z.number().min(0).max(1).default(0.95),
  }),
  check(pair, ctx) {
    const ltr = pair.ltr
    if (!ltr) return []
    const opts = ctx.options
    const rtlOf = new Map(pair.matches.map((m) => [m.ltr, m.rtl]))

    const containerFor = (el: ElementSnap, dir: 'ltr' | 'rtl'): Container | undefined => {
      if (el.containerKey === 'viewport') return viewport(dir === 'ltr' ? ltr : pair.rtl)
      const c = el.containerKey ? ctx.el(dir, el.containerKey) : undefined
      return c && { box: c.box, el: c }
    }

    // Group matched elements by their container. Only an element whose parent is the
    // container itself is a member: a descendant of a same-width wrapper shares the
    // wrapper's position, and the wrapper stands for it.
    const groups = new Map<string, Member[]>()
    for (const m of pair.matches) {
      const L = ctx.el('ltr', m.ltr)
      const R = ctx.el('rtl', m.rtl)
      if (!L || !R || !L.containerKey) continue
      if (L.containerKey !== 'viewport' && L.parentKey !== L.containerKey) continue
      const containersPair =
        L.containerKey === 'viewport'
          ? R.containerKey === 'viewport'
          : rtlOf.get(L.containerKey) === R.containerKey
      if (!containersPair) continue
      const group = groups.get(L.containerKey) ?? []
      group.push({ L, R, method: m.method })
      groups.set(L.containerKey, group)
    }

    const findings = []
    for (const members of groups.values()) {
      const first = members[0]
      if (!first) continue
      const CL = containerFor(first.L, 'ltr')
      const CR = containerFor(first.R, 'rtl')
      if (!CL || !CR) continue
      const tol = Math.max(opts.tolerancePx, opts.tolerancePct * CR.box.w)
      // Ignored and explicit-direction elements keep a physical position on purpose,
      // so they can't serve as neighbours.
      const neighbours = members.filter(
        (m) => !isIgnored(m.R, ID) && !m.L.explicitDir && !m.R.explicitDir,
      )
      members.sort((a, b) => a.L.box.x - b.L.box.x || a.L.box.y - b.L.box.y)
      const failed = new Set<string>()

      for (const { L, R, method } of members) {
        if (isIgnored(R, ID) || L.explicitDir || R.explicitDir) continue
        if (MEDIA.has(L.tag)) continue
        if ((L.role === 'img' || L.role === 'presentation') && !L.text) continue
        // An inline element inside a line of text is placed by the bidi algorithm, not by
        // layout CSS; bidi-isolation covers that.
        if (L.style.display === 'inline' && CL.el?.text) continue
        if (L.box.w < opts.minWidth || L.box.w >= opts.fullWidthRatio * CL.box.w) continue
        const startC = L.box.x - CL.box.x
        const endC = CL.box.x + CL.box.w - (L.box.x + L.box.w)
        if (Math.abs(startC - endC) < tol) continue // centred in LTR

        let P: Member | undefined
        let N: Member | undefined
        for (const n of neighbours) {
          if (n.L === L || !sameLine(n.L.box, L.box)) continue
          const right = n.L.box.x + n.L.box.w
          if (right <= L.box.x + tol && (!P || right > P.L.box.x + P.L.box.w)) P = n
          if (n.L.box.x >= L.box.x + L.box.w - tol && (!N || n.L.box.x < N.L.box.x)) N = n
        }

        let check: 'order' | 'gap' | undefined
        let gaps = { startL: 0, endR: 0, endL: 0, startR: 0 }
        if (P && R.box.x + R.box.w > P.R.box.x + tol) {
          check = 'order' // P should sit to R's right in RTL
        } else if (!distributesSpace(CL)) {
          gaps = {
            startL: L.box.x - (P ? P.L.box.x + P.L.box.w : CL.box.x),
            endR: (P ? P.R.box.x : CR.box.x + CR.box.w) - (R.box.x + R.box.w),
            endL: (N ? N.L.box.x : CL.box.x + CL.box.w) - (L.box.x + L.box.w),
            startR: R.box.x - (N ? N.R.box.x + N.R.box.w : CR.box.x),
          }
          const before = Math.abs(gaps.startL - gaps.endR)
          const after = Math.abs(gaps.endL - gaps.startR)
          if (before > tol && after > tol) check = 'gap'
        }
        if (!check) continue

        failed.add(L.key)
        if (P && failed.has(P.L.key)) continue // the row is already reported once

        const anchor = P ? P.L.selector : 'the container start'
        const delta = Math.min(Math.abs(gaps.startL - gaps.endR), Math.abs(gaps.endL - gaps.startR))
        findings.push(
          ctx.finding({
            rule: ID,
            route: pair.route,
            selector: R.selector,
            el: R,
            boxes: { ltr: L.box, rtl: R.box },
            match: method,
            message:
              check === 'order'
                ? `Keeps its LTR order in RTL: it should sit to the left of ${anchor}.`
                : `Doesn't mirror in RTL. Gap after ${anchor}: ${round(gaps.startL)}px in LTR, ${round(gaps.endR)}px in RTL (tolerance ${round(tol)}px).`,
            evidence: {
              check,
              startL: round(gaps.startL),
              endR: round(gaps.endR),
              endL: round(gaps.endL),
              startR: round(gaps.startR),
              delta: round(delta),
              tol: round(tol),
              anchorSelector: P ? P.L.selector : 'container',
              containerSelector: CL.el?.selector ?? 'viewport',
            },
          }),
        )
      }
    }
    return findings
  },
})
