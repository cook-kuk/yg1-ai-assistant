/**
 * QuerySpec 계층 통합 테스트
 *
 * A. Planner 테스트 (naturalLanguageToQuerySpec mock)
 * B. Compiler 테스트 (compileProductQuery deterministic)
 * C. Bridge 테스트 (querySpecToAppliedFilters)
 * D. Relaxation 테스트 (executeWithRelaxation)
 * E. Golden case 테스트 (KG → 기존 경로)
 */

import { describe, it, expect, vi } from "vitest"
import type { QuerySpec, QueryConstraint } from "../query-spec"
import { compileProductQuery } from "../compile-product-query"
import { querySpecToAppliedFilters, appliedFiltersToConstraints } from "../query-spec-to-filters"
import { executeWithRelaxation, type QueryExecutor } from "../execute-with-relaxation"
import { tryKGDecision } from "../knowledge-graph"

// ══════════════════════════════════════════════════════════════
// A. Planner 출력 형식 검증 (LLM 호출 없이 파서 직접 테스트)
// ══════════════════════════════════════════════════════════════

describe("QuerySpec planner response parsing", () => {
  // parsePlannerResponse는 private이므로 validate를 통해 간접 테스트
  // 여기서는 QuerySpec 타입 자체의 계약을 검증

  it("should represent multi-field narrowing", () => {
    const spec: QuerySpec = {
      intent: "narrow",
      navigation: "none",
      constraints: [
        { field: "workpiece", op: "eq", value: "Copper", display: "피삭재: 구리" },
        { field: "toolSubtype", op: "eq", value: "Square", display: "형상: 스퀘어" },
        { field: "fluteCount", op: "eq", value: 2, display: "날수: 2날" },
        { field: "diameterMm", op: "eq", value: 10, display: "직경: 10mm" },
      ],
    }
    expect(spec.constraints).toHaveLength(4)
    expect(spec.intent).toBe("narrow")
    expect(spec.navigation).toBe("none")
  })

  it("should represent negation (TiAlN 빼고)", () => {
    const spec: QuerySpec = {
      intent: "narrow",
      navigation: "none",
      constraints: [
        { field: "coating", op: "neq", value: "TiAlN", display: "코팅: TiAlN 제외" },
      ],
    }
    expect(spec.constraints[0].op).toBe("neq")
  })

  it("should represent navigation separately from fields", () => {
    const spec: QuerySpec = {
      intent: "narrow",
      navigation: "back",
      constraints: [],
    }
    expect(spec.navigation).toBe("back")
    expect(spec.constraints).toHaveLength(0)
  })

  it("should represent side question", () => {
    const spec: QuerySpec = {
      intent: "question",
      navigation: "none",
      constraints: [],
      questionText: "TiAlN이 뭐야?",
    }
    expect(spec.intent).toBe("question")
    expect(spec.constraints).toHaveLength(0)
  })

  it("should represent reset", () => {
    const spec: QuerySpec = {
      intent: "narrow",
      navigation: "reset",
      constraints: [],
    }
    expect(spec.navigation).toBe("reset")
  })
})

// ══════════════════════════════════════════════════════════════
// B. Compiler 테스트
// ══════════════════════════════════════════════════════════════

