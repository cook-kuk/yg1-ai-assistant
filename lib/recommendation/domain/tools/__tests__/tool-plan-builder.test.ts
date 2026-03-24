import { describe, it, expect } from "vitest"
import { buildToolPlan, planRequiresSearch } from "../tool-plan-builder"
import { aggregateToolResults, hasMinimumEvidence, buildMissingEvidenceNote } from "../tool-aggregator"
import { classifyQueryTarget } from "../../context/query-target-classifier"
import type { ToolResult } from "../tool-types"

const defaultContext = {
  hasCurrentCandidates: true,
  candidateCount: 100,
  hasRecommendation: false,
  hasComparison: false,
  hasCuttingConditions: false,
  appliedFilters: [{ field: "coating", value: "DLC" }],
}

// ════════════════════════════════════════════════════════════════
// TOOL PLAN BUILDER
// ════════════════════════════════════════════════════════════════

describe("tool-plan-builder: series comparison", () => {
  it("plans series lookup + comparison for two entities", () => {
    const qt = classifyQueryTarget("ALU-CUT과 ALU-POWER HPC 비교해줘", "coating")
    const plan = buildToolPlan(qt, defaultContext)

    expect(plan.answerTopic).toBe("series_comparison")
    expect(plan.plannedCalls.length).toBeGreaterThanOrEqual(3) // 2 lookups + 1 comparison
    expect(plan.plannedCalls.some(c => c.tool === "series_lookup")).toBe(true)
    expect(plan.plannedCalls.some(c => c.tool === "comparison")).toBe(true)
    expect(plan.targetEntities.length).toBeGreaterThanOrEqual(2)
  })

  it("requires search", () => {
    const qt = classifyQueryTarget("ALU-CUT과 ALU-POWER HPC 비교", "coating")
    const plan = buildToolPlan(qt, defaultContext)
    expect(planRequiresSearch(plan)).toBe(true)
  })
})

describe("tool-plan-builder: series info", () => {
  it("plans series lookup + optional inventory", () => {
    const qt = classifyQueryTarget("ALU-CUT 시리즈 특징이 뭐야?", "coating")
    const plan = buildToolPlan(qt, defaultContext)

    expect(plan.answerTopic).toBe("series_info")
    expect(plan.plannedCalls.some(c => c.tool === "series_lookup" && c.required)).toBe(true)
    expect(plan.plannedCalls.some(c => c.tool === "inventory_lookup")).toBe(true)
  })
})

describe("tool-plan-builder: count query", () => {
  it("plans count aggregation for distribution query without field match", () => {
    const qt = classifyQueryTarget("후보가 몇개야?", null) // no pending field
    const plan = buildToolPlan(qt, defaultContext)

    expect(plan.answerTopic).toBe("count_query")
    expect(plan.plannedCalls.some(c => c.tool === "count_aggregation")).toBe(true)
  })

  it("Ball은 몇개야? with toolSubtype pending → active_field_query", () => {
    const qt = classifyQueryTarget("Ball은 몇개야?", null, "toolSubtype")
    const plan = buildToolPlan(qt, defaultContext)
    // Ball matches toolSubtype field, so it's active_field_query not count_query
    expect(plan.answerTopic).toBe("field_explanation")
  })
})

describe("tool-plan-builder: field explanation", () => {
  it("does NOT require search for field explanation", () => {
    const qt = classifyQueryTarget("DLC가 뭐야?", "coating", "coating")
    const plan = buildToolPlan(qt, defaultContext)

    expect(planRequiresSearch(plan)).toBe(false)
  })
})

// ════════════════════════════════════════════════════════════════
// TOOL AGGREGATOR
// ════════════════════════════════════════════════════════════════

describe("tool-aggregator: success", () => {
  it("aggregates successful results", () => {
    const qt = classifyQueryTarget("ALU-CUT 특징", "coating")
    const plan = buildToolPlan(qt, defaultContext)

    const results: ToolResult[] = [
      { tool: "series_lookup", status: "success", data: { series: "ALU-CUT", products: 10 }, evidenceSummary: "ALU-CUT: 10개 제품" },
      { tool: "inventory_lookup", status: "success", data: { inStock: 5 }, evidenceSummary: "재고 5개" },
    ]

    const aggregate = aggregateToolResults(plan, results)
    expect(aggregate.allSucceeded).toBe(true)
    expect(aggregate.missingEvidence.length).toBe(0)
    expect(aggregate.evidenceSummary).toContain("ALU-CUT")
  })
})

describe("tool-aggregator: partial failure", () => {
  it("detects missing evidence from required tools", () => {
    const qt = classifyQueryTarget("ALU-CUT과 TANK-POWER 비교", "coating")
    const plan = buildToolPlan(qt, defaultContext)

    const results: ToolResult[] = [
      { tool: "series_lookup", status: "success", data: {}, evidenceSummary: "ALU-CUT 정보" },
      { tool: "series_lookup", status: "not_found", data: {}, evidenceSummary: "" },
      // comparison tool not called
    ]

    const aggregate = aggregateToolResults(plan, results)
    expect(aggregate.allSucceeded).toBe(false)
    expect(aggregate.missingEvidence.length).toBeGreaterThan(0)
  })
})

describe("tool-aggregator: minimum evidence", () => {
  it("hasMinimumEvidence returns false when all required tools failed", () => {
    const qt = classifyQueryTarget("ALU-CUT 특징", "coating")
    const plan = buildToolPlan(qt, defaultContext)

    const results: ToolResult[] = [
      { tool: "series_lookup", status: "error", data: {}, evidenceSummary: "" },
    ]

    const aggregate = aggregateToolResults(plan, results)
    expect(hasMinimumEvidence(aggregate)).toBe(false)
  })

  it("buildMissingEvidenceNote is empty when nothing missing", () => {
    expect(buildMissingEvidenceNote([])).toBe("")
  })

  it("buildMissingEvidenceNote shows missing items", () => {
    const note = buildMissingEvidenceNote(["재고 확인", "시리즈 조회"])
    expect(note).toContain("확인되지 않은 정보")
    expect(note).toContain("재고 확인")
  })
})
