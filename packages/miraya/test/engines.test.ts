import { describe, expect, it } from 'vitest'
import { compareEngines } from '../src/core/engines'
import type { Finding, RouteResult } from '../src/types'

const finding = (
  id: string,
  rule = 'not-mirrored',
  area: Finding['area'] = 'localization',
): Finding => ({
  id,
  rule,
  area,
  severity: 'error',
  route: '/pricing',
  selector: `#${id}`,
  boxes: { rtl: { x: 0, y: 0, w: 10, h: 10 } },
  message: id,
  docsUrl: '',
  evidence: {},
})

const result = (findings: Finding[], over: Partial<RouteResult> = {}): RouteResult => ({
  route: '/pricing',
  status: 'ok',
  durationMs: 1,
  pairing: { testid: 0, path: 0, heuristic: 0, unmatched: { ltr: 0, rtl: 0 } },
  skippedRules: [],
  notes: [],
  screenshots: { rtl: 'routes/pricing/rtl.jpg', truncated: false },
  findings,
  errors: [],
  ...over,
})

const tags = (r: RouteResult) => r.findings.map((f) => `${f.id} ${f.engines?.join('+') ?? 'all'}`)

describe('comparing engines', () => {
  it('marks findings only some engines saw, and adds the ones the main engine missed', () => {
    const merged = compareEngines(
      { engine: 'chromium', result: result([finding('a'), finding('b')]) },
      [
        { engine: 'webkit', result: result([finding('a'), finding('c')]) },
        { engine: 'firefox', result: result([finding('a'), finding('b')]) },
      ],
    )
    expect(tags(merged)).toEqual(['a all', 'b chromium+firefox', 'c webkit'])
    expect(merged.engines?.webkit).toMatchObject({ status: 'ok', findings: 2 })
  })

  it("doesn't count an engine for a rule it skipped, or for performance", () => {
    const merged = compareEngines(
      {
        engine: 'chromium',
        result: result([
          finding('font', 'fallback-font'),
          finding('lcp', 'lcp-budget', 'performance'),
        ]),
      },
      [{ engine: 'webkit', result: result([], { skippedRules: ['fallback-font'] }) }],
    )
    expect(tags(merged)).toEqual(['font all', 'lcp all'])
  })

  it('compares nothing with an engine that failed, and says so', () => {
    const merged = compareEngines({ engine: 'chromium', result: result([finding('a')]) }, [
      {
        engine: 'webkit',
        result: result([], {
          status: 'error',
          errors: [{ kind: 'timeout', message: 'Route timed out' }],
        }),
      },
    ])
    expect(tags(merged)).toEqual(['a all'])
    expect(merged.notes).toEqual(['WebKit: not compared, Route timed out'])
    expect(merged.engines?.webkit?.errors).toHaveLength(1)
  })
})
