import type { Engine, Finding, RouteResult } from '../types'

export type EngineResult = { engine: Engine; result: RouteResult }

export const ENGINE_NAMES: Record<Engine, string> = {
  chromium: 'Chromium',
  firefox: 'Firefox',
  webkit: 'WebKit',
}

/** Performance runs in the main engine only, so its findings aren't compared. */
const compared = (f: Finding) => f.area !== 'performance'

/**
 * Merges what each engine found on a route into the main engine's result. A finding the
 * same in every engine stays as it is. One only some engines found records them in
 * `engines`, and one the main engine missed is added, with boxes in that engine's
 * screenshots. An engine counts for a rule only where the rule ran, so fallback-font,
 * which needs Chromium, isn't "Chromium only".
 */
export function compareEngines(main: EngineResult, others: EngineResult[]): RouteResult {
  const result = main.result
  const engines: NonNullable<RouteResult['engines']> = {}
  for (const { engine, result: other } of others) {
    engines[engine] = {
      status: other.status,
      findings: other.findings.filter(compared).length,
      screenshots: {
        ...(other.screenshots.ltr ? { ltr: other.screenshots.ltr } : {}),
        rtl: other.screenshots.rtl,
        ...(other.screenshots.frames ? { frames: other.screenshots.frames } : {}),
      },
      errors: other.errors,
    }
  }
  const notes = [
    ...result.notes,
    ...others.flatMap(({ engine, result: other }) =>
      other.status === 'error'
        ? [
            `${ENGINE_NAMES[engine]}: not compared, ${other.errors[0]?.message ?? 'the page failed'}`,
          ]
        : [],
    ),
  ]
  const ok = others.filter((o) => o.result.status === 'ok')
  if (result.status !== 'ok' || ok.length === 0) return { ...result, engines, notes }

  const runs = [main, ...ok]
  const seen = new Map<string, { finding: Finding; engines: Engine[] }>()
  for (const { engine, result: run } of runs) {
    for (const finding of run.findings.filter(compared)) {
      const entry = seen.get(finding.id) ?? { finding, engines: [] }
      entry.engines.push(engine)
      seen.set(finding.id, entry)
    }
  }
  const partial = (finding: Finding) => {
    const entry = seen.get(finding.id)
    if (!entry) return finding
    const ran = runs.filter((r) => !r.result.skippedRules.includes(finding.rule))
    return entry.engines.length < ran.length ? { ...finding, engines: entry.engines } : finding
  }
  const mainIds = new Set(result.findings.map((f) => f.id))
  const elsewhere = [...seen.values()]
    .filter((e) => !mainIds.has(e.finding.id))
    .map((e) => partial(e.finding))
  return {
    ...result,
    engines,
    notes,
    findings: [...result.findings.map(partial), ...elsewhere],
  }
}
