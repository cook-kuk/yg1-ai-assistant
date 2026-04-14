import { beforeEach, describe, expect, test } from "vitest"

import {
  _resetFewShotPoolForTest,
  buildFewShotText,
  loadFewShotPool,
  selectFewShots,
} from "../adaptive-few-shot"

beforeEach(() => {
  _resetFewShotPoolForTest()
  loadFewShotPool()
})

describe("adaptive few-shot", () => {
  test("loads examples for a stainless query", () => {
    const examples = selectFewShots("스테인리스 4날 10mm")

    expect(examples.length).toBeGreaterThan(0)
    expect(examples.length).toBeLessThanOrEqual(4)
  })

  test("caps the number of selected examples", () => {
    const examples = selectFewShots("구리 스퀘어 2날 10mm DLC")

    expect(examples.length).toBeLessThanOrEqual(4)
  })

  test("returns an empty list when nothing matches", () => {
    const examples = selectFewShots("zzzzzzzzzzz qqqqq")

    expect(examples).toEqual([])
  })

  test("formats selected examples as prompt text", () => {
    const examples = selectFewShots("Ball")
    const text = buildFewShotText(examples)

    if (examples.length === 0) {
      expect(text).toBe("")
      return
    }

    expect(text).toContain("User:")
    expect(text).toContain("\n→")
  })
})
