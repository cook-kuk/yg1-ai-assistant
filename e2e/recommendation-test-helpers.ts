import { expect, type Page, type TestInfo } from "@playwright/test"

type JsonRecord = Record<string, unknown>

export interface RecommendResponsePayload extends JsonRecord {
  text?: string | null
  purpose?: string | null
  chips?: string[] | null
  recommendation?: JsonRecord | null
  sessionState?: RecommendSessionState | null
  candidateSnapshot?: RecommendCandidate[] | null
}

export interface RecommendSessionState extends JsonRecord {
  resolvedInput?: {
    material?: string | null
    operationType?: string | null
    toolType?: string | null
    toolSubtype?: string | null
    diameterMm?: number | null
    unitSystem?: string | null
  } | null
  candidateCount?: number
  displayedProducts?: RecommendCandidate[] | null
  displayedCandidates?: RecommendCandidate[] | null
  displayedOptions?: Array<{ index?: number; count?: number; label?: string; value?: string; field?: string; kind?: string }> | null
  displayedSeriesGroups?: Array<{ seriesName?: string; seriesKey?: string; candidateCount?: number }> | null
  displayedGroups?: Array<{ seriesName?: string; seriesKey?: string; candidateCount?: number }> | null
  lastRecommendationArtifact?: RecommendCandidate[] | null
  lastComparisonArtifact?: {
    comparedProductCodes?: string[]
    comparedRanks?: number[]
    compareField?: string | null
    text?: string | null
  } | null
  uiNarrowingPath?: Array<{ kind?: string; field?: string; label?: string; value?: string; candidateCount?: number }> | null
  activeGroupKey?: string | null
  currentMode?: string | null
  lastAction?: string | null
  underlyingAction?: string | null
  restoreTarget?: string | null
  candidateCounts?: {
    dbMatchCount?: number
    filteredCount?: number
    rankedCount?: number
    displayedCount?: number
    hiddenBySeriesCapCount?: number
  } | null
}

export interface RecommendCandidate extends JsonRecord {
  rank: number
  productCode: string
  displayCode: string
  displayLabel?: string | null
  seriesName: string | null
  diameterMm: number | null
  brand: string | null
  seriesIconUrl?: string | null
  fluteCount?: number | null
  coating?: string | null
  toolMaterial?: string | null
  shankDiameterMm?: number | null
  lengthOfCutMm?: number | null
  overallLengthMm?: number | null
  helixAngleDeg?: number | null
  description?: string | null
  featureText?: string | null
  materialTags?: string[]
  score?: number
  scoreBreakdown?: unknown
  matchStatus?: "exact" | "approximate" | "none"
  stockStatus?: string
  totalStock?: number | null
  inventorySnapshotDate?: string | null
  inventoryLocations?: Array<{ warehouseOrRegion: string; quantity: number }>
  hasEvidence?: boolean
  bestCondition?: Record<string, unknown> | null
}

interface InteractionRecord {
  at: string
  requestBody: unknown
  status: number
  responseText: string
  responsePayload: RecommendResponsePayload | null
  sessionSnapshot: ReturnType<typeof buildSessionSnapshot>
  artifactSnapshot: ReturnType<typeof buildArtifactSnapshot>
}

const BASE_RESOLVED_INPUT = {
  manufacturerScope: "yg1-only",
  locale: "en",
  material: "Aluminum",
  operationType: "Side Milling",
  diameterMm: 4,
  toolType: "End Mill",
  unitSystem: "METRIC",
}

function makeCandidate(input: {
  rank: number
  code: string
  series: string
  diameter?: number
  coating?: string
  score?: number
  stock?: number | null
  description?: string
  toolMaterial?: string
  flutes?: number
}) {
  const matchStatus: RecommendCandidate["matchStatus"] = input.rank === 1 ? "exact" : "approximate"
  return {
    rank: input.rank,
    productCode: input.code,
    displayCode: input.code,
    displayLabel: `${input.flutes ?? 3}F ${input.series} End Mill`,
    brand: "YG-1",
    seriesName: input.series,
    seriesIconUrl: null,
    diameterMm: input.diameter ?? 4,
    fluteCount: input.flutes ?? 3,
    coating: input.coating ?? "DLC",
    toolMaterial: input.toolMaterial ?? "Carbide",
    shankDiameterMm: input.diameter ?? 4,
    lengthOfCutMm: 10,
    overallLengthMm: 60,
    helixAngleDeg: 40,
    description: input.description ?? `${input.series} for aluminum side milling`,
    featureText: `${input.series} artifact persistence fixture`,
    materialTags: ["N"],
    score: input.score ?? 95 - input.rank,
    scoreBreakdown: null,
    matchStatus,
    stockStatus: input.stock == null ? "unknown" : input.stock > 0 ? "instock" : "outofstock",
    totalStock: input.stock ?? null,
    inventorySnapshotDate: "2026-03-18",
    inventoryLocations: input.stock
      ? [{ warehouseOrRegion: "Korea", quantity: input.stock }]
      : [],
    hasEvidence: true,
    bestCondition: {
      Vc: "450 m/min",
      fz: "0.08 mm/tooth",
      ap: "2.0 mm",
      ae: "0.4 mm",
      n: "12000 rpm",
      vf: "2880 mm/min",
      material: "Aluminum",
      note: null,
    },
  }
}

const BASE_CANDIDATES: RecommendCandidate[] = [
  makeCandidate({ rank: 1, code: "E5D7004010", series: "E5D70", stock: 12 }),
  makeCandidate({ rank: 2, code: "E5D7004020", series: "E5D70", stock: 8 }),
  makeCandidate({ rank: 3, code: "EI880040", series: "EI880", coating: "Uncoated", stock: 4 }),
  makeCandidate({ rank: 4, code: "EI880041", series: "EI880", coating: "Uncoated", stock: 2 }),
  makeCandidate({ rank: 5, code: "ALM90040", series: "ALM90", coating: "DLC", stock: 6 }),
]

