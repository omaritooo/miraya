import { spawn, spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { chromium, type Browser } from '@playwright/test'
import { ConfigError } from '../core'

const MISSING = /Executable doesn't exist|install(ed)? (the )?browsers?|playwright install/i

/** Launches Chromium, downloading it first when this Playwright version doesn't have it yet. */
export async function launch(options: { headless?: boolean } = {}): Promise<Browser> {
  try {
    return await chromium.launch(options)
  } catch (error) {
    if (!(error instanceof Error) || !MISSING.test(error.message)) throw error
  }
  // Audits run headless, which needs only the smaller headless shell.
  const shell = options.headless !== false
  process.stderr.write(
    `Playwright's ${shell ? 'headless Chromium' : 'Chromium'} is missing. Downloading it once…\n`,
  )
  const cli = join(
    dirname(createRequire(import.meta.url).resolve('@playwright/test/package.json')),
    'cli.js',
  )
  const result = spawnSync(
    process.execPath,
    [cli, 'install', 'chromium', ...(shell ? ['--only-shell'] : [])],
    { stdio: 'inherit' },
  )
  if (result.status !== 0) {
    throw new ConfigError(
      "Couldn't download Chromium. Run `npx playwright install chromium` (on Linux CI, add --with-deps) and try again.",
    )
  }
  return chromium.launch(options)
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
