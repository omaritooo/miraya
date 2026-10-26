import * as z from 'zod'
import { AreaSchema, EngineSchema, FindingSchema } from './finding'
import { PageHeadSchema, PagePerfSchema } from './snapshot'

const FixedEntrySchema = z.object({ fingerprint: z.string(), rule: z.string(), route: z.string() })

export const BaselineSchema = z.object({
  schemaVersion: z.literal(1),
  entries: z.array(FixedEntrySchema.extend({ note: z.string().optional() })),
})
export type Baseline = z.infer<typeof BaselineSchema>

/** Failure kinds from DESIGN.md › What happens when things go wrong. */
export const RouteErrorSchema = z.object({
  kind: z.enum(['timeout', 'redirected', 'rule-crashed', 'cdp-unavailable', 'failed']),
  message: z.string(),
  rule: z.string().optional(),
  finalUrl: z.string().optional(),
  stack: z.string().optional(),
})
export type RouteError = z.infer<typeof RouteErrorSchema>

export const RouteResultSchema = z.object({
  route: z.string(),
  status: z.enum(['ok', 'error']),
  durationMs: z.number(),
  pairing: z.object({
    testid: z.number().int(),
    path: z.number().int(),
    heuristic: z.number().int(),
    pathRejected: z.number().int().optional(),
    unmatched: z.object({ ltr: z.number().int(), rtl: z.number().int() }),
  }),
  skippedRules: z.array(z.string()),
  notes: z.array(z.string()),
  screenshots: z.object({
    ltr: z.string().optional(),
    rtl: z.string(),
    truncated: z.boolean(),
    /**
     * Each screenshot's left edge (x) and width (w) in document CSS px. An RTL page that
     * overflows to the left starts at a negative x. Absent means x 0 and the viewport width.
     */
    frames: z
      .object({
        ltr: z.object({ x: z.number(), w: z.number() }).optional(),
        rtl: z.object({ x: z.number(), w: z.number() }).optional(),
      })
      .optional(),
  }),
  /** Each render's head tags, for the SEO view. Absent in reports from before 0.4. */
  head: z.object({ ltr: PageHeadSchema.optional(), rtl: PageHeadSchema.optional() }).optional(),
  /** How the page went in each engine besides the main one, when several ran. */
  engines: z
    .record(
      z.string(),
      z.object({
        status: z.enum(['ok', 'error']),
        /** Findings in the areas every engine checks: localization and SEO. */
        findings: z.number().int(),
        screenshots: z.object({
          ltr: z.string().optional(),
          rtl: z.string(),
          frames: z
            .object({
              ltr: z.object({ x: z.number(), w: z.number() }).optional(),
              rtl: z.object({ x: z.number(), w: z.number() }).optional(),
            })
            .optional(),
        }),
        errors: z.array(RouteErrorSchema),
      }),
    )
    .optional(),
  /** Each language's load measurements, for the performance view. */
  perf: z.object({ ltr: PagePerfSchema.optional(), rtl: PagePerfSchema.optional() }).optional(),
  findings: z.array(FindingSchema),
  errors: z.array(RouteErrorSchema),
})
export type RouteResult = z.infer<typeof RouteResultSchema>

export const RunInfoSchema = z.object({
  /** The package name, or the folder's. */
  project: z.string().optional(),
  branch: z.string().optional(),
  commit: z.string().optional(),
  pr: z.number().int().optional(),
  /** Groups runs on the dashboard: "main", "Pull requests" or a name like "Production nightly". */
  channel: z.string().optional(),
  /** The CI run, where its report can be downloaded. */
  url: z.string().optional(),
  /** owner/repo on GitHub, for "Create issue". */
  repo: z.string().optional(),
})
export type RunInfo = z.infer<typeof RunInfoSchema>

/** report.json, the public output contract (ADR-004). */
export const ReportSchema = z.object({
  schemaVersion: z.literal(1),
  tool: z.object({ name: z.string(), version: z.string() }),
  startedAt: z.iso.datetime(),
  durationMs: z.number(),
  config: z.object({
    hash: z.string(),
    viewport: z.object({ w: z.number().int(), h: z.number().int() }),
    mode: z.enum(['pair', 'rtl-only']),
    /** The areas switched on. Absent in reports from before 0.4. */
    checks: z.array(AreaSchema).optional(),
    /** How the languages were switched, in words: "by /ar prefix". */
    locale: z.string().optional(),
  }),
  /** Where the run came from, for the header and the dashboard. */
  run: RunInfoSchema.optional(),
  /** The baseline the findings were compared with. Absent on a first run, or with baselines off. */
  baseline: z.object({ entries: z.number().int() }).optional(),
  /** Present while the audit is still going: report.html is rewritten as pages finish. */
  running: z.object({ total: z.number().int() }).optional(),
  summary: z.object({
    routes: z.number().int(),
    routeErrors: z.number().int(),
    findings: z.object({
      error: z.number().int(),
      warn: z.number().int(),
      info: z.number().int(),
    }),
    new: z.number().int(),
    baselined: z.number().int(),
    fixed: z.number().int(),
  }),
  /** The engines that audited every page, the main one first. Absent means Chromium alone. */
  engines: z.array(EngineSchema).optional(),
  /** How pages were loaded for the performance check, when it ran. */
  performance: z
    .object({
      engine: z.string(),
      cpuSlowdown: z.number(),
      network: z.string(),
      runs: z.number().int(),
      warmUp: z.number().int(),
      budgets: z.record(z.string(), z.number()),
    })
    .optional(),
  routes: z.array(RouteResultSchema),
  fixed: z.array(FixedEntrySchema),
})
export type Report = z.infer<typeof ReportSchema>
