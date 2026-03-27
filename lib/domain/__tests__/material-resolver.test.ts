import { describe, expect, it } from "vitest"

import { getAllTags, getMaterialDisplay, resolveMaterialTag } from "../material-resolver"

describe("material-resolver", () => {
  it("resolves common Korean and English aliases without JSON taxonomy files", () => {
    expect(resolveMaterialTag("SUS304")).toBe("M")
    expect(resolveMaterialTag("알루미늄")).toBe("N")
    expect(resolveMaterialTag("Inconel")).toBe("S")
    expect(resolveMaterialTag("HRC 55")).toBe("H")
    expect(resolveMaterialTag("S45C")).toBe("P")
  })

  it("returns stable display labels from in-code taxonomy", () => {
    expect(getMaterialDisplay("M")).toEqual({ ko: "스테인리스", en: "Stainless Steels" })
    expect(getMaterialDisplay("N")).toEqual({ ko: "비철", en: "Non-Ferrous" })
  })

  it("returns canonical ISO tags", () => {
    expect(getAllTags()).toEqual(["P", "M", "K", "N", "S", "H"])
  })
})
