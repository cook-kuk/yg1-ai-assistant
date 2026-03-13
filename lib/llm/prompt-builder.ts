/**
 * Prompt Builder — System / Session / Narrowing / Result prompts
 *
 * Separation:
 *   - System prompt: immutable rules (never changes per request)
 *   - Session context: dynamic (intake form + accumulated filters)
 *   - Narrowing prompt: question context for follow-up
 *   - Result prompt: evidence-grounded recommendation
 */

import type { RecommendationInput, ScoredProduct } from "@/lib/types/canonical"
import type { ProductIntakeForm, AnswerState, InquiryPurpose, MachiningIntent } from "@/lib/types/intake"
import type { EvidenceChunk, EvidenceSummary } from "@/lib/types/evidence"
import type { ExplorationSessionState, AppliedFilter, NarrowingTurn } from "@/lib/types/exploration"
import type { NextQuestion } from "@/lib/domain/question-engine"
import type { RequestPreparationResult } from "@/lib/types/request-preparation"
import type { RecommendationExplanation } from "@/lib/types/explanation"
import type { FactCheckedRecommendation } from "@/lib/types/fact-check"

// ── System Prompt (immutable) ────────────────────────────────
export function buildSystemPrompt(): string {
  return `You are a YG-1 cutting tool recommendation assistant. You speak Korean naturally and professionally.

CRITICAL RULES — violations are NEVER acceptable:
1. NEVER invent product codes, EDP numbers, series names, or specifications
2. NEVER generate cutting conditions (Vc, fz, ap, ae) — only cite from provided evidence
3. NEVER generate inventory quantities, lead times, or prices
4. NEVER say a product "exists" if it's not in the provided candidate data
5. If data is missing or unknown, say "정보 없음" — NEVER estimate or guess
6. Unknown is a valid state: "해당 정보가 없습니다" is always acceptable

RESPONSE FORMAT:
- Always respond in Korean
- Be concise: 1-3 sentences for questions, 2-4 sentences for recommendations
- When citing cutting conditions, always mention the source (페이지, 신뢰도)
- Clearly separate exact matches from approximate matches

RESPONSE MUST be valid JSON with this structure:
{
  "responseText": string,      // Korean natural language
  "extractedParams": {         // any new parameters extracted from user message
    "flutePreference": number | null,
    "coatingPreference": string | null,
    "operationType": string | null,
    "material": string | null,
    "diameterMm": number | null
  },
  "isComplete": boolean,       // true = user wants to see results now
  "skipQuestion": boolean      // true = user said "상관없음" or wants to skip
}`
}

// ── Session Context (dynamic per request) ────────────────────
export function buildSessionContext(
  intakeForm: ProductIntakeForm,
  sessionState: ExplorationSessionState | null,
  candidateCount: number
): string {
  const intakeSummary = buildIntakeSummaryText(intakeForm)
  const filterSummary = sessionState
    ? sessionState.appliedFilters.map(f => `  - ${f.field}: ${f.value}`).join("\n")
    : "(없음)"

  const histSummary = sessionState?.narrowingHistory?.length
    ? sessionState.narrowingHistory.map((h, i) =>
      `  Turn ${i + 1}: Q="${h.question}" → A="${h.answer}" (${h.candidateCountBefore}→${h.candidateCountAfter}개)`
    ).join("\n")
    : "(대화 시작)"

  return `
=== 현재 세션 컨텍스트 ===
[고객 초기 입력]
${intakeSummary}

[적용된 필터]
${filterSummary}

[축소 대화 이력]
${histSummary}

[현재 후보 수] ${candidateCount}개
[해결 상태] ${sessionState?.resolutionStatus ?? "broad"}
[턴 수] ${sessionState?.turnCount ?? 0}
`
}

// ── Narrowing Prompt ─────────────────────────────────────────
export function buildNarrowingPrompt(
  sessionContext: string,
  question: NextQuestion,
  userMessage: string
): string {
  return `${sessionContext}

=== 현재 질문 ===
시스템이 선택한 최적 질문: "${question.questionText}"
질문 필드: ${question.field}
제안 칩: [${question.chips.join(", ")}]
예상 정보 이득: ${(question.expectedInfoGain * 100).toFixed(0)}%

=== 고객 응답 ===
"${userMessage}"

위 응답에서 파라미터를 추출하고, 자연스러운 한국어로 다음 단계를 안내하세요.
고객이 "상관없음"이라고 하면 skipQuestion: true로 설정하세요.
고객이 "추천해주세요"라고 하면 isComplete: true로 설정하세요.`
}

