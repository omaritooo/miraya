// @ts-check
import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import boundaries from 'eslint-plugin-boundaries'
import globals from 'globals'
import { fileURLToPath } from 'node:url'

const src = 'packages/miraya/src'

// Module boundaries from docs/SPEC.md › Architecture (ADR-009).
// Each module may import only the modules listed here.
const allowed = {
  types: [],
  collector: ['types'],
  rules: ['types'],
  core: ['types', 'collector', 'rules'],
  cli: ['types', 'core'],
  report: ['types'],
}

export default tseslint.config(
  { ignores: ['**/dist/**', '**/node_modules/**', '**/coverage/**'] },
  js.configs.recommended,
  ...tseslint.configs.strict,
  {
    files: ['**/*.{js,mjs}', '**/scripts/**', '**/*.config.ts'],
    languageOptions: { globals: globals.node },
  },
  {
    rules: {
      // Destructuring a field out to omit it is intentional.
      '@typescript-eslint/no-unused-vars': ['error', { ignoreRestSiblings: true }],
    },
  },
  {
    files: [`${src}/**/*.ts`, 'packages/miraya/report/**/*.{ts,tsx}'],
    plugins: { boundaries },
    settings: {
      // Resolve element patterns from the repo root, whatever the working directory.
      'boundaries/root-path': fileURLToPath(new URL('.', import.meta.url)),
      'import/resolver': { typescript: { project: 'packages/*/tsconfig.json' } },
      'boundaries/elements': [
        ...Object.keys(allowed)
          .filter((type) => type !== 'report')
          .map((type) => ({ type, pattern: `${src}/${type}` })),
        { type: 'report', pattern: 'packages/miraya/report' },
      ],
    },
    rules: {
      'boundaries/dependencies': [
        'error',
        {
          default: 'allow',
          // Also check npm and Node built-in imports, for the rules policy below.
          checkAllOrigins: true,
          policies: [
            ...Object.entries(allowed).map(([type, deps]) => ({
              from: { element: { type } },
              disallow: {
                to: {
                  element: {
                    types: {
                      anyOf: Object.keys(allowed).filter((t) => t !== type && !deps.includes(t)),
                    },
                  },
                },
              },
            })),
            // Rules are pure: no browser, no Node APIs, no file system (ADR-002).
            {
              from: { element: { type: 'rules' } },
              disallow: {
                to: {
                  module: {
                    origin: ['external', 'core'],
                    source: [
                      'playwright',
                      'playwright-core',
                      '@playwright/test',
                      'node:*',
                      'fs',
                      'path',
                      'child_process',
                    ],
                  },
                },
              },
            },
          ],
        },
      ],
    },
  },
)
