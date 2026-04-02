import {
  buildDeterministicSummary,
  buildRationale,
  buildWarnings,
  classifyHybridResults,
  normalizeInput,
  runHybridRetrieval,
} from "@/lib/recommendation/domain/recommendation-domain"

import type { buildRecommendationResponseDto } from "@/lib/recommendation/infrastructure/presenters/recommendation-presenter"
import type { ChatMessage, RecommendationInput, RecommendationResult } from "@/lib/recommendation/domain/types"

type JsonRecommendationResponse = (
  params: Parameters<typeof buildRecommendationResponseDto>[0],
  init?: ResponseInit
) => Response

export interface ServeEngineSimpleChatDependencies {
  jsonRecommendationResponse: JsonRecommendationResponse
  getFollowUpChips: (result: RecommendationResult) => string[]
  buildSourceSummary: (primary: { product: { rawSourceFile: string; rawSourceSheet?: string | null; sourceConfidence?: string | null } } | null) => string[]
  handleDirectProductInfoQuestion?: (
    userMessage: string,
    currentInput: RecommendationInput,
    prevState: null
  ) => Promise<{ text: string; chips: string[] } | null>
  handleDirectEntityProfileQuestion: (
    userMessage: string,
    currentInput: RecommendationInput,
    prevState: null
  ) => Promise<{ text: string; chips: string[] } | null>
  handleDirectBrandReferenceQuestion: (
    userMessage: string,
    currentInput: RecommendationInput,
    prevState: null
  ) => Promise<{ text: string; chips: string[] } | null>
  handleCompetitorCrossReference?: (
    userMessage: string,
    prevState: null,
  ) => Promise<{ text: string; chips: string[] } | null>
}

