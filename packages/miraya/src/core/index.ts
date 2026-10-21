export { audit, exitCode, writeReport, type AuditOptions } from './audit'
export { writeHtmlReport } from './report'
export {
  CONFIG_FILES,
  defineConfig,
  findConfig,
  loadConfig,
  parseConfig,
  readConfigFile,
} from './config'
export { ConfigError, DOCS_BASE_URL, fingerprint, resolveRules, runRules } from './engine'
export { consistent, pairSnapshots, type PairingStats } from './pair'
export { applyBaseline, readBaseline, updateBaseline, writeBaseline } from './baseline'
export { crawl, normaliseLink } from './crawl'
export { githubAnnotations, githubSummary, writeGithubOutput } from './github'
export { routeSlug } from './render'
export { builtinRules } from '../rules'
