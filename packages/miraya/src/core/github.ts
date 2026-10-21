import { appendFileSync } from 'node:fs'
import type { Finding, Report, Severity } from '../types'

/** GitHub's per-step limits for each annotation type (as documented when this was written). */
const PER_TYPE = 10
const SUMMARY_ROWS = 200
const COMMAND: Record<Severity, 'error' | 'warning' | 'notice'> = {
  error: 'error',
  warn: 'warning',
  info: 'notice',
}
const RANK: Record<Severity, number> = { error: 0, warn: 1, info: 2 }

// Workflow command escaping: data and property values have different rules.
const escapeData = (s: string) => s.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A')
const escapeProperty = (s: string) => escapeData(s).replace(/:/g, '%3A').replace(/,/g, '%2C')

/** "src/components/Nav.vue:12:3" to file, line and column properties. */
function location(hint: string | undefined): string {
  const m = hint && /^(.*?):(\d+)(?::(\d+))?$/.exec(hint)
  if (!m) return ''
  return `,file=${escapeProperty(m[1] ?? '')},line=${m[2]}${m[3] ? `,col=${m[3]}` : ''}`
}

/**
 * Workflow commands for the most severe new findings, up to GitHub's per-type cap.
 * Without a sourceHint, an annotation still lists in the run but can't sit on the diff.
 */
export function githubAnnotations(report: Report): string[] {
  const fresh = report.routes
    .flatMap((r) => r.findings)
    .filter((f) => f.status !== 'baselined')
    .sort((a, b) => RANK[a.severity] - RANK[b.severity])
  const used: Record<string, number> = {}
  const lines: string[] = []
  for (const f of fresh) {
    const command = COMMAND[f.severity]
    used[command] = (used[command] ?? 0) + 1
    if ((used[command] ?? 0) > PER_TYPE) continue
    const title = escapeProperty(`miraya/${f.rule}`)
    lines.push(
      `::${command} title=${title}${location(f.sourceHint)}::${escapeData(`${f.route} ${f.selector}: ${f.message} ${f.docsUrl}`)}`,
    )
  }
  for (const route of report.routes) {
    for (const error of route.errors) {
      lines.push(
        `::error title=${escapeProperty('miraya/route-error')}::${escapeData(`${route.route}: ${error.kind}: ${error.message}`)}`,
      )
    }
  }
  return lines
}

const cell = (s: string) => s.replace(/\|/g, '\\|').replace(/\n/g, ' ')

/** Markdown for $GITHUB_STEP_SUMMARY: one table per route of new findings, truncated well under GitHub's 1 MiB limit. */
export function githubSummary(report: Report): string {
  const s = report.summary
  const out = [
    '## Miraya RTL audit',
    '',
    `${s.routes} routes · ${s.findings.error} errors · ${s.findings.warn} warnings · ${s.findings.info} info · ${s.new} new · ${s.baselined} baselined · ${s.fixed} fixed`,
    '',
  ]
  let rows = 0
  for (const route of report.routes) {
    const fresh = route.findings.filter((f: Finding) => f.status !== 'baselined')
    if (!fresh.length && !route.errors.length) continue
    out.push(`### \`${route.route}\``, '')
    for (const e of route.errors) out.push(`> **${e.kind}**: ${cell(e.message)}`, '')
    if (!fresh.length) continue
    out.push('| Severity | Rule | Element | Message |', '| --- | --- | --- | --- |')
    for (const f of fresh) {
      if (rows++ >= SUMMARY_ROWS) break
      out.push(
        `| ${f.severity} | [${f.rule}](${f.docsUrl}) | \`${cell(f.selector)}\` | ${cell(f.message)} |`,
      )
    }
    out.push('')
    if (rows >= SUMMARY_ROWS) {
      out.push(`Truncated after ${SUMMARY_ROWS} rows; the full list is in the report artifact.`, '')
      break
    }
  }
  if (report.fixed.length)
    out.push(
      `${report.fixed.length} baseline entries are fixed; run \`miraya baseline update\` to prune them.`,
      '',
    )
  return out.join('\n')
}

/** Prints annotations and appends the job summary when running on GitHub Actions. */
export function writeGithubOutput(
  report: Report,
  env = process.env,
  print = (line: string) => console.log(line),
) {
  for (const line of githubAnnotations(report)) print(line)
  if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, `${githubSummary(report)}\n`)
}
