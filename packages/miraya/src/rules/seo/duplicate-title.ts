import * as z from 'zod'
import type { Dir, SitePage } from '../../types'
import { report, type Issue } from '../page-findings'
import { defineRule } from '../util'

const FIELDS = ['title', 'description'] as const

export default defineRule({
  meta: {
    id: 'duplicate-title',
    area: 'seo',
    defaultSeverity: 'warn',
    needs: 'rtl',
    fingerprintKeys: ['check', 'side'],
    docs: 'duplicate-title',
  },
  options: z.object({}),
  checkSite(pages, ctx) {
    // Pages sharing a title or description, by language and field.
    const groups = new Map<string, SitePage[]>()
    for (const page of pages) {
      for (const dir of ['ltr', 'rtl'] as const) {
        for (const field of FIELDS) {
          const value = page.head[dir]?.[field]?.trim().toLowerCase()
          if (!value) continue
          const key = `${dir}\u0000${field}\u0000${value}`
          groups.set(key, [...(groups.get(key) ?? []), page])
        }
      }
    }
    const issues = new Map<string, Partial<Record<Dir, Issue[]>>>()
    for (const [key, group] of groups) {
      if (group.length < 2) continue
      const [dir, field] = key.split('\u0000') as [Dir, (typeof FIELDS)[number]]
      for (const page of group) {
        const others = group.filter((p) => p !== page).map((p) => p.route)
        const shown = others.slice(0, 3).join(', ')
        const more = others.length > 3 ? ` and ${others.length - 3} more` : ''
        const byPage = issues.get(page.route) ?? {}
        byPage[dir] = [
          ...(byPage[dir] ?? []),
          {
            check: field,
            message: `The same ${field} as ${shown}${more}: “${page.head[dir]?.[field]}”. Search results can't tell the pages apart.`,
            evidence: { pages: group.length },
          },
        ]
        issues.set(page.route, byPage)
      }
    }
    return [...issues].flatMap(([route, byDir]) =>
      report({ route }, ctx, 'duplicate-title', 'title', byDir),
    )
  },
})
