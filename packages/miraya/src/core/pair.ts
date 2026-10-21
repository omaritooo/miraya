import type { Box, ElementSnap, MatchMethod, Snapshot, SnapshotPair } from '../types'

export type PairingStats = {
  testid: number
  path: number
  heuristic: number
  pathRejected: number
  unmatched: { ltr: number; rtl: number }
}

function hasText(el: ElementSnap) {
  const t = el.text
  return !!t && t.arabic + t.latin + t.digits.arabicIndic + t.digits.western > 0
}

function namesAgree(a: number | undefined, b: number | undefined) {
  const x = a ?? 0
  const y = b ?? 0
  if (x === 0 && y === 0) return true
  return Math.abs(x - y) <= 0.5 * Math.max(x, y)
}

/**
 * A path match is accepted only when the two elements look like the same element.
 * A locale-only sibling with the same tag shifts every nth-of-type after it, and
 * the shifted paths are still unique (DESIGN.md › How do we pair elements across renders?).
 */
export function consistent(r: ElementSnap, l: ElementSnap): boolean {
  if (r.tag !== l.tag || r.role !== l.role) return false
  if (hasText(r) !== hasText(l)) return false
  if (!namesAgree(r.nameLength, l.nameLength)) return false
  if ((r.icon || l.icon) && r.icon?.name !== l.icon?.name) return false
  return true
}

/** Groups elements by a key, keeping only keys that occur exactly once. */
function uniqueBy(elements: ElementSnap[], keyOf: (el: ElementSnap) => string | undefined) {
  const seen = new Map<string, ElementSnap | null>()
  for (const el of elements) {
    const key = keyOf(el)
    if (key === undefined) continue
    seen.set(key, seen.has(key) ? null : el)
  }
  return seen
}

const HEURISTIC_MAX_SCORE = 0.1

/**
 * Distance between L and R reflected inside its container, normalised by container
 * size. A correctly mirrored element scores close to 0 (DESIGN.md › section 5).
 */
export function mirrorScore(l: Box, cL: Box, r: Box, cR: Box): number {
  const mirroredX = cR.x + cR.w - (r.x - cR.x) - r.w
  const dx = (mirroredX - cR.x) / Math.max(cR.w, 1) - (l.x - cL.x) / Math.max(cL.w, 1)
  const dy = (r.y - cR.y - (l.y - cL.y)) / Math.max(cL.h, 1)
  return Math.hypot(dx, dy)
}

/**
 * Pairs each RTL element with its LTR twin: test id, then structural path, then an
 * unambiguous role-and-position heuristic. Anything left over stays unmatched and is
 * counted, never guessed.
 */
export function pairSnapshots(
  route: string,
  ltr: Snapshot,
  rtl: Snapshot,
): { pair: SnapshotPair; stats: PairingStats } {
  const matches: SnapshotPair['matches'] = []
  const matchedL = new Set<string>()
  const matchedR = new Set<string>()
  const stats: PairingStats = {
    testid: 0,
    path: 0,
    heuristic: 0,
    pathRejected: 0,
    unmatched: { ltr: 0, rtl: 0 },
  }
  const match = (r: ElementSnap, l: ElementSnap, method: MatchMethod) => {
    matches.push({ ltr: l.key, rtl: r.key, method })
    matchedL.add(l.key)
    matchedR.add(r.key)
    stats[method]++
  }

  const ltrByTestId = uniqueBy(ltr.elements, (el) => el.testId)
  const rtlByTestId = uniqueBy(rtl.elements, (el) => el.testId)
  for (const [testId, r] of rtlByTestId) {
    const l = ltrByTestId.get(testId)
    if (r && l) match(r, l, 'testid')
  }

  const unmatchedL = ltr.elements.filter((el) => !matchedL.has(el.key))
  const ltrByPath = uniqueBy(unmatchedL, (el) => el.path)
  const rtlByPath = uniqueBy(
    rtl.elements.filter((el) => !matchedR.has(el.key)),
    (el) => el.path,
  )
  for (const [path, r] of rtlByPath) {
    const l = ltrByPath.get(path)
    if (!r || !l) continue
    if (consistent(r, l)) match(r, l, 'path')
    else stats.pathRejected++
  }

  // Pass 3: only within container pairs that are already matched, so k stays small and
  // every heuristic match is local. The runner-up must be at least twice as far.
  const ltrByKey = new Map(ltr.elements.map((el) => [el.key, el]))
  const rtlByKey = new Map(rtl.elements.map((el) => [el.key, el]))
  const ltrOfRtl = new Map(matches.map((m) => [m.rtl, m.ltr]))
  const viewport = (s: Snapshot): Box => ({ x: 0, y: 0, w: s.docWidth.client, h: s.viewport.h })
  const containerBox = (key: string | undefined, s: Snapshot, byKey: Map<string, ElementSnap>) =>
    key === 'viewport' ? viewport(s) : key ? byKey.get(key)?.box : undefined
  const candidatesByContainer = new Map<string, ElementSnap[]>()
  for (const l of ltr.elements) {
    if (matchedL.has(l.key) || !l.containerKey) continue
    const list = candidatesByContainer.get(l.containerKey) ?? []
    list.push(l)
    candidatesByContainer.set(l.containerKey, list)
  }
  for (const r of rtl.elements) {
    if (matchedR.has(r.key) || !r.containerKey) continue
    const cLKey = r.containerKey === 'viewport' ? 'viewport' : ltrOfRtl.get(r.containerKey)
    const cR = containerBox(r.containerKey, rtl, rtlByKey)
    const cL = containerBox(cLKey, ltr, ltrByKey)
    if (!cLKey || !cR || !cL) continue
    const scored = (candidatesByContainer.get(cLKey) ?? [])
      .filter(
        (l) =>
          !matchedL.has(l.key) &&
          l.tag === r.tag &&
          l.role === r.role &&
          Math.abs(l.depth - r.depth) <= 1 &&
          namesAgree(l.nameLength, r.nameLength),
      )
      .map((l) => ({ l, score: mirrorScore(l.box, cL, r.box, cR) }))
      .sort((a, b) => a.score - b.score)
    const [best, second] = scored
    if (best && best.score < HEURISTIC_MAX_SCORE && (!second || second.score >= 2 * best.score)) {
      match(r, best.l, 'heuristic')
    }
  }

  const unmatched = {
    ltr: ltr.elements.filter((el) => !matchedL.has(el.key)).map((el) => el.key),
    rtl: rtl.elements.filter((el) => !matchedR.has(el.key)).map((el) => el.key),
  }
  stats.unmatched = { ltr: unmatched.ltr.length, rtl: unmatched.rtl.length }
  return { pair: { route, ltr, rtl, matches, unmatched }, stats }
}
