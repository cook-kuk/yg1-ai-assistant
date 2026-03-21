/**
 * Context Interpreter + Memory Manager — Targeted tests.
 *
 * Tests:
 * 1. Context interpreter correctly infers refine/branch/replace from follow-up messages
 * 2. Memory manager keeps, replaces, or drops memory items correctly
 * 3. Option generation uses interpreted context, not only direct field heuristics
 * 4. Structured options remain synchronized with chips
 * 5. Reset is not triggered when the user is merely exploring or quoting prior options
 */

import { describe, it, expect, beforeEach } from "vitest"
import { interpretContext, type ContextInterpreterInput } from "../context-interpreter"
import type { ContextInterpretation } from "../context-types"
import { createEmptyMemory, buildMemoryFromSession, type ConversationMemory } from "../../memory/conversation-memory"
import { updateMemory, getActiveMemoryItems } from "../../memory/memory-manager"
import { planOptions, resetOptionCounter } from "../../options/option-planner"
import { smartOptionsToChips, smartOptionsToDisplayedOptions } from "../../options/option-bridge"
import type { OptionPlannerContext } from "../../options/types"

beforeEach(() => {
  resetOptionCounter()
})

// ── Helper: build minimal form ───────────────────────────────
function makeForm(material?: string, operationType?: string, diameter?: number) {
  return {
    material: material ? { status: "known" as const, value: material } : { status: "unknown" as const },
    operationType: operationType ? { status: "known" as const, value: operationType } : { status: "unknown" as const },
    diameterInfo: diameter != null ? { status: "known" as const, value: diameter } : { status: "unknown" as const },
    toolTypeOrCurrentProduct: { status: "known" as const, value: "endmill" },
    flutePreference: { status: "unknown" as const },
    coatingPreference: { status: "unknown" as const },
    machiningIntent: { status: "unknown" as const },
    inquiryPurpose: { status: "known" as const, value: "new" },
  } as unknown as ContextInterpreterInput["form"]
}

function makeSessionState(overrides: Record<string, unknown> = {}) {
  return {
    sessionId: "test-session",
    candidateCount: 20,
    appliedFilters: [],
    narrowingHistory: [],
    stageHistory: [],
    resolutionStatus: "narrowing",
    resolvedInput: { material: "aluminum", diameterMm: 4 },
    turnCount: 2,
    displayedCandidates: [],
    displayedChips: [],
    displayedOptions: [],
    lastAction: "continue_narrowing",
    ...overrides,
  } as unknown as ContextInterpreterInput["sessionState"]
}

// ════════════════════════════════════════════════════════════════
// 1. Context interpreter: refine/branch/replace
// ════════════════════════════════════════════════════════════════

describe("context interpreter — intent shift detection", () => {
  it("detects branch exploration from '스테인리스는 어때?'", () => {
    const result = interpretContext({
      form: makeForm("aluminum", "side_cutting", 4),
      sessionState: makeSessionState({ resolutionStatus: "resolved_exact" }),
      resolvedInput: { material: "aluminum" } as any,
      userMessage: "스테인리스는 어때?",
      memory: createEmptyMemory(),
    })

    expect(result.intentShift).toBe("branch_exploration")
    expect(result.hasConflict).toBe(true)
    expect(result.shouldGenerateRepairOptions).toBe(true)
    expect(result.preserveContext).toBe(true)
  })

  it("detects replace constraint from '코팅 바꿔'", () => {
    const result = interpretContext({
      form: makeForm("aluminum"),
      sessionState: makeSessionState({
        resolutionStatus: "resolved_exact",
        appliedFilters: [{ field: "coating", op: "includes", value: "DLC", rawValue: "DLC", appliedAt: 1 }],
      }),
      resolvedInput: { material: "aluminum" } as any,
      userMessage: "코팅 바꿔",
      memory: createEmptyMemory(),
    })

    expect(result.intentShift).toBe("replace_constraint")
    expect(result.referencedField).toBe("coating")
  })

  it("detects refine existing from '나머지 조건 유지하고 코팅만 바꾸고 싶어'", () => {
    const result = interpretContext({
      form: makeForm("aluminum"),
      sessionState: makeSessionState({ resolutionStatus: "resolved_exact" }),
      resolvedInput: { material: "aluminum" } as any,
      userMessage: "나머지 조건 유지하고 코팅만 바꾸고 싶어",
      memory: createEmptyMemory(),
    })

    expect(result.intentShift).toBe("refine_existing")
    expect(result.preserveContext).toBe(true)
    expect(result.referencedField).toBe("coating")
  })

  it("detects explain from '왜 이 제품이야?'", () => {
    const result = interpretContext({
      form: makeForm("aluminum"),
      sessionState: makeSessionState({ resolutionStatus: "resolved_exact" }),
      resolvedInput: { material: "aluminum" } as any,
      userMessage: "왜 이 제품이야?",
      memory: createEmptyMemory(),
    })

    expect(result.intentShift).toBe("explain_recommendation")
    expect(result.suggestedNextAction).toBe("explain")
  })

  it("detects compare from '1번이랑 2번 비교해줘'", () => {
    const result = interpretContext({
      form: makeForm("aluminum"),
      sessionState: makeSessionState({ resolutionStatus: "resolved_exact" }),
      resolvedInput: { material: "aluminum" } as any,
      userMessage: "1번이랑 2번 비교해줘",
      memory: createEmptyMemory(),
    })

    expect(result.intentShift).toBe("compare_products")
    expect(result.suggestedNextAction).toBe("compare")
  })
})

