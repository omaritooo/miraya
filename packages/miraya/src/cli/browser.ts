import { spawn, spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { chromium, firefox, webkit, type Browser } from '@playwright/test'
import type { Engine } from '../types'
import { ConfigError } from '../core'

const MISSING = /Executable doesn't exist|install(ed)? (the )?browsers?|playwright install/i

const TYPES = { chromium, firefox, webkit }
const NAMES: Record<Engine, string> = { chromium: 'Chromium', firefox: 'Firefox', webkit: 'WebKit' }

/** Launches a browser, downloading it first when this Playwright version doesn't have it yet. */
export async function launch(
  options: { headless?: boolean } = {},
  engine: Engine = 'chromium',
): Promise<Browser> {
  try {
    return await TYPES[engine].launch(options)
  } catch (error) {
    if (!(error instanceof Error) || !MISSING.test(error.message)) throw error
  }
  // Chromium audits run headless, which needs only the smaller headless shell.
  const shell = engine === 'chromium' && options.headless !== false
  const name = NAMES[engine]
  process.stderr.write(
    `Playwright's ${shell ? `headless ${name}` : name} is missing. Downloading it once…\n`,
  )
  const cli = join(
    dirname(createRequire(import.meta.url).resolve('@playwright/test/package.json')),
    'cli.js',
  )
  const result = spawnSync(
    process.execPath,
    [cli, 'install', engine, ...(shell ? ['--only-shell'] : [])],
    { stdio: 'inherit' },
  )
  if (result.status !== 0) {
    throw new ConfigError(
      `Couldn't download ${name}. Run \`npx playwright install ${engine}\` (on Linux CI, add --with-deps) and try again.`,
    )
  }
  return TYPES[engine].launch(options)
}

/** Opens a file in the default app. Best effort: a headless machine just keeps the path. */
export function openFile(file: string): void {
  const [command, args] =
    process.platform === 'darwin'
      ? ['open', [file]]
      : process.platform === 'win32'
        ? ['cmd', ['/c', 'start', '""', file]]
        : ['xdg-open', [file]]
  try {
    const child = spawn(command, args, { stdio: 'ignore', detached: true })
    child.on('error', () => {})
    child.unref()
  } catch {
    // Nothing to open it with.
  }
}

/** Interactive terminal, not CI: worth opening things and asking questions. */
export const interactive = (): boolean =>
  !!process.stdout.isTTY && !!process.stdin.isTTY && !process.env.CI
