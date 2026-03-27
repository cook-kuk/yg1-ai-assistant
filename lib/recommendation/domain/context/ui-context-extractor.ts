/**
 * UI Context Extractor — Tracks what is currently visible in the UI.
 *
 * Users react to what they see, not just chat text.
 * This feeds into both answer generation and chip generation.
 *
 * Deterministic. No LLM calls.
 */

import type {
  CandidateSnapshot,
  ExplorationSessionState,
} from "@/lib/recommendation/domain/types"

// ── UI Artifact Types ────────────────────────────────────────
export type UIArtifactKind =
  | "recommendation_card"
  | "comparison_table"
  | "candidate_list"
  | "cutting_conditions"
  | "chips_bar"
  | "explanation_block"
  | "memory_debug"
  | "question_prompt"

export interface UIArtifact {
  kind: UIArtifactKind
  /** Brief summary of what's shown */
  summary: string
  /** Product codes shown in this artifact */
  productCodes: string[]
  /** Key-value pairs visible in this artifact */
  visibleFields: Array<{ field: string; value: string }>
  /** Whether this artifact is the primary focus */
  isPrimaryFocus: boolean
}

/**
 * Extract structured UI artifacts from the current session state.
 */
export function extractUIArtifacts(
  sessionState: ExplorationSessionState | null,
  candidates: CandidateSnapshot[]
): UIArtifact[] {
  if (!sessionState) return []

  const artifacts: UIArtifact[] = []
  const mode = sessionState.currentMode
  const lastAction = sessionState.lastAction

  // Recommendation cards
  if (
    sessionState.resolutionStatus?.startsWith("resolved") &&
    sessionState.displayedCandidates?.length > 0
  ) {
    const displayed = sessionState.displayedCandidates.slice(0, 5)
    artifacts.push({
      kind: "recommendation_card",
      summary: `추천 제품 ${displayed.length}개 표시`,
      productCodes: displayed.map(c => c.displayCode),
      visibleFields: displayed.flatMap(c => [
        ...(c.coating ? [{ field: "coating", value: c.coating }] : []),
        ...(c.fluteCount != null ? [{ field: "fluteCount", value: String(c.fluteCount) }] : []),
        ...(c.seriesName ? [{ field: "seriesName", value: c.seriesName }] : []),
        ...(c.diameterMm != null ? [{ field: "diameterMm", value: `${c.diameterMm}mm` }] : []),
      ]),
      isPrimaryFocus: mode === "recommendation" || lastAction === "show_recommendation",
    })
  }

  // Comparison table
  if (sessionState.lastComparisonArtifact) {
    artifacts.push({
      kind: "comparison_table",
      summary: `${sessionState.lastComparisonArtifact.comparedProductCodes.length}개 제품 비교표`,
      productCodes: sessionState.lastComparisonArtifact.comparedProductCodes,
      visibleFields: [],
      isPrimaryFocus: mode === "comparison" || lastAction === "compare_products",
    })
  }

  // Candidate list (when in narrowing with displayed candidates)
  if (
    !sessionState.resolutionStatus?.startsWith("resolved") &&
    candidates.length > 0
  ) {
    const top = candidates.slice(0, 5)
    artifacts.push({
      kind: "candidate_list",
      summary: `후보 ${candidates.length}개 (상위 ${top.length}개 표시)`,
      productCodes: top.map(c => c.displayCode),
      visibleFields: [],
      isPrimaryFocus: false,
    })
  }

  // Chips bar
  if (sessionState.displayedChips?.length > 0) {
    artifacts.push({
      kind: "chips_bar",
      summary: `칩 ${sessionState.displayedChips.length}개 표시`,
      productCodes: [],
      visibleFields: sessionState.displayedChips.map(c => ({
        field: "chip",
        value: c,
      })),
      isPrimaryFocus: mode === "question" || mode === "narrowing",
    })
  }

  // Cutting conditions (inferred from candidate evidence)
  {
    const top = sessionState.displayedCandidates?.slice(0, 3) ?? []
    const hasBestCondition = top.some((c: any) => c.bestCondition || c.hasEvidence)
    if (hasBestCondition && (lastAction === "explain_product" || sessionState.resolutionStatus?.startsWith("resolved"))) {
      artifacts.push({
        kind: "cutting_conditions",
        summary: `절삭조건 데이터 있음 (${top.length}개 제품)`,
        productCodes: top.map(c => c.displayCode),
        visibleFields: [],
        isPrimaryFocus: false,
      })
    }
  }

  // Explanation block
  if (lastAction === "explain_product" || lastAction === "answer_general") {
    artifacts.push({
      kind: "explanation_block",
      summary: "설명/답변 블록 표시 중",
      productCodes: [],
      visibleFields: [],
      isPrimaryFocus: false,
    })
  }

  // Question prompt
  if (sessionState.displayedOptions?.length > 0) {
    artifacts.push({
      kind: "question_prompt",
      summary: `선택지 ${sessionState.displayedOptions.length}개 (필드: ${sessionState.lastAskedField ?? "?"})`,
      productCodes: [],
      visibleFields: sessionState.displayedOptions.map(o => ({
        field: o.field ?? sessionState.lastAskedField ?? "unknown",
        value: o.value,
      })),
      isPrimaryFocus: mode === "question" || mode === "narrowing",
    })
  }

  return artifacts
}

/**
 * Infer which UI block the user is most likely reacting to.
 * Deterministic: based on session state + user message patterns.
 */
export function inferLikelyReferencedBlock(
  sessionState: ExplorationSessionState | null,
  userMessage: string
): UIArtifactKind {
  if (!sessionState) return "question_prompt"

  const clean = userMessage.trim().toLowerCase()
  const mode = sessionState.currentMode
  const lastAction = sessionState.lastAction

  // User explicitly references recommendation results
  if (/이\s*제품|추천.*제품|1번|2번|3번|대체.*후보|재고/.test(clean)) {
    if (sessionState.resolutionStatus?.startsWith("resolved")) return "recommendation_card"
  }

  // User references comparison
  if (/비교|차이|vs|어떤.*게.*나/.test(clean) && sessionState.lastComparisonArtifact) {
    return "comparison_table"
  }

  // User references cutting conditions
  if (/절삭조건|가공조건|Vc|fz|ap|ae|rpm|이송/.test(clean)) {
    return "cutting_conditions"
  }

  // User references candidates / counts
  if (/몇\s*개|후보|제품.*수|갯수|분포/.test(clean)) {
    return "candidate_list"
  }

  // User references current options / chips
  if (/선택지|보기|옵션|칩/.test(clean)) {
    return "chips_bar"
  }

  // Default based on current mode
  if (mode === "recommendation" || lastAction === "show_recommendation") return "recommendation_card"
  if (mode === "comparison" || lastAction === "compare_products") return "comparison_table"
  if (mode === "question" || mode === "narrowing") return "question_prompt"

  return "question_prompt"
}

/**
 * Summarize UI artifacts for LLM prompt context.
 */
export function summarizeUIArtifacts(artifacts: UIArtifact[]): string {
  if (artifacts.length === 0) return "표시된 UI 없음"

  const lines: string[] = []
  for (const a of artifacts) {
    const focusTag = a.isPrimaryFocus ? " [주 화면]" : ""
    lines.push(`- ${a.summary}${focusTag}`)
    if (a.productCodes.length > 0) {
      lines.push(`  제품: ${a.productCodes.join(", ")}`)
    }
  }
  return lines.join("\n")
}