export async function handleServeSimpleChat(
  deps: ServeEngineSimpleChatDependencies,
  messages: ChatMessage[],
  _mode: string
): Promise<Response> {
  try {
  if (!messages.length) {
    return deps.jsonRecommendationResponse({
      error: "bad_request",
      detail: "messages required",
      text: "메시지가 필요합니다.",
      purpose: "question",
      chips: [],
      isComplete: false,
      recommendation: null,
      sessionState: null,
      evidenceSummaries: null,
      candidateSnapshot: null,
    }, { status: 400 })
  }

  const latestUserMsg = [...messages].reverse().find(message => message.role === "user")?.text ?? ""
  const baseInput = normalizeInput(latestUserMsg)
  const productInfoReply = await deps.handleDirectProductInfoQuestion?.(latestUserMsg, baseInput, null)
  if (productInfoReply) {
    return deps.jsonRecommendationResponse({
      text: productInfoReply.text,
      purpose: "general_chat",
      chips: productInfoReply.chips,
      isComplete: false,
      recommendation: null,
      sessionState: null,
      evidenceSummaries: null,
      candidateSnapshot: null,
    })
  }

  const entityProfileReply = await deps.handleDirectEntityProfileQuestion(latestUserMsg, baseInput, null)
  if (entityProfileReply) {
    return deps.jsonRecommendationResponse({
      text: entityProfileReply.text,
      purpose: "general_chat",
      chips: entityProfileReply.chips,
      isComplete: false,
      recommendation: null,
      sessionState: null,
      evidenceSummaries: null,
      candidateSnapshot: null,
    })
  }

  const brandReferenceReply = await deps.handleDirectBrandReferenceQuestion(latestUserMsg, baseInput, null)
  if (brandReferenceReply) {
    return deps.jsonRecommendationResponse({
      text: brandReferenceReply.text,
      purpose: "general_chat",
      chips: brandReferenceReply.chips,
      isComplete: false,
      recommendation: null,
      sessionState: null,
      evidenceSummaries: null,
      candidateSnapshot: null,
    })
  }

  // Competitor cross-reference
  if (deps.handleCompetitorCrossReference) {
    const competitorReply = await deps.handleCompetitorCrossReference(latestUserMsg, null)
    if (competitorReply) {
      return deps.jsonRecommendationResponse({
        text: competitorReply.text,
        purpose: "general_chat",
        chips: competitorReply.chips,
        isComplete: false,
        recommendation: null,
        sessionState: null,
        evidenceSummaries: null,
        candidateSnapshot: null,
      })
    }
  }

  const hasEnough = !!(baseInput.diameterMm || (baseInput.material && baseInput.operationType))
  if (hasEnough) {
    const result = await runHybridRetrieval(baseInput, [], 5)
    const { primary, alternatives, status } = classifyHybridResults(result)
    const warnings = primary ? buildWarnings(primary, baseInput) : []
    const rationale = primary ? buildRationale(primary, baseInput) : []

    const deterministicSummary = buildDeterministicSummary({
      status,
      query: baseInput,
      primaryProduct: primary,
      alternatives,
      warnings,
      rationale,
      sourceSummary: [],
      deterministicSummary: "",
      llmSummary: null,
      totalCandidatesConsidered: result.totalConsidered,
    })

    const recommendation: RecommendationResult = {
      status,
      query: baseInput,
      primaryProduct: primary,
      alternatives,
      warnings,
      rationale,
      sourceSummary: primary ? deps.buildSourceSummary(primary) : [],
      deterministicSummary,
      llmSummary: null,
      totalCandidatesConsidered: result.totalConsidered,
    }

    let quickText = deterministicSummary
    if (primary?.product.brand) {
      const brandName = primary.product.brand
      const hasBrand = quickText.includes(brandName) || /브랜드명/.test(quickText)
      if (!hasBrand) {
        quickText = `**브랜드명:** ${brandName} | **제품코드:** ${primary.product.displayCode}\n\n${quickText}`
      }
    }

    return deps.jsonRecommendationResponse({
      text: quickText,
      purpose: "recommendation",
      chips: deps.getFollowUpChips(recommendation),
      isComplete: true,
      recommendation,
      sessionState: null,
      evidenceSummaries: null,
      candidateSnapshot: null,
    })
  }

  return deps.jsonRecommendationResponse({
    text: getNextQuestion(baseInput),
    purpose: "question",
    chips: getDefaultChips(baseInput),
    isComplete: false,
    recommendation: null,
    sessionState: null,
    evidenceSummaries: null,
    candidateSnapshot: null,
  })
  } catch (error) {
    console.error("[simple-chat] Error:", error)
    return deps.jsonRecommendationResponse({
      text: "일시적인 오류가 발생했습니다. 다시 시도해주세요.",
      purpose: "question",
      chips: ["처음부터 다시"],
      isComplete: false,
      recommendation: null,
      sessionState: null,
      evidenceSummaries: null,
      candidateSnapshot: null,
    })
  }
}

function getNextQuestion(input: RecommendationInput): string {
  if (!input.material) return "어떤 소재를 가공할 예정인가요?"
  if (!input.operationType) return "어떤 가공 방식이 필요하신가요? (측삭/황삭/고이송 등)"
  if (!input.diameterMm) return "공구 직경은 몇 mm가 필요하신가요?"
  if (!input.flutePreference) return "날 수(flute) 선호가 있으신가요?"
  return "추가로 확인이 필요한 조건이 있으신가요?"
}

function getDefaultChips(input: RecommendationInput): string[] {
  if (!input.material) return ["알루미늄", "스테인리스", "탄소강", "주철", "티타늄", "고경도강"]
  if (!input.operationType) return ["측삭", "황삭", "고이송", "홈가공", "측면가공"]
  if (!input.diameterMm) return ["2mm", "4mm", "6mm", "8mm", "10mm", "12mm"]
  if (!input.flutePreference) return ["2날", "3날", "4날", "6날", "상관없음"]
  return ["추천 받기", "다른 조건으로", "경쟁품 비교"]
}
