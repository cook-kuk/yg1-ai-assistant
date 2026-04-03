import { resolveModel, type LLMProvider } from "@/lib/recommendation/infrastructure/llm/recommendation-llm"
import { getFilterFieldLabel, getFilterFieldQueryAliases, getRegisteredFilterFields } from "@/lib/recommendation/shared/filter-field-registry"

const CONSTRAINT_TEXT_PARSER_MODEL = resolveModel("haiku")

type ParsedConstraintText = {
  hintedFields: string[]
  valueCandidates: string[]
  previousText: string | null
}

type ConstraintParseMode = "filter" | "revision"

const FILTER_INTENT_PATTERNS = [
  /\s*(?:로|으로|만|만으로|기준으로)?\s*(?:필터|필터링|적용|추천(?:해줘)?|보여줘?|찾아줘?|검색|좁혀줘?|좁혀).*$/u,
  /\s*(?:만\s*보여줘?|만\s*추천해줘?|만\s*찾아줘?).*$/u,
  /\s*기준으로\s*(?:추천|필터링|검색|적용|보여줘?).*$/u,
]

const REVISION_INTENT_PATTERNS = [
  /\s*(?:로|으로)\s*(?:변경|바꿔|바꿀게|바꿔줘|수정).*$/u,
  /\s*(?:변경|바꿔|바꿀게|바꿔줘|수정).*$/u,
  /\s*(?:이|가)?\s*아니고\s*/u,
  /\s*(?:이|가)?\s*아니라\s*/u,
]

const REVISION_SIGNAL_PATTERN = /(대신|말고|변경|바꿔|바꿀|수정|아니고|아닌|아니라|ㄴㄴ|말했는데|말했잖|이미\s*말한|위에\s*말한|다시\s*말하|switch\s+to|change\s+to|instead\s+of|replace\s+with|i\s+already\s+said|as\s+i\s+said)/iu
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

/**
 * Strip trailing Korean particles (으로, 로, 은, 는, 이, 가, 을, 를, 에, 에서, 도, 만, 요)
 * from revision value candidates. Only applied when the value contains at least one
 * non-Hangul character (letter or digit), so pure-Korean values are left alone, and
 * English-only words like "Roughing" are never affected (no Hangul particle suffix).
 */
function stripTrailingKoreanParticles(value: string): string {
  const trimmed = value.trim()
  // Only strip if there is at least one Latin letter or digit — i.e. the core value is technical
  if (!/[a-zA-Z0-9]/.test(trimmed)) return trimmed
  return trimmed
    .replace(/(?:기준으로|만으로|쪽으로|으로|에서|이나|이가|이를|까지|부터|에도|로|은|는|이|가|을|를|에|도|만|요)$/u, "")
    .trim()
}

