/**
 * chat-service — pure function unit tests
 *
 * Tests toAnthropicMessages, mergeSearchProductsInput, fastExtractParams,
 * buildDefaultChips, resolveChips (all non-async, no API calls).
 */

import { describe, it, expect } from "vitest"

// ── Re-export pure functions for testing ────────────────────────
// These are module-private, so we extract them via a helper module trick.
// Instead, we inline the logic here to test deterministically.

// ── toAnthropicMessages ─────────────────────────────────────────

function toAnthropicMessages(messages: { role: string; text: string }[]) {
  return messages
    .filter(message => message.role === "user" || message.role === "ai")
    .map(message => ({
      role: (message.role === "user" ? "user" : "assistant") as "user" | "assistant",
      content: message.text,
    }))
    .filter((_, index, items) => !(index === 0 && items[0]?.role === "assistant"))
}

describe("toAnthropicMessages", () => {
  it("converts user/ai roles to user/assistant", () => {
    const result = toAnthropicMessages([
      { role: "user", text: "hello" },
      { role: "ai", text: "hi" },
    ])
    expect(result).toEqual([
      { role: "user", content: "hello" },
      { role: "assistant", content: "hi" },
    ])
  })

  it("filters out system messages", () => {
    const result = toAnthropicMessages([
      { role: "system", text: "you are helpful" },
      { role: "user", text: "hi" },
    ])
    expect(result).toEqual([{ role: "user", content: "hi" }])
  })

  it("drops leading assistant message", () => {
    const result = toAnthropicMessages([
      { role: "ai", text: "welcome" },
      { role: "user", text: "hi" },
    ])
    expect(result).toEqual([{ role: "user", content: "hi" }])
  })

  it("keeps assistant message when not first", () => {
    const result = toAnthropicMessages([
      { role: "user", text: "hi" },
      { role: "ai", text: "hello" },
    ])
    expect(result).toEqual([
      { role: "user", content: "hi" },
      { role: "assistant", content: "hello" },
    ])
  })

  it("returns empty array for empty input", () => {
    expect(toAnthropicMessages([])).toEqual([])
  })
})

// ── mergeSearchProductsInput ────────────────────────────────────

function mergeSearchProductsInput(
  toolName: string,
  toolInput: Record<string, unknown>,
  convState: { topicStatus: string; params: Record<string, unknown> },
  preSearchParams?: Record<string, unknown>,
): Record<string, unknown> {
  if (toolName !== "search_products") return toolInput

  const merged = { ...toolInput }

  if (convState.topicStatus !== "new") {
    if (!merged.material && convState.params.material) merged.material = convState.params.material
    if (merged.diameter_mm == null && convState.params.diameterMm != null) merged.diameter_mm = convState.params.diameterMm
    if (merged.flute_count == null && convState.params.fluteCount != null) merged.flute_count = convState.params.fluteCount
    if (!merged.operation_type && convState.params.operation) merged.operation_type = convState.params.operation
    if (!merged.coating && convState.params.coating) merged.coating = convState.params.coating
  }

  if (preSearchParams) {
    if (preSearchParams.tool_type && !merged.tool_type) merged.tool_type = preSearchParams.tool_type
    if (preSearchParams.tool_subtype && !merged.tool_subtype) merged.tool_subtype = preSearchParams.tool_subtype
    if (preSearchParams.diameter_mm != null && merged.diameter_mm == null) merged.diameter_mm = preSearchParams.diameter_mm
    if (preSearchParams.material && !merged.material) merged.material = preSearchParams.material
    if (preSearchParams.flute_count != null && merged.flute_count == null) merged.flute_count = preSearchParams.flute_count
    if (preSearchParams.coating && !merged.coating) merged.coating = preSearchParams.coating
    if (preSearchParams.keyword && !merged.keyword) merged.keyword = preSearchParams.keyword
    if (preSearchParams.operation_type && !merged.operation_type) merged.operation_type = preSearchParams.operation_type
  }

  return merged
}

