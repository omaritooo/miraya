import { describe, expect, it } from 'vitest'
import { resolveRules, runRules } from '../src/core/engine'
import { builtinRules } from '../src/rules'
import type { Box, ElementSnap, SnapshotPair } from '../src/types'
import { config, el, mirror, snapshot } from './helpers'

const W = 1000
const page = { x: 0, y: 0, w: W, h: 800 }

function audit(pair: SnapshotPair, only: string, input: Record<string, unknown> = {}) {
  const c = config(input)
  const rules = resolveRules(
    builtinRules.filter((r) => r.meta.id === only),
    c,
  )
  return runRules(pair, rules, c).findings
}

/**
 * Builds an LTR/RTL pair from element specs. Each child sits in `root` (the container)
 * with an LTR box and an RTL box; pairing is by key.
 */
function layout(
  children: { key: string; ltr: Box; rtl: Box; extra?: Partial<ElementSnap> }[],
  rootExtra: Partial<ElementSnap> = {},
): SnapshotPair {
  const side = (dir: 'ltr' | 'rtl') => {
    const style = { ...el({ box: page }).style, direction: dir }
    return snapshot(dir, [
      el({ key: 'html', tag: 'html', box: page, style }),
      el({ key: 'body', tag: 'body', parentKey: 'html', box: page, style }),
      el({ key: 'root', parentKey: 'body', box: page, ...rootExtra }),
      ...children.map((c) =>
        el({
          key: c.key,
          selector: `[data-testid="${c.key}"]`,
          testId: c.key,
          parentKey: 'root',
          containerKey: 'root',
          box: c[dir],
          ...c.extra,
        }),
      ),
    ])
  }
  const keys = ['html', 'body', 'root', ...children.map((c) => c.key)]
  return {
    route: '/',
    ltr: side('ltr'),
    rtl: side('rtl'),
    matches: keys.map((k) => ({ ltr: k, rtl: k, method: 'testid' as const })),
    unmatched: { ltr: [], rtl: [] },
  }
}

describe('not-mirrored', () => {
  it('flags a sidebar that stays on the left', () => {
    const sidebar = { x: 0, y: 0, w: 200, h: 800 }
    const findings = audit(layout([{ key: 'sidebar', ltr: sidebar, rtl: sidebar }]), 'not-mirrored')
    expect(findings).toMatchObject([
      { selector: '[data-testid="sidebar"]', severity: 'error', evidence: { check: 'gap' } },
    ])
  })

  it('accepts a mirrored sidebar', () => {
    const sidebar = { x: 0, y: 0, w: 200, h: 800 }
    expect(
      audit(layout([{ key: 'sidebar', ltr: sidebar, rtl: mirror(sidebar) }]), 'not-mirrored'),
    ).toEqual([])
  })

  it('accepts a mirrored nav row whose links change width with the language', () => {
    // LTR: [Home 60][Products 90][About 60] from x=40 with 16px gaps.
    // RTL: the same links, mirrored, but "المنتجات" is 70px wide.
    const pair = layout([
      { key: 'home', ltr: { x: 40, y: 0, w: 60, h: 20 }, rtl: { x: 900, y: 0, w: 60, h: 20 } },
      { key: 'products', ltr: { x: 116, y: 0, w: 90, h: 20 }, rtl: { x: 814, y: 0, w: 70, h: 20 } },
      { key: 'about', ltr: { x: 222, y: 0, w: 60, h: 20 }, rtl: { x: 738, y: 0, w: 60, h: 20 } },
    ])
    expect(audit(pair, 'not-mirrored')).toEqual([])
  })

  it('reports a row that keeps LTR order once, on its first item', () => {
    const items = [
      { key: 'a', ltr: { x: 40, y: 0, w: 60, h: 20 } },
      { key: 'b', ltr: { x: 116, y: 0, w: 60, h: 20 } },
      { key: 'c', ltr: { x: 192, y: 0, w: 60, h: 20 } },
    ].map((i) => ({ ...i, rtl: i.ltr }))
    const findings = audit(layout(items), 'not-mirrored')
    expect(findings.map((f) => f.selector)).toEqual(['[data-testid="a"]'])
  })

  it('accepts an item pushed to the end with margin-inline-start: auto', () => {
    // Logo at the start, user menu at the end; text widths differ between languages.
    const pair = layout([
      { key: 'logo', ltr: { x: 40, y: 0, w: 100, h: 30 }, rtl: { x: 860, y: 0, w: 100, h: 30 } },
      { key: 'menu', ltr: { x: 840, y: 0, w: 120, h: 30 }, rtl: { x: 40, y: 0, w: 95, h: 30 } },
    ])
    expect(audit(pair, 'not-mirrored')).toEqual([])
  })

  it('uses only the order check in space-between rows', () => {
    const pair = layout(
      [
        { key: 'a', ltr: { x: 0, y: 0, w: 100, h: 20 }, rtl: { x: 920, y: 0, w: 80, h: 20 } },
        { key: 'b', ltr: { x: 430, y: 0, w: 120, h: 20 }, rtl: { x: 455, y: 0, w: 90, h: 20 } },
        { key: 'c', ltr: { x: 900, y: 0, w: 100, h: 20 }, rtl: { x: 0, y: 0, w: 110, h: 20 } },
      ],
      { style: { ...el({ box: page }).style, display: 'flex', justifyContent: 'space-between' } },
    )
    expect(audit(pair, 'not-mirrored')).toEqual([])
  })

  it('skips centred, ignored and explicit-direction elements', () => {
    const modal = { x: 300, y: 100, w: 400, h: 300 }
    const pinned = { x: 880, y: 700, w: 80, h: 80 }
    const code = { x: 40, y: 400, w: 300, h: 40 }
    const pair = layout([
      { key: 'modal', ltr: modal, rtl: modal },
      {
        key: 'chat',
        ltr: pinned,
        rtl: pinned,
        extra: { ignore: { 'not-mirrored': 'brand rule: chat stays bottom-right' } },
      },
      { key: 'snippet', ltr: code, rtl: code, extra: { explicitDir: 'ltr' } },
    ])
    expect(audit(pair, 'not-mirrored')).toEqual([])
  })
})

