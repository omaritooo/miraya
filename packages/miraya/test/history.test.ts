import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { acceptFindings } from '../src/core/baseline'
import { describe as describeElement } from '../src/core/engine'
import { githubComment } from '../src/core/github'
import { appendHistory, historyRun, readHistory, writeDashboard } from '../src/core/history'
import { detectRun, githubRepo } from '../src/core/run'
import { comparison, diff } from '../report/src/history'
import type { ElementSnap, Finding, HistoryRun, Report, RouteResult } from '../src/types'

const finding = (id: string, route: string, extra: Partial<Finding> = {}): Finding => ({
  id,
  rule: 'not-mirrored',
  area: 'localization',
  route,
  severity: 'error',
  selector: `#${id}`,
  boxes: {},
  message: 'The sign-in link stayed on the right in Arabic. More detail.',
  docsUrl: 'https://docs',
  evidence: {},
  ...extra,
})

const route = (path: string, findings: Finding[], status: 'ok' | 'error' = 'ok'): RouteResult => ({
  route: path,
  status,
  durationMs: 1,
  pairing: { testid: 0, path: 0, heuristic: 0, unmatched: { ltr: 0, rtl: 0 } },
  skippedRules: [],
  notes: [],
  screenshots: { rtl: '', truncated: false },
  findings,
  errors: status === 'error' ? [{ kind: 'redirected', message: 'Redirected to /auth' }] : [],
})

const report = (startedAt: string, ...routes: RouteResult[]): Report => ({
  schemaVersion: 1,
  tool: { name: 'miraya', version: '0' },
  startedAt,
  durationMs: 1000,
  config: { hash: 'h', viewport: { w: 1, h: 1 }, mode: 'pair', checks: ['localization', 'seo'] },
  run: { project: 'bayn', branch: 'main', commit: 'abc1234', channel: 'main' },
  summary: {
    routes: routes.length,
    routeErrors: routes.filter((r) => r.status === 'error').length,
    findings: { error: 0, warn: 0, info: 0 },
    new: 0,
    baselined: 0,
    fixed: 0,
  },
  routes,
  fixed: [],
})

const el = (extra: Partial<ElementSnap>): ElementSnap =>
  ({ key: 'e1', depth: 1, path: 'a', selector: 'a', tag: 'div', ...extra }) as ElementSnap

describe('history', () => {
  it('keeps counts and fingerprints, not screenshots or evidence', () => {
    const run = historyRun(
      report(
        '2026-10-20T10:00:00.000Z',
        route('/pricing', [
          finding('a', '/pricing', { label: 'Sign in link', status: 'baselined' }),
        ]),
        route('/login', [], 'error'),
      ),
    )
    expect(run.routes[0]?.findings[0]).toEqual({
      id: 'a',
      rule: 'not-mirrored',
      area: 'localization',
      severity: 'error',
      label: 'Sign in link',
      known: true,
    })
    expect(run.routes[1]).toMatchObject({ status: 'error', error: 'Redirected to /auth' })
    expect(run.checks).toEqual(['localization', 'seo'])
  })

  it('appends one file per run, reads them oldest first and skips broken files', () => {
    const dir = mkdtempSync(join(tmpdir(), 'miraya-history-'))
    appendHistory(report('2026-10-21T10:00:00.000Z', route('/', [])), dir)
    appendHistory(report('2026-10-20T10:00:00.000Z', route('/', [])), dir)
    writeFileSync(join(dir, 'broken.json'), '{')
    const runs = readHistory(dir)
    expect(runs.map((r) => r.startedAt)).toEqual([
      '2026-10-20T10:00:00.000Z',
      '2026-10-21T10:00:00.000Z',
    ])
  })

  it('writes dashboard.html with the runs inlined', () => {
    const dir = mkdtempSync(join(tmpdir(), 'miraya-dash-'))
    appendHistory(report('2026-10-21T10:00:00.000Z', route('/', [])), join(dir, 'history'))
    const { file, runs } = writeDashboard(dir, join(dir, 'history'))
    expect(runs).toBe(1)
    expect(readFileSync(file, 'utf8')).toContain('"kind":"dashboard"')
  })

  const run = (startedAt: string, ids: string[], known: string[] = []): HistoryRun => ({
    schemaVersion: 1,
    startedAt,
    durationMs: 1,
    checks: ['localization'],
    engines: ['chromium'],
    baselined: 0,
    fixed: 0,
    routes: [
      {
        route: '/',
        status: 'ok',
        findings: ids.map((id) => ({
          id,
          rule: 'r',
          area: 'localization',
          severity: 'error',
          ...(known.includes(id) ? { known: true } : {}),
        })),
      },
    ],
  })

  it('compares with the run a week before, and splits new, fixed and accepted', () => {
    const runs = [
      run('2026-10-01T00:00:00.000Z', ['a']),
      run('2026-10-10T00:00:00.000Z', ['a', 'b', 'c']),
      run('2026-10-15T00:00:00.000Z', ['b']),
      run('2026-10-18T00:00:00.000Z', ['b', 'c', 'd'], ['c']),
    ]
    const latest = runs[3] as HistoryRun
    expect(comparison(runs, runs, latest, 'week')?.startedAt).toBe('2026-10-10T00:00:00.000Z')
    expect(comparison(runs, runs, latest, 'previous')?.startedAt).toBe('2026-10-15T00:00:00.000Z')
    const d = diff(latest, runs[1])
    expect(d.added.map((f) => f.id)).toEqual(['d'])
    expect(d.fixed.map((f) => f.id)).toEqual(['a'])
    expect(d.accepted.map((f) => f.id)).toEqual(['c'])
  })
})