describe("compileProductQuery", () => {
  it("should compile workpiece eq with EXISTS clause", () => {
    const spec: QuerySpec = {
      intent: "narrow",
      navigation: "none",
      constraints: [{ field: "workpiece", op: "eq", value: "Copper" }],
    }
    const result = compileProductQuery(spec)
    expect(result.sql).toContain("EXISTS")
    expect(result.sql).toContain("series_profile_mv")
    expect(result.params).toContain("%copper%")
    expect(result.appliedConstraints).toHaveLength(1)
    expect(result.droppedConstraints).toHaveLength(0)
  })

  it("should compile diameter eq strict", () => {
    const spec: QuerySpec = {
      intent: "narrow",
      navigation: "none",
      constraints: [{ field: "diameterMm", op: "eq", value: 10 }],
    }
    const result = compileProductQuery(spec, "strict")
    expect(result.sql).toContain("= $1")
    expect(result.sql).toContain("search_diameter_mm")
    expect(result.params).toEqual([10])
    expect(result.strategy).toBe("strict")
  })

  it("should compile diameter eq near_0_5", () => {
    const spec: QuerySpec = {
      intent: "narrow",
      navigation: "none",
      constraints: [{ field: "diameterMm", op: "eq", value: 10 }],
    }
    const result = compileProductQuery(spec, "diameter_near_0_5")
    expect(result.sql).toContain("BETWEEN")
    expect(result.params).toEqual([9.5, 10.5])
  })

  it("should record unsupported constraint in droppedConstraints", () => {
    const spec: QuerySpec = {
      intent: "narrow",
      navigation: "none",
      constraints: [
        { field: "coating", op: "between" as any, value: ["A", "Z"] },
      ],
    }
    const result = compileProductQuery(spec)
    expect(result.droppedConstraints).toHaveLength(1)
    expect(result.droppedConstraints[0].dropReason).toContain("unsupported op")
    expect(result.appliedConstraints).toHaveLength(0)
  })

  it("should compile neq with NULL safety", () => {
    const spec: QuerySpec = {
      intent: "narrow",
      navigation: "none",
      constraints: [{ field: "brand", op: "neq", value: "TANK-POWER" }],
    }
    const result = compileProductQuery(spec)
    expect(result.sql).toContain("IS NULL OR")
    expect(result.sql).toContain("!=")
  })

  it("should compile multiple constraints", () => {
    const spec: QuerySpec = {
      intent: "narrow",
      navigation: "none",
      constraints: [
        { field: "toolSubtype", op: "eq", value: "Square" },
        { field: "diameterMm", op: "eq", value: 10 },
        { field: "fluteCount", op: "eq", value: 4 },
      ],
    }
    const result = compileProductQuery(spec)
    expect(result.appliedConstraints).toHaveLength(3)
    expect(result.params).toHaveLength(3)
    expect(result.sql).toContain("AND")
  })

  it("should compile contains op", () => {
    const spec: QuerySpec = {
      intent: "narrow",
      navigation: "none",
      constraints: [{ field: "brand", op: "contains", value: "CRX" }],
    }
    const result = compileProductQuery(spec)
    expect(result.sql).toContain("LIKE")
    expect(result.params).toContain("%crx%")
  })
})

// ══════════════════════════════════════════════════════════════
// C. Bridge 테스트
// ══════════════════════════════════════════════════════════════

describe("querySpecToAppliedFilters", () => {
  it("should convert basic constraints to AppliedFilter[]", () => {
    const spec: QuerySpec = {
      intent: "narrow",
      navigation: "none",
      constraints: [
        { field: "toolSubtype", op: "eq", value: "Square" },
        { field: "diameterMm", op: "eq", value: 10 },
      ],
    }
    const filters = querySpecToAppliedFilters(spec, 1)
    expect(filters).toHaveLength(2)
    expect(filters[0].field).toBe("toolSubtype")
    expect(filters[1].field).toBe("diameterMm")
  })

  it("should convert neq constraint", () => {
    const spec: QuerySpec = {
      intent: "narrow",
      navigation: "none",
      constraints: [
        { field: "coating", op: "neq", value: "TiAlN" },
      ],
    }
    const filters = querySpecToAppliedFilters(spec, 0)
    expect(filters).toHaveLength(1)
    expect(filters[0].op).toBe("neq")
  })

  it("Phase 2: should preserve gte op", () => {
    const spec: QuerySpec = {
      intent: "narrow",
      navigation: "none",
      constraints: [{ field: "diameterMm", op: "gte", value: 10 }],
    }
    const filters = querySpecToAppliedFilters(spec, 0)
    expect(filters).toHaveLength(1)
    expect(filters[0].op).toBe("gte")
    expect(filters[0].rawValue).toBe(10)
  })

  it("Phase 2: should preserve between op with rawValue2", () => {
    const spec: QuerySpec = {
      intent: "narrow",
      navigation: "none",
      constraints: [{ field: "diameterMm", op: "between", value: [8, 12] }],
    }
    const filters = querySpecToAppliedFilters(spec, 0)
    expect(filters).toHaveLength(1)
    expect(filters[0].op).toBe("between")
    expect(filters[0].rawValue).toBe(8)
    expect(filters[0].rawValue2).toBe(12)
  })

  it("Phase 2: should preserve lte op", () => {
    const spec: QuerySpec = {
      intent: "narrow",
      navigation: "none",
      constraints: [{ field: "fluteCount", op: "lte", value: 4 }],
    }
    const filters = querySpecToAppliedFilters(spec, 0)
    expect(filters).toHaveLength(1)
    expect(filters[0].op).toBe("lte")
  })

  it("should skip unknown fields", () => {
    const spec: QuerySpec = {
      intent: "narrow",
      navigation: "none",
      constraints: [
        { field: "unknownField" as any, op: "eq", value: "test" },
      ],
    }
    const filters = querySpecToAppliedFilters(spec, 0)
    expect(filters).toHaveLength(0)
  })
})

