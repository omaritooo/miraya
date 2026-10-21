import { readFileSync } from 'node:fs'
import { Ajv2020 } from 'ajv/dist/2020.js'
import addFormats from 'ajv-formats'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { BaselineSchema, ConfigSchema, ReportSchema } from '../src'

const published = {
  report: ReportSchema,
  baseline: BaselineSchema,
} as const

const jsonSchema = (schema: z.ZodType) => z.toJSONSchema(schema, { target: 'draft-2020-12' })

const reportExample = JSON.parse(
  readFileSync(new URL('./fixtures/report.example.json', import.meta.url), 'utf8'),
)

describe('published JSON Schema (ADR-004)', () => {
  // Regenerate with `pnpm test -u` after changing a schema, and review the diff.
  for (const [name, schema] of Object.entries(published)) {
    it(`schema/${name}.schema.json matches the Zod schema`, async () => {
      await expect(JSON.stringify(jsonSchema(schema), null, 2) + '\n').toMatchFileSnapshot(
        `../schema/${name}.schema.json`,
      )
    })
  }

  it('accepts the report example from DESIGN.md', () => {
    const ajv = new Ajv2020({ strict: true, allowUnionTypes: true, allErrors: true })
    addFormats.default(ajv)
    const validate = ajv.compile(jsonSchema(ReportSchema))
    expect(validate(reportExample), ajv.errorsText(validate.errors)).toBe(true)
    expect(ReportSchema.safeParse(reportExample).success).toBe(true)
  })

  it('rejects a report with an unknown severity', () => {
    const bad = structuredClone(reportExample)
    bad.routes[0].findings[0].severity = 'critical'
    expect(ReportSchema.safeParse(bad).success).toBe(false)
  })
})

describe('ConfigSchema', () => {
  it('fills nested defaults from a minimal config', () => {
    const config = ConfigSchema.parse({ baseUrl: 'http://localhost:3000' })
    expect(config.languages.rtl).toEqual(['ar'])
    expect(config.pairing.testIdAttribute).toBe('data-testid')
    expect(config.timeouts).toEqual({ routeMs: 30000, settleCapMs: 5000 })
    expect(config.locale).toEqual({ strategy: 'attribute' })
    expect(config.baseline).toBe('.miraya-baseline.json')
  })

  it('accepts the example config from PLAN.md', () => {
    const result = ConfigSchema.safeParse({
      baseUrl: 'http://localhost:3000',
      routes: ['/', '/products', '/cart', '/checkout'],
      locale: { strategy: 'path-prefix', ltr: '/en', rtl: '/ar' },
      auth: { storageState: '.auth/user.json' },
      pairing: { testIdAttribute: 'data-testid' },
      fonts: { arabic: ['IBM Plex Sans Arabic', 'Cairo'] },
      allow: { latinText: ['Hadeed', 'InstaPay', 'Visa'] },
      rules: {
        'not-mirrored': ['error', { tolerancePx: 4 }],
        'mixed-digits': ['info', { prefer: 'western' }],
      },
    })
    expect(result.success).toBe(true)
  })

  it('accepts a custom switch function', () => {
    const config = ConfigSchema.parse({
      baseUrl: 'http://localhost:3000',
      locale: (dir: string) => (dir === 'rtl' ? '/ar' : '/en'),
    })
    expect(typeof config.locale).toBe('function')
  })

  it('names the field when a rule setting is invalid', () => {
    const result = ConfigSchema.safeParse({
      baseUrl: 'http://localhost:3000',
      rules: { 'not-mirrored': 'loud' },
    })
    expect(result.success).toBe(false)
    expect(result.error?.issues[0]?.path).toEqual(['rules', 'not-mirrored'])
  })

  it('rejects routes that are not paths', () => {
    expect(
      ConfigSchema.safeParse({ baseUrl: 'http://localhost:3000', routes: ['cart'] }).success,
    ).toBe(false)
  })
})

describe('BaselineSchema', () => {
  it('accepts the baseline example from DESIGN.md', () => {
    const result = BaselineSchema.safeParse({
      schemaVersion: 1,
      entries: [
        {
          fingerprint: '3f2a',
          rule: 'not-mirrored',
          route: '/checkout',
          note: 'legacy promo strip, JIRA-412',
        },
        { fingerprint: '9bc1', rule: 'untranslated-text', route: '/checkout' },
      ],
    })
    expect(result.success).toBe(true)
  })
})
