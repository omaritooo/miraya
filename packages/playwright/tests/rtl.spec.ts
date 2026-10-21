import { expect, test } from '@playwright/test'
import { rtl } from '../src'

// The example from PLAN.md, run against the fixture site (FR-11, US-1).
const switchTo = { strategy: 'path-prefix', ltr: '/en', rtl: '/ar' } as const

test('a correctly mirrored page passes', async ({ page }) => {
  await rtl.expectClean(page, { url: '/not-mirrored/good', switchTo })
})

test('a page that does not mirror fails, naming the rule, element and docs', async ({ page }) => {
  const error = await rtl
    .expectClean(page, { url: '/not-mirrored/bad', switchTo })
    .catch((e: Error) => e)
  expect(error).toBeInstanceOf(Error)
  const message = (error as Error).message
  expect(message).toContain('Miraya found 3 new RTL problems on /not-mirrored/bad')
  expect(message).toContain('not-mirrored (error) [data-testid="sidebar"]')
  expect(message).toContain('https://miraya.dev/rules/not-mirrored')
})

test('failOn lowers the bar to warnings', async ({ page }) => {
  // untranslated-text reports at warn, so the default passes and failOn: 'warn' fails.
  await rtl.expectClean(page, { url: '/untranslated-text/bad', switchTo })
  await expect(
    rtl.expectClean(page, { url: '/untranslated-text/bad', switchTo, failOn: 'warn' }),
  ).rejects.toThrow(/untranslated-text \(warn\)/)
})

test('rules can be switched off per test', async ({ page }) => {
  await rtl.expectClean(page, {
    url: '/not-mirrored/bad',
    switchTo,
    rules: { 'not-mirrored': 'off' },
  })
})

test("audit leaves the test's page and cookies as they were", async ({ page, context }) => {
  await page.goto('/en/')
  await context.addCookies([{ name: 'locale', value: 'en', url: 'http://localhost:4319' }])
  const before = await context.cookies()
  const { route } = await rtl.audit(page, {
    url: '/en/',
    switchTo: { strategy: 'cookie', name: 'locale', ltr: 'en', rtl: 'ar' },
    rules: { 'document-direction': 'off' },
  })
  expect(route.errors).toEqual([])
  expect(route.pairing.testid).toBeGreaterThan(0)
  expect(await context.cookies()).toEqual(before)
  expect(new URL(page.url()).pathname).toBe('/en/')
  await expect(page.getByTestId('title')).toBeVisible()
})

test('attaches the report to the test result', async ({ page }, testInfo) => {
  await rtl.audit(page, { url: '/not-mirrored/good', switchTo })
  expect(testInfo.attachments.map((a) => a.name)).toEqual(
    expect.arrayContaining([
      'miraya-report.json',
      'miraya-report.html',
      'miraya-ltr.jpg',
      'miraya-rtl.jpg',
    ]),
  )
})
