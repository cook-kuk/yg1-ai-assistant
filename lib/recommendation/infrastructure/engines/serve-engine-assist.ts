import {
  BrandReferenceRepo,
  EvidenceRepo,
  EntityProfileRepo,
  InventoryRepo,
  ProductRepo,
  type BrandProfileRecord,
  type SeriesProfileRecord,
} from "@/lib/recommendation/infrastructure/repositories/recommendation-repositories"
import { getSessionCache } from "@/lib/recommendation/infrastructure/cache/session-cache"
import { classifyQueryTarget } from "@/lib/recommendation/domain/context/query-target-classifier"
import { detectJourneyPhase, isPostResultPhase } from "@/lib/recommendation/domain/context/journey-phase-detector"
import { resolveYG1Query } from "@/lib/knowledge/knowledge-router"
import { resolveMaterialTag } from "@/lib/recommendation/domain/recommendation-domain"
import { getProvider, resolveModel } from "@/lib/recommendation/infrastructure/llm/recommendation-llm"
import { YG1_COMPANY_SNIPPET } from "@/lib/knowledge/company-prompt-snippet"
import {
  buildCuttingToolSubtypeTaxonomyKnowledgeBlock,
  isCuttingToolTaxonomyKnowledgeQuestion,
} from "@/lib/shared/domain/cutting-tool-routing-knowledge"
import type { LLMProvider } from "@/lib/recommendation/infrastructure/llm/recommendation-llm"

import type {
  CandidateSnapshot,
  ChatMessage,
  ExplorationSessionState,
  ProductIntakeForm,
  RecommendationInput,
  ScoredProduct,
} from "@/lib/recommendation/domain/types"
import { formatConversationContextForLLM } from "@/lib/recommendation/domain/context/conversation-context-formatter"
import {
  TOOL_DOMAIN_PATTERN,
  DIRECT_PRODUCT_CODE_PATTERN,
  DIRECT_SERIES_CODE_PATTERN,
  DIRECT_PRODUCT_CODE_GLOBAL_PATTERN,
  DIRECT_SERIES_CODE_GLOBAL_PATTERN,
  CUTTING_CONDITION_QUERY_PATTERN,
  INVENTORY_QUERY_PATTERN,
  PRODUCT_INFO_TRIGGER_PATTERN,
  BRAND_REFERENCE_TRIGGER_PATTERN,
  ENTITY_PROFILE_TRIGGER_PATTERN,
  SERIES_NAME_ENTITY_PATTERN,
  BRAND_NAME_ENTITY_PATTERN,
  ENTITY_COMPARISON_PATTERN,
  LATIN_ENTITY_PHRASE_PATTERN,
  CUTTING_KNOWLEDGE_PATTERNS,
  KNOWLEDGE_QUESTION_PATTERN,
  SIMPLE_CHAT_PATTERN,
  WORKFLOW_ONLY_PATTERN,
  WORK_PIECE_ALIASES,
  normalizeLookupCode,
  normalizeEntityLookupKey,
  escapeMarkdownTableCell,
  buildMarkdownTable,
  formatStockStatusLabel,
  summarizeInventoryRowsByWarehouse,
  getLatestInventorySnapshotDateFromRows,
  formatHrcRange,
  compactList,
  formatNullableValue,
  formatMmValue,
  formatLengthValue,
  formatAngleValue,
  countValues,
  buildProductInfoChips,
  formatDiameterRange,
  formatFluteCounts,
  dedupeEntityNames,
  collectRegexMatches,
  isLikelyLookupPhrase,
  isLikelyProductLookupCandidate,
} from "./serve-engine-assist-utils"

function findDisplayedCandidateByCode(
  prevState: ExplorationSessionState | null,
  lookupCode: string
): CandidateSnapshot | null {
  if (!prevState?.displayedCandidates?.length) return null

  const normalized = normalizeLookupCode(lookupCode)
  return prevState.displayedCandidates.find(candidate =>
    normalizeLookupCode(candidate.productCode) === normalized ||
    normalizeLookupCode(candidate.displayCode) === normalized
  ) ?? null
}

function detectRequestedProductField(userMessage: string): { label: string; value: string } | null {
  if (/공구\s*소재|재질|카바이드|초경|hss|고속도강/i.test(userMessage)) {
    return { label: "공구 소재", value: "toolMaterial" }
  }
  if (/코팅/i.test(userMessage)) {
    return { label: "코팅", value: "coating" }
  }
  if (/날\s*수|날수|플루트|몇\s*날/i.test(userMessage)) {
    return { label: "날 수", value: "fluteCount" }
  }
  if (/형상|스퀘어|볼|라디우스|테이퍼|radius|ball|square|taper/i.test(userMessage)) {
    return { label: "형상", value: "toolSubtype" }
  }
  if (/직경|지름|몇\s*파이|mm/i.test(userMessage)) {
    return { label: "직경", value: "diameterMm" }
  }
  if (/생크/i.test(userMessage)) {
    return { label: "생크 직경", value: "shankDiameterMm" }
  }
  if (/절삭길이|날길이|loc/i.test(userMessage)) {
    return { label: "절삭 길이", value: "lengthOfCutMm" }
  }
  if (/전장|overall|oal/i.test(userMessage)) {
    return { label: "전장", value: "overallLengthMm" }
  }
  if (/헬릭스/i.test(userMessage)) {
    return { label: "헬릭스각", value: "helixAngleDeg" }
  }
  if (/쿨런트|coolant/i.test(userMessage)) {
    return { label: "쿨런트 홀", value: "coolantHole" }
  }
  if (/시리즈/i.test(userMessage)) {
    return { label: "시리즈", value: "seriesName" }
  }
  if (/브랜드/i.test(userMessage)) {
    return { label: "브랜드", value: "brand" }
  }
  if (/제품명|품명|이름/i.test(userMessage)) {
    return { label: "제품명", value: "productName" }
  }
  return null
}

function getProductFieldValue(
  product: Awaited<ReturnType<typeof ProductRepo.findByCode>>,
  field: string
): string {
  if (!product) return "-"

  switch (field) {
    case "toolMaterial":
      return formatNullableValue(product.toolMaterial)
    case "coating":
      return formatNullableValue(product.coating)
    case "fluteCount":
      return product.fluteCount == null ? "-" : `${product.fluteCount}날`
    case "toolSubtype":
      return formatNullableValue(product.toolSubtype)
    case "diameterMm":
      return formatMmValue(product.diameterMm)
    case "shankDiameterMm":
      return formatMmValue(product.shankDiameterMm)
    case "lengthOfCutMm":
      return formatLengthValue(product.lengthOfCutMm)
    case "overallLengthMm":
      return formatLengthValue(product.overallLengthMm)
    case "helixAngleDeg":
      return formatAngleValue(product.helixAngleDeg)
    case "coolantHole":
      return product.coolantHole == null ? "-" : product.coolantHole ? "있음" : "없음"
    case "seriesName":
      return formatNullableValue(product.seriesName)
    case "brand":
      return formatNullableValue(product.brand)
    case "productName":
      return formatNullableValue(product.productName)
    default:
      return "-"
  }
}

function extractLookupCandidatesFromMessage(userMessage: string): string[] {
  const queryTarget = classifyQueryTarget(userMessage, null, null)
  const names: string[] = [...queryTarget.entities]
  names.push(...collectRegexMatches(DIRECT_PRODUCT_CODE_GLOBAL_PATTERN, userMessage))
  names.push(...collectRegexMatches(DIRECT_SERIES_CODE_GLOBAL_PATTERN, userMessage))
  names.push(...(userMessage.match(SERIES_NAME_ENTITY_PATTERN) ?? []))
  names.push(...(userMessage.match(BRAND_NAME_ENTITY_PATTERN) ?? []))
  names.push(...collectRegexMatches(LATIN_ENTITY_PHRASE_PATTERN, userMessage).filter(isLikelyLookupPhrase))

  for (const match of userMessage.matchAll(ENTITY_COMPARISON_PATTERN)) {
    names.push(match[1], match[2])
  }

  return dedupeEntityNames(names)
}

function extractEntityNamesFromMessage(userMessage: string): string[] {
  return extractLookupCandidatesFromMessage(userMessage)
}

function extractProductLookupCodesFromMessage(userMessage: string): string[] {
  const queryTarget = classifyQueryTarget(userMessage, null, null)
  const codes: string[] = []
  codes.push(...queryTarget.entities.filter(isLikelyProductLookupCandidate))
  codes.push(...collectRegexMatches(DIRECT_PRODUCT_CODE_GLOBAL_PATTERN, userMessage))
  codes.push(...collectRegexMatches(LATIN_ENTITY_PHRASE_PATTERN, userMessage).filter(isLikelyProductLookupCandidate))
  return Array.from(new Set(codes.map(normalizeLookupCode))).filter(Boolean).slice(0, 3)
}

async function resolveEntityProfiles(requestedNames: string[]): Promise<{
  brandProfiles: BrandProfileRecord[]
  seriesProfiles: SeriesProfileRecord[]
}> {
  const limitedNames = requestedNames.slice(0, 8)
  if (limitedNames.length === 0) {
    return { seriesProfiles: [], brandProfiles: [] }
  }

  const cacheKey = `directEntityProfiles:${limitedNames.map(normalizeEntityLookupKey).join(",")}`
  return getSessionCache().getOrFetch(cacheKey, async () => {
    const [seriesProfiles, brandProfiles] = await Promise.all([
      EntityProfileRepo.findSeriesProfiles(limitedNames).catch(() => [] as SeriesProfileRecord[]),
      EntityProfileRepo.findBrandProfiles(limitedNames).catch(() => [] as BrandProfileRecord[]),
    ])

    return { seriesProfiles, brandProfiles }
  })
}

