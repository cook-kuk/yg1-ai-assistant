/**
 * Edit-Intent Layer
 *
 * 기존 상태를 수정/교체/제외/초기화하는 사용자 표현을 파싱.
 * KG(엔티티 인식)와 planner(자연어 해석) 사이에 위치.
 *
 * 설계 원칙:
 * - LLM 호출 0회 (deterministic regex + KG entity resolver)
 * - KG의 엔티티 인식(resolveEntity, extractEntities)을 재사용
 * - 수정 동사/조사가 없으면 null 반환 → 다음 레이어로 넘김
 */

import { resolveEntity, extractEntities } from "./knowledge-graph"
import type { AppliedFilter } from "@/lib/types/exploration"

// ── Types ────────────────────────────────────────────────────

export type EditIntent =
  | { type: "replace_field"; field: string; oldValue?: string; newValue: string }
  | { type: "exclude_field"; field: string; value: string }
  | { type: "clear_field"; field: string }
  | { type: "go_back_then_apply"; inner: EditIntent }
  | { type: "reset_all" }

export interface EditIntentResult {
  intent: EditIntent
  confidence: number
  reason: string
}

// ── Edit Signal Detection ────────────────────────────────────

/** 수정 동사/조사가 포함되어 있는지 빠르게 판별 */
export function hasEditSignal(msg: string): boolean {
  return EDIT_SIGNAL_RE.test(msg)
}

const EDIT_SIGNAL_RE =
  /말고|빼고|제외|외에|아닌|않은|아니고|아니면|바꿔|바꾸|변경|교체|에서\s*\S+\s*(?:로|으로)|상관없|관계없|아무거나|뭐든|처음부터|다시\s*시작|초기화|리셋|reset/iu

// ── Field Name Patterns ──────────────────────────────────────

const FIELD_KO_MAP: Record<string, string> = {
  "브랜드": "brand",
  "코팅": "coating",
  "날수": "fluteCount",
  "날": "fluteCount",
  "형상": "toolSubtype",
  "타입": "toolSubtype",
  "소재": "workPieceName",
  "재질": "workPieceName",
  "직경": "diameterMm",
  "파이": "diameterMm",
  "시리즈": "seriesName",
  "생크": "shankDiameterMm",
  "전장": "overallLengthMm",
  "절삭길이": "lengthOfCutMm",
  "헬릭스": "helixAngleDeg",
  "국가": "country",
}

/** "브랜드는 상관없음" → field="brand" 추출 */
function extractFieldFromKorean(msg: string): string | null {
  for (const [ko, field] of Object.entries(FIELD_KO_MAP)) {
    if (msg.includes(ko)) return field
  }
  return null
}

// ── Core Parser ──────────────────────────────────────────────

/**
 * 메시지에서 EditIntent를 파싱합니다.
 * 수정 동사/조사가 없으면 null 반환.
 *
 * @param msg - 사용자 메시지
 * @param existingFilters - 현재 적용된 필터 (컨텍스트용)
 */
export function parseEditIntent(
  msg: string,
  existingFilters: AppliedFilter[] = [],
): EditIntentResult | null {
  if (!hasEditSignal(msg)) return null

  const lower = msg.toLowerCase().trim()

  // ── 1. reset_all ──
  if (/(?:처음부터|다시\s*시작|초기화|리셋|^reset$)/iu.test(lower)) {
    return { intent: { type: "reset_all" }, confidence: 0.95, reason: "reset signal" }
  }

  // ── 2. go_back_then_apply ("이전으로 돌아가서 X 제외") ──
  const goBackApplyMatch = lower.match(
    /(?:이전|뒤로|돌아가)\S*\s+(?:.*?)(.+?)\s*(?:제외|빼고|말고|없이)/u
  )
  if (goBackApplyMatch) {
    const innerIntent = parseExcludeFromToken(goBackApplyMatch[1].trim(), existingFilters)
    if (innerIntent) {
      return {
        intent: { type: "go_back_then_apply", inner: innerIntent.intent },
        confidence: 0.93,
        reason: `go_back + ${innerIntent.reason}`,
      }
    }
  }

  // ── 3. clear_field ("브랜드는 상관없음", "코팅 관계없어", "소재 아무거나") ──
  const clearMatch = lower.match(
    /(\S+?)(?:은|는|이|가)?\s*(?:상관없|관계없|아무거나|뭐든)/u
  )
  if (clearMatch) {
    const field = extractFieldFromKorean(clearMatch[1]) ?? inferFieldFromEntity(clearMatch[1])
    if (field) {
      return {
        intent: { type: "clear_field", field },
        confidence: 0.93,
        reason: `clear ${field}`,
      }
    }
  }

  // Variant without particle: "소재 아무거나"
  const clearMatch2 = lower.match(
    /(\S+)\s+(?:상관없|관계없|아무거나|뭐든)/u
  )
  if (clearMatch2) {
    const field = extractFieldFromKorean(clearMatch2[1]) ?? inferFieldFromEntity(clearMatch2[1])
    if (field) {
      return {
        intent: { type: "clear_field", field },
        confidence: 0.93,
        reason: `clear ${field}`,
      }
    }
  }

  // ── 4. replace_field ("X 말고 Y로", "X에서 Y로 바꿔줘") ──
  const replaceResult = parseReplace(lower, existingFilters)
  if (replaceResult) return replaceResult

  // ── 5. exclude_field ("X 빼고", "X 아닌걸로", "X 제외") ──
  const excludeResult = parseExclude(lower, existingFilters)
  if (excludeResult) return excludeResult

  return null
}

