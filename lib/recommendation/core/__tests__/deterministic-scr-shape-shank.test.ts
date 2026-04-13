import { describe, expect, it } from "vitest"

import { parseDeterministic } from "../deterministic-scr"

function activeFiltersFor(text: string) {
  return parseDeterministic(text).filter(action => action.type === "apply_filter")
}

describe("deterministic-scr shape and shank fast path", () => {
  it("parses 볼노즈 엔드밀 as toolSubtype=Ball", () => {
    const subtype = activeFiltersFor("볼노즈 엔드밀").find(action => action.field === "toolSubtype")
    expect(subtype).toMatchObject({ field: "toolSubtype", value: "Ball", op: "eq" })
  })

  it("parses 플랫 엔드밀 as toolSubtype=Square", () => {
    const subtype = activeFiltersFor("플랫 엔드밀").find(action => action.field === "toolSubtype")
    expect(subtype).toMatchObject({ field: "toolSubtype", value: "Square", op: "eq" })
  })

  it("parses 코너R 엔드밀 as toolSubtype=Radius", () => {
    const subtype = activeFiltersFor("코너R 엔드밀").find(action => action.field === "toolSubtype")
    expect(subtype).toMatchObject({ field: "toolSubtype", value: "Radius", op: "eq" })
  })

  it("does not over-promote 코너R 0.5 into toolSubtype without shape context", () => {
    const subtype = activeFiltersFor("코너R 0.5").find(action => action.field === "toolSubtype")
    expect(subtype).toBeUndefined()
  })

  it("parses HSK 생크 as shankType=HSK without a phantom brand", () => {
    const actions = activeFiltersFor("HSK 생크")
    expect(actions.find(action => action.field === "shankType")).toMatchObject({
      field: "shankType",
      value: "HSK",
      op: "eq",
    })
    expect(actions.find(action => action.field === "brand")).toBeUndefined()
  })

  it("parses Y코팅 말고 as coating neq Y-Coating", () => {
    const coating = activeFiltersFor("Y코팅 말고").find(action => action.field === "coating")
    expect(coating).toMatchObject({ field: "coating", value: "Y-Coating", op: "neq" })
  })
})