async function findDirectProductByCode(lookupCode: string): Promise<Awaited<ReturnType<typeof ProductRepo.findByCode>>> {
  const normalizedCode = normalizeLookupCode(lookupCode)
  if (!normalizedCode) return null

  const cacheKey = `directProduct:${normalizedCode}`
  return getSessionCache().getOrFetch(cacheKey, () =>
    ProductRepo.findByCode(normalizedCode).catch(() => null)
  )
}

function buildUnmatchedEntityNote(requestedNames: string[], matchedNames: string[]): string {
  if (requestedNames.length === 0) return ""

  const matched = new Set(matchedNames.map(normalizeEntityLookupKey))
  const missing = requestedNames.filter(name => !matched.has(normalizeEntityLookupKey(name)))
  if (missing.length === 0) return ""
  return `일부 이름은 뷰에서 찾지 못했습니다: ${missing.join(", ")}`
}

function getSeriesProfileLabel(profile: SeriesProfileRecord): string {
  return profile.seriesName ?? profile.normalizedSeriesName
}

function getBrandProfileLabel(profile: BrandProfileRecord): string {
  return profile.brandName ?? profile.normalizedBrandName
}

function buildSeriesSummaryRows(profile: SeriesProfileRecord): Array<[string, string]> {
  return [
    ["시리즈", getSeriesProfileLabel(profile)],
    ["브랜드", profile.primaryBrandName ?? "-"],
    ["설명", profile.primaryDescription ?? "-"],
    ["주요 feature", profile.primaryFeature ?? "-"],
    ["공구 타입", compactList([profile.primaryToolType ?? "", profile.primaryProductType ?? ""], 2)],
    ["형상", compactList([profile.primaryApplicationShape ?? "", profile.primaryCuttingEdgeShape ?? "", ...profile.toolSubtypes], 3)],
    ["날 수", formatFluteCounts(profile.fluteCounts)],
    ["코팅", compactList(profile.coatingValues)],
    ["공구 소재", compactList(profile.toolMaterialValues)],
    ["직경 범위", formatDiameterRange(profile.diameterMinMm, profile.diameterMaxMm)],
    ["ISO", compactList(profile.referenceIsoGroups)],
    ["피삭재", compactList(profile.referenceWorkPieceNames.length > 0 ? profile.referenceWorkPieceNames : profile.materialWorkPieceNames)],
    ["HRC", formatHrcRange(profile.referenceHrcMin, profile.referenceHrcMax)],
    ["국가", compactList(profile.countryCodes)],
    ["EDP 수", `${profile.edpCount}개`],
  ]
}

function buildBrandSummaryRows(profile: BrandProfileRecord): Array<[string, string]> {
  return [
    ["브랜드", getBrandProfileLabel(profile)],
    ["설명", profile.primaryDescription ?? "-"],
    ["적용 소재 설명", profile.primaryDescriptionWorkPiece ?? "-"],
    ["대표 시리즈", compactList(profile.seriesNames)],
    ["시리즈 수", `${profile.seriesCount}개`],
    ["가공 타입", compactList([...profile.toolTypes, ...profile.productTypes])],
    ["형상", compactList([...profile.applicationShapeValues, ...profile.cuttingEdgeShapeValues])],
    ["날 수", formatFluteCounts(profile.fluteCounts)],
    ["코팅", compactList(profile.coatingValues)],
    ["공구 소재", compactList(profile.toolMaterialValues)],
    ["직경 범위", formatDiameterRange(profile.diameterMinMm, profile.diameterMaxMm)],
    ["ISO", compactList(profile.referenceIsoGroups)],
    ["피삭재", compactList(profile.referenceWorkPieceNames.length > 0 ? profile.referenceWorkPieceNames : profile.materialWorkPieceNames)],
    ["HRC", formatHrcRange(profile.referenceHrcMin, profile.referenceHrcMax)],
    ["국가", compactList(profile.countryCodes)],
    ["EDP 수", `${profile.edpCount}개`],
  ]
}

function buildSeriesInfoReply(profile: SeriesProfileRecord, unmatchedNote: string): { text: string; chips: string[] } {
  return {
    text: [
      `${getSeriesProfileLabel(profile)} 시리즈 프로필을 내부 DB에서 조회했습니다.`,
      "",
      buildMarkdownTable(
        ["항목", "값"],
        buildSeriesSummaryRows(profile).map(([label, value]) => [label, value])
      ),
      unmatchedNote ? `\n${unmatchedNote}\n` : "",
      "[Reference: YG-1 내부 DB]",
    ].join("\n"),
    chips: ["다른 시리즈 비교", "브랜드 차이 보기", "추천 제품 보기"],
  }
}

function buildBrandInfoReply(profile: BrandProfileRecord, unmatchedNote: string): { text: string; chips: string[] } {
  return {
    text: [
      `${getBrandProfileLabel(profile)} 브랜드 프로필을 내부 DB에서 조회했습니다.`,
      "",
      buildMarkdownTable(
        ["항목", "값"],
        buildBrandSummaryRows(profile).map(([label, value]) => [label, value])
      ),
      unmatchedNote ? `\n${unmatchedNote}\n` : "",
      "[Reference: YG-1 내부 DB]",
    ].join("\n"),
    chips: ["다른 브랜드 비교", "시리즈 차이 보기", "추천 제품 보기"],
  }
}

function buildSeriesComparisonReply(profiles: SeriesProfileRecord[], unmatchedNote: string): { text: string; chips: string[] } {
  const headers = ["항목", ...profiles.map(profile => getSeriesProfileLabel(profile))]
  const rows: Array<Array<string | number | null | undefined>> = [
    ["브랜드", ...profiles.map(profile => profile.primaryBrandName ?? "-")],
    ["설명", ...profiles.map(profile => profile.primaryDescription ?? "-")],
    ["주요 feature", ...profiles.map(profile => profile.primaryFeature ?? "-")],
    ["공구 타입", ...profiles.map(profile => compactList([profile.primaryToolType ?? "", profile.primaryProductType ?? ""], 2))],
    ["형상", ...profiles.map(profile => compactList([profile.primaryApplicationShape ?? "", profile.primaryCuttingEdgeShape ?? "", ...profile.toolSubtypes], 3))],
    ["날 수", ...profiles.map(profile => formatFluteCounts(profile.fluteCounts))],
    ["코팅", ...profiles.map(profile => compactList(profile.coatingValues))],
    ["공구 소재", ...profiles.map(profile => compactList(profile.toolMaterialValues))],
    ["직경 범위", ...profiles.map(profile => formatDiameterRange(profile.diameterMinMm, profile.diameterMaxMm))],
    ["ISO", ...profiles.map(profile => compactList(profile.referenceIsoGroups))],
    ["피삭재", ...profiles.map(profile => compactList(profile.referenceWorkPieceNames.length > 0 ? profile.referenceWorkPieceNames : profile.materialWorkPieceNames))],
    ["HRC", ...profiles.map(profile => formatHrcRange(profile.referenceHrcMin, profile.referenceHrcMax))],
  ]

  return {
    text: [
      `${profiles.map(profile => getSeriesProfileLabel(profile)).join(" vs ")} 시리즈를 내부 DB 기준으로 비교했습니다.`,
      "",
      buildMarkdownTable(headers, rows),
      unmatchedNote ? `\n${unmatchedNote}\n` : "",
      "[Reference: YG-1 내부 DB]",
    ].join("\n"),
    chips: ["다른 시리즈 비교", "브랜드 비교", "추천 제품 보기"],
  }
}

function buildBrandComparisonReply(profiles: BrandProfileRecord[], unmatchedNote: string): { text: string; chips: string[] } {
  const headers = ["항목", ...profiles.map(profile => getBrandProfileLabel(profile))]
  const rows: Array<Array<string | number | null | undefined>> = [
    ["설명", ...profiles.map(profile => profile.primaryDescription ?? "-")],
    ["적용 소재 설명", ...profiles.map(profile => profile.primaryDescriptionWorkPiece ?? "-")],
    ["대표 시리즈", ...profiles.map(profile => compactList(profile.seriesNames))],
    ["시리즈 수", ...profiles.map(profile => `${profile.seriesCount}개`)],
    ["가공 타입", ...profiles.map(profile => compactList([...profile.toolTypes, ...profile.productTypes]))],
    ["형상", ...profiles.map(profile => compactList([...profile.applicationShapeValues, ...profile.cuttingEdgeShapeValues]))],
    ["날 수", ...profiles.map(profile => formatFluteCounts(profile.fluteCounts))],
    ["코팅", ...profiles.map(profile => compactList(profile.coatingValues))],
    ["공구 소재", ...profiles.map(profile => compactList(profile.toolMaterialValues))],
    ["직경 범위", ...profiles.map(profile => formatDiameterRange(profile.diameterMinMm, profile.diameterMaxMm))],
    ["ISO", ...profiles.map(profile => compactList(profile.referenceIsoGroups))],
    ["피삭재", ...profiles.map(profile => compactList(profile.referenceWorkPieceNames.length > 0 ? profile.referenceWorkPieceNames : profile.materialWorkPieceNames))],
    ["HRC", ...profiles.map(profile => formatHrcRange(profile.referenceHrcMin, profile.referenceHrcMax))],
  ]

  return {
    text: [
      `${profiles.map(profile => getBrandProfileLabel(profile)).join(" vs ")} 브랜드를 내부 DB 기준으로 비교했습니다.`,
      "",
      buildMarkdownTable(headers, rows),
      unmatchedNote ? `\n${unmatchedNote}\n` : "",
      "[Reference: YG-1 내부 DB]",
    ].join("\n"),
    chips: ["다른 브랜드 비교", "시리즈 비교", "추천 제품 보기"],
  }
}

