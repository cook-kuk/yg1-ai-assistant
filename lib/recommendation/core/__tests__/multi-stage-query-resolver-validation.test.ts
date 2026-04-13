import path from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type { LLMProvider } from "@/lib/llm/provider"
import {
  _resetMaterialMappingCacheForTest,
  _setMaterialMappingTestPaths,
} from "@/lib/recommendation/shared/material-mapping"
import { assessComplexity } from "../complexity-router"
import {
  _resetMultiStageResolverCacheForTest,
  resolveMultiStageQuery,
} from "../multi-stage-query-resolver"

const FIXTURE_ROOT = path.resolve(process.cwd(), "lib", "recommendation", "shared", "__tests__", "fixtures")

vi.mock("../sql-agent-schema-cache", () => ({
  getDbSchemaSync: () => ({
    columns: [],
    sampleValues: {
      coating: ["TiAlN", "AlCrN", "DLC"],
      tool_subtype: ["Square", "Ball", "Radius"],
      search_coating: ["TiAlN", "AlCrN", "DLC"],
      search_subtype: ["Square", "Ball", "Radius"],
    },
    workpieces: ["Titanium", "Stainless Steels", "Aluminum"],
    brands: ["CRX S", "ALU-CUT", "4G MILL"],
    loadedAt: Date.now(),
  }),
  findValueByPhonetic: () => null,
}))

function makeProvider(...responses: string[]): LLMProvider & { complete: ReturnType<typeof vi.fn> } {
  const queue = [...responses]
  const complete = vi.fn(async () => queue.shift() ?? "")
  return {
    available: () => true,
    complete,
    completeWithTools: vi.fn(async () => ({ text: null, toolUse: null })),
  } as unknown as LLMProvider & { complete: ReturnType<typeof vi.fn> }
}

describe("resolveMultiStageQuery validation-driven escalation", () => {
  beforeEach(() => {
    _resetMultiStageResolverCacheForTest()
    _setMaterialMappingTestPaths({
      materialPath: path.join(FIXTURE_ROOT, "material-mapping-sample.csv"),
      brandAffinityPath: path.join(FIXTURE_ROOT, "brand-material-affinity-sample.csv"),
      seriesProfilePath: path.join(FIXTURE_ROOT, "series-profile-sample.csv"),
    })
  })

  afterEach(() => {
    _resetMaterialMappingCacheForTest()
  })

  it("re-routes a stage1 negation conflict into semantic CoT before execution", async () => {
    const stage2Provider = makeProvider(JSON.stringify({
      filters: [{ field: "workPieceName", op: "neq", value: "Titanium", rawToken: "titanium" }],
      sort: null,
      routeHint: "none",
      clearOtherFilters: false,
      confidence: 0.93,
      unresolvedTokens: [],
      reasoning: "exclude titanium family instead of keeping it",
    }))

    const result = await resolveMultiStageQuery({
      message: "exclude titanium",
      turnCount: 2,
      currentFilters: [],
      complexity: assessComplexity("exclude titanium"),
      stageOneDeterministicActions: [
        {
          type: "apply_filter",
          field: "workPieceName",
          op: "eq",
          value: "Titanium",
          source: "deterministic",
        },
      ],
      stage2Provider,
      stage3Provider: makeProvider(),
      stage1CotEscalation: {
        enabled: true,
      },
    })

    expect(result.source).toBe("stage2")
    expect(result.filters).toEqual([
      expect.objectContaining({ field: "workPieceName", op: "neq", rawValue: "Titanium" }),
    ])
    expect(result.validation?.valid).toBe(true)
    expect(stage2Provider.complete).toHaveBeenCalledTimes(1)
  })

  it("re-routes includes-based negation conflicts into semantic CoT before execution", async () => {
    const stage2Provider = makeProvider(JSON.stringify({
      filters: [{ field: "brand", op: "neq", value: "4G MILL", rawToken: "4g mill" }],
      sort: null,
      routeHint: "none",
      clearOtherFilters: false,
      confidence: 0.92,
      unresolvedTokens: [],
      reasoning: "exclude the mentioned brand instead of keeping it",
    }))

    const result = await resolveMultiStageQuery({
      message: "4G MILL 아닌 거로",
      turnCount: 2,
      currentFilters: [],
      complexity: assessComplexity("4G MILL 아닌 거로"),
      stageOneDeterministicActions: [
        {
          type: "apply_filter",
          field: "brand",
          op: "includes",
          value: "4G MILL",
          source: "deterministic",
        },
      ],
      stage2Provider,
      stage3Provider: makeProvider(),
      stage1CotEscalation: {
        enabled: true,
      },
    })

    expect(result.source).toBe("stage2")
    expect(result.filters).toEqual([
      expect.objectContaining({ field: "brand", op: "neq", rawValue: "4G MILL" }),
    ])
    expect(result.validation?.valid).toBe(true)
  })

  it("escalates a range mismatch from stage2 to stage3 and keeps the executable operator", async () => {
    const stage2Provider = makeProvider(JSON.stringify({
      filters: [{ field: "diameterMm", op: "eq", value: 10, rawToken: "10" }],
      sort: null,
      routeHint: "none",
      clearOtherFilters: false,
      confidence: 0.91,
      unresolvedTokens: [],
      reasoning: "picked the number but missed the range operator",
    }))
    const stage3Provider = makeProvider(JSON.stringify({
      filters: [{ field: "diameterMm", op: "gte", value: 10, rawToken: "at least 10" }],
      sort: null,
      routeHint: "none",
      clearOtherFilters: false,
      confidence: 0.95,
      unresolvedTokens: [],
      reasoning: "restored the gte operator from the utterance",
    }))

    const result = await resolveMultiStageQuery({
      message: "diameter at least 10",
      turnCount: 4,
      currentFilters: [],
      complexity: assessComplexity("diameter at least 10"),
      stage2Provider,
      stage3Provider,
    })

    expect(result.source).toBe("stage3")
    expect(result.filters).toEqual([
      expect.objectContaining({ field: "diameterMm", op: "gte", rawValue: 10 }),
    ])
    expect(result.validation?.valid).toBe(true)
  })
})
