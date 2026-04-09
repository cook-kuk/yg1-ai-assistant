import { describe, expect, it } from "vitest"
import { parseDeterministic } from "../deterministic-scr"
import { buildAppliedFilterFromValue, getFilterFieldDefinition } from "@/lib/recommendation/shared/filter-field-registry"

describe("deterministic-scr RPM extraction", () => {
  it("RPM 3000 이상 → rpm gte 3000", () => {
    const actions = parseDeterministic("RPM 3000 이상 가능한 제품")
    const rpm = actions.find(a => a.field === "rpm")
    expect(rpm).toBeDefined()
    expect(rpm?.value).toBe(3000)
    expect(rpm?.op).toBe("gte")
  })

  it("회전수 5000 이상", () => {
    const rpm = parseDeterministic("회전수 5000 이상으로").find(a => a.field === "rpm")
    expect(rpm?.value).toBe(5000)
    expect(rpm?.op).toBe("gte")
  })

  it("스핀들 4000 초과", () => {
    const rpm = parseDeterministic("스핀들 4000 초과").find(a => a.field === "rpm")
    expect(rpm?.value).toBe(4000)
    expect(rpm?.op).toBe("gte")
  })

  it("RPM 12,000 이상 — 콤마 포함", () => {
    const rpm = parseDeterministic("RPM 12,000 이상 가능한").find(a => a.field === "rpm")
    expect(rpm?.value).toBe(12000)
  })

  it("회전수 8000 이하 → lte", () => {
    const rpm = parseDeterministic("회전수 8000 이하 인거").find(a => a.field === "rpm")
    expect(rpm?.value).toBe(8000)
    expect(rpm?.op).toBe("lte")
  })

  it("RPM 언급만 있고 숫자 없으면 추출 안 함", () => {
    const rpm = parseDeterministic("RPM 알려줘").find(a => a.field === "rpm")
    expect(rpm).toBeUndefined()
  })
})

describe("filter-field-registry rpm definition", () => {
  it("rpm 필드가 등록되어 있다", () => {
    const def = getFilterFieldDefinition("rpm")
    expect(def).not.toBeNull()
    expect(def?.label).toBe("RPM")
    expect(def?.kind).toBe("number")
  })

  it("buildAppliedFilterFromValue('rpm', 3000, 0, 'gte') → 가상 필터 객체", () => {
    const filter = buildAppliedFilterFromValue("rpm", 3000, 0, "gte")
    expect(filter).not.toBeNull()
    expect(filter?.field).toBe("rpm")
    expect(filter?.op).toBe("gte")
    expect(filter?.rawValue).toBe(3000)
  })

  it("buildDbClause는 정의되어 있지 않음 (no-op — narrowing은 tool-forge가 처리)", () => {
    const def = getFilterFieldDefinition("rpm")
    expect(def?.buildDbClause).toBeUndefined()
  })
})
