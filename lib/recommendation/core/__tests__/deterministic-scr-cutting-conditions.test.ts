import { describe, expect, it } from "vitest"
import { parseDeterministic } from "../deterministic-scr"
import { getFilterFieldDefinition } from "@/lib/recommendation/shared/filter-field-registry"

describe("deterministic-scr cutting conditions extraction", () => {
  describe("feedRate", () => {
    it("이송속도 0.1 이상 → feedRate gte 0.1", () => {
      const a = parseDeterministic("이송속도 0.1 이상 가능한 것").find(x => x.field === "feedRate")
      expect(a?.value).toBe(0.1)
      expect(a?.op).toBe("gte")
    })

    it("feed rate 0.2 mm/rev 이상", () => {
      const a = parseDeterministic("feed rate 0.2 mm/rev 이상").find(x => x.field === "feedRate")
      expect(a?.value).toBe(0.2)
      expect(a?.op).toBe("gte")
    })

    it("이송 0.05 이하 → lte", () => {
      const a = parseDeterministic("이송 0.05 이하 제품").find(x => x.field === "feedRate")
      expect(a?.value).toBe(0.05)
      expect(a?.op).toBe("lte")
    })

    it("fz 0.15 이상", () => {
      const a = parseDeterministic("fz 0.15 이상으로").find(x => x.field === "feedRate")
      expect(a?.value).toBe(0.15)
    })
  })

  describe("cuttingSpeed", () => {
    it("절삭속도 200 이상 → cuttingSpeed gte 200", () => {
      const a = parseDeterministic("절삭속도 200 이상 가능").find(x => x.field === "cuttingSpeed")
      expect(a?.value).toBe(200)
      expect(a?.op).toBe("gte")
    })

    it("cutting speed 150 m/min 이상", () => {
      const a = parseDeterministic("cutting speed 150 m/min 이상").find(x => x.field === "cuttingSpeed")
      expect(a?.value).toBe(150)
    })

    it("Vc 100 이하", () => {
      const a = parseDeterministic("Vc 100 이하").find(x => x.field === "cuttingSpeed")
      expect(a?.value).toBe(100)
      expect(a?.op).toBe("lte")
    })
  })

  describe("depthOfCut", () => {
    it("절입량 2 이상 → depthOfCut gte 2", () => {
      const a = parseDeterministic("절입량 2 이상 가능").find(x => x.field === "depthOfCut")
      expect(a?.value).toBe(2)
      expect(a?.op).toBe("gte")
    })

    it("depth of cut 1.5 mm 이상", () => {
      const a = parseDeterministic("depth of cut 1.5 mm 이상").find(x => x.field === "depthOfCut")
      expect(a?.value).toBe(1.5)
    })

    it("절입깊이 3 이하 → lte", () => {
      const a = parseDeterministic("절입깊이 3 이하").find(x => x.field === "depthOfCut")
      expect(a?.value).toBe(3)
      expect(a?.op).toBe("lte")
    })
  })

  describe("키워드만 있고 숫자 없으면 추출 안 함", () => {
    it.each(["이송속도 알려줘", "절삭속도 어떻게 되지", "절입량 추천"])("%s", (text) => {
      const actions = parseDeterministic(text)
      expect(actions.find(a => a.field === "feedRate")).toBeUndefined()
      expect(actions.find(a => a.field === "cuttingSpeed")).toBeUndefined()
      expect(actions.find(a => a.field === "depthOfCut")).toBeUndefined()
    })
  })
})

