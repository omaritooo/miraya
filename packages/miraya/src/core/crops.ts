import { readFileSync } from 'node:fs'
import { PNG } from 'pngjs'
import type { RGBAImage, Rule, Snapshot } from '../types'

/**
 * Where a full-page screenshot sits in document coordinates. An RTL document that
 * overflows to the left scrolls into negative x, and Chromium's full-page capture
 * starts at the left edge of that overflow: with 150px of overflow, image x = 0 is
 * document x = -150 (measured 2026-10-21). LTR documents overflow to the right, so
 * their screenshots start at 0.
 */
export function screenshotFrame(snapshot: Snapshot): { x: number; w: number } {
  const root = snapshot.elements.find((el) => el.tag === 'html')
  const rtl = (root?.style.direction ?? snapshot.dir) === 'rtl'
  const overflow = Math.max(0, snapshot.docWidth.scroll - snapshot.docWidth.client)
  return { x: rtl ? -overflow : 0, w: snapshot.docWidth.client + overflow }
}

const PADDING = 2

export type CropCache = Map<string, RGBAImage>

/**
 * Decodes a full-page screenshot once and cuts out every element any enabled rule
 * asked for through meta.needsCrop (DESIGN.md › How do screenshots reach rules that
 * must stay pure?). Boxes outside the captured area, such as below a truncated
 * screenshot, get no crop, so ctx.crop returns null for them.
 */
export function buildCrops(
  pngPath: string,
  snapshot: Snapshot,
  rules: Rule<unknown>[],
  deviceScaleFactor: number,
): CropCache {
  const crops: CropCache = new Map()
  const wanted = rules.flatMap((r) => (r.meta.needsCrop ? [r.meta.needsCrop] : []))
  const targets = snapshot.elements.filter((el) => wanted.some((needs) => needs(el)))
  const origin = screenshotFrame(snapshot).x
  if (targets.length === 0) return crops

  const png = PNG.sync.read(readFileSync(pngPath))
  for (const el of targets) {
    const x0 = Math.floor((el.box.x - origin - PADDING) * deviceScaleFactor)
    const y0 = Math.floor((el.box.y - PADDING) * deviceScaleFactor)
    const x1 = Math.ceil((el.box.x - origin + el.box.w + PADDING) * deviceScaleFactor)
    const y1 = Math.ceil((el.box.y + el.box.h + PADDING) * deviceScaleFactor)
    if (x0 < 0 || y0 < 0 || x1 > png.width || y1 > png.height || x1 <= x0 || y1 <= y0) continue
    const width = x1 - x0
    const height = y1 - y0
    const data = new Uint8Array(width * height * 4)
    for (let row = 0; row < height; row++) {
      const from = ((y0 + row) * png.width + x0) * 4
      data.set(png.data.subarray(from, from + width * 4), row * width * 4)
    }
    crops.set(el.key, { width, height, data })
  }
  return crops
}
