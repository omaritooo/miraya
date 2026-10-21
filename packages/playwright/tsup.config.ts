import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm', 'cjs'],
  // tsup's declaration build sets `baseUrl` internally, which TypeScript 6 deprecates.
  dts: { compilerOptions: { ignoreDeprecations: '6.0' } },
  clean: true,
  target: 'node20',
  external: ['@miraya/cli', '@playwright/test'],
})
