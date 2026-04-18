/**
 * Client for the Python /products + /filter-options endpoints (proxied via
 * Next.js /api/products and /api/filter-options). Types mirror
 * python-api/schemas.py — keep in sync when the Python side changes.
 */

import type {
  RecommendationAppliedFilterDto,
  RecommendationCandidateDto,
  RecommendationPublicSessionDto,
  RecommendationResponseDto,
} from "@/lib/contracts/recommendation"
import { DEFAULT_RECOMMENDATION_CAPABILITIES } from "@/lib/frontend/recommendation/recommendation-view-model"

// NEXT_PUBLIC_* are inlined at build time, so this is a client-bundle constant.
export const USE_PYTHON_API = process.env.NEXT_PUBLIC_USE_PYTHON_API === "true"

export interface ManualFilters {
  purpose?: string | null
  material_tag?: string | null
  machining_category?: string | null
  application_shape?: string | null
  diameter?: number | null
  diameter_min?: number | null
  diameter_max?: number | null
  overall_length_min?: number | null
  overall_length_max?: number | null
  length_of_cut_min?: number | null
  length_of_cut_max?: number | null
  shank_diameter_min?: number | null
  shank_diameter_max?: number | null
  flute_count_min?: number | null
  flute_count_max?: number | null
  country?: string | null
  subtype?: string | null
  flute_count?: number | null
  coating?: string | null
  brand?: string | null
  tool_material?: string | null
  shank_type?: string | null
  coolant_hole?: string | null
}

export interface ProductCard {
  edp_no: string
  brand?: string | null
  series?: string | null
  tool_type?: string | null
  subtype?: string | null
  diameter?: string | null
  flutes?: string | null
  coating?: string | null
  material_tags?: string[] | null
  description?: string | null
  feature?: string | null
  oal?: string | null
  loc?: string | null
  helix_angle?: string | null
  coolant_hole?: string | null
  shank_type?: string | null
  score: number
  score_breakdown: Record<string, number>
}

export interface ProductSummary {
  edp_no: string
  brand?: string | null
  series?: string | null
  diameter?: string | null
  flutes?: string | null
  coating?: string | null
  score: number
}

export interface FilterOption {
  value: string
  count: number
}

export interface ProductsResponse {
  text: string
  purpose: string
  chips: string[]
  isComplete: boolean
  products: ProductCard[]
  allProducts: ProductSummary[]
  appliedFilters: Record<string, unknown>
  totalCount: number
  route: string
  availableFilters?: Record<string, FilterOption[]> | null
  session_id?: string | null
}

export interface FilterOptionsResponse {
  field: string
  options: FilterOption[]
  total_with_current_filters: number
}

export async function fetchProducts(
  message?: string,
  filters?: ManualFilters,
  sessionId?: string | null,
): Promise<ProductsResponse> {
  const res = await fetch("/api/products", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message, filters, session_id: sessionId ?? undefined }),
  })
  if (!res.ok) {
    const detail = await res.text().catch(() => "")
    throw new Error(`fetchProducts failed (${res.status}): ${detail || res.statusText}`)
  }
  return (await res.json()) as ProductsResponse
}

export async function fetchFilterOptions(
  field: string,
  currentFilters: ManualFilters,
): Promise<FilterOptionsResponse> {
  const res = await fetch("/api/filter-options", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ field, current_filters: currentFilters }),
  })
  if (!res.ok) {
    const detail = await res.text().catch(() => "")
    throw new Error(`fetchFilterOptions failed (${res.status}): ${detail || res.statusText}`)
  }
  return (await res.json()) as FilterOptionsResponse
}

// ── Adapter: Python ProductsResponse → RecommendationResponseDto ─────
// Python has no thinking/evidence/explanation yet, so those slots are
// filled with null/empty so the existing UI doesn't break.

function parseNumeric(raw: string | number | null | undefined): number | null {
  if (raw == null) return null
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null
  const m = String(raw).match(/-?\d+(\.\d+)?/)
  return m ? Number(m[0]) : null
}

function parseIntTok(raw: string | number | null | undefined): number | null {
  const n = parseNumeric(raw)
  return n == null ? null : Math.trunc(n)
}

function parseCoolantHole(raw: string | boolean | null | undefined): boolean | null {
  if (raw == null) return null
  if (typeof raw === "boolean") return raw
  const s = String(raw).trim().toLowerCase()
  if (["yes", "y", "true", "1", "있음", "o"].includes(s)) return true
  if (["no", "n", "false", "0", "없음", "x"].includes(s)) return false
  return null
}

function adaptProductCard(card: ProductCard, rank: number): RecommendationCandidateDto {
  return {
    rank,
    productCode: card.edp_no,
    displayCode: card.edp_no,
    displayLabel: null,
    brand: card.brand ?? null,
    seriesName: card.series ?? null,
    seriesIconUrl: null,
    diameterMm: parseNumeric(card.diameter ?? null),
    fluteCount: parseIntTok(card.flutes ?? null),
    coating: card.coating ?? null,
    toolSubtype: card.subtype ?? null,
    toolMaterial: null,
    shankDiameterMm: null,
    shankType: card.shank_type ?? null,
    lengthOfCutMm: parseNumeric(card.loc ?? null),
    overallLengthMm: parseNumeric(card.oal ?? null),
    helixAngleDeg: parseNumeric(card.helix_angle ?? null),
    coolantHole: parseCoolantHole(card.coolant_hole ?? null),
    ballRadiusMm: null,
    taperAngleDeg: null,
    pointAngleDeg: null,
    threadPitchMm: null,
    description: card.description ?? null,
    featureText: card.feature ?? null,
    materialTags: Array.isArray(card.material_tags)
      ? card.material_tags.filter((t): t is string => typeof t === "string")
      : [],
    materialRating: null,
    score: typeof card.score === "number" && Number.isFinite(card.score) ? card.score : 0,
    scoreBreakdown: (card.score_breakdown ?? null) as unknown as RecommendationCandidateDto["scoreBreakdown"],
    matchStatus: "none",
    stockStatus: "unknown",
    totalStock: null,
    inventorySnapshotDate: null,
    inventoryLocations: [],
    hasEvidence: false,
    bestCondition: null,
  }
}

