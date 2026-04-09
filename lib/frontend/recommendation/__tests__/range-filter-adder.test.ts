/**
 * Range filter UI 의 자연어 빌더 회귀 + deterministic-scr 라운드트립.
 *
 * UI 에서 사용자가 (필드, 최소, 최대) 입력 → buildRangeQueryText 가 자연어로 포맷
 * → onSend 로 디스패치 → deterministic-scr 가 다시 필터 액션으로 파싱.
 * 이 라운드트립이 깨지면 사용자가 입력한 범위가 백엔드에 전달되지 않는다.
 */
import { describe, expect, it } from "vitest"
import { buildRangeQueryText } from "@/lib/frontend/recommendation/exploration-flow"
import { parseDeterministic } from "@/lib/recommendation/core/deterministic-scr"

describe("buildRangeQueryText", () => {
  it("min 만 → '필드 N 단위 이상'", () => {
    expect(buildRangeQueryText("직경", "mm", "8", "")).toBe("직경 8mm 이상")
  })

  it("max 만 → '필드 N 단위 이하'", () => {
    expect(buildRangeQueryText("직경", "mm", "", "12")).toBe("직경 12mm 이하")
  })

  it("min + max → '필드 lo 단위 이상 hi 단위 이하'", () => {
    expect(buildRangeQueryText("직경", "mm", "8", "12")).toBe("직경 8mm 이상 12mm 이하")
  })

  it("min > max 면 자동 swap", () => {
    expect(buildRangeQueryText("직경", "mm", "12", "8")).toBe("직경 8mm 이상 12mm 이하")
  })

  it("min == max 면 eq 형태", () => {
    expect(buildRangeQueryText("직경", "mm", "10", "10")).toBe("직경 10mm")
  })

  it("둘 다 비어있으면 null", () => {
    expect(buildRangeQueryText("직경", "mm", "", "")).toBeNull()
  })

  it("음수 입력은 null", () => {
    expect(buildRangeQueryText("직경", "mm", "-5", "")).toBeNull()
    expect(buildRangeQueryText("직경", "mm", "", "-5")).toBeNull()
  })

  it("숫자 아닌 문자열은 null", () => {
    expect(buildRangeQueryText("직경", "mm", "abc", "")).toBeNull()
  })

  it("날수처럼 단위 빈 문자열도 동작", () => {
    expect(buildRangeQueryText("날수", "", "2", "4")).toBe("날수 2 이상 4 이하")
  })

  it("전장 / 절삭길이 라벨도 동작", () => {
    expect(buildRangeQueryText("전장", "mm", "100", "150")).toBe("전장 100mm 이상 150mm 이하")
    expect(buildRangeQueryText("절삭 길이", "mm", "20", "")).toBe("절삭 길이 20mm 이상")
  })
})

describe("UI → deterministic-scr 라운드트립", () => {
  it("'직경 8mm 이상 12mm 이하' → diameterMm between 8~12", () => {
    const text = buildRangeQueryText("직경", "mm", "8", "12")!
    const dia = parseDeterministic(text).find(a => a.field === "diameterMm")
    expect(dia).toBeDefined()
    expect(dia?.op).toBe("between")
    expect(dia?.value).toBe(8)
    expect((dia as { value2?: number }).value2).toBe(12)
  })

  it("'직경 8mm 이상' → diameterMm gte 8", () => {
    const text = buildRangeQueryText("직경", "mm", "8", "")!
    const dia = parseDeterministic(text).find(a => a.field === "diameterMm")
    expect(dia?.op).toBe("gte")
    expect(dia?.value).toBe(8)
  })

  it("'직경 12mm 이하' → diameterMm lte 12", () => {
    const text = buildRangeQueryText("직경", "mm", "", "12")!
    const dia = parseDeterministic(text).find(a => a.field === "diameterMm")
    expect(dia?.op).toBe("lte")
    expect(dia?.value).toBe(12)
  })

  it("'전장 100mm 이상 150mm 이하' → overallLengthMm between 100~150", () => {
    const text = buildRangeQueryText("전장", "mm", "100", "150")!
    const oal = parseDeterministic(text).find(a => a.field === "overallLengthMm")
    expect(oal).toBeDefined()
    expect(oal?.op).toBe("between")
    expect(oal?.value).toBe(100)
    expect((oal as { value2?: number }).value2).toBe(150)
  })

  it("'날수 2 이상 4 이하' → fluteCount between 2~4", () => {
    const text = buildRangeQueryText("날수", "", "2", "4")!
    const flutes = parseDeterministic(text).find(a => a.field === "fluteCount")
    expect(flutes).toBeDefined()
    // op: between 또는 두 개의 액션 (gte 2 + lte 4) 둘 다 OK
    if (flutes?.op === "between") {
      expect(flutes.value).toBe(2)
      expect((flutes as { value2?: number }).value2).toBe(4)
    } else {
      const all = parseDeterministic(text).filter(a => a.field === "fluteCount")
      const blob = all.map(a => `${a.value}|${a.op}`).join(",")
      expect(blob).toMatch(/2/)
      expect(blob).toMatch(/4/)
    }
  })
})
