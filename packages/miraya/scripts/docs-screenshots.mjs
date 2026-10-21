// Captures the RTL render of each rule's bad and good fixture pages for docs/rules.
// Usage: start the fixture site on port 4317, then `node scripts/docs-screenshots.mjs`.
import { existsSync, mkdirSync } from 'node:fs'
import { chromium } from '@playwright/test'

const base = 'http://localhost:4317'
const out = new URL('../../../docs/rules/img/', import.meta.url)
mkdirSync(out, { recursive: true })
const rules = [
  ['not-mirrored', 'good'],
  ['icon-direction', 'good'],
  ['fallback-font', 'adversarial'],
  ['arabic-letter-spacing', 'adversarial'],
  ['clipped-text', 'good'],
  ['untranslated-text', 'good'],
  ['ltr-inputs', 'good'],
  ['mixed-digits', 'adversarial'],
  ['document-direction', 'good'],
]
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1000, height: 360 }, deviceScaleFactor: 2 })
for (const [rule, good] of rules) {
  for (const [label, variant] of [
    ['before', 'bad'],
    ['after', good],
  ]) {
    const response = await page.goto(`${base}/ar/${rule}/${variant}/`)
    if (!response?.ok()) throw new Error(`${rule}/${variant}: HTTP ${response?.status()}`)
    await page.evaluate('document.fonts.ready')
    // Full page: on an RTL page that overflows to the left, Playwright's element and
    // viewport screenshots both miss content, but the full-page capture includes it.
    await page.screenshot({ path: new URL(`${rule}-${label}.png`, out).pathname, fullPage: true })
  }
}
await browser.close()
console.log(
  `Wrote ${rules.length * 2} screenshots to ${out.pathname}${existsSync(out) ? '' : ' (missing!)'}`,
)