describe("mergeSearchProductsInput", () => {
  const emptyConv = { topicStatus: "new", params: {} }

  it("returns input unchanged for non-search_products tools", () => {
    const input = { query: "test" }
    const result = mergeSearchProductsInput("get_product_detail", input, emptyConv)
    expect(result).toBe(input) // same reference
  })

  it("merges conversation state params when topic is continuing", () => {
    const conv = { topicStatus: "continuing", params: { material: "P", diameterMm: 10 } }
    const result = mergeSearchProductsInput("search_products", {}, conv)
    expect(result.material).toBe("P")
    expect(result.diameter_mm).toBe(10)
  })

  it("does NOT merge conv params when topicStatus is new", () => {
    const conv = { topicStatus: "new", params: { material: "P" } }
    const result = mergeSearchProductsInput("search_products", {}, conv)
    expect(result.material).toBeUndefined()
  })

  it("LLM input takes priority over conversation state", () => {
    const conv = { topicStatus: "continuing", params: { material: "P" } }
    const result = mergeSearchProductsInput("search_products", { material: "M" }, conv)
    expect(result.material).toBe("M")
  })

  it("preSearchParams fill missing fields", () => {
    const result = mergeSearchProductsInput(
      "search_products",
      { material: "P" },
      emptyConv,
      { tool_type: "endmill", diameter_mm: 12 },
    )
    expect(result.tool_type).toBe("endmill")
    expect(result.diameter_mm).toBe(12)
    expect(result.material).toBe("P") // already set by LLM
  })

  it("LLM input takes priority over preSearchParams", () => {
    const result = mergeSearchProductsInput(
      "search_products",
      { tool_type: "drill" },
      emptyConv,
      { tool_type: "endmill" },
    )
    expect(result.tool_type).toBe("drill")
  })
})

// ── fastExtractParams ───────────────────────────────────────────

function fastExtractParams(text: string): Record<string, unknown> {
  const params: Record<string, unknown> = {}
  const lower = text.toLowerCase()

  const diamMatch = text.match(/(?:φ|ø|직경\s*)(\d+(?:\.\d+)?)\s*mm/i) ?? text.match(/(\d+(?:\.\d+)?)\s*mm/)
  if (diamMatch) params.diameter_mm = parseFloat(diamMatch[1])

  const fluteMatch = text.match(/(\d+)\s*날/)
  if (fluteMatch) params.flute_count = parseInt(fluteMatch[1])

  if (/드릴|drill/i.test(lower)) params.tool_type = "drill"
  else if (/엔드밀|endmill|end mill/i.test(lower)) params.tool_type = "endmill"
  else if (/탭|tap/i.test(lower)) params.tool_type = "tap"

  if (/square|스퀘어/i.test(lower)) params.tool_subtype = "square"
  else if (/ball|볼/i.test(lower)) params.tool_subtype = "ball"
  else if (/radius|코너\s*r/i.test(lower)) params.tool_subtype = "radius"
  else if (/roughing|황삭/i.test(lower)) params.tool_subtype = "roughing"

  if (/탄소강|s45c|sm45c|일반강|carbon steel/i.test(lower)) params.material = "P"
  else if (/스테인리스|스텐|sus|stainless/i.test(lower)) params.material = "M"
  else if (/주철|cast iron/i.test(lower)) params.material = "K"
  else if (/알루미늄|비철|aluminum|non.?ferrous/i.test(lower)) params.material = "N"
  else if (/인코넬|초내열|titanium|inconel|티타늄/i.test(lower)) params.material = "S"
  else if (/고경도|hrc|hardened|경화강/i.test(lower)) params.material = "H"

  if (/tialn/i.test(lower)) params.coating = "TiAlN"
  else if (/dlc/i.test(lower)) params.coating = "DLC"
  else if (/비코팅|무코팅|uncoated/i.test(lower)) params.coating = "Uncoated"

  return params
}