function buildSeriesProfileContext(profile: SeriesProfileRecord): string {
  return [
    `시리즈: ${getSeriesProfileLabel(profile)}`,
    `브랜드: ${profile.primaryBrandName ?? "-"}`,
    `설명: ${profile.primaryDescription ?? "-"}`,
    `feature: ${profile.primaryFeature ?? "-"}`,
    `공구 타입: ${compactList([profile.primaryToolType ?? "", profile.primaryProductType ?? ""], 2)}`,
    `형상: ${compactList([profile.primaryApplicationShape ?? "", profile.primaryCuttingEdgeShape ?? "", ...profile.toolSubtypes], 3)}`,
    `날 수: ${formatFluteCounts(profile.fluteCounts)}`,
    `코팅: ${compactList(profile.coatingValues)}`,
    `공구 소재: ${compactList(profile.toolMaterialValues)}`,
    `직경 범위: ${formatDiameterRange(profile.diameterMinMm, profile.diameterMaxMm)}`,
    `ISO: ${compactList(profile.referenceIsoGroups)}`,
    `피삭재: ${compactList(profile.referenceWorkPieceNames.length > 0 ? profile.referenceWorkPieceNames : profile.materialWorkPieceNames)}`,
    `HRC: ${formatHrcRange(profile.referenceHrcMin, profile.referenceHrcMax)}`,
  ].join("\n")
}

function buildBrandProfileContext(profile: BrandProfileRecord): string {
  return [
    `브랜드: ${getBrandProfileLabel(profile)}`,
    `설명: ${profile.primaryDescription ?? "-"}`,
    `적용 소재 설명: ${profile.primaryDescriptionWorkPiece ?? "-"}`,
    `대표 시리즈: ${compactList(profile.seriesNames)}`,
    `시리즈 수: ${profile.seriesCount}개`,
    `가공 타입: ${compactList([...profile.toolTypes, ...profile.productTypes])}`,
    `형상: ${compactList([...profile.applicationShapeValues, ...profile.cuttingEdgeShapeValues])}`,
    `날 수: ${formatFluteCounts(profile.fluteCounts)}`,
    `코팅: ${compactList(profile.coatingValues)}`,
    `공구 소재: ${compactList(profile.toolMaterialValues)}`,
    `직경 범위: ${formatDiameterRange(profile.diameterMinMm, profile.diameterMaxMm)}`,
    `ISO: ${compactList(profile.referenceIsoGroups)}`,
    `피삭재: ${compactList(profile.referenceWorkPieceNames.length > 0 ? profile.referenceWorkPieceNames : profile.materialWorkPieceNames)}`,
    `HRC: ${formatHrcRange(profile.referenceHrcMin, profile.referenceHrcMax)}`,
  ].join("\n")
}

async function buildEntityProfileNarrative(
  provider: LLMProvider,
  promptTitle: string,
  body: string
): Promise<string | null> {
  if (!provider.available()) return null

  try {
    const raw = await provider.complete(
      `당신은 YG-1 절삭공구 데이터 설명 도우미입니다.
주어진 구조화 데이터만 근거로 한국어 요약을 작성하세요.

규칙:
- 3~4문장으로만 작성
- 추측 금지, 데이터에 없는 내용 추가 금지
- 비교 요청이면 차이가 큰 항목부터 먼저 설명
- 단건 요청이면 용도/형상/날 수/적용 소재를 우선 설명
- 문장형 자연어로 쓰고 표는 만들지 마세요`,
      [{ role: "user", content: `${promptTitle}\n\n${body}` }],
      1500
    )

    const text = raw?.trim()
    return text ? text : null
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.warn(`[entity-profile] llm summary failed: ${message}`)
    return null
  }
}

async function enrichEntityReplyWithNarrative(
  provider: LLMProvider,
  reply: { text: string; chips: string[] },
  promptTitle: string,
  body: string
): Promise<{ text: string; chips: string[] }> {
  const narrative = await buildEntityProfileNarrative(provider, promptTitle, body)
  if (!narrative) return reply

  const marker = "[Reference: YG-1 내부 DB]"
  const markerIndex = reply.text.lastIndexOf(marker)
  if (markerIndex < 0) {
    return {
      ...reply,
      text: `${narrative}\n\n${reply.text}`,
    }
  }

  const beforeReference = reply.text.slice(0, markerIndex).trimEnd()
  const referenceTail = reply.text.slice(markerIndex)
  return {
    ...reply,
    text: `${narrative}\n\n${beforeReference}\n\n${referenceTail}`,
  }
}

export async function handleDirectEntityProfileQuestion(
  provider: LLMProvider,
  userMessage: string,
  _currentInput: RecommendationInput,
  _prevState: ExplorationSessionState | null
): Promise<{ text: string; chips: string[] } | null> {
  const queryTarget = classifyQueryTarget(userMessage, null, null)
  if (queryTarget.type === "product_comparison") {
    return null
  }
  const requestedNames = extractEntityNamesFromMessage(userMessage)
  if (requestedNames.length === 0) return null

  const wantsComparison = /차이|비교|vs|대비|다른|달라|다를/i.test(userMessage)
  const mentionsSeries = /시리즈|series|날\s*수|날수|플루트|형상|볼|스퀘어|radius|taper/i.test(userMessage)
  const mentionsBrand = /브랜드|brand/i.test(userMessage)
  const directEntityOnly = requestedNames.length === 1 && normalizeEntityLookupKey(userMessage) === normalizeEntityLookupKey(requestedNames[0])
  const explicitProfileIntent =
    ENTITY_PROFILE_TRIGGER_PATTERN.test(userMessage) ||
    queryTarget.type === "series_info" ||
    queryTarget.type === "series_comparison" ||
    queryTarget.type === "brand_info" ||
    queryTarget.type === "brand_comparison" ||
    (requestedNames.length > 0 && /뭐야|뭐예요|알려|설명|정보|특징|용도|적합/i.test(userMessage)) ||
    directEntityOnly

  if (!explicitProfileIntent) {
    return null
  }
  const resolvedProfiles = await resolveEntityProfiles(requestedNames)
  const seriesProfiles = Array.from(
    new Map(
      resolvedProfiles.seriesProfiles.map(profile => [profile.normalizedSeriesName, profile])
    ).values()
  )
  const brandProfiles = Array.from(
    new Map(
      resolvedProfiles.brandProfiles.map(profile => [profile.normalizedBrandName, profile])
    ).values()
  )

  if (seriesProfiles.length === 0 && brandProfiles.length === 0) {
    return null
  }

  const unmatchedNote = buildUnmatchedEntityNote(requestedNames, [
    ...seriesProfiles.map(profile => getSeriesProfileLabel(profile)),
    ...brandProfiles.map(profile => getBrandProfileLabel(profile)),
  ])

  // 사용자가 2개 이상 entity를 언급하면 명시적 비교 키워드("차이", "비교" 등) 없어도
  // 암묵적 비교로 간주하여 모든 entity 정보를 표시한다.
  // 예: "GMG31과 GMG30 이 두 시리즈의 shank type 정보는 없나요?"
  const implicitMultiEntity = seriesProfiles.length >= 2 || brandProfiles.length >= 2

  if (wantsComparison || implicitMultiEntity) {
    if (mentionsBrand && brandProfiles.length >= 2) {
      return enrichEntityReplyWithNarrative(
        provider,
        buildBrandComparisonReply(brandProfiles, unmatchedNote),
        "브랜드 비교 요청입니다. 아래 구조화 데이터만으로 차이를 요약하세요.",
        brandProfiles.map(profile => buildBrandProfileContext(profile)).join("\n\n---\n\n")
      )
    }
    if (mentionsSeries && seriesProfiles.length >= 2) {
      return enrichEntityReplyWithNarrative(
        provider,
        buildSeriesComparisonReply(seriesProfiles, unmatchedNote),
        "시리즈 비교 요청입니다. 아래 구조화 데이터만으로 차이를 요약하세요.",
        seriesProfiles.map(profile => buildSeriesProfileContext(profile)).join("\n\n---\n\n")
      )
    }
    if (seriesProfiles.length >= 2 && brandProfiles.length < 2) {
      return enrichEntityReplyWithNarrative(
        provider,
        buildSeriesComparisonReply(seriesProfiles, unmatchedNote),
        "시리즈 비교 요청입니다. 아래 구조화 데이터만으로 차이를 요약하세요.",
        seriesProfiles.map(profile => buildSeriesProfileContext(profile)).join("\n\n---\n\n")
      )
    }
    if (brandProfiles.length >= 2 && seriesProfiles.length < 2) {
      return enrichEntityReplyWithNarrative(
        provider,
        buildBrandComparisonReply(brandProfiles, unmatchedNote),
        "브랜드 비교 요청입니다. 아래 구조화 데이터만으로 차이를 요약하세요.",
        brandProfiles.map(profile => buildBrandProfileContext(profile)).join("\n\n---\n\n")
      )
    }
  }

  if (mentionsBrand && brandProfiles.length > 0) {
    return enrichEntityReplyWithNarrative(
      provider,
      buildBrandInfoReply(brandProfiles[0], unmatchedNote),
      "브랜드 단건 설명 요청입니다. 아래 구조화 데이터만으로 특징을 요약하세요.",
      buildBrandProfileContext(brandProfiles[0])
    )
  }
  if (mentionsSeries && seriesProfiles.length > 0) {
    return enrichEntityReplyWithNarrative(
      provider,
      buildSeriesInfoReply(seriesProfiles[0], unmatchedNote),
      "시리즈 단건 설명 요청입니다. 아래 구조화 데이터만으로 특징을 요약하세요.",
      buildSeriesProfileContext(seriesProfiles[0])
    )
  }
  if (seriesProfiles.length > 0 && brandProfiles.length === 0) {
    return enrichEntityReplyWithNarrative(
      provider,
      buildSeriesInfoReply(seriesProfiles[0], unmatchedNote),
      "시리즈 단건 설명 요청입니다. 아래 구조화 데이터만으로 특징을 요약하세요.",
      buildSeriesProfileContext(seriesProfiles[0])
    )
  }
  if (brandProfiles.length > 0 && seriesProfiles.length === 0) {
    return enrichEntityReplyWithNarrative(
      provider,
      buildBrandInfoReply(brandProfiles[0], unmatchedNote),
      "브랜드 단건 설명 요청입니다. 아래 구조화 데이터만으로 특징을 요약하세요.",
      buildBrandProfileContext(brandProfiles[0])
    )
  }

  const primaryName = requestedNames[0] ?? ""
  const looksLikeSeries = /^[A-Z]{2,5}\d/.test(primaryName.replace(/\s+/g, "").toUpperCase())
  if (looksLikeSeries && seriesProfiles.length > 0) {
    return enrichEntityReplyWithNarrative(
      provider,
      buildSeriesInfoReply(seriesProfiles[0], unmatchedNote),
      "시리즈 단건 설명 요청입니다. 아래 구조화 데이터만으로 특징을 요약하세요.",
      buildSeriesProfileContext(seriesProfiles[0])
    )
  }
  if (brandProfiles.length > 0) {
    return enrichEntityReplyWithNarrative(
      provider,
      buildBrandInfoReply(brandProfiles[0], unmatchedNote),
      "브랜드 단건 설명 요청입니다. 아래 구조화 데이터만으로 특징을 요약하세요.",
      buildBrandProfileContext(brandProfiles[0])
    )
  }
  if (seriesProfiles.length > 0) {
    return enrichEntityReplyWithNarrative(
      provider,
      buildSeriesInfoReply(seriesProfiles[0], unmatchedNote),
      "시리즈 단건 설명 요청입니다. 아래 구조화 데이터만으로 특징을 요약하세요.",
      buildSeriesProfileContext(seriesProfiles[0])
    )
  }

  return null
}

