import { describe, test, expect } from "vitest"
import { generateInsights, formatInsightsForPrompt } from "../insight-generator"

const mk = (field: string, value: string | number): any => ({
  field,
  op: "eq",
  value: String(value),
  rawValue: value,
  appliedAt: 0,
})

describe("generateInsights", () => {
  test("L/D > 8 → warning", () => {
    const r = generateInsights("추천해줘", [mk("diameterMm", 6), mk("overallLengthMm", 150)], 5, 1)
    expect(r.some(i => i.type === "warning" && i.message.includes("L/D"))).toBe(true)
  })

  test("L/D 4~8 → warning", () => {
    const r = generateInsights("추천해줘", [mk("diameterMm", 10), mk("overallLengthMm", 60)], 5, 1)
    expect(r.some(i => i.type === "warning" && i.message.includes("L/D"))).toBe(true)
  })

  test("수명 문제 → root_cause 또는 tip (KB 로드 확인)", () => {
    const r = generateInsights("공구 수명이 너무 짧아", [mk("workPieceName", "스테인리스")], 10, 2)
    // KB에 troubleshooting 데이터가 있으면 root_cause 기대. 최소 1개 이상 나와야 함.
    expect(r.length).toBeGreaterThan(0)
  })

  test("최대 3개", () => {
    const r = generateInsights(
      "스테인리스 포켓 떨림 수명 마모 문제",
      [
        mk("workPieceName", "스테인리스"),
        mk("diameterMm", 6),
        mk("overallLengthMm", 100),
        mk("coating", "DLC"),
      ],
      10,
      3,
    )
    expect(r.length).toBeLessThanOrEqual(3)
  })

  test("빈 입력은 빈 배열", () => {
    const r = generateInsights("", [], 0, 0)
    expect(r).toEqual([])
  })

  test("priority 오름차순 정렬", () => {
    const r = generateInsights("떨림 수명", [mk("diameterMm", 6), mk("overallLengthMm", 100)], 5, 2)
    for (let i = 1; i < r.length; i++) {
      expect(r[i].priority).toBeGreaterThanOrEqual(r[i - 1].priority)
    }
  })

  test("formatInsightsForPrompt 빈 배열 → 빈 문자열", () => {
    expect(formatInsightsForPrompt([])).toBe("")
  })

  test("formatInsightsForPrompt 아이콘/라벨 포함", () => {
    const text = formatInsightsForPrompt([
      { type: "root_cause", source: "t", message: "원인 X", priority: 1 },
      { type: "warning", source: "t", message: "경고 Y", priority: 2 },
      { type: "expert_tip", source: "t", message: "팁 Z", priority: 3 },
    ])
    expect(text).toContain("💡")
    expect(text).toContain("⚠️")
    expect(text).toContain("🔧")
    expect(text).toContain("진짜 원인")
  })
})
