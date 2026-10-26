import type { ZodType } from 'zod'
import type { ResolvedConfig } from './config'
import type { Area, Finding, Severity } from './finding'
import type { Dir, ElementSnap, MatchMethod, SnapshotPair } from './snapshot'
import type { Translations } from './translations'

export type RGBAImage = { width: number; height: number; data: Uint8Array }

export type RuleMeta = {
  id: string
  /** Defaults to localization. Only localization rules wait on the page being right-to-left. */
  area?: Area
  defaultSeverity: Severity
  needs: 'rtl' | 'pair'
  /** Evidence keys that identify the finding. Categorical values only, never measurements. */
  fingerprintKeys: string[]
  needsCrop?: (el: ElementSnap) => boolean
  /** Weakest pairing method the rule trusts at full severity. */
  minMatch?: MatchMethod
  experimental?: boolean
  /** Needs Chromium's DevTools protocol; skipped in Firefox and WebKit. */
  chromiumOnly?: boolean
  /** Checks translated content, so it's skipped with the `attribute` switch, which only flips the layout. */
  needsTranslation?: boolean
  docs: string
}

export type FindingInput = Omit<
  Finding,
  'id' | 'area' | 'docsUrl' | 'status' | 'severity' | 'possiblyMoved' | 'engines'
> & {
  /** Defaults to the resolved severity. A rule may lower it, never raise it. */
  severity?: Severity
  /** The element the finding is about; its test id or path identifies the finding. Omit for page-level findings. */
  el?: ElementSnap
}

export type RuleContext<O> = {
  options: O
  config: ResolvedConfig
  el(dir: Dir, key: string): ElementSnap | undefined
  twin(rtlKey: string): { el: ElementSnap; method: MatchMethod } | undefined
  /** Synchronous, from the crop cache; null if not cached. */
  crop(dir: Dir, key: string): RGBAImage | null
  finding(input: FindingInput): Finding
  /** Present when config.locales points at the app's translation files. */
  translations?: Translations
}

export type Rule<O = unknown> = {
  meta: RuleMeta
  /** Defaults live in the schema. */
  options: ZodType<O>
  check(pair: SnapshotPair, ctx: RuleContext<O>): Finding[]
}