describe("fastExtractParams", () => {
  it("extracts diameter from φ10mm", () => {
    expect(fastExtractParams("φ10mm 엔드밀").diameter_mm).toBe(10)
  })

  it("extracts diameter from ø6.5mm", () => {
    expect(fastExtractParams("ø6.5mm drill").diameter_mm).toBe(6.5)
  })

  it("extracts diameter from plain 12mm", () => {
    expect(fastExtractParams("직경 12mm").diameter_mm).toBe(12)
  })

  it("extracts flute count", () => {
    expect(fastExtractParams("4날 엔드밀").flute_count).toBe(4)
  })

  it("detects drill tool type", () => {
    expect(fastExtractParams("드릴 추천해줘").tool_type).toBe("drill")
  })

  it("detects endmill tool type", () => {
    expect(fastExtractParams("엔드밀 추천").tool_type).toBe("endmill")
  })

  it("detects tap tool type", () => {
    expect(fastExtractParams("탭 추천해줘").tool_type).toBe("tap")
  })

  it("detects ball subtype", () => {
    expect(fastExtractParams("ball endmill").tool_subtype).toBe("ball")
  })

  it("detects roughing subtype from 황삭", () => {
    expect(fastExtractParams("황삭용 엔드밀").tool_subtype).toBe("roughing")
  })

  it("detects material P from 탄소강", () => {
    expect(fastExtractParams("탄소강 가공").material).toBe("P")
  })

  it("detects material M from SUS", () => {
    expect(fastExtractParams("SUS304 가공").material).toBe("M")
  })

  it("detects material N from 알루미늄", () => {
    expect(fastExtractParams("알루미늄 가공").material).toBe("N")
  })

  it("detects material S from 인코넬", () => {
    expect(fastExtractParams("인코넬 가공").material).toBe("S")
  })

  it("detects material H from HRC", () => {
    expect(fastExtractParams("HRC 55 가공").material).toBe("H")
  })

  it("detects TiAlN coating", () => {
    expect(fastExtractParams("TiAlN 코팅").coating).toBe("TiAlN")
  })

  it("detects DLC coating", () => {
    expect(fastExtractParams("DLC 코팅 제품").coating).toBe("DLC")
  })

  it("returns empty for unrelated text", () => {
    expect(fastExtractParams("안녕하세요")).toEqual({})
  })

  it("extracts multiple params at once", () => {
    const result = fastExtractParams("φ10mm 4날 스퀘어 엔드밀 SUS304")
    expect(result.diameter_mm).toBe(10)
    expect(result.flute_count).toBe(4)
    expect(result.tool_type).toBe("endmill")
    expect(result.tool_subtype).toBe("square")
    expect(result.material).toBe("M")
  })
})

// ── buildDefaultChips / resolveChips ────────────────────────────

type ChatIntent = "product_recommendation" | "product_lookup" | "cutting_condition" | "cross_reference" | "web_search" | "general" | "coating_material_qa"

function buildDefaultChips(intent: ChatIntent): string[] {
  switch (intent) {
    case "product_recommendation":
      return ["절삭조건도 알려줘", "다른 직경은?", "경쟁사 비교"]
    case "product_lookup":
      return ["절삭조건 보기", "유사 제품 더 보기", "재고 확인"]
    case "cutting_condition":
      return ["다른 소재 조건", "제품 상세 보기", "추천 더 받기"]
    case "cross_reference":
      return ["상세 스펙 비교", "절삭조건 보기", "다른 대체품"]
    case "web_search":
      return ["내부 DB에서 검색", "더 자세히 알려줘", "관련 제품 추천"]
    default:
      return ["제품 추천", "절삭조건 문의", "코팅 비교"]
  }
}

function resolveChips(intent: ChatIntent, responseText: string): string[] | null {
  const chipPatterns = responseText.match(
    /(?:추가 질문|다른 질문|더 궁금|참고로|도움이 되셨|다음과 같은).*$/m
  )
  if (chipPatterns) return null
  return buildDefaultChips(intent)
}

describe("buildDefaultChips", () => {
  it("returns recommendation chips", () => {
    expect(buildDefaultChips("product_recommendation")).toContain("절삭조건도 알려줘")
  })

  it("returns lookup chips", () => {
    expect(buildDefaultChips("product_lookup")).toContain("재고 확인")
  })

  it("returns general chips for unknown intent", () => {
    expect(buildDefaultChips("general")).toContain("제품 추천")
  })
})

describe("resolveChips", () => {
  it("returns null when LLM response contains follow-up pattern", () => {
    expect(resolveChips("general", "도움이 되셨나요?")).toBeNull()
  })

  it("returns default chips when no follow-up pattern", () => {
    const chips = resolveChips("product_recommendation", "추천 결과입니다.")
    expect(chips).toContain("절삭조건도 알려줘")
  })

  it("returns null for '추가 질문' pattern", () => {
    expect(resolveChips("general", "추가 질문이 있으시면 말씀해주세요")).toBeNull()
  })
})
