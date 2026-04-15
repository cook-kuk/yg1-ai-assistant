/**
 * Refinement & Reset Intent — Targeted Regression Tests
 *
 * Covers:
 * 1. Refinement utterances → REFINE_CONDITION (not general chat)
 * 2. Explicit reset → RESET_SESSION
 * 3. Quoted/meta reset text → NOT reset
 * 4. isExplicitResetIntent helper
 */

import { describe, it, expect } from "vitest"
import { classifyIntent, isExplicitResetIntent } from "../intent-classifier"
import type { ExplorationSessionState, DisplayedOption } from "@/lib/recommendation/domain/types"

// Since b5abe98 + REFINEMENT_PATTERNS 제거, REFINE_CONDITION classification 은
// LLM 담당이다. mockProvider 는 LLM 역할을 simulate — 실제 LLM prompt 규칙대로
// field 추출을 반환.
const mockProvider = {
  available: () => true,
  complete: async (_sys: string, messages: Array<{ role: string; content: string }>) => {
    const text = (messages[messages.length - 1]?.content ?? "").toLowerCase()
    const hasChangeVerb = /바꿔|바꾸|변경|대체|다시|다른/.test(text)
    const hasExplainCue = /\?|뭐야|궁금|설명|장점|단점/.test(text)
    let field: string | null = null
    if (/피삭재|소재|재질|스테인리스|알루미늄|탄소강|티타늄/.test(text)) field = "material"
    else if (/직경|mm|밀리/.test(text)) field = "diameter"
    else if (/코팅|alcrn|altin|tialn|dlc|무코팅/i.test(text)) field = "coating"
    else if (/날|flute|플루트/.test(text)) field = "fluteCount"
    else if (/형상|subtype|square|ball|radius/.test(text)) field = "toolSubtype"
    // bare material/coating + 질문 cue → ASK_EXPLANATION (per prompt rule)
    if (field && hasExplainCue && !hasChangeVerb) {
      return JSON.stringify({ intent: "ASK_EXPLANATION", confidence: 0.85, extractedValue: field })
    }
    if (field || hasChangeVerb) {
      return JSON.stringify({ intent: "REFINE_CONDITION", confidence: 0.9, extractedValue: field })
    }
    return JSON.stringify({ intent: "START_NEW_TOPIC", confidence: 0.5 })
  },
  completeWithTools: async () => { throw new Error("tools not used in intent classifier") },
} as any

const resolvedSession: ExplorationSessionState = {
  sessionId: "test-resolved",
  candidateCount: 5,
  appliedFilters: [
    { field: "material", op: "includes", value: "알루미늄", rawValue: "알루미늄", appliedAt: 0 },
    { field: "coating", op: "includes", value: "Bright Finish", rawValue: "Bright Finish", appliedAt: 1 },
  ],
  narrowingHistory: [],
  stageHistory: [],
  resolutionStatus: "resolved_exact",
  resolvedInput: { manufacturerScope: "yg1-only", locale: "ko" } as any,
  turnCount: 4,
  displayedCandidates: [],
  displayedChips: ["절삭조건 알려줘", "코팅 비교", "다른 직경 검색", "처음부터 다시"],
  displayedOptions: [] as DisplayedOption[],
}

describe("isExplicitResetIntent", () => {
  it('"처음부터 다시" → true', () => {
    expect(isExplicitResetIntent("처음부터 다시")).toBe(true)
  })
  it('"리셋" → true', () => {
    expect(isExplicitResetIntent("리셋")).toBe(true)
  })
  it('"다시 시작" → true', () => {
    expect(isExplicitResetIntent("다시 시작")).toBe(true)
  })
  it('"처음부터 다시 시작 이게 보기로 나와야하는거 아니야?" → false', () => {
    expect(isExplicitResetIntent("처음부터 다시 시작 이게 보기로 나와야하는거 아니야?")).toBe(false)
  })
  it('"현재 필터 유지하고 추천 보기 ... 처음부터 다시 시작" (quoted) → false', () => {
    expect(isExplicitResetIntent("현재 필터 유지하고 추천 보기 ... 처음부터 다시 시작")).toBe(false)
  })
  it('"나는 처음부터 다시 하라는 게 아니라 옵션이 보기로 나와야 한다는 뜻이야" → false', () => {
    expect(isExplicitResetIntent("나는 처음부터 다시 하라는 게 아니라 옵션이 보기로 나와야 한다는 뜻이야")).toBe(false)
  })
})

