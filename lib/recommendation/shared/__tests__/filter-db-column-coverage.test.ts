import { describe, it, expect } from "vitest"
import { PRODUCT_BASE_QUERY } from "@/lib/data/repos/product-db-source"
import { getRegisteredFilterFields, getFilterFieldDefinition } from "@/lib/recommendation/shared/filter-field-registry"

// 회귀 가드: filter-field-registry 의 dbColumns 가 PRODUCT_BASE_QUERY 의 inner SELECT 에
// 모두 포함되어야 한다. 누락되면 WHERE 절이 derived table 에서 컬럼을 못 찾아 500
// (예: "column milling_effective_length does not exist") 이 발생한다.
describe("filter dbColumns ⊆ PRODUCT_BASE_QUERY", () => {
  const selectIdentifiers = new Set(
    PRODUCT_BASE_QUERY
      .replace(/--[^\n]*/g, "")
      .match(/[a-z_][a-z0-9_]*/gi)
      ?.map((s: string) => s.toLowerCase()) ?? [],
  )

  it("등록된 모든 필터의 dbColumns 가 SELECT 에 포함됨", () => {
    const missingByField: Record<string, string[]> = {}
    for (const field of getRegisteredFilterFields()) {
      const def = getFilterFieldDefinition(field)
      const cols = def?.dbColumns ?? []
      if (cols.length === 0) continue
      const missing = cols.filter((c: string) => !selectIdentifiers.has(c.toLowerCase()))
      if (missing.length > 0) missingByField[field] = missing
    }
    expect(missingByField, `누락: ${JSON.stringify(missingByField)}`).toEqual({})
  })
})
