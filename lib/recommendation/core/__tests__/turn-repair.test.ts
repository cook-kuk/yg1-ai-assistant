import { describe, test, expect, vi } from "vitest"
import { needsRepair, repairMessage } from "../turn-repair"

describe("needsRepair", () => {
  test("모호한 참조 패턴 검출", () => {
    expect(needsRepair("그거 말고")).toBe(true)
    expect(needsRepair("더 큰 거")).toBe(true)
    expect(needsRepair("아니야 소재를 말한 거야")).toBe(true)
    expect(needsRepair("좀 더 작은 거")).toBe(true)
    expect(needsRepair("방금 그거")).toBe(true)
  })

  test("일반 메시지는 통과", () => {
    expect(needsRepair("스테인리스 4날 10mm")).toBe(false)
    expect(needsRepair("TiAlN 코팅으로")).toBe(false)
    expect(needsRepair("Y-Coating 볼타입")).toBe(false)
  })
})

describe("repairMessage", () => {
  test("history 비어있으면 통과", async () => {
    const provider = { complete: vi.fn() } as any
    const r = await repairMessage("그거 말고", [], [], provider)
    expect(r.wasRepaired).toBe(false)
    expect(provider.complete).not.toHaveBeenCalled()
  })

  test("needsRepair=false면 통과", async () => {
    const provider = { complete: vi.fn() } as any
    const r = await repairMessage("스테인리스 4날", [], [{ question: "?", answer: "x", extractedFilters: [], candidateCountBefore: 0, candidateCountAfter: 0 }], provider)
    expect(r.wasRepaired).toBe(false)
    expect(provider.complete).not.toHaveBeenCalled()
  })

  test("LLM 응답 파싱 → 교정 성공", async () => {
    const provider = {
      complete: vi.fn().mockResolvedValue('{"clarified":"직경 12mm","explanation":"직전 10mm에서 증가"}'),
    } as any
    const r = await repairMessage("더 큰 거", [], [
      { question: "직경?", answer: "10mm", extractedFilters: [], candidateCountBefore: 100, candidateCountAfter: 50 },
    ], provider)
    expect(r.wasRepaired).toBe(true)
    expect(r.clarifiedMessage).toBe("직경 12mm")
  })

  test("LLM 실패 시 원본 반환", async () => {
    const provider = { complete: vi.fn().mockResolvedValue("not-json") } as any
    const r = await repairMessage("그거 말고", [], [
      { question: "?", answer: "x", extractedFilters: [], candidateCountBefore: 0, candidateCountAfter: 0 },
    ], provider)
    expect(r.wasRepaired).toBe(false)
    expect(r.clarifiedMessage).toBe("그거 말고")
  })
})
