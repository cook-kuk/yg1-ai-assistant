import { describe, it, expect } from "vitest"
import { scoreProduction, scorePlanner, decidePlannerOverride } from "../planner-decision"
import type { QuerySpec } from "../query-spec"

describe("scoreProduction", () => {
  it("should score KG hit highest", () => {
    const score = scoreProduction([], true, false)
    expect(score.score).toBe(0.9)
    expect(score.factors[0]).toContain("kg-hit")
  })

  it("should score SQL Agent hit medium", () => {
    const score = scoreProduction([], false, true)
    expect(score.score).toBe(0.7)
  })

  it("should score no result lowest", () => {
    const score = scoreProduction([], false, false)
    expect(score.score).toBe(0.1)
  })
})

describe("scorePlanner", () => {
  it("should score high-confidence field (shankType) high", () => {
    const spec: QuerySpec = {
      intent: "narrow", navigation: "none",
      constraints: [{ field: "shankType", op: "eq", value: "Plain" }],
    }
    const score = scorePlanner(spec, [{ field: "shankType", op: "eq", value: "Plain", rawValue: "Plain", appliedAt: 0 }])
    expect(score.score).toBeGreaterThanOrEqual(0.85)
  })

  it("should add neq bonus", () => {
    const specEq: QuerySpec = {
      intent: "narrow", navigation: "none",
      constraints: [{ field: "brand", op: "eq", value: "X" }],
    }
    const specNeq: QuerySpec = {
      intent: "narrow", navigation: "none",
      constraints: [{ field: "brand", op: "neq", value: "X" }],
    }
    const scoreEq = scorePlanner(specEq, [{ field: "brand", op: "eq", value: "X", rawValue: "X", appliedAt: 0 }])
    const scoreNeq = scorePlanner(specNeq, [{ field: "brand", op: "neq", value: "X", rawValue: "X", appliedAt: 0 }])
    expect(scoreNeq.score).toBeGreaterThan(scoreEq.score)
  })

  it("should score multi-constraint low (ineligible)", () => {
    const spec: QuerySpec = {
      intent: "narrow", navigation: "none",
      constraints: [
        { field: "toolSubtype", op: "eq", value: "Square" },
        { field: "diameterMm", op: "eq", value: 10 },
      ],
    }
    const score = scorePlanner(spec, [])
    expect(score.score).toBeLessThanOrEqual(0.3)
  })

  it("should score excluded ops (between/gte/lte) low", () => {
    const spec: QuerySpec = {
      intent: "narrow", navigation: "none",
      constraints: [{ field: "diameterMm", op: "between", value: [8, 12] }],
    }
    const score = scorePlanner(spec, [])
    expect(score.score).toBeLessThanOrEqual(0.2)
  })

  it("should score navigation high", () => {
    const spec: QuerySpec = {
      intent: "narrow", navigation: "reset", constraints: [],
    }
    const score = scorePlanner(spec, [])
    expect(score.score).toBeGreaterThanOrEqual(0.85)
  })
})

describe("decidePlannerOverride", () => {
  it("should choose planner when production missed and planner has safe field", () => {
    const spec: QuerySpec = {
      intent: "narrow", navigation: "none",
      constraints: [{ field: "shankType", op: "eq", value: "Plain" }],
    }
    const shadowFilters = [{ field: "shankType", op: "eq" as const, value: "Plain", rawValue: "Plain", appliedAt: 0 }]
    const decision = decidePlannerOverride(spec, shadowFilters, [], false, false)
    expect(decision.winner).toBe("planner")
    expect(decision.margin).toBeGreaterThan(0.15)
  })

  it("should choose production when KG already hit", () => {
    const spec: QuerySpec = {
      intent: "narrow", navigation: "none",
      constraints: [{ field: "toolSubtype", op: "eq", value: "Square" }],
    }
    const prodFilters = [{ field: "toolSubtype", op: "eq" as const, value: "Square", rawValue: "Square", appliedAt: 0 }]
    const shadowFilters = [{ field: "toolSubtype", op: "eq" as const, value: "Square", rawValue: "Square", appliedAt: 0 }]
    const decision = decidePlannerOverride(spec, shadowFilters, prodFilters, true, false)
    expect(decision.winner).toBe("production")
  })

  it("should skip when planner has no constraints and no navigation", () => {
    const spec: QuerySpec = {
      intent: "question", navigation: "none", constraints: [],
    }
    const decision = decidePlannerOverride(spec, [], [], false, false)
    expect(decision.winner).toBe("skip")
  })

  it("should choose planner for neq when production missed", () => {
    const spec: QuerySpec = {
      intent: "narrow", navigation: "none",
      constraints: [{ field: "fluteCount", op: "neq", value: 4 }],
    }
    const shadowFilters = [{ field: "fluteCount", op: "neq" as const, value: "4날 제외", rawValue: 4, appliedAt: 0 }]
    const decision = decidePlannerOverride(spec, shadowFilters, [], false, false)
    expect(decision.winner).toBe("planner")
  })

  it("should not choose planner for multi-constraint", () => {
    const spec: QuerySpec = {
      intent: "narrow", navigation: "none",
      constraints: [
        { field: "toolSubtype", op: "eq", value: "Square" },
        { field: "diameterMm", op: "eq", value: 10 },
      ],
    }
    const decision = decidePlannerOverride(spec, [], [], false, false)
    expect(decision.winner).not.toBe("planner")
  })

  it("should not choose planner for range ops", () => {
    const spec: QuerySpec = {
      intent: "narrow", navigation: "none",
      constraints: [{ field: "diameterMm", op: "gte", value: 10 }],
    }
    const decision = decidePlannerOverride(spec, [], [], false, false)
    expect(decision.winner).not.toBe("planner")
  })
})
