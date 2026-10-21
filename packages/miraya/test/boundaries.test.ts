import { fileURLToPath } from 'node:url'
import { ESLint } from 'eslint'
import { describe, expect, it } from 'vitest'

// ADR-009: module boundaries are enforced by lint. These tests prove the lint
// config actually fails, so a config change can't silently switch it off.
const root = fileURLToPath(new URL('../../..', import.meta.url))
const eslint = new ESLint({ cwd: root })

async function boundaryErrors(file: string, code: string) {
  const [result] = await eslint.lintText(code, { filePath: `${root}packages/miraya/src/${file}` })
  return (result?.messages ?? [])
    .filter((m) => m.ruleId === 'boundaries/dependencies')
    .map((m) => m.message)
}

describe('module boundaries', () => {
  it('keeps rules free of Playwright', async () => {
    expect(
      await boundaryErrors(
        'rules/x.ts',
        "import { chromium } from 'playwright'\nexport { chromium }\n",
      ),
    ).toHaveLength(1)
  })

  it('keeps rules free of Node APIs', async () => {
    const code =
      "import { readFileSync } from 'node:fs'\nimport path from 'path'\nexport { readFileSync, path }\n"
    expect(await boundaryErrors('rules/x.ts', code)).toHaveLength(2)
  })

  it('lets rules import types and zod', async () => {
    const code =
      "import { z } from 'zod'\nimport { SeveritySchema } from '../types'\nexport { z, SeveritySchema }\n"
    expect(await boundaryErrors('rules/x.ts', code)).toEqual([])
  })

  it('stops rules from importing core', async () => {
    const errors = await boundaryErrors(
      'rules/x.ts',
      "import { audit } from '../core/audit'\nexport { audit }\n",
    )
    expect(errors).toHaveLength(1)
    expect(errors[0]).toContain('"core"')
  })

  it('stops types from importing rules', async () => {
    const errors = await boundaryErrors(
      'types/x.ts',
      "import { builtinRules } from '../rules'\nexport { builtinRules }\n",
    )
    expect(errors).toHaveLength(1)
  })

  it('stops collector from importing rules or core', async () => {
    const code =
      "import { builtinRules } from '../rules'\nimport { audit } from '../core/audit'\nexport { builtinRules, audit }\n"
    expect(await boundaryErrors('collector/x.ts', code)).toHaveLength(2)
  })

  it('lets core import collector, rules and types', async () => {
    const code =
      "import { collectPage } from '../collector'\nimport { builtinRules } from '../rules'\nimport { ConfigSchema } from '../types'\nexport { collectPage, builtinRules, ConfigSchema }\n"
    expect(await boundaryErrors('core/x.ts', code)).toEqual([])
  })
})
