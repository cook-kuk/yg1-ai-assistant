import { describe, expect, it } from "vitest"

import { resolveRequestedToolFamily } from "./product-query-filters"

describe("product query tool family filters", () => {
  it("maps Korean end mill labels to milling", () => {
    expect(resolveRequestedToolFamily("엔드밀")).toBe("milling")
    expect(resolveRequestedToolFamily("End Mill")).toBe("milling")
  })

  it("maps drill and tap labels to their root families", () => {
    expect(resolveRequestedToolFamily("드릴")).toBe("holemaking")
    expect(resolveRequestedToolFamily("Tap")).toBe("threading")
  })

  it("leaves unknown tool labels unmapped", () => {
    expect(resolveRequestedToolFamily("특수공구")).toBeNull()
  })
})
