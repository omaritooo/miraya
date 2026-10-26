import { useState, type ReactNode } from 'react'
import { GLYPHS, plural, routeSummary, SIDE_WORDS } from './copy'
import { isKnown, worst, type Finding, type PageHead, type RouteResult } from './data'

type Dir = 'ltr' | 'rtl'

// The rules' default limits; what search results show of a title and a description.
const TITLE_MAX = 60
const DESCRIPTION_MAX = 160

/** One row per tag group, with the rule that checks it. */
/** This side's findings of the row's rule: the cell notes what's wrong next to the value. */
type Own = Finding[]
const onSide = (f: Finding, dir: Dir) => f.evidence.side === dir || f.evidence.side === 'both'

const ROWS: {
  tag: string
  rule: string
  cell: (head: PageHead, dir: Dir, own: Own) => ReactNode
}[] = [
  {
    tag: 'title',
    rule: 'page-title',
    cell: (head) =>
      head.title ? <Text text={head.title} max={TITLE_MAX} /> : <Missing>missing</Missing>,
  },
  {
    tag: 'description',
    rule: 'meta-description',
    cell: (head) =>
      head.description ? (
        <Text text={head.description} max={DESCRIPTION_MAX} />
      ) : (
        <Missing>missing</Missing>
      ),
  },
  {
    tag: 'canonical',
    rule: 'canonical',
    cell: (head, _dir, own) => {
      const twin = own.find((f) => f.evidence.check === 'points-at-twin')
      return (
        <>
          {head.canonical.length ? (
            head.canonical.map((href) => (
              <code key={href} className={`url${twin ? ' sev-error' : ''}`} dir="ltr">
                {href}
              </code>
            ))
          ) : (
            <Missing>missing</Missing>
          )}
          {twin ? (
            <span className="cell-note sev-error" lang="en" dir="ltr">
              Points at the other language’s page. Expected{' '}
              <code className="url">{path(String(twin.evidence.expected))}</code>
            </span>
          ) : null}
        </>
      )
    },
  },
  {
    tag: 'robots',
    rule: 'robots-noindex',
    cell: (head) => (
      <>
        {head.robots ? <code dir="ltr">{head.robots}</code> : null}
        {head.http?.robots ? <code dir="ltr">X-Robots-Tag: {head.http.robots}</code> : null}
        {!head.robots && !head.http?.robots ? <Missing>not set: indexable</Missing> : null}
      </>
    ),
  },
  {
    tag: 'hreflang',
    rule: 'hreflang',
    cell: (head, _dir, own) => {
      const checks = new Set(own.map((f) => String(f.evidence.check)))
      // A tick when the link checks out: nothing is wrong with the language links on this side.
      const fine = !['wrong-twin', 'no-twin', 'twin-lang', 'lang-mismatch'].some((c) =>
        checks.has(c),
      )
      return head.alternates.length ? (
        <>
          {head.alternates.map((a) => (
            <span key={`${a.hreflang}${a.href}`} dir="ltr" className="pair">
              <code>{a.hreflang}</code> → <code className="url">{path(a.href)}</code>
              {fine ? (
                <span className="pos" aria-label="correct">
                  {' '}
                  ✓
                </span>
              ) : null}
            </span>
          ))}
          {checks.has('no-x-default') ? (
            <span className="cell-note sev-info" lang="en" dir="ltr">
              no <code>x-default</code>
            </span>
          ) : null}
        </>
      ) : (
        <Missing>none</Missing>
      )
    },
  },
  {
    tag: 'h1',
    rule: 'single-h1',
    cell: (head) =>
      head.h1.length ? (
        head.h1.map((text, i) => (
          <span key={i}>
            <bdi>{text || '(empty)'}</bdi>
          </span>
        ))
      ) : (
        <Missing>none</Missing>
      ),
  },
  {
    tag: 'og:*',
    rule: 'social-preview',
    cell: (head) => {
      const tags = Object.entries(head.social).filter(([k]) => k.startsWith('og:'))
      return tags.length ? (
        tags.slice(0, 4).map(([k, v]) => (
          <span key={k} dir="ltr">
            <code>{k}</code> <bdi>{v}</bdi>
          </span>
        ))
      ) : (
        <Missing>none</Missing>
      )
    },
  },
  {
    tag: 'JSON-LD',
    rule: 'structured-data',
    cell: (head) =>
      head.jsonLd.length ? (
        head.jsonLd.map((block, i) => (
          <span key={i}>
            {block.error ? (
              <span className="sev-error">invalid JSON</span>
            ) : (
              <code>{block.types.join(', ') || 'no @type'}</code>
            )}
          </span>
        ))
      ) : (
        <Missing>none</Missing>
      ),
  },
]

