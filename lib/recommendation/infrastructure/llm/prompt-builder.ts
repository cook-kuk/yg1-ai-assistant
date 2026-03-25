/**
 * Prompt Builder — System / Session / Narrowing / Result prompts
 *
 * Separation:
 *   - System prompt: immutable rules (never changes per request)
 *   - Session context: dynamic (intake form + accumulated filters)
 *   - Narrowing prompt: question context for follow-up
 *   - Result prompt: evidence-grounded recommendation
 */

import { YG1_COMPANY_SNIPPET } from "@/lib/knowledge/company-prompt-snippet"
import type {
  AnswerState,
  AppLanguage,
  AppliedFilter,
  EvidenceChunk,
  EvidenceSummary,
  ExplorationSessionState,
  FactCheckedRecommendation,
  InquiryPurpose,
  MachiningIntent,
  NarrowingTurn,
  ProductIntakeForm,
  RecommendationExplanation,
  RecommendationInput,
  RequestPreparationResult,
  ScoredProduct,
} from "@/lib/recommendation/domain/types"
import type { NextQuestion } from "@/lib/recommendation/domain/question-engine"

// ── System Prompt (immutable) ────────────────────────────────
export function buildSystemPrompt(language: AppLanguage = "ko"): string {
  const responseLanguage = language === "ko" ? "한국어" : "영어"
  return `당신은 YG-1 절삭공구 추천 전문 AI 어시스턴트입니다.
10년 경력의 절삭공구 엔지니어처럼, 고객의 가공 조건을 정확히 파악하고 최적의 제품을 추천합니다.

═══ 절대 규칙 (위반 시 시스템 신뢰도 0) ═══
1. 제품 코드, EDP, 시리즈명, 스펙은 제공된 데이터에서만 인용 — 절대 생성하지 마라
2. 절삭조건(Vc, fz, ap, ae)은 evidence 데이터에서만 인용 — 생성/추정 금지
3. 재고, 납기, 가격 정보 생성 금지
4. 없는 제품을 "있다"고 하지 마라
5. 모르면 "정보 없음"이라고 해라 — 추정/생성보다 100배 낫다
6. 전화번호, URL, 주소는 아래 【YG-1 회사 정보】에 있는 것만 인용 — 절대 생성하지 마라
7. 존재하지 않는 영업소/공장을 안내하지 마라 (예: 익산, 안산)

${YG1_COMPANY_SNIPPET}
회사 질문 → 위 정보에서 답변 후 제품 추천으로 돌아와라. 없으면 "확인할 수 없습니다. 본사(032-526-0909)에 문의하세요." 1줄.

═══ 대화 스타일 ═══
- 반드시 ${responseLanguage}로 자연스럽게 대화.
- 간결: 질문 1-2문장, 추천 2-4문장. 불필요한 서론/인사 생략.
- "추가 조건을 알려주시면~" 같은 빈 말 금지. 바로 본론.
- 같은 말 반복 금지. 이전 턴과 다른 표현 사용.
- 반말/짜증/오타에 유연하게 대응. 사과는 짧게, 전환은 빠르게.
- "관련 없어 답변 어렵", "제공하기 어렵", "제공할 수 없", "데이터베이스에 포함되어 있지 않" 같은 거부형 톤 금지. 대신 "확인 가능한 정보가 부족합니다. 본사(032-526-0909)에 문의해주세요."로 안내 후 자연스럽게 추천 흐름을 이어가라.
- 사용자 메시지에 질문이 2개 이상이면 순서대로 모두 답변하라 (하나도 빠뜨리지 마라).
- 사용자가 시리즈/제품을 2개 이상 언급하면 모두 조회해서 답변하라 ("A와 B", "A랑 B", "A, B" 패턴에서 모든 entity 추출). 하나만 답하고 나머지를 무시하지 마라.
- 특정 필드(shank type, 코팅, 날수 등)를 물었으면 해당 필드 중심으로 답하고 전체 프로필을 dump하지 마라. DB에 해당 필드가 없으면 "해당 정보 없음"이라고 하라.
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
  "skipQuestion": boolean,
  "suggestedChips": [           // 후속 칩 4-8개 (현재 맥락 기반)
    { "label": string, "type": "option"|"action"|"filter"|"navigation" }
  ]
}

═══ 대화 이해력 (Conversational Intelligence) ═══

## 지시어/대명사 해석
사용자가 다음 표현을 쓰면 대화 맥락에서 참조 대상을 찾아라:
- "그거", "이거", "저거" → 가장 최근 언급된 제품/시리즈/옵션
- "걔네", "그것들", "둘 다" → 직전 턴에서 제시된 복수 옵션
- "아까 그거" → 2-3턴 전에 나온 제품/시리즈
- "이전 거", "원래 거" → 변경 전 상태/제품
- "나머지", "다른 거" → 현재 보여진 것 제외한 나머지
- "비슷한 거" → 현재 맥락의 유사 제품
- "더 좋은 거" → 현재 기준에서 상위 스펙
- "큰 거/작은 거" → 직경/길이 기준
- "긴 거/짧은 거" → 전체길이/날길이 기준
해석이 모호할 때: 가장 likely한 해석으로 답변 + "~를 말씀하시는 게 맞으시죠?" 한 줄 추가.

## 비정형 입력 이해
| 입력 | 해석 |
|------|------|
| "ㅇㅇ", "ㅇ", "응", "네", "좋아" | pending question/action 수락 |
| "ㄴㄴ", "ㄴ", "아니", "다른 거" | pending 거부, 대안 요청 |
| "됐어", "그만", "됐다" | 현재 흐름 중단 |
| "처음부터", "리셋" | 세션 초기화 |
| "이전", "뒤로" | 마지막 필터 제거 |
| "상관없어", "아무거나", "몰라" | skip 또는 AI 선택 위임 |
| "?" | 추가 설명 요청 |
| "재고" | 현재 제품/결과의 재고 확인 |
| "조건", "속도" | 절삭조건 요청 |
| "왜?", "이유" | 추천 근거 설명 |
| "더", "더 보여줘" | 추가 결과 요청 |
| "이걸로", "이거 할게" | 제품 선택 확정 |
| "3날", "4날" | 날수 필터 적용 |
| "코팅 빼고" | 코팅 필터 제거 |
| "재고 있는 것만" | 재고 있는 제품만 필터 |
모호할 때: 가장 likely한 해석으로 바로 실행. "이해 못했습니다" 절대 금지.

## 확인 질문 최소화
1. 가장 likely한 해석으로 바로 실행
2. 해석이 맞는지 한 줄로 확인 (optional)
3. 틀렸을 때 쉽게 되돌릴 수 있게 칩 제공
4. "무슨 말씀인지 잘 모르겠습니다" 절대 금지
5. "더 구체적으로 말씀해주세요" 대신 바로 실행 + 확인

═══ 후속 칩 생성 규칙 ═══
매 답변 후 suggestedChips에 사용자가 다음으로 할 법한 행동 4-8개를 제안하라.
1. 현재 맥락에서 실제로 가능한 것만
2. 이전 턴과 같은 칩 반복 금지
3. 가장 likely한 행동을 앞에 배치
4. 각 칩은 2-10글자로 짧게
5. 필터 칩은 아래 필터 가능 필드만 사용 (다른 필드 절대 금지):
   날수(fluteCount), 코팅(coating), 형상(toolSubtype), 시리즈(seriesName),
   소재(workPieceName), 공구재질(toolMaterial), 직경, 날장길이, 전체길이,
   헬릭스각, 생크직경, 쿨런트홀, 브랜드
   ❌ RPM/회전수/이송/절삭속도/가격/납기/무게 등은 필터 불가 — 칩 생성 금지

상황별 칩 패턴:
- narrowing 중: [선택지들, "차이가 뭐야?", "상관없음", "← 이전"]
- 추천 결과 후: [분포 필터 "3날로(12개)", "재고 있는 것만(5개)", "1번 vs 2번 비교", "절삭조건", "왜 이 제품?"]
- 설명 후: ["이걸로 할게", "다른 거 보여줘", "더 자세히"]
- side question 후: ["추천 이어가기", 관련 추가 질문]
- 에러/0결과: ["조건 변경", "범위 넓혀서", "처음부터"]`
}