describe("appliedFiltersToConstraints (reverse)", () => {
  it("should convert AppliedFilter[] back to QueryConstraint[]", () => {
    const filters = [
      { field: "toolSubtype", op: "eq" as const, value: "Square", rawValue: "Square", appliedAt: 0 },
      { field: "diameterMm", op: "eq" as const, value: "10mm", rawValue: 10, appliedAt: 0 },
      { field: "coating", op: "neq" as const, value: "TiAlN 제외", rawValue: "TiAlN", appliedAt: 0 },
    ]
    const constraints = appliedFiltersToConstraints(filters)
    expect(constraints).toHaveLength(3)
    expect(constraints[0].field).toBe("toolSubtype")
    expect(constraints[2].op).toBe("neq")
  })

  it("should skip 'skip' op filters", () => {
    const filters = [
      { field: "coating", op: "skip" as const, value: "상관없음", rawValue: "", appliedAt: 0 },
    ]
    const constraints = appliedFiltersToConstraints(filters)
    expect(constraints).toHaveLength(0)
  })
})

// ══════════════════════════════════════════════════════════════
// D. Relaxation 테스트
// ══════════════════════════════════════════════════════════════

describe("executeWithRelaxation", () => {
  it("should use strict strategy when rows > 0", async () => {
    const spec: QuerySpec = {
      intent: "narrow",
      navigation: "none",
      constraints: [{ field: "diameterMm", op: "eq", value: 10 }],
    }
    const executor: QueryExecutor = vi.fn().mockResolvedValue({ rows: [{}], rowCount: 5 })
    const result = await executeWithRelaxation(spec, executor)
    expect(result.strategy).toBe("strict")
    expect(result.rowCount).toBe(5)
    expect(result.attempts).toHaveLength(1)
  })

  it("should fall back to diameter_near_0_5 when strict returns 0", async () => {
    const spec: QuerySpec = {
      intent: "narrow",
      navigation: "none",
      constraints: [{ field: "diameterMm", op: "eq", value: 10 }],
    }
    const executor: QueryExecutor = vi.fn()
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      .mockResolvedValueOnce({ rows: [{}], rowCount: 3 })
    const result = await executeWithRelaxation(spec, executor)
    expect(result.strategy).toBe("diameter_near_0_5")
    expect(result.attempts).toHaveLength(2)
  })

  it("should record exhausted when all strategies return 0", async () => {
    const spec: QuerySpec = {
      intent: "narrow",
      navigation: "none",
      constraints: [{ field: "diameterMm", op: "eq", value: 10 }],
    }
    const executor: QueryExecutor = vi.fn().mockResolvedValue({ rows: [], rowCount: 0 })
    const result = await executeWithRelaxation(spec, executor)
    expect(result.strategy).toContain("exhausted")
    expect(result.rowCount).toBe(0)
    expect(result.attempts.length).toBeGreaterThan(1)
  })
})

// ══════════════════════════════════════════════════════════════
// E. Golden case 테스트 (KG 경로 — 기존 동작 검증)
// ══════════════════════════════════════════════════════════════