/** A note in place of a value: English, and laid out as English, in either column. */
const Missing = ({ children }: { children: ReactNode }) => (
  <span className="muted" lang="en" dir="ltr">
    {children}
  </span>
)

function path(href: string) {
  try {
    const url = new URL(href)
    return `${url.pathname}${url.search}`
  } catch {
    return href
  }
}

/** Text with a character count; what search results cut off is marked. */
function Text({ text, max }: { text: string; max: number }) {
  const over = text.length - max
  return (
    <>
      <bdi>
        {text.slice(0, max)}
        {over > 0 ? <mark>{text.slice(max)}</mark> : null}
      </bdi>
      <span className={`count${over > 0 ? ' sev-warn' : ''}`} lang="en" dir="ltr">
        {plural(text.length, 'character')}
        {over > 0 ? `, ${over} over ${max}` : ''}
      </span>
    </>
  )
}

/** What the page's head tags say, side by side for both languages, and how search results draw it. */
export function SeoStage({
  route,
  findings,
  selected,
  onSelect,
}: {
  route: RouteResult
  findings: Finding[]
  selected: Finding | undefined
  onSelect: (id: string) => void
}) {
  const [onlyFindings, setOnlyFindings] = useState(false)
  const dirs: Dir[] = route.head?.ltr ? ['ltr', 'rtl'] : ['rtl']
  const status = route.head?.rtl?.http?.status
  const dev = findings.find((f) => f.rule === 'robots-noindex' && f.evidence.local === true)
  const rows = ROWS.filter((row) => !onlyFindings || findings.some((f) => f.rule === row.rule))

  return (
    <main className="stage seo" aria-label="Head tags">
      <div className="toolbar" role="toolbar" aria-label="View">
        <label className="check">
          <input
            type="checkbox"
            checked={onlyFindings}
            onChange={(e) => setOnlyFindings(e.target.checked)}
          />
          Only rows with findings
        </label>
      </div>

      <div className="stage-head">
        <h1>
          <bdi dir="ltr">{route.route}</bdi>
        </h1>
        <span className="muted">
          {route.status === 'error' ? 'Not audited' : routeSummary(findings, route.durationMs)}
          {status ? (
            <>
              {' · '}
              <code dir="ltr">HTTP {status}</code>
            </>
          ) : null}
          {' · read from '}
          <code>&lt;head&gt;</code> and response headers
        </span>
      </div>

      <div className="seo-body">
        {dev ? (
          <div className="banner banner-warn" role="note">
            <span aria-hidden="true">▲</span>
            <p>
              This run audited a development server, where <code>noindex</code> is expected. So{' '}
              <code>robots-noindex</code> is listed as info and doesn't fail the run. Check it
              against the production site.
            </p>
          </div>
        ) : null}

        {!route.head ? (
          <p className="state muted">
            {route.status === 'error'
              ? "This page couldn't be audited, so its tags weren't read."
              : 'This report has no head tags for this page. Reports from Miraya 0.4 and later have them.'}
          </p>
        ) : (
          <>
            <div className="table-box">
              <table className="head-table">
                <caption className="sr">Head tags on English and Arabic</caption>
                <thead>
                  <tr>
                    <th scope="col">Tag</th>
                    {dirs.map((dir) => (
                      <th scope="col" key={dir}>
                        {dir === 'ltr' ? 'English' : 'Arabic'}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => {
                    const own = findings.filter((f) => f.rule === row.rule)
                    const sev = worst(own) ?? own[0]?.severity
                    const sides = [...new Set(own.map((f) => String(f.evidence.side)))]
                    const current = own.includes(selected as Finding)
                    return (
                      <tr key={row.tag} className={sev ? `row-${sev}` : undefined}>
                        <th scope="row">
                          <code>{row.tag}</code>
                          {own[0] ? (
                            <button
                              type="button"
                              className={`row-findings sev-${sev}`}
                              aria-pressed={current}
                              onClick={() => onSelect((own[0] as Finding).id)}
                            >
                              <span aria-hidden="true">{GLYPHS[sev ?? 'info']}</span> {own.length} ·{' '}
                              {sides.map((s) => SIDE_WORDS[s] ?? s).join(', ')}
                              <span className="sr">
                                {' '}
                                {own.length === 1 ? 'finding' : 'findings'}, show
                              </span>
                            </button>
                          ) : null}
                          {own.length > 0 && own.every(isKnown) ? (
                            <span className="tag">Known</span>
                          ) : null}
                        </th>
                        {dirs.map((dir) => {
                          const head = route.head?.[dir]
                          return (
                            <td key={dir} {...(dir === 'rtl' ? { lang: 'ar', dir: 'rtl' } : {})}>
                              <div className="cell">
                                {head
                                  ? row.cell(
                                      head,
                                      dir,
                                      own.filter((f) => onSide(f, dir)),
                                    )
                                  : null}
                              </div>
                            </td>
                          )
                        })}
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            <h2 className="seo-h2">Search result, as drawn from the page's tags</h2>
            <div className="previews">
              {dirs.map((dir) => {
                const head = route.head?.[dir]
                return head ? (
                  <SearchResult key={dir} dir={dir} head={head} findings={findings} />
                ) : null
              })}
            </div>
          </>
        )}
      </div>
    </main>
  )
}

const cut = (text: string, max: number) =>
  text.length > max ? `${text.slice(0, max).trimEnd()} …` : text

/** A search result as drawn from the tags, in a neutral search-engine style; it doesn't follow the theme. */
function SearchResult({ dir, head, findings }: { dir: Dir; head: PageHead; findings: Finding[] }) {
  const url = head.canonical[0]
  const crumb = (() => {
    try {
      const u = new URL(url ?? '')
      return [u.host, ...u.pathname.split('/').filter(Boolean)].join(' › ')
    } catch {
      return url ?? ''
    }
  })()
  const onSide = (f: Finding) => f.evidence.side === dir || f.evidence.side === 'both'
  const notes = findings.filter(
    (f) => onSide(f) && ['page-title', 'meta-description', 'canonical'].includes(f.rule),
  )
  return (
    <figure className="serp" dir={dir} lang={dir === 'rtl' ? 'ar' : 'en'}>
      <figcaption className="sr">{dir === 'ltr' ? 'English' : 'Arabic'} search result</figcaption>
      <div className="serp-url" dir="ltr">
        {crumb || 'no canonical URL'}
      </div>
      <div className="serp-title">{head.title ? cut(head.title, TITLE_MAX) : 'Untitled'}</div>
      <div className="serp-text">
        {head.description ? (
          cut(head.description, DESCRIPTION_MAX)
        ) : (
          <Missing>No description: the search engine picks text from the page.</Missing>
        )}
      </div>
      {notes.map((f) => (
        <p key={f.id} className={`serp-note sev-${f.severity}`} dir="ltr" lang="en">
          <span aria-hidden="true">{GLYPHS[f.severity]}</span>{' '}
          {f.message.replace(/^(English|Arabic): /, '')}
        </p>
      ))}
    </figure>
  )
}
