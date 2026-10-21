import { chromium, type Browser } from '@playwright/test'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { visualOrder, rtlLevels } from '../../src/rules/bidi'

// Checks the pure bidi resolver against Chromium: each string is rendered in an RTL
// paragraph, and the on-screen order of its characters is read from their boxes.
const CASES = [
  'اتصل بنا على +20 100 123 4567 اليوم',
  'اتصل على 0100 123 4567',
  'زر موقعنا miraya.dev/',
  'السعر USD 450 فقط',
  'السعر 450 ج.م فقط',
  'الخصم 25% اليوم',
  'التاريخ 26/09/2026',
  'راسلنا على help@miraya.dev',
  'جهاز Apple Watch Series 9 جديد',
  'الرقم +201001234567',
  'من 10 إلى 20 كجم',
  '(Apple Watch) جديد',
  'Don’t have an account?',
  '٣ منتجات بسعر ٤٥٠',
  'هاتف: 0100-123-4567.',
  'السعر $450 فقط',
  'الإصدار 2.5.1 متاح',
]

let browser: Browser
beforeAll(async () => {
  browser = await chromium.launch()
})
afterAll(() => browser?.close())

describe('bidi resolver matches Chromium', () => {
  for (const text of CASES) {
    it(text, async () => {
      const page = await browser.newPage()
      try {
        await page.setContent('<p dir="rtl" style="font: 20px sans-serif; white-space: pre"></p>')
        const chromiumOrder = await page.evaluate((value) => {
          const p = document.querySelector('p') as HTMLParagraphElement
          p.textContent = value
          const node = p.firstChild as Text
          const xs: { i: number; x: number }[] = []
          let offset = 0
          for (const [i, ch] of [...value].entries()) {
            const range = document.createRange()
            range.setStart(node, offset)
            range.setEnd(node, offset + ch.length)
            const r = range.getBoundingClientRect()
            xs.push({ i, x: r.left + r.width / 2 })
            offset += ch.length
          }
          return xs.sort((a, b) => a.x - b.x).map((c) => c.i)
        }, text)
        expect(visualOrder(rtlLevels(text))).toEqual(chromiumOrder)
      } finally {
        await page.close()
      }
    })
  }
})
