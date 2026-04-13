export interface OrderQuantityInventoryAmbiguity {
  quantity: number
  quantityPhrase: string
  normalizedQuantityPhrase: string
  question: string
  chips: string[]
}

const INVENTORY_CUE_RE =
  /(?:재고|stock|inventory|보유|창고|즉시\s*출고|출고\s*가능|on\s*hand)/iu

const ORDER_CUE_RE =
  /(?:주문(?!\s*코드)|발주|구매|오더|order|필요|수량|물량|납품)/iu

const QUANTITY_PHRASE_RE =
  /(\d[\d,]*)\s*(개|ea|pcs?|pc|set|세트)\s*(이상|이하|초과|미만|적게|넘는|정도|가량|내외|at\s+least|or\s+more|more\s+than|less\s+than|under|below|over)?/iu

function normalizeQuantityUnit(rawUnit: string): "개" | "세트" {
  return /^(?:set|세트)$/iu.test(rawUnit.trim()) ? "세트" : "개"
}

function normalizeQuantityModifier(rawModifier: string | undefined): string {
  const clean = (rawModifier ?? "").trim().toLowerCase()
  if (!clean) return ""

  if (clean.includes("초과")) return "초과"
  if (clean.includes("미만")) return "미만"
  if (clean.includes("이하") || clean.includes("less") || clean.includes("under") || clean.includes("below")) {
    return "이하"
  }
  if (
    clean.includes("이상")
    || clean.includes("적게")
    || clean.includes("넘는")
    || clean.includes("at least")
    || clean.includes("or more")
    || clean.includes("more than")
    || clean.includes("over")
  ) {
    return "이상"
  }
  if (clean.includes("정도")) return "정도"
  if (clean.includes("가량")) return "가량"
  if (clean.includes("내외")) return "내외"
  return rawModifier?.trim() ?? ""
}

function formatNormalizedQuantityPhrase(quantity: number, unit: string, modifier: string): string {
  const displayUnit = normalizeQuantityUnit(unit)
  const displayModifier = normalizeQuantityModifier(modifier)
  return `${quantity.toLocaleString("ko-KR")}${displayUnit}${displayModifier ? ` ${displayModifier}` : ""}`
}

export function detectOrderQuantityInventoryAmbiguity(
  message: string,
): OrderQuantityInventoryAmbiguity | null {
  const clean = message.normalize("NFKC").replace(/\s+/g, " ").trim()
  if (!clean) return null
  if (!ORDER_CUE_RE.test(clean)) return null
  if (INVENTORY_CUE_RE.test(clean)) return null

  const quantityMatch = QUANTITY_PHRASE_RE.exec(clean)
  if (!quantityMatch) return null

  const quantity = Number.parseInt(quantityMatch[1].replace(/,/g, ""), 10)
  if (!Number.isFinite(quantity) || quantity <= 0) return null

  const normalizedQuantityPhrase = formatNormalizedQuantityPhrase(
    quantity,
    quantityMatch[2] ?? "개",
    quantityMatch[3] ?? "",
  )

  return {
    quantity,
    quantityPhrase: quantityMatch[0].trim(),
    normalizedQuantityPhrase,
    question: `말씀하신 "${normalizedQuantityPhrase}"이 재고 기준인지, 필요한 주문 수량 기준인지 확인해 주세요.`,
    chips: [
      `재고 ${normalizedQuantityPhrase}`,
      `주문 수량 ${normalizedQuantityPhrase}`,
      "둘 다 중요",
      "직접 입력",
    ],
  }
}
