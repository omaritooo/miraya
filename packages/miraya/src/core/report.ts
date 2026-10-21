import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Report } from '../types'

// Whitespace around null is tolerated, so formatting the viewer's index.html can't break it.
const PLACEHOLDER = /<script type="application\/json" id="miraya-data">\s*null\s*<\/script>/

/** The built viewer sits next to the bundle in dist/, or under dist/ when running from source. */
function templatePath(): string {
  const candidates = ['./report/index.html', '../../dist/report/index.html'].map((p) =>
    fileURLToPath(new URL(p, import.meta.url)),
  )
  const found = candidates.find((p) => existsSync(p))
  if (!found) throw new Error('The report viewer is missing; run `pnpm build` in packages/miraya')
  return found
}

// <, and the line and paragraph separators U+2028 and U+2029, which end a line in JS.
const UNSAFE = new RegExp(`[<${String.fromCharCode(0x2028, 0x2029)}]`, 'g')

/** JSON that is safe inside a <script> element, whatever text the audited page contained. */
function scriptSafeJson(value: unknown) {
  return JSON.stringify(value).replace(
    UNSAFE,
    (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`,
  )
}

/**
 * Writes report.html: the single-file viewer with the report and its screenshots
 * inlined, so it opens from disk, a CI artifact or an email attachment. Past
 * maxInlineBytes, screenshots are referenced next to the file instead, and the
 * artifact must then include the routes/ folder (DESIGN.md › report.html).
 */
export function writeHtmlReport(
  report: Report,
  outDir: string,
  { maxInlineBytes = 25 * 1024 * 1024 } = {},
): { file: string; inlined: boolean } {
  const paths = [
    ...new Set(report.routes.flatMap((r) => [r.screenshots.ltr, r.screenshots.rtl])),
  ].filter((p): p is string => !!p && existsSync(join(outDir, p)))
  const total = paths.reduce((sum, p) => sum + statSync(join(outDir, p)).size, 0)
  const inlined = total * (4 / 3) <= maxInlineBytes
  const images = Object.fromEntries(
    paths.map((p) => [
      p,
      inlined ? `data:image/jpeg;base64,${readFileSync(join(outDir, p)).toString('base64')}` : p,
    ]),
  )
  const template = readFileSync(templatePath(), 'utf8')
  if (!PLACEHOLDER.test(template)) throw new Error('The report viewer has no data placeholder')
  const html = template.replace(
    PLACEHOLDER,
    () =>
      `<script type="application/json" id="miraya-data">${scriptSafeJson({ report, images })}</script>`,
  )
  const file = join(outDir, 'report.html')
  writeFileSync(file, html)
  return { file, inlined }
}
