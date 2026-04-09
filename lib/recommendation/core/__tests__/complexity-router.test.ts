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
  test("light는 KB/CoT/웹서치 끔", () => {
    const d = assessComplexity("10mm")
    expect(d.searchKB).toBe(false)
    expect(d.generateCoT).toBe(false)
    expect(d.allowWebSearch).toBe(false)
  })
  test("deep는 전부 켬", () => {
    const d = assessComplexity("AlCrN vs TiAlN?")
    expect(d.searchKB).toBe(true)
    expect(d.generateCoT).toBe(true)
  })
})
