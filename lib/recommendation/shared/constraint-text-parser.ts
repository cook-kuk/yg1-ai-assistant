import { getFilterFieldLabel, getFilterFieldQueryAliases, getRegisteredFilterFields } from "@/lib/recommendation/shared/filter-field-registry"

type ParsedConstraintText = {
  hintedFields: string[]
  valueCandidates: string[]
  previousText: string | null
}

const FILTER_INTENT_PATTERNS = [
  /\s*(?:로|으로)\s*(?:필터|필터링|적용|추천(?:해줘)?|보여줘?|찾아줘?|검색).*$/u,
  /\s*(?:만\s*보여줘?|만\s*추천해줘?).*$/u,
  /\s*기준으로\s*(?:추천|필터링|검색).*$/u,
]

const REVISION_INTENT_PATTERNS = [
  /\s*(?:로|으로)\s*(?:변경|바꿔|바꿀게|바꿔줘|수정).*$/u,
  /\s*(?:변경|바꿔|바꿀게|바꿔줘|수정).*$/u,
]

const REVISION_SIGNAL_PATTERN = /(대신|말고|변경|바꿔|바꿀|수정)/u
const FILTER_SIGNAL_PATTERN = /(필터|필터링|적용|좁혀|추천|추천해|추천해줘|보여|찾아|검색|기준으로|만\s*(?:보여|추천|찾)|로\s*추천|으로\s*추천)/u

function normalizeQueryText(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, "")
}

function uniqueStrings(values: Array<string | null | undefined>): string[] {
  const result: string[] = []
  const seen = new Set<string>()

  for (const value of values) {
    const clean = String(value ?? "").trim()
    if (!clean || seen.has(clean)) continue
    seen.add(clean)
    result.push(clean)
  }

  return result
}

function stripByPatterns(value: string, patterns: RegExp[]): string {
  let clean = value.trim()
  for (const pattern of patterns) {
    clean = clean.replace(pattern, "").trim()
  }
  return clean
}

function stripLeadingParticles(value: string): string {
  return value.trim().replace(/^[은는이가을를]\s*/u, "").trim()
}

function escapePattern(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

function collectHintedFields(raw: string, candidateFields?: Set<string>): string[] {
  const normalizedRaw = normalizeQueryText(raw)
  const matches: string[] = []

  for (const field of getRegisteredFilterFields()) {
    if (candidateFields && !candidateFields.has(field)) continue

    const aliases = getFilterFieldQueryAliases(field)
      .map(alias => normalizeQueryText(alias))
      .filter(alias => alias.length >= 2)

    if (aliases.some(alias => normalizedRaw.includes(alias))) {
      matches.push(field)
    }
  }

  return uniqueStrings(matches)
}

function matchLeadingFieldPhrase(raw: string, candidateFields?: Set<string>): { field: string; remainder: string } | null {
  for (const field of getRegisteredFilterFields()) {
    if (candidateFields && !candidateFields.has(field)) continue

    const aliases = getFilterFieldQueryAliases(field).sort((a, b) => b.length - a.length)
    for (const alias of aliases) {
      if (!alias.trim()) continue
      const pattern = new RegExp(`^${escapePattern(alias)}\\s*(?:은|는|이|가|을|를|로|으로)?\\s*(.+)$`, "iu")
      const match = raw.match(pattern)
      if (!match) continue
      return { field, remainder: match[1].trim() }
    }
  }

  return null
}

function buildFilterValueCandidates(raw: string, candidateFields?: Set<string>): { hintedFields: string[]; valueCandidates: string[] } {
  const leading = matchLeadingFieldPhrase(raw, candidateFields)
  const hintedFields = uniqueStrings([
    ...(leading ? [leading.field] : []),
    ...collectHintedFields(raw, candidateFields),
  ])

  const strippedRaw = stripByPatterns(raw, FILTER_INTENT_PATTERNS)
  const valueCandidates = uniqueStrings([
    leading?.remainder,
    strippedRaw,
  ])

  return { hintedFields, valueCandidates }
}

function buildRevisionValueCandidates(raw: string): { previousText: string | null; nextValues: string[] } {
  const replaceMatch = raw.match(/(.+?)\s*(?:대신|말고)\s*(.+)$/u)
  if (replaceMatch) {
    return {
      previousText: stripLeadingParticles(stripByPatterns(replaceMatch[1], REVISION_INTENT_PATTERNS)),
      nextValues: uniqueStrings([
        stripLeadingParticles(stripByPatterns(replaceMatch[2], REVISION_INTENT_PATTERNS)),
        stripLeadingParticles(stripByPatterns(raw, REVISION_INTENT_PATTERNS)),
      ]),
    }
  }

  const directChangeMatch = raw.match(/(.+?)(?:로|으로)\s*(?:변경|바꿔|바꿀게|바꿔줘|수정)/u)
  return {
    previousText: null,
    nextValues: uniqueStrings([
      directChangeMatch ? stripLeadingParticles(directChangeMatch[1]) : null,
      stripLeadingParticles(stripByPatterns(raw, REVISION_INTENT_PATTERNS)),
    ]),
  }
}

export function hasExplicitRevisionIntent(value: string): boolean {
  return REVISION_SIGNAL_PATTERN.test(value)
}

export function hasExplicitFilterIntent(value: string): boolean {
  return FILTER_SIGNAL_PATTERN.test(value)
}

export function parseExplicitFilterText(
  raw: string,
  candidateFields?: Iterable<string>
): ParsedConstraintText {
  const fieldSet = candidateFields ? new Set(candidateFields) : undefined
  const { hintedFields, valueCandidates } = buildFilterValueCandidates(raw.trim(), fieldSet)
  return {
    hintedFields,
    valueCandidates,
    previousText: null,
  }
}

export function parseExplicitRevisionText(
  raw: string,
  candidateFields?: Iterable<string>
): ParsedConstraintText {
  const fieldSet = candidateFields ? new Set(candidateFields) : undefined
  const { previousText, nextValues } = buildRevisionValueCandidates(raw.trim())
  return {
    hintedFields: collectHintedFields(raw.trim(), fieldSet),
    valueCandidates: nextValues,
    previousText,
  }
}

export function buildConstraintClarificationQuestion(fields: string[], valueCandidates: string[]): string {
  const value = valueCandidates[0] ?? "해당 값"
  const labels = uniqueStrings(fields.map(field => getFilterFieldLabel(field)))

  if (labels.length === 0) {
    return `어떤 조건을 "${value}"로 바꾸실지 다시 말씀해주세요. 예: "형상을 ${value}으로 변경".`
  }

  if (labels.length === 1) {
    return `어떤 조건을 바꾸실지 조금 더 구체적으로 말씀해주세요. 예: "${labels[0]}을 ${value}으로 변경".`
  }

  return `어떤 조건을 "${value}"로 바꾸실지 다시 말씀해주세요. 현재 문장만으로는 ${labels.join(", ")} 중 무엇을 바꾸려는지 모호합니다.`
}
