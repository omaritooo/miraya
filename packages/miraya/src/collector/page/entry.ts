import { collect, nodeAt } from './collect'

// The isolated world has its own globals, so this can't collide with the page's.
;(globalThis as unknown as { __miraya: unknown }).__miraya = { collect, nodeAt }