export async function handleDirectProductInfoQuestion(
  userMessage: string,
  _currentInput: RecommendationInput,
  prevState: ExplorationSessionState | null
): Promise<{ text: string; chips: string[] } | null> {
  if (INVENTORY_QUERY_PATTERN.test(userMessage) || CUTTING_CONDITION_QUERY_PATTERN.test(userMessage)) {
    return null
  }

  if (/차이|비교|vs|대비/i.test(userMessage)) {
    return null
  }

  const queryTarget = classifyQueryTarget(userMessage, null, null)
  const productLookupCodes = extractProductLookupCodesFromMessage(userMessage)
  const lookupCode = productLookupCodes[0] ?? ""
  const explicitLookupEntity =
    productLookupCodes.length > 0 ||
    queryTarget.entities.length > 0 ||
    DIRECT_PRODUCT_CODE_PATTERN.test(userMessage) ||
    DIRECT_SERIES_CODE_PATTERN.test(userMessage)

  if (isCuttingToolTaxonomyKnowledgeQuestion(userMessage) && !explicitLookupEntity) {
    return null
  }

  const directCodeOnly = lookupCode
    ? normalizeLookupCode(userMessage) === lookupCode
    : false
  const explicitInfoIntent = directCodeOnly || PRODUCT_INFO_TRIGGER_PATTERN.test(userMessage) || queryTarget.type === "product_info"
  if (!explicitInfoIntent) return null

  if (
    !lookupCode &&
    (queryTarget.type === "series_info" ||
      queryTarget.type === "brand_info" ||
      queryTarget.type === "series_comparison" ||
      queryTarget.type === "brand_comparison")
  ) {
    return null
  }

  if (!lookupCode) return null

  const product = await findDirectProductByCode(lookupCode)
  if (!product) {
    const hasCandidates = (prevState?.displayedCandidates?.length ?? 0) > 0
    return {
      text: [
        `${lookupCode} 제품 정보를 내부 DB에서 찾지 못했습니다.`,
        hasCandidates
          ? "현재 후보 제품의 제품코드로 다시 물어보시면 해당 제품 정보를 조회해드릴 수 있습니다."
          : "제품코드를 다시 확인해주세요.",
        "[Reference: YG-1 내부 DB]",
      ].join("\n"),
      chips: hasCandidates ? ["후보 제품 보기", "추천 제품 보기", "처음부터 다시"] : ["제품 추천", "추천 제품 보기", "처음부터 다시"],
    }
  }

  const requestedField = detectRequestedProductField(userMessage)
  const displayCode = product.displayCode || lookupCode

  if (requestedField) {
    const fieldValue = getProductFieldValue(product, requestedField.value)
    return {
      text: [
        `${displayCode}의 ${requestedField.label}는 ${fieldValue}입니다.`,
        "",
        buildMarkdownTable(
          ["항목", "값"],
          [
            ["제품코드", displayCode],
            ["브랜드", product.brand],
            ["시리즈", product.seriesName],
            [requestedField.label, fieldValue],
          ]
        ),
        "",
        "[Reference: YG-1 내부 DB]",
      ].join("\n"),
      chips: buildProductInfoChips(displayCode, true),
    }
  }

  const summaryTable = buildMarkdownTable(
    ["항목", "값"],
    [
      ["제품코드", displayCode],
      ["브랜드", product.brand],
      ["시리즈", product.seriesName],
      ["제품명", product.productName],
      ["형상", product.toolSubtype],
      ["직경", formatMmValue(product.diameterMm)],
      ["날 수", product.fluteCount == null ? "-" : `${product.fluteCount}날`],
      ["코팅", product.coating],
      ["공구 소재", product.toolMaterial],
      ["생크 직경", formatMmValue(product.shankDiameterMm)],
      ["절삭 길이", formatLengthValue(product.lengthOfCutMm)],
      ["전장", formatLengthValue(product.overallLengthMm)],
      ["헬릭스각", formatAngleValue(product.helixAngleDeg)],
      ["쿨런트 홀", product.coolantHole == null ? "-" : product.coolantHole ? "있음" : "없음"],
      ["적용 가공", compactList(product.applicationShapes)],
      ["ISO 소재", compactList(product.materialTags)],
    ]
  )

  const extraLines = [
    product.description ? `설명: ${product.description}` : null,
    product.featureText ? `특징: ${product.featureText}` : null,
  ].filter((line): line is string => Boolean(line))

  return {
    text: [
      `${displayCode} 제품 정보를 내부 DB에서 조회했습니다.`,
      "",
      summaryTable,
      ...(extraLines.length > 0 ? ["", ...extraLines] : []),
      "",
      "[Reference: YG-1 내부 DB]",
    ].join("\n"),
    chips: buildProductInfoChips(displayCode),
  }
}

function extractRequestedWorkPiece(userMessage: string): string | null {
  for (const alias of WORK_PIECE_ALIASES) {
    if (alias.patterns.some(pattern => pattern.test(userMessage))) {
      return alias.canonical
    }
  }
  return null
}

function extractRequestedHardnessRange(userMessage: string): { min: number | null; max: number | null } {
  const rangeMatch = userMessage.match(/(?:hrc|경도)?\s*(\d{1,2}(?:\.\d+)?)\s*[-~]\s*(\d{1,2}(?:\.\d+)?)/i)
  if (rangeMatch) {
    const a = Number.parseFloat(rangeMatch[1])
    const b = Number.parseFloat(rangeMatch[2])
    if (Number.isFinite(a) && Number.isFinite(b)) {
      return { min: Math.min(a, b), max: Math.max(a, b) }
    }
  }

  const singleMatch = userMessage.match(/(?:hrc|경도)\s*(?:약\s*)?(\d{1,2}(?:\.\d+)?)/i)
  if (singleMatch) {
    const value = Number.parseFloat(singleMatch[1])
    if (Number.isFinite(value)) {
      return { min: value, max: value }
    }
  }

  return { min: null, max: null }
}

function summarizeBrandReferenceRows(rows: Awaited<ReturnType<typeof BrandReferenceRepo.findMatches>>) {
  const grouped = new Map<string, {
    tagName: string
    workPieceName: string
    hardnessMinHrc: number | null
    hardnessMaxHrc: number | null
    brands: string[]
  }>()

  for (const row of rows) {
    const key = [
      row.tagName,
      row.workPieceName,
      row.hardnessMinHrc ?? "",
      row.hardnessMaxHrc ?? "",
    ].join("|")
    const existing = grouped.get(key)
    if (existing) {
      if (!existing.brands.includes(row.brandName)) existing.brands.push(row.brandName)
      continue
    }
    grouped.set(key, {
      tagName: row.tagName,
      workPieceName: row.workPieceName,
      hardnessMinHrc: row.hardnessMinHrc,
      hardnessMaxHrc: row.hardnessMaxHrc,
      brands: [row.brandName],
    })
  }

  return [...grouped.values()]
}

