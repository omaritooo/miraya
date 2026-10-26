import type { Dir, Finding, PageHead, RuleContext, Severity, SnapshotPair } from '../../types'

export const LANGUAGE: Record<Dir, string> = { ltr: 'English', rtl: 'Arabic' }

export type Side = { dir: Dir; head: PageHead; url: string; lang: string }

/** The renders to check: English and Arabic, or Arabic alone in --rtl-only mode. */
export function sides(pair: SnapshotPair): Side[] {
  return (['ltr', 'rtl'] as const).flatMap((dir) => {
    const snap = pair[dir]
    return snap ? [{ dir, head: snap.head, url: snap.finalUrl, lang: snap.lang }] : []
  })
}

/** One problem on one render. `check` names it; equal checks on both renders become one finding. */
export type Issue = {
  check: string
  message: string
  evidence?: Record<string, string | number | boolean>
  severity?: Severity
}

/**
 * Turns per-render issues into findings. The same check on English and Arabic is one
 * finding about both, so a site-wide template problem isn't counted twice per page.
 */
export function report<O>(
  pair: SnapshotPair,
  ctx: RuleContext<O>,
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
      findings.push(
        ctx.finding({
          rule,
          route: pair.route,
          selector,
          boxes: {},
          message: shared ? issue.message : `${LANGUAGE[dir]}: ${issue.message}`,
          evidence: { check: issue.check, side, ...issue.evidence },
          ...(issue.severity ? { severity: issue.severity } : {}),
        }),
      )
    }
  }
  return findings
}

/** URL without its hash and trailing slash, for comparing links with pages. */
export function sameUrl(a: string, b: string): boolean {
  const norm = (u: string) => {
    try {
      const url = new URL(u)
      url.hash = ''
      return url.href.replace(/\/+$/, '').replace(/\/(\?)/, '$1')
    } catch {
      return u
    }
  }
  return norm(a) === norm(b)
}

/** A page served on a development machine, where noindex and missing tags are often on purpose. */
export function isLocal(url: string): boolean {
  try {
    const host = new URL(url).hostname
    return (
      host === 'localhost' ||
      host === '[::1]' ||
      /^127\./.test(host) ||
      /^(10|192\.168)\./.test(host) ||
      host.endsWith('.localhost') ||
      host.endsWith('.local') ||
      host.endsWith('.test')
    )
  } catch {
    return false
  }
}

/** True when the app switches language without changing the URL, so both renders share one. */
export const sharedUrl = (pair: SnapshotPair) =>
  !!pair.ltr && sameUrl(pair.ltr.finalUrl, pair.rtl.finalUrl)
