import * as z from 'zod'
import { BoxSchema, MatchMethodSchema } from './snapshot'

export const SeveritySchema = z.enum(['info', 'warn', 'error'])
export type Severity = z.infer<typeof SeveritySchema>

/** What a rule checks. Each area has its own tab in the report and its own exit-code rules. */
export const AreaSchema = z.enum(['localization', 'seo', 'performance'])
export type Area = z.infer<typeof AreaSchema>

export const EngineSchema = z.enum(['chromium', 'firefox', 'webkit'])
export type Engine = z.infer<typeof EngineSchema>

export const FindingSchema = z.object({
  /** Fingerprint, also used by `explain`. */
  id: z.string(),
  rule: z.string(),
  /** Absent in reports from before areas existed, which only had localization rules. */
  area: AreaSchema.optional(),
  severity: SeveritySchema,
  route: z.string(),
  selector: z.string(),
  boxes: z.object({ ltr: BoxSchema.optional(), rtl: BoxSchema.optional() }),
  message: z.string(),
  docsUrl: z.string(),
  evidence: z.record(z.string(), z.union([z.number(), z.string(), z.boolean()])),
  match: MatchMethodSchema.optional(),
  sourceHint: z.string().optional(),
  status: z.enum(['new', 'baselined']).optional(),
  /**
   * With several browsers, the engines that found it, when that isn't all of them. A finding
   * only some engines see is a cross-browser difference. Absent means every engine, or one ran.
   */
  engines: z.array(EngineSchema).optional(),
  /** Fingerprint of a fixed baseline entry with the same rule and route: likely the same bug after a DOM change. */
  possiblyMoved: z.string().optional(),
})
export type Finding = z.infer<typeof FindingSchema>
