import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ConfigError, resolveRules, runRules } from '../src/core/engine'
import { loadTranslations } from '../src/core/translations'
import { builtinRules } from '../src/rules'
import type { SnapshotPair } from '../src/types'
import { config, el, snapshot } from './helpers'

function project(files: Record<string, unknown>) {
  const dir = mkdtempSync(join(tmpdir(), 'miraya-locales-'))
  for (const [path, data] of Object.entries(files)) {
    mkdirSync(join(dir, path, '..'), { recursive: true })
    writeFileSync(join(dir, path), typeof data === 'string' ? data : JSON.stringify(data))
  }
  return dir
}

const rel = (path: string) => {
  const r = relative(process.cwd(), path)
  return r.startsWith('..') ? path : r
}

describe('loadTranslations', () => {
  const dir = project({
    'en.json': {
      checkout: { pay: 'Pay now', total: 'Total: {amount}', items: '{{count}} items in your cart' },
      copied: 'Free shipping',
      done: 'Order placed',
      plural: '{count, plural, one {# item} other {# items}}',
    },
    'ar.json': {
      checkout: { total: 'المجموع: {amount}' },
      copied: 'Free shipping',
      done: 'تم الطلب',
    },
  })
  const t = loadTranslations(
    config({ locales: { ltr: join(dir, 'en.json'), rtl: join(dir, 'ar.json') } }),
  )

  it('is off without config.locales', () => {
    expect(loadTranslations(config())).toBeUndefined()
  })

  it('names the key and the Arabic file for a missing translation', () => {
    expect(t?.lookup('  Pay   NOW ')).toEqual({
      status: 'missing',
      key: 'checkout.pay',
      file: rel(join(dir, 'ar.json')),
    })
  })

  it('matches text rendered from a placeholder', () => {
    expect(t?.lookup('3 items in your cart')).toMatchObject({
      status: 'missing',
      key: 'checkout.items',
    })
    expect(t?.lookup('Total: EGP 120')).toMatchObject({ status: 'fallback', key: 'checkout.total' })
  })

  it('tells copied English apart from a translation the page ignores', () => {
    expect(t?.lookup('Free shipping')).toMatchObject({ status: 'copied', key: 'copied' })
    expect(t?.lookup('Order placed')).toMatchObject({ status: 'fallback', key: 'done' })
  })

  it('reports text in no file as not found, naming the English file', () => {
    expect(t?.lookup('Something hard-coded')).toEqual({
      status: 'not-found',
      file: rel(join(dir, 'en.json')),
    })
  })

  it('reads a folder of namespaces, pointing missing keys at the same namespace', () => {
    const ns = project({
      'locales/en/checkout.json': { pay: 'Pay now' },
      'locales/ar/checkout.json': {},
    })
    const n = loadTranslations(
      config({ locales: { ltr: join(ns, 'locales/en'), rtl: join(ns, 'locales/ar') } }),
    )
    expect(n?.lookup('Pay now')).toEqual({
      status: 'missing',
      key: 'checkout:pay',
      file: rel(join(ns, 'locales/ar/checkout.json')),
    })
  })

  it('fails clearly on a missing or broken file', () => {
    const bad = project({ 'en.json': '{ nope', 'ar.json': {} })
    const load = (ltr: string) =>
      loadTranslations(config({ locales: { ltr, rtl: join(bad, 'ar.json') } }))
    expect(() => load(join(bad, 'missing.json'))).toThrow(ConfigError)
    expect(() => load(join(bad, 'en.json'))).toThrow(/can't read .*en\.json/)
  })
})

describe('untranslated-text with locales', () => {
  it('says where to fix each string', () => {
    const dir = project({ 'en.json': { pay: 'Pay now' }, 'ar.json': {} })
    const c = config({ locales: { ltr: join(dir, 'en.json'), rtl: join(dir, 'ar.json') } })
    const box = { x: 0, y: 0, w: 100, h: 20 }
    const text = (value: string) => ({
      value,
      arabic: 0,
      latin: value.length,
      digits: { arabicIndic: 0, western: 0 },
    })
    const style = { ...el({ box }).style, direction: 'rtl' as const }
    const pair: SnapshotPair = {
      route: '/',
      rtl: snapshot('rtl', [
        el({ key: 'body', tag: 'body', box, style }),
        el({ key: 'pay', selector: '#pay', text: text('Pay now'), box }),
        el({ key: 'promo', selector: '#promo', text: text('Summer sale today'), box }),
      ]),
      matches: [],
      unmatched: { ltr: [], rtl: [] },
    }
    const rules = resolveRules(
      builtinRules.filter((r) => r.meta.id === 'untranslated-text'),
      c,
    )
    const findings = runRules(pair, rules, c, {}, loadTranslations(c)).findings
    expect(
      findings.map((f) => [f.selector, f.evidence.translation, f.evidence.translationKey]),
    ).toEqual([
      ['#pay', 'missing', 'pay'],
      ['#promo', 'not-found', undefined],
    ])
    expect(findings[0]?.message).toContain(
      `The key "pay" is missing from ${rel(join(dir, 'ar.json'))}.`,
    )
    // The fingerprint doesn't change with the translation files, so baselines survive edits to them.
    const without = runRules(pair, rules, c).findings
    expect(findings.map((f) => f.id)).toEqual(without.map((f) => f.id))
  })
})
