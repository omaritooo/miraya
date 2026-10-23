/**
 * Where an English string on the Arabic page stands in the app's translation files:
 * - missing: the English file has it, the Arabic file has no such key
 * - copied: the Arabic file has the key, but its value isn't Arabic
 * - fallback: the Arabic file translates it, yet the page shows English
 * - not-found: no key has this text, so it's probably written into a component
 */
export type TranslationStatus = 'missing' | 'copied' | 'fallback' | 'not-found'

export type TranslationMatch = {
  status: TranslationStatus
  key?: string
  /** The file to edit, relative to the working directory. */
  file: string
}

/** Built by core from config.locales; rules only read it. */
export type Translations = { lookup(text: string): TranslationMatch }
