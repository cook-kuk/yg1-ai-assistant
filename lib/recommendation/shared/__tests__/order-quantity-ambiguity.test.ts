import { describe, expect, it } from "vitest"

import { detectOrderQuantityInventoryAmbiguity } from "../order-quantity-ambiguity"

describe("detectOrderQuantityInventoryAmbiguity", () => {
  it("detects ambiguous bulk-order quantity requests without explicit inventory cues", () => {
    const result = detectOrderQuantityInventoryAmbiguity("여기서 나는 200개 이상 주문해야해요")

    expect(result).toMatchObject({
      quantity: 200,
      normalizedQuantityPhrase: "200개 이상",
      chips: [
        "재고 200개 이상",
        "주문 수량 200개 이상",
        "둘 다 중요",
        "직접 입력",
      ],
    })
    expect(result?.question).toContain("재고 기준인지")
  })

  it("does not trigger when the user explicitly mentions inventory", () => {
    const result = detectOrderQuantityInventoryAmbiguity("재고 200개 이상 있는 걸로 주문해야 해요")

    expect(result).toBeNull()
  })
})
