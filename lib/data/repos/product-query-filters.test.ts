import { describe, expect, it } from "vitest"

import { resolveRequestedToolFamily } from "./product-query-filters"

describe("product query tool family filters", () => {
  it("maps Korean end mill labels to the DB root category value", () => {
    expect(resolveRequestedToolFamily("엔드밀")).toBe("Milling")
    expect(resolveRequestedToolFamily("End Mill")).toBe("Milling")
  })

  it("maps drill, tap, and turning labels to DB root category values", () => {
    expect(resolveRequestedToolFamily("드릴")).toBe("Holemaking")
    expect(resolveRequestedToolFamily("Tap")).toBe("Threading")
    expect(resolveRequestedToolFamily("Turning")).toBe("Tooling System")
    expect(resolveRequestedToolFamily("Tooling System")).toBe("Tooling System")
  })

  it("leaves unknown tool labels unmapped", () => {
    expect(resolveRequestedToolFamily("특수공구")).toBeNull()
  })
})
