import { describe, expect, test, vi } from "vitest"

import { resolveFieldFromKorean } from "../auto-synonym"
import { parseEditIntent } from "../edit-intent"

vi.mock("../sql-agent-schema-cache", () => ({
  getDbSchemaSync: () => ({
    columns: [],
    sampleValues: {},
    workpieces: [],
    brands: ["CRX S", "ALU-CUT", "TANK-POWER"],
    loadedAt: Date.now(),
  }),
}))

describe("resolveFieldFromKorean", () => {
  test("maps common Korean labels to filter fields", () => {
    expect(resolveFieldFromKorean("코팅")).toBe("coating")
    expect(resolveFieldFromKorean("직경")).toBe("diameterMm")
    expect(resolveFieldFromKorean("날수")).toBe("fluteCount")
    expect(resolveFieldFromKorean("브랜드")).toBe("brand")
    expect(resolveFieldFromKorean("형상")).toBe("toolSubtype")
    expect(resolveFieldFromKorean("생크")).toBe("shankType")
  })
})

describe("parseEditIntent with automatic field inference", () => {
  test("still handles the Stage 1 fast-path phrases", () => {
    const result = parseEditIntent("코팅은 상관없음")
    expect(result?.intent.type).toBe("skip_field")
    if (result?.intent.type === "skip_field") {
      expect(result.intent.field).toBe("coating")
    }
  })

  test("defers slang skip phrasing to Stage 2", () => {
    expect(parseEditIntent("브랜드 노상관")).toBeNull()
  })

  test("defers mixed skip phrasing to Stage 2", () => {
    expect(parseEditIntent("코팅은 뭐 아무래도 좋은데 날수만 4날")).toBeNull()
  })
})
