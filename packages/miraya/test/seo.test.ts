import { describe, expect, it } from 'vitest'
import { resolveRules, runRules, runSiteRules } from '../src/core/engine'
import { builtinRules } from '../src/rules'
import type { PageHead, SnapshotPair } from '../src/types'
import { config, snapshot } from './helpers'

const EN = 'https://bayn.app/pricing'
const AR = 'https://bayn.app/ar/pricing'

/** A page that passes every SEO rule; tests override what they're about. */
function head(url: string, twin: string, lang: 'en' | 'ar'): Partial<PageHead> {
  const english = lang === 'en'
  return {
    title: english ? 'Pricing · Bayn' : 'الأسعار · بين',
    description: english
      ? 'Compare Starter, Team and Business plans, each with unlimited projects and audit logs.'
      : 'قارن بين خطط المبتدئ والفريق والأعمال، وكلها بمشاريع غير محدودة وسجلات تدقيق كاملة.',
    canonical: [url],
    alternates: [
      { hreflang: lang, href: url },
      { hreflang: english ? 'ar' : 'en', href: twin },
      { hreflang: 'x-default', href: EN },
    ],
    social: { 'og:title': 'Pricing', 'og:description': 'Plans', 'og:image': `${EN}.png` },
    jsonLd: [{ types: ['Product'] }],
    h1: [english ? 'Plans that grow with your team' : 'خطط تنمو مع فريقك'],
    http: { status: 200 },
  }
}

function pair(
  ltr: Partial<PageHead> = {},
  rtl: Partial<PageHead> = {},
  urls: { ltr: string; rtl: string } = { ltr: EN, rtl: AR },
): SnapshotPair {
  const at = (url: string) => ({ url, finalUrl: url })
  return {
    route: '/pricing',
    ltr: snapshot('ltr', [], {
      ...at(urls.ltr),
      head: { ...head(urls.ltr, urls.rtl, 'en'), ...ltr },
    }),
    rtl: snapshot('rtl', [], {
      ...at(urls.rtl),
      dir: 'rtl',
      head: { ...head(urls.rtl, urls.ltr, 'ar'), ...rtl },
    }),
    matches: [],
    unmatched: { ltr: [], rtl: [] },
  }
}

function seo(p: SnapshotPair, input: Record<string, unknown> = {}) {
  const c = config({ baseUrl: 'https://bayn.app', ...input })
  return runRules(p, resolveRules(builtinRules, c), c).findings.filter((f) => f.area === 'seo')
}

const brief = (findings: ReturnType<typeof seo>) =>
  findings.map((f) => `${f.rule} ${f.evidence.check} ${f.evidence.side} ${f.severity}`)

