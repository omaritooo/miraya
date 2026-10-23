import { z } from 'zod'
import type { ElementSnap, Finding, TranslationMatch } from '../types'
import { ancestors, defineRule, isIgnored, shortHash } from './util'

const ID = 'untranslated-text'
const CODE_TAGS = new Set(['code', 'kbd', 'samp', 'pre', 'textarea', 'input'])
const WORD = /\p{L}{2,}/gu
// URLs, emails and bare domains (any dotted name ending in a TLD of 2+ letters: example.info).
const URL_OR_EMAIL =
  /^(https?:\/\/\S+|www\.\S+|[^\s@]+@[^\s@]+\.[^\s@]+|[\w-]+(\.[\w-]+)*\.[a-z]{2,}(\/\S*)?)$/i
// A short English term inside an Arabic sentence is a borrowed term, often a glossary
// reference in <em>, not an interface string left untranslated.
const TERM_MAX_WORDS = 4

export default defineRule({
  meta: {
    id: ID,
    defaultSeverity: 'warn',
    needs: 'rtl',
    fingerprintKeys: ['textHash'],
    docs: ID,
  },
  options: z.object({ minWords: z.number().int().min(1).default(2) }),
  check(pair, ctx) {
    const allowed = new Set(
      ctx.config.allow.latinText.flatMap((s) => s.toLowerCase().match(WORD) ?? []),
    )
    // Identical strings on a route report once, with a count (DESIGN.md › untranslated-text).
    const byText = new Map<string, { el: ElementSnap; text: string; count: number }>()
    for (const el of pair.rtl.elements) {
      const value = el.text?.value
      if (!value || (el.text?.arabic ?? 0) > 0 || isIgnored(el, ID)) continue
      if (el.explicitDir === 'ltr' || URL_OR_EMAIL.test(value)) continue
      const words = value.match(WORD) ?? []
      if (words.length < ctx.options.minWords) continue
      if (words.every((w) => allowed.has(w.toLowerCase()))) continue
      const parent = el.parentKey ? ctx.el('rtl', el.parentKey) : undefined
      if (
        el.style.display.startsWith('inline') &&
        (parent?.text?.arabic ?? 0) > 0 &&
        words.length <= TERM_MAX_WORDS
      )
        continue
      if (CODE_TAGS.has(el.tag) || [...ancestors(el, 'rtl', ctx)].some((a) => CODE_TAGS.has(a.tag)))
        continue
      const normalised = value.toLowerCase()
      const seen = byText.get(normalised)
      if (seen) seen.count++
      else byText.set(normalised, { el, text: value, count: 1 })
    }

    const findings: Finding[] = []
    for (const [normalised, { el, text, count }] of byText) {
      const found = ctx.translations?.lookup(text)
      const shown =
        count > 1
          ? `English text in the Arabic UI, ${count} times: "${text.slice(0, 80)}".`
          : `English text in the Arabic UI: "${text.slice(0, 80)}".`
      findings.push(
        ctx.finding({
          rule: ID,
          route: pair.route,
          selector: el.selector,
          boxes: { rtl: el.box },
          message: found ? `${shown} ${where(found)}` : shown,
          evidence: {
            text: text.slice(0, 80),
            textHash: shortHash(normalised),
            count,
            ...(found
              ? {
                  translation: found.status,
                  ...(found.key ? { translationKey: found.key } : {}),
                  translationFile: found.file,
                }
              : {}),
          },
        }),
      )
    }
    return findings
  },
})

/** Where to fix it, in the app's translation files. */
function where({ status, key, file }: TranslationMatch): string {
  switch (status) {
    case 'missing':
      return `The key "${key}" is missing from ${file}.`
    case 'copied':
      return `"${key}" in ${file} still holds the English text.`
    case 'fallback':
      return `${file} translates "${key}", but the page shows the English: check that the Arabic file loads here.`
    case 'not-found':
      return `It isn't in ${file}, so it's probably written into a component.`
  }
}
