import path from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type { LLMProvider } from "@/lib/llm/provider"
import { _resetMaterialMappingCacheForTest, _setMaterialMappingTestPaths } from "@/lib/recommendation/shared/material-mapping"
import { assessComplexity } from "../complexity-router"
import { _resetMultiStageResolverCacheForTest, resolveMultiStageQuery } from "../multi-stage-query-resolver"

const FIXTURE_ROOT = path.resolve(process.cwd(), "lib", "recommendation", "shared", "__tests__", "fixtures")

vi.mock("../sql-agent-schema-cache", () => ({
  getDbSchemaSync: () => ({
    columns: [],
    sampleValues: {
      coating: ["TiAlN", "AlCrN", "DLC"],
      tool_subtype: ["Square", "Ball", "Radius"],
    },
    workpieces: ["Stainless Steels", "Aluminum", "Carbon Steels"],
    brands: ["CRX S", "ALU-CUT", "TANK-POWER", "V7 PLUS"],
    loadedAt: Date.now(),
  }),
  findValueByPhonetic: () => null,
}))

function makeUnavailableProvider(): LLMProvider & { complete: ReturnType<typeof vi.fn> } {
  const complete = vi.fn(async () => "")
  return {
    available: () => false,
    complete,
    completeWithTools: vi.fn(async () => ({ text: null, toolUse: null })),
  } as unknown as LLMProvider & { complete: ReturnType<typeof vi.fn> }
}

describe("resolveMultiStageQuery material mapping", () => {
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

  it("injects scoped material mapping context into Stage 2 for unresolved material aliases", async () => {
    const stage2Provider = {
      available: () => true,
      complete: vi.fn(async (_systemPrompt: string, messages: Array<{ role: string; content: string }>) => {
        const userPrompt = messages[0]?.content ?? ""
        expect(userPrompt).toContain("Material mapping context:")
        expect(userPrompt).toContain("Carbon Steel")
        expect(userPrompt).toContain("ISO P")
        return JSON.stringify({
          filters: [{ field: "workPieceName", op: "eq", value: "Carbon Steel", rawToken: "AISI 1010" }],
          sort: null,
          routeHint: "show_recommendation",
          clearOtherFilters: false,
          confidence: 0.93,
          unresolvedTokens: [],
          reasoning: "material mapping context resolved the alias",
        })
      }),
      completeWithTools: vi.fn(async () => ({ text: null, toolUse: null })),
    } as unknown as LLMProvider & { complete: ReturnType<typeof vi.fn> }

    const result = await resolveMultiStageQuery({
      message: "AISI 1010 carbon steel recommendation",
      turnCount: 4,
      currentFilters: [],
      complexity: assessComplexity("AISI 1010 carbon steel recommendation"),
      stage2Provider,
      stage3Provider: makeUnavailableProvider(),
    })

    expect(result.source).toBe("stage2")
    expect(result.intent).toBe("show_recommendation")
    expect(result.filters).toEqual([
      expect.objectContaining({ field: "workPieceName", rawValue: "Carbon Steel" }),
    ])
  })
})
