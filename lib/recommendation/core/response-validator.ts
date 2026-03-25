import type { LlmTurnDecision } from "./types"

export interface ValidationResult {
  answer: string
  displayedOptions: Array<{ label: string; field?: string; value?: string }>
  chips: string[]
  valid: boolean
  warnings: string[]
  rewrites: string[]
}

export function validateSurfaceV2(
  surface: { answer: string; displayedOptions: any[]; chips: string[] },
  decision: LlmTurnDecision,
  hasGroundedFacts: boolean
): ValidationResult {
  const warnings: string[] = []
  const rewrites: string[] = []
  let { answer, displayedOptions, chips } = surface

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
      { label: "처음부터 다시", field: "_action", value: "_reset" }
    ]
    chips = ["처음부터 다시"]
    rewrites.push("added_fallback_chips")
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

  return {
    answer: answer.trim(),
    displayedOptions,
    chips,
    valid: warnings.length === 0 && rewrites.length === 0,
    warnings,
    rewrites,
  }
}
