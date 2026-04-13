import { beforeEach, describe, expect, it, vi } from "vitest"

import type { LLMProvider } from "@/lib/llm/provider"
import { assessComplexity } from "../complexity-router"
import {
  _resetMultiStageResolverCacheForTest,
  resolveMultiStageQuery,
} from "../multi-stage-query-resolver"

vi.mock("../sql-agent-schema-cache", () => ({
  getDbSchemaSync: () => null,
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

describe("resolveMultiStageQuery cold-schema safety", () => {
  beforeEach(() => {
    _resetMultiStageResolverCacheForTest()
  })

  it("does not throw when schema cache is cold and stage2 prompt needs schema context", async () => {
    await expect(resolveMultiStageQuery({
      message: "스텐인리스 4낭 10mn",
      turnCount: 1,
      currentFilters: [],
      complexity: assessComplexity("스텐인리스 4낭 10mn"),
      stageOneDeterministicActions: [
        {
          type: "apply_filter",
          field: "workPieceName",
          op: "includes",
          value: "Stainless Steels",
          source: "deterministic",
        },
        {
          type: "apply_filter",
          field: "fluteCount",
          op: "eq",
          value: 4,
          source: "deterministic",
        },
        {
          type: "apply_filter",
          field: "diameterMm",
          op: "eq",
          value: 10,
          source: "deterministic",
        },
      ],
      stage2Provider: makeUnavailableProvider(),
      stage3Provider: makeUnavailableProvider(),
      stage1CotEscalation: {
        enabled: true,
      },
    })).resolves.toEqual(expect.objectContaining({
      source: expect.any(String),
    }))
  })
})
