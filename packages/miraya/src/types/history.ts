import * as z from 'zod'
import { AreaSchema, EngineSchema, SeveritySchema } from './finding'
import { RunInfoSchema } from './report'

/** One finding as the dashboard needs it: no boxes, evidence or screenshots. */
export const HistoryFindingSchema = z.object({
  id: z.string(),
  rule: z.string(),
  area: AreaSchema,
  severity: SeveritySchema,
  label: z.string().optional(),
  known: z.boolean().optional(),
  engines: z.array(EngineSchema).optional(),
  /** Which language it's on, for page-level findings: "ltr", "rtl" or "both". */
  side: z.string().optional(),
})
export type HistoryFinding = z.infer<typeof HistoryFindingSchema>

/** One run in the history folder, written after every audit. */
export const HistoryRunSchema = z.object({
  schemaVersion: z.literal(1),
  startedAt: z.iso.datetime(),
  durationMs: z.number(),
  run: RunInfoSchema.optional(),
  checks: z.array(AreaSchema),
  engines: z.array(EngineSchema),
  /** Performance was measured against a dev server, so its numbers don't count. */
  devServer: z.boolean().optional(),
  baselined: z.number().int(),
  fixed: z.number().int(),
  routes: z.array(
    z.object({
      route: z.string(),
      status: z.enum(['ok', 'error']),
      error: z.string().optional(),
      /** Largest contentful paint in ms, per language. */
      lcp: z.object({ ltr: z.number().optional(), rtl: z.number().optional() }).optional(),
      findings: z.array(HistoryFindingSchema),
    }),
  ),
})
export type HistoryRun = z.infer<typeof HistoryRunSchema>
