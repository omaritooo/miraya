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
      <div className="seo-body site-body">
        <p className="sr">{plural(audited.length, 'page')} · English and Arabic</p>
        {site === 'titles' ? (
          <Titles report={report} rules={view.rules} onOpen={onOpen} level={1} />
        ) : (
          <Links report={report} rules={view.rules} onOpen={onOpen} level={1} />
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

export function Titles({
  report,
  rules,
  onOpen,
  level = 2,
}: {
  report: Report
  rules: string[]
  onOpen: (route: string, finding?: string) => void
  /** 1 where the table is the page's main content. */
  level?: 1 | 2
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
  const flagOf = (r: RouteResult, rule: string, check?: string) =>
    open(r, [rule]).find((f) => onSide(f, dir) && (!check || f.evidence.check === check))
  const dupGroups = new Set(pages.filter((r) => flagOf(r, 'duplicate-title', 'title')).map(title))
    .size
  const longDescriptions = pages.filter(
    (r) => flagOf(r, 'meta-description')?.evidence.check === 'long',
  ).length
  const Heading = level === 1 ? 'h1' : 'h2'

  return (
    <section className="panel" aria-labelledby="titles-title">
      <div className="panel-head">
        <Heading id="titles-title">Titles and descriptions</Heading>
        <span className="muted">
          {[
            plural(pages.length, 'page'),
            dupGroups ? plural(dupGroups, 'duplicate group') : '',
            longDescriptions ? `${plural(longDescriptions, 'description')} too long` : '',
          ]
            .filter(Boolean)
            .join(' · ')}
        </span>
        <span className="spacer" />
        <Segmented
          label="Language"
          options={['ltr', 'rtl'] as const}
          value={dir}
          text={(d) => LANGUAGE[d]}
          onChange={setDir}
        />
      </div>
      <div className="table-box table-flush">
        <table className="evidence site-table">
          <caption className="sr">Titles and descriptions in {LANGUAGE[dir]}</caption>
          <thead>
            <tr>
              <th scope="col">Page</th>
              <th scope="col">Title</th>
              <th scope="col">Title length</th>
              <th scope="col">Description</th>
              <th scope="col">Description length</th>
            </tr>
          </thead>
          <tbody>
            {sorted.flatMap((r) => {
              const head = r.head?.[dir]
              const dup = flagOf(r, 'duplicate-title', 'title')
              const key = title(r)
              const rows: ReactNode[] = []
              if (dup && !groups.has(key)) {
                groups.add(key)
                const count = Number(dup.evidence.pages) || 2
                rows.push(
                  <tr key={`group-${key}`} className="site-group">
                    <th scope="rowgroup" colSpan={5}>
                      <Flag finding={dup}>
                        Same title on {plural(count, 'page')}: “<bdi>{head?.title}</bdi>”
                      </Flag>
                    </th>
                  </tr>,
                )
              }
              const titleFlag = flagOf(r, 'page-title')
              const descFlag = flagOf(r, 'meta-description')
              const lang = dir === 'rtl' ? { lang: 'ar', dir: 'rtl' } : {}
              rows.push(
                <tr key={r.route}>
                  <th scope="row">
                    <PageLink route={r} onOpen={onOpen} />
                  </th>
                  <td>
                    {head?.title ? (
                      <bdi {...lang}>{head.title}</bdi>
                    ) : (
                      <Flag finding={titleFlag}>missing</Flag>
                    )}
                  </td>
                  <td>
                    <LengthBar
                      length={head?.title?.length ?? 0}
                      max={Number(titleFlag?.evidence.max) || 60}
                      flag={titleFlag}
                    />
                  </td>
                  <td>
                    {head?.description ? (
                      <bdi className="clamp" {...lang}>
                        {head.description}
                      </bdi>
                    ) : (
                      <Flag finding={descFlag}>missing</Flag>
                    )}
                  </td>
                  <td>
                    <LengthNote length={head?.description?.length ?? 0} flag={descFlag} />
                  </td>
                </tr>,
              )
              return rows
            })}
            {sorted.length === 0 ? (
              <tr>
                <td colSpan={5}>No title or description findings in {LANGUAGE[dir]}.</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
      {pages.length > flagged.length ? (
        <div className="panel-foot">
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
        </div>
      ) : null}
    </section>
  )
}

/** A title's length as a short bar, coloured when it's over or under the rule's limits. */
function LengthBar({ length, max, flag }: { length: number; max: number; flag?: Finding }) {
  const width = Math.min(1, length / max) * 60
  return (
    <span className="length">
      <span className={`length-bar${flag ? ' length-off' : ''}`} aria-hidden="true">
        <span style={{ inlineSize: `${width}px` }} />
      </span>
      <LengthNote length={length} flag={flag} />
    </span>
  )
}

/** "182, 22 over" or "35, under 50": the number, and what's wrong with it. */
function LengthNote({ length, flag }: { length: number; flag?: Finding }) {
  if (!flag) return <span className="num">{length}</span>
  const { check, max, min } = flag.evidence
  const note =
    check === 'missing'
      ? 'none'
      : check === 'long' && typeof max === 'number'
        ? `${length}, ${length - max} over`
        : check === 'short' && typeof min === 'number'
          ? `${length}, under ${min}`
          : String(length)
  return (
    <span className="num">
      <Flag finding={flag}>{note}</Flag>
    </span>
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
          {ok ? null : <span className="sr">fine</span>}
        </span>
      </td>
    )
  }
  const sides =
    own.length > 1 || first.evidence.side === 'both'
      ? ''
      : ` (${first.evidence.side === 'ltr' ? 'en' : 'ar'})`
  return (
    <td className={`cell-${first.severity}`}>
      <span className={`sev-${first.severity}`} title={first.message}>
        <span aria-hidden="true">{GLYPHS[first.severity]}</span>{' '}
        {String(first.evidence.check).replace(/-/g, ' ')}
        {side ? '' : sides}
      </span>
    </td>
  )
}

export function Links({
  report,
  rules,
  onOpen,
  level = 2,
}: {
  report: Report
  rules: string[]
  onOpen: (route: string, finding?: string) => void
  level?: 1 | 2
}) {
  const pair = report.config.mode === 'pair'
  const Heading = level === 1 ? 'h1' : 'h2'
  return (
    <section className="panel" aria-labelledby="links-title">
      <div className="panel-head">
        <Heading id="links-title">Language links</Heading>
        <span className="muted">
          Does each page point at its twin, and does the twin point back?
        </span>
      </div>
      <div className="table-box table-flush">
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
      <p className="panel-foot caption">
        Hover a finding for its message; open the page for details.
      </p>
    </section>
  )
}

const CANONICAL = ['missing', 'several', 'points-at-twin', 'other-origin', 'invalid']