// ── Greeting Prompt (first message after intake) ─────────────
export function buildGreetingPrompt(
  sessionContext: string,
  question: NextQuestion | null,
  candidateCount: number
): string {
  const questionPart = question
    ? `\n시스템이 선택한 첫 질문: "${question.questionText}"\n제안 칩: [${question.chips.join(", ")}]`
    : ""

  return `${sessionContext}
${questionPart}

고객이 초기 조건을 입력 완료했습니다.
1. 입력 조건을 간단히 확인 (1문장)
2. 현재 ${candidateCount}개 후보가 있다고 알림
3. ${question ? "첫 번째 추가 질문을 자연스럽게 질문" : "바로 추천을 진행할 수 있다고 안내"}

responseText에 자연스러운 한국어 인사+질문을 작성하세요.
isComplete: false로 설정하세요 (첫 턴에서는 항상).`
}

// ── Result Prompt (final recommendation with evidence) ───────
export function buildResultPrompt(
  sessionContext: string,
  primary: ScoredProduct,
  alternatives: ScoredProduct[],
  evidenceSummaries: EvidenceSummary[],
  warnings: string[]
): string {
  // Build evidence text
  const evidenceLines: string[] = []
  for (const es of evidenceSummaries) {
    if (es.bestCondition) {
      const c = es.bestCondition
      evidenceLines.push(
        `  [${es.productCode}] Vc=${c.Vc ?? "?"}, fz=${c.fz ?? "?"}, ap=${c.ap ?? "?"}, ae=${c.ae ?? "?"} (신뢰도: ${(es.bestConfidence * 100).toFixed(0)}%, ${es.sourceCount}건)`
      )
    }
  }

  return `${sessionContext}

=== 추천 결과 (데이터 전용) ===
[1순위] ${primary.product.displayCode} (${primary.product.seriesName ?? "?"})
  - 직경: ${primary.product.diameterMm ?? "?"}mm
  - 날 수: ${primary.product.fluteCount ?? "?"}
  - 코팅: ${primary.product.coating ?? "?"}
  - 소재 태그: ${primary.product.materialTags.join(", ") || "?"}
  - 매칭: ${primary.matchStatus} (점수: ${primary.score})
  - 재고: ${primary.stockStatus} (${primary.totalStock ?? "?"})
  - 납기: ${primary.minLeadTimeDays ?? "?"}일
  - 일치 항목: ${primary.matchedFields.join(", ") || "없음"}

${alternatives.length > 0 ? `[대안 ${alternatives.length}개]\n${alternatives.map((a, i) =>
    `  ${i + 2}. ${a.product.displayCode} (${a.product.seriesName ?? "?"}) - ${a.matchStatus}, 점수: ${a.score}`
  ).join("\n")}` : "[대안 없음]"}

[절삭조건 근거]
${evidenceLines.length > 0 ? evidenceLines.join("\n") : "  절삭조건 데이터 없음"}

[경고]
${warnings.length > 0 ? warnings.map(w => `  - ${w}`).join("\n") : "  없음"}

위 데이터를 기반으로 자연스러운 한국어 추천 요약을 작성하세요.
- 제품 코드, 스펙은 반드시 위 데이터에서만 인용
- 절삭조건이 있으면 반드시 포함하고 출처를 언급
- 데이터가 없는 항목은 "정보 없음"으로 표시
- isComplete: true로 설정하세요`
}

// ── Extraction-only Prompt (for parsing user answers) ────────
export function buildExtractionPrompt(
  userMessage: string,
  currentField: string
): string {
  return `사용자 메시지: "${userMessage}"

현재 질문 필드: ${currentField}

위 메시지에서 관련 파라미터를 추출하세요.
- "상관없음", "모름" → skipQuestion: true
- "추천해주세요", "바로 보여주세요" → isComplete: true
- 구체적 값이 있으면 해당 필드에 설정`
}

