import { z } from 'zod'

/**
 * Labelled bugs for one fixture page (DESIGN.md › How do we know the rules are right?).
 * Labels live here, never in the page markup, so the collector can't see them.
 * A good page has an empty `expect` list: any finding on it is a false positive.
 */
export const ManifestSchema = z.object({
  /** Locale-free route; the page exists at /en{route} and /ar{route}. */
  route: z.string().startsWith('/'),
  expect: z.array(
    z.object({
      rule: z.string(),
      selector: z.string(),
    }),
  ),
})
export type Manifest = z.infer<typeof ManifestSchema>
