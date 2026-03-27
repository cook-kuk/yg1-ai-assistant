import type { LLMProvider } from "@/lib/recommendation/infrastructure/llm/recommendation-llm"
import type { AppliedFilter } from "@/lib/recommendation/domain/types"
import { parseAnswerToFilter } from "@/lib/recommendation/domain/question-engine"

export interface LlmFilterResult {
  extractedFilters: Record<string, string | number>
  skipPendingField: boolean
  isSideQuestion: boolean
  confidence: number
}

export async function extractFiltersWithLLM(
  userMessage: string,
  lastAskedField: string | null,
  currentFilters: AppliedFilter[],
  provider: LLMProvider
): Promise<LlmFilterResult> {
  const DEFAULT_RESULT: LlmFilterResult = { extractedFilters: {}, skipPendingField: false, isSideQuestion: false, confidence: 0 }

  if (!provider.available() || !userMessage.trim()) return DEFAULT_RESULT

  const currentFilterSummary = currentFilters
    .filter(f => f.op !== "skip")
    .map(f => `${f.field}=${f.value}`)
    .join(", ") || "없음"

  const systemPrompt = `절삭공구 추천 챗봇 필터 추출기. JSON만 반환.`

  const userPrompt = `사용자 메시지에서 절삭공구 필터를 추출하라. 여러 개 가능.

현재 적용된 필터: ${currentFilterSummary}
현재 대기 질문 필드: ${lastAskedField ?? "없음"}
사용자 메시지: "${userMessage}"

매핑 규칙:
- "Corner radius" / "코너R" / "래디우스" / "라디우스" → toolSubtype: "Radius"
- "스퀘어" / "평날" / "Square" → toolSubtype: "Square"
- "볼" / "볼노즈" / "볼엔드" / "Ball" → toolSubtype: "Ball"
- "황삭" / "러핑" / "Roughing" → toolSubtype: "Roughing"
- "테이퍼" / "Taper" → toolSubtype: "Taper"
- "챔퍼" / "Chamfer" → toolSubtype: "Chamfer"
- "하이피드" / "High-Feed" → toolSubtype: "High-Feed"
- "램핑" → toolSubtype: "Radius" (램핑에 적합)
- "알루미늄" → workPieceName: "알루미늄"
- "SUS" / "스테인리스" / "스텐" → workPieceName: "스테인리스강"
- "탄소강" → workPieceName: "탄소강"
- "티타늄" → workPieceName: "티타늄"
- "주철" → workPieceName: "주철"
- "인코넬" → workPieceName: "인코넬"
- "10mm" / "φ10" / "10파이" / "직경 10" → diameterMm: 10
- "3날" / "3F" / "3플루트" → fluteCount: 3
- "무코팅" → coating: "Bright Finish"
- "DLC" / "TiAlN" / "AlTiN" / "TiCN" / "AlCrN" → coating: (해당값)
- "엔드밀" → toolType: "엔드밀"
- "날장 30mm" / "커팅 길이 30" / "날 길이 30" → lengthOfCutMm: 30
- "전장 100mm" / "전체 길이 100" / "OAL 100" → overallLengthMm: 100
- "생크 8mm" / "생크 직경 8" / "shank 8" → shankDiameterMm: 8
- "쿨런트홀 있는" / "쿨런트 홀" / "내부 급유" → coolantHole: true
- "쿨런트홀 없는" / "외부 급유" → coolantHole: false
- "헬릭스 45도" / "나선각 45" / "helix 45" → helixAngleDeg: 45
- "상관없음" / "몰라" / "아무거나" / "패스" / "스킵" → skipPendingField: true
- 공장/회사/지점/본사/영업소/연락처/전화번호 질문 → isSideQuestion: true

이미 적용된 필터와 동일한 필드는 추출하지 마라.
한 문장에 여러 필터가 있으면 전부 추출하라.

반드시 이 JSON만 반환:
{"extractedFilters": {}, "skipPendingField": false, "isSideQuestion": false, "confidence": 0.9}`

  try {
    const raw = await provider.complete(systemPrompt, [{ role: "user", content: userPrompt }], 500, "haiku", "llm-filter-extractor")
    const cleaned = raw.trim().replace(/```json\n?|\n?```/g, "")
    const parsed = JSON.parse(cleaned)

    return {
      extractedFilters: parsed.extractedFilters ?? {},
      skipPendingField: !!parsed.skipPendingField,
      isSideQuestion: !!parsed.isSideQuestion,
      confidence: typeof parsed.confidence === "number" ? parsed.confidence : 0.5,
    }
  } catch (err) {
    console.warn("[llm-filter-extractor] Failed:", err)
    return DEFAULT_RESULT
  }
}

/**
 * Convert LLM extracted filters (Record) to AppliedFilter[] for the runtime
 */
export function llmResultToAppliedFilters(
  extractedFilters: Record<string, string | number>,
  turnCount: number
): AppliedFilter[] {
  const results: AppliedFilter[] = []

  for (const [field, value] of Object.entries(extractedFilters)) {
    const filter = parseAnswerToFilter(field, String(value))
    if (filter) {
      filter.appliedAt = turnCount
      results.push(filter)
    } else {
      // parseAnswerToFilter가 못 잡으면 직접 생성
      const isNumeric = typeof value === "number" || /^\d+(\.\d+)?$/.test(String(value))
      results.push({
        field,
        op: isNumeric ? "eq" : "includes",
        value: String(value),
        rawValue: isNumeric ? Number(value) : String(value),
        appliedAt: turnCount,
      })
    }
  }

  return results
}
