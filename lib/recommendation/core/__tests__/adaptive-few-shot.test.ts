import { describe, test, expect, beforeAll } from "vitest"
import { selectFewShots, loadFewShotPool, buildFewShotText, _resetFewShotPoolForTest } from "../adaptive-few-shot"

beforeAll(() => {
  _resetFewShotPoolForTest()
  loadFewShotPool()
})

describe("selectFewShots", () => {
  test("스테인리스 → 관련 예시 1개 이상", () => {
    const ex = selectFewShots("스테인리스 4날 10mm")
    expect(ex.length).toBeGreaterThan(0)
    expect(ex.length).toBeLessThanOrEqual(4)
  })
  test("최대 4개", () => {
    const ex = selectFewShots("구리 스퀘어 2날 10mm DLC")
    expect(ex.length).toBeLessThanOrEqual(4)
  })
  test("매칭 없으면 빈 배열", () => {
    const ex = selectFewShots("zzzzzzzzzzz qqqqq")
    expect(ex.length).toBe(0)
  })
  test("buildFewShotText 포맷", () => {
    const ex = selectFewShots("Ball")
    if (ex.length > 0) {
      const txt = buildFewShotText(ex)
      expect(txt).toContain("User:")
      expect(txt).toContain("→")
    }
  })
})
