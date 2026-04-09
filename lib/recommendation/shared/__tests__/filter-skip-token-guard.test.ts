import { describe, test, expect } from "vitest"
import { buildAppliedFilterFromValue } from "../filter-field-registry"

describe("buildAppliedFilterFromValue: skip-token guard", () => {
  test('"상관없음" → null (not a literal filter)', () => {
    expect(buildAppliedFilterFromValue("seriesName", "상관없음")).toBeNull()
  })

  test('"아무거나" → null', () => {
    expect(buildAppliedFilterFromValue("brand", "아무거나")).toBeNull()
  })

  test("trailing/leading whitespace 무시", () => {
    expect(buildAppliedFilterFromValue("seriesName", "  상관없음  ")).toBeNull()
  })

  test("정상값은 통과", () => {
    const f = buildAppliedFilterFromValue("seriesName", "X-POWER")
    expect(f).not.toBeNull()
    expect(f?.value).toContain("X-POWER")
  })

  test("rpm 같은 가상 필드도 정상값은 통과", () => {
    const f = buildAppliedFilterFromValue("rpm", 3000)
    // rpm은 number kind라 number 입력은 그대로 통과해야 함
    expect(f).not.toBeNull()
  })
})
