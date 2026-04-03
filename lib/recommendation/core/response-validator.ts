import type { LlmTurnDecision } from "./types"

interface ValidatedDisplayedOption {
  index: number
  label: string
  field?: string
  value?: string
  count: number
}

export interface ValidationResult {
  answer: string
  displayedOptions: ValidatedDisplayedOption[]
  chips: string[]
  valid: boolean
  warnings: string[]
  rewrites: string[]
}

function normalizeDisplayedOptions(displayedOptions: any[]): ValidatedDisplayedOption[] {
  return displayedOptions
    .filter(option => typeof option?.label === "string" && option.label.trim().length > 0)
    .map((option, index) => ({
      index: typeof option.index === "number" ? option.index : index + 1,
      label: option.label,
      field: typeof option.field === "string" ? option.field : undefined,
      value: typeof option.value === "string" ? option.value : undefined,
      count: typeof option.count === "number" ? option.count : 0,
    }))
}

export function validateSurfaceV2(
  surface: { answer: string; displayedOptions: any[]; chips: string[] },
  decision: LlmTurnDecision,
  hasGroundedFacts: boolean
): ValidationResult {
  const warnings: string[] = []
  const rewrites: string[] = []
  let { answer, chips } = surface
  let displayedOptions = normalizeDisplayedOptions(surface.displayedOptions)

  // 1. Field consistency check
  if (decision.nextQuestion?.field && displayedOptions.length > 0) {
    const wrongFieldOptions = displayedOptions.filter(
      opt => opt.field && opt.field !== decision.nextQuestion!.field && opt.field !== "_action" && opt.field !== "_control"
    )
    if (wrongFieldOptions.length > 0) {
      warnings.push(`Field mismatch: question=${decision.nextQuestion.field}, options have ${wrongFieldOptions[0].field}`)
      displayedOptions = displayedOptions.filter(
        opt => !opt.field || opt.field === decision.nextQuestion!.field || opt.field === "_action" || opt.field === "_control"
      )
      chips = displayedOptions.map(opt => opt.label)
      rewrites.push("removed_stale_field_options")
    }
  }

  // 2. Empty chips safety
  if (chips.length === 0 && displayedOptions.length === 0 && decision.uiPlan.optionMode !== "none") {
    // No options but mode expects them — add minimal fallback
    displayedOptions = [
      { index: 1, label: "처음부터 다시", field: "_action", value: "_reset", count: 0 }
    ]
    chips = ["처음부터 다시"]
    rewrites.push("added_fallback_chips")
  }

  // 2b. Deduplicate chips (LLM sometimes generates near-duplicates)
  if (chips.length > 0) {
    const seen = new Set<string>()
    const dedupedOptions: typeof displayedOptions = []
    for (const opt of displayedOptions) {
      const normalized = opt.label.replace(/\s+/g, "").toLowerCase()
      if (!seen.has(normalized)) {
        seen.add(normalized)
        dedupedOptions.push(opt)
      }
    }
    if (dedupedOptions.length < displayedOptions.length) {
      displayedOptions = dedupedOptions
      chips = displayedOptions.map(opt => opt.label)
      rewrites.push("deduped_llm_chips")
    }
  }

  // 3. Company info leakage check
  const isRecommendationTopic = ["narrowing", "refinement", "recommendation", "comparison"].includes(decision.answerIntent.topic)
  if (isRecommendationTopic) {
    const companyLeakage = /수상|연혁|설립|주주|버핏|회장|사장|매출|영업이익/i.test(answer)
    if (companyLeakage) {
      warnings.push("Company info leakage in recommendation answer")
      // Don't rewrite — just warn for now
    }
  }

  // 4. Unsupported fact check
  if (decision.answerIntent.needsGroundedFact && !hasGroundedFacts) {
    // Replace definitive claims with uncertainty
    const definitivePatterns = /(?:있습니다|맞습니다|입니다)(?=\s*[.\n])/g
    if (definitivePatterns.test(answer)) {
      answer = answer + "\n\n※ 위 정보는 확인된 근거 없이 생성된 내용입니다. 정확한 정보는 YG-1 본사(032-526-0909)에 문의하세요."
      rewrites.push("added_ungrounded_disclaimer")
    }
  }

  // 5. Fake citation check
  const fakeCitations = /공식 정보 기반 AI 추론|공개 정보 참고|AI 지식 추론/gi
  if (fakeCitations.test(answer)) {
    answer = answer.replace(fakeCitations, "")
    rewrites.push("removed_fake_citations")
  }

  // 6. Price/availability/spec hallucination guard
  // LLM이 DB에 없는 가격, 납기, 경도 등을 생성하면 경고 면책 추가
  if (isRecommendationTopic) {
    const pricePattern = /(\d[\d,]*)\s*원|가격[은는이가]?\s*\d|단가[은는이가]?\s*\d|비용[은는이가]?\s*\d/
    const availPattern = /즉시\s*출고|바로\s*배송|당일\s*(출고|배송)|내일\s*(출고|배송)/
    const unverifiedSpecPattern = /경도[은는이가]?\s*H[Rr][Cc]\s*\d|인장강도[은는이가]?\s*\d|토크[은는이가]?\s*\d/

    if (pricePattern.test(answer)) {
      answer = answer + "\n\n※ 가격 정보는 AI가 생성한 것으로, 정확한 가격은 YG-1 본사(032-526-0909)에 문의하세요."
      warnings.push("Price hallucination detected in answer")
      rewrites.push("added_price_disclaimer")
    }
    if (availPattern.test(answer)) {
      answer = answer + "\n\n※ 출고/배송 정보는 실시간 재고와 다를 수 있습니다. 정확한 납기는 별도 확인이 필요합니다."
      warnings.push("Availability hallucination detected in answer")
      rewrites.push("added_availability_disclaimer")
    }
    if (unverifiedSpecPattern.test(answer)) {
      answer = answer + "\n\n※ 위 기술 스펙은 AI 추론입니다. 정확한 수치는 카탈로그를 확인하세요."
      warnings.push("Unverified spec claim detected in answer")
      rewrites.push("added_spec_disclaimer")
    }
  }

  return {
    answer: answer.trim(),
    displayedOptions,
    chips,
    valid: warnings.length === 0 && rewrites.length === 0,
    warnings,
    rewrites,
  }
}