function stripValueAffixes(value: string): string {
  return value
    .trim()
    .replace(/^(?:지금\s*후보에서|후보에서|지금|추천은\s*그대로\s*하고|추천은\s*그대로|추천은|일단|그럼|그러면|현재\s*후보에서)\s*/u, "")
    .replace(/^\s*(?:은|는|이|가|을|를|만|기준|기준으로|쪽으로|에서|로|으로)\s*/u, "")
    .replace(/\s*(?:은|는|이|가|을|를|만|기준|기준으로|쪽으로|에서|로|으로)\s*$/u, "")
    .trim()
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

function collectFieldMentions(raw: string, candidateFields?: Set<string>): Array<{ field: string; alias: string; index: number; end: number }> {
  const mentions: Array<{ field: string; alias: string; index: number; end: number }> = []

  for (const field of getRegisteredFilterFields()) {
    if (candidateFields && !candidateFields.has(field)) continue

    const aliases = getFilterFieldQueryAliases(field).sort((a, b) => b.length - a.length)
    for (const alias of aliases) {
      if (!alias.trim()) continue
      const pattern = new RegExp(escapePattern(alias), "igu")
      for (const match of raw.matchAll(pattern)) {
        const index = match.index ?? -1
        if (index < 0) continue
        mentions.push({ field, alias, index, end: index + match[0].length })
      }
    }
  }

  return mentions.sort((a, b) => a.index - b.index || b.alias.length - a.alias.length)
}

function extractValueSpansAroundFieldMentions(
  raw: string,
  candidateFields?: Set<string>,
  intentPatterns: RegExp[] = FILTER_INTENT_PATTERNS
): { hintedFields: string[]; valueCandidates: string[] } {
  const base = stripByPatterns(raw, intentPatterns)
  const mentions = collectFieldMentions(base, candidateFields)
  const hintedFields = uniqueStrings(mentions.map(mention => mention.field))
  const valueCandidates: string[] = []

  for (const mention of mentions) {
    const before = stripValueAffixes(base.slice(0, mention.index))
    const after = stripValueAffixes(base.slice(mention.end))
    const withoutAlias = stripValueAffixes(`${base.slice(0, mention.index)} ${base.slice(mention.end)}`)

    valueCandidates.push(before, after, withoutAlias)
  }

  return {
    hintedFields,
    valueCandidates: uniqueStrings(valueCandidates),
  }
}

function buildFilterValueCandidates(raw: string, candidateFields?: Set<string>): { hintedFields: string[]; valueCandidates: string[] } {
  const leading = matchLeadingFieldPhrase(raw, candidateFields)
  const slotExtraction = extractValueSpansAroundFieldMentions(raw, candidateFields, FILTER_INTENT_PATTERNS)
  const hintedFields = uniqueStrings([
    ...(leading ? [leading.field] : []),
    ...slotExtraction.hintedFields,
    ...collectHintedFields(raw, candidateFields),
  ])

  const strippedRaw = stripByPatterns(raw, FILTER_INTENT_PATTERNS)
  const valueCandidates = uniqueStrings([
    leading?.remainder,
    ...slotExtraction.valueCandidates,
    stripValueAffixes(strippedRaw),
    strippedRaw,
  ])

  return { hintedFields, valueCandidates }
}

function buildRevisionValueCandidates(raw: string): { previousText: string | null; nextValues: string[] } {
  const replaceMatch = raw.match(/(.+?)\s*(?:대신|말고|아니고|아닌|아니라)\s*(.+)$/u)
  if (replaceMatch) {
    const previousSlot = extractValueSpansAroundFieldMentions(replaceMatch[1], undefined, REVISION_INTENT_PATTERNS)
    const nextSlot = extractValueSpansAroundFieldMentions(replaceMatch[2], undefined, REVISION_INTENT_PATTERNS)
    return {
      previousText: previousSlot.valueCandidates[0]
        ?? stripValueAffixes(stripLeadingParticles(stripByPatterns(replaceMatch[1], REVISION_INTENT_PATTERNS))),
      nextValues: uniqueStrings([
        ...nextSlot.valueCandidates.map(stripTrailingKoreanParticles),
        stripTrailingKoreanParticles(stripLeadingParticles(stripByPatterns(replaceMatch[2], REVISION_INTENT_PATTERNS))),
      ]),
    }
  }

  // "X에서 Y으로 바꿔" pattern — Korean from-to revision
  const fromToMatch = raw.match(/(.+?)에서\s*(.+?)(?:로|으로)\s*(?:변경|바꿔|바꿀게|바꿔줘|수정|교체)/u)
  if (fromToMatch) {
    const previousSlot = extractValueSpansAroundFieldMentions(fromToMatch[1], undefined, REVISION_INTENT_PATTERNS)
    const nextSlot = extractValueSpansAroundFieldMentions(fromToMatch[2], undefined, REVISION_INTENT_PATTERNS)
    return {
      previousText: previousSlot.valueCandidates[0]
        ?? stripValueAffixes(stripLeadingParticles(stripByPatterns(fromToMatch[1], REVISION_INTENT_PATTERNS))),
      nextValues: uniqueStrings([
        ...nextSlot.valueCandidates.map(stripTrailingKoreanParticles),
        stripTrailingKoreanParticles(stripLeadingParticles(stripByPatterns(fromToMatch[2], REVISION_INTENT_PATTERNS))),
      ]),
    }
  }

  const directChangeMatch = raw.match(/(.+?)(?:로|으로)\s*(?:변경|바꿔|바꿀게|바꿔줘|수정)/u)
  const directSlot = extractValueSpansAroundFieldMentions(raw, undefined, REVISION_INTENT_PATTERNS)
  return {
    previousText: null,
    nextValues: uniqueStrings([
      ...directSlot.valueCandidates.map(stripTrailingKoreanParticles),
      directChangeMatch ? stripTrailingKoreanParticles(stripLeadingParticles(directChangeMatch[1])) : null,
      stripTrailingKoreanParticles(stripLeadingParticles(stripByPatterns(raw, REVISION_INTENT_PATTERNS))),
    ]),
  }
}

function buildFieldGuide(candidateFields?: Iterable<string>): string {
  const fieldSet = candidateFields ? new Set(candidateFields) : null

  return getRegisteredFilterFields()
    .filter(field => !fieldSet || fieldSet.has(field))
    .map(field => {
      const label = getFilterFieldLabel(field)
      const aliases = getFilterFieldQueryAliases(field).filter(Boolean).join(", ")
      return `- ${field}: label=${label}; aliases=[${aliases}]`
    })
    .join("\n")
}

function parseConstraintLlmJson(raw: string): {
  intent: "filter" | "revision" | "none"
  fields: string[]
  value: string | null
  previousValue: string | null
} | null {
  try {
    const cleaned = raw.trim().replace(/```json\n?|\n?```/g, "")
    const parsed = JSON.parse(cleaned)
    const intent = parsed.intent === "filter" || parsed.intent === "revision" ? parsed.intent : "none"
    const fields = Array.isArray(parsed.fields)
      ? parsed.fields.map((field: unknown) => String(field ?? "").trim()).filter(Boolean)
      : parsed.field
        ? [String(parsed.field).trim()].filter(Boolean)
        : []
    const value = parsed.value == null ? null : String(parsed.value).trim() || null
    const previousValue = parsed.previousValue == null ? null : String(parsed.previousValue).trim() || null

    return { intent, fields, value, previousValue }
  } catch {
    return null
  }
}

async function extractConstraintSlotsWithLLM(
  raw: string,
  mode: ConstraintParseMode,
  provider?: LLMProvider | null,
  candidateFields?: Iterable<string>
): Promise<ParsedConstraintText | null> {
  if (!provider?.available()) return null

  const fieldGuide = buildFieldGuide(candidateFields)
  const modeRule = mode === "filter"
    ? `사용자가 "필터링/좁히기/보여주기" 요청인지 판단하세요.`
    : `사용자가 기존 조건을 다른 값으로 "변경/교체"하려는지 판단하세요.`

  const prompt = `다음 사용자 문장에서 제약 조건 슬롯을 추출하세요.

문장:
${raw}

가능한 field 목록:
${fieldGuide}

규칙:
- ${modeRule}
- 결과는 JSON만 반환하세요.
- field는 반드시 field 목록의 id만 사용하세요.
- value는 실제 적용하려는 값 span만 넣으세요.
- 조사, "필터링", "추천해줘", "보여줘" 같은 의도 표현은 value에 포함하지 마세요.
- mode가 revision이면 previousValue도 추출하세요. 없으면 null.
- 확실하지 않으면 intent를 "none"으로 두세요.

형식:
{"intent":"filter|revision|none","fields":["fieldId"],"value":"...","previousValue":"..."}
`

  try {
    const rawResponse = await provider.complete(
      "당신은 추천 검색용 제약 슬롯 추출기입니다. JSON만 반환하세요.",
      [{ role: "user", content: prompt }],
      800,
      CONSTRAINT_TEXT_PARSER_MODEL
    )
    const parsed = parseConstraintLlmJson(rawResponse)
    if (!parsed) return null
    if (parsed.intent === "none") return null
    if (parsed.intent !== mode) return null

    return {
      hintedFields: uniqueStrings(parsed.fields),
      valueCandidates: uniqueStrings([parsed.value]),
      previousText: parsed.previousValue,
    }
  } catch {
    return null
  }
}

export function hasExplicitRevisionIntent(value: string): boolean {
  return REVISION_SIGNAL_PATTERN.test(value)
}

export function hasExplicitFilterIntent(value: string): boolean {
  return FILTER_SIGNAL_PATTERN.test(value)
}

export async function parseExplicitFilterText(
  raw: string,
  candidateFields?: Iterable<string>,
  provider?: LLMProvider | null
): Promise<ParsedConstraintText> {
  const llmParsed = await extractConstraintSlotsWithLLM(raw.trim(), "filter", provider, candidateFields)
  if (llmParsed) return llmParsed

  const fieldSet = candidateFields ? new Set(candidateFields) : undefined
  const { hintedFields, valueCandidates } = buildFilterValueCandidates(raw.trim(), fieldSet)
  return {
    hintedFields,
    valueCandidates,
    previousText: null,
  }
}

export async function parseExplicitRevisionText(
  raw: string,
  candidateFields?: Iterable<string>,
  provider?: LLMProvider | null
): Promise<ParsedConstraintText> {
  const llmParsed = await extractConstraintSlotsWithLLM(raw.trim(), "revision", provider, candidateFields)
  if (llmParsed) return llmParsed

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
