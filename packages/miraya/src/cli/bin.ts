#!/usr/bin/env node
// The entry point: loads the CLI, and explains a missing Playwright instead of a stack trace.
try {
  await import('./index')
} catch (error) {
  const missing =
    error instanceof Error &&
    (error as NodeJS.ErrnoException).code === 'ERR_MODULE_NOT_FOUND' &&
    error.message.includes('@playwright/test')
  if (!missing) throw error
  process.stderr.write(
    'Miraya drives the browser through your Playwright. Install it:\n  npm install --save-dev @playwright/test\n',
  )
  process.exitCode = 2
}

export {}
