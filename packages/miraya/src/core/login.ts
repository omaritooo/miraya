import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import type { Browser, BrowserContext, Page } from 'playwright'
import type { ResolvedConfig } from '../types'

type StorageState = Awaited<ReturnType<BrowserContext['storageState']>>

const POLL_MS = 500

export type SignInOptions = {
  browser: Browser
  config: ResolvedConfig
  /** Where to start: a route, resolved against baseUrl. */
  route: string
  /** Resolves when the person says they're signed in. Closing the window also ends it. */
  done: Promise<unknown>
  /** For tests: the page the person signs in on. */
  onPage?: (page: Page) => void | Promise<void>
}

/**
 * Opens the app for someone to sign in by hand, and returns the session it ends with:
 * cookies and localStorage, the shape `auth.storageState` takes. The session is copied as
 * the person goes, so closing the window keeps it too.
 */
export async function signIn(options: SignInOptions): Promise<StorageState> {
  const { browser, config } = options
  const context = await browser.newContext({
    viewport: { width: config.viewport.w, height: config.viewport.h },
  })
  const page = await context.newPage()
  let latest: StorageState = await context.storageState()
  const copy = async () => {
    latest = await context.storageState().catch(() => latest)
  }
  const timer = setInterval(() => void copy(), POLL_MS)
  // Listen before anything else: the window can be closed while the page is still loading.
  const closed = new Promise<void>((done) => {
    page.once('close', () => done())
    context.once('close', () => done())
  })
  try {
    await Promise.race([
      (async () => {
        await page.goto(new URL(options.route, config.baseUrl).href)
        await options.onPage?.(page)
        await options.done
      })(),
      closed,
    ])
    await copy()
    return latest
  } finally {
    clearInterval(timer)
    await context.close().catch(() => {})
  }
}

/** Writes a session file, creating its folder. */
export function writeSession(path: string, state: StorageState): string {
  const file = resolve(path)
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, `${JSON.stringify(state, null, 2)}\n`)
  return file
}