export async function handleDirectBrandReferenceQuestion(
  userMessage: string,
  currentInput: RecommendationInput,
  _prevState: ExplorationSessionState | null
): Promise<{ text: string; chips: string[] } | null> {
  const mentionsBrand = /브랜드|brand/i.test(userMessage)
  const hasMaterialContext =
    /iso\s*[pmknsh]/i.test(userMessage) ||
    /hrc|경도/i.test(userMessage) ||
    WORK_PIECE_ALIASES.some(alias => alias.patterns.some(pattern => pattern.test(userMessage)))

  if (!BRAND_REFERENCE_TRIGGER_PATTERN.test(userMessage) && !(mentionsBrand && hasMaterialContext)) {
    return null
  }

  const explicitIso = resolveMaterialTag(userMessage)
  const isoGroup = explicitIso ?? (mentionsBrand ? resolveMaterialTag(currentInput.material ?? "") : null)
  const workPieceName = extractRequestedWorkPiece(userMessage) ?? currentInput.workPieceName ?? null
  const hardnessRange = extractRequestedHardnessRange(userMessage)

  if (!isoGroup && !workPieceName && hardnessRange.min == null && hardnessRange.max == null) {
    return {
      text: [
        "브랜드 기준표는 ISO, 피삭재, HRC 조건으로 조회할 수 있습니다.",
        "예: `ISO H에서 HRC 55는 어떤 브랜드야?`, `스테인레스강 300용 브랜드 추천해줘`",
        "[Reference: YG-1 내부 DB]",
      ].join("\n"),
      chips: ["ISO H 브랜드", "스테인레스강 브랜드", "알루미늄 브랜드"],
    }
  }

  const brandCacheKey = `brandRef:${isoGroup}|${workPieceName}|${hardnessRange.min}-${hardnessRange.max}`
  const rows = await getSessionCache().getOrFetch(brandCacheKey, () =>
    BrandReferenceRepo.findMatches({
      isoGroup,
      workPieceQuery: workPieceName,
      hardnessMinHrc: hardnessRange.min,
      hardnessMaxHrc: hardnessRange.max,
      limit: 40,
    })
  )

  if (rows.length === 0) {
    const conditionTable = buildMarkdownTable(
      ["조건", "값"],
      [
        ["ISO", isoGroup ? `ISO ${isoGroup}` : "-"],
        ["피삭재", workPieceName ?? "-"],
        ["HRC", formatHrcRange(hardnessRange.min, hardnessRange.max)],
      ]
    )

    return {
      text: [
        "요청한 조건에 맞는 reference brand 데이터를 내부 DB에서 찾지 못했습니다.",
        "",
        conditionTable,
        "",
        "[Reference: YG-1 내부 DB]",
      ].join("\n"),
      chips: ["ISO 다시 지정", "HRC 조건 다시 입력", "추천 제품 보기"],
    }
  }

  const groupedRows = summarizeBrandReferenceRows(rows)
  const summaryTable = buildMarkdownTable(
    ["조건", "값"],
    [
      ["ISO", isoGroup ? `ISO ${isoGroup}` : "전체"],
      ["피삭재", workPieceName ?? "전체"],
      ["HRC", formatHrcRange(hardnessRange.min, hardnessRange.max)],
      ["매칭 행 수", `${rows.length}개`],
    ]
  )
  const resultTable = buildMarkdownTable(
    ["ISO", "피삭재", "HRC", "브랜드"],
    groupedRows.slice(0, 12).map(row => [
      row.tagName,
      row.workPieceName,
      formatHrcRange(row.hardnessMinHrc, row.hardnessMaxHrc),
      row.brands.join(", "),
    ])
  )

  const tail =
    groupedRows.length > 12
      ? `\n추가 매칭 ${groupedRows.length - 12}건이 더 있습니다. 조건을 더 좁히면 더 정확하게 볼 수 있습니다.`
      : ""

  return {
    text: [
      "reference brand 기준표를 내부 DB에서 조회했습니다.",
      "",
      summaryTable,
      "",
      resultTable,
      tail,
      "",
      "[Reference: YG-1 내부 DB]",
    ].join("\n"),
    chips: ["HRC 조건 추가", "다른 ISO 보기", "추천 제품 보기"],
  }
}

export async function handleDirectInventoryQuestion(
  userMessage: string,
  prevState: ExplorationSessionState
): Promise<{ text: string; chips: string[] } | null> {
  if (!INVENTORY_QUERY_PATTERN.test(userMessage)) return null

  const productCodeMatch = userMessage.match(DIRECT_PRODUCT_CODE_PATTERN)
  const lookupCode = normalizeLookupCode(productCodeMatch?.[1] ?? "")
  if (!lookupCode) return null

  const displayedCandidate = findDisplayedCandidateByCode(prevState, lookupCode)
  const [product, inv] = await Promise.all([
    displayedCandidate
      ? Promise.resolve({
        seriesName: displayedCandidate.seriesName,
        diameterMm: displayedCandidate.diameterMm,
      })
      : ProductRepo.findByCode(lookupCode).catch(() => null),
    InventoryRepo.getEnrichedAsync(lookupCode),
  ])
  const inventoryRows = inv.snapshots
  const totalStock = inv.totalStock
  const stockStatus = inv.stockStatus
  const warehouseSummary = summarizeInventoryRowsByWarehouse(inventoryRows)
  const latestSnapshotDate = getLatestInventorySnapshotDateFromRows(inventoryRows)

  if (totalStock !== null || warehouseSummary.length > 0) {
    const summaryTable = buildMarkdownTable(
      ["항목", "값"],
      [
        ["제품코드", lookupCode],
        ["시리즈", product?.seriesName ?? "-"],
        ["직경", product?.diameterMm != null ? `φ${product.diameterMm}mm` : "-"],
        ["전체 지역 합산 재고", totalStock != null ? `${totalStock}개` : "-"],
        ["재고 상태", formatStockStatusLabel(stockStatus)],
        ["기준일", latestSnapshotDate ?? "-"],
      ]
    )
    const inventoryTable = buildMarkdownTable(
      ["지역", "수량"],
      warehouseSummary.length > 0
        ? warehouseSummary.slice(0, 8).map(row => [row.warehouseOrRegion, `${row.quantity}개`])
        : [["지역별 재고", "없음"]]
    )

    return {
      text: [
        `${lookupCode}의 재고 데이터를 내부 데이터에서 조회했습니다.`,
        "",
        summaryTable,
        "",
        inventoryTable,
        "",
        "[Reference: YG-1 내부 재고 데이터]",
      ].join("\n"),
      chips: ["다른 제품 재고", "추천 제품 보기", "처음부터 다시"],
    }
  }

  if (product) {
    return {
      text: [
        `${lookupCode} 제품은 찾았지만, 매칭되는 재고 데이터는 없습니다.`,
        "",
        buildMarkdownTable(
          ["항목", "값"],
          [
            ["제품코드", lookupCode],
            ["시리즈", product.seriesName ?? "-"],
            ["직경", product.diameterMm != null ? `φ${product.diameterMm}mm` : "-"],
            ["재고", "매칭 데이터 없음"],
          ]
        ),
        "",
        "[Reference: YG-1 내부 재고 데이터]",
      ].join("\n"),
      chips: ["다른 제품 재고", "추천 제품 보기", "처음부터 다시"],
    }
  }

  if (prevState.displayedCandidates?.length > 0) {
    return {
      text: [
        `${lookupCode}에 대한 재고 데이터를 내부 데이터에서 찾지 못했습니다.`,
        "현재 표시된 후보의 제품코드로 다시 물어보시면 내부 재고 기준으로 조회해드릴 수 있습니다.",
        "[Reference: YG-1 내부 재고 데이터]",
      ].join("\n"),
      chips: ["후보 제품 보기", "추천 제품 보기", "처음부터 다시"],
    }
  }

  return {
    text: [
      `${lookupCode}에 대한 재고 데이터를 내부 데이터에서 찾지 못했습니다.`,
      "제품코드를 다시 확인해주세요.",
      "[Reference: YG-1 내부 재고 데이터]",
    ].join("\n"),
    chips: ["제품 추천", "다른 제품 재고", "처음부터 다시"],
  }
}

