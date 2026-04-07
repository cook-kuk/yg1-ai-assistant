// Request-scoped runtime flags. Plumbed via AsyncLocalStorage so that
// downstream code (product-db-source, serve-engine-runtime) can opt into
// alternative behaviors without threading a flag through every signature.
//
// Currently used by the test runner (multiturn-stress.js) to request
// "precision mode": exact diameter matching + skip knowledge-fallback.
// UI requests never set this flag, so default UX is unchanged.

import { AsyncLocalStorage } from "async_hooks"

export interface RuntimeFlags {
  precisionMode: boolean
}

const storage = new AsyncLocalStorage<RuntimeFlags>()

export function runWithRuntimeFlags<T>(flags: RuntimeFlags, fn: () => T): T {
  return storage.run(flags, fn)
}

export function isPrecisionMode(): boolean {
  return storage.getStore()?.precisionMode === true
}