describe('SEO rules', () => {
  it('find nothing on a page with complete, translated tags', () => {
    expect(seo(pair())).toEqual([])
  })

  it('report a problem on both languages once, and one-sided problems per language', () => {
    const findings = seo(pair({ title: '' }, { title: '', description: 'قصير' }))
    expect(brief(findings)).toEqual([
      'meta-description short rtl info',
      'page-title missing both error',
    ])
    expect(findings[0]?.message).toMatch(/^Arabic: /)
  })

  it('flag long titles and descriptions, and the cut-off text', () => {
    const long = `${'Compare plans. '.repeat(12)}so your team can decide without a sales call`
    const findings = seo(
      pair(
        { title: 'Pricing for every team size, from two people to two thousand and more' },
        { description: long },
      ),
    )
    expect(brief(findings)).toEqual(['meta-description long rtl warn', 'page-title long ltr warn'])
    expect(findings[0]?.message).toContain('without a sales call')
  })

  it('flag a title or description left in English on the Arabic page', () => {
    const findings = seo(pair({}, { title: 'Pricing · Bayn' }))
    expect(brief(findings)).toEqual(['page-title untranslated rtl warn'])
    // The attribute switch only flips the layout, so the text is English on purpose.
    expect(
      seo(pair({}, { title: 'Pricing · Bayn' }), { locale: { strategy: 'attribute' } }),
    ).toEqual([])
  })

  it('flag an Arabic page whose canonical names the English one', () => {
    const findings = seo(pair({}, { canonical: [EN] }))
    expect(brief(findings)).toEqual(['canonical points-at-twin rtl error'])
    expect(findings[0]?.evidence).toMatchObject({ target: EN, expected: AR })
  })

  it('check that each language links to the other one', () => {
    const findings = seo(
      pair(
        {
          alternates: [
            { hreflang: 'en', href: EN },
            { hreflang: 'ar', href: 'https://bayn.app/ar' },
            { hreflang: 'x-default', href: EN },
          ],
        },
        { alternates: [{ hreflang: 'ar-eg', href: EN }] },
      ),
    )
    expect(brief(findings)).toEqual([
      'hreflang wrong-twin ltr warn',
      'hreflang twin-lang rtl warn',
      'hreflang no-self rtl info',
      'hreflang no-x-default rtl info',
    ])
  })

  it('skip language links when both languages share one URL', () => {
    expect(
      seo(pair({ alternates: [] }, { alternates: [] }, { ltr: EN, rtl: EN }), {
        locale: { strategy: 'cookie', name: 'lang', ltr: 'en', rtl: 'ar' },
      }),
    ).toEqual([])
  })

  it('treat noindex as an error in production and a note on a dev server', () => {
    const prod = seo(pair({}, { http: { status: 200, robots: 'noindex' } }))
    expect(brief(prod)).toEqual(['robots-noindex noindex rtl error'])
    const local = 'http://localhost:3000'
    const dev = seo(
      pair(
        { robots: 'noindex, nofollow' },
        { robots: 'noindex, nofollow' },
        {
          ltr: `${local}/pricing`,
          rtl: `${local}/ar/pricing`,
        },
      ),
    ).filter((f) => f.rule === 'robots-noindex')
    expect(brief(dev)).toEqual(['robots-noindex noindex both info'])
  })

  it('check h1s, link previews and JSON-LD', () => {
    const findings = seo(
      pair(
        { h1: [], social: {} },
        {
          h1: ['أ', 'ب'],
          social: {},
          jsonLd: [{ types: [], error: 'Unexpected token' }, { types: [] }],
        },
      ),
    )
    expect(brief(findings)).toEqual([
      'single-h1 missing ltr warn',
      'single-h1 several rtl info',
      'social-preview missing og:title, og:description, og:image both info',
      'structured-data invalid 1 rtl error',
      'structured-data untyped 2 rtl warn',
    ])
  })

  it('run on a page that is not right-to-left, unlike localization rules', () => {
    const p = pair({}, { title: '' })
    p.rtl.dir = 'ltr'
    const c = config({ baseUrl: 'https://bayn.app' })
    const run = runRules(p, resolveRules(builtinRules, c), c)
    expect(brief(run.findings.filter((f) => f.area === 'seo'))).toEqual([
      'page-title missing rtl error',
    ])
    expect(run.skippedRules).toContain('not-mirrored')
  })

  it('switch off with checks', () => {
    const c = config({ baseUrl: 'https://bayn.app', checks: ['localization'] })
    expect(resolveRules(builtinRules, c).some((r) => r.rule.meta.area === 'seo')).toBe(false)
  })

  it('flag pages that share a title or description, across the site', () => {
    const c = config({ baseUrl: 'https://bayn.app' })
    const page = (route: string, title: string, arTitle = `${title} ar`) => ({
      route,
      head: {
        ltr: { ...snapshot('ltr', []).head, title, description: `About ${route}` },
        rtl: { ...snapshot('rtl', []).head, title: arTitle, description: `عن ${route}` },
      },
    })
    const { findings, errors } = runSiteRules(
      [
        page('/docs', 'Docs · Bayn', 'المستندات'),
        page('/docs/api', 'Docs · Bayn', 'المستندات'),
        page('/pricing', 'Pricing'),
      ],
      resolveRules(builtinRules, c),
      c,
    )
    expect(errors).toEqual([])
    expect(
      findings.map((f) => `${f.route} ${f.rule} ${f.evidence.check} ${f.evidence.side}`),
    ).toEqual(['/docs duplicate-title title both', '/docs/api duplicate-title title both'])
    expect(findings[0]?.message).toBe(
      "The same title as /docs/api: “Docs · Bayn”. Search results can't tell the pages apart.",
    )
  })
})
