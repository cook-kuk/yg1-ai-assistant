import { beforeEach, describe, expect, it } from "vitest"

import {
  _resetLearnedPoolForTest,
  getLearnedFewShotExamples,
  getLearnedPoolStats,
  learnFromNegativeFeedback,
  learnFromPositiveFeedback,
} from "../feedback-pool"
import { _resetFewShotPoolForTest, selectFewShots } from "../adaptive-few-shot"
import type { AppliedFilter } from "@/lib/types/exploration"

function filter(field: string, value: string): AppliedFilter {
  return { field, op: "eq", value, rawValue: value, appliedAt: 0 }
}

describe("feedback-pool", () => {
  beforeEach(() => {
    _resetLearnedPoolForTest()
    _resetFewShotPoolForTest()
  })

  it("ignores empty message or empty filter list", async () => {
    await learnFromPositiveFeedback("", [filter("a", "b")], "s")
    await learnFromPositiveFeedback("hello", [], "s")
    expect(getLearnedPoolStats().total).toBe(0)
  })

  it("adds positive examples and reinforces duplicates", async () => {
    const msg = "스테인리스 4날 10mm"
    const filters = [
      filter("workPieceName", "Stainless Steel"),
      filter("fluteCount", "4"),
      filter("diameterMm", "10"),
    ]

    await learnFromPositiveFeedback(msg, filters, "ses-1")
    await learnFromPositiveFeedback(msg, filters, "ses-1")

    const stats = getLearnedPoolStats()
    expect(stats.total).toBe(1)
    expect(stats.netPositive).toBe(1)
    expect(stats.topExamples[0]?.net).toBe(2)
  })

  it("evicts example when negative feedback overwhelms positive", async () => {
    const msg = "알루미늄 DLC"
    const filters = [filter("workPieceName", "Aluminum"), filter("coating", "DLC")]

    await learnFromPositiveFeedback(msg, filters, "s")
    await learnFromNegativeFeedback(msg, filters)

    expect(getLearnedPoolStats().total).toBe(0)
  })

  it("surfaces learned example via selectFewShots boost", async () => {
    const msg = "티타늄 6mm 6날"
    const filters = [
      filter("workPieceName", "Titanium"),
      filter("diameterMm", "6"),
      filter("fluteCount", "6"),
    ]
    await learnFromPositiveFeedback(msg, filters, "s")
    await learnFromPositiveFeedback(msg, filters, "s")
    await learnFromPositiveFeedback(msg, filters, "s")

    const picked = selectFewShots("티타늄 6mm 6날 엔드밀", 4)
    const inputs = picked.map(p => p.input)
    expect(inputs).toContain(msg)
  })

  it("exposes only net-positive examples through getLearnedFewShotExamples", async () => {
    const filters = [filter("workPieceName", "Copper")]
    await learnFromPositiveFeedback("copper mill", filters, "s")
    expect(getLearnedFewShotExamples()).toHaveLength(1)

    await learnFromNegativeFeedback("copper mill", filters)
    expect(getLearnedFewShotExamples()).toHaveLength(0)
  })
})
