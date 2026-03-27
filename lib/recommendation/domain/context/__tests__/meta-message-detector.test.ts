/**
 * Meta / Quote / Echo Detector + Reset Guard — Regression tests.
 *
 * Tests:
 * 1. Quoted assistant text containing reset phrases does NOT trigger reset
 * 2. Meta feedback like "이걸 기반으로 칩을 만들어줘야지" regenerates revision chips
 * 3. Revision action-space includes undo / revise / restart options
 * 4. Sanitized memory exposure does not become executable next turn
 * 5. "왜 처음부터야?" does not restart the flow
 */

import { describe, it, expect, beforeEach } from "vitest"
import { detectMetaMessage, shouldBlockReset } from "../meta-message-detector"
import { interpretContext, type ContextInterpreterInput } from "../context-interpreter"
import { createEmptyMemory } from "../../memory/conversation-memory"
import { planOptions, resetOptionCounter } from "../../options/option-planner"
import type { OptionPlannerContext } from "../../options/types"

beforeEach(() => {
  resetOptionCounter()
})

function makeForm(material?: string) {
  return {
    material: material ? { status: "known" as const, value: material } : { status: "unknown" as const },
    operationType: { status: "unknown" as const },
    diameterInfo: { status: "unknown" as const },
    toolTypeOrCurrentProduct: { status: "known" as const, value: "endmill" },
    flutePreference: { status: "unknown" as const },
    coatingPreference: { status: "unknown" as const },
    machiningIntent: { status: "unknown" as const },
    inquiryPurpose: { status: "known" as const, value: "new" },
  } as unknown as ContextInterpreterInput["form"]
}

function makeSession(overrides: Record<string, unknown> = {}) {
  return {
    sessionId: "test",
    candidateCount: 20,
    appliedFilters: [
      { field: "coating", op: "includes", value: "Bright Finish", rawValue: "Bright Finish", appliedAt: 1 },
      { field: "fluteCount", op: "eq", value: "1날", rawValue: 1, appliedAt: 2 },
    ],
    narrowingHistory: [],
    stageHistory: [],
    resolutionStatus: "resolved_exact",
    resolvedInput: { material: "aluminum", diameterMm: 4 },
    turnCount: 3,
    displayedCandidates: [
      { displayCode: "CE480", seriesName: "CE480", coating: "Bright Finish", fluteCount: 1, diameterMm: 4, score: 90, matchStatus: "exact" },
    ],
    displayedChips: ["절삭조건 알려줘", "대체 후보 보기", "처음부터 다시"],
    displayedOptions: [],
    lastAction: "show_recommendation",
    ...overrides,
  } as unknown as ContextInterpreterInput["sessionState"]
}

// ════════════════════════════════════════════════════════════════
// 1. Quoted reset text does NOT trigger reset
// ════════════════════════════════════════════════════════════════

describe("quoted reset text safety", () => {
  it("blocks reset when user pastes text containing '처음부터 다시' with meta commentary", () => {
    const result = detectMetaMessage(
      '이걸 기반으로 칩을 만들어줘야지: "처음부터 다시", "이전으로", "절삭조건 알려줘"',
      null,
      ["처음부터 다시", "절삭조건 알려줘"]
    )

    expect(result.blockCommandExecution).toBe(true)
    expect(result.kind).not.toBe("direct_command")
  })

  it("blocks reset when user quotes assistant output with reset phrase", () => {
    const result = detectMetaMessage(
      '위에 "처음부터 다시" 라는 옵션이 있는데 이게 뭐야?',
      null,
      ["처음부터 다시"]
    )

    expect(result.blockCommandExecution).toBe(true)
  })

  it("allows reset when user directly types the exact reset command", () => {
    const result = detectMetaMessage(
      "처음부터 다시",
      null,
      ["처음부터 다시"]
    )

    // Exact chip match → direct command
    expect(result.kind).toBe("direct_command")
    expect(result.blockCommandExecution).toBe(false)
  })

  it("context interpreter blocks restart when pasted text has reset phrase", () => {
    const interp = interpretContext({
      form: makeForm("aluminum"),
      sessionState: makeSession(),
      resolvedInput: { material: "aluminum" } as any,
      userMessage: '아까 나온 "처음부터 다시" 이거 말고 다른 선택지 줘',
      memory: createEmptyMemory(),
    })

    expect(interp.intentShift).not.toBe("restart")
    expect(interp.shouldBlockResetInterpretation).toBe(true)
    expect(interp.preserveContext).toBe(true)
  })
})

// ════════════════════════════════════════════════════════════════
// 2. Meta feedback regenerates revision chips
// ════════════════════════════════════════════════════════════════