// ════════════════════════════════════════════════════════════════
// 2. Memory manager: keep/replace/drop
// ════════════════════════════════════════════════════════════════

describe("memory manager", () => {
  it("keeps intake facts during constraint replacement", () => {
    const memory = createEmptyMemory()
    memory.items = [
      { key: "intake_material", field: "material", value: "aluminum", source: "intake", status: "resolved", priority: 8, turnCreated: 0, turnUpdated: 0 },
      { key: "intake_diameter", field: "diameterMm", value: "4", source: "intake", status: "resolved", priority: 8, turnCreated: 0, turnUpdated: 0 },
      { key: "filter_coating", field: "coating", value: "DLC", source: "narrowing", status: "tentative", priority: 5, turnCreated: 1, turnUpdated: 1 },
    ]

    const interpretation: ContextInterpretation = {
      mode: "repair",
      intentShift: "replace_constraint",
      activeConstraints: [],
      resolvedFacts: [],
      temporaryFilters: [],
      referencedProducts: [],
      referencedField: "material",
      preserveContext: true,
      hasConflict: true,
      detectedConflicts: [{
        newField: "material",
        newValue: "스테인리스",
        conflictingConstraints: [{ field: "material", value: "aluminum" }],
        severity: "hard",
      }],
      shouldAskFollowup: false,
      shouldGenerateRepairOptions: true,
      suggestedNextAction: "repair",
      answeredFields: ["material", "diameterMm", "coating"],
      conversationDepth: 3,
    }

    const { memory: updated, decisions } = updateMemory(memory, interpretation, 3)

    // Material should be replaced
    const materialDecision = decisions.find(d => d.key === "intake_material")
    expect(materialDecision?.action).toBe("replace")

    // Diameter should be kept (not conflicted)
    const diameterDecision = decisions.find(d => d.key === "intake_diameter")
    expect(diameterDecision?.action).toBe("keep")

    // Coating is tentative and not directly conflicted → kept
    const coatingDecision = decisions.find(d => d.key === "filter_coating")
    expect(coatingDecision?.action).toBe("keep")
  })

  it("drops non-intake items on restart but keeps intake facts", () => {
    const memory = createEmptyMemory()
    memory.items = [
      { key: "intake_material", field: "material", value: "aluminum", source: "intake", status: "resolved", priority: 8, turnCreated: 0, turnUpdated: 0 },
      { key: "filter_coating", field: "coating", value: "DLC", source: "narrowing", status: "tentative", priority: 5, turnCreated: 1, turnUpdated: 1 },
      { key: "filter_flute", field: "fluteCount", value: "4", source: "narrowing", status: "tentative", priority: 5, turnCreated: 2, turnUpdated: 2 },
    ]

    const interpretation: ContextInterpretation = {
      mode: "reset",
      intentShift: "restart",
      activeConstraints: [],
      resolvedFacts: [],
      temporaryFilters: [],
      referencedProducts: [],
      referencedField: null,
      preserveContext: false,
      hasConflict: false,
      detectedConflicts: [],
      shouldAskFollowup: false,
      shouldGenerateRepairOptions: false,
      suggestedNextAction: "reset",
      answeredFields: [],
      conversationDepth: 0,
    }

    const { decisions } = updateMemory(memory, interpretation, 3)

    const intakeDecision = decisions.find(d => d.key === "intake_material")
    const coatingDecision = decisions.find(d => d.key === "filter_coating")
    const fluteDecision = decisions.find(d => d.key === "filter_flute")

    expect(intakeDecision?.action).toBe("keep")
    expect(coatingDecision?.action).toBe("drop")
    expect(fluteDecision?.action).toBe("drop")
  })

  it("getActiveMemoryItems filters out stale/replaced", () => {
    const memory = createEmptyMemory()
    memory.items = [
      { key: "a", field: "material", value: "aluminum", source: "intake", status: "resolved", priority: 8, turnCreated: 0, turnUpdated: 0 },
      { key: "b", field: "coating", value: "DLC", source: "narrowing", status: "stale", priority: 5, turnCreated: 1, turnUpdated: 1 },
      { key: "c", field: "fluteCount", value: "4", source: "narrowing", status: "replaced", priority: 5, turnCreated: 2, turnUpdated: 2 },
      { key: "d", field: "fluteCount", value: "2", source: "narrowing", status: "tentative", priority: 5, turnCreated: 3, turnUpdated: 3 },
    ]

    const active = getActiveMemoryItems(memory)
    expect(active.length).toBe(2)
    expect(active.map(i => i.key)).toEqual(["a", "d"])
  })
})