describe("Refinement intent (post-recommendation)", () => {
  it('"피삭재 조건을 바꿔서 검색하고 싶어" → REFINE_CONDITION', async () => {
    const r = await classifyIntent("피삭재 조건을 바꿔서 검색하고 싶어", resolvedSession, mockProvider)
    expect(r.intent).toBe("REFINE_CONDITION")
    expect(r.extractedValue).toBe("material")
  })

  it('"소재 바꾸고 싶어" → REFINE_CONDITION', async () => {
    const r = await classifyIntent("소재 바꾸고 싶어", resolvedSession, mockProvider)
    expect(r.intent).toBe("REFINE_CONDITION")
    expect(r.extractedValue).toBe("material")
  })

  it('"다른 직경으로 검색" → REFINE_CONDITION', async () => {
    const r = await classifyIntent("다른 직경으로 검색", resolvedSession, mockProvider)
    expect(r.intent).toBe("REFINE_CONDITION")
    expect(r.extractedValue).toBe("diameter")
  })

  it('"코팅 변경하고 싶어" → REFINE_CONDITION', async () => {
    const r = await classifyIntent("코팅 변경하고 싶어", resolvedSession, mockProvider)
    expect(r.intent).toBe("REFINE_CONDITION")
    expect(r.extractedValue).toBe("coating")
  })

  it('"스테인리스가 궁금해" → ASK_EXPLANATION (bare material + 궁금, no change verb)', async () => {
    // Post-b5abe98 + REFINEMENT_PATTERNS 제거: bare material + 질문 cue 는
    // REFINE_CONDITION 이 아니라 ASK_EXPLANATION 으로 가야 의미가 맞다.
    const r = await classifyIntent("스테인리스가 궁금해", resolvedSession, mockProvider)
    expect(r.intent).toBe("ASK_EXPLANATION")
    expect(r.extractedValue).toBe("material")
  })

  it('"스테인리스로 다시 볼래" → REFINE_CONDITION', async () => {
    const r = await classifyIntent("스테인리스로 다시 볼래", resolvedSession, mockProvider)
    expect(r.intent).toBe("REFINE_CONDITION")
    expect(r.extractedValue).toBe("material")
  })

  it('"재질 바꿔서 다시 보고 싶어" → REFINE_CONDITION', async () => {
    const r = await classifyIntent("재질 바꿔서 다시 보고 싶어", resolvedSession, mockProvider)
    expect(r.intent).toBe("REFINE_CONDITION")
    expect(r.extractedValue).toBe("material")
  })

  it('"다시 추천 받고 싶어" → REFINE_CONDITION', async () => {
    const r = await classifyIntent("다시 추천 받고 싶어", resolvedSession, mockProvider)
    expect(r.intent).toBe("REFINE_CONDITION")
  })
})

describe("Explicit reset still works", () => {
  it('"처음부터 다시" → RESET_SESSION', async () => {
    const r = await classifyIntent("처음부터 다시", null, mockProvider)
    expect(r.intent).toBe("RESET_SESSION")
  })

  it('"리셋" → RESET_SESSION', async () => {
    const r = await classifyIntent("리셋", null, mockProvider)
    expect(r.intent).toBe("RESET_SESSION")
  })

  it('"다시 시작" → RESET_SESSION', async () => {
    const r = await classifyIntent("다시 시작", null, mockProvider)
    expect(r.intent).toBe("RESET_SESSION")
  })

  it('"초기화" → RESET_SESSION', async () => {
    const r = await classifyIntent("초기화", null, mockProvider)
    expect(r.intent).toBe("RESET_SESSION")
  })

  it('"reset" → RESET_SESSION', async () => {
    const r = await classifyIntent("reset", null, mockProvider)
    expect(r.intent).toBe("RESET_SESSION")
  })
})

describe("Meta/quoted reset text does NOT reset", () => {
  it('"처음부터 다시 시작 이게 보기로 나와야하는거 아니야?" → NOT RESET_SESSION', async () => {
    const r = await classifyIntent("처음부터 다시 시작 이게 보기로 나와야하는거 아니야?", resolvedSession, mockProvider)
    expect(r.intent).not.toBe("RESET_SESSION")
  })
})