const RADIUS_CANDIDATES: RecommendCandidate[] = BASE_CANDIDATES.map((candidate, index) => ({
  ...candidate,
  rank: index + 1,
  displayLabel: `${candidate.fluteCount}F Radius ${candidate.seriesName}`,
})).slice(0, 4)

function buildSeriesGroups(candidates: RecommendCandidate[]) {
  const groupMap = new Map<string, RecommendCandidate[]>()
  for (const candidate of candidates) {
    const key = candidate.seriesName ?? "UNGROUPED"
    const bucket = groupMap.get(key) ?? []
    bucket.push(candidate)
    groupMap.set(key, bucket)
  }
  return Array.from(groupMap.entries()).map(([seriesName, members]) => ({
    seriesKey: seriesName,
    seriesName,
    seriesIconUrl: null,
    description: `${seriesName} series`,
    candidateCount: members.length,
    topScore: Math.max(0, ...members.map(member => member.score ?? 0)),
    members,
  }))
}

function makeScoredProduct(candidate: RecommendCandidate) {
  return {
    product: {
      id: candidate.productCode,
      normalizedCode: candidate.productCode,
      displayCode: candidate.displayCode,
      brand: candidate.brand,
      seriesName: candidate.seriesName,
      seriesIconUrl: candidate.seriesIconUrl,
      diameterMm: candidate.diameterMm,
      fluteCount: candidate.fluteCount,
      coating: candidate.coating,
      toolMaterial: candidate.toolMaterial,
      shankDiameterMm: candidate.shankDiameterMm,
      lengthOfCutMm: candidate.lengthOfCutMm,
      overallLengthMm: candidate.overallLengthMm,
      helixAngleDeg: candidate.helixAngleDeg,
      materialTags: candidate.materialTags,
      description: candidate.description,
      featureText: candidate.featureText,
    },
    score: candidate.score ?? 0,
    matchStatus: candidate.matchStatus ?? "approximate",
    matchedFields: ["Diameter match", "Material match", "Operation match"],
    scoreBreakdown: null,
    inventory: [],
    totalStock: candidate.totalStock,
    stockStatus: candidate.stockStatus ?? "unknown",
  }
}

function buildRecommendation(displayedProducts: RecommendCandidate[]) {
  const primary = displayedProducts[0] ? makeScoredProduct(displayedProducts[0]) : null
  const alternatives = displayedProducts.slice(1, 3).map(makeScoredProduct)
  return {
    status: primary ? "exact" : "none",
    query: { ...BASE_RESOLVED_INPUT },
    primaryProduct: primary,
    alternatives,
    warnings: primary ? ["Persisted artifact session active"] : ["No matching products found"],
    rationale: primary ? ["Persisted artifact restored from session state"] : [],
    sourceSummary: [],
    deterministicSummary: primary
      ? `Recommended ${primary.product.displayCode} from persisted artifact state.`
      : "No matching products found.",
    llmSummary: null,
    totalCandidatesConsidered: displayedProducts.length,
  }
}

function buildSessionState(args: {
  displayedProducts: RecommendCandidate[]
  fullDisplayedProducts?: RecommendCandidate[] | null
  currentMode: string
  lastAction: string
  uiNarrowingPath?: RecommendSessionState["uiNarrowingPath"]
  activeGroupKey?: string | null
  lastRecommendationArtifact?: RecommendCandidate[] | null
  lastComparisonArtifact?: RecommendSessionState["lastComparisonArtifact"]
  underlyingAction?: string | null
  restoreTarget?: string | null
}) {
  const displayedProducts = args.displayedProducts
  const fullDisplayedProducts = args.fullDisplayedProducts ?? args.displayedProducts
  const lastRecommendationArtifact = args.lastRecommendationArtifact ?? fullDisplayedProducts
  const displayedSeriesGroups = buildSeriesGroups(displayedProducts)
  return {
    sessionId: "mock-session-artifacts",
    candidateCount: displayedProducts.length,
    appliedFilters: [],
    narrowingHistory: [],
    stageHistory: [],
    resolutionStatus: displayedProducts.length > 0 ? "resolved_exact" : "resolved_none",
    resolvedInput: { ...BASE_RESOLVED_INPUT },
    turnCount: 1,
    displayedProducts,
    displayedCandidates: displayedProducts,
    fullDisplayedProducts,
    fullDisplayedCandidates: fullDisplayedProducts,
    displayedSetFilter: null,
    displayedChips: ["추천해주세요", "전체 보기", "다른 시리즈 보기"],
    displayedOptions: displayedSeriesGroups.map((group, index) => ({
      index: index + 1,
      label: `${group.seriesName} (${group.candidateCount})`,
      field: "seriesName",
      value: group.seriesName,
      count: group.candidateCount,
    })),
    displayedSeriesGroups,
    displayedGroups: displayedSeriesGroups,
    uiNarrowingPath: args.uiNarrowingPath ?? [],
    currentMode: args.currentMode,
    lastAction: args.lastAction,
    underlyingAction: args.underlyingAction ?? "show_recommendation",
    activeGroupKey: args.activeGroupKey ?? null,
    restoreTarget: args.restoreTarget ?? null,
    lastRecommendationArtifact,
    lastComparisonArtifact: args.lastComparisonArtifact ?? null,
    candidateCounts: {
      dbMatchCount: fullDisplayedProducts.length,
      filteredCount: displayedProducts.length,
      rankedCount: displayedProducts.length,
      displayedCount: displayedProducts.length,
      hiddenBySeriesCapCount: 0,
    },
  }
}