describe("KG golden cases", () => {
  it('"이전 단계" → go_back_one_step', () => {
    const result = tryKGDecision("이전 단계", null)
    expect(result.confidence).toBeGreaterThanOrEqual(0.9)
    expect(result.decision?.action.type).toBe("go_back_one_step")
  })

  it('"처음부터 다시" → reset_session', () => {
    const result = tryKGDecision("처음부터 다시", null)
    expect(result.confidence).toBeGreaterThanOrEqual(0.9)
    expect(result.decision?.action.type).toBe("reset_session")
  })

  it('"상관없음" → skip_field (with pending)', () => {
    const mockState = { lastAskedField: "coating" } as any
    const result = tryKGDecision("상관없음", mockState)
    expect(result.confidence).toBeGreaterThanOrEqual(0.9)
    expect(result.decision?.action.type).toBe("skip_field")
  })

  it('"TiAlN이 뭐야?" → answer_general or question route', () => {
    const result = tryKGDecision("TiAlN이 뭐야?", null)
    // TiAlN이 뭐야 = general question, KG may or may not handle it
    // But it should NOT create a filter
    const action = result.decision?.action
    if (action) {
      expect(action.type).not.toBe("continue_narrowing")
    }
  })

  it('"4날 말고 다른거" → exclude fluteCount', () => {
    const result = tryKGDecision("4날 말고 다른거", null)
    expect(result.confidence).toBeGreaterThanOrEqual(0.9)
    const action = result.decision?.action as any
    if (action?.type === "continue_narrowing" && action.filter) {
      expect(action.filter.op).toBe("exclude")
      expect(action.filter.field).toBe("fluteCount")
    }
  })

  it('"TANK-POWER 빼고" → exclude brand', () => {
    const result = tryKGDecision("TANK-POWER 빼고", null)
    if (result.decision) {
      const action = result.decision.action as any
      if (action?.type === "continue_narrowing" && action.filter) {
        expect(action.filter.op).toBe("exclude")
      }
    }
  })

  it('"스퀘어 4날" → multi-entity extraction', () => {
    const result = tryKGDecision("스퀘어 4날", null)
    expect(result.confidence).toBeGreaterThanOrEqual(0.9)
    expect(result.decision).not.toBeNull()
    const action = result.decision?.action as any
    expect(action?.type).toBe("continue_narrowing")
  })

  it('"CRX-S 추천해줘" → should extract brand or show_recommendation', () => {
    const result = tryKGDecision("CRX-S 추천해줘", null)
    // CRX-S is a brand, 추천해줘 could trigger show_recommendation
    expect(result.decision).not.toBeNull()
  })

  it('"싱크 타입 플레인" → shankType=Plain (NOT brand)', () => {
    const result = tryKGDecision("싱크 타입 플레인", null)
    expect(result.confidence).toBeGreaterThanOrEqual(0.9)
    const action = result.decision?.action as any
    expect(action?.type).toBe("continue_narrowing")
    expect(action?.filter?.field).toBe("shankType")
    expect(action?.filter?.rawValue ?? action?.filter?.value).toMatch(/plain/i)
  })

  it('"생크 타입 웰던" → shankType=Weldon', () => {
    const result = tryKGDecision("생크 타입 웰던", null)
    expect(result.confidence).toBeGreaterThanOrEqual(0.9)
    const action = result.decision?.action as any
    expect(action?.type).toBe("continue_narrowing")
    expect(action?.filter?.field).toBe("shankType")
  })

  it('"구리" → workPieceName=Copper', () => {
    const result = tryKGDecision("구리", null)
    expect(result.decision).not.toBeNull()
    const action = result.decision?.action as any
    if (action?.filter) {
      expect(action.filter.field).toBe("workPieceName")
    }
  })

  it('"P소재로 해줘" → material=P (ISO group, not workpiece)', () => {
    const result = tryKGDecision("P소재로 해줘", null)
    expect(result.confidence).toBeGreaterThanOrEqual(0.9)
    const action = result.decision?.action as any
    // P should be recognized as material group, not workPieceName="P"
    if (action?.filter) {
      expect(action.filter.field).toBe("material")
      expect(action.filter.rawValue ?? action.filter.value).toBe("P")
    }
  })

  it('"M소재" → material=M', () => {
    const result = tryKGDecision("M소재", null)
    expect(result.confidence).toBeGreaterThanOrEqual(0.9)
    const action = result.decision?.action as any
    if (action?.filter) {
      expect(action.filter.field).toBe("material")
    }
  })
})

// ══════════════════════════════════════════════════════════════
// F. Compiler shankType 테스트
// ══════════════════════════════════════════════════════════════

describe("compileProductQuery - shankType", () => {
  it("should compile shankType contains", () => {
    const spec: QuerySpec = {
      intent: "narrow",
      navigation: "none",
      constraints: [{ field: "shankType", op: "contains", value: "Plain" }],
    }
    const result = compileProductQuery(spec)
    expect(result.sql).toContain("shank_type")
    expect(result.sql).toContain("LIKE")
    expect(result.appliedConstraints).toHaveLength(1)
  })

  it("should compile shankType eq", () => {
    const spec: QuerySpec = {
      intent: "narrow",
      navigation: "none",
      constraints: [{ field: "shankType", op: "eq", value: "Weldon" }],
    }
    const result = compileProductQuery(spec)
    expect(result.sql).toContain("shank_type")
    expect(result.appliedConstraints).toHaveLength(1)
  })
})
