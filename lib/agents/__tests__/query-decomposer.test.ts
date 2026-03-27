/**
 * Query Decomposer — Unit Tests
 *
 * Tests planActions() execution planning logic:
 *   - Single intent → single step, no confirmation
 *   - Mixed state-changing + side-effect → correct primary/side split
 *   - Multiple state-changing → requiresConfirmation
 *   - Dependency ordering (restore before filtering)
 *   - Side effects don't create dependencies
 */

import { describe, it, expect } from "vitest"
import { planActions, orderChunksForExecution } from "../query-decomposer"
import type { DecompositionResult, IntentChunk } from "../query-decomposer"

// ── Helpers ──────────────────────────────────────────────────

function makeDecomp(chunks: IntentChunk[], requiresConfirmation = false): DecompositionResult {
  return {
    isMultiIntent: chunks.length > 1,
    chunks,
    requiresConfirmation,
    reasoning: "test",
  }
}

// ── Tests ────────────────────────────────────────────────────

describe("orderChunksForExecution", () => {
  it("orders restore before task_change before filtering before read-only", () => {
    const chunks: IntentChunk[] = [
      { text: "Diamond로 해줘", category: "filtering" },
      { text: "코팅이 뭐야?", category: "explanation" },
      { text: "이전으로 돌아가", category: "restore" },
    ]
    const ordered = orderChunksForExecution(chunks)
    expect(ordered.map(c => c.category)).toEqual(["restore", "filtering", "explanation"])
  })

  it("preserves order within same category", () => {
    const chunks: IntentChunk[] = [
      { text: "안녕", category: "side_conversation" },
      { text: "DLC가 뭐야?", category: "explanation" },
    ]
    const ordered = orderChunksForExecution(chunks)
    expect(ordered.map(c => c.category)).toEqual(["explanation", "side_conversation"])
  })
})

describe("planActions", () => {
  it("returns single step for single intent", () => {
    const decomp = makeDecomp([{ text: "Diamond", category: "filtering" }])
    const plan = planActions(decomp)

    expect(plan.steps).toHaveLength(1)
    expect(plan.primaryIndex).toBe(0)
    expect(plan.sideEffectIndices).toEqual([])
    expect(plan.requiresConfirmation).toBe(false)
  })

  it("separates explanation as side-effect from filtering primary", () => {
    const decomp = makeDecomp([
      { text: "코팅이 뭐야?", category: "explanation" },
      { text: "Diamond로 해줘", category: "filtering" },
    ])
    const plan = planActions(decomp)

    // filtering is state-changing → primary
    const primaryStep = plan.steps[plan.primaryIndex]
    expect(primaryStep.chunk.category).toBe("filtering")
    expect(primaryStep.isSideEffect).toBe(false)

    // explanation is side-effect
    expect(plan.sideEffectIndices.length).toBe(1)
    const sideStep = plan.steps[plan.sideEffectIndices[0]]
    expect(sideStep.chunk.category).toBe("explanation")
    expect(sideStep.isSideEffect).toBe(true)
  })

  it("requires confirmation for ≥2 state-changing categories", () => {
    const decomp = makeDecomp([
      { text: "이전으로 돌아가", category: "restore" },
      { text: "Square로 해줘", category: "filtering" },
    ], true)
    const plan = planActions(decomp)

    expect(plan.requiresConfirmation).toBe(true)
    // restore should come before filtering
    expect(plan.steps[0].chunk.category).toBe("restore")
    expect(plan.steps[1].chunk.category).toBe("filtering")
  })

  it("builds correct dependencies: filtering depends on prior restore", () => {
    const decomp = makeDecomp([
      { text: "이전으로", category: "restore" },
      { text: "Diamond으로", category: "filtering" },
    ], true)
    const plan = planActions(decomp)

    // restore is step 0 (no deps)
    expect(plan.steps[0].dependsOn).toEqual([])
    // filtering is step 1 (depends on step 0)
    expect(plan.steps[1].dependsOn).toEqual([0])
  })

  it("side-effects have no dependencies", () => {
    const decomp = makeDecomp([
      { text: "Square로", category: "filtering" },
      { text: "코팅 설명해줘", category: "explanation" },
    ])
    const plan = planActions(decomp)

    const sideStep = plan.steps.find(s => s.isSideEffect)!
    expect(sideStep.dependsOn).toEqual([])
  })

  it("generates plan text for multi-intent", () => {
    const decomp = makeDecomp([
      { text: "이전으로", category: "restore" },
      { text: "4날로", category: "filtering" },
    ], true)
    const plan = planActions(decomp)

    expect(plan.planText).toContain("여러 작업이 감지되었습니다")
    expect(plan.planText).toContain("상태 복원")
    expect(plan.planText).toContain("필터 적용")
  })
})
