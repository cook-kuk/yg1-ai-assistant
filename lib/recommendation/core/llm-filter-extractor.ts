import { parseAnswerToFilter } from "@/lib/recommendation/domain/question-engine"

import type { LLMProvider } from "@/lib/recommendation/infrastructure/llm/recommendation-llm"
import type { AppliedFilter } from "@/lib/recommendation/domain/types"

interface LLMFilterResult {
  extractedFilters: AppliedFilter[]
  isSideQuestion: boolean
  skipPendingField: boolean
}

const FIELD_MAP: Record<string, string> = {
  toolSubtype: "toolSubtype",
  workPieceName: "workPieceName",
  diameterMm: "diameterMm",
  fluteCount: "fluteCount",
  coating: "coating",
}

export async function extractFiltersWithLLM(
  userMessage: string,
  pendingField: string | null,
  appliedFilters: AppliedFilter[],
  provider: LLMProvider
): Promise<LLMFilterResult> {
  const empty: LLMFilterResult = { extractedFilters: [], isSideQuestion: false, skipPendingField: false }

  if (!provider.available()) return empty

  const appliedSummary = appliedFilters
    .filter(f => f.op !== "skip")
    .map(f => `${f.field}=${f.value}`)
    .join(", ") || "없음"

  const systemPrompt = `사용자 메시지에서 절삭공구 필터 조건을 추출하라. 여러 개 가능.
매핑:
- "Corner radius", "코너R", "라디우스" → toolSubtype: "Radius"
- "스퀘어", "평날" → toolSubtype: "Square"
- "볼", "볼엔드" → toolSubtype: "Ball"
- "황삭", "러핑" → toolSubtype: "Roughing"
- "알루미늄" → workPieceName: "알루미늄"
- "스테인리스", "SUS", "STS" → workPieceName: "스테인리스강"
- "10mm", "φ10", "10파이" → diameterMm: 10
- "3날", "3F" → fluteCount: 3
- "무코팅" → coating: "Bright Finish"
- "DLC", "TiAlN" → coating: (해당값)
- "상관없음", "몰라", "아무거나" → skipPendingField: true
- 공장/회사/지점/영업소/연락처 질문 → isSideQuestion: true

현재 pending 필드: ${pendingField ?? "없음"}
이미 적용된 필터: ${appliedSummary}

JSON만 반환:
{"filters": [{"field": "...", "value": "..."}], "isSideQuestion": false, "skipPendingField": false}`

  try {
    const raw = await provider.complete(
      systemPrompt,
      [{ role: "user", content: userMessage }],
      500,
      "haiku"
    )

    const cleaned = raw.trim().replace(/```json\n?|\n?```/g, "")
    const parsed = JSON.parse(cleaned) as {
      filters?: Array<{ field?: string; value?: unknown }>
      isSideQuestion?: boolean
      skipPendingField?: boolean
    }

    const isSideQuestion = parsed.isSideQuestion === true
    const skipPendingField = parsed.skipPendingField === true

    const extractedFilters: AppliedFilter[] = []
    const existingFields = new Set(
      appliedFilters.filter(f => f.op !== "skip").map(f => f.field)
    )

    if (Array.isArray(parsed.filters)) {
      for (const entry of parsed.filters) {
        const field = entry.field
        const value = entry.value
        if (!field || value == null || !FIELD_MAP[field]) continue
        if (existingFields.has(field)) continue

        const filter = parseAnswerToFilter(field, String(value))
        if (filter) {
          extractedFilters.push(filter)
          existingFields.add(field)
        }
      }
    }

    console.log(
      `[llm-filter-extractor] extracted=${extractedFilters.length} isSide=${isSideQuestion} skipPending=${skipPendingField}`
    )

    return { extractedFilters, isSideQuestion, skipPendingField }
  } catch (err) {
    console.warn(
      `[llm-filter-extractor] Failed: ${err instanceof Error ? err.message : String(err)}`
    )
    return empty
  }
}
