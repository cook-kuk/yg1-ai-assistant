import { describe, it, expect, vi } from "vitest"
import {
  TOOL_DEFINITIONS,
  buildSystemPrompt,
  mapToolResult,
  buildTextFallback,
  canonicalizeParams,
  classifyWithToolUse,
  ENABLE_TOOL_USE_CLASSIFIER,
  type ToolUseClassification,
} from "../tool-use-classifier"
import type { LLMProvider, LLMToolResult } from "@/lib/llm/provider"
import type { ExplorationSessionState } from "@/lib/recommendation/domain/types"

// ── Helpers ──────────────────────────────────────────────────

function makeMockProvider(
  toolUse: LLMToolResult | null = null,
  text: string | null = null
): LLMProvider {
  return {
    available: () => true,
    complete: vi.fn().mockResolvedValue(""),
    completeWithTools: vi.fn().mockResolvedValue({ text, toolUse }),
  }
}

function makeErrorProvider(error: Error): LLMProvider {
  return {
    available: () => true,
    complete: vi.fn().mockRejectedValue(error),
    completeWithTools: vi.fn().mockRejectedValue(error),
  }
}

function makeSessionState(overrides: Partial<ExplorationSessionState> = {}): ExplorationSessionState {
  return {
    appliedFilters: [],
    candidateCount: 50,
    currentMode: "narrowing",
    lastAskedField: null,
    resolutionStatus: null,
    ...overrides,
  } as unknown as ExplorationSessionState
}

// ── Feature flag ─────────────────────────────────────────────

describe("ENABLE_TOOL_USE_CLASSIFIER", () => {
  it("defaults to false when env is unset", () => {
    // The env var is not set in test, so it should be false
    expect(ENABLE_TOOL_USE_CLASSIFIER).toBe(false)
  })
})

// ── TOOL_DEFINITIONS ─────────────────────────────────────────

describe("TOOL_DEFINITIONS", () => {
  it("has 7 tool definitions", () => {
    expect(TOOL_DEFINITIONS).toHaveLength(7)
  })

  it("all tools have name, description, and input_schema", () => {
    for (const tool of TOOL_DEFINITIONS) {
      expect(tool.name).toBeTruthy()
      expect(tool.description).toBeTruthy()
      expect(tool.input_schema).toBeDefined()
      expect(tool.input_schema.type).toBe("object")
    }
  })

  it("tool names match expected set", () => {
    const names = TOOL_DEFINITIONS.map(t => t.name)
    expect(names).toEqual([
      "apply_filter",
      "replace_filter",
      "remove_filter",
      "answer_question",
      "skip_field",
      "compare_products",
      "show_recommendation",
    ])
  })

  it("apply_filter includes field enum with 6 fields", () => {
    const applyFilter = TOOL_DEFINITIONS.find(t => t.name === "apply_filter")!
    const props = applyFilter.input_schema.properties as Record<string, Record<string, unknown>>
    expect(props.field.enum).toHaveLength(6)
    expect(props.field.enum).toContain("toolSubtype")
    expect(props.field.enum).toContain("diameterMm")
  })

  it("apply_filter has op enum with eq and neq", () => {
    const applyFilter = TOOL_DEFINITIONS.find(t => t.name === "apply_filter")!
    const props = applyFilter.input_schema.properties as Record<string, Record<string, unknown>>
    expect(props.op.enum).toEqual(["eq", "neq"])
  })

  it("compare_products targets is array type", () => {
    const compare = TOOL_DEFINITIONS.find(t => t.name === "compare_products")!
    const props = compare.input_schema.properties as Record<string, Record<string, unknown>>
    expect(props.targets.type).toBe("array")
  })

  it("show_recommendation has no required fields", () => {
    const show = TOOL_DEFINITIONS.find(t => t.name === "show_recommendation")!
    expect(show.input_schema.required).toEqual([])
  })
})

// ── buildSystemPrompt ────────────────────────────────────────

