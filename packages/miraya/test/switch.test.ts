import type { Page } from '@playwright/test'
import { describe, expect, it } from 'vitest'
import { checkRedirect, open } from '../src/core/render'
import { config } from './helpers'

/** A stub page that records what each strategy asks the browser to do (FR-2). */
function stubPage(status = 200) {
  const calls = { gotos: [] as string[], cookies: [] as unknown[], evaluated: [] as unknown[] }
  const page = {
    goto: async (url: string) => {
      calls.gotos.push(url)
      return { status: () => status }
    },
    context: () => ({ addCookies: async (c: unknown[]) => void calls.cookies.push(...c) }),
    evaluate: async (_fn: unknown, arg: unknown) => void calls.evaluated.push(arg),
  }
  return { page: page as unknown as Page, calls }
}

const base = 'http://app.test'

describe('direction switchers', () => {
  it('path-prefix opens /{prefix}{route}', async () => {
    const { page, calls } = stubPage()
    const c = config({ baseUrl: base, locale: { strategy: 'path-prefix', ltr: '/en', rtl: '/ar' } })
    await open(page, '/cart', 'rtl', c)
    await open(page, '/', 'ltr', c)
    expect(calls.gotos).toEqual([`${base}/ar/cart`, `${base}/en/`])
  })

  it('query sets the parameter, keeping existing ones', async () => {
    const { page, calls } = stubPage()
    const c = config({
      baseUrl: base,
      locale: { strategy: 'query', param: 'lang', ltr: 'en', rtl: 'ar' },
    })
    await open(page, '/search?q=lamp', 'rtl', c)
    expect(calls.gotos).toEqual([`${base}/search?q=lamp&lang=ar`])
  })

  it('cookie sets the cookie before opening the route', async () => {
    const { page, calls } = stubPage()
    const c = config({
      baseUrl: base,
      locale: { strategy: 'cookie', name: 'locale', ltr: 'en', rtl: 'ar' },
    })
    await open(page, '/cart', 'rtl', c)
    expect(calls.cookies).toEqual([{ name: 'locale', value: 'ar', url: base }])
    expect(calls.gotos).toEqual([`${base}/cart`])
  })

  it('context-locale opens the plain route (the locale is on the context)', async () => {
    const { page, calls } = stubPage()
    const c = config({
      baseUrl: base,
      locale: { strategy: 'context-locale', ltr: 'en-US', rtl: 'ar-EG' },
    })
    await open(page, '/cart', 'rtl', c)
    expect(calls.gotos).toEqual([`${base}/cart`])
  })

  it('attribute opens the route and sets dir and lang', async () => {
    const { page, calls } = stubPage()
    await open(page, '/cart', 'rtl', config({ baseUrl: base }))
    expect(calls.gotos).toEqual([`${base}/cart`])
    expect(calls.evaluated).toEqual([['rtl', 'ar']])
  })

  it('custom functions can return a URL or open the page themselves', async () => {
    const { page, calls } = stubPage()
    const returning = config({ baseUrl: base, locale: (dir: string) => `/${dir}/home` })
    expect(await open(page, '/', 'rtl', returning)).toBe(`${base}/rtl/home`)
    const opening = config({ baseUrl: base, locale: async () => undefined })
    expect(await open(page, '/', 'rtl', opening)).toBeUndefined()
    expect(calls.gotos).toEqual([`${base}/rtl/home`])
  })

  it('fails on an HTTP error status', async () => {
    const { page } = stubPage(404)
    await expect(open(page, '/missing', 'rtl', config({ baseUrl: base }))).rejects.toThrow(
      'HTTP 404',
    )
  })
})

describe('checkRedirect', () => {
  const c = config({
    baseUrl: base,
    locale: { strategy: 'path-prefix', ltr: '/en', rtl: '/ar' },
    auth: { loginUrlPattern: '/login' },
  })

  it('accepts the requested page, ignoring locale prefix and trailing slash', () => {
    expect(() => checkRedirect(`${base}/ar/cart`, `${base}/ar/cart/`, c)).not.toThrow()
  })

  it('fails when an authenticated route lands on the login page', () => {
    expect(() => checkRedirect(`${base}/ar/cart`, `${base}/login`, c)).toThrow(/storageState/)
  })

  it('allows auditing the login page itself', () => {
    expect(() => checkRedirect(`${base}/ar/login`, `${base}/ar/login`, c)).not.toThrow()
  })

  it('fails on any other redirect', () => {
    expect(() => checkRedirect(`${base}/ar/cart`, `${base}/ar/home`, c)).toThrow(
      'Redirected from /cart to /home',
    )
  })
})