// ════════════════════════════════════════════════════════════════
// 3. Option generation uses context, not just field heuristics
// ════════════════════════════════════════════════════════════════

describe("context-aware option generation", () => {
  it("generates repair options when context detects conflict", () => {
    const interpretation: ContextInterpretation = {
      mode: "repair",
      intentShift: "branch_exploration",
      activeConstraints: [
        { field: "material", value: "aluminum", source: "intake", durable: true },
        { field: "coating", value: "DLC", source: "narrowing", durable: false },
      ],
      resolvedFacts: [{ field: "material", value: "aluminum" }],
      temporaryFilters: [{ field: "coating", value: "DLC" }],
      referencedProducts: [],
      referencedField: "material",
      preserveContext: true,
      hasConflict: true,
      detectedConflicts: [{
        newField: "material",
        newValue: "스테인리스",
        conflictingConstraints: [{ field: "material", value: "aluminum" }],
        severity: "hard",
      }],
      shouldAskFollowup: false,
      shouldGenerateRepairOptions: true,
      suggestedNextAction: "repair",
      answeredFields: ["material", "coating"],
      conversationDepth: 3,
    }

    const ctx: OptionPlannerContext = {
      mode: "repair",
      candidateCount: 15,
      appliedFilters: [
        { field: "coating", op: "includes", value: "DLC", rawValue: "DLC" },
      ],
      resolvedInput: { material: "aluminum" },
      conflictField: "material",
      conflictValue: "스테인리스",
      contextInterpretation: interpretation,
    }

    const options = planOptions(ctx)

    // Should have repair options
    const repairOptions = options.filter(o => o.family === "repair")
    expect(repairOptions.length).toBeGreaterThanOrEqual(1)

    // Should have an explore/branch option
    const branchOptions = options.filter(o => o.family === "explore")
    expect(branchOptions.length).toBeGreaterThanOrEqual(1)

    // Branch option should mention branch_session
    const branchPlan = branchOptions.find(o => o.plan.type === "branch_session")
    expect(branchPlan).toBeTruthy()
  })

  it("generates explain options when context detects explain intent", () => {
    const interpretation: ContextInterpretation = {
      mode: "recommended",
      intentShift: "explain_recommendation",
      activeConstraints: [],
      resolvedFacts: [],
      temporaryFilters: [],
      referencedProducts: [],
      referencedField: null,
      preserveContext: true,
      hasConflict: false,
      detectedConflicts: [],
      shouldAskFollowup: false,
      shouldGenerateRepairOptions: false,
      suggestedNextAction: "explain",
      answeredFields: [],
      conversationDepth: 2,
    }

    const ctx: OptionPlannerContext = {
      mode: "recommended",
      candidateCount: 5,
      appliedFilters: [],
      resolvedInput: {},
      topCandidates: [
        { displayCode: "CE480", seriesName: "CE480", coating: "DLC", fluteCount: 3, diameterMm: 10, score: 85, matchStatus: "exact" },
        { displayCode: "CE481", seriesName: "CE481", coating: "AlTiN", fluteCount: 4, diameterMm: 10, score: 78, matchStatus: "exact" },
      ],
      contextInterpretation: interpretation,
    }

    const options = planOptions(ctx)

    // Should have explain option
    const explainOptions = options.filter(o =>
      o.plan.type === "explain_recommendation" || o.label.includes("왜")
    )
    expect(explainOptions.length).toBeGreaterThanOrEqual(1)

    // Should NOT predominantly have narrowing options
    const narrowingOptions = options.filter(o => o.family === "narrowing")
    expect(narrowingOptions.length).toBe(0)
  })

  it("filters out already-answered fields in narrowing", () => {
    const interpretation: ContextInterpretation = {
      mode: "narrowing",
      intentShift: "none",
      activeConstraints: [],
      resolvedFacts: [],
      temporaryFilters: [],
      referencedProducts: [],
      referencedField: null,
      preserveContext: true,
      hasConflict: false,
      detectedConflicts: [],
      shouldAskFollowup: true,
      shouldGenerateRepairOptions: false,
      suggestedNextAction: "narrow",
      answeredFields: ["coating", "fluteCount"],
      conversationDepth: 2,
    }

    const ctx: OptionPlannerContext = {
      mode: "narrowing",
      candidateCount: 30,
      appliedFilters: [
        { field: "coating", op: "includes", value: "DLC", rawValue: "DLC" },
        { field: "fluteCount", op: "eq", value: "4날", rawValue: 4 },
      ],
      resolvedInput: {},
      lastAskedField: "seriesName",
      candidateFieldValues: new Map([
        ["coating", new Map([["DLC", 10], ["AlTiN", 15]])],
        ["fluteCount", new Map([["2", 15], ["4", 10]])],
        ["seriesName", new Map([["CE480", 12], ["GNX", 13]])],
      ]),
      contextInterpretation: interpretation,
    }

    const options = planOptions(ctx)

    // Should NOT have coating or fluteCount options (already answered)
    const coatingOptions = options.filter(o => o.field === "coating")
    const fluteOptions = options.filter(o => o.field === "fluteCount")
    expect(coatingOptions.length).toBe(0)
    expect(fluteOptions.length).toBe(0)

    // Should still have seriesName options (the currently asked field)
    const seriesOptions = options.filter(o => o.field === "seriesName")
    expect(seriesOptions.length).toBeGreaterThan(0)
  })
})

