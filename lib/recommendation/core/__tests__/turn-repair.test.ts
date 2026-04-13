import { describe, expect, test, vi } from "vitest"

import { isRepairOnlySignal, needsRepair, repairMessage } from "../turn-repair"

describe("needsRepair", () => {
  test("detects ambiguous follow-up repair cues", () => {
    expect(needsRepair("그거 말고")).toBe(true)
    expect(needsRepair("더 큰 거")).toBe(true)
    expect(needsRepair("아니 재질을 말한 거야")).toBe(true)
    expect(needsRepair("좀 더 작은 거")).toBe(true)
    expect(needsRepair("아까 그거")).toBe(true)
  })

  test("detects correction and frustration repair cues", () => {
    expect(needsRepair("진짜 너 말 안듣는다")).toBe(true)
    expect(needsRepair("내 말은 그게 아니고")).toBe(true)
    expect(needsRepair("그게 아니라")).toBe(true)
  })

  test("passes ordinary messages", () => {
    expect(needsRepair("스테인리스 4날")).toBe(false)
    expect(needsRepair("TiAlN 코팅으로")).toBe(false)
    expect(needsRepair("Y-Coating 보여줘")).toBe(false)
  })
})

describe("isRepairOnlySignal", () => {
  test("detects repair-only correction turns with no actionable constraint", () => {
    expect(isRepairOnlySignal("진짜 너 말 안듣는다")).toBe(true)
    expect(isRepairOnlySignal("그게 아니라")).toBe(true)
    expect(isRepairOnlySignal("아니 내 말은 그게 아니고")).toBe(true)
  })

  test("does not misclassify concrete correction requests", () => {
    expect(isRepairOnlySignal("그게 아니라 4날로 바꿔줘")).toBe(false)
    expect(isRepairOnlySignal("square 아니고 다른 거")).toBe(false)
  })
})

describe("repairMessage", () => {
  test("skips when there is no usable context", async () => {
    const provider = { complete: vi.fn() } as any
    const result = await repairMessage("그거 말고", [], [], provider)
    expect(result.wasRepaired).toBe(false)
    expect(provider.complete).not.toHaveBeenCalled()
  })

  test("skips when the message is not a repair turn", async () => {
    const provider = { complete: vi.fn() } as any
    const result = await repairMessage(
      "스테인리스 4날",
      [],
      [{ question: "?", answer: "x", extractedFilters: [], candidateCountBefore: 0, candidateCountAfter: 0 }] as any,
      provider,
    )
    expect(result.wasRepaired).toBe(false)
    expect(provider.complete).not.toHaveBeenCalled()
  })

  test("rewrites a repair turn when the LLM returns JSON", async () => {
    const provider = {
      complete: vi.fn().mockResolvedValue('{"clarified":"직경 12mm","explanation":"직전 10mm에서 증가"}'),
    } as any
    const result = await repairMessage(
      "더 큰 거",
      [],
      [{ question: "직경?", answer: "10mm", extractedFilters: [], candidateCountBefore: 100, candidateCountAfter: 50 }] as any,
      provider,
    )
    expect(result.wasRepaired).toBe(true)
    expect(result.clarifiedMessage).toBe("직경 12mm")
  })

  test("returns the original message when the LLM output is not JSON", async () => {
    const provider = { complete: vi.fn().mockResolvedValue("not-json") } as any
    const result = await repairMessage(
      "그거 말고",
      [],
      [{ question: "?", answer: "x", extractedFilters: [], candidateCountBefore: 0, candidateCountAfter: 0 }] as any,
      provider,
    )
    expect(result.wasRepaired).toBe(false)
    expect(result.clarifiedMessage).toBe("그거 말고")
  })
})
