import { describe, expect, it } from 'vitest'
import { resolveRules, runRules } from '../src/core/engine'
import { builtinRules } from '../src/rules'
import { displayedAs } from '../src/rules/bidi'
import type { ElementSnap, SnapshotPair } from '../src/types'
import { config, el, snapshot } from './helpers'

const shown = (text: string, match: string) => {
  const start = [...text.slice(0, text.indexOf(match))].length
  return displayedAs(text, start, start + [...match].length)
}

describe('bidi resolver', () => {
  it('reverses space-separated phone groups and moves a leading +', () => {
    expect(shown('اتصل بنا على +20 100 123 4567 اليوم', '+20 100 123 4567')).toBe(
      '4567 123 100 20+',
    )
  })

  it('reverses dashed numbers after Arabic text: the digits become Arabic numbers (W2)', () => {
    expect(shown('هاتف 0100-123-4567 الآن', '0100-123-4567')).toBe('4567-123-0100')
  })

  it('keeps dates, emails and a Latin currency with its number in order', () => {
    expect(shown('التاريخ 26/09/2026', '26/09/2026')).toBe('26/09/2026')
    expect(shown('راسلنا على help@miraya.dev', 'help@miraya.dev')).toBe('help@miraya.dev')
    expect(shown('السعر USD 450 فقط', 'USD 450')).toBe('USD 450')
  })

  it('shows a percent sign on the left, which is correct Arabic typography', () => {
    expect(shown('الخصم 25% اليوم', '25%')).toBe('%25')
  })

  it('moves a trailing slash to the start of a URL', () => {
    expect(shown('زر موقعنا miraya.dev/', 'miraya.dev/')).toBe('/miraya.dev')
  })
})

describe('bidi-isolation', () => {
  const page = { x: 0, y: 0, w: 1000, h: 800 }
  const rtl = { ...el({ box: page }).style, direction: 'rtl' as const }
  const text = (value: string, arabic = 5) => ({
    value,
    arabic,
    latin: 3,
    digits: { arabicIndic: 0, western: 4 },
  })
  const body = el({ key: 'body', tag: 'body', box: page, style: rtl })
  const pairOf = (elements: ElementSnap[]): SnapshotPair => ({
    route: '/',
    rtl: snapshot('rtl', [body, ...elements]),
    matches: [],
    unmatched: { ltr: [], rtl: [] },
  })
  const run = (
    elements: ElementSnap[],
    input: Record<string, unknown> = { experimental: ['bidi-isolation'] },
  ) => {
    const c = config(input)
    return runRules(pairOf(elements), resolveRules(builtinRules, c), c).findings.filter(
      (f) => f.rule === 'bidi-isolation',
    )
  }

  it('reports a phone number that displays reversed, with what the user sees', () => {
    const [f] = run([
      el({ key: 'p', box: page, style: rtl, text: text('اتصل بنا على +20 100 123 4567 اليوم') }),
    ])
    expect(f?.evidence).toMatchObject({ kind: 'phone', displayed: '4567 123 100 20+' })
  })

  it('is silent when the text is isolated or displays acceptably', () => {
    expect(
      run([
        el({
          box: page,
          style: { ...rtl, direction: 'ltr' },
          explicitDir: 'ltr',
          text: text('+20 100 123 4567'),
        }),
      ]),
    ).toEqual([])
    expect(
      run([
        el({
          box: page,
          style: { ...rtl, unicodeBidi: 'plaintext' },
          text: text('اتصل +20 100 123 4567'),
        }),
      ]),
    ).toEqual([])
    expect(
      run([
        el({ box: page, style: rtl, text: text('التاريخ 26/09/2026 والخصم 25% والسعر USD 450') }),
      ]),
    ).toEqual([])
  })

  it("doesn't treat a block's default isolation as a fix", () => {
    const p = el({
      box: page,
      tag: 'p',
      style: { ...rtl, unicodeBidi: 'isolate' },
      text: text('اتصل +20 100 123 4567'),
    })
    expect(run([p])).toHaveLength(1)
  })

  it('leaves all-Latin elements to untranslated-text', () => {
    expect(run([el({ box: page, style: rtl, text: text('Don’t have an account?', 0) })])).toEqual(
      [],
    )
  })

  it('is experimental: off unless opted in', () => {
    const phone = el({ box: page, style: rtl, text: text('اتصل +20 100 123 4567') })
    expect(run([phone], {})).toEqual([])
    expect(run([phone])).toHaveLength(1)
  })
})