function buildMockResponseFromRequest(body: JsonRecord): RecommendResponsePayload {
  const prev = (body.sessionState ?? null) as RecommendSessionState | null
  const messages = Array.isArray(body.messages) ? body.messages as Array<{ text?: string }> : []
  const lastMessage = String(messages.at(-1)?.text ?? "").trim()
  const normalized = lastMessage.toLowerCase()
  const prevDisplayed = (prev?.displayedProducts ?? prev?.displayedCandidates ?? BASE_CANDIDATES) as RecommendCandidate[]
  const artifact = (prev?.lastRecommendationArtifact ?? BASE_CANDIDATES) as RecommendCandidate[]
  const keepComparison = prev?.lastComparisonArtifact ?? null

  if (messages.length === 0) {
    const sessionState = buildSessionState({
      displayedProducts: BASE_CANDIDATES,
      fullDisplayedProducts: BASE_CANDIDATES,
      currentMode: "recommendation",
      lastAction: "show_recommendation",
      lastRecommendationArtifact: BASE_CANDIDATES,
    })
    return {
      text: "Initial recommendation loaded from persisted artifact fixture.",
      purpose: "recommendation",
      chips: ["Radius", "Series Search", "Compare Top 3"],
      isComplete: true,
      recommendation: buildRecommendation(BASE_CANDIDATES),
      sessionState,
      evidenceSummaries: null,
      candidateSnapshot: BASE_CANDIDATES,
      extractedField: null,
      requestPreparation: null,
      primaryExplanation: null,
      primaryFactChecked: null,
      altExplanations: [],
      altFactChecked: [],
    }
  }

  if (normalized.includes("radius")) {
    const sessionState = buildSessionState({
      displayedProducts: RADIUS_CANDIDATES,
      fullDisplayedProducts: RADIUS_CANDIDATES,
      currentMode: "recommendation",
      lastAction: "filter_displayed",
      uiNarrowingPath: [{ kind: "filter", field: "toolSubtype", label: "Shape", value: "Radius", candidateCount: RADIUS_CANDIDATES.length }],
      lastRecommendationArtifact: RADIUS_CANDIDATES,
      lastComparisonArtifact: keepComparison,
    })
    return {
      text: "Radius filter applied. Persisted recommendation artifact now tracks the narrowed radius candidates.",
      purpose: "question",
      chips: ["Series Search", "Compare Top 3", "Full View"],
      isComplete: false,
      recommendation: null,
      sessionState,
      evidenceSummaries: null,
      candidateSnapshot: RADIUS_CANDIDATES,
      extractedField: null,
      requestPreparation: null,
      primaryExplanation: null,
      primaryFactChecked: null,
      altExplanations: [],
      altFactChecked: [],
    }
  }

  if (normalized.includes("series search") || normalized.includes("시리즈 검색") || normalized.includes("다른 시리즈 보기")) {
    const sessionState = buildSessionState({
      displayedProducts: artifact,
      fullDisplayedProducts: artifact,
      currentMode: "group_menu",
      lastAction: "show_group_menu",
      uiNarrowingPath: (prev?.uiNarrowingPath ?? []) as RecommendSessionState["uiNarrowingPath"],
      lastRecommendationArtifact: artifact,
      lastComparisonArtifact: keepComparison,
      restoreTarget: "Full View",
    })
    return {
      text: "Persisted series groups are available. Choose a series to focus without losing the underlying recommendation artifact.",
      purpose: "question",
      chips: buildSeriesGroups(artifact).map(group => group.seriesName).concat("Full View"),
      isComplete: false,
      recommendation: null,
      sessionState,
      evidenceSummaries: null,
      candidateSnapshot: artifact,
      extractedField: null,
      requestPreparation: null,
      primaryExplanation: null,
      primaryFactChecked: null,
      altExplanations: [],
      altFactChecked: [],
    }
  }

  const requestedSeries = ["e5d70", "ei880", "alm90"].find(series => normalized.includes(series))
  if (requestedSeries) {
    const seriesName = requestedSeries.toUpperCase()
    const focused = artifact.filter(candidate => String(candidate.seriesName).toUpperCase() === seriesName)
    const sessionState = buildSessionState({
      displayedProducts: focused,
      fullDisplayedProducts: artifact,
      currentMode: "group_focus",
      lastAction: "restore_previous_group",
      uiNarrowingPath: (prev?.uiNarrowingPath ?? []) as RecommendSessionState["uiNarrowingPath"],
      activeGroupKey: seriesName,
      lastRecommendationArtifact: artifact,
      lastComparisonArtifact: keepComparison,
      restoreTarget: "Full View",
    })
    return {
      text: `Focused ${seriesName}. The full recommendation artifact is still preserved for restore.`,
      purpose: "question",
      chips: ["전체 보기", "추천해주세요", "다른 시리즈 보기"],
      isComplete: false,
      recommendation: null,
      sessionState,
      evidenceSummaries: null,
      candidateSnapshot: focused,
      extractedField: null,
      requestPreparation: null,
      primaryExplanation: null,
      primaryFactChecked: null,
      altExplanations: [],
      altFactChecked: [],
    }
  }

  if (normalized.includes("full view") || normalized.includes("전체 보기") || normalized.includes("이전 단계") || normalized.includes("back")) {
    const sessionState = buildSessionState({
      displayedProducts: artifact,
      fullDisplayedProducts: artifact,
      currentMode: "restore",
      lastAction: "filter_displayed",
      uiNarrowingPath: (prev?.uiNarrowingPath ?? []) as RecommendSessionState["uiNarrowingPath"],
      lastRecommendationArtifact: artifact,
      lastComparisonArtifact: keepComparison,
    })
    return {
      text: "Restored the persisted full artifact view.",
      purpose: "question",
      chips: ["추천해주세요", "다른 시리즈 보기", "상위 3개 비교해줘"],
      isComplete: false,
      recommendation: null,
      sessionState,
      evidenceSummaries: null,
      candidateSnapshot: artifact,
      extractedField: null,
      requestPreparation: null,
      primaryExplanation: null,
      primaryFactChecked: null,
      altExplanations: [],
      altFactChecked: [],
    }
  }

  if (normalized.includes("compare top 3") || normalized.includes("상위 3개 비교")) {
    const compared = artifact.slice(0, 3)
    const comparisonArtifact = {
      comparedProductCodes: compared.map(candidate => candidate.productCode),
      comparedRanks: compared.map(candidate => candidate.rank ?? 0),
      compareField: null,
      text: compared.map(candidate => `- ${candidate.displayCode} | ${candidate.seriesName} | ${candidate.coating}`).join("\n"),
    }
    const sessionState = buildSessionState({
      displayedProducts: artifact,
      fullDisplayedProducts: artifact,
      currentMode: "comparison",
      lastAction: "compare_products",
      uiNarrowingPath: (prev?.uiNarrowingPath ?? []) as RecommendSessionState["uiNarrowingPath"],
      lastRecommendationArtifact: artifact,
      lastComparisonArtifact: comparisonArtifact,
    })
    return {
      text: `Top 3 comparison\n${comparisonArtifact.text}`,
      purpose: "question",
      chips: ["표로 비교해줘", "추천해주세요", "전체 보기"],
      isComplete: false,
      recommendation: null,
      sessionState,
      evidenceSummaries: null,
      candidateSnapshot: artifact,
      extractedField: null,
      requestPreparation: null,
      primaryExplanation: null,
      primaryFactChecked: null,
      altExplanations: [],
      altFactChecked: [],
    }
  }

  if (normalized.includes("표로 비교") || normalized.includes("table")) {
    const compared = keepComparison?.comparedProductCodes ?? artifact.slice(0, 3).map(candidate => candidate.productCode)
    const rows = artifact.filter(candidate => compared.includes(candidate.productCode))
    const sessionState = buildSessionState({
      displayedProducts: artifact,
      fullDisplayedProducts: artifact,
      currentMode: "comparison",
      lastAction: "compare_products",
      uiNarrowingPath: (prev?.uiNarrowingPath ?? []) as RecommendSessionState["uiNarrowingPath"],
      lastRecommendationArtifact: artifact,
      lastComparisonArtifact: keepComparison ?? {
        comparedProductCodes: rows.map(candidate => candidate.productCode),
        comparedRanks: rows.map(candidate => candidate.rank ?? 0),
        compareField: null,
        text: "",
      },
    })
    return {
      text: [
        "| Code | Series | Coating | Stock |",
        "| --- | --- | --- | --- |",
        ...rows.map(candidate => `| ${candidate.displayCode} | ${candidate.seriesName} | ${candidate.coating} | ${candidate.totalStock ?? "-"} |`),
      ].join("\n"),
      purpose: "question",
      chips: ["추천해주세요", "전체 보기"],
      isComplete: false,
      recommendation: null,
      sessionState,
      evidenceSummaries: null,
      candidateSnapshot: artifact,
      extractedField: null,
      requestPreparation: null,
      primaryExplanation: null,
      primaryFactChecked: null,
      altExplanations: [],
      altFactChecked: [],
    }
  }

  if (normalized.includes("why this") || normalized.includes("왜 이 제품")) {
    const sessionState = buildSessionState({
      displayedProducts: prevDisplayed,
      fullDisplayedProducts: artifact,
      currentMode: "general_chat",
      lastAction: "explain_product",
      uiNarrowingPath: (prev?.uiNarrowingPath ?? []) as RecommendSessionState["uiNarrowingPath"],
      lastRecommendationArtifact: artifact,
      lastComparisonArtifact: keepComparison,
      underlyingAction: "show_recommendation",
    })
    return {
      text: "This product remains recommended because the persisted artifact still matches the original aluminum 4mm side-milling context.",
      purpose: "question",
      chips: ["추천해주세요", "상위 3개 비교해줘", "전체 보기"],
      isComplete: false,
      recommendation: null,
      sessionState,
      evidenceSummaries: null,
      candidateSnapshot: prevDisplayed,
      extractedField: null,
      requestPreparation: null,
      primaryExplanation: null,
      primaryFactChecked: null,
      altExplanations: [],
      altFactChecked: [],
    }
  }

  if (
    normalized.includes("coating") ||
    normalized.includes("bright finish") ||
    normalized.includes("diamond") ||
    normalized.includes("dlc")
  ) {
    const sessionState = buildSessionState({
      displayedProducts: prevDisplayed,
      fullDisplayedProducts: artifact,
      currentMode: "general_chat",
      lastAction: "explain_product",
      uiNarrowingPath: (prev?.uiNarrowingPath ?? []) as RecommendSessionState["uiNarrowingPath"],
      lastRecommendationArtifact: artifact,
      lastComparisonArtifact: keepComparison,
      underlyingAction: "show_recommendation",
    })
    return {
      text: "Coating explanation returned while preserving the persisted recommendation artifact.",
      purpose: "question",
      chips: ["Recommend", "Full View", "Compare Top 3"],
      isComplete: false,
      recommendation: null,
      sessionState,
      evidenceSummaries: null,
      candidateSnapshot: prevDisplayed,
      extractedField: null,
      requestPreparation: null,
      primaryExplanation: null,
      primaryFactChecked: null,
      altExplanations: [],
      altFactChecked: [],
    }
  }

  if (normalized.includes("점심") || normalized.includes("날씨") || normalized.includes("lunch") || normalized.includes("weather")) {
    const sessionState = buildSessionState({
      displayedProducts: prevDisplayed,
      fullDisplayedProducts: artifact,
      currentMode: "general_chat",
      lastAction: "redirect_off_topic",
      uiNarrowingPath: (prev?.uiNarrowingPath ?? []) as RecommendSessionState["uiNarrowingPath"],
      lastRecommendationArtifact: artifact,
      lastComparisonArtifact: keepComparison,
      underlyingAction: "show_recommendation",
    })
    return {
      text: "Side chat acknowledged. Your recommendation task remains active underneath and can be restored immediately.",
      purpose: "question",
      chips: ["원래 작업으로 돌아가자", "추천해주세요", "전체 보기"],
      isComplete: false,
      recommendation: null,
      sessionState,
      evidenceSummaries: null,
      candidateSnapshot: prevDisplayed,
      extractedField: null,
      requestPreparation: null,
      primaryExplanation: null,
      primaryFactChecked: null,
      altExplanations: [],
      altFactChecked: [],
    }
  }

  if (normalized.includes("원래 작업") || normalized.includes("이전 작업")) {
    const sessionState = buildSessionState({
      displayedProducts: artifact,
      fullDisplayedProducts: artifact,
      currentMode: "task",
      lastAction: "resume_previous_task",
      uiNarrowingPath: (prev?.uiNarrowingPath ?? []) as RecommendSessionState["uiNarrowingPath"],
      lastRecommendationArtifact: artifact,
      lastComparisonArtifact: keepComparison,
    })
    return {
      text: "Returned to the persisted recommendation task.",
      purpose: "question",
      chips: ["추천해주세요", "다른 시리즈 보기", "상위 3개 비교해줘"],
      isComplete: false,
      recommendation: null,
      sessionState,
      evidenceSummaries: null,
      candidateSnapshot: artifact,
      extractedField: null,
      requestPreparation: null,
      primaryExplanation: null,
      primaryFactChecked: null,
      altExplanations: [],
      altFactChecked: [],
    }
  }

  if (normalized.includes("why no candidates") || normalized.includes("왜 후보가 없")) {
    const sessionState = buildSessionState({
      displayedProducts: prevDisplayed,
      fullDisplayedProducts: artifact,
      currentMode: "general_chat",
      lastAction: "answer_general",
      uiNarrowingPath: (prev?.uiNarrowingPath ?? []) as RecommendSessionState["uiNarrowingPath"],
      lastRecommendationArtifact: artifact,
      lastComparisonArtifact: keepComparison,
      underlyingAction: "show_recommendation",
    })
    return {
      text: "There are still persisted candidates. If the UI ever shows none here, that indicates a restore/synchronization regression rather than an empty recommendation artifact.",
      purpose: "question",
      chips: ["전체 보기", "추천해주세요"],
      isComplete: false,
      recommendation: null,
      sessionState,
      evidenceSummaries: null,
      candidateSnapshot: prevDisplayed,
      extractedField: null,
      requestPreparation: null,
      primaryExplanation: null,
      primaryFactChecked: null,
      altExplanations: [],
      altFactChecked: [],
    }
  }

  if (normalized.includes("diameter") || normalized.includes("직경과 소재") || normalized.includes("소재가 뭐")) {
    const sessionState = buildSessionState({
      displayedProducts: prevDisplayed,
      fullDisplayedProducts: artifact,
      currentMode: "general_chat",
      lastAction: "confirm_scope",
      uiNarrowingPath: (prev?.uiNarrowingPath ?? []) as RecommendSessionState["uiNarrowingPath"],
      lastRecommendationArtifact: artifact,
      lastComparisonArtifact: keepComparison,
      underlyingAction: "show_recommendation",
    })
    return {
      text: "Original context is still persisted: Aluminum, 4mm, Side Milling, End Mill.",
      purpose: "question",
      chips: ["추천해주세요", "전체 보기"],
      isComplete: false,
      recommendation: null,
      sessionState,
      evidenceSummaries: null,
      candidateSnapshot: prevDisplayed,
      extractedField: null,
      requestPreparation: null,
      primaryExplanation: null,
      primaryFactChecked: null,
      altExplanations: [],
      altFactChecked: [],
    }
  }

  if (normalized.includes("recommend") || normalized.includes("추천해주세요")) {
    if (normalized.includes("sync check") || normalized.includes("state sync check")) {
      const focused = artifact.filter(candidate => String(candidate.seriesName).toUpperCase() === "E5D70")
      const sessionState = buildSessionState({
        displayedProducts: focused,
        fullDisplayedProducts: artifact,
        currentMode: "group_focus",
        lastAction: "restore_previous_group",
        uiNarrowingPath: (prev?.uiNarrowingPath ?? []) as RecommendSessionState["uiNarrowingPath"],
        activeGroupKey: "E5D70",
        lastRecommendationArtifact: artifact,
        lastComparisonArtifact: keepComparison,
        underlyingAction: "show_recommendation",
      })
      return {
        text: "State sync check: UI must render the persisted focused group, not the stale candidate snapshot payload.",
        purpose: "question",
        chips: ["Full View", "Recommend"],
        isComplete: false,
        recommendation: null,
        sessionState,
        evidenceSummaries: null,
        candidateSnapshot: artifact,
        extractedField: null,
        requestPreparation: null,
        primaryExplanation: null,
        primaryFactChecked: null,
        altExplanations: [],
        altFactChecked: [],
      }
    }

    const recommendationCandidates = prevDisplayed.length > 0 ? prevDisplayed : artifact
    const sessionState = buildSessionState({
      displayedProducts: recommendationCandidates,
      fullDisplayedProducts: artifact,
      currentMode: "recommendation",
      lastAction: "show_recommendation",
      uiNarrowingPath: (prev?.uiNarrowingPath ?? []) as RecommendSessionState["uiNarrowingPath"],
      activeGroupKey: prev?.activeGroupKey ?? null,
      lastRecommendationArtifact: artifact,
      lastComparisonArtifact: keepComparison,
    })
    return {
      text: `Recommendation restored from persisted state for ${recommendationCandidates[0]?.displayCode ?? "the current artifact"}.`,
      purpose: "recommendation",
      chips: ["상위 3개 비교해줘", "전체 보기", "다른 시리즈 보기"],
      isComplete: true,
      recommendation: buildRecommendation(recommendationCandidates),
      sessionState,
      evidenceSummaries: null,
      candidateSnapshot: recommendationCandidates,
      extractedField: null,
      requestPreparation: null,
      primaryExplanation: null,
      primaryFactChecked: null,
      altExplanations: [],
      altFactChecked: [],
    }
  }

  const sessionState = buildSessionState({
    displayedProducts: prevDisplayed,
    fullDisplayedProducts: artifact,
    currentMode: "general_chat",
    lastAction: "answer_general",
    uiNarrowingPath: (prev?.uiNarrowingPath ?? []) as RecommendSessionState["uiNarrowingPath"],
    lastRecommendationArtifact: artifact,
    lastComparisonArtifact: keepComparison,
    underlyingAction: "show_recommendation",
  })
  return {
    text: "General answer returned while preserving the active recommendation artifact underneath.",
    purpose: "question",
    chips: ["추천해주세요", "전체 보기"],
    isComplete: false,
    recommendation: null,
    sessionState,
    evidenceSummaries: null,
    candidateSnapshot: prevDisplayed,
    extractedField: null,
    requestPreparation: null,
    primaryExplanation: null,
    primaryFactChecked: null,
    altExplanations: [],
    altFactChecked: [],
  }
}

