import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { isAbsolute, join, relative, resolve } from 'node:path'
import type { ResolvedConfig, TranslationMatch, Translations } from '../types'
import { ConfigError } from './engine'

/** A key, its text, and the file it lives in (or would live in, on the RTL side). */
type Entry = { key: string; value: string; file: string }

// {name}, {{ name }}, %s, %d, %1$s: rendered as anything.
const PLACEHOLDER = /\{\{\s*[\w.-]+\s*\}\}|\{\s*[\w.-]+\s*\}|%(?:\d+\$)?[sd]/g
// ICU plural and select messages render one branch, so their full text never matches.
const ICU = /\{\s*[\w.-]+\s*,\s*(?:plural|select|selectordinal)\s*,/
const RTL_LETTER = /[\p{Script=Arabic}\p{Script=Hebrew}]/u

const normalise = (text: string) => text.replace(/\s+/g, ' ').trim().toLowerCase()
// Relative to where Miraya runs, unless the file is outside it.
function display(file: string) {
  const rel = relative(process.cwd(), file)
  return rel && !rel.startsWith('..') && !isAbsolute(rel) ? rel : file
}

function flatten(value: unknown, prefix: string, out: Map<string, string>) {
  if (typeof value === 'string') out.set(prefix, value)
  else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) flatten(v, prefix ? `${prefix}.${k}` : k, out)
  }
}

function readJson(file: string): Map<string, string> {
  let data: unknown
  try {
    data = JSON.parse(readFileSync(file, 'utf8'))
  } catch (error) {
    throw new ConfigError(
      `locales: can't read ${display(file)}: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
  const out = new Map<string, string>()
  flatten(data, '', out)
  return out
}

function jsonFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    const path = join(dir, d.name)
    if (d.isDirectory()) return jsonFiles(path)
    return d.name.endsWith('.json') ? [path] : []
  })
}

/**
 * Reads a locale: one JSON file, or a folder with one JSON file per namespace. In a
 * folder, keys are prefixed with the namespace, i18next style: `checkout:pay.now`.
 */
function readLocale(path: string, mirror?: string): Entry[] {
  if (!existsSync(path)) throw new ConfigError(`locales: ${display(path)} doesn't exist`)
  if (!statSync(path).isDirectory()) {
    const target = mirror ?? path
    return [...readJson(path)].map(([key, value]) => ({ key, value, file: target }))
  }
  return jsonFiles(path).flatMap((file) => {
    const ns = relative(path, file)
      .replace(/\.json$/, '')
      .split(/[\\/]/)
      .join('/')
    // The RTL file a missing key belongs in: the same namespace in the other folder.
    const target = mirror ? join(mirror, relative(path, file)) : file
    return [...readJson(file)].map(([key, value]) => ({ key: `${ns}:${key}`, value, file: target }))
  })
}

function pattern(value: string): RegExp {
  const parts = value
    .split(PLACEHOLDER)
    .map((p) => normalise(p).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  return new RegExp(`^${parts.join('.+?')}$`)
}

/** Loads config.locales into a lookup, or returns undefined when it isn't set. */
export function loadTranslations(config: ResolvedConfig): Translations | undefined {
  if (!config.locales) return undefined
  const ltrPath = resolve(config.locales.ltr)
  const rtlPath = resolve(config.locales.rtl)
  const ltr = readLocale(ltrPath, rtlPath)
  const rtl = new Map(readLocale(rtlPath).map((e) => [e.key, e]))

  const exact = new Map<string, Entry>()
  const patterns: { re: RegExp; entry: Entry }[] = []
  for (const entry of ltr) {
    if (ICU.test(entry.value)) continue
    PLACEHOLDER.lastIndex = 0
    if (PLACEHOLDER.test(entry.value)) patterns.push({ re: pattern(entry.value), entry })
    else if (!exact.has(normalise(entry.value))) exact.set(normalise(entry.value), entry)
  }

  return {
    lookup(text: string): TranslationMatch {
      const n = normalise(text)
      const entry = exact.get(n) ?? patterns.find((p) => p.re.test(n))?.entry
      if (!entry) return { status: 'not-found', file: display(ltrPath) }
      const translated = rtl.get(entry.key)
      if (!translated) return { status: 'missing', key: entry.key, file: display(entry.file) }
      const status = RTL_LETTER.test(translated.value) ? 'fallback' : 'copied'
      return { status, key: entry.key, file: display(translated.file) }
    },
  }
}