function adaptProductSummary(row: ProductSummary, rank: number): RecommendationCandidateDto {
  return {
    rank,
    productCode: row.edp_no,
    displayCode: row.edp_no,
    displayLabel: null,
    brand: row.brand ?? null,
    seriesName: row.series ?? null,
    seriesIconUrl: null,
    diameterMm: parseNumeric(row.diameter ?? null),
    fluteCount: parseIntTok(row.flutes ?? null),
    coating: row.coating ?? null,
    toolSubtype: null,
    toolMaterial: null,
    shankDiameterMm: null,
    shankType: null,
    lengthOfCutMm: null,
    overallLengthMm: null,
    helixAngleDeg: null,
    coolantHole: null,
    ballRadiusMm: null,
    taperAngleDeg: null,
    pointAngleDeg: null,
    threadPitchMm: null,
    description: null,
    featureText: null,
    materialTags: [],
    materialRating: null,
    score: typeof row.score === "number" && Number.isFinite(row.score) ? row.score : 0,
    scoreBreakdown: null,
    matchStatus: "none",
    stockStatus: "unknown",
    totalStock: null,
    inventorySnapshotDate: null,
    inventoryLocations: [],
    hasEvidence: false,
    bestCondition: null,
  }
}

function adaptAppliedFilters(raw: Record<string, unknown> | null | undefined): RecommendationAppliedFilterDto[] {
  if (!raw || typeof raw !== "object") return []
  const out: RecommendationAppliedFilterDto[] = []
  for (const [field, value] of Object.entries(raw)) {
    if (value === null || value === undefined) continue
    const isScalar = typeof value === "string" || typeof value === "number" || typeof value === "boolean"
    const isScalarArray = Array.isArray(value)
      && value.every(v => typeof v === "string" || typeof v === "number" || typeof v === "boolean")
    const entry: RecommendationAppliedFilterDto = {
      field,
      op: "eq",
      value: Array.isArray(value) ? value.map(String).join(",") : String(value),
    }
    if (isScalar) entry.rawValue = value as string | number | boolean
    else if (isScalarArray) entry.rawValue = value as Array<string | number | boolean>
    out.push(entry)
  }
  return out
}

function buildMinimalSession(
  appliedFilters: RecommendationAppliedFilterDto[],
  totalCount: number,
): RecommendationPublicSessionDto {
  return {
    sessionId: null,
    candidateCount: totalCount,
    appliedFilters,
    narrowingHistory: [],
    resolutionStatus: "none",
    turnCount: 0,
    lastAskedField: null,
    lastAction: null,
    displayedChips: [],
    displayedOptions: [],
    capabilities: DEFAULT_RECOMMENDATION_CAPABILITIES,
  }
}

const DETAIL_LIMIT = 10

export function adaptProductsToRecommendationDto(
  payload: ProductsResponse,
  opts: { pageSize?: number } = {},
): RecommendationResponseDto {
  const pageSize = opts.pageSize ?? 20

  const detailed = (payload.products ?? []).slice(0, DETAIL_LIMIT).map((c, i) => adaptProductCard(c, i + 1))
  // Top-N get full detail; the rest of the first page comes from the compact
  // allProducts rows so the candidate panel sees a full page.
  const detailedCodes = new Set(detailed.map(c => c.productCode))
  const summary = (payload.allProducts ?? [])
    .filter(r => !detailedCodes.has(r.edp_no))
    .slice(0, Math.max(0, pageSize - detailed.length))
    .map((r, i) => adaptProductSummary(r, detailed.length + i + 1))

  const candidates = [...detailed, ...summary]
  const appliedFilters = adaptAppliedFilters(payload.appliedFilters)
  const totalItems = typeof payload.totalCount === "number" && Number.isFinite(payload.totalCount)
    ? payload.totalCount
    : candidates.length

  return {
    text: payload.text ?? "",
    purpose: "recommendation",
    chips: Array.isArray(payload.chips) ? payload.chips : [],
    isComplete: payload.isComplete !== false,
    recommendation: null,
    session: {
      publicState: buildMinimalSession(appliedFilters, totalItems),
      engineState: null,
    },
    candidates: candidates.length > 0 ? candidates : null,
    pagination: {
      page: 0,
      pageSize,
      totalItems,
      totalPages: Math.max(Math.ceil(totalItems / pageSize), 1),
    },
    evidenceSummaries: null,
    requestPreparation: null,
    primaryExplanation: null,
    primaryFactChecked: null,
    altExplanations: [],
    altFactChecked: [],
    capabilities: DEFAULT_RECOMMENDATION_CAPABILITIES,
    reasoningVisibility: "hidden",
    thinkingProcess: null,
    thinkingDeep: null,
  }
}
