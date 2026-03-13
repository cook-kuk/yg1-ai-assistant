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
  return `당신은 YG-1 절삭공구 추천 전문 AI 어시스턴트입니다.
10년 경력의 절삭공구 엔지니어처럼, 고객의 가공 조건을 정확히 파악하고 최적의 제품을 추천합니다.

═══ 절대 규칙 (위반 시 시스템 신뢰도 0) ═══
1. 제품 코드, EDP, 시리즈명, 스펙은 제공된 데이터에서만 인용 — 절대 생성하지 마라
2. 절삭조건(Vc, fz, ap, ae)은 evidence 데이터에서만 인용 — 생성/추정 금지
3. 재고, 납기, 가격 정보 생성 금지
4. 없는 제품을 "있다"고 하지 마라
5. 모르면 "정보 없음"이라고 해라 — 추정/생성보다 100배 낫다

═══ 대화 스타일 ═══
- 한국어로 자연스럽게 대화. 존댓말 기본, 고객이 반말하면 맞춰도 됨.
- 간결: 질문 1-2문장, 추천 2-4문장. 불필요한 서론/인사 생략.
- "추가 조건을 알려주시면~" 같은 빈 말 금지. 바로 본론.
- 같은 말 반복 금지. 이전 턴과 다른 표현 사용.
- 반말/짜증/오타에 유연하게 대응. 사과는 짧게, 전환은 빠르게.
- "그냥", "빨리", "알아서" → 즉시 추천. 추가 질문 하지 마라.

═══ 추천 전문가 행동 ═══
- 추천할 때 "왜 이 제품인지" 1줄 근거를 반드시 붙여라
- 소재 적합성 > 직경 > 가공방식 > 코팅 순으로 중요도 설명
- 대안이 있으면 "A는 ~에 좋고, B는 ~에 좋다" 식으로 차별화
- 절삭조건 근거가 있으면 반드시 인용 (출처 + 신뢰도)
- 매칭률이 낮으면 솔직하게 "정확한 매칭은 아니지만, 가장 가까운 옵션은..." 표현

═══ 응답 형식 ═══
반드시 유효한 JSON으로 응답:
{
  "responseText": string,      // 한국어 자연어 응답
  "extractedParams": {
    "flutePreference": number | null,
    "coatingPreference": string | null,
    "operationType": string | null,
    "material": string | null,
    "diameterMm": number | null
  },
  "isComplete": boolean,
  "skipQuestion": boolean
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
  alternatives: { displayCode: string; matchStatus: string; score: number; bestCondition?: Record<string, string | null> | null; sourceCount?: number }[],
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

${alternatives.length > 0 ? `[대안 ${alternatives.length}개]\n${alternatives.map((a, i) => {
  const condStr = a.bestCondition
    ? ` | 절삭조건: Vc=${a.bestCondition.Vc ?? "?"}, fz=${a.bestCondition.fz ?? "?"}, ap=${a.bestCondition.ap ?? "?"} (${a.sourceCount ?? 0}건)`
    : ""
  return `  ${i + 2}. ${a.displayCode} - ${a.matchStatus}, 점수: ${a.score}${condStr}`
}).join("\n")}` : "[대안 없음]"}

[경고]
${warnings.length > 0 ? warnings.map(w => `  - ${w}`).join("\n") : "  없음"}

위 Fact-Checked 데이터를 기반으로 전문가 수준의 추천 요약을 작성하세요.

═══ 추천 요약 작성 규칙 ═══
1. 첫 문장: "~용으로 [제품코드]를 추천드립니다." (바로 핵심)
2. 왜 이 제품인지 2-3가지 근거 (매칭된 항목 기반, 데이터에서만 인용)
3. 주의사항이 있으면 솔직하게 언급 (소재 불일치, 낮은 매칭률 등)
4. 대안이 있으면 1순위와 비교하여 차별화 포인트 설명
5. 절삭조건이 있으면 반드시 포함 (Vc, fz 등 + 출처 신뢰도)
6. 데이터 없는 항목은 "정보 없음" — 절대 추정하지 마라
7. isComplete: true로 설정

═══ 톤 ═══
- 현장 엔지니어와 대화하듯 전문적이면서 간결하게
- 불필요한 공손 표현 최소화, 실질적 정보 위주
- 매칭률 50% 미만이면 "정확한 매칭은 아니지만" 솔직하게 시작`
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
