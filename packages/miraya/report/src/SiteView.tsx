import { useState, type ReactNode } from 'react'
import { GLYPHS, plural } from './copy'
import { isKnown, worst, type Finding, type Report, type RouteResult } from './data'
import { Segmented } from './ui'

type Dir = 'ltr' | 'rtl'
export type Site = 'titles' | 'links'

export const SITE_VIEWS: { id: Site; label: string; rules: string[] }[] = [
  {
    id: 'titles',
    label: 'Titles and descriptions',
    rules: ['page-title', 'meta-description', 'duplicate-title'],
  },
  { id: 'links', label: 'Language links', rules: ['hreflang', 'canonical'] },
]

const LANGUAGE: Record<Dir, string> = { ltr: 'English', rtl: 'Arabic' }
const onSide = (f: Finding, dir: Dir) => f.evidence.side === dir || f.evidence.side === 'both'
const open = (r: RouteResult, rules: string[]) =>
  r.findings.filter((f) => rules.includes(f.rule) && !isKnown(f))

/** Site-wide SEO: every page's titles and descriptions, or how the languages link to each other. */
export function SiteView({
  report,
  site,
  onOpen,
}: {
  report: Report
  site: Site
  /** Opens a page's SEO view, with one of its findings selected. */
  onOpen: (route: string, finding?: string) => void
}) {
  const view =
    SITE_VIEWS.find((v) => v.id === site) ?? (SITE_VIEWS[0] as (typeof SITE_VIEWS)[number])
  const audited = report.routes.filter((r) => r.head?.rtl)
  return (
    <main className="stage site" id="site-view" tabIndex={-1} aria-label={view.label}>
      <div className="stage-head">
        <h1>{view.label}</h1>
        <span className="muted">{plural(audited.length, 'page')} · English and Arabic</span>
      </div>
      <div className="seo-body">
        {site === 'titles' ? (
          <Titles report={report} rules={view.rules} onOpen={onOpen} />
        ) : (
          <Links report={report} rules={view.rules} onOpen={onOpen} />
        )}
      </div>
    </main>
  )
}

function Flag({ finding, children }: { finding: Finding | undefined; children: ReactNode }) {
  return finding ? (
    <span className={`sev-${finding.severity}`}>
      <span aria-hidden="true">{GLYPHS[finding.severity]}</span> {children}
    </span>
  ) : (
    <>{children}</>
  )
}

function PageLink({
  route,
  onOpen,
}: {
  route: RouteResult
  onOpen: (route: string, finding?: string) => void
}) {
  const [first] = route.findings.filter((f) => f.area === 'seo')
  return (
    <a
      href={`#area=seo&route=${encodeURIComponent(route.route)}`}
      onClick={(e) => {
        e.preventDefault()
        onOpen(route.route, first?.id)
      }}
    >
      <bdi dir="ltr">
        <code>{route.route}</code>
      </bdi>
    </a>
  )
}

