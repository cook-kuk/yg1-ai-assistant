/**
 * Action Planner — Decides WHAT to do after inquiry analysis.
 *
 * Takes inquiry analysis + session state → produces an ActionPlan
 * that the route handler executes step by step.
 */

import type { InquiryAnalysis } from "./inquiry-analyzer"
import type { ExplorationSessionState } from "@/lib/types/exploration"
import type { ProductIntakeForm } from "@/lib/types/intake"

// ── Types ────────────────────────────────────────────────────

export type ActionIntent =
  | "product_recommendation"
  | "product_comparison"
  | "spec_lookup"
  | "catalog_search"
  | "cutting_condition_request"
  | "suitability_check"
  | "competitor_mapping"
  | "clarification_needed"
  | "greeting_or_smalltalk"
  | "nonsensical_or_low_signal"
  | "out_of_scope"
  | "forced_recommendation"  // user said "빨리", "그냥 줘" etc.
  | "general_answer"         // LLM should answer freely (general/off-domain/knowledge questions)

export type RetrievalStrategy =
  | "none"                    // no retrieval (greeting, nonsense)
  | "structured_filter"       // hard filter only
  | "hybrid"                  // filter + scoring
  | "comparison"              // two products side by side
  | "evidence_lookup"         // cutting conditions only

export type ResponseFormat =
  | "redirect"       // soft/hard redirect, no product data
  | "clarification"  // ask 1-2 questions
  | "shortlist"      // top 3-5 recommendations
  | "detail"         // single product detail
  | "comparison"     // side-by-side comparison
  | "condition"      // cutting condition answer
  | "chat"           // general conversation
  | "general_chat"   // LLM answers freely (no retrieval needed)

export interface ActionPlan {
  intent: ActionIntent
  intentConfidence: number  // 0-1

  retrievalStrategy: RetrievalStrategy
  responseFormat: ResponseFormat

  maxCandidatesToRetrieve: number   // internal cap
  maxCandidatesToDisplay: number    // UI cap

  shouldShowCandidateList: boolean
  shouldShowConditionChips: boolean
  shouldShowCandidateCount: boolean  // "n개 후보" 표시 여부

  factCheckRequired: boolean

  // For forced recommendation
  skipNarrowing: boolean

  reason: string
}

// ── Forced Recommendation Patterns ───────────────────────────

const FORCED_REC_PATTERNS = [
  "그냥 좋은 거", "좋은 거", "좋은거", "니가 알아서", "알아서 골라", "알아서 추천",
  "그냥 줘", "빨리", "빨리 줘", "걍 줘", "걍", "그냥",
  "무난한 거", "무난한거", "무난하게", "대충", "대충 추천",
  "많이 쓰는 거", "인기 있는", "베스트", "3개만", "세개만",
  "왜 자꾸 물어", "질문 그만", "그만 물어", "보여줘", "바로 보여",
  "추천해주세요", "바로 추천", "결과 보기", "추천 받기",
  // Chip-generated signals
  "대체 후보", "후보 보기", "개 보기",
]

const COMPLETION_PATTERNS = [
  "처음부터 다시", "다시 시작", "리셋",
]

// ── Main Planning Function ───────────────────────────────────

