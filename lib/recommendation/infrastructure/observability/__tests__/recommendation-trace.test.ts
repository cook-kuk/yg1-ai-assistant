import { describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))

import { summarizeRecommendationTracePayload } from "../recommendation-trace"

describe("recommendation trace summarizer", () => {
  it("summarizes request prep into intent/route/slots only", () => {
    const result = summarizeRecommendationTracePayload("runtime.handleServeExplorationInner:request-prep", {
      requestPrep: {
        intent: "product_recommendation",
        intentConfidence: 0.93,
        route: "recommendation",
        slots: [
          { field: "toolSubtype", value: "Square" },
          { field: "fluteCount", value: 3 },
        ],
      },
      filters: [
        { field: "material", op: "eq", rawValue: "P" },
      ],
      turnCount: 2,
      hugeBlob: { nested: ["ignore"] },
    })

    expect(result).toEqual({
      stage: "intent",
      intent: "product_recommendation",
      confidence: 0.93,
      route: "recommendation",
      slots: ["toolSubtype=Square", "fluteCount=3"],
      activeFilters: ["material=P"],
      turnCount: 2,
    })
  })

  it("summarizes question response output into field/question/response", () => {
    const result = summarizeRecommendationTracePayload("response.buildQuestionResponse:output", {
      purpose: "question",
      question: {
        field: "fluteCount",
        questionText: "현재 1318개 후보가 있습니다. 날 수(flute) 선호가 있으신가요?",
      },
      responseText: "현재 1318개 후보가 있습니다. 날 수(flute) 선호가 있으신가요?",
      chipPreview: ["2날 (216개)", "3날 (173개)"],
      displayedOptions: [
        { label: "2날 (216개)", field: "fluteCount", value: "2날" },
        { label: "3날 (173개)", field: "fluteCount", value: "3날" },
      ],
      sessionState: { giant: "hidden" },
    })

    expect(result).toEqual({
      stage: "question-output",
      purpose: "question",
      field: "fluteCount",
      question: "현재 1318개 후보가 있습니다. 날 수(flute) 선호가 있으신가요?",
      response: "현재 1318개 후보가 있습니다. 날 수(flute) 선호가 있으신가요?",
      chips: ["2날 (216개)", "3날 (173개)"],
      optionLabels: ["2날 (216개)(fluteCount)", "3날 (173개)(fluteCount)"],
    })
  })

  it("summarizes llm filter result with skipped fields", () => {
    const result = summarizeRecommendationTracePayload("runtime.handleServeExplorationInner:llm-filter-result", {
      pendingField: "toolSubtype",
      llmResult: {
        extractedFilters: {
          toolSubtype: "Square",
          fluteCount: 3,
        },
        skippedFields: ["coating"],
        skipPendingField: false,
        isSideQuestion: false,
        confidence: 0.94,
      },
      rawPayload: { ignore: true },
    })

    expect(result).toEqual({
      stage: "llm-filter",
      pendingField: "toolSubtype",
      extractedFilters: ["toolSubtype=Square", "fluteCount=3"],
      skippedFields: ["coating"],
      skipPendingField: false,
      isSideQuestion: false,
      confidence: 0.94,
    })
  })

  it("summarizes sql-agent filter pipeline with dropped filters", () => {
    const result = summarizeRecommendationTracePayload("runtime.handleServeExplorationInner:sql-agent-filter-pipeline", {
      confidence: "medium",
      parsedFilters: [
        { field: "diameterMm", op: "gte", value: 10 },
        { field: "coating", op: "eq", value: "모르겠음" },
      ],
      normalizedFilters: [
        { field: "diameterMm", op: "gte", rawValue: 10 },
      ],
      droppedFilters: [
        { field: "coating", op: "eq", value: "모르겠음", reason: "skip_token" },
      ],
      finalFilters: [
        { field: "diameterMm", op: "gte", rawValue: 10 },
      ],
    })

    expect(result).toEqual({
      stage: "sql-agent-filter-pipeline",
      confidence: "medium",
      parsedFilters: ["diameterMm=10", "coating=모르겠음"],
      normalizedFilters: ["diameterMm=10"],
      droppedFilters: ["coating:eq=모르겠음 (skip_token)"],
      finalFilters: ["diameterMm=10"],
    })
  })

  it("summarizes db query plans into clauses and counts", () => {
    const result = summarizeRecommendationTracePayload("db.product.queryProductsPageFromDatabase:plan", {
      operation: "queryProductsPageFromDatabase",
      appliedClauses: [
        { field: "diameterMm", op: "gte", clause: "search_diameter_mm >= $1" },
        { field: "workPieceName", op: "eq", clause: "normalized_work_piece_name = $2" },
      ],
      skippedFilters: [
        { field: "diameterMm", op: "eq", value: "10", reason: "handled_by_input" },
      ],
      droppedFilters: [
        { field: "coating", op: "includes", value: "unknown", reason: "no_db_clause" },
      ],
      finalWhereClauses: ["search_diameter_mm >= $1", "normalized_work_piece_name = $2"],
      totalCount: 42,
      pageCount: 20,
    })

    expect(result).toEqual({
      stage: "db-query-plan",
      operation: "queryProductsPageFromDatabase",
      appliedClauses: [
        "diameterMm:gte => search_diameter_mm >= $1",
        "workPieceName:eq => normalized_work_piece_name = $2",
      ],
      skippedFilters: ["diameterMm:eq=10 (handled_by_input)"],
      droppedFilters: ["coating:includes=unknown (no_db_clause)"],
      finalWhereClauses: ["search_diameter_mm >= $1", "normalized_work_piece_name = $2"],
      totalCount: 42,
      pageCount: 20,
    })
  })
})
