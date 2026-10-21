import { createHash } from 'node:crypto'
import { z } from 'zod'
import type { CropCache } from './crops'
import type {
  ElementSnap,
  Finding,
  FindingInput,
  MatchMethod,
  ResolvedConfig,
  RouteError,
  Rule,
  RuleContext,
  Severity,
  SnapshotPair,
} from '../types'

export const DOCS_BASE_URL = 'https://miraya.dev/rules/'

const SEVERITY_RANK: Record<Severity, number> = { info: 0, warn: 1, error: 2 }
const MATCH_RANK: Record<MatchMethod, number> = { heuristic: 0, path: 1, testid: 2 }
const LOWER: Record<Severity, Severity> = { error: 'warn', warn: 'info', info: 'info' }

export class ConfigError extends Error {
  override name = 'ConfigError'
}

export type ResolvedRule = { rule: Rule<unknown>; severity: Severity; options: unknown }

/**
 * Applies the config to the rule set: severity overrides, experimental opt-in and
 * option parsing. Invalid options throw a ConfigError naming the rule and field.
 */
export function resolveRules(rules: Rule<unknown>[], config: ResolvedConfig): ResolvedRule[] {
  const known = new Set(rules.map((r) => r.meta.id))
  for (const id of [...Object.keys(config.rules), ...config.experimental]) {
    if (!known.has(id)) throw new ConfigError(`Unknown rule "${id}" in config`)
  }
  const resolved: ResolvedRule[] = []
  for (const rule of rules) {
    const setting = config.rules[rule.meta.id]
    const [level, rawOptions] = Array.isArray(setting) ? setting : [setting, {}]
    if (level === 'off') continue
    if (rule.meta.experimental && !config.experimental.includes(rule.meta.id)) continue
    const parsed = rule.options.safeParse(rawOptions)
    if (!parsed.success) {
      const issue = parsed.error.issues[0]
      throw new ConfigError(
        `Invalid options for rule "${rule.meta.id}" at ${issue?.path.join('.') || '(root)'}: ${issue?.message}`,
      )
    }
    resolved.push({
      rule,
      severity: level ?? rule.meta.defaultSeverity,
      options: parsed.data,
    })
  }
  return resolved
}

/** sha1(rule + route + element identity + categorical evidence). See DESIGN.md › baselines. */
export function fingerprint(rule: Rule<unknown>, input: FindingInput): string {
  const keyed: Record<string, string | boolean> = {}
  for (const key of rule.meta.fingerprintKeys) {
    const value = input.evidence[key]
    if (typeof value === 'number') {
      throw new Error(
        `Rule "${rule.meta.id}" uses numeric evidence "${key}" as a fingerprint key; fingerprints take categorical values only`,
      )
    }
    if (value !== undefined) keyed[key] = value
  }
  const identity = input.el ? (input.el.testId ?? input.el.path) : 'page'
  return createHash('sha1')
    .update(JSON.stringify([rule.meta.id, input.route, identity, keyed]))
    .digest('hex')
}

function isRtlPage(pair: SnapshotPair) {
  const body = pair.rtl.elements.find((el) => el.tag === 'body')
  return pair.rtl.dir === 'rtl' || body?.style.direction === 'rtl'
}

export type RuleRun = { findings: Finding[]; skippedRules: string[]; errors: RouteError[] }

/** Runs the resolved rules over one pair. A rule that throws becomes a route error; the rest still run. */
export function runRules(
  pair: SnapshotPair,
  resolved: ResolvedRule[],
  config: ResolvedConfig,
  crops: { ltr?: CropCache; rtl?: CropCache } = {},
): RuleRun {
  const ltrByKey = new Map((pair.ltr?.elements ?? []).map((el) => [el.key, el]))
  const rtlByKey = new Map(pair.rtl.elements.map((el) => [el.key, el]))
  const twins = new Map(pair.matches.map((m) => [m.rtl, m]))
  const findings: Finding[] = []
  const skippedRules: string[] = []
  const errors: RouteError[] = []

  // document-direction first: if the RTL render isn't RTL at all, every other rule
  // would report the same root cause.
  const ordered = [...resolved].sort(
    (a, b) =>
      Number(b.rule.meta.id === 'document-direction') -
      Number(a.rule.meta.id === 'document-direction'),
  )
  const rtlPage = isRtlPage(pair)

  for (const { rule, severity, options } of ordered) {
    const { meta } = rule
    if ((meta.needs === 'pair' && !pair.ltr) || (meta.id !== 'document-direction' && !rtlPage)) {
      skippedRules.push(meta.id)
      continue
    }
    const ctx: RuleContext<unknown> = {
      options,
      config,
      el: (dir, key) => (dir === 'ltr' ? ltrByKey : rtlByKey).get(key),
      twin: (rtlKey) => {
        const m = twins.get(rtlKey)
        const el: ElementSnap | undefined = m && ltrByKey.get(m.ltr)
        return m && el ? { el, method: m.method } : undefined
      },
      crop: (dir, key) => crops[dir]?.get(key) ?? null,
      finding: (input) => {
        let level = severity
        if (input.severity && SEVERITY_RANK[input.severity] < SEVERITY_RANK[level]) {
          level = input.severity
        }
        if (input.match && meta.minMatch && MATCH_RANK[input.match] < MATCH_RANK[meta.minMatch]) {
          level = LOWER[level]
        }
        const { el, severity: _requested, ...rest } = input
        const finding: Finding = {
          ...rest,
          id: fingerprint(rule, input),
          severity: level,
          docsUrl: `${DOCS_BASE_URL}${meta.docs}`,
        }
        if (el?.sourceHint && !finding.sourceHint) finding.sourceHint = el.sourceHint
        return finding
      },
    }
    try {
      findings.push(...rule.check(pair, ctx))
    } catch (error) {
      errors.push({
        kind: 'rule-crashed',
        rule: meta.id,
        message: error instanceof Error ? error.message : String(error),
        ...(error instanceof Error && error.stack ? { stack: error.stack } : {}),
      })
    }
  }

  findings.sort(
    (a, b) =>
      a.route.localeCompare(b.route) ||
      a.rule.localeCompare(b.rule) ||
      a.selector.localeCompare(b.selector),
  )
  return { findings, skippedRules, errors }
}

export const zodIssuePath = (error: z.ZodError) =>
  error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('\n')
