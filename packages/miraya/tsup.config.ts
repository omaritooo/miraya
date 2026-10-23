import { defineConfig } from 'tsup'

const shared = {
  // tsup's declaration build sets `baseUrl` internally, which TypeScript 6 deprecates.
  dts: { compilerOptions: { ignoreDeprecations: '6.0' } },
  target: 'node20' as const,
  // import.meta.url in the CJS build, used to find the report viewer.
  shims: true,
}

export default defineConfig([
  // One ESM build for the library and the CLI, so they share a chunk instead of each
  // carrying a copy of the engine.
  {
    ...shared,
    entry: { index: 'src/index.ts', cli: 'src/cli/bin.ts' },
    format: ['esm'],
    dts: { ...shared.dts, entry: { index: 'src/index.ts' } },
    splitting: true,
    clean: true,
  },
  { ...shared, entry: ['src/index.ts'], format: ['cjs'], dts: shared.dts },
])