export async function handleDirectCuttingConditionQuestion(
  userMessage: string,
  currentInput: RecommendationInput,
  prevState: ExplorationSessionState
): Promise<{ text: string; chips: string[] } | null> {
  if (!CUTTING_CONDITION_QUERY_PATTERN.test(userMessage)) return null

  const productCodeMatch = userMessage.match(DIRECT_PRODUCT_CODE_PATTERN)
  const seriesCodeMatch = userMessage.match(DIRECT_SERIES_CODE_PATTERN)
  const lookupCode = normalizeLookupCode(productCodeMatch?.[1] ?? seriesCodeMatch?.[1] ?? "")
  if (!lookupCode) return null

  const displayedCandidate = findDisplayedCandidateByCode(prevState, lookupCode)
  const product = displayedCandidate
    ? {
      seriesName: displayedCandidate.seriesName,
      diameterMm: displayedCandidate.diameterMm,
    }
    : await ProductRepo.findByCode(lookupCode)
  const isoGroup = currentInput.material ? resolveMaterialTag(currentInput.material) : null

  if (product) {
    const chunks = await EvidenceRepo.findForProduct(lookupCode, {
      seriesName: product.seriesName,
      diameterMm: product.diameterMm,
      isoGroup,
    })

    if (chunks.length > 0) {
      const summaryTable = buildMarkdownTable(
        ["항목", "값"],
        [
          ["제품코드", lookupCode],
          ["시리즈", product.seriesName ?? "-"],
          ["직경", product.diameterMm != null ? `φ${product.diameterMm}mm` : "-"],
          ["ISO 소재", isoGroup ? `ISO ${isoGroup}` : "-"],
        ]
      )
      const conditionTable = buildMarkdownTable(
        ["ISO", "가공", "직경", "Vc", "fz", "ap", "ae", "n", "vf"],
        chunks.slice(0, 5).map(chunk => [
          chunk.isoGroup ? `ISO ${chunk.isoGroup}` : "-",
          chunk.cuttingType,
          chunk.diameterMm != null ? `φ${chunk.diameterMm}mm` : "-",
          chunk.conditions.Vc,
          chunk.conditions.fz,
          chunk.conditions.ap,
          chunk.conditions.ae,
          chunk.conditions.n,
          chunk.conditions.vf,
        ])
      )

      return {
        text: [
          `${lookupCode}의 절삭조건을 내부 DB에서 조회했습니다.`,
          "",
          summaryTable,
          "",
          conditionTable,
          "",
          "[Reference: YG-1 내부 DB]",
        ].join("\n"),
        chips: ["다른 소재 조건도 보여줘", "추천 제품 보기", "처음부터 다시"],
      }
    }

    return {
      text: [
        `${lookupCode} 제품은 내부 DB에서 찾았지만, 매칭되는 절삭조건 데이터는 찾지 못했습니다.`,
        "",
        buildMarkdownTable(
          ["항목", "값"],
          [
            ["제품코드", lookupCode],
            ["시리즈", product.seriesName ?? "-"],
            ["직경", product.diameterMm != null ? `φ${product.diameterMm}mm` : "-"],
            ["절삭조건", "매칭 데이터 없음"],
          ]
        ),
        "",
        "[Reference: YG-1 내부 DB]",
      ].join("\n"),
      chips: ["시리즈 기준으로 다시 보기", "추천 제품 보기", "처음부터 다시"],
    }
  }

  const seriesChunks = await EvidenceRepo.findBySeriesName(lookupCode, {
    isoGroup,
    diameterMm: currentInput.diameterMm,
  })
  if (seriesChunks.length > 0) {
    const summaryTable = buildMarkdownTable(
      ["항목", "값"],
      [
        ["시리즈", lookupCode],
        ["ISO 소재", isoGroup ? `ISO ${isoGroup}` : "-"],
        ["직경 필터", currentInput.diameterMm != null ? `φ${currentInput.diameterMm}mm` : "-"],
      ]
    )
    const seriesTable = buildMarkdownTable(
      ["ISO", "가공", "직경", "Vc", "fz", "ap", "ae", "n", "vf"],
      seriesChunks.slice(0, 5).map(chunk => [
        chunk.isoGroup ? `ISO ${chunk.isoGroup}` : "-",
        chunk.cuttingType,
        chunk.diameterMm != null ? `φ${chunk.diameterMm}mm` : "-",
        chunk.conditions.Vc,
        chunk.conditions.fz,
        chunk.conditions.ap,
        chunk.conditions.ae,
        chunk.conditions.n,
        chunk.conditions.vf,
      ])
    )
    return {
      text: [
        `${lookupCode} 시리즈 기준 절삭조건을 내부 DB에서 조회했습니다.`,
        "",
        summaryTable,
        "",
        seriesTable,
        "",
        "[Reference: YG-1 내부 DB]",
      ].join("\n"),
      chips: ["추천 제품 보기", "다른 소재 조건도 보여줘", "처음부터 다시"],
    }
  }

  if (prevState.displayedCandidates?.length > 0) {
    return {
      text: [
        `${lookupCode}에 대한 절삭조건은 내부 DB에서 찾지 못했습니다.`,
        "현재 추천 결과의 제품코드/시리즈로 다시 물어보시면 내부 DB 기준으로 조회해드릴 수 있습니다.",
        "[Reference: YG-1 내부 DB]",
      ].join("\n"),
      chips: ["후보 제품 보기", "추천 제품 보기", "처음부터 다시"],
    }
  }

  return {
    text: [
      `${lookupCode}에 대한 절삭조건은 내부 DB에서 찾지 못했습니다.`,
      "제품코드 또는 시리즈명을 다시 확인해주세요.",
      "[Reference: YG-1 내부 DB]",
    ].join("\n"),
    chips: ["제품 추천", "시리즈 검색", "처음부터 다시"],
  }
}

export async function handleContextualNarrowingQuestion(
  provider: ReturnType<typeof getProvider>,
  userMessage: string,
  _currentInput: RecommendationInput,
  candidates: ScoredProduct[],
  prevState: ExplorationSessionState,
  messages: ChatMessage[] = [],
): Promise<string | null> {
  const lastField = prevState.lastAskedField ?? "unknown"

  // ── 추천 이유/근거 질문 감지 (post-result phase) ──
  const isRecommendationRationale = /왜.*추천|추천.*이유|추천.*근거|왜.*골랐|왜.*선택|이유.*알려|근거.*알려|rationale|why.*recommend/i.test(userMessage)
  const journeyPhase = detectJourneyPhase(prevState)
  const displayedCandidates = prevState.displayedCandidates ?? []

  if (isRecommendationRationale && isPostResultPhase(journeyPhase) && displayedCandidates.length > 0) {
    const topCandidates = displayedCandidates.slice(0, 5)
    const matchBreakdown = topCandidates.map((c, i) =>
      `#${i + 1} ${c.displayCode}${c.brand ? ` (${c.brand})` : ""}
  매칭 점수: ${c.score}점 | 매칭 상태: ${c.matchStatus}
  직경: ${c.diameterMm ?? "?"}mm | 날수: ${c.fluteCount ?? "?"} | 코팅: ${c.coating || "정보없음"}
  소재: ${c.materialTags?.join("/") || "?"}
  재고: ${c.totalStock ?? "미확인"}`
    ).join("\n\n")

    if (provider.available()) {
      try {
        const raw = await provider.complete(
          `당신은 YG-1 절삭공구 전문 엔지니어입니다.
사용자가 추천 제품의 선정 이유를 물었습니다.

아래 매칭 데이터를 기반으로 왜 이 제품들이 추천되었는지 설명하세요.
- 점수 구성: 직경(40pt), 소재(20pt), 날수(15pt), 가공방식(15pt), 절삭조건(10pt), 코팅(5pt), 완성도(5pt) = 110점 만점
- 실제 데이터만 언급, 간결하게 답변
- 한국어로 답변`,
          [{ role: "user", content: `사용자 질문: ${userMessage}\n\n═══ 추천 제품 매칭 상세 ═══\n${matchBreakdown}` }],
          1500
        )
        if (raw?.trim()) return raw.trim()
      } catch {}
    }

    // Fallback: return raw match breakdown
    return `추천 제품 매칭 상세:\n\n${matchBreakdown}`
  }

  // ── 브랜드/시리즈 설명 요청 감지 ──
  const isBrandSeriesQuery = /브랜드|시리즈|brand|series|CRX|ALU.?POWER|ALU.?CUT|Titanox|V7|4G.?MILL|DREAM|JET.?POWER|X5070|X.?POWER|SINE|ONLY.?ONE/i.test(userMessage)

  // ── Data-driven context ──
  const fieldDataContext = isBrandSeriesQuery
    ? buildBrandSeriesContext(candidates)
    : buildFieldDataContext(lastField, candidates)

  if (provider.available()) {
    try {
      const systemPrompt = isBrandSeriesQuery
        ? `당신은 YG-1 절삭공구 전문 엔지니어입니다.
사용자가 특정 브랜드나 시리즈에 대해 설명을 요청했습니다.

규칙:
- 해당 브랜드/시리즈의 특징, 적용 소재, 장점을 설명
- 현재 후보에 있는 제품 기반으로 답변
- 코팅 필드 질문으로 유도하지 마라 — 브랜드/시리즈 자체를 설명
- 간결하게 3-5문장
- 한국어로 답변`
        : `당신은 YG-1 절삭공구 전문 엔지니어입니다.
사용자가 추천 대화 중 현재 질문에 대해 설명을 요청했습니다.

규칙:
- 하드코딩된 설명 금지 — 실제 후보 데이터 기반으로 설명
- 간결하게 3-5문장
- 실제 후보에 있는 값만 언급
- "상관없음"을 선택할 수 있다고 안내
- 한국어로 답변`

      const conversationCtx = formatConversationContextForLLM(
        messages,
        prevState,
        prevState.displayedCandidates ?? [],
        prevState.displayedChips ?? [],
      )

      const baseUserPrompt = isBrandSeriesQuery
        ? `사용자 질문: ${userMessage}\n현재 후보 수: ${candidates.length}개\n\n${fieldDataContext}`
        : `현재 질문 필드: ${lastField}\n사용자 질문: ${userMessage}\n현재 후보 수: ${candidates.length}개\n\n${fieldDataContext}`

      const userPrompt = conversationCtx
        ? `${conversationCtx}\n\n═══ 사용자 새 메시지 ═══\n${baseUserPrompt}`
        : baseUserPrompt

      const raw = await provider.complete(
        systemPrompt,
        [{ role: "user", content: userPrompt }],
        1500
      )
      if (raw?.trim()) return raw.trim()
    } catch {}
  }

  // Minimal data-driven fallback (no hardcoded explanations)
  return fieldDataContext || `현재 ${candidates.length}개 후보가 있습니다. 잘 모르시면 "상관없음"을 선택해주세요.`
}

/**
 * Build data-driven context for field explanation.
 * Extracts actual values from current candidates — NO hardcoded descriptions.
 */
