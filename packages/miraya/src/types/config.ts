import * as z from 'zod'
import type { Dir } from './snapshot'

/**
 * A custom direction switch: return the URL to open, or open it yourself.
 * `page` is a Playwright Page; it's typed in core, which owns the Playwright dependency.
 */
export type CustomSwitch = (
  dir: Dir,
  ctx: { page: unknown; route: string },
) => string | Promise<void>

export const SwitchToSchema = z.union([
  z.discriminatedUnion('strategy', [
    z.object({ strategy: z.literal('path-prefix'), ltr: z.string(), rtl: z.string() }),
    z.object({ strategy: z.literal('query'), param: z.string(), ltr: z.string(), rtl: z.string() }),
    z.object({
      strategy: z.literal('cookie'),
      name: z.string(),
      ltr: z.string(),
      rtl: z.string(),
      domain: z.string().optional(),
    }),
    z.object({ strategy: z.literal('context-locale'), ltr: z.string(), rtl: z.string() }),
    z.object({
      strategy: z.literal('local-storage'),
      /** The localStorage key the app reads its language from, like `i18nextLng`. */
      key: z.string(),
      ltr: z.string(),
      rtl: z.string(),
    }),
    z.object({ strategy: z.literal('attribute') }),
  ]),
  z.custom<CustomSwitch>((v) => typeof v === 'function', 'Expected a switch function'),
])
export type SwitchTo = z.infer<typeof SwitchToSchema>

export const RuleSeveritySchema = z.enum(['off', 'info', 'warn', 'error'])
export type RuleSeverity = z.infer<typeof RuleSeveritySchema>

export const RuleSettingSchema = z.union([
  RuleSeveritySchema,
  z.tuple([RuleSeveritySchema, z.record(z.string(), z.unknown())]),
])
export type RuleSetting = z.infer<typeof RuleSettingSchema>

// Nested objects use prefault, not default: in Zod 4 a default value skips parsing,
// so the inner defaults would never be applied.
export const ConfigSchema = z.object({
  baseUrl: z.url(),
  /**
   * Starts the app for the run: the CLI runs `command`, waits until baseUrl answers, and
   * stops it at the end. When something already answers at baseUrl, that's used instead.
   */
  server: z
    .object({
      command: z.string(),
      timeoutMs: z.number().int().min(1000).default(120_000),
    })
    .optional(),
  routes: z.array(z.string().startsWith('/')).optional(),
  crawl: z
    .object({
      start: z.string().default('/'),
      maxDepth: z.number().int().min(0).max(5).default(2),
      maxRoutes: z.number().int().min(1).max(500).default(50),
      /** Glob patterns. */
      include: z.array(z.string()).default([]),
      exclude: z.array(z.string()).default([]),
    })
    .optional(),
  locale: SwitchToSchema.default({ strategy: 'attribute' }),
  languages: z.object({ rtl: z.array(z.string()).default(['ar']) }).prefault({}),
  auth: z
    .object({
      storageState: z.string().optional(),
      /** A redirect here marks the route as failed. */
      loginUrlPattern: z.string().optional(),
    })
    .prefault({}),
  viewport: z.object({ w: z.number().int(), h: z.number().int() }).default({ w: 1280, h: 800 }),
  deviceScaleFactor: z.union([z.literal(1), z.literal(2)]).default(1),
  maxPageHeight: z.number().int().default(15000),
  scrollToLoad: z.boolean().default(false),
  timeouts: z
    .object({
      routeMs: z.number().default(30000),
      settleCapMs: z.number().default(5000),
    })
    .prefault({}),
  pairing: z
    .object({
      testIdAttribute: z.string().default('data-testid'),
      generatedIdPatterns: z.array(z.string()).optional(),
    })
    .prefault({}),
  fonts: z
    .object({
      arabic: z.array(z.string()).default([]),
      latin: z.array(z.string()).default([]),
    })
    .prefault({}),
  /**
   * The app's translation files, so untranslated text can name its key and the file to
   * edit. Each is a JSON file, or a folder of JSON files (one per namespace).
   */
  locales: z.object({ ltr: z.string(), rtl: z.string() }).optional(),
  allow: z.object({ latinText: z.array(z.string()).default([]) }).prefault({}),
  source: z.object({ attribute: z.string().optional() }).prefault({}),
  rules: z.record(z.string(), RuleSettingSchema).default({}),
  /** Opt-in experimental rule ids. */
  experimental: z.array(z.string()).default([]),
  baseline: z.union([z.string(), z.literal(false)]).default('.miraya-baseline.json'),
  report: z.object({ maxInlineBytes: z.number().default(25 * 1024 * 1024) }).prefault({}),
})
export type ConfigInput = z.input<typeof ConfigSchema>
export type ResolvedConfig = z.output<typeof ConfigSchema>
