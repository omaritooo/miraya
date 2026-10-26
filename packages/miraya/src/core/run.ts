import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import type { RunInfo } from '../types'

const git = (cwd: string, ...args: string[]) => {
  try {
    return execFileSync('git', args, {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
  } catch {
    return undefined
  }
}

/** "git@github.com:owner/repo.git" or "https://github.com/owner/repo" to "owner/repo". */
export function githubRepo(remote: string | undefined): string | undefined {
  const m = remote && /github\.com[:/]([^/]+\/[^/]+?)(?:\.git)?\/?$/.exec(remote)
  return m?.[1]
}

/**
 * Where this run came from: GitHub Actions' variables when present, else the local git
 * checkout. `channel` groups runs on the dashboard; pull requests share one.
 */
export function detectRun({
  channel,
  cwd = process.cwd(),
  env = process.env,
}: { channel?: string; cwd?: string; env?: NodeJS.ProcessEnv } = {}): RunInfo {
  const pkgPath = join(cwd, 'package.json')
  let project: string | undefined
  try {
    if (existsSync(pkgPath))
      project = (JSON.parse(readFileSync(pkgPath, 'utf8')) as { name?: string }).name
  } catch {
    // An unreadable package.json only loses the name.
  }
  const pr = /^refs\/pull\/(\d+)\//.exec(env.GITHUB_REF ?? '')?.[1]
  const branch =
    env.GITHUB_HEAD_REF || env.GITHUB_REF_NAME || git(cwd, 'rev-parse', '--abbrev-ref', 'HEAD')
  const commit = (env.GITHUB_SHA ?? git(cwd, 'rev-parse', 'HEAD'))?.slice(0, 7)
  const repo = env.GITHUB_REPOSITORY ?? githubRepo(git(cwd, 'remote', 'get-url', 'origin'))
  const url =
    env.GITHUB_SERVER_URL && env.GITHUB_REPOSITORY && env.GITHUB_RUN_ID
      ? `${env.GITHUB_SERVER_URL}/${env.GITHUB_REPOSITORY}/actions/runs/${env.GITHUB_RUN_ID}`
      : undefined
  const info: RunInfo = {
    project: project ?? basename(cwd),
    channel: channel ?? env.MIRAYA_CHANNEL ?? (pr ? 'Pull requests' : branch),
  }
  if (branch && branch !== 'HEAD') info.branch = branch
  if (commit) info.commit = commit
  if (pr) info.pr = Number(pr)
  if (url) info.url = url
  if (repo) info.repo = repo
  if (!info.channel) delete info.channel
  return info
}
