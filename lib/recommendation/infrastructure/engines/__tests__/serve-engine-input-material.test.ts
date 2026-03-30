import { describe, expect, it } from "vitest"

import { mapIntakeToInput } from "../serve-engine-input"
import type { ProductIntakeForm } from "@/lib/recommendation/domain/types"

function makeForm(material: string): ProductIntakeForm {
  return {
    inquiryPurpose: { status: "known", value: "new" },
    material: { status: "known", value: material },
    operationType: { status: "known", value: "Side_Milling" },
    machiningIntent: { status: "unanswered" },
    toolTypeOrCurrentProduct: { status: "known", value: "Milling" },
    diameterInfo: { status: "known", value: "6mm" },
    country: { status: "known", value: "KOREA" },
  }
}

describe("serve-engine input material mapping", () => {
  it("passes ISO material selections through without re-translation", () => {
    const input = mapIntakeToInput(makeForm("S"))
    expect(input.material).toBe("S")
  })

  it("keeps comma-separated ISO material selections canonicalized", () => {
    const input = mapIntakeToInput(makeForm("p, n"))
    expect(input.material).toBe("P,N")
  })

  it("maps machining category directly to the DB root-category value", () => {
    const input = mapIntakeToInput({
      ...makeForm("S"),
      toolTypeOrCurrentProduct: { status: "known", value: "Tooling System" },
    })

    expect(input.toolType).toBe("Tooling System")
    expect(input.machiningCategory).toBe("Turning")
    expect(input.operationType).toBe("Side_Milling")
  })
})
