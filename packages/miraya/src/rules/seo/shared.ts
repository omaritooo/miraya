import type { Dir, PageHead, SnapshotPair } from '../../types'

export { LANGUAGE, report, type Issue } from '../page-findings'

export type Side = { dir: Dir; head: PageHead; url: string; lang: string }

/** The renders to check: English and Arabic, or Arabic alone in --rtl-only mode. */
export function sides(pair: SnapshotPair): Side[] {
  return (['ltr', 'rtl'] as const).flatMap((dir) => {
    const snap = pair[dir]
    return snap ? [{ dir, head: snap.head, url: snap.finalUrl, lang: snap.lang }] : []
  })
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