function Titles({
  report,
  rules,
  onOpen,
}: {
  report: Report
  rules: string[]
  onOpen: (route: string, finding?: string) => void
}) {
  const [dir, setDir] = useState<Dir>('rtl')
  const [all, setAll] = useState(false)
  const pages = report.routes.filter((r) => r.head?.[dir])
  const flagged = pages.filter((r) => open(r, rules).some((f) => onSide(f, dir)))
  const shown = all ? pages : flagged
  // Pages that share a title stay together, so a group reads as one problem.
  const title = (r: RouteResult) => r.head?.[dir]?.title?.trim().toLowerCase() ?? ''
  const sorted = [...shown].sort((a, b) => {
    const dup = (r: RouteResult) => shown.filter((o) => title(o) && title(o) === title(r)).length
    return dup(b) - dup(a) || title(a).localeCompare(title(b))
  })
  const groups = new Set<string>()
  const lengthFlag = (r: RouteResult, rule: string, check?: string) =>
    open(r, [rule]).find((f) => onSide(f, dir) && (!check || f.evidence.check === check))

  return (
    <>
      <div className="site-tools">
        <Segmented
          label="Language"
          options={['ltr', 'rtl'] as const}
          value={dir}
          text={(d) => LANGUAGE[d]}
          onChange={setDir}
        />
        <span className="muted">
          {plural(flagged.length, 'page')} with findings in {LANGUAGE[dir]}
        </span>
      </div>
      <div className="table-box">
        <table className="evidence site-table">
          <caption className="sr">Titles and descriptions in {LANGUAGE[dir]}</caption>
          <thead>
            <tr>
              <th scope="col">Page</th>
              <th scope="col">Title</th>
              <th scope="col">Length</th>
              <th scope="col">Description</th>
              <th scope="col">Length</th>
            </tr>
          </thead>
          <tbody {...(dir === 'rtl' ? { lang: 'ar' } : {})}>
            {sorted.flatMap((r) => {
              const head = r.head?.[dir]
              const dup = lengthFlag(r, 'duplicate-title', 'title')
              const key = title(r)
              const rows: ReactNode[] = []
              if (dup && !groups.has(key)) {
                groups.add(key)
                const count = Number(dup.evidence.pages) || 2
                rows.push(
                  <tr key={`group-${key}`} className="site-group">
                    <th scope="rowgroup" colSpan={5} lang="en">
                      <Flag finding={dup}>
                        Same title on {plural(count, 'page')}: “<bdi>{head?.title}</bdi>”
                      </Flag>
                    </th>
                  </tr>,
                )
              }
              const titleFlag = lengthFlag(r, 'page-title')
              const descFlag = lengthFlag(r, 'meta-description')
              rows.push(
                <tr key={r.route}>
                  <th scope="row" lang="en">
                    <PageLink route={r} onOpen={onOpen} />
                  </th>
                  <td dir={dir}>
                    {head?.title ? (
                      <bdi>{head.title}</bdi>
                    ) : (
                      <span lang="en" dir="ltr">
                        <Flag finding={titleFlag}>missing</Flag>
                      </span>
                    )}
                  </td>
                  <td lang="en">
                    <Flag finding={titleFlag}>{head?.title?.length ?? 0}</Flag>
                  </td>
                  <td dir={dir}>
                    {head?.description ? (
                      <bdi className="clamp">{head.description}</bdi>
                    ) : (
                      <span lang="en" dir="ltr">
                        <Flag finding={descFlag}>missing</Flag>
                      </span>
                    )}
                  </td>
                  <td lang="en">
                    <Flag finding={descFlag}>{head?.description?.length ?? 0}</Flag>
                  </td>
                </tr>,
              )
              return rows
            })}
            {sorted.length === 0 ? (
              <tr>
                <td colSpan={5} lang="en">
                  No title or description findings in {LANGUAGE[dir]}.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
      {pages.length > flagged.length ? (
        <button
          type="button"
          className="link site-more"
          aria-expanded={all}
          onClick={() => setAll(!all)}
        >
          {all
            ? 'Only pages with findings'
            : `Show ${plural(pages.length - flagged.length, 'page')} with no findings`}
        </button>
      ) : null}
    </>
  )
}

/** One cell: a tick, or the worst finding among these checks on this side. */
function LinkCell({
  findings,
  checks,
  side,
  ok,
}: {
  findings: Finding[]
  checks: string[]
  side?: Dir
  ok: string
}) {
  const own = findings.filter(
    (f) => checks.includes(String(f.evidence.check)) && (!side || onSide(f, side)),
  )
  const sev = worst(own) ?? own[0]?.severity
  const first = own.find((f) => f.severity === sev)
  if (!first) {
    return (
      <td>
        <span className="pos">
          <span aria-hidden="true">✓</span> {ok}
        </span>
      </td>
    )
  }
  const sides =
    own.length > 1 || first.evidence.side === 'both'
      ? ''
      : ` (${first.evidence.side === 'ltr' ? 'en' : 'ar'})`
  return (
    <td>
      <span className={`sev-${first.severity}`} title={first.message}>
        <span aria-hidden="true">{GLYPHS[first.severity]}</span>{' '}
        {String(first.evidence.check).replace(/-/g, ' ')}
        {side ? '' : sides}
      </span>
    </td>
  )
}

function Links({
  report,
  rules,
  onOpen,
}: {
  report: Report
  rules: string[]
  onOpen: (route: string, finding?: string) => void
}) {
  const pair = report.config.mode === 'pair'
  return (
    <>
      <p className="caption">
        Does each page link to its twin in the other language, and does the twin link back? Hover a
        finding for its message; open the page for details.
      </p>
      <div className="table-box">
        <table className="evidence site-table">
          <caption className="sr">Language links</caption>
          <thead>
            <tr>
              <th scope="col">Page</th>
              {pair ? (
                <>
                  <th scope="col">en → ar</th>
                  <th scope="col">ar → en</th>
                </>
              ) : null}
              <th scope="col">x-default</th>
              <th scope="col">lang matches</th>
              <th scope="col">Canonical</th>
            </tr>
          </thead>
          <tbody>
            {report.routes.map((r) => {
              const findings = r.findings.filter((f) => rules.includes(f.rule))
              const hreflang = findings.filter((f) => f.rule === 'hreflang')
              const canonical = findings.filter((f) => f.rule === 'canonical')
              const skipped = r.status === 'error' || !r.head?.rtl
              const twin = ['missing', 'wrong-twin', 'no-twin']
              return (
                <tr key={r.route}>
                  <th scope="row">
                    <PageLink route={r} onOpen={onOpen} />
                  </th>
                  {skipped ? (
                    <td colSpan={pair ? 5 : 3} className="muted">
                      Skipped: {r.errors[0]?.message ?? 'no head tags in this report'}
                    </td>
                  ) : r.skippedRules.includes('hreflang') && pair ? (
                    <>
                      <td colSpan={4} className="muted">
                        Both languages share one URL, so there are no language links to check.
                      </td>
                      <LinkCell findings={canonical} checks={CANONICAL} ok="self" />
                    </>
                  ) : (
                    <>
                      {pair ? (
                        <>
                          <LinkCell findings={hreflang} checks={twin} side="ltr" ok="" />
                          <LinkCell findings={hreflang} checks={twin} side="rtl" ok="" />
                        </>
                      ) : null}
                      {hreflang.some((f) => f.evidence.check === 'missing') ? (
                        // Without language links there's nothing more to check.
                        <>
                          <td className="muted">–</td>
                          <td className="muted">–</td>
                        </>
                      ) : (
                        <>
                          <LinkCell findings={hreflang} checks={['no-x-default']} ok="" />
                          <LinkCell
                            findings={hreflang}
                            checks={['lang-mismatch', 'twin-lang', 'no-self']}
                            ok=""
                          />
                        </>
                      )}
                      <LinkCell findings={canonical} checks={CANONICAL} ok="self" />
                    </>
                  )}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </>
  )
}

const CANONICAL = ['missing', 'several', 'points-at-twin', 'other-origin', 'invalid']
