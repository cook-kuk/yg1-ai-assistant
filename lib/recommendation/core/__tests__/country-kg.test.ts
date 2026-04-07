/**
 * KG country alias regression — BUG-1 fix
 * "국내제품으로만 추천해줘" → country=KOREA 매핑 검증
 */
import { describe, it, expect, vi } from "vitest"
import { extractEntities } from "../knowledge-graph"

vi.mock("../sql-agent-schema-cache", () => ({
  getDbSchemaSync: () => ({ columns: [], sampleValues: {}, workpieces: [], brands: [], loadedAt: Date.now() }),
}))

describe("KG country extraction — composite Korean phrases", () => {
  const positives = [
    "국내제품으로만 추천해줘",
    "국내산 공구",
    "국산 제품",
    "한국 제품으로",
    "국내 전용",
  ]
  it.each(positives)("[%s] → country=KOREA", (msg) => {
    const country = extractEntities(msg).find(e => e.field === "country")
    expect(country?.canonical).toBe("KOREA")
  })
})
