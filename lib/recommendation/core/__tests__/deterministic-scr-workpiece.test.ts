import { describe, expect, it } from "vitest"
import { parseDeterministic } from "../deterministic-scr"

function findWorkpiece(message: string) {
  return parseDeterministic(message).find(a => a.field === "workPieceName")
}

describe("deterministic-scr workPieceName extraction", () => {
  it("SUS304 → Stainless Steels", () => {
    const a = findWorkpiece("SUS304 가공할건데")
    expect(a).toBeDefined()
    expect(a?.value).toBe("Stainless Steels")
    expect(a?.op).toBe("eq")
  })

  it("SCM440 → Alloy Steels", () => {
    const a = findWorkpiece("SCM440 재질 가공")
    expect(a?.value).toBe("Alloy Steels")
  })

  it("알루미늄 A6061 → Aluminum", () => {
    const a = findWorkpiece("알루미늄 A6061 작업")
    expect(a?.value).toBe("Aluminum")
  })

  it("인코넬 718 → Inconel", () => {
    const a = findWorkpiece("인코넬 718 가공")
    expect(a?.value).toBe("Inconel")
  })

  it("HRC55 경화강 → Hardened Steels", () => {
    const a = findWorkpiece("HRC55 경화강 가공")
    expect(a?.value).toBe("Hardened Steels")
  })

  it("주철 FC250 → Cast Iron", () => {
    const a = findWorkpiece("주철 FC250 작업")
    expect(a?.value).toBe("Cast Iron")
  })

  it("Ti6Al4V 티타늄 → Titanium", () => {
    const a = findWorkpiece("Ti6Al4V 티타늄 작업")
    expect(a?.value).toBe("Titanium")
  })

  it("S45C → Carbon Steels", () => {
    const a = findWorkpiece("S45C 탄소강 가공")
    expect(a?.value).toBe("Carbon Steels")
  })

  it("SKD11 → Hardened Steels (not Alloy)", () => {
    const a = findWorkpiece("SKD11 다이스강")
    expect(a?.value).toBe("Hardened Steels")
  })

  it("황동 → Copper", () => {
    const a = findWorkpiece("황동 가공")
    expect(a?.value).toBe("Copper")
  })

  it("CFRP → FRP", () => {
    const a = findWorkpiece("CFRP 복합재")
    expect(a?.value).toBe("FRP")
  })

  it("흑연 → Graphite", () => {
    const a = findWorkpiece("흑연 가공")
    expect(a?.value).toBe("Graphite")
  })

  it("주강 → Cast Steel", () => {
    const a = findWorkpiece("주강 작업")
    expect(a?.value).toBe("Cast Steel")
  })

  it("no workpiece mention → no action", () => {
    const a = findWorkpiece("그냥 제품 추천해줘")
    expect(a).toBeUndefined()
  })
})
