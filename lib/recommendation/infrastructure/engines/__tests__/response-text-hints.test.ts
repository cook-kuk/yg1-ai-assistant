import { describe, expect, it } from "vitest"

import { buildRpmExplanationText, normalizeRpmPhrases } from "../response-text-hints"
import type { AppliedFilter } from "@/lib/recommendation/domain/types"

describe("response-text-hints", () => {
  it("builds generic rpm guidance from the active filter", () => {
    const text = buildRpmExplanationText([
      { field: "rpm", op: "lte", value: "5000RPM", rawValue: 5000, appliedAt: 0 } as AppliedFilter,
    ])

    expect(text).toContain("절삭속도(Vc)")
    expect(text).toContain("5,000rpm 이하")
  })

  it("normalizes uppercase rpm phrases into natural Korean wording", () => {
    expect(normalizeRpmPhrases("RPM 5000 이하로 좁혔더니 187개가 나왔습니다."))
      .toBe("회전수 5,000rpm 이하로 좁혔더니 187개가 나왔습니다.")
  })
})
