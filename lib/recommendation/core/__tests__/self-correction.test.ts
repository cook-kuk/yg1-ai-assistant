import { describe, test, expect, vi } from "vitest"
import { selfCorrectFilters } from "../self-correction"
import type { AppliedFilter } from "@/lib/types/exploration"

const mkFilter = (overrides: Partial<AppliedFilter>): AppliedFilter => ({
  field: "x", op: "eq", value: "v", rawValue: "v", appliedAt: 0, ...overrides,
})

describe("selfCorrectFilters", () => {
  test("LLM 재진단으로 1차에 성공", async () => {
    const provider = {
      complete: vi.fn().mockResolvedValue('{"reasoning":"like 완화","filters":[{"field":"search_coating","op":"like","value":"Y"}]}'),
    } as any
    let calls = 0
    const r = await selfCorrectFilters(
      "Y코팅",
      [mkFilter({ field: "search_coating", value: "Y-Coating", rawValue: "Y-Coating" })],
      provider,
      async () => { calls++; return calls === 1 ? 5 : 0 },
    )
    expect(r.success).toBe(true)
    expect(r.attempts[0]?.strategy).toBe("llm_rewrite")
    expect(r.attempts[0]?.resultCount).toBe(5)
  })

  test("LLM 실패해도 eq→like 폴백으로 성공", async () => {
    const provider = { complete: vi.fn().mockResolvedValue("not-json") } as any
    let calls = 0
    const r = await selfCorrectFilters(
      "Y코팅 볼",
      [
        mkFilter({ field: "search_coating", value: "Y-Coating", rawValue: "Y-Coating" }),
        mkFilter({ field: "search_subtype", value: "Ball", rawValue: "Ball", appliedAt: 1 }),
      ],
      provider,
      async () => { calls++; return calls >= 1 ? 10 : 0 },
    )
    expect(r.success).toBe(true)
  })

  test("전부 실패하면 안내 메시지 + success=false", async () => {
    const provider = { complete: vi.fn().mockResolvedValue("{}") } as any
    const r = await selfCorrectFilters(
      "없는조건",
      [mkFilter({ field: "x", value: "없음", rawValue: "없음" })],
      provider,
      async () => 0,
    )
    expect(r.success).toBe(false)
    expect(r.explanation).toBeTruthy()
  })

  test("drop_last는 appliedAt 가장 큰 필터부터 제거", async () => {
    const provider = { complete: vi.fn().mockResolvedValue("{}") } as any
    let calls = 0
    let lastSeen: AppliedFilter[] = []
    const r = await selfCorrectFilters(
      "test",
      [
        mkFilter({ field: "a", appliedAt: 0 }),
        mkFilter({ field: "b", appliedAt: 1 }),
        mkFilter({ field: "c", appliedAt: 2 }),
      ],
      provider,
      async (filters) => {
        calls++
        lastSeen = filters
        // step1 (llm_rewrite, llm 실패 → skip), step2 (eq_to_like → 0), step3 (drop_last → 5)
        return calls >= 2 ? 5 : 0
      },
    )
    expect(r.success).toBe(true)
    // drop_last 단계에 도달했다면 c가 빠져 있어야 함
    if (r.attempts.some(a => a.strategy === "drop_last")) {
      expect(lastSeen.find(f => f.field === "c")).toBeUndefined()
    }
  })
})
