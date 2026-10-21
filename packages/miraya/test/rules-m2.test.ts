import { describe, expect, it } from 'vitest'
import { resolveRules, runRules } from '../src/core/engine'
import { builtinRules } from '../src/rules'
import type { ElementSnap, RGBAImage, SnapshotPair } from '../src/types'
import { config, el, snapshot } from './helpers'

const page = { x: 0, y: 0, w: 1000, h: 800 }
const box = { x: 0, y: 0, w: 200, h: 30 }
const base = el({ box }).style
const arabic = (n = 10, extra: Partial<NonNullable<ElementSnap['text']>> = {}) => ({
  arabic: n,
  latin: 0,
  digits: { arabicIndic: 0, western: 0 },
  ...extra,
})
const body = el({ key: 'body', tag: 'body', box: page, style: { ...base, direction: 'rtl' } })

function rtlPair(elements: ElementSnap[], ltrElements?: ElementSnap[]): SnapshotPair {
  return {
    route: '/',
    ...(ltrElements ? { ltr: snapshot('ltr', [body, ...ltrElements]) } : {}),
    rtl: snapshot('rtl', [body, ...elements]),
    matches: ltrElements
      ? ltrElements.map((l, i) => ({
          ltr: l.key,
          rtl: elements[i]?.key ?? '',
          method: 'testid' as const,
        }))
      : [],
    unmatched: { ltr: [], rtl: [] },
  }
}

function run(only: string, pair: SnapshotPair, input: Record<string, unknown> = {}, crops = {}) {
  const c = config(input)
  return runRules(
    pair,
    resolveRules(
      builtinRules.filter((r) => r.meta.id === only),
      c,
    ),
    c,
    crops,
  ).findings
}

describe('arabic-letter-spacing', () => {
  it('reports a textless wrapper where the spacing starts, once', () => {
    const style = { ...base, letterSpacing: '1.6px' }
    const findings = run(
      'arabic-letter-spacing',
      rtlPair([
        el({ key: 'hero', selector: '#hero', box, style }),
        el({ key: 'h2', parentKey: 'hero', box, style, text: arabic() }),
        el({ key: 'p', parentKey: 'hero', box, style, text: arabic() }),
      ]),
    )
    expect(findings.map((f) => f.selector)).toEqual(['#hero'])
  })

  it('ignores spacing on Latin text', () => {
    const style = { ...base, letterSpacing: '2px' }
    const latin = { arabic: 0, latin: 3, digits: { arabicIndic: 0, western: 0 } }
    expect(run('arabic-letter-spacing', rtlPair([el({ box, style, text: latin })]))).toEqual([])
  })
})