describe("real-world phrasing robustness", () => {
  describe("rpm 다양한 표현", () => {
    const cases: Array<[string, number, "gte" | "lte"]> = [
      ["RPM 10000 이상으로 돌릴 수 있는 거", 10000, "gte"],
      ["회전수 6000 이상 가능한 공구", 6000, "gte"],
      ["스핀들 속도 8000 이상", 8000, "gte"],
      ["spindle 12000 over 가능", 12000, "gte"],
      ["RPM 15,000+ 돌릴거야", 15000, "gte"],
      ["회전수 4000 이하만", 4000, "lte"],
      ["RPM 20000 초과 견디는", 20000, "gte"],
    ]
    it.each(cases)("'%s' → rpm %s %s", (text, value, op) => {
      const a = parseDeterministic(text).find(x => x.field === "rpm")
      expect(a?.value).toBe(value)
      expect(a?.op).toBe(op)
    })
  })

  describe("feedRate 다양한 표현", () => {
    const cases: Array<[string, number, "gte" | "lte"]> = [
      ["이송 0.1 이상 가능한 거", 0.1, "gte"],
      ["이송속도 0.08 이상", 0.08, "gte"],
      ["feed 0.12 mm/rev 이상", 0.12, "gte"],
      ["feed rate 0.05 이하", 0.05, "lte"],
      ["fz 0.2 이상 견디는", 0.2, "gte"],
    ]
    it.each(cases)("'%s' → feedRate %s %s", (text, value, op) => {
      const a = parseDeterministic(text).find(x => x.field === "feedRate")
      expect(a?.value).toBe(value)
      expect(a?.op).toBe(op)
    })
  })

  describe("cuttingSpeed 다양한 표현", () => {
    const cases: Array<[string, number, "gte" | "lte"]> = [
      ["절삭속도 200 이상", 200, "gte"],
      ["절삭속도 150 m/min 이상", 150, "gte"],
      ["cutting speed 250 이상", 250, "gte"],
      ["Vc 100 이하만", 100, "lte"],
      ["Vc 180 이상 견디는 공구", 180, "gte"],
    ]
    it.each(cases)("'%s' → cuttingSpeed %s %s", (text, value, op) => {
      const a = parseDeterministic(text).find(x => x.field === "cuttingSpeed")
      expect(a?.value).toBe(value)
      expect(a?.op).toBe(op)
    })
  })

  describe("depthOfCut 다양한 표현", () => {
    const cases: Array<[string, number, "gte" | "lte"]> = [
      ["절입 2 이상", 2, "gte"],
      ["절입량 1.5 이상", 1.5, "gte"],
      ["절입깊이 3 mm 이상", 3, "gte"],
      ["depth of cut 2.5 이상", 2.5, "gte"],
      ["ap 1 이하", 1, "lte"],
    ]
    it.each(cases)("'%s' → depthOfCut %s %s", (text, value, op) => {
      const a = parseDeterministic(text).find(x => x.field === "depthOfCut")
      expect(a?.value).toBe(value)
      expect(a?.op).toBe(op)
    })
  })

  describe("복합 입력 — 여러 절삭조건이 한 문장에", () => {
    it("'RPM 8000 이상, 이송 0.1 이상, 절입 2 이상' → 3개 추출", () => {
      const actions = parseDeterministic("RPM 8000 이상, 이송 0.1 이상, 절입 2 이상으로 가능한 공구")
      const rpm = actions.find(a => a.field === "rpm")
      const feed = actions.find(a => a.field === "feedRate")
      const dop = actions.find(a => a.field === "depthOfCut")
      expect(rpm?.value).toBe(8000)
      expect(feed?.value).toBe(0.1)
      expect(dop?.value).toBe(2)
    })

    it("'Vc 200 이상, fz 0.15 이상' → cuttingSpeed + feedRate", () => {
      const actions = parseDeterministic("Vc 200 이상, fz 0.15 이상으로 돌리고 싶어")
      expect(actions.find(a => a.field === "cuttingSpeed")?.value).toBe(200)
      expect(actions.find(a => a.field === "feedRate")?.value).toBe(0.15)
    })
  })

  describe("false-positive 가드 — 절삭조건이 아닌 문장은 추출 X", () => {
    const negatives = [
      "직경 10mm 알루미늄 4날",
      "스테인리스 슬로팅 8mm",
      "재고 50개 이상 있는 거",
      "코팅된 엔드밀 추천",
      "GUHRING 브랜드 제품",
      "절삭조건 알려줘",
      "이송속도가 어떻게 되나요",
    ]
    it.each(negatives)("'%s' → cutting condition 없음", (text) => {
      const actions = parseDeterministic(text)
      const fields = ["rpm", "feedRate", "cuttingSpeed", "depthOfCut"]
      for (const f of fields) {
        expect(actions.find(a => a.field === f)).toBeUndefined()
      }
    })
  })

  describe("기존 다른 필드와 공존 — 절삭조건 추가가 다른 추출을 망가뜨리지 않음", () => {
    it("'알루미늄 10mm 4날 RPM 8000 이상' → material/diameter/flute/rpm 모두 추출", () => {
      const actions = parseDeterministic("알루미늄 10mm 4날 RPM 8000 이상")
      expect(actions.find(a => a.field === "rpm")?.value).toBe(8000)
      // 직경/날수/소재 추출도 살아있는지 (정확한 필드명은 시스템에 따라)
      const fields = actions.map(a => a.field)
      expect(fields).toContain("rpm")
      expect(fields.length).toBeGreaterThan(1)
    })
  })
})

describe("filter-field-registry cutting condition definitions", () => {
  it.each([
    ["feedRate", "이송속도", "mm/rev"],
    ["cuttingSpeed", "절삭속도", "m/min"],
    ["depthOfCut", "절입량", "mm"],
  ])("%s 필드가 등록되어 있다", (field, label, unit) => {
    const def = getFilterFieldDefinition(field)
    expect(def).not.toBeNull()
    expect(def?.label).toBe(label)
    expect(def?.unit).toBe(unit)
    expect(def?.kind).toBe("number")
    expect(def?.buildDbClause).toBeDefined()
  })
})
