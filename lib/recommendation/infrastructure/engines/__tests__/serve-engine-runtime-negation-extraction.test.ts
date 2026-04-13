import { describe, expect, it } from "vitest"

import { extractNegatedValue } from "../serve-engine-runtime"

describe("serve-engine-runtime negation extraction", () => {
  it("prefers coating when the negated phrase contains a coating cue", () => {
    expect(extractNegatedValue("Y코팅 말고")).toEqual({
      field: "coating",
      rawValue: "Y-Coating",
      displayValue: "Y코팅",
    })
  })

  it("still resolves brand negation when there is no stronger field cue", () => {
    expect(extractNegatedValue("CRX S 빼고")).toEqual({
      field: "brand",
      rawValue: "CRX S",
      displayValue: "CRX S",
    })
  })
})