// ════════════════════════════════════════════════════════════════
// 4. Chips and structured options stay synchronized
// ════════════════════════════════════════════════════════════════

describe("chips and options synchronization", () => {
  it("context-aware options produce synchronized chips and displayedOptions", () => {
    const interpretation: ContextInterpretation = {
      mode: "recommended",
      intentShift: "compare_products",
      activeConstraints: [],
      resolvedFacts: [],
      temporaryFilters: [],
      referencedProducts: [],
      referencedField: null,
      preserveContext: true,
      hasConflict: false,
      detectedConflicts: [],
      shouldAskFollowup: false,
      shouldGenerateRepairOptions: false,
      suggestedNextAction: "compare",
      answeredFields: [],
      conversationDepth: 2,
    }

    const ctx: OptionPlannerContext = {
      mode: "recommended",
      candidateCount: 5,
      appliedFilters: [],
      resolvedInput: {},
      topCandidates: [
        { displayCode: "CE480", seriesName: "CE480", coating: "DLC", fluteCount: 3, diameterMm: 10, score: 85, matchStatus: "exact" },
        { displayCode: "CE481", seriesName: "CE481", coating: "AlTiN", fluteCount: 4, diameterMm: 10, score: 78, matchStatus: "exact" },
      ],
      contextInterpretation: interpretation,
    }

    const options = planOptions(ctx)
    const chips = smartOptionsToChips(options)
    const displayed = smartOptionsToDisplayedOptions(options)

    // Every displayed option label should appear in chips
    for (const opt of displayed) {
      expect(chips).toContain(opt.label)
    }

    // Sequential indices
    for (let i = 0; i < displayed.length; i++) {
      expect(displayed[i].index).toBe(i + 1)
    }
  })
})

// ════════════════════════════════════════════════════════════════
// 5. Reset not triggered by exploration or quoting
// ════════════════════════════════════════════════════════════════

describe("reset safety with context", () => {
  it("does not interpret exploration as restart", () => {
    const result = interpretContext({
      form: makeForm("aluminum"),
      sessionState: makeSessionState({ resolutionStatus: "resolved_exact" }),
      resolvedInput: { material: "aluminum" } as any,
      userMessage: "스테인리스는 어때?",
      memory: createEmptyMemory(),
    })

    expect(result.intentShift).not.toBe("restart")
    expect(result.suggestedNextAction).not.toBe("reset")
  })

  it("does not interpret meta-question about reset as restart", () => {
    const result = interpretContext({
      form: makeForm("aluminum"),
      sessionState: makeSessionState(),
      resolvedInput: { material: "aluminum" } as any,
      userMessage: "처음부터 다시 해야 하나?",
      memory: createEmptyMemory(),
    })

    // Question mark + "해야" → meta-question, not reset
    expect(result.intentShift).not.toBe("restart")
  })

  it("does not interpret quoting an option as restart", () => {
    const result = interpretContext({
      form: makeForm("aluminum"),
      sessionState: makeSessionState({
        displayedChips: ["처음부터 다시", "다른 코팅 보기"],
      }),
      resolvedInput: { material: "aluminum" } as any,
      userMessage: "처음부터 다시 라는 옵션이 있는데 이게 뭐야?",
      memory: createEmptyMemory(),
    })

    // Long message with question → not a reset command
    expect(result.intentShift).not.toBe("restart")
  })
})