describe('accepting single findings', () => {
  it('adds the named findings and refuses unknown fingerprints', () => {
    const r = report('2026-10-20T10:00:00.000Z', route('/', [finding('a', '/'), finding('b', '/')]))
    const { baseline, missing } = acceptFindings(undefined, r, ['b', 'zzz'])
    expect(baseline.entries).toEqual([{ fingerprint: 'b', rule: 'not-mirrored', route: '/' }])
    expect(missing).toEqual(['zzz'])
  })
})

describe('the pull request comment', () => {
  it('leads with the verdict, counts per area and lists new findings once per element', () => {
    const r = report(
      '2026-10-20T10:00:00.000Z',
      route('/pricing', [finding('a', '/pricing', { label: 'Start free arrow' })]),
      route('/account', [finding('b', '/account', { label: 'Start free arrow' })]),
      route('/login', [], 'error'),
    )
    r.run = { ...r.run, url: 'https://ci/run/1' }
    const md = githubComment(r)
    expect(md).toContain('### Miraya: 2 new errors on 2 pages')
    expect(md).toContain('| Localization | ◆ 2 | 0 | 0 |')
    expect(md).toContain(
      '- ◆ **not-mirrored** on 2 pages: the sign-in link stayed on the right in Arabic.',
    )
    expect(md).toContain("[Open the full report](https://ci/run/1) · 1 page couldn't be audited")
  })
})

describe('run details', () => {
  it('reads GitHub Actions variables for a pull request', () => {
    const info = detectRun({
      cwd: tmpdir(),
      env: {
        GITHUB_REF: 'refs/pull/42/merge',
        GITHUB_HEAD_REF: 'fix-nav',
        GITHUB_SHA: '957de77aaaa',
        GITHUB_REPOSITORY: 'bayn/web',
        GITHUB_SERVER_URL: 'https://github.com',
        GITHUB_RUN_ID: '9',
      },
    })
    expect(info).toMatchObject({
      pr: 42,
      branch: 'fix-nav',
      commit: '957de77',
      channel: 'Pull requests',
      repo: 'bayn/web',
      url: 'https://github.com/bayn/web/actions/runs/9',
    })
  })

  it('names the GitHub repository from either remote form', () => {
    expect(githubRepo('git@github.com:bayn/web.git')).toBe('bayn/web')
    expect(githubRepo('https://github.com/bayn/web')).toBe('bayn/web')
    expect(githubRepo('https://gitlab.com/bayn/web')).toBeUndefined()
  })
})

describe('element names', () => {
  it('says what the element is in words', () => {
    expect(describeElement(el({ tag: 'a' }), 'Sign in')).toBe('Sign in link')
    expect(describeElement(el({ tag: 'button' }), 'Save')).toBe('Save button')
    expect(describeElement(el({ tag: 'aside', role: 'complementary', testId: 'sidebar' }))).toBe(
      'Sidebar',
    )
    expect(describeElement(el({ tag: 'svg', icon: { name: 'chevron-left' } }))).toBe(
      'Chevron-left icon',
    )
    expect(describeElement(el({ tag: 'div' }))).toBeUndefined()
  })
})
