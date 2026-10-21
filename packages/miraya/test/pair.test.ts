import { describe, expect, it } from 'vitest'
import { consistent, pairSnapshots } from '../src/core/pair'
import { el, snapshot } from './helpers'

const box = { x: 0, y: 0, w: 100, h: 20 }

describe('pairSnapshots', () => {
  it('pairs by test id first, then by path', () => {
    const ltr = snapshot('ltr', [
      el({ key: 'a', testId: 'nav', path: '[nav]', box }),
      el({ key: 'b', path: '#main>p:1', box }),
    ])
    const rtl = snapshot('rtl', [
      el({ key: 'x', testId: 'nav', path: '[nav]', box }),
      el({ key: 'y', path: '#main>p:1', box }),
    ])
    const { pair, stats } = pairSnapshots('/', ltr, rtl)
    expect(pair.matches).toEqual([
      { ltr: 'a', rtl: 'x', method: 'testid' },
      { ltr: 'b', rtl: 'y', method: 'path' },
    ])
    expect(stats).toMatchObject({ testid: 1, path: 1, unmatched: { ltr: 0, rtl: 0 } })
  })

  it('leaves duplicate test ids for the path pass', () => {
    const ltr = snapshot('ltr', [
      el({ key: 'a', testId: 'item', path: '#list>li:1', role: 'listitem', box }),
      el({ key: 'b', testId: 'item', path: '#list>li:2', role: 'listitem', box }),
    ])
    const rtl = snapshot('rtl', [
      el({ key: 'x', testId: 'item', path: '#list>li:1', role: 'listitem', box }),
      el({ key: 'y', testId: 'item', path: '#list>li:2', role: 'listitem', box }),
    ])
    const { stats } = pairSnapshots('/', ltr, rtl)
    expect(stats).toMatchObject({ testid: 0, path: 2 })
  })

  it('rejects a path shifted by a locale-only sibling with the same tag', () => {
    // RTL has an extra promo <div> first, so the heading's wrapper div:2 in LTR is div:3 in RTL,
    // and RTL's div:2 is the promo: same path, different element.
    const ltr = snapshot('ltr', [
      el({ key: 'a', path: 'body:1>div:2', role: 'navigation', nameLength: 5, box }),
    ])
    const rtl = snapshot('rtl', [
      el({
        key: 'x',
        path: 'body:1>div:2',
        text: { arabic: 12, latin: 0, digits: { arabicIndic: 0, western: 0 } },
        box,
      }),
      el({ key: 'y', path: 'body:1>div:3', role: 'navigation', nameLength: 6, box }),
    ])
    const { pair, stats } = pairSnapshots('/', ltr, rtl)
    expect(pair.matches).toEqual([])
    expect(stats.pathRejected).toBe(1)
    expect(stats.unmatched).toEqual({ ltr: 1, rtl: 2 })
  })
})

describe('consistent', () => {
  it('accepts translated text of a different length', () => {
    expect(
      consistent(
        el({ role: 'button', nameLength: 8, box }),
        el({ role: 'button', nameLength: 6, box }),
      ),
    ).toBe(true)
  })

  it('rejects a different role or a very different name length', () => {
    expect(consistent(el({ role: 'button', box }), el({ role: 'link', box }))).toBe(false)
    expect(
      consistent(
        el({ role: 'button', nameLength: 30, box }),
        el({ role: 'button', nameLength: 4, box }),
      ),
    ).toBe(false)
  })
})

describe('heuristic pairing', () => {
  const page = { x: 0, y: 0, w: 1000, h: 800 }
  const root = (key: string) => el({ key, testId: 'root', path: '[root]', box: page })
  // Children without test ids, whose paths differ between locales.
  const child = (key: string, path: string, box: { x: number; y: number; w: number; h: number }) =>
    el({
      key,
      path,
      tag: 'button',
      role: 'button',
      nameLength: 6,
      containerKey: key.startsWith('l') ? 'lr' : 'rr',
      box,
    })

  it('matches an element by its mirrored position when that is unambiguous', () => {
    const ltr = snapshot('ltr', [
      root('lr'),
      child('l1', '#x>button:1', { x: 40, y: 10, w: 100, h: 30 }),
    ])
    const rtl = snapshot('rtl', [
      root('rr'),
      child('r1', '#x>button:2', { x: 860, y: 10, w: 100, h: 30 }),
    ])
    const { pair, stats } = pairSnapshots('/', ltr, rtl)
    expect(pair.matches).toContainEqual({ ltr: 'l1', rtl: 'r1', method: 'heuristic' })
    expect(stats.heuristic).toBe(1)
  })

  it('leaves an element unmatched when two candidates are about as close', () => {
    const ltr = snapshot('ltr', [
      root('lr'),
      child('l1', '#x>button:1', { x: 40, y: 10, w: 100, h: 30 }),
      child('l2', '#x>button:2', { x: 50, y: 10, w: 100, h: 30 }),
    ])
    const rtl = snapshot('rtl', [
      root('rr'),
      child('r1', '#x>button:3', { x: 855, y: 10, w: 100, h: 30 }),
    ])
    const { stats } = pairSnapshots('/', ltr, rtl)
    expect(stats.heuristic).toBe(0)
    expect(stats.unmatched.rtl).toBe(1)
  })

  it('does not match an element that failed to mirror', () => {
    // Same physical position in both renders: far from its mirrored spot.
    const ltr = snapshot('ltr', [
      root('lr'),
      child('l1', '#x>button:1', { x: 40, y: 10, w: 100, h: 30 }),
    ])
    const rtl = snapshot('rtl', [
      root('rr'),
      child('r1', '#x>button:2', { x: 40, y: 10, w: 100, h: 30 }),
    ])
    expect(pairSnapshots('/', ltr, rtl).stats.heuristic).toBe(0)
  })
})
