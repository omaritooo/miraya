import { createHash } from 'node:crypto'
import * as z from 'zod'
import { rtlWrapper } from '../rules/util'
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
  SitePage,
  SnapshotPair,
  Translations,
} from '../types'

// Each rule has a section in the package README whose anchor is the rule id.
export const DOCS_BASE_URL =
  'https://github.com/omaritooo/miraya/blob/main/packages/miraya/README.md#'

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
    if (level === 'off' || !config.checks.includes(rule.meta.area ?? 'localization')) continue
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
  return pair.rtl.dir === 'rtl' || body?.style.direction === 'rtl' || !!rtlWrapper(pair.rtl)
}

export type RuleRun = { findings: Finding[]; skippedRules: string[]; errors: RouteError[] }

/** Runs the resolved rules over one pair. A rule that throws becomes a route error; the rest still run. */
export function runRules(
  pair: SnapshotPair,
  resolved: ResolvedRule[],
  config: ResolvedConfig,
  crops: { ltr?: CropCache; rtl?: CropCache } = {},
  translations?: Translations,
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
  const layoutOnly = typeof config.locale === 'object' && config.locale.strategy === 'attribute'

  for (const { rule, severity, options } of ordered) {
    const { meta } = rule
    const area = meta.area ?? 'localization'
    if (
      (meta.needs === 'pair' && !pair.ltr) ||
      (area === 'localization' && meta.id !== 'document-direction' && !rtlPage) ||
      (meta.needsTranslation && layoutOnly) ||
      (meta.chromiumOnly && (pair.rtl.engine ?? 'chromium') !== 'chromium')
    ) {
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
      ...(translations ? { translations } : {}),
      finding: (input) => makeFinding(rule, severity, input),
    }
    try {
      findings.push(...(rule.check?.(pair, ctx) ?? []))
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
  return { findings: mergeRepeats(findings), skippedRules, errors }
}

/** A rule's finding at its resolved severity, which the rule may lower but never raise. */
function makeFinding(rule: Rule<unknown>, severity: Severity, input: FindingInput): Finding {
  const { meta } = rule
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
    area: meta.area ?? 'localization',
    severity: level,
    docsUrl: `${DOCS_BASE_URL}${meta.docs}`,
  }
  if (el?.sourceHint && !finding.sourceHint) finding.sourceHint = el.sourceHint
  return finding
}

/**
 * Runs the rules that compare pages, over every page that was audited. Findings carry their
 * own route; a rule that throws becomes an error on every page it would have checked.
 */
export function runSiteRules(
  pages: SitePage[],
  resolved: ResolvedRule[],
  config: ResolvedConfig,
): { findings: Finding[]; errors: RouteError[] } {
  const findings: Finding[] = []
  const errors: RouteError[] = []
  for (const { rule, severity, options } of resolved) {
    if (!rule.checkSite) continue
    try {
      findings.push(
        ...rule.checkSite(pages, {
          options,
          config,
          finding: (input) => makeFinding(rule, severity, input),
        }),
      )
    } catch (error) {
      errors.push({
        kind: 'rule-crashed',
        rule: rule.meta.id,
        message: error instanceof Error ? error.message : String(error),
        ...(error instanceof Error && error.stack ? { stack: error.stack } : {}),
      })
    }
  }
  return { findings, errors }
}

/**
 * One mistake in a repeated component (a card, a list item) shows up on every copy. Findings
 * with the same rule and message whose selectors differ only in their positions become one,
 * on the first copy, with the number of copies.
 */
function mergeRepeats(findings: Finding[]): Finding[] {
  const shape = (f: Finding) =>
    `${f.rule}\u0000${f.message}\u0000${f.selector.replace(/:nth-of-type\(\d+\)/g, ':nth-of-type(n)')}`
  const groups = new Map<string, Finding[]>()
  for (const f of findings) {
    const key = shape(f)
    const group = groups.get(key)
    if (group) group.push(f)
    else groups.set(key, [f])
  }
  return [...groups.values()].map(([first, ...rest]) => {
    const f = first as Finding
    if (rest.length === 0) return f
    return {
      ...f,
      message: `${f.message} The same on ${rest.length} more ${rest.length === 1 ? 'copy' : 'copies'} of this element.`,
      evidence: { ...f.evidence, copies: rest.length + 1 },
    }
  })
}

export const zodIssuePath = (error: z.ZodError) =>
  error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('\n')