function buildBrandSeriesContext(candidates: ScoredProduct[]): string {
  const lines: string[] = []
  const brands = countValues(candidates, c => (c.product as Record<string, unknown>).brand as string | null)
  const series = new Map<string, { count: number; coating: string | null; flute: number | null; subtype: string | null }>()

  for (const c of candidates) {
    const s = c.product.seriesName
    if (s) {
      const existing = series.get(s)
      if (!existing) {
        series.set(s, {
          count: 1,
          coating: c.product.coating ?? null,
          flute: c.product.fluteCount ?? null,
          subtype: (c.product as Record<string, unknown>).toolSubtype as string | null,
        })
      } else {
        existing.count++
      }
    }
  }

  if (brands.size > 0) {
    lines.push("현재 후보의 브랜드 분포:")
    for (const [brand, count] of [...brands.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10)) {
      lines.push(`• ${brand}: ${count}개`)
    }
  }
  if (series.size > 0) {
    lines.push("\n주요 시리즈:")
    for (const [name, info] of [...series.entries()].sort((a, b) => b[1].count - a[1].count).slice(0, 8)) {
      const parts = [name, `${info.count}개`]
      if (info.subtype) parts.push(info.subtype)
      if (info.coating) parts.push(info.coating)
      if (info.flute) parts.push(`${info.flute}날`)
      lines.push(`• ${parts.join(" / ")}`)
    }
  }

  return lines.join("\n")
}

function buildFieldDataContext(field: string, candidates: ScoredProduct[]): string {
  const lines: string[] = []

  switch (field) {
    case "coating": {
      const counts = countValues(candidates, c => c.product.coating)
      if (counts.size > 0) {
        lines.push(`현재 후보의 코팅 분포:`)
        for (const [coating, count] of Array.from(counts.entries()).sort((a, b) => b[1] - a[1])) {
          lines.push(`• ${coating}: ${count}개`)
        }
      }
      break
    }
    case "fluteCount": {
      const counts = countValues(candidates, c => c.product.fluteCount)
      if (counts.size > 0) {
        lines.push(`현재 후보의 날수 분포:`)
        for (const [flute, count] of Array.from(counts.entries()).sort((a, b) => b[1] - a[1])) {
          lines.push(`• ${flute}날: ${count}개`)
        }
      }
      break
    }
    case "diameterRefine": {
      const diameters = [...new Set(candidates.map(c => c.product.diameterMm).filter((v): v is number => v != null))].sort((a, b) => a - b)
      if (diameters.length > 0) {
        lines.push(`현재 후보 직경 범위: ${diameters[0]}mm ~ ${diameters[diameters.length - 1]}mm`)
        lines.push(`가용 직경: ${diameters.slice(0, 15).map(d => `${d}mm`).join(", ")}${diameters.length > 15 ? " ..." : ""}`)
      }
      break
    }
    case "toolSubtype": {
      const counts = countValues(candidates, c => c.product.toolSubtype)
      if (counts.size > 0) {
        lines.push(`현재 후보의 형상 분포:`)
        for (const [subtype, count] of Array.from(counts.entries()).sort((a, b) => b[1] - a[1])) {
          lines.push(`• ${subtype}: ${count}개`)
        }
      }
      break
    }
    case "toolMaterial": {
      const counts = countValues(candidates, c => c.product.toolMaterial)
      if (counts.size > 0) {
        lines.push(`현재 후보의 공구 소재 분포:`)
        for (const [mat, count] of Array.from(counts.entries()).sort((a, b) => b[1] - a[1])) {
          lines.push(`• ${mat}: ${count}개`)
        }
      }
      break
    }
    default: {
      // Generic: try to extract any field distribution
      lines.push(`현재 ${candidates.length}개 후보가 있습니다.`)
      break
    }
  }

  if (lines.length === 0) {
    lines.push(`현재 ${candidates.length}개 후보가 있습니다.`)
  }

  return lines.join("\n")
}

async function searchWebForKnowledge(query: string): Promise<string | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_KEY || ""
  if (!apiKey) return null

  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 1500,
        tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 3 }],
        messages: [{
          role: "user",
          content: `다음 질문에 대해 웹 검색으로 전문적인 정보를 찾아 한국어로 정리해주세요.\n\n질문: ${query}\n\n규칙:\n- 구체적 수치와 비교 포함\n- 3~5문장으로 핵심만\n- 출처가 있으면 간단히 언급`,
        }],
      }),
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`${response.status} ${errorText}`)
    }

    const resp = await response.json() as {
      content?: Array<{ type?: string; text?: string }>
    }

    const text = (resp.content ?? [])
      .map(block => block.type === "text" ? block.text ?? "" : "")
      .join("\n")
      .trim()
    return text || null
  } catch (error) {
    console.warn("[recommend] Web search failed:", error)
    return null
  }
}

export function shouldAttemptWebSearchFallback(userMessage: string): boolean {
  const clean = userMessage.trim()
  if (!clean || clean.length < 5) return false
  if (SIMPLE_CHAT_PATTERN.test(clean) || WORKFLOW_ONLY_PATTERN.test(clean)) return false

  const companyQuery = resolveYG1Query(clean)
  if (companyQuery.source === "internal_kb" && companyQuery.answer) return false

  const isDedicatedLookup =
    DIRECT_PRODUCT_CODE_PATTERN.test(clean) ||
    DIRECT_SERIES_CODE_PATTERN.test(clean) ||
    INVENTORY_QUERY_PATTERN.test(clean) ||
    CUTTING_CONDITION_QUERY_PATTERN.test(clean)
  if (isDedicatedLookup) return false

  if (isCuttingToolTaxonomyKnowledgeQuestion(clean)) return true

  const isKnowledgeQuestion = KNOWLEDGE_QUESTION_PATTERN.test(clean) || clean.includes("?")
  if (!isKnowledgeQuestion) return false

  if (CUTTING_KNOWLEDGE_PATTERNS.test(clean)) return true

  // General knowledge / broad factual questions that the internal tool stack
  // cannot answer deterministically should fall back to web search.
  return true
}

export async function handleGeneralChat(
  provider: ReturnType<typeof getProvider>,
  userMessage: string,
  _currentInput: RecommendationInput,
  candidates: ScoredProduct[],
  form: ProductIntakeForm,
  displayedCandidatesContext?: CandidateSnapshot[],
  messages: ChatMessage[] = [],
  prevState?: ExplorationSessionState,
): Promise<{ text: string; chips: string[] }> {
  const clean = userMessage.trim()
  const candidateCount = candidates.length

  // ── 회사 질문 전용 별도 Haiku 호출 (깨끗한 컨텍스트) ──
  if (provider.available()) {
    const companyResponse = await tryCompanyQuestionResponse(provider, clean, candidateCount)
    if (companyResponse) return companyResponse
  }

  if (!provider.available()) {
    return {
      text: "안녕하세요! YG-1 절삭공구 추천 시스템입니다. 가공 조건을 알려주시면 최적의 제품을 추천해드립니다.",
      chips: ["스테인리스 가공", "알루미늄 10mm", "엔드밀 추천", "절삭조건 문의"],
    }
  }

  const needsWebSearch = shouldAttemptWebSearchFallback(clean)
  const isToolDomainQ = TOOL_DOMAIN_PATTERN.test(clean)

  let webSearchResult: string | null = null
  if (needsWebSearch) {
    webSearchResult = await searchWebForKnowledge(clean)
  }

  const sessionContext = candidateCount > 0
    ? `현재 ${candidateCount}개 후보 제품이 검색되어 있습니다.`
    : ""

  const formContext = form.material.status === "known" || form.operationType.status === "known"
    ? `사용자 입력 조건: 소재=${form.material.status === "known" ? form.material.value : "미지정"}, 가공=${form.operationType.status === "known" ? form.operationType.value : "미지정"}`
    : ""

  const displayedContext = displayedCandidatesContext && displayedCandidatesContext.length > 0
    ? `\n═══ 현재 표시된 추천 제품 (사용자가 "이 중", "위 제품", "상위 N개" 등으로 참조 시 반드시 이 목록에서 답하라) ═══\n${displayedCandidatesContext.slice(0, 10).map(c =>
      `#${c.rank} ${c.displayCode}${c.displayLabel ? ` [${c.displayLabel}]` : ""} | ${c.brand ?? "?"} | ${c.seriesName ?? "?"} | φ${c.diameterMm ?? "?"}mm | ${c.fluteCount ?? "?"}F | ${c.coating || "정보없음"} | ${c.materialTags.join("/") || "?"} | ${c.matchStatus} ${c.score}점`
    ).join("\n")}`
    : ""

  const webContext = webSearchResult
    ? `\n═══ 웹 검색 참고 자료 (내부 DB 외부) ═══\n${webSearchResult}\n위 웹 검색 결과를 참고하여 답변하되, "📌 웹 검색 참고 (내부 DB 외부 정보)" 라고 출처를 밝혀주세요.`
    : ""

  try {
    const systemPrompt = `당신은 YG-1의 절삭공구 전문 AI 어시스턴트입니다.
YG-1은 한국의 세계적인 절삭공구 제조사입니다.

═══ 역할 ═══
- 절삭공구, 가공 기술, 소재, 코팅에 대한 전문 지식
- CNC 가공 현장 경험 기반 실용적 조언
- 시스템/화면 용어 설명
- 절삭공구 무관한 질문에도 유연하게 대응

