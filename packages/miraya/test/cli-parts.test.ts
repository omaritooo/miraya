import { describe, expect, it } from 'vitest'
import { normaliseLink } from '../src/core/crawl'
import { githubAnnotations, githubSummary } from '../src/core/github'
import type { Finding, Report } from '../src/types'
import { config } from './helpers'

describe('normaliseLink', () => {
  const c = config({
    baseUrl: 'http://app.test',
    locale: { strategy: 'path-prefix', ltr: '/en', rtl: '/ar' },
  })
  const never = () => false

  it('strips the locale prefix, hash and trailing slash, so both locales are one route', () => {
    expect(normaliseLink('/en/cart/#top', c, never)).toBe('/cart')
    expect(normaliseLink('/ar/cart', c, never)).toBe('/cart')
    expect(normaliseLink('/en/', c, never)).toBe('/')
  })

  it('drops the query unless an include pattern names it', () => {
    expect(normaliseLink('/en/search?q=lamp', c, never)).toBe('/search')
    expect(normaliseLink('/en/search?q=lamp', c, (r) => r.startsWith('/search?'))).toBe(
      '/search?q=lamp',
    )
  })

  it('ignores other origins and files that are not pages', () => {
    expect(normaliseLink('https://elsewhere.test/cart', c, never)).toBeUndefined()
    expect(normaliseLink('/en/catalog.pdf', c, never)).toBeUndefined()
    expect(normaliseLink('/en/logo.svg', c, never)).toBeUndefined()
  })
})

const finding = (partial: Partial<Finding>): Finding => ({
  id: 'x',
  rule: 'not-mirrored',
  route: '/',
  severity: 'error',
  selector: '#a',
  boxes: {},
  message: 'm',
  docsUrl: 'https://github.com/omaritooo/miraya/blob/main/packages/miraya/README.md#not-mirrored',
  evidence: {},
  status: 'new',
  ...partial,
})

const report = (findings: Finding[]): Report => ({
  schemaVersion: 1,
  tool: { name: 'miraya', version: '0' },
  startedAt: new Date(0).toISOString(),
  durationMs: 1,
  config: { hash: 'h', viewport: { w: 1, h: 1 }, mode: 'pair' },
  summary: {
    routes: 1,
    routeErrors: 0,
    findings: { error: 0, warn: 0, info: 0 },
    new: findings.length,
    baselined: 0,
    fixed: 0,
  },
  routes: [
    {
      route: '/',
      status: 'ok',
      durationMs: 1,
      pairing: { testid: 0, path: 0, heuristic: 0, unmatched: { ltr: 0, rtl: 0 } },
      skippedRules: [],
      notes: [],
      screenshots: { rtl: '', truncated: false },
      findings,
      errors: [],
    },
  ],
  fixed: [],
})

describe('GitHub output', () => {
  it('puts annotations on the diff when the finding has a source hint', () => {
    const [line] = githubAnnotations(
      report([finding({ sourceHint: 'src/components/Nav.vue:12:3' })]),
    )
    expect(line).toMatch(
      /^::error title=miraya\/not-mirrored,file=src\/components\/Nav\.vue,line=12,col=3::/,
    )
  })

  it('escapes workflow-command characters in messages and properties', () => {
    const [line] = githubAnnotations(
      report([finding({ message: '100% off\nnow', selector: 'a:b,c' })]),
    )
    expect(line).toContain('100%25 off%0Anow')
    expect(line?.startsWith('::error title=miraya/not-mirrored::')).toBe(true)
  })

  it('skips baselined findings and caps each annotation type at 10, most severe first', () => {
    const many = [
      ...Array.from({ length: 15 }, (_, i) => finding({ id: `w${i}`, severity: 'warn' })),
      ...Array.from({ length: 12 }, (_, i) => finding({ id: `e${i}` })),
      finding({ id: 'old', status: 'baselined' }),
    ]
    const lines = githubAnnotations(report(many))
    expect(lines.filter((l) => l.startsWith('::error'))).toHaveLength(10)
    expect(lines.filter((l) => l.startsWith('::warning'))).toHaveLength(10)
    expect(lines[0]?.startsWith('::error')).toBe(true)
  })

  it('writes a summary table and truncates long ones', () => {
    const summary = githubSummary(
      report(Array.from({ length: 250 }, (_, i) => finding({ id: `f${i}`, message: 'a | b' }))),
    )
    expect(summary).toContain(
      '| error | [not-mirrored](https://github.com/omaritooo/miraya/blob/main/packages/miraya/README.md#not-mirrored) | `#a` | a \\| b |',
    )
    expect(summary.match(/^\| error/gm)).toHaveLength(200)
    expect(summary).toContain('Truncated after 200 rows')
  })
})
