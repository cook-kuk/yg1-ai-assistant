import { describe, test, expect } from "vitest"
import { assessComplexity } from "../complexity-router"

describe("assessComplexity", () => {
  test("light", () => {
    expect(assessComplexity("10mm").level).toBe("light")
    expect(assessComplexity("네").level).toBe("light")
    expect(assessComplexity("Y-Coating").level).toBe("light")
    expect(assessComplexity("스퀘어").level).toBe("light")
    expect(assessComplexity("상관없음").level).toBe("light")
    expect(assessComplexity("DLC", 3).level).toBe("light")
  })
  test("deep", () => {
    expect(assessComplexity("AlCrN이랑 TiAlN 뭐가 나아?").level).toBe("deep")
    expect(assessComplexity("떨림 줄이고 싶어").level).toBe("deep")
    expect(assessComplexity("Sandvik 대체품 있어?").level).toBe("deep")
    expect(assessComplexity("코팅이 뭐야?").level).toBe("deep")
    expect(assessComplexity("추천해줘 그리고 알루파워가 뭐야?").level).toBe("deep")
  })
  test("normal", () => {
    expect(assessComplexity("스테인리스 4날 10mm").level).toBe("normal")
    expect(assessComplexity("티타늄 가공용 엔드밀").level).toBe("normal")
  })
  test("light는 KB/웹서치만 끔 (CoT는 hotfix로 전역 OFF)", () => {
    const d = assessComplexity("10mm")
    expect(d.searchKB).toBe(false)
    expect(d.allowWebSearch).toBe(false)
    expect(d.generateCoT).toBe(false) // hotfix: CoT 전역 비활성화
    expect(d.runSelfCorrection).toBe(true)
  })
  test("deep는 KB + CoT 켬 (light/normal만 CoT off)", () => {
    const d = assessComplexity("AlCrN vs TiAlN?")
    expect(d.searchKB).toBe(true)
    expect(d.generateCoT).toBe(true)
  })
  test("칩 클릭은 CoT/self-correction 모두 OFF (fast path)", () => {
    const d = assessComplexity("6날 (213개)")
    expect(d.level).toBe("light")
    expect(d.generateCoT).toBe(false)
    expect(d.runSelfCorrection).toBe(false)
    expect(assessComplexity("4날 (1558개)").generateCoT).toBe(false)
    expect(assessComplexity("Y 코팅 (42건)").generateCoT).toBe(false)
  })
  test("구조화 인테이크 첫 턴은 CoT/self-correction OFF", () => {
    const intake = "🧭 문의 목적: 신규 제품 추천\n🧱 가공 소재: 탄소강\n🛠️ 가공 방식: Milling\n위 조건에 맞는 YG-1 제품을 추천해 주세요."
    const d = assessComplexity(intake)
    expect(d.level).toBe("light")
    expect(d.generateCoT).toBe(false)
    expect(d.runSelfCorrection).toBe(false)
  })
})
