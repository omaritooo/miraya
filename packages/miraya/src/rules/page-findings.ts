import type { Box, Dir, Finding, RuleContext, Severity, SnapshotPair } from '../types'

export const LANGUAGE: Record<Dir, string> = { ltr: 'English', rtl: 'Arabic' }

/** One problem on one render. `check` names it; equal checks on both renders become one finding. */
export type Issue = {
  check: string
  message: string
  evidence?: Record<string, string | number | boolean>
  severity?: Severity
  /** The element it's about, outlined on that render's screenshot. */
  box?: Box
}

/**
 * Turns per-render issues into findings. The same check on English and Arabic is one
 * finding about both, so a site-wide template problem isn't counted twice per page.
 */
export function report<O>(
  pair: Pick<SnapshotPair, 'route'>,
  ctx: Pick<RuleContext<O>, 'finding'>,
  rule: string,
  selector: string,
  issues: Partial<Record<Dir, Issue[]>>,
): Finding[] {
  const ltr = issues.ltr ?? []
  const rtl = issues.rtl ?? []
  const findings: Finding[] = []
  const both = new Set(ltr.filter((i) => rtl.some((r) => r.check === i.check)).map((i) => i.check))
  for (const [dir, list] of [
    ['ltr', ltr],
    ['rtl', rtl],
  ] as const) {
    for (const issue of list) {
      const shared = both.has(issue.check)
      if (shared && dir === 'rtl') continue
      const side = shared ? 'both' : dir
      const twin = shared ? rtl.find((r) => r.check === issue.check) : undefined
      const boxes = {
        ...(issue.box ? { [dir]: issue.box } : {}),
        ...(twin?.box ? { rtl: twin.box } : {}),
      }
      findings.push(
        ctx.finding({
          rule,
          route: pair.route,
          selector,
          boxes,
          message: shared ? issue.message : `${LANGUAGE[dir]}: ${issue.message}`,
          evidence: { check: issue.check, side, ...issue.evidence },
          ...(issue.severity ? { severity: issue.severity } : {}),
        }),
      )
    }
  }
  return findings
}