export function planAction(
  inquiry: InquiryAnalysis,
  message: string,
  form: ProductIntakeForm,
  sessionState: ExplorationSessionState | null,
): ActionPlan {
  const lower = message.trim().toLowerCase()

  // ── Gate 0: Reset ──
  if (COMPLETION_PATTERNS.some(p => lower.includes(p))) {
    return {
      intent: "product_recommendation",
      intentConfidence: 1.0,
      retrievalStrategy: "none",
      responseFormat: "redirect",
      maxCandidatesToRetrieve: 0,
      maxCandidatesToDisplay: 0,
      shouldShowCandidateList: false,
      shouldShowConditionChips: false,
      shouldShowCandidateCount: false,
      factCheckRequired: false,
      skipNarrowing: false,
      reason: "세션 리셋 요청",
    }
  }

  // ── Gate 1: Noise / Off-domain ──
  if (inquiry.signalStrength === "noise" || inquiry.domainRelevance === "off_domain") {
    const isGreeting = inquiry.inputForm === "smalltalk" && inquiry.seriousness !== "nonsense"
    const isGeneralQuestion = inquiry.suggestedAction === "answer_general"

    // True nonsense (ㅋㅋㅋ, etc.) → static redirect
    if (inquiry.seriousness === "nonsense" && !isGeneralQuestion) {
      return {
        intent: "nonsensical_or_low_signal",
        intentConfidence: 0.95,
        retrievalStrategy: "none",
        responseFormat: "redirect",
        maxCandidatesToRetrieve: 0,
        maxCandidatesToDisplay: 0,
        shouldShowCandidateList: false,
        shouldShowConditionChips: false,
        shouldShowCandidateCount: false,
        factCheckRequired: false,
        skipNarrowing: false,
        reason: inquiry.reason,
      }
    }

    // Greetings, off-domain questions, general questions → let LLM answer
    return {
      intent: isGreeting ? "greeting_or_smalltalk" : "general_answer",
      intentConfidence: 0.9,
      retrievalStrategy: "none",
      responseFormat: "general_chat",
      maxCandidatesToRetrieve: 0,
      maxCandidatesToDisplay: 0,
      shouldShowCandidateList: false,
      shouldShowConditionChips: false,
      shouldShowCandidateCount: false,
      factCheckRequired: false,
      skipNarrowing: false,
      reason: inquiry.reason,
    }
  }

  // ── Gate 1.5: General knowledge questions (on-domain/adjacent but no product retrieval needed) ──
  if (inquiry.suggestedAction === "answer_general") {
    return {
      intent: "general_answer",
      intentConfidence: 0.85,
      retrievalStrategy: "none",
      responseFormat: "general_chat",
      maxCandidatesToRetrieve: 0,
      maxCandidatesToDisplay: 0,
      shouldShowCandidateList: false,
      shouldShowConditionChips: false,
      shouldShowCandidateCount: false,
      factCheckRequired: false,
      skipNarrowing: false,
      reason: inquiry.reason,
    }
  }

  // ── Gate 2: Forced recommendation ──
  if (FORCED_REC_PATTERNS.some(p => lower.includes(p))) {
    return {
      intent: "forced_recommendation",
      intentConfidence: 0.9,
      retrievalStrategy: "hybrid",
      responseFormat: "shortlist",
      maxCandidatesToRetrieve: 50,
      maxCandidatesToDisplay: 5,
      shouldShowCandidateList: true,
      shouldShowConditionChips: false,
      shouldShowCandidateCount: false,
      factCheckRequired: true,
      skipNarrowing: true,
      reason: "강제 추천 요청 — 즉시 결과 표시",
    }
  }

  // ── Gate 3: Strong signal → direct retrieval ──
  if (inquiry.signalStrength === "strong") {
    return {
      intent: "product_recommendation",
      intentConfidence: 0.85,
      retrievalStrategy: "hybrid",
      responseFormat: "shortlist",
      maxCandidatesToRetrieve: 50,
      maxCandidatesToDisplay: 5,
      shouldShowCandidateList: true,
      shouldShowConditionChips: true,
      shouldShowCandidateCount: true,
      factCheckRequired: true,
      skipNarrowing: inquiry.extractedKeywordCount >= 3,
      reason: `강신호: ${inquiry.extractedKeywordCount}개 조건 감지`,
    }
  }

  // ── Gate 4: Moderate signal → retrieval with possible narrowing ──
  if (inquiry.signalStrength === "moderate") {
    const hasEnoughForRetrieval = inquiry.extractedKeywordCount >= 2
    return {
      intent: "product_recommendation",
      intentConfidence: 0.7,
      retrievalStrategy: "hybrid",
      responseFormat: hasEnoughForRetrieval ? "shortlist" : "clarification",
      maxCandidatesToRetrieve: 50,
      maxCandidatesToDisplay: hasEnoughForRetrieval ? 5 : 0,
      shouldShowCandidateList: hasEnoughForRetrieval,
      shouldShowConditionChips: true,
      shouldShowCandidateCount: hasEnoughForRetrieval,
      factCheckRequired: hasEnoughForRetrieval,
      skipNarrowing: false,
      reason: `중신호: ${inquiry.extractedKeywordCount}개 조건, ${hasEnoughForRetrieval ? "검색 진행" : "추가 질문 필요"}`,
    }
  }

  // ── Gate 5: Weak signal → clarification ──
  return {
    intent: inquiry.domainRelevance === "adjacent" ? "clarification_needed" : "out_of_scope",
    intentConfidence: 0.5,
    retrievalStrategy: "none",
    responseFormat: inquiry.domainRelevance === "adjacent" ? "clarification" : "redirect",
    maxCandidatesToRetrieve: 0,
    maxCandidatesToDisplay: 0,
    shouldShowCandidateList: false,
    shouldShowConditionChips: false,
    shouldShowCandidateCount: false,
    factCheckRequired: false,
    skipNarrowing: false,
    reason: `약신호: ${inquiry.reason}`,
  }
}
