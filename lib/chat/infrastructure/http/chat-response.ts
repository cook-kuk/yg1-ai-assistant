import type {
  ChatMessageDto,
  ChatResponseDto,
} from "@/lib/contracts/chat"

export type ChatIntent = ChatResponseDto["intent"]
export type ChatMessage = ChatMessageDto
export type LLMResponse = ChatResponseDto

type ToolResultRecord = { name: string; result: string }
type BrandProduct = { brand: string; displayCode: string; seriesName: string | null }

export function inferIntent(toolsUsed: string[]): ChatIntent {
  if (toolsUsed.includes("get_competitor_mapping")) return "cross_reference"
  if (toolsUsed.includes("get_cutting_conditions")) return "cutting_condition"
  if (toolsUsed.includes("search_product_by_edp")) return "product_lookup"
  if (toolsUsed.includes("get_product_detail")) return "product_lookup"
  if (toolsUsed.includes("search_products")) return "product_recommendation"
  if (toolsUsed.includes("web_search")) return "web_search"
  return "general"
}

export function extractBrandInfo(toolResults: ToolResultRecord[]): BrandProduct[] {
  const products: BrandProduct[] = []
  const seen = new Set<string>()

  for (const tr of toolResults) {
    try {
      const data = JSON.parse(tr.result)
      const addProduct = (p: { brand?: string; displayCode?: string; seriesName?: string | null }) => {
        if (p.brand && p.displayCode && !seen.has(p.displayCode)) {
          seen.add(p.displayCode)
          products.push({ brand: p.brand, displayCode: p.displayCode, seriesName: p.seriesName ?? null })
        }
      }

      if (data.products) data.products.forEach(addProduct)
      if (data.yg1Alternatives) data.yg1Alternatives.forEach(addProduct)
      if (data.matchedProduct) addProduct({ ...data.matchedProduct, brand: data.brand, seriesName: data.seriesName })
      if (data.brand && data.seriesName) addProduct(data)
    } catch {
      // Ignore parse errors from tool results.
    }
  }

  return products
}

export function injectBrandHeader(responseText: string, brandProducts: BrandProduct[]): string {
  if (brandProducts.length === 0) return responseText

  const hasBrandLabel = /\*\*브랜드명[::]\*\*/.test(responseText) || /브랜드명[::]\s*\S+/.test(responseText)
  if (hasBrandLabel) return responseText

  const header = brandProducts
    .slice(0, 3)
    .map(product => `**브랜드명:** ${product.brand} | **제품코드:** ${product.displayCode}`)
    .join("\n")

  return `${header}\n\n${responseText}`
}

export function extractReferences(toolResults: ToolResultRecord[]): string[] | null {
  const refs = new Set<string>()

  for (const tr of toolResults) {
    try {
      const data = JSON.parse(tr.result)
      if (data.products) {
        for (const product of data.products) {
          if (product.seriesName) refs.add(product.seriesName)
          else if (product.displayCode) refs.add(product.displayCode)
        }
      }
      if (data.displayCode) refs.add(data.displayCode)
      if (data.matchedProduct?.displayCode) refs.add(data.matchedProduct.displayCode)
      if (data.seriesName) refs.add(data.seriesName)
      if (data.yg1Alternatives) {
        for (const product of data.yg1Alternatives) {
          if (product.seriesName) refs.add(product.seriesName)
        }
      }
    } catch {
      // Ignore parse errors from tool results.
    }
  }

  return refs.size > 0 ? [...refs] : null
}

export function mockChatResponse(messages: ChatMessage[]): LLMResponse {
  const lastUserInput = [...messages].reverse().find(message => message.role === "user")?.text || ""
  const lower = lastUserInput.toLowerCase()

  if (/안녕|하이|hello|hi/i.test(lower)) {
    return {
      intent: "general",
      text: "안녕하세요! YG-1 AI 어시스턴트입니다. 절삭공구 추천, 코팅 설명, 가공 조건 문의 등 무엇이든 물어보세요!",
      chips: ["제품 추천 받기", "코팅 종류 알려줘", "알루미늄 가공 팁", "시리즈 검색"],
      isComplete: false,
    }
  }

  if (/코팅|tialn|alcrn|tin|dlc/i.test(lower)) {
    return {
      intent: "coating_material_qa",
      text: "YG-1의 주요 코팅으로는 TiAlN(고온 내마모), AlCrN(내열), Y-코팅(자체 개발), DLC(비철용) 등이 있습니다. 어떤 코팅이 궁금하신가요?",
      chips: ["TiAlN 상세", "알루미늄용 코팅", "스테인리스용 코팅", "코팅 비교"],
      isComplete: false,
    }
  }

  if (/조건|vc|fz|이송|회전/i.test(lower)) {
    return {
      intent: "cutting_condition",
      text: "절삭조건을 안내해드리려면 제품(시리즈)과 소재를 알려주세요. 카탈로그 데이터 기반으로 정확한 조건을 알려드립니다.",
      chips: ["SUS304 황삭", "알루미늄 고속", "탄소강 정삭"],
      isComplete: false,
    }
  }

  return {
    intent: "product_recommendation",
    text: "추가 정보가 필요합니다. 소재, 가공 조건 또는 직경을 알려주세요.",
    chips: ["스테인리스", "알루미늄", "탄소강", "고경도강"],
    extractedField: null,
    isComplete: false,
    recommendationIds: null,
  }
}

export function buildEmptyChatResponse(): LLMResponse {
  return {
    intent: "general",
    text: "안녕하세요! YG-1 AI 어시스턴트입니다. 무엇을 도와드릴까요?",
    chips: ["제품 추천", "절삭조건 문의", "코팅 비교"],
    isComplete: false,
  }
}