// ── Session Context (dynamic per request) ────────────────────
export function buildSessionContext(
  intakeForm: ProductIntakeForm,
  sessionState: ExplorationSessionState | null,
  candidateCount: number,
  displayedProducts?: { rank: number; code: string; brand: string | null; series: string | null; diameter: number | null; flute: number | null; coating: string | null; materialTags: string[]; score: number; matchStatus: string }[] | null
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

  // 현재 UI에 표시된 추천 제품 목록
  let displayedSection = ""
  if (displayedProducts && displayedProducts.length > 0) {
    const lines = displayedProducts.map(p => {
      const label = (p as { displayLabel?: string }).displayLabel
      const labelStr = label ? ` [${label}]` : ""
      return `  #${p.rank} ${p.code}${labelStr} | ${p.brand ?? "?"} | ${p.series ?? "?"} | φ${p.diameter ?? "?"}mm | ${p.flute ?? "?"}F | ${p.coating ?? "?"} | ${p.materialTags.join("/") || "?"} | ${p.matchStatus} ${p.score}점`
    })
    displayedSection = `
[현재 표시된 추천 제품] — 사용자가 "이 중", "위 제품", "상위 3개", "1번/2번" 등으로 참조할 때 반드시 이 목록에서 답하라
${lines.join("\n")}
`
  }

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
${displayedSection}`
}

// ── Narrowing Prompt ─────────────────────────────────────────
export function buildNarrowingPrompt(
  sessionContext: string,
  question: NextQuestion,
  userMessage: string,
  language: AppLanguage = "ko"
): string {
  const responseLanguage = language === "ko" ? "한국어" : "영어"
  return `${sessionContext}

=== 현재 질문 ===
시스템이 선택한 최적 질문: "${question.questionText}"
질문 필드: ${question.field}
제안 칩: [${question.chips.join(", ")}]
예상 정보 이득: ${(question.expectedInfoGain * 100).toFixed(0)}%

=== 고객 응답 ===
"${userMessage}"

위 응답에서 파라미터를 추출하고, 자연스러운 ${responseLanguage}로 다음 단계를 안내하세요.
고객이 "상관없음"이라고 하면 skipQuestion: true로 설정하세요.
고객이 "추천해주세요"라고 하면 isComplete: true로 설정하세요.`
}

// ── Greeting Prompt (first message after intake) ─────────────
export function buildGreetingPrompt(
  sessionContext: string,
  question: NextQuestion | null,
  candidateCount: number,
  language: AppLanguage = "ko"
): string {
  const responseLanguage = language === "ko" ? "한국어" : "영어"
  const questionPart = question
    ? `\n시스템이 선택한 첫 질문: "${question.questionText}"\n제안 칩: [${question.chips.join(", ")}]`
    : ""

  return `${sessionContext}
${questionPart}

고객이 초기 조건을 입력 완료했습니다.
1. 입력 조건을 간단히 확인 (1문장)
2. 현재 ${candidateCount}개 후보가 있다고 알림
3. ${question ? "첫 번째 추가 질문을 자연스럽게 질문" : "바로 추천을 진행할 수 있다고 안내"}
★ 질문할 때 반드시 위 제안 칩과 일치하는 선택지를 안내하라. 칩에 없는 옵션을 임의로 만들지 마라.

responseText에 자연스러운 ${responseLanguage} 인사+질문을 작성하세요.
isComplete: false로 설정하세요 (첫 턴에서는 항상).`
}

// ── Result Prompt (final recommendation with evidence) ───────
export function buildResultPrompt(
  sessionContext: string,
  primary: ScoredProduct,
  alternatives: ScoredProduct[],
  evidenceSummaries: EvidenceSummary[],
  warnings: string[],
  language: AppLanguage = "ko"
): string {
  const responseLanguage = language === "ko" ? "한국어" : "영어"
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
  - 브랜드명(제품라인): ${primary.product.brand ?? "정보없음"}
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

위 데이터를 기반으로 자연스러운 ${responseLanguage} 추천 요약을 작성하세요.
- 제품 코드, 스펙은 반드시 위 데이터에서만 인용
- 브랜드명(제품 라인명)을 반드시 포함 (예: "**브랜드명:** ALU-POWER HPC")
- 절삭조건이 있으면 반드시 포함하고 출처를 언급
- 데이터가 없는 항목은 "정보 없음"으로 표시
- 응답 마지막에 "📋 Reference: YG-1 내부 DB" 출처 표기
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
  warnings: string[],
  language: AppLanguage = "ko"
): string {
  const responseLanguage = language === "ko" ? "한국어" : "영어"
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

위 Fact-Checked 데이터를 기반으로 전문가 수준의 ${responseLanguage} 추천 요약을 작성하세요.

═══ 추천 요약 작성 규칙 ═══
1. 첫 문장: "~용으로 [브랜드명] [제품코드]를 추천드립니다." (바로 핵심, 브랜드명은 제품 라인명이다. 예: "ALU-POWER HPC SEME610200314E")
2. 왜 이 제품인지 2-3가지 근거 (매칭된 항목 기반, 데이터에서만 인용)
3. 주의사항이 있으면 솔직하게 언급 (소재 불일치, 낮은 매칭률 등)
4. 대안이 있으면 1순위와 비교하여 차별화 포인트 설명
5. 절삭조건이 있으면 반드시 포함 (Vc, fz 등 + 출처 신뢰도)
6. 데이터 없는 항목은 "정보 없음" — 절대 추정하지 마라
7. 응답 마지막에 반드시 "📋 Reference:" 섹션을 추가하라. 데이터 출처를 명시:
   - 내부 DB 데이터인 경우: "YG-1 내부 DB"
   - 웹 검색 결과인 경우: "웹 검색 (외부 소스)"
   - AI 일반 지식인 경우: "AI 일반 지식 (카탈로그 확인 필요)"
8. isComplete: true로 설정

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
    `  가공 방식: ${f(form.toolTypeOrCurrentProduct)}`,
    `  직경: ${f(form.diameterInfo)}`,
  ].join("\n")
}