describe("meta feedback regenerates chips", () => {
  it("'이걸 기반으로 칩을 만들어줘야지' triggers chip regeneration", () => {
    const result = detectMetaMessage(
      "이걸 기반으로 칩을 만들어줘야지",
      null,
      null
    )

    expect(result.kind).toBe("meta_feedback")
    expect(result.shouldRegenerateOptions).toBe(true)
    expect(result.blockCommandExecution).toBe(true)
    expect(result.underlyingIntent).toBe("regenerate_chips")
  })

  it("context interpreter sets regenerate_options for meta feedback", () => {
    const interp = interpretContext({
      form: makeForm("aluminum"),
      sessionState: makeSession(),
      resolvedInput: { material: "aluminum" } as any,
      userMessage: "이걸 기반으로 칩을 만들어줘야지",
      memory: createEmptyMemory(),
    })

    expect(interp.shouldRegenerateOptions).toBe(true)
    expect(interp.suggestedNextAction).toBe("regenerate_options")
    expect(interp.messageKind).toBe("meta_feedback")
  })

  it("'입력조건을 고칠 수 없네' triggers revision options", () => {
    const result = detectMetaMessage(
      "입력조건을 고칠 수 없네",
      null,
      null
    )

    expect(result.kind).toBe("meta_feedback")
    expect(result.underlyingIntent).toBe("revise_input")
  })
})

// ════════════════════════════════════════════════════════════════
// 3. Revision action-space includes undo/revise/restart
// ════════════════════════════════════════════════════════════════

describe("revision action-space", () => {
  it("generates revision options with undo and per-field revision", () => {
    const interp = interpretContext({
      form: makeForm("aluminum"),
      sessionState: makeSession(),
      resolvedInput: { material: "aluminum" } as any,
      userMessage: "입력조건을 고칠 수 없네",
      memory: createEmptyMemory(),
    })

    const ctx: OptionPlannerContext = {
      mode: "recommended",
      candidateCount: 5,
      appliedFilters: [
        { field: "coating", op: "includes", value: "Bright Finish", rawValue: "Bright Finish" },
        { field: "fluteCount", op: "eq", value: "1날", rawValue: 1 },
      ],
      resolvedInput: { material: "aluminum" },
      topCandidates: [
        { displayCode: "CE480", seriesName: "CE480", coating: "Bright Finish", fluteCount: 1, diameterMm: 4, score: 90, matchStatus: "exact" },
      ],
      contextInterpretation: interp,
    }

    const options = planOptions(ctx)

    // Should have undo option
    const undoOptions = options.filter(o => o.label.includes("되돌리기"))
    expect(undoOptions.length).toBeGreaterThanOrEqual(1)

    // Should have per-field revision options
    const fieldRevisions = options.filter(o => o.label.includes("다시 고르기"))
    expect(fieldRevisions.length).toBeGreaterThanOrEqual(1)

    // Should have reset as last option
    const resetOptions = options.filter(o => o.family === "reset")
    expect(resetOptions.length).toBe(1)

    // Undo should NOT be the reset option
    expect(undoOptions[0].family).not.toBe("reset")
    expect(undoOptions[0].destructive).toBe(false)
  })
})

// ════════════════════════════════════════════════════════════════
// 4. Memory exposure does not become executable
// ════════════════════════════════════════════════════════════════

describe("memory exposure safety", () => {
  it("detects memory inspection request", () => {
    const result = detectMetaMessage(
      "지금 너의 메모리 보여줄래?",
      null,
      null
    )

    expect(result.kind).toBe("memory_inspection_request")
    expect(result.blockCommandExecution).toBe(true)
    expect(result.underlyingIntent).toBe("show_memory")
  })

  it("next turn quoting memory summary is blocked from execution", () => {
    const memorySummary = '현재 메모리: material=aluminum, coating=Bright Finish, 처음부터 다시 옵션 있음'

    const result = detectMetaMessage(
      "이 메모리를 기반으로 칩을 만들어줘: " + memorySummary,
      memorySummary,
      null
    )

    expect(result.blockCommandExecution).toBe(true)
    expect(result.kind).not.toBe("direct_command")
  })
})

// ════════════════════════════════════════════════════════════════
// 5. "왜 처음부터야?" does NOT restart
// ════════════════════════════════════════════════════════════════

describe("frustration does not restart", () => {
  it("'왜 처음부터야?' is clarification, not reset", () => {
    const result = detectMetaMessage(
      "왜 처음부터야?",
      null,
      null
    )

    expect(result.kind).toBe("clarification_request")
    expect(result.blockCommandExecution).toBe(true)
  })

  it("'왜 처음부터야 ㅠㅠㅠㅠ' is clarification, not reset", () => {
    const interp = interpretContext({
      form: makeForm("aluminum"),
      sessionState: makeSession(),
      resolvedInput: { material: "aluminum" } as any,
      userMessage: "왜 처음부터야 ㅠㅠㅠㅠ",
      memory: createEmptyMemory(),
    })

    expect(interp.intentShift).not.toBe("restart")
    expect(interp.shouldBlockResetInterpretation).toBe(true)
    expect(interp.preserveContext).toBe(true)
  })

  it("shouldBlockReset catches emoticon-laden frustration", () => {
    const meta = detectMetaMessage("왜 처음부터야 ㅠㅠ", null, null)
    expect(shouldBlockReset("왜 처음부터야 ㅠㅠ", meta)).toBe(true)
  })
})
