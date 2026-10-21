import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { createJiti } from 'jiti'
import { ConfigSchema, type ConfigInput, type ResolvedConfig } from '../types'
import { ConfigError, zodIssuePath } from './engine'

export const CONFIG_FILES = [
  'miraya.config.ts',
  'miraya.config.mts',
  'miraya.config.js',
  'miraya.config.mjs',
]

/** Typed identity function, so editors autocomplete the config file. */
export function defineConfig(config: ConfigInput): ConfigInput {
  return config
}

export function parseConfig(input: unknown, source = 'config'): ResolvedConfig {
  const result = ConfigSchema.safeParse(input)
  if (!result.success) throw new ConfigError(`Invalid ${source}:\n${zodIssuePath(result.error)}`)
  return result.data
}

/** Finds the config file in `cwd`, or returns undefined when there is none. */
export function findConfig(cwd = process.cwd()): string | undefined {
  return CONFIG_FILES.map((f) => resolve(cwd, f)).find((f) => existsSync(f))
}

/** Reads a config file's default export without validating it. TypeScript works without a build step, via jiti. */
export async function readConfigFile(path: string): Promise<Partial<ConfigInput>> {
  const file = resolve(path)
  if (!existsSync(file)) throw new ConfigError(`Config file not found: ${file}`)
  let loaded: unknown
  try {
    loaded = await createJiti(file).import(file, { default: true })
  } catch (error) {
    throw new ConfigError(
      `Couldn't load ${file}: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
  if (typeof loaded !== 'object' || loaded === null) {
    throw new ConfigError(`${file} must export a config object as its default export`)
  }
  return loaded as Partial<ConfigInput>
}

/** Loads and validates a config file. */
export async function loadConfig(
  path: string,
  overrides: Partial<ConfigInput> = {},
): Promise<ResolvedConfig> {
  return parseConfig({ ...(await readConfigFile(path)), ...overrides }, resolve(path))
}
