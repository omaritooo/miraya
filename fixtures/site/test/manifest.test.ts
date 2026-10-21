import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { ManifestSchema } from '../manifest'

const site = fileURLToPath(new URL('..', import.meta.url))
const manifests = readdirSync(`${site}pages`, { recursive: true, encoding: 'utf8' }).filter((f) =>
  f.endsWith('.expect.json'),
)

const pageFile = (locale: string, route: string) =>
  route === '/' ? `${site}${locale}/index.html` : `${site}${locale}${route}/index.html`

describe('fixture manifests', () => {
  it('exist', () => {
    expect(manifests.length).toBeGreaterThan(0)
  })

  for (const file of manifests) {
    describe(file, () => {
      const manifest = ManifestSchema.parse(
        JSON.parse(readFileSync(`${site}pages/${file}`, 'utf8')),
      )

      it('has the page in both locales', () => {
        expect(existsSync(pageFile('en', manifest.route)), `en${manifest.route}`).toBe(true)
        expect(existsSync(pageFile('ar', manifest.route)), `ar${manifest.route}`).toBe(true)
      })

      it('labels each element by selector', () => {
        for (const { selector } of manifest.expect) {
          const html = readFileSync(pageFile('ar', manifest.route), 'utf8')
          const testId = /^\[data-testid="(.+)"\]$/.exec(selector)?.[1]
          if (testId) expect(html, selector).toContain(`data-testid="${testId}"`)
        }
      })
    })
  }
})
