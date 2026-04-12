import { describe, expect, it } from "vitest"

import { parseDeterministic } from "../deterministic-scr"

function findField(message: string, field: string) {
  return parseDeterministic(message).find(action => action.field === field)
}

describe("deterministic-scr negation scope", () => {
  it("keeps a postposed brand exclusion from negating the next workpiece", () => {
    const brand = findField("CRX S 빼고 스테인리스", "brand")
    const workPiece = findField("CRX S 빼고 스테인리스", "workPieceName")

    expect(brand).toMatchObject({ field: "brand", op: "neq" })
    expect(String(brand?.value).toUpperCase().replace(/[\s-]/g, "")).toBe("CRXS")
    expect(workPiece).toMatchObject({
      field: "workPieceName",
      value: "Stainless Steels",
      op: "eq",
    })
  })

  it("still treats postposed negation on the same token as neq", () => {
    const workPiece = findField("스테인리스 말고", "workPieceName")

    expect(workPiece).toMatchObject({
      field: "workPieceName",
      value: "Stainless Steels",
      op: "neq",
    })
  })

  it("still treats prefixed negation as neq", () => {
    const workPiece = findField("아닌 스테인리스", "workPieceName")

    expect(workPiece).toMatchObject({
      field: "workPieceName",
      value: "Stainless Steels",
      op: "neq",
    })
  })
})