describe('untranslated-text', () => {
  const text = (value: string) => ({
    value,
    arabic: 0,
    latin: value.replace(/[^a-z]/gi, '').length,
    digits: { arabicIndic: 0, western: 0 },
  })
  const rtlOnly = (elements: ElementSnap[]): SnapshotPair => {
    const style = { ...el({ box: page }).style, direction: 'rtl' as const }
    return {
      route: '/',
      rtl: snapshot('rtl', [el({ key: 'body', tag: 'body', box: page, style }), ...elements]),
      matches: [],
      unmatched: { ltr: [], rtl: [] },
    }
  }
  const box = { x: 0, y: 0, w: 100, h: 20 }

  it('reports repeated English strings once, with a count', () => {
    const findings = audit(
      rtlOnly([
        el({ key: 'b1', selector: '#b1', text: text('Add to cart'), box }),
        el({ key: 'b2', selector: '#b2', text: text('Add to cart'), box }),
        el({ key: 'p', selector: '#p', text: text('Free shipping on all orders'), box }),
      ]),
      'untranslated-text',
    )
    expect(findings.map((f) => [f.selector, f.evidence.count])).toEqual([
      ['#b1', 2],
      ['#p', 1],
    ])
  })

  it('skips brands, code, URLs, single words and LTR islands', () => {
    const findings = audit(
      rtlOnly([
        el({ key: 'brand', text: text('Miraya Visa'), box }),
        el({ key: 'pre', tag: 'pre', box }),
        el({ key: 'code', parentKey: 'pre', text: text('npm install miraya'), box }),
        el({ key: 'url', text: text('https://example.com/docs'), box }),
        el({ key: 'one', text: text('Visa'), box }),
        el({ key: 'island', explicitDir: 'ltr', text: text('Model X Pro'), box }),
      ]),
      'untranslated-text',
      { allow: { latinText: ['Miraya', 'Visa'] } },
    )
    expect(findings).toEqual([])
  })
})

describe('document-direction', () => {
  it('reports a missing dir and a wrong lang as separate findings', () => {
    const style = { ...el({ box: page }).style }
    const pair: SnapshotPair = {
      route: '/',
      rtl: snapshot('ltr', [el({ key: 'html', tag: 'html', box: page, style })], { lang: 'en' }),
      matches: [],
      unmatched: { ltr: [], rtl: [] },
    }
    const findings = audit(pair, 'document-direction')
    expect(findings.map((f) => f.evidence.attr).sort()).toEqual(['dir', 'lang'])
  })

  it('accepts a regional Arabic tag', () => {
    const pair: SnapshotPair = {
      route: '/',
      rtl: snapshot('rtl', [], { lang: 'ar-EG' }),
      matches: [],
      unmatched: { ltr: [], rtl: [] },
    }
    expect(audit(pair, 'document-direction')).toEqual([])
  })
})

describe('not-mirrored on inline text runs', () => {
  it('skips an inline link inside a sentence', () => {
    const sentence = { arabic: 0, latin: 20, digits: { arabicIndic: 0, western: 0 } }
    const link = { x: 600, y: 0, w: 60, h: 20 }
    const pair = layout(
      [
        {
          key: 'link',
          ltr: link,
          rtl: link,
          extra: { style: { ...el({ box: link }).style, display: 'inline' } },
        },
      ],
      { text: sentence },
    )
    expect(audit(pair, 'not-mirrored')).toEqual([])
  })
})
