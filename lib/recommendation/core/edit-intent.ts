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
import { resolveFieldFromKorean, getFieldKoMap } from "./auto-synonym"
import type { AppliedFilter } from "@/lib/types/exploration"

// ── Types ────────────────────────────────────────────────────

export type EditIntent =
  | { type: "replace_field"; field: string; oldValue?: string; newValue: string }
  | { type: "exclude_field"; field: string; value: string }
  | { type: "skip_field"; field: string }
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
  return DETERMINISTIC_EDIT_SIGNAL_RE.test(msg) || RESET_SIGNAL_RE.test(msg)
}

const DETERMINISTIC_EDIT_SIGNAL_RE =
  /(?:\uC0C1\uAD00\s*\uC5C6(?:\uC5B4|\uC5B4\uC694|\uC74C)?|\uC544\uBB34\uAC70\uB098|\uBB50\uB4E0|\uB2E4\s*\uAD1C\uCC2E(?:\uC544|\uC544\uC694)?|\uBB34\uAD00|\uC798\uBABB|\uD2C0\uB838|\uC624\uD574|\uC694\uCCAD\s*(?:\uD55C\s*\uC801\s*(?:\uC774\s*)?\uC5C6|\uC548\s*\uD588|\uC54A\uC558))/iu

const RESET_SIGNAL_RE =
  /^\s*(?:\uCC98\uC74C\uBD80\uD130\s*\uB2E4\uC2DC(?:\s*\uC2DC\uC791)?|\uB2E4\uC2DC\s*\uCC98\uC74C\uBD80\uD130|\uB2E4\uC2DC\s*\uC2DC\uC791|\uCD08\uAE30\uD654|\uB9AC\uC14B|reset)\s*[.!?~]*\s*$/iu

const CLEAR_SIGNAL_RE =
  /(?:\uC0C1\uAD00\s*\uC5C6(?:\uC5B4|\uC5B4\uC694|\uC74C)?|\uC544\uBB34\uAC70\uB098|\uBB50\uB4E0|\uB2E4\s*\uAD1C\uCC2E(?:\uC544|\uC544\uC694)?|\uBB34\uAD00)/iu

// ── Field Name Patterns ──────────────────────────────────────
// 한국어 필드 키워드 매핑은 auto-synonym 에서 자동 생성 (DB 스키마 기반).
// "브랜드는 상관없음" → field="brand" 추출. 토큰 단위로 매핑 검색 후
// fallback 으로 메시지 substring 검색.

function extractFieldFromKorean(msg: string): string | null {
  const direct = resolveFieldFromKorean(msg)
  if (direct) return direct
  // substring fallback — 긴 키부터 검사해서 메시지 안 어디에 있어도 잡음
  const lower = msg.toLowerCase()
  for (const key of fieldKeysByLengthDesc()) {
    if (lower.includes(key)) {
      const f = resolveFieldFromKorean(key)
      if (f) return f
    }
  }
  return null
}

let _sortedFieldKeys: string[] | null = null
function fieldKeysByLengthDesc(): string[] {
  if (_sortedFieldKeys) return _sortedFieldKeys
  _sortedFieldKeys = Array.from(getFieldKoMap().keys()).sort((a, b) => b.length - a.length)
  return _sortedFieldKeys
}

function extractNearestFieldBeforeIndex(msg: string, untilIndex: number): string | null {
  const lower = msg.toLowerCase()
  let best: { field: string; index: number; length: number } | null = null

  for (const key of fieldKeysByLengthDesc()) {
    const field = resolveFieldFromKorean(key)
    if (!field) continue
    const normalizedKey = key.toLowerCase()

    let searchFrom = 0
    while (searchFrom < lower.length) {
      const idx = lower.indexOf(normalizedKey, searchFrom)
      if (idx < 0) break
      if (idx < untilIndex && (!best || idx > best.index || (idx === best.index && normalizedKey.length > best.length))) {
        best = { field, index: idx, length: normalizedKey.length }
      }
      searchFrom = idx + Math.max(1, normalizedKey.length)
    }
  }

  return best?.field ?? null
}

function inferFieldFromTrailingSegment(segment: string): string | null {
  const trimmed = segment.trim()
  if (!trimmed) return null

  const entities = extractEntities(trimmed)
  const lastEntity = entities[entities.length - 1]
  if (lastEntity?.field) return lastEntity.field

  const tokens = trimmed.split(/\s+/).filter(Boolean)
  for (let index = tokens.length - 1; index >= 0; index--) {
    const token = tokens[index]
    const field = extractFieldFromKorean(token) ?? inferFieldFromEntity(token)
    if (field) return field
  }

  return null
}

function flattenEditIntents(intent: EditIntent): EditIntent[] {
  if (intent.type === "go_back_then_apply") {
    return [intent, ...flattenEditIntents(intent.inner)]
  }
  return [intent]
}

