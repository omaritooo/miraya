import type { CDPSession, Page } from '@playwright/test'
import { COLLECTOR_SOURCE } from './generated/source'
import type { CollectorOptions, PageCollection } from './protocol'

export { DEFAULT_GENERATED_ID_PATTERNS } from './protocol'
export type { CollectorOptions, PageCollection } from './protocol'

export class CollectorError extends Error {
  override name = 'CollectorError'
}

const FONT_GROUP = 'miraya-fonts'

/**
 * Records the fonts Chromium actually used to draw each sampled element's text
 * (CSS.getPlatformFontsForNode). Node handles come from the same isolated world.
 * A failed lookup leaves the element without usedFonts; fallback-font then skips it.
 */
async function lookUpFonts(cdp: CDPSession, contextId: number, collection: PageCollection) {
  if (collection.fontSamples.length === 0) return
  await cdp.send('DOM.enable')
  await cdp.send('CSS.enable')
  await cdp.send('DOM.getDocument', { depth: 0 }) // required before requestNode returns ids
  try {
    for (const index of collection.fontSamples) {
      const el = collection.elements[index]
      if (!el) continue
      try {
        const { result } = await cdp.send('Runtime.evaluate', {
          expression: `__miraya.nodeAt(${index})`,
          contextId,
          objectGroup: FONT_GROUP,
        })
        if (!result.objectId) continue
        const { nodeId } = await cdp.send('DOM.requestNode', { objectId: result.objectId })
        const { fonts } = await cdp.send('CSS.getPlatformFontsForNode', { nodeId })
        el.usedFonts = fonts.map((f) => ({
          family: f.familyName,
          custom: f.isCustomFont,
          glyphs: f.glyphCount,
        }))
      } catch {
        // The node went away or has no text layout; skip it.
      }
    }
  } finally {
    await cdp.send('Runtime.releaseObjectGroup', { objectGroup: FONT_GROUP }).catch(() => {})
  }
}

/**
 * Runs the collector in a fresh CDP isolated world, so page scripts and polyfills
 * can't patch the DOM APIs it calls (ADR-010). Worlds die on navigation, so this
 * creates one per call, after the page has settled.
 */
export async function collectPage(page: Page, options: CollectorOptions): Promise<PageCollection> {
  let cdp
  try {
    cdp = await page.context().newCDPSession(page)
  } catch (error) {
    throw new CollectorError(`CDP is unavailable (Chromium only, ADR-001): ${String(error)}`)
  }
  try {
    const { frameTree } = await cdp.send('Page.getFrameTree')
    const { executionContextId } = await cdp.send('Page.createIsolatedWorld', {
      frameId: frameTree.frame.id,
      worldName: 'miraya',
      grantUniveralAccess: false, // sic, the CDP parameter is misspelled
    })
    const injected = await cdp.send('Runtime.evaluate', {
      expression: COLLECTOR_SOURCE,
      contextId: executionContextId,
    })
    if (injected.exceptionDetails) {
      throw new CollectorError(`Collector failed to load: ${injected.exceptionDetails.text}`)
    }
    const { result, exceptionDetails } = await cdp.send('Runtime.evaluate', {
      expression: `__miraya.collect(${JSON.stringify(options)})`,
      contextId: executionContextId,
      returnByValue: true,
      awaitPromise: true,
    })
    if (exceptionDetails) {
      const detail = exceptionDetails.exception?.description ?? exceptionDetails.text
      throw new CollectorError(`Collector threw: ${detail}`)
    }
    const collection = result.value as PageCollection
    await lookUpFonts(cdp, executionContextId, collection)
    return collection
  } finally {
    await cdp.detach().catch(() => {})
  }
}