function safeJsonParse(text: string): RecommendResponsePayload | null {
  try {
    return JSON.parse(text) as RecommendResponsePayload
  } catch {
    return null
  }
}

function buildSessionSnapshot(payload: RecommendResponsePayload | null) {
  const session = payload?.sessionState ?? null
  const resolved = session?.resolvedInput ?? null
  return {
    purpose: payload?.purpose ?? null,
    candidateCount: session?.candidateCount ?? null,
    currentMode: session?.currentMode ?? null,
    lastAction: session?.lastAction ?? null,
    underlyingAction: session?.underlyingAction ?? null,
    restoreTarget: session?.restoreTarget ?? null,
    activeGroupKey: session?.activeGroupKey ?? null,
    resolvedInput: {
      material: resolved?.material ?? null,
      operationType: resolved?.operationType ?? null,
      toolType: resolved?.toolType ?? null,
      toolSubtype: resolved?.toolSubtype ?? null,
      diameterMm: resolved?.diameterMm ?? null,
      unitSystem: resolved?.unitSystem ?? null,
    },
  }
}

function buildArtifactSnapshot(payload: RecommendResponsePayload | null) {
  const session = payload?.sessionState ?? null
  const displayedProducts = session?.displayedProducts ?? session?.displayedCandidates ?? []
  const displayedGroups = session?.displayedSeriesGroups ?? session?.displayedGroups ?? []
  const candidateSnapshot = payload?.candidateSnapshot ?? []
  return {
    displayedProductsCount: Array.isArray(displayedProducts) ? displayedProducts.length : 0,
    displayedProductCodes: Array.isArray(displayedProducts)
      ? displayedProducts.slice(0, 12).map(product => product.displayCode ?? null)
      : [],
    displayedOptionsCount: Array.isArray(session?.displayedOptions) ? session.displayedOptions.length : 0,
    displayedOptions: Array.isArray(session?.displayedOptions)
      ? session.displayedOptions.slice(0, 12).map(option => ({
          label: option.label ?? null,
          value: option.value ?? null,
          kind: option.kind ?? null,
        }))
      : [],
    displayedSeriesGroupsCount: Array.isArray(displayedGroups) ? displayedGroups.length : 0,
    displayedSeriesGroups: Array.isArray(displayedGroups)
      ? displayedGroups.slice(0, 12).map(group => ({
          seriesName: group.seriesName ?? null,
          seriesKey: group.seriesKey ?? null,
          candidateCount: group.candidateCount ?? null,
        }))
      : [],
    lastRecommendationArtifactCount: Array.isArray(session?.lastRecommendationArtifact)
      ? session.lastRecommendationArtifact.length
      : 0,
    lastRecommendationCodes: Array.isArray(session?.lastRecommendationArtifact)
      ? session.lastRecommendationArtifact.slice(0, 12).map(product => product.displayCode ?? null)
      : [],
    lastComparisonArtifact: session?.lastComparisonArtifact
      ? {
          comparedProductCodes: session.lastComparisonArtifact.comparedProductCodes ?? [],
          comparedRanks: session.lastComparisonArtifact.comparedRanks ?? [],
          compareField: session.lastComparisonArtifact.compareField ?? null,
          hasText: Boolean(session.lastComparisonArtifact.text),
        }
      : null,
    uiNarrowingPath: Array.isArray(session?.uiNarrowingPath)
      ? session.uiNarrowingPath.map(entry => ({
          kind: entry.kind ?? null,
          field: entry.field ?? null,
          label: entry.label ?? null,
          value: entry.value ?? null,
          candidateCount: entry.candidateCount ?? null,
        }))
      : [],
    candidateSnapshotCount: Array.isArray(candidateSnapshot) ? candidateSnapshot.length : 0,
    candidateSnapshotCodes: Array.isArray(candidateSnapshot)
      ? candidateSnapshot.slice(0, 12).map(product => product.displayCode ?? null)
      : [],
  }
}

