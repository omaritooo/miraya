import * as z from 'zod'
import type { Dir, PagePerf, ResolvedConfig, Severity, SnapshotPair } from '../../types'
import { LANGUAGE, report, type Issue } from '../page-findings'
import { defineRule } from '../util'

type Budgets = ResolvedConfig['performance']['budgets']

export const kb = (bytes: number) => Math.round(bytes / 1024)
const num = (n: number) => n.toLocaleString('en-US')

/** The measured languages: English and Arabic, or Arabic alone in --rtl-only mode. */
export function measured(pair: SnapshotPair): { dir: Dir; perf: PagePerf }[] {
  return (['ltr', 'rtl'] as const).flatMap((dir) => {
    const perf = pair[dir]?.perf
    return perf ? [{ dir, perf }] : []
  })
}

type Metric = {
  id: string
  docs: string
  severity: Severity
  /** "Largest paint", as a sentence starts. */
  label: string
  budget: (b: Budgets) => number
  value: (perf: PagePerf) => number | undefined
  /** "3,140 ms" */
  show: (n: number) => string
  /** The element to outline, if the metric has one. */
  element?: (perf: PagePerf) => Pick<Issue, 'box' | 'evidence'>
}

/** A metric held to a budget from config.performance.budgets. */
function budgetRule(metric: Metric) {
  return defineRule({
    meta: {
      id: metric.id,
      area: 'performance',
      defaultSeverity: metric.severity,
      needs: 'rtl',
      fingerprintKeys: ['check', 'side'],
      docs: metric.docs,
    },
    options: z.object({}),
    check(pair, ctx) {
      const budget = metric.budget(ctx.config.performance.budgets)
      const values = measured(pair).flatMap(({ dir, perf }) => {
        const value = metric.value(perf)
        return value === undefined ? [] : [{ dir, perf, value }]
      })
      const over = values.filter((v) => v.value > budget)
      const evidence = {
        budget,
        ...Object.fromEntries(values.map((v) => [v.dir, v.value])),
      }
      const issues: Partial<Record<Dir, Issue[]>> = {}
      for (const v of over) {
        const other = values.find((o) => o.dir !== v.dir)
        const message =
          over.length === 2
            ? `${metric.label} is over the ${metric.show(budget)} budget in both languages: ${values.map((o) => `${LANGUAGE[o.dir]} ${metric.show(o.value)}`).join(', ')}.`
            : `${metric.label} is ${metric.show(v.value)}, ${metric.show(v.value - budget)} over the ${metric.show(budget)} budget.${other ? ` ${LANGUAGE[other.dir]} is ${metric.show(other.value)}.` : ''}`
        const element = metric.element?.(v.perf)
        issues[v.dir] = [
          {
            check: 'over',
            message,
            ...element,
            evidence: { ...evidence, ...element?.evidence },
          },
        ]
      }
      const selector = over.map((v) => v.perf.lcp?.selector).find(Boolean)
      return report(pair, ctx, metric.id, (metric.element && selector) || 'html', issues)
    },
  })
}

const ms = (n: number) => `${num(Math.round(n))} ms`

export const lcpBudget = budgetRule({
  id: 'lcp-budget',
  docs: 'lcp-budget',
  severity: 'error',
  label: 'Largest paint',
  budget: (b) => b.lcpMs,
  value: (perf) => perf.lcp?.ms,
  show: ms,
  element: (perf) => ({
    ...(perf.lcp?.box ? { box: perf.lcp.box } : {}),
    evidence: {
      ...(perf.lcp?.selector ? { element: perf.lcp.selector } : {}),
      ...(perf.lcp?.url ? { resource: perf.lcp.url } : {}),
    },
  }),
})

export const clsBudget = budgetRule({
  id: 'cls-budget',
  docs: 'cls-budget',
  severity: 'warn',
  label: 'Layout shift',
  budget: (b) => b.cls,
  value: (perf) => perf.cls,
  show: (n) => String(Math.round(n * 1000) / 1000),
})

export const tbtBudget = budgetRule({
  id: 'tbt-budget',
  docs: 'tbt-budget',
  severity: 'warn',
  label: 'Blocking time',
  budget: (b) => b.tbtMs,
  value: (perf) => perf.tbtMs,
  show: ms,
})

export const jsBudget = budgetRule({
  id: 'js-budget',
  docs: 'js-budget',
  severity: 'warn',
  label: 'JavaScript',
  budget: (b) => b.scriptKb,
  value: (perf) => kb(perf.bytes.script),
  show: (n) => `${num(n)} KB`,
})
