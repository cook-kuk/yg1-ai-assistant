/**
 * Comparison Agent — Sonnet
 *
 * Compares displayed products using actual DB fields.
 * Resolves product references like "1번", "2번", "상위 3개" against displayed candidates.
 */

import { resolveModel, type LLMProvider } from "@/lib/recommendation/infrastructure/llm/recommendation-llm"
import type { CandidateSnapshot, EvidenceSummary } from "@/lib/recommendation/domain/types"

const COMPARISON_MODEL = resolveModel("sonnet", "comparison")

export interface ComparisonResult {
  text: string
  comparedProducts: string[]
  modelUsed: string
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
      modelUsed: COMPARISON_MODEL,
    }
  }

  const productLines = targets.map(t => {
    const ev = evidenceMap.get(t.productCode)
    const condStr = ev?.bestCondition
      ? `Vc=${ev.bestCondition.Vc ?? "-"}, fz=${ev.bestCondition.fz ?? "-"}, ap=${ev.bestCondition.ap ?? "-"}, ae=${ev.bestCondition.ae ?? "-"}`
      : "절삭조건 없음"
    return `#${t.rank} ${t.displayCode}${t.displayLabel ? ` [${t.displayLabel}]` : ""}
  브랜드: ${t.brand ?? "-"}
  시리즈: ${t.seriesName ?? "-"}
  형상: ${t.toolSubtype ?? "-"}
  재질: ${t.toolMaterial ?? "-"}
  직경: ${t.diameterMm != null ? `${t.diameterMm}mm` : "-"}
  날수: ${t.fluteCount ?? "-"}
  코팅: ${t.coating || "-"}
  생크직경: ${t.shankDiameterMm != null ? `${t.shankDiameterMm}mm` : "-"}
  날길이(LOC): ${t.lengthOfCutMm != null ? `${t.lengthOfCutMm}mm` : "-"}
  전체길이(OAL): ${t.overallLengthMm != null ? `${t.overallLengthMm}mm` : "-"}
  헬릭스각: ${t.helixAngleDeg != null ? `${t.helixAngleDeg}°` : "-"}
  소재: ${t.materialTags.join(", ") || "-"}
  매칭: ${t.matchStatus} (${t.score}점)
  재고: ${t.stockStatus} (${t.totalStock ?? "미확인"})
  절삭조건: ${condStr}`
  }).join("\n\n")

  const systemPrompt = `당신은 YG-1 절삭공구 비교 전문가입니다.
아래 제품 데이터는 DB에서 직접 조회한 실제 값입니다.

★ 절대 규칙: 수치 데이터(직경, LOC, OAL, 생크직경, 헬릭스각, 날수, 재고)는 아래 데이터를 그대로 인용하세요. 추론하거나 만들지 마세요. "-"인 항목은 "-"으로 표시하세요.
★ 당신이 생성하는 것은 "추천 의견"과 "비교 분석" 텍스트뿐입니다.

마크다운 표로 비교:
| 항목 | 제품1 | 제품2 | ... |
비교 항목: 제품코드, 브랜드, 형상, 직경, 날수, 코팅, 재질, 생크직경, LOC, OAL, 헬릭스각, 소재 적합성, 재고

표 아래에:
- 각 제품의 강점/약점 1-2줄
- 어떤 상황에서 어떤 제품이 더 적합한지 결론`

  try {
    const raw = await provider.complete(
      systemPrompt,
      [{ role: "user", content: `다음 제품들을 비교해주세요:\n\n${productLines}` }],
      1500,
      COMPARISON_MODEL,
      "comparison"
    )

    return {
      text: raw.trim(),
      comparedProducts: targets.map(t => t.displayCode),
      modelUsed: COMPARISON_MODEL,
    }
  } catch (e) {
    console.warn("[comparison-agent:sonnet] Failed:", e)
    // Deterministic fallback — DB 값만 사용
    const lines = targets.map(t =>
      `**${t.displayCode}** (${t.brand ?? ""} ${t.seriesName ?? ""}) — ${t.toolSubtype ?? ""} φ${t.diameterMm ?? "-"}mm, ${t.fluteCount ?? "-"}F, ${t.coating || "-"}, LOC ${t.lengthOfCutMm ?? "-"}mm, OAL ${t.overallLengthMm ?? "-"}mm, 재고: ${t.stockStatus}(${t.totalStock ?? "미확인"})`
    )
    return {
      text: `제품 비교:\n${lines.join("\n")}`,
      comparedProducts: targets.map(t => t.displayCode),
      modelUsed: COMPARISON_MODEL,
    }
  }
}
