/**
 * Value Normalizer — Matches user input against actual candidate data.
 *
 * 3-tier strategy:
 * 1. Exact match (case-insensitive) — instant, no LLM
 * 2. Substring/fuzzy match — instant, no LLM
 * 3. LLM translation (Haiku) — Korean→English, ~200ms
 *
 * No hardcoded alias tables. The LLM handles all language translation.
 */

import type { LLMProvider } from "@/lib/recommendation/infrastructure/llm/recommendation-llm"
import {
  extractDistinctFilterFieldValues,
  getFilterFieldMatchPolicy,
} from "@/lib/recommendation/shared/filter-field-registry"

function normalizeCompactValue(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, "")
}

function normalizeIdentifierValue(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9가-힣]+/g, "")
}

/**
 * Normalize a user-provided value against actual candidate values.
 *
 * Priority:
 * 1. Exact match (case-insensitive) — no LLM
 * 2. Substring/fuzzy match — no LLM
 * 3. LLM translation via Haiku — when user input is in different language from DB values
 * 4. Original value (if no match found)
 */
export async function normalizeFilterValue(
  userValue: string,
  field: string,
  candidateValues: string[],
  provider?: LLMProvider | null
): Promise<{ normalized: string; matchType: "exact" | "fuzzy" | "llm" | "none" }> {
  const clean = userValue.trim()
  const matchPolicy = getFilterFieldMatchPolicy(field)
  const cleanLower = normalizeCompactValue(clean)
  const cleanIdentifier = normalizeIdentifierValue(clean)

  if (candidateValues.length === 0) {
    return { normalized: clean, matchType: "none" }
  }

  // 1. Exact match
  const exactMatch = candidateValues.find(v => {
    const normalizedCandidate = matchPolicy === "strict_identifier"
      ? normalizeIdentifierValue(v)
      : normalizeCompactValue(v)
    return normalizedCandidate === (matchPolicy === "strict_identifier" ? cleanIdentifier : cleanLower)
  })
  if (exactMatch) {
    return { normalized: exactMatch, matchType: "exact" }
  }

  if (matchPolicy === "strict_identifier") {
    return { normalized: clean, matchType: "none" }
  }

  // 2. Substring match
  const substringMatch = candidateValues.find(v =>
    normalizeCompactValue(v).includes(cleanLower) ||
    cleanLower.includes(normalizeCompactValue(v))
  )
  if (substringMatch) {
    return { normalized: substringMatch, matchType: "fuzzy" }
  }

  // 3. Partial overlap (3+ chars in common)
  if (cleanLower.length >= 3) {
    for (const candidateVal of candidateValues) {
      const candLower = normalizeCompactValue(candidateVal)
      for (let i = 0; i <= cleanLower.length - 3; i++) {
        if (candLower.includes(cleanLower.slice(i, i + 3))) {
          return { normalized: candidateVal, matchType: "fuzzy" }
        }
      }
    }
  }

  // 4. LLM translation (Haiku) — handles Korean↔English, industry jargon, etc.
  if (matchPolicy === "llm_assisted" && provider?.available()) {
    try {
      const llmMatch = await translateWithLLM(clean, field, candidateValues, provider)
      if (llmMatch) {
        return { normalized: llmMatch, matchType: "llm" }
      }
    } catch (e) {
      console.warn(`[value-normalizer] LLM translation failed:`, e)
    }
  }

  // 5. No match
  return { normalized: clean, matchType: "none" }
}

/**
 * Use Haiku to translate/match user input to one of the candidate values.
 * Returns the matched candidate value, or null if no match.
 */
async function translateWithLLM(
  userValue: string,
  field: string,
  candidateValues: string[],
  provider: LLMProvider
): Promise<string | null> {
  const valuesStr = candidateValues.slice(0, 20).join(", ")

  const prompt = `사용자가 "${userValue}"라고 입력했습니다.
이것은 "${field}" 필드의 값입니다.

현재 DB에 있는 실제 값들: [${valuesStr}]

사용자 입력이 위 값 중 하나와 같은 뜻이면, 해당 DB 값을 그대로 반환하세요.
같은 뜻인 값이 없으면 "NONE"을 반환하세요.

예시:
- "카바이드" → "Carbide" (같은 뜻)
- "고속도강" → "HSS" (같은 뜻)
- "무코팅" → "Bright Finish" 또는 "Uncoated" (같은 뜻)
- "스퀘어" → "Square" (같은 뜻)

DB 값만 정확히 반환하세요. 설명이나 따옴표 없이 값만.`

  const raw = await provider.complete(
    "당신은 절삭공구 용어 번역기입니다. DB 값과 매칭되는 것을 찾아 DB 값 그대로 반환합니다. 값만 반환하세요.",
    [{ role: "user", content: prompt }],
    1500,
    "haiku"
  )

  const result = raw.trim().replace(/^["']|["']$/g, "")

  if (result === "NONE" || result.length === 0) return null

  // Verify the LLM returned an actual candidate value
  const matched = candidateValues.find(v =>
    normalizeCompactValue(v) === normalizeCompactValue(result) ||
    normalizeCompactValue(v).includes(normalizeCompactValue(result)) ||
    normalizeCompactValue(result).includes(normalizeCompactValue(v))
  )

  if (matched) {
    console.log(`[value-normalizer:llm] "${userValue}" → "${matched}" (field=${field})`)
    return matched
  }

  return null
}

/**
 * Extract distinct values for a given field from candidates.
 * Works with both ScoredProduct[] and CandidateSnapshot[].
 */
export function extractDistinctFieldValues(
  candidates: Array<Record<string, unknown>>,
  field: string
): string[] {
  return extractDistinctFilterFieldValues(candidates, field)
}
