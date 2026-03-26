/**
 * Comparison Agent — Sonnet
 *
 * Compares displayed products using actual DB fields.
 * Resolves product references like "1번", "2번", "상위 3개" against displayed candidates.
 */

import type { LLMProvider } from "@/lib/recommendation/infrastructure/llm/recommendation-llm"
import type { CandidateSnapshot, EvidenceSummary } from "@/lib/recommendation/domain/types"

export interface ComparisonResult {
  text: string
  comparedProducts: string[]
  modelUsed: "sonnet"
}

/**
 * Resolve product references against displayed candidates.
 * "1번" → rank 1, "상위3" → ranks 1-3
 */
export function resolveProductReferences(
  references: string[],
  candidates: CandidateSnapshot[],
  options?: { fallbackToTop2?: boolean }
): CandidateSnapshot[] {
  const fallbackToTop2 = options?.fallbackToTop2 ?? true
  const resolved: CandidateSnapshot[] = []

  for (const ref of references) {
    // "N번" → rank N
    const rankMatch = ref.match(/(\d+)\s*번/)
    if (rankMatch) {
      const rank = parseInt(rankMatch[1])
      const found = candidates.find(c => c.rank === rank)
      if (found && !resolved.includes(found)) resolved.push(found)
      continue
    }

    // "상위N" → top N
    const topMatch = ref.match(/상위\s*(\d+)/)
    if (topMatch) {
      const n = parseInt(topMatch[1])
      for (const c of candidates.slice(0, n)) {
        if (!resolved.includes(c)) resolved.push(c)
      }
      continue
    }

    // Product code match
    const code = ref.toUpperCase()
    const byCode = candidates.find(c =>
      c.productCode.includes(code) || c.displayCode.includes(code)
    )
    if (byCode && !resolved.includes(byCode)) resolved.push(byCode)
  }

  // Default: top 2 if no references resolved (unless fallbackToTop2 is disabled)
  if (resolved.length === 0 && candidates.length >= 2 && fallbackToTop2) {
    resolved.push(candidates[0], candidates[1])
  }

  return resolved
}

/**
 * Generate comparison text using Sonnet.
 */
export async function compareProducts(
  targets: CandidateSnapshot[],
  evidenceMap: Map<string, EvidenceSummary>,
  provider: LLMProvider
): Promise<ComparisonResult> {
  if (targets.length < 2) {
    return {
      text: "비교할 제품이 2개 이상 필요합니다.",
      comparedProducts: targets.map(t => t.displayCode),
      modelUsed: "sonnet",
    }
  }

  const productLines = targets.map(t => {
    const ev = evidenceMap.get(t.productCode)
    const condStr = ev?.bestCondition
      ? `Vc=${ev.bestCondition.Vc ?? "?"}, fz=${ev.bestCondition.fz ?? "?"}`
      : "절삭조건 없음"
    return `#${t.rank} ${t.displayCode}${t.displayLabel ? ` [${t.displayLabel}]` : ""}
  브랜드: ${t.brand ?? "?"}
  시리즈: ${t.seriesName ?? "?"}
  직경: ${t.diameterMm ?? "?"}mm | 날수: ${t.fluteCount ?? "?"} | 코팅: ${t.coating || "정보없음"}
  소재: ${t.materialTags.join(", ") || "?"}
  매칭: ${t.matchStatus} (${t.score}점)
  재고: ${t.stockStatus} (${t.totalStock ?? "?"})
  절삭조건: ${condStr}`
  }).join("\n\n")

  const systemPrompt = `당신은 YG-1 절삭공구 비교 전문가입니다.
아래 제품들을 비교하여 간결한 한국어로 차이점과 추천 용도를 설명하세요.

규칙:
- 반드시 **마크다운 표** 형식으로 비교 (| 항목 | 제품1 | 제품2 | ... |)
- 비교 항목: 제품코드, 시리즈, 직경, 날수, 코팅, 소재 적합성, 매칭 점수, 절삭조건 유무
- 데이터에 있는 정보만 사용 (추정 금지)
- 표 아래에 각 제품의 강점/약점을 1-2줄로
- 어떤 상황에서 어떤 제품이 더 적합한지 결론
- 없는 정보는 "-"으로 표시
- 답변 마지막에 반드시: [Reference: YG-1 내부 DB]`

  try {
    const raw = await provider.complete(
      systemPrompt,
      [{ role: "user", content: `다음 제품들을 비교해주세요:\n\n${productLines}` }],
      1500,
      "sonnet",
      "comparison"
    )

    return {
      text: raw.trim(),
      comparedProducts: targets.map(t => t.displayCode),
      modelUsed: "sonnet",
    }
  } catch (e) {
    console.warn("[comparison-agent:sonnet] Failed:", e)
    // Deterministic fallback
    const lines = targets.map(t =>
      `**${t.displayCode}** (${t.displayLabel ?? t.seriesName ?? "?"}) — φ${t.diameterMm ?? "?"}mm, ${t.fluteCount ?? "?"}F, ${t.coating || "정보없음"}, ${t.matchStatus} ${t.score}점`
    )
    return {
      text: `제품 비교:\n${lines.join("\n")}`,
      comparedProducts: targets.map(t => t.displayCode),
      modelUsed: "sonnet",
    }
  }
}
