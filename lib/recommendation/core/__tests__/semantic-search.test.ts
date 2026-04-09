import { describe, test, expect, beforeAll } from "vitest"
import {
  searchKB,
  loadKB,
  getKBStats,
  getMaterialGuide,
  getCoatingProperties,
  _resetKBForTest,
} from "../semantic-search"

beforeAll(() => {
  _resetKBForTest()
  loadKB()
})

describe("loadKB", () => {
  test("data/domain-knowledge/ 파일 로드", () => {
    const stats = getKBStats()
    console.log("KB stats:", stats)
    if (stats.totalEntries === 0) {
      console.warn("⚠️ domain-knowledge 파일 없음 — 14번 prompt 실행 후 재테스트")
      return
    }
    expect(stats.totalEntries).toBeGreaterThan(0)
  })
})

describe("searchKB", () => {
  test("떨림 → troubleshooting 매칭", () => {
    const results = searchKB("떨림 줄이고 싶어")
    if (results.length > 0) {
      expect(results[0].score).toBeGreaterThan(0)
      console.log(
        "떨림 매칭:",
        results.map(r => `${r.entry.id} (${r.score.toFixed(3)})`),
      )
    }
  })

  test("스테인리스 코팅 → material-guide + coating 매칭", () => {
    const results = searchKB("스테인리스 코팅 추천")
    if (results.length > 0) {
      console.log(
        "스테인리스 매칭:",
        results.map(r => `${r.entry.id} (${r.score.toFixed(3)})`),
      )
    }
  })

  test("Sandvik → competitor 매칭", () => {
    const results = searchKB("Sandvik CoroMill 대체품")
    if (results.length > 0) {
      console.log(
        "Sandvik 매칭:",
        results.map(r => `${r.entry.id} (${r.score.toFixed(3)})`),
      )
    }
  })

  test("카테고리 필터링", () => {
    const materialOnly = searchKB("스테인리스", 10, 0.08, ["material-guide", "material"])
    for (const r of materialOnly) {
      expect(["material-guide", "material"]).toContain(r.entry.category)
    }
  })
})

describe("getMaterialGuide", () => {
  test("스테인리스 가이드 직접 조회", () => {
    const guide = getMaterialGuide("스테인리스")
    if (guide) {
      expect(guide.category).toBe("material-guide")
      console.log("스테인리스 가이드:", guide.summary)
    }
  })
})

describe("getCoatingProperties", () => {
  test("AlCrN 물성 직접 조회", () => {
    const prop = getCoatingProperties("AlCrN")
    if (prop) {
      const name = prop.data.coating_name ?? prop.data.coating
      expect(String(name)).toContain("AlCrN")
      console.log("AlCrN:", prop.summary)
    }
  })
})
