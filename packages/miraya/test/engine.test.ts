import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { ConfigError, resolveRules, runRules } from '../src/core/engine'
import { defineRule } from '../src/rules'
import type { Rule, SnapshotPair } from '../src/types'
import { config, el, snapshot } from './helpers'

const box = { x: 0, y: 0, w: 10, h: 10 }
const body = (direction: 'ltr' | 'rtl') =>
  el({ key: 'body', tag: 'body', box, style: { ...el({ box }).style, direction } })

const pairOf = (rtlDir: 'ltr' | 'rtl' = 'rtl'): SnapshotPair => ({
  route: '/',
  ltr: snapshot('ltr', [body('ltr')]),
  rtl: snapshot(rtlDir, [body(rtlDir)]),
  matches: [{ ltr: 'body', rtl: 'body', method: 'heuristic' }],
  unmatched: { ltr: [], rtl: [] },
})

const probe = (
  overrides: Partial<Rule<{ n: number }>['meta']> = {},
  evidence: Record<string, string | number> = { kind: 'a' },
) =>
  defineRule({
    meta: {
      id: 'probe',
      defaultSeverity: 'error',
      needs: 'rtl',
      fingerprintKeys: ['kind'],
      docs: 'probe',
      ...overrides,
    },
    options: z.object({ n: z.number().default(1) }),
    check: (pair, ctx) => [
      ctx.finding({
        rule: 'probe',
        route: pair.route,
        selector: 'body',
        boxes: {},
        message: `n=${ctx.options.n}`,
        evidence,
        match: 'heuristic',
      }),
    ],
  }) as Rule<unknown>

const run = (rules: Rule<unknown>[], input: Record<string, unknown> = {}, pair = pairOf()) => {
  const c = config(input)
  return runRules(pair, resolveRules(rules, c), c)
}

describe('rule engine', () => {
  it('applies configured severity and options', () => {
    const { findings } = run([probe()], { rules: { probe: ['warn', { n: 3 }] } })
    expect(findings[0]).toMatchObject({
      severity: 'warn',
      message: 'n=3',
      docsUrl: 'https://miraya.dev/rules/probe',
    })
  })

  it('names the rule and field for invalid options', () => {
    expect(() => run([probe()], { rules: { probe: ['error', { n: 'x' }] } })).toThrow(
      /rule "probe" at n/,
    )
    expect(() => run([probe()], { rules: { nope: 'off' } })).toThrow(ConfigError)
  })

  it('drops severity a level for matches weaker than minMatch', () => {
    expect(run([probe({ minMatch: 'path' })]).findings[0]?.severity).toBe('warn')
    expect(run([probe({ minMatch: 'heuristic' })]).findings[0]?.severity).toBe('error')
  })

  it('keeps experimental rules off until opted in', () => {
    expect(run([probe({ experimental: true })]).findings).toHaveLength(0)
    expect(run([probe({ experimental: true })], { experimental: ['probe'] }).findings).toHaveLength(
      1,
    )
  })

  it('turns a crashing rule into a route error and keeps running the others', () => {
    const crash = defineRule({
      meta: {
        id: 'crash',
        defaultSeverity: 'error',
        needs: 'rtl',
        fingerprintKeys: [],
        docs: 'crash',
      },
      options: z.object({}),
      check: () => {
        throw new Error('boom')
      },
    }) as Rule<unknown>
    const result = run([crash, probe()])
    expect(result.errors).toMatchObject([{ kind: 'rule-crashed', rule: 'crash', message: 'boom' }])
    expect(result.findings).toHaveLength(1)
  })

  it('refuses numeric fingerprint keys', () => {
    expect(() => run([probe({}, { kind: 4 })])).not.toThrow()
    expect(run([probe({}, { kind: 4 })]).errors[0]?.message).toMatch(/numeric evidence "kind"/)
  })

  it('gives the same finding the same fingerprint when measurements change', () => {
    const a = run([probe({}, { kind: 'a', delta: 10 })]).findings[0]?.id
    const b = run([probe({}, { kind: 'a', delta: 11 })]).findings[0]?.id
    expect(a).toBe(b)
  })

  it('skips pair rules in rtl-only mode', () => {
    const rtlOnly = { ...pairOf(), ltr: undefined }
    const result = run([probe({ needs: 'pair' })], {}, rtlOnly)
    expect(result.skippedRules).toEqual(['probe'])
  })

  it('skips other rules when the RTL render is not right-to-left', () => {
    const result = run([probe()], {}, pairOf('ltr'))
    expect(result.skippedRules).toEqual(['probe'])
  })
})
