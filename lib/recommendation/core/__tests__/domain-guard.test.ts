import { describe, test, expect } from "vitest"
import { checkDomainWarnings, formatWarningsForResponse } from "../domain-guard"

const mk = (field: string, value: string | number): any => ({
  field,
  op: "eq",
  value: String(value),
  rawValue: value,
  appliedAt: 0,
})

describe("checkDomainWarnings", () => {
  test("DLC + 스테인리스 → danger", () => {
    const w = checkDomainWarnings([mk("workPieceName", "스테인리스"), mk("coating", "DLC")])
    expect(w.some(x => x.level === "danger" && x.relatedField === "coating")).toBe(true)
  })

  test("TiAlN + 알루미늄 → warn", () => {
    const w = checkDomainWarnings([mk("workPieceName", "알루미늄"), mk("coating", "TiAlN")])
    expect(w.some(x => x.level === "warn")).toBe(true)
  })

  test("무코팅 + 티타늄 → warn", () => {
    const w = checkDomainWarnings([mk("workPieceName", "티타늄"), mk("coating", "uncoated")])
    expect(w.some(x => x.level === "warn")).toBe(true)
  })

  test("L/D > 8 → danger", () => {
    const w = checkDomainWarnings([mk("diameterMm", 6), mk("overallLengthMm", 100)])
    expect(w.some(x => x.level === "danger" && x.relatedField === "overallLengthMm")).toBe(true)
  })

  test("L/D 4~8 → warn", () => {
    const w = checkDomainWarnings([mk("diameterMm", 10), mk("overallLengthMm", 60)])
    expect(w.some(x => x.level === "warn" && x.relatedField === "overallLengthMm")).toBe(true)
  })

  test("비철 + 6날 → info", () => {
    const w = checkDomainWarnings([mk("workPieceName", "알루미늄"), mk("fluteCount", 6)])
    expect(w.some(x => x.level === "info" && x.relatedField === "fluteCount")).toBe(true)
  })

  test("스테인리스 + 2날 → info", () => {
    const w = checkDomainWarnings([mk("workPieceName", "스테인리스"), mk("fluteCount", 2)])
    expect(w.some(x => x.level === "info" && x.relatedField === "fluteCount")).toBe(true)
  })

  test("볼엔드밀 → info", () => {
    const w = checkDomainWarnings([mk("toolSubtype", "ball")])
    expect(w.some(x => x.level === "info" && x.relatedField === "toolSubtype")).toBe(true)
  })

  test("정상 조합(스테인리스 + AlCrN) → danger/warn 없음", () => {
    const w = checkDomainWarnings([mk("workPieceName", "스테인리스"), mk("coating", "AlCrN")])
    expect(w.filter(x => x.level === "danger" || x.level === "warn")).toHaveLength(0)
  })

  test("formatWarningsForResponse: info는 제외", () => {
    const text = formatWarningsForResponse([
      { level: "info", message: "i", suggestion: "s", relatedField: "f" },
      { level: "danger", message: "D", suggestion: "S", relatedField: "f" },
    ])
    expect(text).toContain("⚠️")
    expect(text).toContain("D")
    expect(text).not.toContain("\n\ni")
  })

  test("formatWarningsForResponse: 빈 배열 → 빈 문자열", () => {
    expect(formatWarningsForResponse([])).toBe("")
  })
})
