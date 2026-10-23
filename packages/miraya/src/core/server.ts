import { spawn, spawnSync } from 'node:child_process'
import type { ResolvedConfig } from '../types'
import { ConfigError } from './engine'

const POLL_MS = 500
const TAIL_LINES = 20

export type Server = {
  /** False when something was already answering at baseUrl and the command never ran. */
  started: boolean
  stop: () => Promise<void>
}

/** True when anything answers at `url`, even with an error page: the server is up. */
export async function answers(url: string): Promise<boolean> {
  try {
    await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(2000) })
    return true
  } catch {
    return false
  }
}

/**
 * Runs `config.server.command` in `cwd` and resolves once baseUrl answers. Reuses a server
 * that's already up. The command's output is kept quiet, and shown if it fails.
 */
export async function startServer(config: ResolvedConfig, cwd: string): Promise<Server> {
  const noop: Server = { started: false, stop: async () => {} }
  if (!config.server || (await answers(config.baseUrl))) return noop
  const { command, timeoutMs } = config.server

  const child = spawn(command, {
    cwd,
    shell: true,
    // Its own process group, so stop() also ends what the command starts (npm → vite).
    detached: process.platform !== 'win32',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, BROWSER: 'none', FORCE_COLOR: '0' },
  })
  const tail: string[] = []
  const keep = (chunk: Buffer) => {
    tail.push(...chunk.toString().split(/\r?\n/).filter(Boolean))
    tail.splice(0, Math.max(0, tail.length - TAIL_LINES))
  }
  child.stdout?.on('data', keep)
  child.stderr?.on('data', keep)
  let exited: number | null | undefined
  const exit = new Promise<void>((done) =>
    child.once('exit', (code) => {
      exited = code
      done()
    }),
  )
  child.once('error', (e) => keep(Buffer.from(e.message)))

  const stop = async () => {
    if (exited !== undefined || child.pid === undefined) return
    try {
      if (process.platform === 'win32') {
        spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'])
      } else process.kill(-child.pid, 'SIGTERM')
    } catch {
      // Already gone.
    }
    await Promise.race([exit, new Promise((done) => setTimeout(done, 5000))])
  }
  const output = () => (tail.length ? `\nIts last output:\n  ${tail.join('\n  ')}` : '')

  const deadline = Date.now() + timeoutMs
  while (!(await answers(config.baseUrl))) {
    if (exited !== undefined) {
      throw new ConfigError(
        `\`${command}\` exited (code ${exited}) before ${config.baseUrl} answered.${output()}`,
      )
    }
    if (Date.now() > deadline) {
      await stop()
      throw new ConfigError(
        `Started \`${command}\`, but nothing answered at ${config.baseUrl} within ${timeoutMs / 1000}s. If the app runs on another port, change baseUrl.${output()}`,
      )
    }
    await new Promise((done) => setTimeout(done, POLL_MS))
  }
  return { started: true, stop }
}
