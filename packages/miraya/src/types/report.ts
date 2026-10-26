import * as z from 'zod'
import { FindingSchema } from './finding'
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
  /** Each language's load measurements, for the performance view. */
  perf: z.object({ ltr: PagePerfSchema.optional(), rtl: PagePerfSchema.optional() }).optional(),
  findings: z.array(FindingSchema),
  errors: z.array(RouteErrorSchema),
})
export type RouteResult = z.infer<typeof RouteResultSchema>

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
  }),
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
