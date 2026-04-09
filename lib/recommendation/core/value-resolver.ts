/**
 * Value Resolver — 유저 입력값을 DB 실제 값에 매칭.
 *
 * 3단계: 정확매칭 → 동의어/퍼지매칭 → 미존재 안내.
 * auto-synonym.ts와 연동하여 동의어도 처리.
 * DB sampleValues + brands + workpieces 전체를 검색 대상으로 사용.
 */

import { getDbSchemaSync } from "./sql-agent-schema-cache"
import { getSynonymMap } from "./auto-synonym"

export interface ResolveSuggestion {
  value: string
  column: string
  distance: number
}

export interface ResolveResult {
  found: boolean
  resolvedValue?: string
  resolvedColumn?: string
  matchType: "exact" | "synonym" | "fuzzy" | "not_found"
  suggestions: ResolveSuggestion[]
  userMessage: string | null
}

// ── Levenshtein distance ─────────────────────────────────────

function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length
  if (m === 0) return n
  if (n === 0) return m
  const d: number[][] = Array.from({ length: m + 1 }, (_, i) => {
    const row = new Array(n + 1).fill(0)
    row[0] = i
    return row
  })
  for (let j = 1; j <= n; j++) d[0][j] = j
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost)
    }
  }
  return d[m][n]
}

/**
 * 유저 입력값을 DB 실제 값에 매칭 시도.
 */
export function resolveValue(userValue: string, hintColumn?: string): ResolveResult {
  const schema = getDbSchemaSync()
  if (!schema) {
    return { found: false, matchType: "not_found", suggestions: [], userMessage: null }
  }

  const lower = userValue.toLowerCase().trim()
  if (!lower) {
    return { found: false, matchType: "not_found", suggestions: [], userMessage: null }
  }

  // 1단계: 후보 값 풀 구축
  const allValues: Array<{ value: string; column: string }> = []
  for (const [col, vals] of Object.entries(schema.sampleValues)) {
    if (hintColumn && col !== hintColumn) continue
    for (const v of vals) allValues.push({ value: v, column: col })
  }
  if (!hintColumn || hintColumn === "edp_brand_name") {
    for (const b of schema.brands) allValues.push({ value: b, column: "edp_brand_name" })
  }
  if (!hintColumn || hintColumn === "_workPieceName") {
    for (const wp of schema.workpieces) {
      if (wp.tag_name) allValues.push({ value: wp.tag_name, column: "_workPieceName" })
      if (wp.normalized_work_piece_name) allValues.push({ value: wp.normalized_work_piece_name, column: "_workPieceName" })
    }
  }

  // 2단계: 정확 매칭 (대소문자 무시)
  const exact = allValues.find(v => v.value.toLowerCase() === lower)
  if (exact) {
    return { found: true, resolvedValue: exact.value, resolvedColumn: exact.column, matchType: "exact", suggestions: [], userMessage: null }
  }

  // 3단계: 동의어 매칭 (auto-synonym)
  const synMap = getSynonymMap()
  const synNorm = synMap.get(lower)
  if (synNorm) {
    const colonIdx = synNorm.indexOf(":")
    const normValue = colonIdx >= 0 ? synNorm.slice(colonIdx + 1) : synNorm
    const synExact = allValues.find(v =>
      v.value.toLowerCase() === normValue || v.value.toLowerCase().includes(normValue),
    )
    if (synExact) {
      return { found: true, resolvedValue: synExact.value, resolvedColumn: synExact.column, matchType: "synonym", suggestions: [], userMessage: null }
    }
  }

  // 4단계: 부분 문자열 + 퍼지 매칭
  const tolerance = Math.max(2, Math.floor(lower.length * 0.3))
  const fuzzy = allValues
    .map(v => ({ ...v, distance: levenshtein(lower, v.value.toLowerCase()) }))
    .filter(v => v.distance <= tolerance)
    .sort((a, b) => a.distance - b.distance)

  const partial = allValues
    .filter(v => {
      const lv = v.value.toLowerCase()
      return lv.includes(lower) || lower.includes(lv)
    })
    .map(v => ({ ...v, distance: 0.5 }))

  const allCandidates: ResolveSuggestion[] = [...partial, ...fuzzy]
    .filter((v, i, arr) => arr.findIndex(a => a.value === v.value) === i)
    .slice(0, 5)

  if (allCandidates.length > 0 && allCandidates[0].distance <= 2) {
    const best = allCandidates[0]
    return {
      found: false,
      matchType: "fuzzy",
      suggestions: allCandidates,
      userMessage: `"${userValue}" → 혹시 "${best.value}" 말씀이시죠?`,
    }
  }

  // 5단계: 진짜 없음
  return {
    found: false,
    matchType: "not_found",
    suggestions: allCandidates,
    userMessage: `"${userValue}"은(는) 현재 카탈로그에서 확인되지 않습니다.${
      allCandidates.length > 0 ? ` 유사한 값: ${allCandidates.slice(0, 3).map(c => c.value).join(", ")}` : ""
    }`,
  }
}

export interface ResolvableFilter {
  field: string
  op: string
  value: string
  value2?: string
  display?: string
}

/**
 * 필터 배열의 각 값을 DB와 대조하여 검증/교정.
 */
export function validateAndResolveFilters<T extends ResolvableFilter>(
  filters: T[],
): {
  resolvedFilters: T[]
  messages: string[]
  hasUnresolved: boolean
} {
  const messages: string[] = []
  let hasUnresolved = false

  const resolvedFilters = filters.map(f => {
    // 숫자 / 내부 필드 / 범위 / 제외는 검증 스킵
    if (/^-?\d+(\.\d+)?$/.test(f.value)) return f
    if (f.field.startsWith("_")) return f
    if (f.op === "gte" || f.op === "lte" || f.op === "between") return f
    if (f.op === "neq" || f.op === "skip" || f.op === "reset" || f.op === "back") return f

    const result = resolveValue(f.value)

    if (result.found && result.resolvedValue && result.resolvedValue !== f.value) {
      messages.push(`"${f.value}" → "${result.resolvedValue}" (${result.matchType === "synonym" ? "동의어" : "유사어"} 매칭)`)
      return { ...f, value: result.resolvedValue }
    }

    if (!result.found && result.matchType === "fuzzy" && result.suggestions.length > 0) {
      const best = result.suggestions[0]
      messages.push(`"${f.value}" → "${best.value}" (자동 교정)`)
      return { ...f, value: best.value }
    }

    if (!result.found && result.matchType === "not_found") {
      hasUnresolved = true
      if (result.userMessage) messages.push(result.userMessage)
      // like 로 완화
      if (f.op === "eq") return { ...f, op: "like" }
    }

    return f
  })

  return { resolvedFilters, messages, hasUnresolved }
}
