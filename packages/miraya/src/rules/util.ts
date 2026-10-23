import type { ElementSnap, Rule, RuleContext } from '../types'

export function defineRule<O>(rule: Rule<O>): Rule<O> {
  return rule
}

/** True when a data-rtl-ignore marker on the element or an ancestor names this rule or "*". */
export function isIgnored(el: ElementSnap, ruleId: string): boolean {
  return !!el.ignore && (ruleId in el.ignore || '*' in el.ignore)
}

/** The element's collected ancestors, nearest first. */
export function* ancestors<O>(el: ElementSnap, dir: 'ltr' | 'rtl', ctx: RuleContext<O>) {
  for (let key = el.parentKey; key;) {
    const parent = ctx.el(dir, key)
    if (!parent) return
    yield parent
    key = parent.parentKey
  }
}

/** FNV-1a, 32-bit, as 8 hex chars. Rules can't import node:crypto (ADR-002). */
export function shortHash(text: string): string {
  let hash = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

export const round = (n: number) => Math.round(n * 10) / 10

/**
 * The outermost element, other than <html> and <body>, that is right-to-left and covers
 * at least half the page: apps often set dir on a root wrapper instead of <html>.
 */
export function rtlWrapper(snapshot: { elements: ElementSnap[] }): ElementSnap | undefined {
  const page = snapshot.elements.find((el) => el.tag === 'html')?.box
  const area = page ? page.w * page.h : 0
  if (!area) return undefined
  return snapshot.elements.find(
    (el) =>
      el.tag !== 'html' &&
      el.tag !== 'body' &&
      el.style.direction === 'rtl' &&
      el.box.w * el.box.h >= area / 2,
  )
}