describe('clipped-text', () => {
  const clipped = { ...base, overflowY: 'hidden', fontSize: 24 }

  it('reports Arabic ink taller than its box', () => {
    const tight = el({
      key: 't',
      box,
      style: clipped,
      scroll: { sw: 0, cw: 0, sh: 23, ch: 18 },
      text: arabic(10, { inkHeight: 29.1 }),
    })
    expect(run('clipped-text', rtlPair([tight]))[0]?.evidence).toMatchObject({
      axis: 'y',
      check: 'ink',
    })
  })

  it('skips the ink check on truncated text, whose measurement includes hidden glyphs', () => {
    // Measured on Linux CI: 26px of ink in a 24px ellipsis box, nothing visibly clipped.
    const truncated = el({
      box,
      style: { ...clipped, textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
      scroll: { sw: 509, cw: 240, sh: 24, ch: 24 },
      text: arabic(10, { inkHeight: 26 }),
    })
    expect(run('clipped-text', rtlPair([truncated]))).toEqual([])
  })

  it('ignores content-area overflow that cuts no ink', () => {
    const fits = el({
      box,
      style: clipped,
      scroll: { sw: 0, cw: 0, sh: 23, ch: 18 },
      text: arabic(10, { inkHeight: 16 }),
    })
    expect(run('clipped-text', rtlPair([fits]))).toEqual([])
  })

  it('ignores horizontal overflow that also happens in LTR, and intentional ellipsis', () => {
    const wide = { sw: 300, cw: 100, sh: 0, ch: 0 }
    const r = el({ key: 'r', box, scroll: wide, text: arabic() })
    const l = el({
      key: 'l',
      box,
      scroll: wide,
      text: { arabic: 0, latin: 9, digits: { arabicIndic: 0, western: 0 } },
    })
    expect(run('clipped-text', rtlPair([r], [l]))).toEqual([])
    const ellipsis = el({
      box,
      scroll: wide,
      style: { ...base, textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
      text: arabic(),
    })
    expect(run('clipped-text', rtlPair([ellipsis]))).toEqual([])
  })
})

describe('ltr-inputs', () => {
  const input = (partial: Partial<ElementSnap>) =>
    el({ box, style: { ...base, direction: 'rtl' }, ...partial })

  it('reports email, URL and one-time-code inputs typed right-to-left', () => {
    const findings = run(
      'ltr-inputs',
      rtlPair([
        input({ key: 'e', selector: '#e', input: { type: 'email' } }),
        input({ key: 'o', selector: '#o', input: { type: 'text', autocomplete: 'one-time-code' } }),
        input({ key: 'n', selector: '#n', input: { type: 'text', name: 'fullname' } }),
      ]),
    )
    expect(findings.map((f) => f.selector).sort()).toEqual(['#e', '#o'])
  })

  it('respects an explicit dir="rtl"', () => {
    expect(
      run('ltr-inputs', rtlPair([input({ explicitDir: 'rtl', input: { type: 'email' } })])),
    ).toEqual([])
  })
})

describe('mixed-digits', () => {
  const digits = (arabicIndic: number, western: number) =>
    arabic(4, { digits: { arabicIndic, western } })
  const elements = [
    el({ key: 'a', selector: '#a', box, text: digits(1, 0) }),
    el({ key: 'w', selector: '#w', box, text: digits(0, 3) }),
  ]

  it('reports one page-level finding without a preference', () => {
    expect(run('mixed-digits', rtlPair(elements)).map((f) => f.selector)).toEqual(['html'])
  })

  it('reports each element using the other system once a preference is set', () => {
    const findings = run('mixed-digits', rtlPair(elements), {
      rules: { 'mixed-digits': ['info', { prefer: 'western' }] },
    })
    expect(findings.map((f) => f.selector)).toEqual(['#a'])
  })
})

describe('fallback-font', () => {
  const sampled = (key: string, family: string, custom: boolean) =>
    el({
      key,
      selector: `#${key}`,
      box,
      style: { ...base, fontFamily: 'Inter' },
      text: arabic(),
      usedFonts: [{ family, custom, glyphs: 5 }],
    })

  it('reports a system fallback once per font stack, at info without configured fonts', () => {
    const findings = run(
      'fallback-font',
      rtlPair([sampled('a', 'Geeza Pro', false), sampled('b', 'Geeza Pro', false)]),
    )
    expect(findings).toHaveLength(1)
    expect(findings[0]).toMatchObject({ severity: 'info', evidence: { count: 2 } })
  })

  it('checks against configured fonts and ignores emoji', () => {
    const input = { fonts: { arabic: ['IBM Plex Sans Arabic'] } }
    expect(
      run('fallback-font', rtlPair([sampled('a', 'IBM Plex Sans Arabic Medium', true)]), input),
    ).toEqual([])
    expect(run('fallback-font', rtlPair([sampled('e', 'Apple Color Emoji', false)]))).toEqual([])
    expect(run('fallback-font', rtlPair([sampled('c', 'Cairo', true)]), input)[0]?.severity).toBe(
      'warn',
    )
  })
})

describe('icon-direction', () => {
  // A 12×12 "chevron": a diagonal stroke on white, which flipping changes.
  function chevron(flipped: boolean): RGBAImage {
    const size = 16
    const data = new Uint8Array(size * size * 4).fill(255)
    for (let i = 2; i < 14; i++) {
      const x = flipped ? 15 - i : i
      for (const y of [i, i + 1]) {
        if (y >= size) continue
        const o = (y * size + x) * 4
        data[o] = data[o + 1] = data[o + 2] = 0
      }
    }
    return { width: size, height: size, data }
  }
  const icon = (key: string, name: string) =>
    el({ key, selector: `#${key}`, box: { x: 0, y: 0, w: 16, h: 16 }, icon: { name } })
  const pairWith = (name: string) => rtlPair([icon('r', name)], [icon('l', name)])
  const crops = (rtlFlipped: boolean) => ({
    ltr: new Map([['l', chevron(false)]]),
    rtl: new Map([['r', chevron(rtlFlipped)]]),
  })

  it('reports a directional icon that did not flip, and accepts one that did', () => {
    expect(
      run('icon-direction', pairWith('chevron-left'), {}, crops(false))[0]?.evidence.verdict,
    ).toBe('not-flipped')
    expect(run('icon-direction', pairWith('chevron-left'), {}, crops(true))).toEqual([])
  })

  it('reports a never-flip icon that flipped, and treats log-out as directional', () => {
    expect(run('icon-direction', pairWith('play'), {}, crops(true))[0]?.evidence.verdict).toBe(
      'wrongly-flipped',
    )
    expect(run('icon-direction', pairWith('log-out'), {}, crops(false))[0]?.evidence.verdict).toBe(
      'not-flipped',
    )
  })

  it('skips icons without crops, such as below a truncated screenshot', () => {
    expect(run('icon-direction', pairWith('chevron-left'), {}, {})).toEqual([])
  })
})
