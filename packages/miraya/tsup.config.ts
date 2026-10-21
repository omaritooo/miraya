import { defineConfig } from 'tsup'

const shared = {
  // tsup's declaration build sets `baseUrl` internally, which TypeScript 6 deprecates.
  dts: { compilerOptions: { ignoreDeprecations: '6.0' } },
  target: 'node20' as const,
  // import.meta.url in the CJS build, used to find the report viewer.
  shims: true,
}

export default defineConfig([
  { ...shared, entry: ['src/index.ts'], format: ['esm', 'cjs'], clean: true },
  {
    ...shared,
    entry: { cli: 'src/cli/index.ts' },
    format: ['esm'],
    dts: false,
    banner: { js: '#!/usr/bin/env node' },
  },
])
