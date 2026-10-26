import { describe, expect, it } from 'vitest'
import { resolveRules, runRules } from '../src/core/engine'
import { builtinRules } from '../src/rules'
import type { PagePerf, SnapshotPair } from '../src/types'
import { config, snapshot } from './helpers'

/** A fast, light page; tests override what they're about. */
function perf(over: Partial<PagePerf> = {}): PagePerf {
  return {
    lcp: { ms: 1200, selector: 'h1.hero', box: { x: 40, y: 80, w: 600, h: 48 } },
    fcpMs: 800,
    cls: 0.01,
    tbtMs: 40,
    requests: 12,
    bytes: {
      document: 4000,
      script: 120 * 1024,
      style: 20000,
      font: 30000,
      image: 90000,
      other: 0,
    },
    renderBlocking: [],
    oversizedImages: [],
    resources: [],
    runs: 3,
    ...over,
  }
}

function pair(ltr: Partial<PagePerf> | undefined, rtl: Partial<PagePerf>): SnapshotPair {
  return {
    route: '/pricing',
    ...(ltr ? { ltr: snapshot('ltr', [], { perf: perf(ltr) }) } : {}),
    rtl: snapshot('rtl', [], { dir: 'rtl', perf: perf(rtl) }),
    matches: [],
    unmatched: { ltr: [], rtl: [] },
  }
}

function check(p: SnapshotPair, input: Record<string, unknown> = {}) {
  const c = config({ checks: ['performance'], ...input })
  return runRules(p, resolveRules(builtinRules, c), c).findings
}

const brief = (findings: ReturnType<typeof check>) =>
  findings.map((f) => `${f.rule} ${f.evidence.side} ${f.severity}`)

describe('performance rules', () => {
  it('find nothing on a page within budget', () => {
    expect(check(pair({}, {}))).toEqual([])
  })

  it('flag the Arabic page alone when only it is over, and name the English time', () => {
    const findings = check(
      pair({}, { lcp: { ms: 3140, selector: 'h1.hero', box: { x: 640, y: 80, w: 600, h: 48 } } }),
    )
    expect(brief(findings)).toEqual(['lcp-budget rtl error'])
    expect(findings[0]?.message).toBe(
      'Arabic: Largest paint is 3,140 ms, 640 ms over the 2,500 ms budget. English is 1,200 ms.',
    )
    expect(findings[0]?.selector).toBe('h1.hero')
    expect(findings[0]?.boxes).toEqual({ rtl: { x: 640, y: 80, w: 600, h: 48 } })
  })

  it('report a metric over budget in both languages once', () => {
    const findings = check(pair({ tbtMs: 300 }, { tbtMs: 450 }))
    expect(brief(findings)).toEqual(['tbt-budget both warn'])
    expect(findings[0]?.message).toBe(
      'Blocking time is over the 200 ms budget in both languages: English 300 ms, Arabic 450 ms.',
    )
  })

  it('keep the same fingerprint when the numbers change', () => {
    const [a] = check(pair({}, { cls: 0.2 }))
    const [b] = check(pair({}, { cls: 0.35 }))
    expect(a?.id).toBe(b?.id)
  })

  it('read budgets from the config', () => {
    const p = pair({}, { bytes: { ...perf().bytes, script: 350 * 1024 } })
    expect(brief(check(p))).toEqual(['js-budget rtl warn'])
    expect(check(p, { performance: { budgets: { scriptKb: 400 } } })).toEqual([])
  })

  it('flag render-blocking files and oversized images', () => {
    const blocking = [{ url: 'https://bayn.app/app.css', type: 'style' as const, bytes: 40960 }]
    const image = {
      url: 'https://bayn.app/hero.jpg',
      selector: 'img.hero',
      natural: { w: 2400, h: 1600 },
      shown: { w: 600, h: 400 },
      bytes: 400 * 1024,
      wastedBytes: 375 * 1024,
    }
    const findings = check(
      pair({ renderBlocking: blocking }, { renderBlocking: blocking, oversizedImages: [image] }),
    )
    expect(brief(findings)).toEqual(['oversized-images rtl info', 'render-blocking both warn'])
    expect(findings[1]?.message).toBe('1 file holds up the first paint: app.css (40 KB).')
  })

  it("list a dev server's numbers as info, which never fails the run", () => {
    const findings = check(pair({ devServer: true }, { devServer: true, lcp: { ms: 4200 } }))
    expect(brief(findings)).toEqual(['lcp-budget rtl info'])
  })

  it('check the Arabic page alone in rtl-only mode', () => {
    expect(brief(check(pair(undefined, { cls: 0.3 })))).toEqual(['cls-budget rtl warn'])
  })

  it("don't run unless performance is checked, nor on pages that weren't measured", () => {
    const c = config({})
    expect(
      runRules(pair({}, { cls: 0.3 }), resolveRules(builtinRules, c), c).findings.filter(
        (f) => f.area === 'performance',
      ),
    ).toEqual([])
    const unmeasured: SnapshotPair = { ...pair({}, {}), rtl: snapshot('rtl', [], { dir: 'rtl' }) }
    delete unmeasured.ltr
    expect(check(unmeasured)).toEqual([])
  })
})
