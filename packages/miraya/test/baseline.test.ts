import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { exitCode } from '../src/core/audit'
import { applyBaseline, readBaseline, updateBaseline, writeBaseline } from '../src/core/baseline'
import { BaselineSchema, type Finding, type Report, type RouteResult } from '../src/types'

const finding = (id: string, route: string, rule = 'not-mirrored'): Finding => ({
  id,
  rule,
  route,
  severity: 'error',
  selector: `#${id}`,
  boxes: {},
  message: 'm',
  docsUrl: 'd',
  evidence: {},
})

const route = (path: string, findings: Finding[]): RouteResult => ({
  route: path,
  status: 'ok',
  durationMs: 1,
  pairing: { testid: 0, path: 0, heuristic: 0, unmatched: { ltr: 0, rtl: 0 } },
  skippedRules: [],
  notes: [],
  screenshots: { rtl: '', truncated: false },
  findings,
  errors: [],
})

const report = (...routes: RouteResult[]): Report => ({
  schemaVersion: 1,
  tool: { name: 'miraya', version: '0' },
  startedAt: new Date(0).toISOString(),
  durationMs: 1,
  config: { hash: 'h', viewport: { w: 1, h: 1 }, mode: 'pair' },
  summary: {
    routes: routes.length,
    routeErrors: 0,
    findings: { error: 0, warn: 0, info: 0 },
    new: 0,
    baselined: 0,
    fixed: 0,
  },
  routes,
  fixed: [],
})

describe('baselines', () => {
  it('lets an app with 200 existing findings pass, and fails on a new one (US-7)', () => {
    const existing = Array.from({ length: 200 }, (_, i) => finding(`f${i}`, '/'))
    const baseline = updateBaseline(undefined, report(route('/', existing)))
    expect(exitCode(applyBaseline(report(route('/', existing)), baseline))).toBe(0)
    const withNew = applyBaseline(report(route('/', [...existing, finding('new', '/')])), baseline)
    expect(withNew.summary).toMatchObject({ new: 1, baselined: 200 })
    expect(exitCode(withNew)).toBe(1)
  })

  it('reports baseline entries that disappeared as fixed, only for audited routes', () => {
    const baseline = updateBaseline(
      undefined,
      report(route('/a', [finding('x', '/a')]), route('/b', [finding('y', '/b')])),
    )
    const result = applyBaseline(report(route('/a', [])), baseline)
    expect(result.fixed).toEqual([{ fingerprint: 'x', rule: 'not-mirrored', route: '/a' }])
  })

  it('marks a new finding as possibly moved when a fixed entry has the same rule and route', () => {
    const baseline = updateBaseline(undefined, report(route('/a', [finding('old', '/a')])))
    const result = applyBaseline(report(route('/a', [finding('new', '/a')])), baseline)
    expect(result.routes[0]?.findings[0]).toMatchObject({ status: 'new', possiblyMoved: 'old' })
  })

  it("keeps other routes' entries on a partial update", () => {
    const full = updateBaseline(
      undefined,
      report(route('/a', [finding('x', '/a')]), route('/b', [finding('y', '/b')])),
    )
    const partial = updateBaseline(full, report(route('/b', [finding('z', '/b')])))
    expect(partial.entries.map((e) => e.fingerprint)).toEqual(['x', 'z'])
  })

  it('keeps notes for fingerprints that are still present', () => {
    const base = updateBaseline(
      undefined,
      report(route('/a', [finding('x', '/a'), finding('y', '/a')])),
    )
    const noted = {
      ...base,
      entries: base.entries.map((e) =>
        e.fingerprint === 'x' ? { ...e, note: 'legacy promo strip, JIRA-412' } : e,
      ),
    }
    const next = updateBaseline(noted, report(route('/a', [finding('x', '/a')])))
    expect(next.entries).toEqual([
      { fingerprint: 'x', rule: 'not-mirrored', route: '/a', note: 'legacy promo strip, JIRA-412' },
    ])
  })

  it('writes a sorted file with one entry per line that reads back the same', () => {
    const dir = mkdtempSync(join(tmpdir(), 'miraya-baseline-'))
    const file = join(dir, 'baseline.json')
    const baseline = updateBaseline(
      undefined,
      report(
        route('/b', [finding('b2', '/b')]),
        route('/a', [finding('a1', '/a', 'untranslated-text')]),
      ),
    )
    writeBaseline(file, baseline)
    const text = readFileSync(file, 'utf8')
    expect(text.split('\n').filter((l) => l.includes('fingerprint'))).toHaveLength(2)
    expect(text.indexOf('"/a"')).toBeLessThan(text.indexOf('"/b"'))
    expect(BaselineSchema.parse(JSON.parse(text))).toEqual(readBaseline(file))
  })

  it('fails with a pointer to `baseline update` when the file is broken', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'miraya-baseline-')), 'b.json')
    writeFileSync(file, '{"schemaVersion": 2}')
    expect(() => readBaseline(file)).toThrow(/baseline update/)
  })
})
