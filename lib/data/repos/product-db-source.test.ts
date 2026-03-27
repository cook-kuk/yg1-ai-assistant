import { describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))

import { buildQueryOptions } from "./product-db-source"

describe("product db operation shape filtering", () => {
  it("filters by series_application_shape text only", () => {
    const { where, values } = buildQueryOptions({
      input: {
        manufacturerScope: "yg1-only",
        locale: "ko",
        operationType: "Side_Milling, Facing",
      },
    })

    expect(where.some(clause => clause.includes("series_application_shape"))).toBe(true)
    expect(where.some(clause => clause.includes("edp_root_category"))).toBe(false)
    expect(values).toContain("%side_milling%")
    expect(values).toContain("%facing%")
  })

  it("keeps Side_Milling and Side Milling as separate OR conditions", () => {
    const { where, values } = buildQueryOptions({
      input: {
        manufacturerScope: "yg1-only",
        locale: "ko",
        operationType: "Side_Milling, Side Milling",
      },
    })

    const operationClause = where.find(clause => clause.includes("series_application_shape"))
    expect(operationClause).toContain(" OR ")
    expect(values).toContain("%side_milling%")
    expect(values).toContain("%side milling%")
  })
})