// ── Explanation-Aware Result Prompt ──────────────────────────
export function buildExplanationResultPrompt(
  sessionContext: string,
  factChecked: FactCheckedRecommendation,
  explanation: RecommendationExplanation,
  alternatives: { displayCode: string; matchStatus: string; score: number }[],
  warnings: string[]
): string {
  // Build matched facts text
  const matchedLines = explanation.matchedFacts.map(f =>
    `  ✓ ${f.label}: 요청=${f.requestedValue} → 제품=${f.productValue} (${f.matchType}, ${f.score}/${f.maxScore}pt)`
  )

  // Build unmatched facts text
  const unmatchedLines = explanation.unmatchedFacts.map(f =>
    `  ✗ ${f.label}: 요청=${f.requestedValue} → 제품=${f.productValue ?? "정보없음"} (${f.reason})`
  )

  // Build evidence text
  const evidenceLines = explanation.supportingEvidence.map(e =>
    `  [${e.type}] ${e.summary}`
  )

  // Fact check summary
  const fcReport = factChecked.factCheckReport
  const fcLines = fcReport.steps.map(s =>
    `  Step${s.step} ${s.label}: ${s.passed ? "✓" : "✗"} (${s.fieldsVerified}/${s.fieldsChecked} 확인)`
  )

  return `${sessionContext}

=== 추천 결과 (Fact-Checked) ===
[1순위] ${factChecked.displayCode.value} (${factChecked.seriesName.value ?? "?"})
  - 직경: ${factChecked.diameterMm.value ?? "정보없음"}mm [${factChecked.diameterMm.status}]
  - 날 수: ${factChecked.fluteCount.value ?? "정보없음"} [${factChecked.fluteCount.status}]
  - 코팅: ${factChecked.coating.value ?? "정보없음"} [${factChecked.coating.status}]
  - 소재태그: ${factChecked.materialTags.value.join(", ") || "정보없음"} [${factChecked.materialTags.status}]
  - 재고: ${factChecked.stockStatus.value} [${factChecked.stockStatus.status}]
  - 납기: ${factChecked.minLeadTimeDays.value ?? "정보없음"}일 [${factChecked.minLeadTimeDays.status}]

[매칭 근거]
${matchedLines.length > 0 ? matchedLines.join("\n") : "  (매칭 근거 없음)"}

[불일치 항목]
${unmatchedLines.length > 0 ? unmatchedLines.join("\n") : "  (불일치 없음)"}

[근거 자료]
${evidenceLines.length > 0 ? evidenceLines.join("\n") : "  (근거 자료 없음)"}

[Fact Check 결과] 검증률 ${fcReport.verificationPct}%
${fcLines.join("\n")}

${alternatives.length > 0 ? `[대안 ${alternatives.length}개]\n${alternatives.map((a, i) =>
  `  ${i + 2}. ${a.displayCode} - ${a.matchStatus}, 점수: ${a.score}`
).join("\n")}` : "[대안 없음]"}

[경고]
${warnings.length > 0 ? warnings.map(w => `  - ${w}`).join("\n") : "  없음"}

위 Fact-Checked 데이터를 기반으로 자연스러운 한국어 추천 요약을 작성하세요.
규칙:
1. 제품 코드, 스펙은 반드시 위 데이터에서만 인용 (절대 생성 금지)
2. [verified] 필드는 "확인됨"으로, [unverified]는 "미확인"으로 표시
3. 매칭 근거를 명시적으로 설명 (왜 이 제품인지)
4. 절삭조건이 있으면 반드시 포함하고 출처를 언급
5. 데이터가 없는 항목은 "정보 없음"으로 표시
6. isComplete: true로 설정하세요`
}

// ── Intent Summary for Session Context ──────────────────────
export function buildIntentContext(prep: RequestPreparationResult): string {
  const intentLabels: Record<string, string> = {
    product_recommendation: "제품 추천",
    substitute_search: "대체품 검색",
    cutting_condition_query: "절삭조건 문의",
    product_lookup: "제품 정보 조회",
    narrowing_answer: "축소 질문 응답",
    refinement: "조건 변경",
    general_question: "일반 문의",
  }

  const slotSummary = prep.slots.length > 0
    ? prep.slots.map(s => `${s.field}=${s.value} (${s.confidence})`).join(", ")
    : "(슬롯 없음)"

  return `[의도 분석] ${intentLabels[prep.intent] ?? prep.intent} (신뢰도: ${prep.intentConfidence})
[추출된 슬롯] ${slotSummary}
[완성도] ${prep.completeness.completionPct}% (필수: ${prep.completeness.answeredSlots.length}/${prep.completeness.answeredSlots.length + prep.completeness.missingSlots.length})
[라우트] ${prep.route.action} — ${prep.route.reason}
${prep.route.riskFlags.length > 0 ? `[위험 플래그] ${prep.route.riskFlags.join(", ")}` : ""}`
}

// ── Helper: Intake form → text summary ───────────────────────
function buildIntakeSummaryText(form: ProductIntakeForm): string {
  const purposeMap: Record<InquiryPurpose, string> = {
    new: "신규 제품 추천",
    substitute: "YG-1 대체품 찾기",
    inventory_substitute: "재고 없는 대체품",
    cutting_condition: "가공조건 참고",
    product_lookup: "현재 제품 정보 확인",
  }
  const intentMap: Record<MachiningIntent, string> = {
    roughing: "황삭",
    semi: "중삭",
    finishing: "정삭",
  }

  const f = (s: AnswerState<string>, map?: Record<string, string>) => {
    if (s.status === "unknown") return "모름"
    if (s.status === "unanswered") return "미입력"
    const v = (s as { status: "known"; value: string }).value
    return map ? (map[v] ?? v) : v
  }

  return [
    `  문의 목적: ${f(form.inquiryPurpose as AnswerState<string>, purposeMap as Record<string, string>)}`,
    `  소재: ${f(form.material)}`,
    `  가공 형상: ${f(form.operationType)}`,
    `  가공 성격: ${f(form.machiningIntent as AnswerState<string>, intentMap as Record<string, string>)}`,
    `  공구 타입: ${f(form.toolTypeOrCurrentProduct)}`,
    `  직경: ${f(form.diameterInfo)}`,
  ].join("\n")
}