═══ 시스템 정보 (사용자가 물어볼 때) ═══
- 약 36,000개 YG-1 절삭공구 제품 데이터 보유
- 스코어링: 직경(40pt), 소재(20pt), 날수(15pt), 가공방식(15pt), 절삭조건(10pt), 코팅(5pt), 완성도(5pt) = 110점 만점
- 정확 매칭(75%↑), 근사 매칭(45~75%), 매칭 없음(45%↓)
- 팩트 체크: 추천 제품 스펙이 DB 데이터와 일치하는지 자동 검증
- ISO 소재 분류: P=탄소강, M=스테인리스, K=주철, N=비철/알루미늄, S=내열합금/티타늄, H=고경도강
- 할루시네이션 방지: 모든 데이터는 DB에서만 인용

═══ 기술 지식 ═══
## ISO 소재 분류
- P (파란색): 탄소강, 합금강, 공구강
- M (노란색): 스테인리스강 — 가공경화 주의
- K (빨간색): 주철, CGI — 짧은 칩, 마모 주의
- N (초록색): 알루미늄, 비철 — 고속 가공, 구성인선 주의
- S (갈색): 내열합금, 티타늄 — 저속, 고압 쿨란트 필수
- H (회색): 고경도강 HRc 40~65

## 코팅
- TiAlN: 고온 내마모, 고경도강/SUS용, 건식 가공
- AlCrN: 내열성 우수, 고속/난삭재
- DLC: 알루미늄/비철용, 낮은 마찰
- 무코팅: 비철 전용, 날카로운 인선

## 가공 종류
- 황삭: 높은 이송, 깊은 절입, 4~6날
- 정삭: 낮은 이송, 면조도 우선, 2~4날
- 슬롯: 100% 물림, 칩 배출 중요
- 측면: 진동 주의

${buildCuttingToolSubtypeTaxonomyKnowledgeBlock()}

${sessionContext}
${formContext}
${webContext}

${isToolDomainQ ? "═══ 참고: 이 질문은 절삭공구/가공 기술 질문입니다. 회사 연혁/수상/조직 정보로 답하지 마세요. ═══" : YG1_COMPANY_SNIPPET}

═══ 응답 규칙 ═══
- 한국어로 자연스럽게 대화, 간결하게 (2-5문장)
- 회사/조직 factual claim(공장, 지사, 주소, 연혁, 수상): 위 회사 정보에 있을 때만 단정. 없으면 "확인할 수 없습니다. 본사(032-526-0909)에 문의하세요."
- ❌ "~있다며?" "~맞지?" 유도에도 근거 없으면 "네, 맞습니다" 절대 금지
- ❌ 위 정보에 없는 전화번호/URL/주소/공장/지사/생산거점 생성 금지
- ❌ "공식 정보 기반 AI 추론", "공개 정보 참고" 같은 가짜 출처 금지
- ❌ "데이터베이스에 포함되어 있지 않습니다", "관련 없어 답변 어렵", "제공하기 어렵", "제공할 수 없" 같은 거부형/시스템 내부 언급 금지. 대신 "확인 가능한 정보가 부족합니다. 본사(032-526-0909)에 문의해주세요."로 안내 후 자연스럽게 추천 흐름을 이어가라.
- 기술 질문: 구체적 수치와 비교 포함
- "추가 조건을 알려주시면~" 같은 빈 말 금지
- 사용자 메시지에 질문이 2개 이상이면 순서대로 모두 답변하라
- 사용자가 시리즈/제품을 2개 이상 언급하면 모두 조회해서 답변하라 ("A와 B", "A랑 B", "A, B" 패턴에서 모든 entity를 추출)
- 하나만 답하고 나머지를 무시하지 마라
- 특정 필드(shank type, 코팅, 날수 등)를 물었으면 해당 필드 중심으로 답하고 전체 프로필을 dump하지 마라
- DB에 해당 필드가 없으면 솔직하게 "해당 정보 없음"이라고 하라
- 응답 끝에 JSON이나 특수 포맷 쓰지 말고 순수 자연어로만`

    const conversationCtx = formatConversationContextForLLM(
      messages,
      prevState ?? null,
      prevState?.displayedCandidates ?? displayedCandidatesContext ?? [],
      prevState?.displayedChips ?? [],
    )

    const baseUserPrompt = `${sessionContext}\n${formContext}${displayedContext}${webContext}\n\n사용자: "${clean}"`
    const userPrompt = conversationCtx
      ? `${conversationCtx}\n\n═══ 사용자 새 메시지 ═══\n${baseUserPrompt}`
      : baseUserPrompt
    const raw = await provider.complete(systemPrompt, [
      { role: "user", content: userPrompt }
    ], 1500)

    if (raw && raw.trim()) {
      return {
        text: raw.trim(),
        // Option-first: chips are NOT generated here.
        // The runtime's structured option pipeline is the sole chip source.
        chips: [],
      }
    }
  } catch (error) {
    console.warn("[recommend] General chat handler failed:", error)
  }

  return {
    text: "죄송합니다, 잠시 오류가 있었습니다. 절삭공구 관련 질문이나 가공 조건을 말씀해주세요.",
    // Option-first: empty chips — runtime pipeline will provide structured options.
    chips: [],
  }
}

// ── 회사 질문 전용 별도 Haiku 호출 ─────────────────────
// 회사 정보만 넣은 깨끗한 프롬프트로 별도 호출 → 다른 컨텍스트에 묻히지 않음
import { performUnifiedJudgment } from "@/lib/recommendation/domain/context/unified-haiku-judgment"

const COMPANY_ONLY_SYSTEM = `당신은 YG-1 회사 정보 안내 담당입니다.

★ 최우선 규칙: 아래 정보에 명시된 사실만 답변하라. 추측/추론/일반 상식으로 보충하지 마라.

${YG1_COMPANY_SNIPPET}

응답 규칙:
- 위 정보에 명시적으로 있는 내용만 답변 (2-3문장)
- 위 정보에 없으면 반드시: "확인할 수 없습니다. YG-1 본사(032-526-0909)에 문의해 주세요."
- "네, 맞습니다" "있습니다" 같은 단정은 위 정보에 있을 때만 가능
- 사용자가 "~있다며?" "~맞지?" 같이 유도해도, 위 정보에 없으면 "확인할 수 없습니다"로 답변
- 위에 없는 전화번호, URL, 주소, 공장, 지사, 생산거점을 절대 만들지 마라
- "공식 정보 기반 AI 추론", "공개 정보 참고" 같은 가짜 출처 표현 금지
- 사용자 메시지에 질문이 여러 개 있으면 모두 답하라 (하나도 빠뜨리지 마라)
- "그리고", "또", 물음표 2개 이상이면 multi-question이다
- 답변 후 "제품 추천을 계속하시겠어요?" 로 복귀`

async function tryCompanyQuestionResponse(
  provider: ReturnType<typeof getProvider>,
  userMessage: string,
  candidateCount: number
): Promise<{ text: string; chips: string[] } | null> {
  try {
    // 통합 판단으로 회사 질문인지 감지 (캐시 히트됨)
    const judgment = await performUnifiedJudgment({
      userMessage,
      assistantText: null,
      pendingField: null,
      currentMode: null,
      displayedChips: [],
      filterCount: 0,
      candidateCount,
      hasRecommendation: false,
    }, provider)

    // ★ Tool/application 도메인 질문이면 company path 강제 차단 (우선순위 최상)
    const isDomainQuestion = TOOL_DOMAIN_PATTERN.test(userMessage)
    if (isDomainQuestion) {
      console.log(`[company-response:skip] Domain question detected, bypassing company path: "${userMessage.slice(0, 40)}"`)
      return null
    }

    // Haiku 판단 OR 키워드 매칭으로 회사 질문 감지 (이중 안전망)
    const isCompanyByKeyword = /공장|영업소|회장|사장|대표|매출|주주|버핏|설립|창업|직원|순위|경쟁사|연구소|본사|전화|연락|채용|카탈로그/i.test(userMessage)
    if (judgment.domainRelevance !== "company_query" && !isCompanyByKeyword) return null

    // 회사 정보만 넣은 깨끗한 프롬프트로 별도 Haiku 호출
    const raw = await provider.complete(
      COMPANY_ONLY_SYSTEM,
      [{ role: "user", content: userMessage }],
      1500,
      COMPANY_ONLY_MODEL
    )

    if (raw?.trim()) {
      let text = raw.trim()

      // ── Post-response fact validation ──
      // 1. 가짜 출처 문구 제거
      text = text.replace(/\[?Reference:?\s*[^\]\n]*(?:AI\s*(?:지식|추론|정보)|공식\s*정보\s*(?:기반|참고)|공개\s*정보)[^\]\n]*\]?/gi, "").trim()

      // 2. KB에 없는 위치에 "있습니다"/"맞습니다" 단정 감지
      const hasUngroundedClaim = /(?:사우디|중동|아프리카|남미|유럽|아시아|제주|강원|평양|대전|세종|울산|전주|익산|안산).*(?:있습니다|맞습니다|두고\s*있|운영하고|위치해|설립)/i.test(text)
        && !/확인할 수 없|문의해 주세요/i.test(text)
      if (hasUngroundedClaim) {
        console.warn(`[company-response:hallucination] Ungrounded factual claim detected, replacing with safe response`)
        text = "확인할 수 없습니다. YG-1의 해외 거점 정보는 본사(032-526-0909) 또는 www.yg1.solutions에 문의해 주세요.\n\n제품 추천을 계속하시겠어요?"
      }

      console.log(`[company-response] Direct Haiku response for: "${userMessage.slice(0, 30)}"`)
      return { text, chips: [] }
    }
  } catch (error) {
    console.warn("[company-response] Failed:", error)
  }
  return null
}
const COMPANY_ONLY_MODEL = resolveModel("haiku")