// ── Replace Parser ───────────────────────────────────────────

/** "X 말고 Y로", "X에서 Y로 바꿔", "X를 Y로 변경" */
function parseReplace(
  lower: string,
  existingFilters: AppliedFilter[],
): EditIntentResult | null {
  // Pattern A: "X 말고 Y로" — extract entities from before/after the verb
  const patA = lower.match(/\s*(?:말고|빼고|제외)\s+/u)
  if (patA && patA.index !== undefined) {
    const beforeText = lower.slice(0, patA.index).trim()
    const afterText = lower.slice(patA.index + patA[0].length).trim()
    const oldEntities = extractEntities(beforeText)
    const newEntities = extractEntities(afterText)

    if (oldEntities.length > 0 && newEntities.length > 0) {
      const oldEntity = oldEntities[oldEntities.length - 1]
      const replacement = newEntities.find(e => e.field === oldEntity.field)
      if (replacement) {
        return {
          intent: {
            type: "replace_field",
            field: oldEntity.field,
            oldValue: oldEntity.canonical,
            newValue: replacement.canonical,
          },
          confidence: 0.95,
          reason: `replace ${oldEntity.field}: ${oldEntity.canonical} → ${replacement.canonical}`,
        }
      }
    }
    // No same-field replacement found → fall through to exclude
  }

  // Pattern B: "X에서 Y로 바꿔/변경/교체"
  const patB = lower.match(/(\S+?)에서\s+(\S+?)(?:로|으로)\s*(?:바꿔|바꾸|변경|교체)/u)
  if (patB) {
    const oldEntity = resolveEntityOrNumeric(patB[1])
    const newEntity = resolveEntityOrNumeric(patB[2])
    if (oldEntity && newEntity && oldEntity.field === newEntity.field) {
      return {
        intent: {
          type: "replace_field",
          field: oldEntity.field,
          oldValue: oldEntity.canonical,
          newValue: newEntity.canonical,
        },
        confidence: 0.95,
        reason: `replace ${oldEntity.field}: ${oldEntity.canonical} → ${newEntity.canonical}`,
      }
    }
  }

  // Pattern C: "Y로 바꿔/변경" (old is inferred from existing filters)
  const patC = lower.match(/(\S+?)(?:로|으로)\s*(?:바꿔|바꾸|변경|교체)/u)
  if (patC) {
    const newEntity = resolveEntityOrNumeric(patC[1])
    if (newEntity) {
      const existing = existingFilters.find(f => f.field === newEntity.field)
      return {
        intent: {
          type: "replace_field",
          field: newEntity.field,
          oldValue: existing ? String(existing.rawValue) : undefined,
          newValue: newEntity.canonical,
        },
        confidence: existing ? 0.93 : 0.85,
        reason: `replace ${newEntity.field}: ${existing ? String(existing.rawValue) : "?"} → ${newEntity.canonical}`,
      }
    }
  }

  return null
}

// ── Exclude Parser ───────────────────────────────────────────

/** "X 빼고", "X 아닌걸로", "X 제외하고", "X만 아니면" */
function parseExclude(
  lower: string,
  existingFilters: AppliedFilter[],
): EditIntentResult | null {
  // Strategy: instead of capturing entity text with regex alone (fails for multi-word
  // entities like "CRX S"), we detect the edit-verb position and try extractEntities
  // on the text BEFORE the verb.
  const EXCLUDE_VERBS = [
    /\s+(?:타입|종류|형상|코팅|계열)\s*(?:말고|빼고|제외|외에)/iu,
    /\s*(?:말고|빼고|제외)\s*(?:하고|해|하)?/iu,
    /(?:이|가|을|를)\s*(?:아닌|않은|아니고)/iu,
    /\s+(?:아닌|않은|아니고)/iu,
    /(?:만\s*아니면)/iu,
    /(?:not|except|without|exclude)\s+/iu,
  ]

  for (const re of EXCLUDE_VERBS) {
    const match = lower.match(re)
    if (!match || match.index === undefined) continue

    // For English "not/except/without X" — entity is AFTER the verb
    if (/^(?:not|except|without|exclude)/i.test(match[0].trim())) {
      const after = lower.slice(match.index + match[0].length).trim()
      const entities = extractEntities(after)
      if (entities.length > 0) {
        return makeExcludeResult(entities[0])
      }
      continue
    }

    // For Korean — entity is BEFORE the verb
    const before = lower.slice(0, match.index).trim()
    if (!before) continue

    // Try extracting entities from the before-text
    const entities = extractEntities(before)
    if (entities.length > 0) {
      // Use the last entity (closest to the verb)
      return makeExcludeResult(entities[entities.length - 1])
    }

    // Fallback: try resolving the whole before-text as one token
    const resolved = resolveEntityOrNumeric(before)
    if (resolved) {
      return makeExcludeResult(resolved)
    }
  }

  return null
}