describe("buildSystemPrompt", () => {
  it("includes 'No session state' for null state", () => {
    const prompt = buildSystemPrompt(null)
    expect(prompt).toContain("No session state (first turn)")
  })

  it("includes applied filters when present", () => {
    const state = makeSessionState({
      appliedFilters: [
        { field: "toolSubtype", value: "Square", rawValue: "Square", op: "eq", appliedAt: 0 },
      ] as any,
    })
    const prompt = buildSystemPrompt(state)
    expect(prompt).toContain("toolSubtype=Square")
  })

  it("includes candidate count", () => {
    const state = makeSessionState({ candidateCount: 123 })
    const prompt = buildSystemPrompt(state)
    expect(prompt).toContain("Candidate count: 123")
  })

  it("includes last asked field", () => {
    const state = makeSessionState({ lastAskedField: "coating" })
    const prompt = buildSystemPrompt(state)
    expect(prompt).toContain("Last asked field: coating")
  })

  it("includes canonicalization rules", () => {
    const prompt = buildSystemPrompt(null)
    expect(prompt).toContain("toolSubtype: always English")
    expect(prompt).toContain("fluteCount: number only")
  })
})

// ── mapToolResult ────────────────────────────────────────────

describe("mapToolResult", () => {
  it("maps apply_filter tool result", () => {
    const result = mapToolResult({
      toolName: "apply_filter",
      input: { field: "coating", value: "TiAlN", op: "eq" },
    })
    expect(result.actionType).toBe("apply_filter")
    expect(result.toolInvoked).toBe(true)
    expect(result.params).toEqual({ field: "coating", value: "TiAlN", op: "eq" })
  })

  it("maps compare_products tool result", () => {
    const result = mapToolResult({
      toolName: "compare_products",
      input: { targets: ["A-123", "B-456"] },
    })
    expect(result.actionType).toBe("compare_products")
    expect(result.params.targets).toEqual(["A-123", "B-456"])
  })

  it("maps show_recommendation with empty params", () => {
    const result = mapToolResult({
      toolName: "show_recommendation",
      input: {},
    })
    expect(result.actionType).toBe("show_recommendation")
    expect(result.toolInvoked).toBe(true)
  })

  it("maps skip_field with optional field", () => {
    const result = mapToolResult({
      toolName: "skip_field",
      input: { field: "coating" },
    })
    expect(result.actionType).toBe("skip_field")
    expect(result.params.field).toBe("coating")
  })

  it("falls back to answer_question for unknown tool name", () => {
    const result = mapToolResult({
      toolName: "unknown_tool",
      input: { data: "test" },
    })
    expect(result.actionType).toBe("answer_question")
    expect(result.toolInvoked).toBe(true)
  })
})

// ── buildTextFallback ────────────────────────────────────────

describe("buildTextFallback", () => {
  it("creates answer_question classification from text", () => {
    const result = buildTextFallback("TiAlN은 내열성 코팅입니다.")
    expect(result.actionType).toBe("answer_question")
    expect(result.toolInvoked).toBe(false)
    expect(result.textResponse).toBe("TiAlN은 내열성 코팅입니다.")
    expect(result.params.question).toBe("TiAlN은 내열성 코팅입니다.")
  })

  it("handles null text gracefully", () => {
    const result = buildTextFallback(null)
    expect(result.actionType).toBe("answer_question")
    expect(result.textResponse).toBeNull()
    expect(result.params.question).toBe("")
  })
})

// ── canonicalizeParams ───────────────────────────────────────

describe("canonicalizeParams", () => {
  it("passes through non-filter actions unchanged", () => {
    const input: ToolUseClassification = {
      actionType: "skip_field",
      toolName: "skip_field",
      params: { field: "coating" },
      textResponse: null,
      toolInvoked: true,
    }
    const result = canonicalizeParams(input)
    expect(result.params.field).toBe("coating")
  })

  it("canonicalizes apply_filter values", () => {
    const input: ToolUseClassification = {
      actionType: "apply_filter",
      toolName: "apply_filter",
      params: { field: "fluteCount", value: "4", op: "eq" },
      textResponse: null,
      toolInvoked: true,
    }
    const result = canonicalizeParams(input)
    // After canonicalization, value should be numeric 4
    expect(result.params.field).toBe("fluteCount")
    expect(result.params.value).toBe(4)
  })

  it("canonicalizes replace_filter 'to' value", () => {
    const input: ToolUseClassification = {
      actionType: "replace_filter",
      toolName: "replace_filter",
      params: { field: "fluteCount", from: "2", to: "4" },
      textResponse: null,
      toolInvoked: true,
    }
    const result = canonicalizeParams(input)
    expect(result.params.to).toBe(4)
  })

  it("does not mutate original classification", () => {
    const input: ToolUseClassification = {
      actionType: "apply_filter",
      toolName: "apply_filter",
      params: { field: "fluteCount", value: "4" },
      textResponse: null,
      toolInvoked: true,
    }
    const original = { ...input, params: { ...input.params } }
    canonicalizeParams(input)
    expect(input.params.value).toBe(original.params.value)
  })
})

