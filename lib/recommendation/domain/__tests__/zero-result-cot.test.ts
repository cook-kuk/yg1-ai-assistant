import { describe, expect, it, vi } from "vitest"
import { generateZeroResultCoT, buildSyntheticZeroResultCoT } from "../zero-result-cot"
import type { AppliedFilter } from "@/lib/recommendation/domain/types"
import type { LLMProvider } from "@/lib/recommendation/infrastructure/llm/recommendation-llm"

const filters: AppliedFilter[] = [
  { field: "material", op: "eq", value: "탄소강", rawValue: "탄소강", appliedAt: 1 },
  { field: "diameterMm", op: "eq", value: "10mm", rawValue: 10, appliedAt: 2 },
  { field: "fluteCount", op: "eq", value: "6날", rawValue: 6, appliedAt: 3 },
  { field: "rpm", op: "gte", value: "20000", rawValue: 20000, appliedAt: 4 },
]

describe("buildSyntheticZeroResultCoT", () => {
  it("필터 없으면 안내 문구만 반환", () => {
    const out = buildSyntheticZeroResultCoT({ userMessage: "추천", filters: [] })
    expect(out).toContain("매칭되는 제품이 없습니다")
    expect(out).toContain("좀 더 구체적으로")
  })

  it("필터 있으면 조건 + 풀어볼 제안 포함", () => {
    const out = buildSyntheticZeroResultCoT({ userMessage: "RPM 20000 이상 6날 10mm 탄소강", filters })
    expect(out).toContain("매칭되는 제품이 없습니다")
    expect(out).toContain("material=탄소강")
    expect(out).toContain("rpm=20000")
    expect(out).toContain("풀어보시면")
  })
})

describe("generateZeroResultCoT", () => {
  it("provider 사용 불가 시 synthetic fallback 반환 (LLM 호출 X)", async () => {
    const provider: LLMProvider = {
      available: () => false,
      complete: vi.fn(),
      streamComplete: vi.fn(),
    } as unknown as LLMProvider

    const out = await generateZeroResultCoT(
      { userMessage: "RPM 20000 6날 10mm", filters },
      provider,
    )
    expect(out).toContain("매칭되는 제품이 없습니다")
    expect(provider.complete).not.toHaveBeenCalled()
  })

  it("LLM이 던지면 synthetic fallback으로 graceful degrade", async () => {
    const provider: LLMProvider = {
      available: () => true,
      complete: vi.fn().mockRejectedValue(new Error("network down")),
      streamComplete: vi.fn(),
    } as unknown as LLMProvider

    const out = await generateZeroResultCoT(
      { userMessage: "RPM 20000 6날 10mm", filters },
      provider,
    )
    expect(out).toContain("매칭되는 제품이 없습니다")
  })

  it("LLM이 정상 응답하면 그 텍스트 반환", async () => {
    const provider: LLMProvider = {
      available: () => true,
      complete: vi.fn().mockResolvedValue("음, RPM 20000은 6날 10mm 탄소강 조합에서 거의 없는 사양입니다. 일단 RPM 조건을 풀어보시면 결과가 나올 가능성이 높습니다."),
      streamComplete: vi.fn(),
    } as unknown as LLMProvider

    const out = await generateZeroResultCoT(
      { userMessage: "RPM 20000 6날 10mm", filters },
      provider,
    )
    expect(out).toContain("RPM 20000은 6날 10mm 탄소강")
  })

  it("LLM이 빈 문자열/너무 짧으면 synthetic fallback으로 떨어짐", async () => {
    const provider: LLMProvider = {
      available: () => true,
      complete: vi.fn().mockResolvedValue("..."),
      streamComplete: vi.fn(),
    } as unknown as LLMProvider

    const out = await generateZeroResultCoT(
      { userMessage: "RPM 20000", filters },
      provider,
    )
    expect(out).toContain("매칭되는 제품이 없습니다")
  })
})