function makeExcludeResult(entity: { field: string; canonical: string }): EditIntentResult {
  return {
    intent: { type: "exclude_field", field: entity.field, value: entity.canonical },
    confidence: 0.95,
    reason: `exclude ${entity.field}=${entity.canonical}`,
  }
}

function parseExcludeFromToken(
  token: string,
  _existingFilters: AppliedFilter[],
): EditIntentResult | null {
  const entity = resolveEntityOrNumeric(token)
  if (!entity) return null

  return {
    intent: { type: "exclude_field", field: entity.field, value: entity.canonical },
    confidence: 0.95,
    reason: `exclude ${entity.field}=${entity.canonical}`,
  }
}

// ── Helpers ──────────────────────────────────────────────────

/** KG resolveEntity + numeric extraction + brand fallback */
function resolveEntityOrNumeric(
  token: string,
): { field: string; canonical: string } | null {
  // Try KG entity index first
  const entity = resolveEntity(token)
  if (entity) return { field: entity.field, canonical: entity.canonical }

  // Try full extraction (handles "4날", "10mm", "8파이", "CRX S" via DB brands etc.)
  const entities = extractEntities(token)
  if (entities.length > 0) return { field: entities[0].field, canonical: entities[0].canonical }

  // Try with Korean particles stripped
  const stripped = token.replace(/[이가을를은는의도로으와과에서]$/u, "").trim()
  if (stripped !== token) {
    const strippedEntity = resolveEntity(stripped)
    if (strippedEntity) return { field: strippedEntity.field, canonical: strippedEntity.canonical }
    const strippedEntities = extractEntities(stripped)
    if (strippedEntities.length > 0) return { field: strippedEntities[0].field, canonical: strippedEntities[0].canonical }
  }

  return null
}

/** Entity의 field를 추론 (token이 entity에 직접 매핑 안 될 때) */
function inferFieldFromEntity(token: string): string | null {
  return extractFieldFromKorean(token)
}

/** Normalize identifier for comparison: strip hyphens, spaces, lowercase */
function normalizeIdentifier(s: string): string {
  return s.toLowerCase().replace(/[-\s]/g, "")
}

// ── Applier: EditIntent → Filter Mutations ───────────────────

export interface EditApplyResult {
  /** 제거할 필터 인덱스들 */
  removeIndices: number[]
  /** 추가할 필터 */
  addFilter: AppliedFilter | null
  /** go_back 호출 필요 */
  goBack: boolean
}

/**
 * EditIntent를 현재 필터 배열에 적용할 mutation을 계산.
 * 실제 배열 수정은 호출자가 합니다.
 */
export function applyEditIntent(
  intent: EditIntent,
  existingFilters: AppliedFilter[],
  turnCount: number,
): EditApplyResult {
  switch (intent.type) {
    case "replace_field": {
      // same-field의 기존 eq 필터 제거 + 새 eq 추가
      const removeIndices = existingFilters
        .map((f, i) => (f.field === intent.field && f.op === "eq") ? i : -1)
        .filter(i => i >= 0)

      const addFilter: AppliedFilter = {
        field: intent.field,
        op: "eq",
        value: intent.newValue,
        rawValue: intent.newValue,
        appliedAt: turnCount,
      }

      return { removeIndices, addFilter, goBack: false }
    }

    case "exclude_field": {
      // same-field의 기존 eq 필터가 같은 값이면 제거
      // Normalize hyphens/spaces for brand-like identifiers
      const normExclude = normalizeIdentifier(intent.value)
      const removeIndices = existingFilters
        .map((f, i) =>
          f.field === intent.field && f.op === "eq" &&
          normalizeIdentifier(String(f.rawValue)) === normExclude
            ? i
            : -1
        )
        .filter(i => i >= 0)

      const addFilter: AppliedFilter = {
        field: intent.field,
        op: "neq",
        value: `${intent.value} 제외`,
        rawValue: intent.value,
        appliedAt: turnCount,
      }

      return { removeIndices, addFilter, goBack: false }
    }

    case "clear_field": {
      const removeIndices = existingFilters
        .map((f, i) => f.field === intent.field ? i : -1)
        .filter(i => i >= 0)

      return { removeIndices, addFilter: null, goBack: false }
    }

    case "go_back_then_apply": {
      const innerResult = applyEditIntent(intent.inner, existingFilters, turnCount)
      return { ...innerResult, goBack: true }
    }

    case "reset_all": {
      const removeIndices = existingFilters.map((_, i) => i)
      return { removeIndices, addFilter: null, goBack: false }
    }
  }
}