async function buildDomSnapshot(page: Page) {
  return page.evaluate(() => {
    const text = document.body.innerText
    const buttonTexts = Array.from(document.querySelectorAll("button"))
      .map(button => button.textContent?.trim() ?? "")
      .filter(Boolean)
    const candidateCards = Array.from(document.querySelectorAll("div"))
      .map(node => node.textContent?.trim() ?? "")
      .filter(value => /^#\d+\s/.test(value))
      .slice(0, 12)

    return {
      url: window.location.href,
      heading: document.querySelector("h1, h2")?.textContent?.trim() ?? null,
      hasNoCandidatesMessage:
        text.includes("조건에 맞는 제품을 찾지 못했습니다") ||
        text.includes("조건에 맞는 제품 없음"),
      visibleInputContext: {
        hasAluminum: text.includes("알루미늄"),
        has4mm: text.includes("4mm"),
        hasSideMilling: text.includes("측면가공"),
      },
      visibleChips: buttonTexts.filter(label =>
        [
          "추천해주세요",
          "전체 보기",
          "다른 시리즈 보기",
          "표로 비교해줘",
          "상위 3개 비교해줘",
          "이전 단계",
          "추천 제품 보기",
        ].some(token => label.includes(token)),
      ),
      candidateCards,
    }
  })
}

function coerceRegex(pattern: RegExp | string): RegExp {
  if (pattern instanceof RegExp) return pattern
  return new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
}

export class RecommendationHarness {
  private interactions: InteractionRecord[] = []
  private scenarioRouteInstalled = false

  constructor(
    private readonly page: Page,
    private readonly testInfo: TestInfo,
  ) {}

  latestPayload(): RecommendResponsePayload | null {
    return this.interactions.at(-1)?.responsePayload ?? null
  }

  latestInteraction() {
    return this.interactions.at(-1) ?? null
  }

  latestSession(): RecommendSessionState | null {
    return this.latestPayload()?.sessionState ?? null
  }

  async gotoProducts() {
    await this.installCanonicalScenarioRoute()
    await this.page.goto("/products")
    await this.page.waitForLoadState("networkidle")
    await this.page.getByRole("button", { name: "English" }).click()
    await expect(this.page.getByText(/Basic Info Before Recommendation/)).toBeVisible()
  }

  async startAluminum4mmSideMillingRecommendation() {
    await this.gotoProducts()
    const sections = this.page.locator("div.bg-white.rounded-2xl.border.border-gray-200.p-4.space-y-3")

    await sections.nth(0).getByRole("button", { name: /New Product Recommendation/ }).click()
    await sections.nth(1).getByRole("button", { name: /Aluminum \/ Non-ferrous/ }).click()
    await sections.nth(2).getByRole("button", { name: /Side Milling/ }).click()
    await sections.nth(3).getByRole("button", { name: /End Mill \(Square \/ Ball \/ CR\)/ }).click()
    await sections.nth(4).getByRole("button", { name: /4mm/ }).click()
    await sections.nth(5).locator("button").first().click()

    const reviewButton = this.page.getByRole("button", { name: /Review Conditions/ })
    await expect(reviewButton).toBeEnabled()
    await reviewButton.click()
    return this.captureRecommendResponse(async () => {
      await this.page.getByRole("button", { name: /Start Recommendation/ }).click()
      await expect(this.page.getByText(/AI Product Search/)).toBeVisible()
    })
  }

  async ensureRecommendationResponse() {
    const latest = this.latestPayload()
    if (latest?.purpose === "recommendation" || latest?.recommendation) return latest
    return this.sendChat("추천해주세요")
  }

  async sendChat(message: string) {
    const input = this.page.getByPlaceholder(/Enter additional questions or conditions|추가 질문이나 조건을 입력하세요/)
    await expect(input).toBeVisible()
    await input.fill(message)
    return this.captureRecommendResponse(async () => {
      await input.press("Enter")
    })
  }

  getSeriesNames(payload: RecommendResponsePayload | null = this.latestPayload()): string[] {
    const groups = payload?.sessionState?.displayedSeriesGroups ?? payload?.sessionState?.displayedGroups ?? []
    return Array.isArray(groups)
      ? groups.map(group => group.seriesName).filter((value): value is string => Boolean(value))
      : []
  }

  pickAnotherSeries(excluded: string[] = [], payload: RecommendResponsePayload | null = this.latestPayload()) {
    const excludedSet = new Set(excluded.map(value => value.toUpperCase()))
    return this.getSeriesNames(payload).find(series => !excludedSet.has(series.toUpperCase())) ?? null
  }

  async expectInputContextVisible() {
    await expect(this.page.getByText(/Aluminum|알루미늄/).first()).toBeVisible()
    await expect(this.page.getByText(/4mm/).first()).toBeVisible()
    await expect(this.page.getByText(/Side Milling|측면가공/).first()).toBeVisible()
  }

  async expectLastMessageContains(pattern: RegExp | string) {
    const regex = coerceRegex(pattern)
    const messageBubbles = this.page.locator(".markdown-content, .whitespace-pre-wrap")
    await expect(messageBubbles.last()).toContainText(regex)
  }

  async expectCandidateCodesVisible(visibleCodes: string[], hiddenCodes: string[] = []) {
    for (const code of visibleCodes) {
      await expect(this.page.getByText(code, { exact: false }).first()).toBeVisible()
    }
    for (const code of hiddenCodes) {
      await expect(this.page.getByText(code, { exact: false })).toHaveCount(0)
    }
  }


  expectOriginalContext(payload: RecommendResponsePayload | null = this.latestPayload()) {
    const resolved = payload?.sessionState?.resolvedInput
    expect(resolved, "resolvedInput should remain available").toBeTruthy()
    expect(String(resolved?.material ?? "")).toMatch(/알루미늄|aluminum/i)
    expect(resolved?.diameterMm).toBe(4)
    expect(String(resolved?.operationType ?? "")).toMatch(/측면가공|side/i)
  }

  expectPersistedArtifacts(payload: RecommendResponsePayload | null = this.latestPayload()) {
    const session = payload?.sessionState
    expect(session, "sessionState should exist").toBeTruthy()
    const displayedProducts = session?.displayedProducts ?? session?.displayedCandidates ?? []
    expect(Array.isArray(displayedProducts) && displayedProducts.length > 0, "displayed products should persist").toBeTruthy()
    expect(Array.isArray(session?.lastRecommendationArtifact) && session.lastRecommendationArtifact.length > 0, "last recommendation artifact should persist").toBeTruthy()
  }

  expectNoSilentReset(payload: RecommendResponsePayload | null = this.latestPayload()) {
    const session = payload?.sessionState
    expect(session, "sessionState should exist").toBeTruthy()
    expect(session?.candidateCount ?? 0, "candidateCount should stay positive").toBeGreaterThan(0)
    expect(session?.lastRecommendationArtifact?.length ?? 0, "recommendation artifact should stay persisted").toBeGreaterThan(0)
    expect(String(session?.resolvedInput?.material ?? "")).toMatch(/aluminum|알루미늄/i)
    expect(session?.resolvedInput?.diameterMm).toBe(4)
  }

  expectMode(expectedMode: string, payload: RecommendResponsePayload | null = this.latestPayload()) {
    expect(payload?.sessionState?.currentMode).toBe(expectedMode)
  }

  expectActiveSeries(expectedSeries: string | null, payload: RecommendResponsePayload | null = this.latestPayload()) {
    expect(payload?.sessionState?.activeGroupKey ?? null).toBe(expectedSeries)
  }

  expectPathKinds(expectedKinds: string[], payload: RecommendResponsePayload | null = this.latestPayload()) {
    const kinds = (payload?.sessionState?.uiNarrowingPath ?? []).map(entry => entry.kind).filter(Boolean)
    for (const kind of expectedKinds) {
      expect(kinds).toContain(kind)
    }
  }

  expectDisplayedCount(count: number, payload: RecommendResponsePayload | null = this.latestPayload()) {
    const displayed = payload?.sessionState?.displayedProducts ?? payload?.sessionState?.displayedCandidates ?? []
    expect(displayed.length).toBe(count)
  }

  async attachFailureArtifacts() {
    if (this.testInfo.status === this.testInfo.expectedStatus) return

    try {
      await this.testInfo.attach("failure-screenshot", {
        body: await this.page.screenshot({ fullPage: true }),
        contentType: "image/png",
      })
    } catch {
      // Browser may already be closed on timeout. Keep the JSON diagnostics below.
    }

    await this.testInfo.attach("recommendation-interactions.json", {
      body: Buffer.from(JSON.stringify(this.interactions, null, 2), "utf8"),
      contentType: "application/json",
    })

    const latestPayload = this.latestPayload()
    await this.testInfo.attach("latest-response-payload.json", {
      body: Buffer.from(JSON.stringify(latestPayload, null, 2), "utf8"),
      contentType: "application/json",
    })

    await this.testInfo.attach("latest-session-snapshot.json", {
      body: Buffer.from(JSON.stringify(buildSessionSnapshot(latestPayload), null, 2), "utf8"),
      contentType: "application/json",
    })

    await this.testInfo.attach("latest-displayed-artifact-snapshot.json", {
      body: Buffer.from(JSON.stringify(buildArtifactSnapshot(latestPayload), null, 2), "utf8"),
      contentType: "application/json",
    })

    try {
      await this.testInfo.attach("latest-dom-snapshot.json", {
        body: Buffer.from(JSON.stringify(await buildDomSnapshot(this.page), null, 2), "utf8"),
        contentType: "application/json",
      })
    } catch {
      // Ignore DOM snapshot failures after browser shutdown.
    }
  }

  private async captureRecommendResponse(trigger: () => Promise<void>) {
    const responsePromise = this.page.waitForResponse(response =>
      response.url().includes("/api/recommend") && response.request().method() === "POST",
    )

    await trigger()

    const response = await responsePromise
    const responseText = await response.text()
    const responsePayload = safeJsonParse(responseText)
    const requestBody = this.readRequestBody(response.request())
    const record: InteractionRecord = {
      at: new Date().toISOString(),
      requestBody,
      status: response.status(),
      responseText,
      responsePayload,
      sessionSnapshot: buildSessionSnapshot(responsePayload),
      artifactSnapshot: buildArtifactSnapshot(responsePayload),
    }

    this.interactions.push(record)

    expect(response.ok(), `Expected /api/recommend to succeed but got ${response.status()}.\n${responseText}`).toBeTruthy()
    await expect(this.page.getByPlaceholder(/Enter additional questions or conditions|추가 질문이나 조건을 입력하세요/)).toBeEnabled()

    return responsePayload
  }

  private readRequestBody(request: { postDataJSON?: () => unknown; postData?: () => string | null }) {
    try {
      if (typeof request.postDataJSON === "function") {
        return request.postDataJSON()
      }
    } catch {
      // Fall through to raw text.
    }

    try {
      return request.postData?.() ?? null
    } catch {
      return null
    }
  }

  private async installCanonicalScenarioRoute() {
    if (this.scenarioRouteInstalled) return
    this.scenarioRouteInstalled = true

    await this.page.route("**/api/recommend", async route => {
      const request = route.request()
      const rawPostData = request.postData()
      if (!rawPostData) {
        await route.continue()
        return
      }

      let body: JsonRecord
      try {
        body = JSON.parse(rawPostData) as JsonRecord
      } catch {
        await route.continue()
        return
      }
      const responsePayload = buildMockResponseFromRequest(body)
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(responsePayload),
      })
    })
  }
}
