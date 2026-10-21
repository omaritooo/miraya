import { spawn, type ChildProcess } from 'node:child_process'
import { fileURLToPath } from 'node:url'

export const FIXTURE_PORT = 4317
export const FIXTURE_URL = `http://localhost:${FIXTURE_PORT}`

let server: ChildProcess | undefined

/** Starts the fixture site's Vite dev server for the e2e suite. */
export async function setup() {
  const site = fileURLToPath(new URL('../../../../fixtures/site', import.meta.url))
  server = spawn('pnpm', ['exec', 'vite', '--port', String(FIXTURE_PORT), '--strictPort'], {
    cwd: site,
    stdio: 'ignore',
  })
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    try {
      if ((await fetch(`${FIXTURE_URL}/en/`)).ok) return
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 200))
  }
  throw new Error(`Fixture site didn't start on ${FIXTURE_URL}`)
}

export async function teardown() {
  server?.kill()
}