export function shouldExecuteEditIntentDeterministically(
  result: EditIntentResult | null | undefined,
): boolean {
  if (!result) return false

  switch (result.intent.type) {
    case "reset_all":
    case "skip_field":
    case "clear_field":
      return true
    case "go_back_then_apply":
    case "replace_field":
    case "exclude_field":
      return false
  }
}

export function getEditIntentAffectedFields(
  result: EditIntentResult | null | undefined,
): string[] {
  if (!result) return []

  const fields = flattenEditIntents(result.intent)
    .flatMap(intent => {
      switch (intent.type) {
        case "replace_field":
        case "exclude_field":
        case "skip_field":
        case "clear_field":
          return [intent.field]
        default:
          return []
      }
    })
    .filter((field): field is string => typeof field === "string" && field.length > 0)

  return Array.from(new Set(fields))
}

export function getEditIntentHintTokens(
  result: EditIntentResult | null | undefined,
): string[] {
  if (!result) return []

  const tokens = flattenEditIntents(result.intent)
    .flatMap(intent => {
      switch (intent.type) {
        case "replace_field":
          return [intent.oldValue ?? null, intent.newValue]
        case "exclude_field":
          return [intent.value]
        default:
          return []
      }
    })
    .map(token => String(token ?? "").trim())
    .filter(Boolean)

  return Array.from(new Set(tokens))
}

function inferSkipFieldFromMessage(msg: string, signalIndex: number): string | null {
  const beforeSignal = msg.slice(0, Math.max(0, signalIndex)).trim()
  return extractFieldFromKorean(beforeSignal)
    ?? extractNearestFieldBeforeIndex(msg, signalIndex)
    ?? inferFieldFromTrailingSegment(beforeSignal)
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
  _stageOneDeterministicActions: unknown[] = [],
): EditIntentResult | null {
  if (!hasEditSignal(msg)) return null

  const lower = msg.toLowerCase().trim()

  if (RESET_SIGNAL_RE.test(lower)) {
    return { intent: { type: "reset_all" }, confidence: 0.95, reason: "reset signal" }
  }

  // ── 0. reject_applied_filter ("X 잘못", "X 요청한 적 없") ──
  // 사용자가 잘못 적용된 필터를 항의 — 현재 필터에서 그 값을 가진 항목을 찾아 clear.
  const REJECT_RE = /(?:잘못|틀렸|오해|요청\s*(?:한\s*적\s*(?:이\s*)?없|안\s*했|않았))/iu
  if (REJECT_RE.test(lower) && existingFilters.length > 0) {
    // (a) 메시지에 등장한 엔티티가 현재 필터와 매칭되면 그 field clear
    const entities = extractEntities(msg)
    for (const ent of entities) {
      const hit = existingFilters.find(
        f => f.field === ent.field &&
             normalizeIdentifier(String(f.rawValue)) === normalizeIdentifier(ent.canonical)
      )
      if (hit) {
        return {
          intent: { type: "clear_field", field: ent.field },
          confidence: 0.95,
          reason: `reject ${ent.field}=${ent.canonical} (user denied)`,
        }
      }
    }
    // (b) entity 매칭 실패 → 메시지에서 한국어 field 키워드(브랜드/코팅/...)
    //     를 추출. 그 field가 현재 필터에 있으면 clear.
    const fieldFromKo = extractFieldFromKorean(msg)
    if (fieldFromKo && existingFilters.some(f => f.field === fieldFromKo)) {
      return {
        intent: { type: "clear_field", field: fieldFromKo },
        confidence: 0.9,
        reason: `reject ${fieldFromKo} field (user denied, no entity)`,
      }
    }
  }

  // ── 1. reset_all ──
  if (/(?:처음부터|다시\s*시작|초기화|리셋|^reset$)/iu.test(lower)) {
    return { intent: { type: "reset_all" }, confidence: 0.95, reason: "reset signal" }
  }

  // ── 2. skip_field ("브랜드는 상관없음", "코팅 관계없어", "소재 아무거나") ──
  const clearSignal = CLEAR_SIGNAL_RE.exec(lower)
  if (clearSignal && clearSignal.index != null) {
    const field = inferSkipFieldFromMessage(msg, clearSignal.index)
    if (field) {
      return {
        intent: { type: "skip_field", field },
        confidence: 0.93,
        reason: `skip ${field}`,
      }
    }
  }

  return null
}

/** Entity의 field를 추론 (token이 entity에 직접 매핑 안 될 때) */
function inferFieldFromEntity(token: string): string | null {
  const field = resolveFieldFromKorean(token)
  if (field) return field
  const entity = resolveEntity(token)
  if (entity) return entity.field
  return null
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

    case "skip_field": {
      const removeIndices = existingFilters
        .map((f, i) => f.field === intent.field ? i : -1)
        .filter(i => i >= 0)

      const addFilter: AppliedFilter = {
        field: intent.field,
        op: "skip",
        value: "상관없음",
        rawValue: "skip",
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
