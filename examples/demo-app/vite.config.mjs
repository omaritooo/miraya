// Miraya writes screenshots into .miraya/ while it audits; without this, Vite would
// see the new files and reload the page mid-audit. Miraya recovers, but it's slower.
export default {
  server: { watch: { ignored: ['**/.miraya/**'] } },
}
