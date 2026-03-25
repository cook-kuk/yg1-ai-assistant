/**
 * General Chat Guards — Regression tests
 *
 * Tests for:
 * 1. buildReplyDisplayedOptions blocks unfilterable chips
 * 2. buildReplyDisplayedOptions preserves valid chips
 */

import { describe, it, expect } from "vitest"
import { buildReplyDisplayedOptions } from "../serve-engine-general-chat"

describe("buildReplyDisplayedOptions: unfilterable guard", () => {
  it("blocks RPM/회전수 chips from reply options", () => {
    const chips = ["코팅 비교", "회전수 범위 좁히기", "절삭조건 보기", "RPM 선택"]
    const result = buildReplyDisplayedOptions(chips)

    expect(result.map(o => o.label)).toEqual(["코팅 비교", "절삭조건 보기"])
    expect(result.every(o => o.field === "_action")).toBe(true)
  })

  it("preserves all valid action chips", () => {
    const chips = ["추천 근거 알려줘", "비교하기", "처음부터 다시"]
    const result = buildReplyDisplayedOptions(chips)

    expect(result).toHaveLength(3)
    expect(result[0].index).toBe(1)
    expect(result[1].index).toBe(2)
    expect(result[2].index).toBe(3)
  })

  it("returns empty array for empty input", () => {
    const result = buildReplyDisplayedOptions([])
    expect(result).toHaveLength(0)
  })

  it("blocks 이송/절삭속도/가격/납기/스핀들 chips", () => {
    const chips = ["이송속도 조정", "절삭속도 선택", "가격 비교", "납기 확인", "스핀들 속도"]
    const result = buildReplyDisplayedOptions(chips)
    expect(result).toHaveLength(0)
  })
})
