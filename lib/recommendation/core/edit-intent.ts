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

type DeterministicEditHintAction = {
  type?: string | null
  field?: string | null
  value?: unknown
  op?: string | null
}

// ── Edit Signal Detection ────────────────────────────────────

/** 수정 동사/조사가 포함되어 있는지 빠르게 판별 */
export function hasEditSignal(msg: string): boolean {
  return EDIT_SIGNAL_RE.test(msg) || RESET_SIGNAL_RE.test(msg)
}

const EDIT_SIGNAL_RE =
  /(?:\uB9D0\uACE0|\uBE7C\uACE0|\uC81C\uC678|\uC544\uB2CC|\uC5C6|\uC544\uB2C8\uACE0|\uC544\uB2C8\uBA74|\uC544\uB2C8\uC5D0\uC694|\uC544\uB2D9\uB2C8\uB2E4|\uC544\uB2CC\uB370\uB3C4|\uBC14\uAFD4|\uBC14\uAFB8|\uBCC0\uACBD|\uAD50\uCCB4|\uC5D0\uC11C\s*\S+\s*(?:\uB85C|\uC73C\uB85C)|\uC0C1\uAD00\s*\uC5C6(?:\uC5B4|\uC5B4\uC694|\uC74C)?|\uC544\uBB34\uAC70\uB098|\uBB50\uB4E0|\uB2E4\s*\uAD1C\uCC2E(?:\uC544|\uC544\uC694)?|\uBB34\uAD00|\uC694\uCCAD\s*(?:\uD55C\s*\uC801\s*\uC5C6)|\uC798\uBABB)/iu

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
    case "go_back_then_apply":
      return true
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
  stageOneDeterministicActions: DeterministicEditHintAction[] = [],
): EditIntentResult | null {
  if (!hasEditSignal(msg)) return null

  const lower = msg.toLowerCase().trim()

  if (RESET_SIGNAL_RE.test(lower)) {
    return { intent: { type: "reset_all" }, confidence: 0.95, reason: "reset signal" }
  }

  // ── 0. reject_applied_filter ("X는 bug", "X 요청한 적 없", "X 잘못", "X 아닌데요") ──
  // 사용자가 잘못 적용된 필터를 항의 — 현재 필터에서 그 값을 가진 항목을 찾아 clear.
  const REJECT_RE = /(?:잘못|요청\s*(?:한\s*적\s*(?:이\s*)?없|안\s*했|않았)|아닌데요?|아니에요|아닙니다)/iu
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

  // ── 2. go_back_then_apply ("이전으로 돌아가서 X 제외") ──
  // 이전 regex 는 lazy 매칭으로 "돌아가서" 가 capture 에 섞여서 entity 해석 실패.
  // 두 패턴으로 분리: (A) "이전/뒤로 (돌아가서)? X 제외" (B) "돌아가서? X 제외".
  let goBackTokenCapture: string | null = null
  const goBackA = lower.match(
    /^(?:이전|뒤로)\S*(?:\s+돌아가\S*)?\s+(.+?)\s*(?:제외|빼고|말고|없이)\s*$/u
  )
  if (goBackA) {
    goBackTokenCapture = goBackA[1]
  } else {
    const goBackB = lower.match(
      /^돌아가\S*\s+(.+?)\s*(?:제외|빼고|말고|없이)\s*$/u
    )
    if (goBackB) goBackTokenCapture = goBackB[1]
  }
  if (goBackTokenCapture) {
    const innerIntent = parseExcludeFromToken(goBackTokenCapture.trim(), existingFilters)
    if (innerIntent) {
      return {
        intent: { type: "go_back_then_apply", inner: innerIntent.intent },
        confidence: 0.93,
        reason: `go_back + ${innerIntent.reason}`,
      }
    }
  }

  // ── 3. skip_field ("브랜드는 상관없음", "코팅 관계없어", "소재 아무거나") ──
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

  // ── 4. replace_field ("X 말고 Y로", "X에서 Y로 바꿔줘") ──
  const replaceResult = parseReplace(lower, existingFilters)
  if (replaceResult) return replaceResult

  // ── 5. exclude_field ("X 빼고", "X 아닌걸로", "X 제외") ──
  const excludeResult = parseExclude(lower, existingFilters, stageOneDeterministicActions)
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
  stageOneDeterministicActions: DeterministicEditHintAction[] = [],
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

    const hinted = pickSingleDeterministicExcludeCandidate(stageOneDeterministicActions)
    if (hinted) {
      return makeExcludeResult(hinted)
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

function pickSingleDeterministicExcludeCandidate(
  actions: DeterministicEditHintAction[],
): { field: string; canonical: string } | null {
  const candidates = actions
    .filter(action =>
      action.type === "apply_filter"
      && typeof action.field === "string"
      && action.field.length > 0
      && action.value != null
      && action.op !== "neq"
      && action.op !== "skip"
    )
    .map(action => ({
      field: String(action.field),
      canonical: String(action.value).trim(),
    }))
    .filter(candidate => candidate.canonical.length > 0)

  const unique = candidates.filter((candidate, index, source) =>
    source.findIndex(entry =>
      entry.field === candidate.field
      && entry.canonical.toLowerCase() === candidate.canonical.toLowerCase()
    ) === index
  )

  return unique.length === 1 ? unique[0] : null
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
