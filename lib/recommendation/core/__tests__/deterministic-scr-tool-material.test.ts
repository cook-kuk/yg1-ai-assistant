/**
 * 공구재질(toolMaterial) deterministic 추출 회귀.
 * DB 에 실제 존재하는 4종(Carbide / HSS / CBN / Diamond) 모두 매핑되는지,
 * 한국어 별칭/영문/약어/부정 매칭/false-positive 가드 검증.
 */
import { describe, expect, it } from "vitest"
import { parseDeterministic } from "../deterministic-scr"

function tm(text: string) {
  return parseDeterministic(text).find(a => a.field === "toolMaterial")
}

describe("toolMaterial deterministic extraction", () => {
  describe("Carbide / 초경", () => {
    it.each([
      "카바이드 공구로 추천해줘",
      "초경 엔드밀",
      "Carbide 재질",
      "carbide 으로 부탁해",
    ])("'%s' → Carbide eq", (text) => {
      const a = tm(text)
      expect(a?.value).toBe("Carbide")
      expect(a?.op).toBe("eq")
    })
  })

  describe("HSS / 하이스", () => {
    it.each([
      "HSS 공구",
      "하이스 재질로",
      "고속도강 엔드밀",
      "high speed steel tool",
      "hss 추천",
    ])("'%s' → HSS eq", (text) => {
      const a = tm(text)
      expect(a?.value).toBe("HSS")
    })
  })

  describe("CBN", () => {
    it.each([
      "CBN 공구",
      "씨비엔 재질",
      "cbn 으로",
      "큐빅 보론 나이트라이드",
      "cubic boron nitride 공구",
    ])("'%s' → CBN eq", (text) => {
      const a = tm(text)
      expect(a?.value).toBe("CBN")
    })
  })

  describe("Diamond / PCD", () => {
    it.each([
      "다이아몬드 공구",
      "PCD 재질",
      "diamond 으로",
      "pcd 추천",
      "polycrystalline diamond",
    ])("'%s' → Diamond eq", (text) => {
      const a = tm(text)
      expect(a?.value).toBe("Diamond")
    })
  })

  describe("부정 (negation)", () => {
    it.each([
      ["하이스 빼고 추천", "HSS"],
      ["CBN 말고", "CBN"],
      ["카바이드 제외", "Carbide"],
    ] as const)("'%s' → %s neq", (text, expected) => {
      const a = tm(text)
      expect(a?.value).toBe(expected)
      expect(a?.op).toBe("neq")
    })
  })

  describe("False-positive 가드 — 공구재질 아닌 문장은 추출 X", () => {
    it.each([
      "직경 10mm 알루미늄 4날",
      "스테인리스 슬로팅 8mm",
      "GUHRING 브랜드 제품",
      "재고 50개 이상",
      "공구 소재 알려줘",  // 질문만, 값 없음
    ])("'%s' → toolMaterial 없음", (text) => {
      expect(tm(text)).toBeUndefined()
    })
  })

  describe("우선순위 — 동시 등장 시 첫 매칭 우선", () => {
    it("'카바이드 공구, HSS 말고' → Carbide 가 먼저 잡힘", () => {
      // TOOL_MATERIAL_PATTERNS 는 첫 번째 매칭에서 break 하므로 Carbide 가 잡힌다.
      const a = tm("카바이드 공구, HSS 말고")
      expect(a?.value).toBe("Carbide")
    })
  })

  describe("기존 다른 필터와 공존", () => {
    it("'알루미늄 10mm 4날 카바이드' → toolMaterial=Carbide + 다른 필드도 추출", () => {
      const actions = parseDeterministic("알루미늄 10mm 4날 카바이드")
      expect(actions.find(a => a.field === "toolMaterial")?.value).toBe("Carbide")
      const fields = actions.map(a => a.field)
      expect(fields).toContain("toolMaterial")
      expect(fields.length).toBeGreaterThan(1)
    })
  })
})