// ── classifyWithToolUse (integration with mock) ──────────────

describe("classifyWithToolUse", () => {
  it("returns tool-based classification when tool_use is returned", async () => {
    const provider = makeMockProvider(
      { toolName: "apply_filter", input: { field: "coating", value: "TiAlN", op: "eq" } },
      null
    )
    const result = await classifyWithToolUse("TiAlN 코팅으로", null, provider)
    expect(result.actionType).toBe("apply_filter")
    expect(result.toolInvoked).toBe(true)
    expect(result.params.field).toBe("coating")
    expect(result.params.value).toBe("TiAlN")
  })

  it("returns text fallback when no tool is invoked", async () => {
    const provider = makeMockProvider(null, "TiAlN은 코팅 종류입니다.")
    const result = await classifyWithToolUse("TiAlN이 뭐야?", null, provider)
    expect(result.actionType).toBe("answer_question")
    expect(result.toolInvoked).toBe(false)
    expect(result.textResponse).toBe("TiAlN은 코팅 종류입니다.")
  })

  it("passes session state to system prompt", async () => {
    const provider = makeMockProvider(
      { toolName: "skip_field", input: { field: "coating" } },
      null
    )
    const state = makeSessionState({
      lastAskedField: "coating",
      candidateCount: 30,
    })
    await classifyWithToolUse("상관없어", state, provider)
    const call = (provider.completeWithTools as ReturnType<typeof vi.fn>).mock.calls[0]
    const systemPrompt = call[0] as string
    expect(systemPrompt).toContain("Last asked field: coating")
    expect(systemPrompt).toContain("Candidate count: 30")
  })

  it("passes all 7 tool definitions to provider", async () => {
    const provider = makeMockProvider(null, "ok")
    await classifyWithToolUse("test", null, provider)
    const call = (provider.completeWithTools as ReturnType<typeof vi.fn>).mock.calls[0]
    const tools = call[2] as Array<{ name: string }>
    expect(tools).toHaveLength(7)
  })

  it("uses haiku model tier", async () => {
    const provider = makeMockProvider(null, "ok")
    await classifyWithToolUse("test", null, provider)
    const call = (provider.completeWithTools as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(call[4]).toBe("haiku")
  })

  it("uses tool-use-router agent name", async () => {
    const provider = makeMockProvider(null, "ok")
    await classifyWithToolUse("test", null, provider)
    const call = (provider.completeWithTools as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(call[5]).toBe("tool-use-router")
  })

  it("returns text fallback on provider error", async () => {
    const provider = makeErrorProvider(new Error("API limit exceeded"))
    const result = await classifyWithToolUse("테스트", null, provider)
    expect(result.actionType).toBe("answer_question")
    expect(result.toolInvoked).toBe(false)
    expect(result.textResponse).toBeNull()
  })

  it("canonicalizes numeric values from tool_use", async () => {
    const provider = makeMockProvider(
      { toolName: "apply_filter", input: { field: "diameterMm", value: "10", op: "eq" } },
      null
    )
    const result = await classifyWithToolUse("직경 10mm", null, provider)
    expect(result.actionType).toBe("apply_filter")
    expect(result.params.field).toBe("diameterMm")
    // diameterMm value should be canonicalized to number
    expect(typeof result.params.value).toBe("number")
    expect(result.params.value).toBe(10)
  })

  it("handles remove_filter tool result", async () => {
    const provider = makeMockProvider(
      { toolName: "remove_filter", input: { field: "toolSubtype" } },
      null
    )
    const state = makeSessionState({
      appliedFilters: [
        { field: "toolSubtype", value: "Square", rawValue: "Square", op: "eq", appliedAt: 0 },
      ] as any,
    })
    const result = await classifyWithToolUse("Square 빼고", state, provider)
    expect(result.actionType).toBe("remove_filter")
    expect(result.params.field).toBe("toolSubtype")
  })

  it("handles show_recommendation tool result", async () => {
    const provider = makeMockProvider(
      { toolName: "show_recommendation", input: {} },
      null
    )
    const result = await classifyWithToolUse("추천해줘", null, provider)
    expect(result.actionType).toBe("show_recommendation")
    expect(result.toolInvoked).toBe(true)
  })
})
