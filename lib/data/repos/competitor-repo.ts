import type { CanonicalProduct } from "@/lib/types/canonical"

function logDisabled(operation: string): void {
  console.warn(`[competitor-repo] ${operation} skipped: runtime JSON source disabled and no alternate source is configured`)
}

export const CompetitorRepo = {
  getAll(): CanonicalProduct[] {
    logDisabled("getAll")
    return []
  },

  findByCode(code: string): CanonicalProduct | null {
    logDisabled(`findByCode code=${code}`)
    return null
  },

  findSimilar(_diameterMm: number | null, _fluteCount: number | null): CanonicalProduct[] {
    logDisabled("findSimilar")
    return []
  },
}
