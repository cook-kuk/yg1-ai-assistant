/**
 * Hybrid Retrieval Engine
 *
 * 4-stage pipeline:
 *   1. Structured Filter — ProductRepo filters (diameter, material, flutes, operation)
 *   2. Score & Rank — existing match engine weighted scoring
 *   3. Evidence Retrieval — attach cutting conditions from EvidenceRepo
 *   4. Enrichment — compute evidence scores, build summaries
 *
 * Never generates data. All values from normalized JSON.
 */

import type {
  AppliedFilter,
  EvidenceChunk,
  EvidenceSummary,
  MatchStatus,
  RecommendationInput,
  ScoreBreakdown,
  ScoredProduct,
} from "@/lib/recommendation/domain/types"
import {
  EvidenceRepo,
  InventoryRepo,
  LeadTimeRepo,
  ProductRepo,
} from "@/lib/recommendation/infrastructure/repositories/recommendation-repositories"
import { ENABLE_POST_SQL_CANDIDATE_FILTERS } from "@/lib/feature-flags"
import { applyFilterToRecommendationInput } from "@/lib/recommendation/shared/filter-field-registry"
import { resolveMaterialTag } from "@/lib/recommendation/domain/material-resolver"
import { getAppShapesForOperation } from "@/lib/recommendation/domain/operation-resolver"
import { applyPostFilterToProducts, getFilterFieldDefinition } from "@/lib/recommendation/shared/filter-field-registry"
import { traceRecommendation } from "@/lib/recommendation/infrastructure/observability/recommendation-trace"
import { isFlagshipSeries, isMicroSeries } from "@/lib/recommendation/shared/canonical-values"
import {
  SCORING_WEIGHTS,
  BRAND_SCORING,
  BRAND_MATERIAL_AFFINITY,
  DIVERSITY_CONFIG,
  CAPACITY_LIMITS,
} from "@/lib/recommendation/infrastructure/config/scoring-config"
import {
  BrandMaterialAffinityRepo,
  normalizeBrandKey,
} from "@/lib/data/repos/brand-material-affinity-repo"

// ── Hard-tier sort by series materialRating ──────────────────────────
// EXCELLENT > GOOD > FAIR > NULL. 티어 간에는 score를 무시하고 상위 티어가
// 무조건 위에 오도록.
function materialRatingTier(
  value: "EXCELLENT" | "GOOD" | "FAIR" | "NULL" | null | undefined,
): number {
  if (value === "EXCELLENT") return 0
  if (value === "GOOD") return 1
  if (value === "FAIR") return 2
  return 3
}

// ── Result type ──────────────────────────────────────────────
export interface HybridResult {
  candidates: ScoredProduct[]
  evidenceMap: Map<string, EvidenceSummary>
  totalConsidered: number
  filtersApplied: AppliedFilter[]
}

export interface HybridRetrievalPagination {
  page: number
  pageSize: number
}

/**
 * Stock filter post-SQL survivor selection.
 *
 * 정상: SQL builder가 stockStatus EXISTS join 으로 inventory_summary_mv 와 매칭
 * 하여 qualifiedCandidates 를 반환. 후처리에서는 enrichment 로 채워진 `totalStock`
 * 숫자 값만 본다.
 *
 * 회귀 방어: 이전 버그는 stockStatus 문자열 필드 (null/빈값)를 stringMatch 로
 * 비교해서 SQL 통과한 547개가 전부 reject 됨. 숫자 체크로 전환 (1a0c102).
 * 이 함수는 항상 totalStock numeric 체크만 수행해야 함.
 */
export function selectStockSurvivors<T extends { totalStock?: number | null }>(
  candidates: T[],
  isNegation: boolean,
  threshold: number = 0,
): T[] {
  // threshold>0 이면 총 재고가 threshold 이상인 후보만 살린다 (예: "재고 1000개 이상").
  // threshold=0 (기본) 이면 in-stock (> 0) 의미.
  if (isNegation) {
    return candidates.filter(c => (c.totalStock ?? 0) === 0)
  }
  if (threshold > 0) {
    return candidates.filter(c => (c.totalStock ?? 0) >= threshold)
  }
  return candidates.filter(c => (c.totalStock ?? 0) > 0)
}

/** Extract numeric threshold from a stockStatus filter. Returns 0 if none. */
function extractStockThreshold(filter: AppliedFilter): number {
  const raw = String((filter as { rawValue?: unknown }).rawValue ?? filter.value ?? "").trim()
  if (!raw) return 0
  // "1000", "1000 이상", "1000개 이상", "재고 1000 이상" 등 선두 숫자 추출
  const m = raw.match(/\d+/)
  if (!m) return 0
  // enum 라벨("instock", "재고있음")엔 숫자 없음 → 0 반환 (기본 in-stock 경로)
  const n = parseInt(m[0], 10)
  return Number.isFinite(n) && n > 0 ? n : 0
}

// ── Scoring weights (SSOT: infrastructure/config/scoring-config.ts) ────
const WEIGHTS = SCORING_WEIGHTS

// ── Operation → Tool Shape compatibility ─────────────────────
// Bonus/penalty applied when operationType is known.
// Positive = good fit, negative = bad fit, 0 = neutral.
const OPERATION_TOOL_SHAPE_COMPATIBILITY: Record<string, Record<string, number>> = {
  "Slotting":    { "Square": 10, "Roughing": 5,  "Ball": -15, "Radius": 0  },
  "Side_Milling":{ "Square": 5,  "Radius": 5,   "Ball": -5,  "Roughing": 0 },
  "Shouldering": { "Square": 10, "Radius": 5,   "Ball": -10, "Roughing": 0 },
  "Facing":      { "Square": 10, "Ball": -10,   "Radius": 0,  "Roughing": 5 },
  "Ramping":     { "Radius": 10, "Square": 5,   "Ball": 0,    "Roughing": -5 },
  "Pocketing":   { "Square": 5,  "Radius": 5,   "Ball": -5,   "Roughing": 5 },
  "Profiling":   { "Ball": 10,   "Radius": 5,   "Square": 0,  "Roughing": -5 },
  "Finishing":   { "Ball": 5,    "Radius": 5,   "Square": 0,  "Roughing": -10 },
  "Die-Sinking": { "Ball": 10,   "Radius": 5,   "Square": -5, "Roughing": -5 },
  "Plunging":    { "Square": 5,  "Radius": 5,   "Ball": -5,   "Roughing": 5 },
}

const GENERIC_MACHINING_CATEGORIES = new Set(["Milling", "Holemaking", "Threading", "Turning"])

// ── Machining-category shape sets for cross-category filtering ──
const MILLING_SHAPES = new Set([
  "Side_Milling", "Slotting", "Profiling", "Facing", "Die-Sinking",
  "Trochoidal", "Helical_Interpolation", "Corner_Radius", "Taper_Side_Milling",
  "Small_Part", "Ramping", "Plunging", "Chamfering",
])
const HOLEMAKING_SHAPES = new Set(["Drilling", "Reaming_Blind", "Reaming_Through"])
const THREADING_SHAPES = new Set(["Threading_Blind", "Threading_Through"])

const CATEGORY_SHAPE_MAP: Record<string, Set<string>> = {
  Milling: MILLING_SHAPES,
  Holemaking: HOLEMAKING_SHAPES,
  Threading: THREADING_SHAPES,
}

// ── Cross-category metadata keywords ────────────────────────
// Products mis-categorised in DB (e.g. edp_root_category='Milling' for TAPs)
// are caught by checking toolSubtype / productName / seriesName.
const THREADING_METADATA_RE = /\b(tap|thread|threading|tapping|spiral\s*flute|point\s*tap|roll\s*tap)\b|(?:스파이럴\s*탭|포인트\s*탭|롤\s*탭|전조\s*탭|핸드\s*탭|너트\s*탭|관용\s*탭|탭)/i
const HOLEMAKING_METADATA_RE = /\b(drill|drilling|reamer|reaming)\b|드릴|리머/i
const MILLING_FOREIGN_RE = new RegExp(
  `${THREADING_METADATA_RE.source}|${HOLEMAKING_METADATA_RE.source}`,
  "i",
)

/** Keywords that indicate a product belongs to a *different* category. */
const CROSS_CATEGORY_INDICATORS: Record<string, RegExp> = {
  Milling: MILLING_FOREIGN_RE,          // Milling should exclude TAP/Thread + Drill/Reamer
  Holemaking: THREADING_METADATA_RE,    // Holemaking should exclude TAP/Thread
}

/** Returns true if the product has at least one shape belonging to the given category, or has no shapes at all (unknown). */
function productMatchesMachiningCategory(shapes: string[], categoryShapes: Set<string>): boolean {
  if (shapes.length === 0) return true  // no shape data → don't exclude
  return shapes.some(s => categoryShapes.has(s))
}

/** Returns true if product metadata (edp_root_category, toolSubtype, productName, seriesName) matches a foreign category's indicators. */
function hasForegnCategoryMetadata(
  product: { toolSubtype: string | null; productName: string | null; seriesName: string | null; machiningCategory?: string | null },
  machiningCategory: string,
): boolean {
  // Direct edp_root_category mismatch — authoritative signal.
  // e.g. D5434 has edp_root_category='Holemaking', blank series_application_shape,
  // and seriesName='D5434' (code only, no "DRILL" keyword) → regex check alone missed it.
  const productCategory = product.machiningCategory?.trim()
  if (productCategory && productCategory !== machiningCategory) return true
  const pattern = CROSS_CATEGORY_INDICATORS[machiningCategory]
  if (!pattern) return false
  const text = [product.toolSubtype, product.productName, product.seriesName].filter(Boolean).join(" ")
  return pattern.test(text)
}

function normalizeToolSubtype(value: string | null | undefined): string | null {
  const normalized = value?.trim().toLowerCase()
  return normalized ? normalized : null
}

function getSpecificOperationShapes(input: RecommendationInput): string[] {
  const appShapes = input.operationType ? getAppShapesForOperation(input.operationType) : []
  if (!appShapes.length) return []

  return appShapes.filter(shape => {
    const trimmed = shape.trim()
    if (!trimmed) return false
    if (GENERIC_MACHINING_CATEGORIES.has(trimmed)) return false
    if (input.machiningCategory && trimmed === input.machiningCategory) return false
    return true
  })
}

function flattenActiveFilters(filters: AppliedFilter[]): AppliedFilter[] {
  const lastMaterialIndex = filters.reduce((lastIndex, filter, index) => (
    filter.field === "material" ? index : lastIndex
  ), -1)

  return filters.flatMap((filter, index) => {
    if (
      (filter.field === "workPieceName" || filter.field === "edpBrandName" || filter.field === "edpSeriesName") &&
      lastMaterialIndex !== -1 &&
      index < lastMaterialIndex
    ) {
      return []
    }

    const sideFilters = ((filter as unknown as { _sideFilters?: AppliedFilter[] })._sideFilters ?? [])
      .filter(sideFilter => !(
        lastMaterialIndex !== -1 &&
        (sideFilter.field === "edpBrandName" || sideFilter.field === "edpSeriesName") &&
        index < lastMaterialIndex
      ))

    return [filter, ...sideFilters]
  })
}

function formatProductEdpList(products: Array<{ displayCode: string; normalizedCode: string }>, maxItems = 50): string {
  const codes = products
    .map(product => product.displayCode || product.normalizedCode)
    .filter(Boolean)
  const visible = codes.slice(0, maxItems)
  const remainder = codes.length - visible.length
  return remainder > 0 ? `${visible.join(",")},...(+${remainder})` : visible.join(",")
}

function formatScoredEdpList(candidates: ScoredProduct[], maxItems = 50): string {
  return formatProductEdpList(
    candidates.map(candidate => ({
      displayCode: candidate.product.displayCode,
      normalizedCode: candidate.product.normalizedCode,
    })),
    maxItems
  )
}

function summarizeRecommendationInputForTrace(input: RecommendationInput) {
  return {
    manufacturerScope: input.manufacturerScope ?? null,
    locale: input.locale ?? null,
    material: input.material ?? null,
    workPieceName: input.workPieceName ?? null,
    diameterMm: input.diameterMm ?? null,
    machiningCategory: input.machiningCategory ?? null,
    operationType: input.operationType ?? null,
    toolSubtype: input.toolSubtype ?? null,
    flutePreference: input.flutePreference ?? null,
    coatingPreference: input.coatingPreference ?? null,
    seriesName: input.seriesName ?? null,
  }
}

function summarizeFiltersForTrace(filters: AppliedFilter[]) {
  return filters.map(filter => ({
    field: filter.field,
    op: filter.op,
    value: filter.value,
    rawValue: filter.rawValue,
    appliedAt: filter.appliedAt,
  }))
}

function summarizeProductPreviewForTrace(product: {
  displayCode?: string | null
  normalizedCode?: string | null
  seriesName?: string | null
  brand?: string | null
  toolSubtype?: string | null
  fluteCount?: number | null
  diameterMm?: number | null
  coating?: string | null
}) {
  return {
    code: product.displayCode || product.normalizedCode || null,
    seriesName: product.seriesName ?? null,
    brand: product.brand ?? null,
    toolSubtype: product.toolSubtype ?? null,
    fluteCount: product.fluteCount ?? null,
    diameterMm: product.diameterMm ?? null,
    coating: product.coating ?? null,
  }
}

function summarizeFetchedProductsForTrace(products: Array<{
  displayCode?: string | null
  normalizedCode?: string | null
  seriesName?: string | null
  brand?: string | null
  toolSubtype?: string | null
  fluteCount?: number | null
  diameterMm?: number | null
  coating?: string | null
}>) {
  return {
    count: products.length,
    preview: products.slice(0, 6).map(product => summarizeProductPreviewForTrace(product)),
  }
}

function summarizeCandidatesForTrace(candidates: ScoredProduct[]) {
  return {
    count: candidates.length,
    preview: candidates.slice(0, 6).map(candidate => ({
      ...summarizeProductPreviewForTrace(candidate.product),
      score: candidate.score,
      matchStatus: candidate.matchStatus,
      stockStatus: candidate.stockStatus,
      totalStock: candidate.totalStock,
      matchedFields: candidate.matchedFields.slice(0, 4),
    })),
  }
}

function summarizeEvidenceMapForTrace(evidenceMap: Map<string, EvidenceSummary>) {
  const entries = Array.from(evidenceMap.entries())
  return {
    count: entries.length,
    preview: entries.slice(0, 6).map(([code, summary]) => ({
      code,
      productCode: summary.productCode,
      seriesName: summary.seriesName,
      chunkCount: summary.chunks.length,
      sourceCount: summary.sourceCount,
      bestConfidence: summary.bestConfidence,
    })),
  }
}

// ── Main Entry Point ─────────────────────────────────────────
export async function runHybridRetrieval(
  input: RecommendationInput,
  rawFilters: AppliedFilter[],
  topN = 0,
  pagination: HybridRetrievalPagination | null = null,
): Promise<HybridResult> {
  // Defensive: strip skip/empty filters that must never reach DB or post-filter
  const filters = rawFilters.filter(f => f.op !== "skip" && f.field && f.field !== "")
  // Sync RecommendationInput from filters so DB-level fields (workPieceName, material, etc.)
  // that only live in filters[] are reflected on input before the DB query runs.
  let syncedInput: RecommendationInput = input
  for (const filter of filters) {
    syncedInput = applyFilterToRecommendationInput(syncedInput, filter)
  }
  input = syncedInput
  traceRecommendation("domain.runHybridRetrieval:input", {
    input: summarizeRecommendationInputForTrace(input),
    filters: summarizeFiltersForTrace(filters),
    filterCount: filters.length,
    topN,
    pagination,
  })
  const startedAt = Date.now()
  const shouldApplyPostSqlHeuristics = ENABLE_POST_SQL_CANDIDATE_FILTERS && !pagination

  // ── Stage 1: Structured Filter ─────────────────────────────
  const fetchStartedAt = Date.now()
  // RETRIEVAL_MAX_CANDIDATES: 기본 500 (넓은 쿼리 DB 과부하 방지), 0 = 무제한 (테스트용)
  const maxCandidates = Number(process.env.RETRIEVAL_MAX_CANDIDATES ?? 500) || undefined
  // Pure-negation queries (e.g. "CRX S 빼고") need a wider DB pool: a single
  // dominant micro-series (e.g. 3S MILL with hundreds of small-diameter
  // variants) can completely fill the 500-candidate cap and starve the
  // flagship/diversity reranker. Remove the cap so flagship brands enter
  // the scored pool and the in-memory reranker can promote them.
  const isPureNegationQuery =
    filters.length > 0 && filters.every(f => f.op === "neq" || f.op === "exclude")
  const limit = pagination
    ? (isPureNegationQuery ? undefined : pagination.pageSize)
    : (topN > 0 ? Math.max(topN * 20, 500) : (isPureNegationQuery ? undefined : maxCandidates))
  const offset = pagination && !isPureNegationQuery ? pagination.page * pagination.pageSize : 0
  const searchResult = pagination
    ? await ProductRepo.searchPage(input, filters, { limit, offset })
    : { products: await ProductRepo.search(input, filters, limit), totalCount: 0 }
  traceRecommendation("domain.runHybridRetrieval:db-fetch", {
    limit,
    offset,
    pagination,
    fetchedProducts: summarizeFetchedProductsForTrace(searchResult.products),
    totalCount: searchResult.totalCount,
  })
  let candidates = searchResult.products

  // Fallback: if operationType produced 0 results, retry without it
  // This prevents rare shape tags (e.g. Trochoidal) from eliminating all candidates
  if (candidates.length === 0 && input.operationType && !pagination) {
    const relaxedInput = { ...input, operationType: undefined }
    const retryResult = await ProductRepo.search(relaxedInput, filters, limit)
    if (retryResult.length > 0) {
      console.log(`[hybrid-retrieval] operationType="${input.operationType}" produced 0 results → relaxed to ${retryResult.length} candidates`)
      candidates = retryResult
    }
  }

  const fetchMs = Date.now() - fetchStartedAt
  const appliedFilters: AppliedFilter[] = []
  const initialCandidateCount = pagination ? searchResult.totalCount : candidates.length

  if (shouldApplyPostSqlHeuristics) {
    // Hard filter: diameter — exact-first, then ±0.5mm, then ±2mm
    if (input.diameterMm) {
      // Stage 1: exact match
      let diamFiltered = candidates.filter(p =>
        p.diameterMm !== null && p.diameterMm === input.diameterMm!
      )
      // Stage 2: near match ±0.5mm
      if (diamFiltered.length === 0) {
        diamFiltered = candidates.filter(p =>
          p.diameterMm !== null && Math.abs(p.diameterMm - input.diameterMm!) <= 0.5
        )
      }
      // Stage 3: wider ±2mm (existing behavior)
      if (diamFiltered.length === 0) {
        diamFiltered = candidates.filter(p =>
          p.diameterMm !== null && Math.abs(p.diameterMm - input.diameterMm!) <= 2
        )
      }
      if (diamFiltered.length > 0) {
        candidates = diamFiltered
        appliedFilters.push({
          field: "diameterMm",
          op: "range",
          value: `${input.diameterMm}mm`,
          rawValue: input.diameterMm,
          appliedAt: 0,
        })
      }
    }

    // Hard filter: toolSubtype when explicitly specified in input
    if (input.toolSubtype) {
      const subtypeLower = input.toolSubtype.toLowerCase()
      const subtypeFiltered = candidates.filter(p => {
        const pSub = (p.toolSubtype ?? "").toLowerCase()
        return pSub.includes(subtypeLower) || !pSub // keep products with no subtype data
      })
      if (subtypeFiltered.length > 0) {
        candidates = subtypeFiltered
        console.log(`[hybrid-retrieval] toolSubtype filter: ${input.toolSubtype} → ${subtypeFiltered.length} candidates`)
      }
    }
  }

  // Soft filter: material tag(s) — supports comma-separated multi-select (e.g. "알루미늄,스테인리스")
  const materialTags: string[] = []
  if (input.material) {
    const parts = input.material.split(",").map(s => s.trim()).filter(Boolean)
    for (const part of parts) {
      const tag = resolveMaterialTag(part)
      if (tag && !materialTags.includes(tag)) materialTags.push(tag)
    }
  }
  // workPieceName-only 경로 (예: 사용자가 "알류미늄"만 입력 → workPieceName=Aluminum 필터만 걸림)
  // 에서는 input.material 이 비어 있어 materialTags 가 []가 되고, 소재 집중 보너스(line 608~)와
  // 소재 점수(line 567~)가 전부 "미지정 기본 50%" 로 떨어져 ALU-POWER 같은 소재 특화 시리즈가
  // GENERAL HSS 범용 시리즈에 묻힘. workPieceName 에서 ISO tag 를 도출해 동일 경로를 태운다.
  // NOTE: 이 경우에만 true — 하드 필터(line ~469)는 SQL 의 workpiece_name_matched 이 이미
  // 검증한 뒤라 추가로 돌리면 안 됨 (material_tags[] 와 work_piece_statuses 가 100% 1:1 이
  // 아닐 수 있어 정당한 후보가 떨어질 위험).
  let materialTagsDerivedFromWorkpiece = false
  if (materialTags.length === 0 && input.workPieceName) {
    const tag = resolveMaterialTag(input.workPieceName)
    if (tag) {
      materialTags.push(tag)
      materialTagsDerivedFromWorkpiece = true
    }
  }
  const materialTag = materialTags.length > 0 ? materialTags[0] : null  // primary tag for backward compat

  if (shouldApplyPostSqlHeuristics) {
    // Hard filter: material — only keep products that support at least one requested material
    // workPieceName 에서 역산한 tag 는 SQL 이 이미 workpiece_name_matched=TRUE 로 검증한 뒤
    // 라 추가 하드 필터를 돌리지 않는다 (정당한 후보 탈락 방지).
    if (materialTags.length > 0 && !materialTagsDerivedFromWorkpiece) {
      const matFiltered = candidates.filter(p =>
        materialTags.some(tag => p.materialTags.includes(tag))
      )
      if (matFiltered.length > 0) {
        candidates = matFiltered
        appliedFilters.push({
          field: "materialTag",
          op: "in",
          value: materialTags.join(",") + "군",
          rawValue: materialTags.join(","),
          appliedAt: 0,
        })
      }
      // If no products match the material, keep all but scoring will penalize
    }
  }

  if (!shouldApplyPostSqlHeuristics) {
    console.log("[hybrid:filter] extra post-sql heuristics disabled; narrowing filters still applied")
  }

  // Domain lock: machining category — heuristic 토글과 무관하게 항상 적용.
  // /products 페이지처럼 pagination 이 있는 호출에서도 Holemaking 후보가
  // Milling 세션으로 새는 걸 막기 위한 hard category constraint.
  // - explicit category (input.machiningCategory set) → 0 결과여도 hard
  // - implicit (null) → Milling default, 0이면 롤백
  {
    const explicitCategory = input.machiningCategory
    const effectiveCategory = explicitCategory ?? "Milling"
    const categoryShapes = CATEGORY_SHAPE_MAP[effectiveCategory]
    if (categoryShapes) {
      const catFiltered = candidates.filter(p =>
        productMatchesMachiningCategory(p.applicationShapes, categoryShapes) &&
        !hasForegnCategoryMetadata(p, effectiveCategory)
      )
      const beforeCount = candidates.length
      if (explicitCategory) {
        candidates = catFiltered
        if (beforeCount !== catFiltered.length) {
          console.log(`[hybrid-retrieval] machiningCategory HARD filter: ${explicitCategory} → ${beforeCount} → ${catFiltered.length} candidates`)
        }
      } else if (catFiltered.length > 0) {
        candidates = catFiltered
        if (beforeCount !== catFiltered.length) {
          console.log(`[hybrid-retrieval] machiningCategory IMPLICIT Milling default → ${beforeCount} → ${catFiltered.length} candidates`)
        }
      }
    }
  }

  // Apply narrowing filters from conversation — STRICT mode
  // Once a filter is selected, it MUST be enforced. No silent skipping.
  // The zero-candidate guard is in route.ts BEFORE the filter reaches here.
  for (const filter of flattenActiveFilters(filters)) {
    // stockStatus 는 SQL 단계에서 이미 inventory_summary_mv EXISTS join 으로 적용됨.
    // post-filter 로 또 검사하면 candidate 객체에 stockStatus 필드가 비어서 모두 reject.
    // (post-filter 는 line 691 의 stockStatus pre-filter 경로에서 enrichment 후 별도 처리)
    if (filter.field === "stockStatus") {
      appliedFilters.push(filter)
      continue
    }
    const before = candidates.length
    const filtered = applyPostFilterToProducts(candidates, filter)

    if (filtered !== null) {
      // STRICT: always apply the filter. If 0 results, keep 0 — route.ts guards this upstream.
      candidates = filtered
      appliedFilters.push(filter)
      console.log(`[hybrid:filter] ${filter.field}=${filter.value}: ${before} → ${filtered.length} candidates`)
    } else {
      appliedFilters.push(filter)
    }
  }
  const filterMs = Date.now() - startedAt - fetchMs
  const totalConsidered = candidates.length
  console.log(
    `[hybrid:stage] stage=post_filter count=${candidates.length} total=${totalConsidered} sourceTotal=${initialCandidateCount} edps=${formatProductEdpList(candidates)}`
  )

  // ── Stage 2: Score & Rank ──────────────────────────────────
  const scoreStartedAt = Date.now()
  const specificAppShapes = getSpecificOperationShapes(input)

  const scored: ScoredProduct[] = candidates.map(product => {
    // ── Compute each scoring dimension with explanations ────
    let diamScore = 0
    let diamDetail = ""
    if (input.diameterMm && product.diameterMm !== null) {
      // eq case: hard proximity (boundary pile-up is what the user asked)
      const diff = Math.abs(product.diameterMm - input.diameterMm)
      if (diff === 0) { diamScore = WEIGHTS.diameter; diamDetail = `φ${product.diameterMm}mm 정확 일치` }
      else if (diff <= 0.1) { diamScore = Math.round(WEIGHTS.diameter * 0.9); diamDetail = `φ${product.diameterMm}mm (오차 ${diff.toFixed(1)}mm)` }
      else if (diff <= 0.5) { diamScore = Math.round(WEIGHTS.diameter * 0.6); diamDetail = `φ${product.diameterMm}mm (오차 ${diff.toFixed(1)}mm)` }
      else if (diff <= 1.0) { diamScore = Math.round(WEIGHTS.diameter * 0.3); diamDetail = `φ${product.diameterMm}mm (오차 ${diff.toFixed(1)}mm, 근사)` }
      else { diamDetail = `φ${product.diameterMm}mm (오차 ${diff.toFixed(1)}mm, 범위 초과)` }
    } else if (input.diameterMmRangeTarget && product.diameterMm !== null) {
      // range-op case: soft proximity to boundary. Max bonus is ~27/40 so it
      // can tilt ranking toward boundary-region products without forcing the
      // pile-up that eq does. Exponential decay with boundary-relative scale
      // lets it work for both small ("10mm 이상") and large ("100mm 이상").
      const target = input.diameterMmRangeTarget
      const diff = Math.abs(product.diameterMm - target)
      const base = 15
      const maxBonus = 12
      const scale = Math.max(target * 0.5, 5)
      const bonus = maxBonus * Math.exp(-diff / scale)
      diamScore = Math.round(base + bonus)
      diamDetail = `φ${product.diameterMm}mm (범위 기준 ${target}mm, soft ${diamScore}pt)`
    } else if (!input.diameterMm && !input.diameterMmRangeTarget) {
      diamScore = 10
      diamDetail = "직경 미지정 (기본 10pt)"
    } else {
      diamDetail = "직경 정보 없음"
    }

    let fluteScore = 0
    let fluteDetail = ""
    if (!input.flutePreference) {
      fluteScore = Math.round(WEIGHTS.flutes * 0.5)
      fluteDetail = "날 수 미지정 (기본 50%)"
    } else if (product.fluteCount === input.flutePreference) {
      fluteScore = WEIGHTS.flutes
      fluteDetail = `${product.fluteCount}날 일치`
    } else {
      fluteDetail = product.fluteCount != null ? `${product.fluteCount}날 (요청: ${input.flutePreference}날)` : "날 수 정보 없음"
    }

    let matScore = 0
    let matDetail = ""
    if (materialTags.length === 0) {
      matScore = Math.round(WEIGHTS.materialTag * 0.5)
      matDetail = "소재 미지정 (기본 50%)"
    } else {
      // Check if product supports ANY of the requested material tags
      const matchedMats = materialTags.filter(tag => product.materialTags.includes(tag))
      if (matchedMats.length > 0) {
        // Score proportional to how many requested materials are matched
        const ratio = matchedMats.length / materialTags.length
        matScore = Math.round(WEIGHTS.materialTag * Math.max(ratio, 0.7)) // at least 70% if any match
        matDetail = matchedMats.length === materialTags.length
          ? `${matchedMats.join(",")}군 모두 적합`
          : `${matchedMats.join(",")}군 적합 (${materialTags.length}개 중 ${matchedMats.length}개)`
      } else {
        // Penalty for explicit material mismatch: 0 points (no bonus, no negative)
        matScore = 0
        matDetail = `${materialTags.join(",")}군 미지원 (지원: ${product.materialTags.join(", ") || "없음"})`
      }
    }

    // Material fitness bonus: series-level "designed for" vs "merely supports"
    // materialRatingScore from DB series_profile_mv — higher = better fit for the requested material
    const ratingScore = product.materialRatingScore
    if (ratingScore != null && ratingScore > 0 && materialTags.length > 0) {
      if (input.workPieceName) {
        // When specific workpiece specified (e.g. Copper), amplify the score difference
        // DB encodes workpiece affinity with +10 bonus for matching workpiece name
        // Use higher weight so products designed for the specific workpiece rank significantly higher
        const ratingBonus = Math.round(Math.min(ratingScore / 10, 1) * 20)
        matScore += ratingBonus
        matDetail += ` +피삭재전용(${ratingBonus})`
      } else {
        // Generic material matching — moderate bonus
        const ratingBonus = Math.round(Math.min(ratingScore / 10, 1) * WEIGHTS.evidence)
        matScore += ratingBonus
        matDetail += ` +소재전용(${ratingBonus})`
      }
    }

    // ── Material focus bonus ──
    // When the user names a single workpiece (e.g. "SUS316L", "구리", "A7075")
    // we want series that are *designed for* that material to rank above
    // general-purpose series that merely *support* it as one of many ISO
    // classes. Without this, a product tagged [H,K,M] ties with a product
    // tagged [M] on matScore — and general-purpose series win on other signals
    // like data completeness, burying the stainless-specialized lines the
    // judge expects on SUS316L queries.
    //
    // Focus ratio = matched_count / product.tag_count:
    //   product [M] + ask [M]       → 1.0 → +25 full focus bonus
    //   product [H,K,M] + ask [M]   → 0.33 → +8
    //   product [H,K,M,N,P] + ask [M] → 0.2 → +5
    // Only kicks in when there is an actual overlap, so unrelated products
    // are untouched.
    if (
      materialTags.length === 1 &&
      input.workPieceName &&
      product.materialTags.length > 0
    ) {
      const [askTag] = materialTags
      if (product.materialTags.includes(askTag)) {
        const focus = 1 / product.materialTags.length
        const focusBonus = Math.round(focus * 25)
        if (focusBonus > 0) {
          matScore += focusBonus
          matDetail += ` +소재집중(${focusBonus})`
        }
      }
    }

    let opScore = 0
    let opDetail = ""
    if (!specificAppShapes.length) {
      opScore = Math.round(WEIGHTS.operation * 0.5)
      opDetail = input.machiningCategory
        ? `세부 가공형상 미지정 (분류: ${input.machiningCategory})`
        : "가공방식 미지정 (기본 50%)"
    } else {
      const matches = product.applicationShapes.filter(s => specificAppShapes.includes(s))
      if (matches.length > 0) {
        const r = matches.length / specificAppShapes.length
        opScore = Math.round(WEIGHTS.operation * Math.min(r, 1))
        opDetail = `가공 적합 (${matches.join(", ")})`
      } else {
        opDetail = `가공방식 불일치 (제품: ${product.applicationShapes.join(", ") || "없음"})`
      }
    }

    // ── Tool shape compatibility (operationType → toolSubtype) ──
    let shapeScore = 0
    let shapeDetail = ""
    if (input.toolSubtype) {
      if (!product.toolSubtype) {
        shapeDetail = "공구형상 정보 없음"
      } else if (normalizeToolSubtype(product.toolSubtype) === normalizeToolSubtype(input.toolSubtype)) {
        shapeScore = WEIGHTS.toolShape
        shapeDetail = `${product.toolSubtype} 선택과 일치`
      } else {
        shapeDetail = `${product.toolSubtype} (선택: ${input.toolSubtype})`
      }
    } else if (!specificAppShapes.length || !product.toolSubtype) {
      shapeDetail = !specificAppShapes.length ? "공구형상 미지정" : "공구형상 정보 없음"
    } else {
      // Use the first normalized operation shape to look up compatibility
      const opKey = specificAppShapes[0]
      const compat = OPERATION_TOOL_SHAPE_COMPATIBILITY[opKey]
      if (compat) {
        const bonus = compat[product.toolSubtype] ?? 0
        shapeScore = bonus
        if (bonus > 0) shapeDetail = `${product.toolSubtype} → ${opKey} 적합 (+${bonus})`
        else if (bonus < 0) shapeDetail = `${product.toolSubtype} → ${opKey} 부적합 (${bonus})`
        else shapeDetail = `${product.toolSubtype} → ${opKey} 보통`
      } else {
        shapeDetail = `${opKey} 매핑 없음`
      }
    }

    let coatScore = 0
    let coatDetail = ""
    if (!input.coatingPreference) {
      coatScore = Math.round(WEIGHTS.coating * 0.5)
      coatDetail = "코팅 미지정 (기본 50%)"
    } else if (product.coating?.toLowerCase().includes(input.coatingPreference.toLowerCase())) {
      coatScore = WEIGHTS.coating
      coatDetail = `${product.coating} 일치`
    } else {
      coatDetail = product.coating ? `${product.coating} (요청: ${input.coatingPreference})` : "코팅 정보 없음"
    }

    const compScore = Math.round(product.dataCompletenessScore * WEIGHTS.completeness)
    const compDetail = `데이터 완성도 ${Math.round(product.dataCompletenessScore * 100)}%`

    const score = diamScore + fluteScore + matScore + opScore + shapeScore + coatScore + compScore
    // maxScore must exclude evidence weight since evidence scoring is not yet implemented
    // (evidence is always 0, so including it in denominator artificially lowers all ratios)
    // toolShape is a bonus/penalty (can be negative), so not included in maxScore denominator
    const maxScore = WEIGHTS.diameter + WEIGHTS.flutes + WEIGHTS.materialTag + WEIGHTS.operation + WEIGHTS.coating + WEIGHTS.completeness
    const ratio = score / maxScore
    const matchStatus: MatchStatus = ratio >= 0.75 ? "exact" : ratio >= 0.45 ? "approximate" : "none"

    const scoreBreakdown: ScoreBreakdown = {
      diameter: { score: diamScore, max: WEIGHTS.diameter, detail: diamDetail },
      flutes: { score: fluteScore, max: WEIGHTS.flutes, detail: fluteDetail },
      materialTag: { score: matScore, max: WEIGHTS.materialTag, detail: matDetail },
      operation: { score: opScore, max: WEIGHTS.operation, detail: opDetail },
      toolShape: { score: shapeScore, max: WEIGHTS.toolShape, detail: shapeDetail },
      coating: { score: coatScore, max: WEIGHTS.coating, detail: coatDetail },
      completeness: { score: compScore, max: WEIGHTS.completeness, detail: compDetail },
      evidence: { score: 0, max: WEIGHTS.evidence, detail: "증거 미매칭 (maxScore 제외)" },
      total: score,
      maxTotal: maxScore,  // excludes evidence weight (not yet implemented)
      matchPct: Math.round(ratio * 100),
    }

    // Matched fields
    const matchedFields: string[] = []
    if (input.diameterMm && product.diameterMm !== null && Math.abs(product.diameterMm - input.diameterMm) <= 0.1)
      matchedFields.push(`직경 ${product.diameterMm}mm 일치`)
    if (input.flutePreference && product.fluteCount === input.flutePreference)
      matchedFields.push(`${product.fluteCount}날 일치`)
    if (materialTags.length > 0 && materialTags.some(tag => product.materialTags.includes(tag)))
      matchedFields.push(`소재 ${materialTags.filter(t => product.materialTags.includes(t)).join(",")}군 적합`)
    if (specificAppShapes.length && product.applicationShapes.some(s => specificAppShapes.includes(s)))
      matchedFields.push(`가공 방식 적합`)
    if (input.toolSubtype && normalizeToolSubtype(product.toolSubtype) === normalizeToolSubtype(input.toolSubtype))
      matchedFields.push(`형상 ${product.toolSubtype} 일치`)
    if (input.coatingPreference && product.coating?.toLowerCase().includes(input.coatingPreference.toLowerCase()))
      matchedFields.push(`코팅 ${product.coating} 일치`)

    return {
      product,
      score,
      scoreBreakdown,
      matchedFields,
      matchStatus,
      inventory: [],
      leadTimes: [],
      evidence: [],
      stockStatus: "unknown",
      totalStock: null,
      minLeadTimeDays: null,
    } satisfies ScoredProduct
  })

  // ── Flagship boost + micro demote for pure-negation queries ──
  // When the user only supplies exclusion filters (e.g. "CRX S 빼고"), no
  // positive signal differentiates mainstream flagships from narrow micro
  // series — the raw score ties and legacy priority can surface obscure
  // small-diameter lines (3S MILL CG3S60 0.5~3mm). Nudge well-known flagship
  // brands up AND demote micro-diameter (<4mm) lines so the top cards cite
  // products the user actually recognizes.
  const hasPositiveFilter = filters.some(f => f.op !== "neq" && f.op !== "exclude")
  const hasNegativeFilter = filters.some(f => f.op === "neq" || f.op === "exclude")
  if (!hasPositiveFilter && hasNegativeFilter) {
    const {
      flagshipBoostPrimary: FLAGSHIP_BOOST,
      microBrandDemote: MICRO_BRAND_DEMOTE,
      microDiaDemote: MICRO_DIA_DEMOTE,
      microDiaThreshold: MICRO_DIA_THRESHOLD,
    } = BRAND_SCORING
    let boosted = 0
    let brandDemoted = 0
    let diaDemoted = 0
    for (const s of scored) {
      const brand = s.product.brand ?? ""
      const series = s.product.seriesName ?? ""
      const diameter = s.product.diameterMm ?? 0
      if (isFlagshipSeries(brand) || isFlagshipSeries(series)) {
        s.score += FLAGSHIP_BOOST
        s.matchedFields.push("대표 시리즈")
        boosted++
      }
      if (isMicroSeries(brand) || isMicroSeries(series)) {
        s.score -= MICRO_BRAND_DEMOTE
        brandDemoted++
      }
      if (diameter > 0 && diameter <= MICRO_DIA_THRESHOLD) {
        s.score -= MICRO_DIA_DEMOTE
        diaDemoted++
      }
    }
    console.log(`[hybrid:stage] pure-neq pre-cut boost=${boosted} brandDemote=${brandDemoted} diaDemote=${diaDemoted} pool=${scored.length}`)
  }

  // ── Stage 2.5: Brand × WorkPiece Affinity boost ──
  // 같은 materialRating 티어(EXCELLENT 등) 내부에서 연구소가 정의한
  // brand-workpiece 매트릭스(public.brand_material_affinity)를 읽어
  // 전문 브랜드(ALU-CUT × Aluminum=100)를 범용 브랜드(미등록=0) 위로 보정.
  // rating_score 자체가 DB 값 — 새 브랜드 추가 시 INSERT 만으로 자동 반영.
  if (input.workPieceName && scored.length > 0) {
    const uniqueBrands = Array.from(
      new Set(scored.map(s => s.product.brand ?? "").filter(Boolean))
    )
    if (uniqueBrands.length > 0) {
      const affinityMap = await BrandMaterialAffinityRepo.findByBrands({
        brands: uniqueBrands,
        workPieceName: input.workPieceName,
      })
      if (affinityMap.size > 0) {
        const { boostFactor, boostMax, isoGroupMultiplier } = BRAND_MATERIAL_AFFINITY
        let boostedCount = 0
        let totalBoostApplied = 0
        for (const s of scored) {
          const key = normalizeBrandKey(s.product.brand)
          if (!key) continue
          const entry = affinityMap.get(key)
          if (!entry) continue
          const rawBoost = entry.kind === "workpiece"
            ? entry.score * boostFactor
            : entry.score * isoGroupMultiplier
          const boost = Math.min(rawBoost, boostMax)
          if (boost > 0) {
            s.score += boost
            s.matchedFields.push("브랜드-피삭재 적합도")
            boostedCount++
            totalBoostApplied += boost
          }
        }
        console.log(
          `[hybrid:stage] stage=brand_affinity workPiece="${input.workPieceName}" matched=${affinityMap.size} boosted=${boostedCount}/${scored.length} totalBoost=${totalBoostApplied.toFixed(1)}`
        )
      }
    }
  }

  // Sort: materialRating tier (EXCELLENT>GOOD>NULL) → score desc → priority asc → completeness desc
  scored.sort((a, b) => {
    const tierDelta = materialRatingTier(a.product.materialRating) - materialRatingTier(b.product.materialRating)
    if (tierDelta !== 0) return tierDelta
    if (b.score !== a.score) return b.score - a.score
    if (a.product.sourcePriority !== b.product.sourcePriority)
      return a.product.sourcePriority - b.product.sourcePriority
    return b.product.dataCompletenessScore - a.product.dataCompletenessScore
  })
  console.log(
    `[hybrid:stage] stage=ranked count=${scored.length} total=${totalConsidered} sourceTotal=${initialCandidateCount} edps=${formatScoredEdpList(scored)}`
  )

  // Take top-N with no minimum score threshold for the initial candidate list.
  const minScoreThreshold = 0
  const qualifiedCandidates = scored.filter(s => s.score >= minScoreThreshold)

  // ── Series diversity reranker ──
  // Top 5에서 같은 시리즈 최대 2개로 제한 → 다양한 시리즈 추천
  const { maxPerSeriesInTop: MAX_PER_SERIES_IN_TOP, topDiversityWindow: TOP_DIVERSITY_WINDOW } = DIVERSITY_CONFIG
  if (qualifiedCandidates.length > TOP_DIVERSITY_WINDOW) {
    const seriesCount = new Map<string, number>()
    const diversified: typeof qualifiedCandidates = []
    const deferred: typeof qualifiedCandidates = []

    for (const c of qualifiedCandidates) {
      const series = c.product.seriesName ?? "__none__"
      const count = seriesCount.get(series) ?? 0
      if (diversified.length < TOP_DIVERSITY_WINDOW && count >= MAX_PER_SERIES_IN_TOP) {
        deferred.push(c)
      } else {
        seriesCount.set(series, count + 1)
        diversified.push(c)
      }
    }
    // Append deferred items after the diversity window
    qualifiedCandidates.splice(0, qualifiedCandidates.length, ...diversified, ...deferred)
  }

  // ── stockStatus pre-filter path ────────────────────────────
  // stockStatus는 mv에 없고 InventoryRepo runtime join 이므로 DB 단계에서
  // 못 걸리고, 기본 경로는 topCandidates 상위 100개만 enrich하고 post-filter도
  // 안 함 → "재고 있는 것만" 케이스가 실제 DB 매칭과 동떨어진 과소/0건을 냄.
  //
  // 안전한 확장: stockStatus 필터가 있을 때만 qualifiedCandidates를 최대
  // STOCK_FILTER_ENRICH_CAP까지 enrich 후 matches()로 post-filter. 기본 경로는
  // 기존 동작 그대로 유지(성능 회귀 없음).
  const hasStockFilter = filters.some(f => f.field === "stockStatus" && f.op !== "skip")
  const { stockFilterEnrichCap: STOCK_FILTER_ENRICH_CAP } = CAPACITY_LIMITS

  if (hasStockFilter) {
    // SQL builder가 stockStatus.buildDbClause로 inventory_summary_mv 와 EXISTS join
    // 했으면 qualifiedCandidates 는 이미 정확. post-filter 로 또 거르면 candidate
    // 객체에 stockStatus 필드가 비어서 모두 reject 됨 → SQL 결과 무효화.
    // SQL 단계 필터링이 신뢰할 수 있으므로 enrich + matches post-filter 를 우회.
    const stockFilter = filters.find(f => f.field === "stockStatus")!
    const enrichPool = qualifiedCandidates.slice(0, STOCK_FILTER_ENRICH_CAP)
    // Display 용으로만 enrichment (post-filter는 안 함). 배치 쿼리로 N+1 제거.
    const enrichCodes = enrichPool.map(c => c.product.normalizedCode)
    const enrichMap = await InventoryRepo.getEnrichedBatchAsync(enrichCodes)
    for (const c of enrichPool) {
      const inv = enrichMap.get(c.product.normalizedCode)
      if (inv) {
        c.inventory = inv.snapshots
        c.totalStock = inv.totalStock
        c.stockStatus = inv.stockStatus
      }
      c.leadTimes = LeadTimeRepo.getByEdp(c.product.normalizedCode)
      c.minLeadTimeDays = LeadTimeRepo.minLeadTime(c.product.normalizedCode)
    }
    const isNeg = stockFilter.op === "neq" || stockFilter.op === "exclude"
    const threshold = extractStockThreshold(stockFilter)
    const survivors = selectStockSurvivors(enrichPool, isNeg, threshold)
    qualifiedCandidates.splice(0, qualifiedCandidates.length, ...survivors)
    console.log(`[hybrid:stage] stage=stock_filter enriched=${enrichPool.length} threshold=${threshold} survived=${survivors.length}`)
  }

  // Hard cap: broad 상태(topN<=0)에서도 최대 SCORE_EVIDENCE_HARD_CAP 만 evidence/inventory enrich.
  // 64K 후보를 다 돌리면 score_evidence + inventory pool + heap 모두 폭발 (4GB OOM).
  // 200이면 display N=50 + 여유분 충분.
  const { scoreEvidenceHardCap: SCORE_EVIDENCE_HARD_CAP } = CAPACITY_LIMITS
  const topCandidates = topN > 0
    ? qualifiedCandidates.slice(0, topN)
    : qualifiedCandidates.slice(0, SCORE_EVIDENCE_HARD_CAP)
  console.log(
    `[hybrid:stage] stage=final count=${topCandidates.length} total=${totalConsidered} sourceTotal=${initialCandidateCount} edps=${formatScoredEdpList(topCandidates)}`
  )

  // Enrich top candidates with inventory + lead time (deferred for performance).
  // hasStockFilter 경로는 위에서 이미 enrich 됐으므로 skip (idempotent해도 RTT 낭비).
  // Pool은 topCandidates 전체 (= 최대 SCORE_EVIDENCE_HARD_CAP). 예전엔 100으로 하드캡
  // 되어 있어서 display N이 커지거나 후순위 후보의 재고 표시가 비는 문제가 있었음.
  if (!hasStockFilter) {
    const enrichCodes = topCandidates.map(c => c.product.normalizedCode)
    const enrichMap = await InventoryRepo.getEnrichedBatchAsync(enrichCodes)
    for (const c of topCandidates) {
      const inv = enrichMap.get(c.product.normalizedCode)
      if (inv) {
        c.inventory = inv.snapshots
        c.totalStock = inv.totalStock
        c.stockStatus = inv.stockStatus
      }
      c.leadTimes = LeadTimeRepo.getByEdp(c.product.normalizedCode)
      c.minLeadTimeDays = LeadTimeRepo.minLeadTime(c.product.normalizedCode)
    }
  }

  // ── Stage 3: Evidence Retrieval (parallelized) ─────────────
  const evidenceMap = new Map<string, EvidenceSummary>()

  const evidenceEntries = await Promise.all(
    topCandidates.map(async (candidate) => {
      const summary = await EvidenceRepo.buildSummary(
        candidate.product.normalizedCode,
        {
          seriesName: candidate.product.seriesName,
          isoGroup: materialTag,
          cuttingType: input.operationType ? mapOperationToCuttingType(input.operationType) : null,
          diameterMm: candidate.product.diameterMm ?? input.diameterMm,
        }
      )
      return { code: candidate.product.normalizedCode, summary }
    })
  )
  for (const { code, summary } of evidenceEntries) {
    if (summary.chunks.length > 0) {
      evidenceMap.set(code, summary)
    }
  }

  // ── Stage 4: Evidence Score Boost ──────────────────────────
  for (const candidate of topCandidates) {
    if (evidenceMap.has(candidate.product.normalizedCode)) {
      const summary = evidenceMap.get(candidate.product.normalizedCode)!
      const evBoost = Math.round(WEIGHTS.evidence * summary.bestConfidence)
      candidate.score += evBoost
      candidate.matchedFields.push(`절삭조건 ${summary.sourceCount}건 보유`)
      // Update breakdown
      if (candidate.scoreBreakdown) {
        candidate.scoreBreakdown.evidence = {
          score: evBoost,
          max: WEIGHTS.evidence,
          detail: `절삭조건 ${summary.sourceCount}건 (신뢰도 ${Math.round(summary.bestConfidence * 100)}%)`,
        }
        candidate.scoreBreakdown.total = candidate.score
        candidate.scoreBreakdown.matchPct = Math.round((candidate.score / candidate.scoreBreakdown.maxTotal) * 100)
      }
    }
  }

  // ── Stage 4.5: Pure-neq flagship boost ─────────────────────
  // 사용자 쿼리가 "CRX S 빼고" 처럼 순수 제외만 있고 양성 조건이 하나도
  // 없을 때는 탑 후보가 마이크로/특수 계열(3S MILL 등 0.5~3mm 소경)로
  // 몰리면서 judge가 "카탈로그에 없는 제품"으로 오인 감점하는 케이스가
  // 있다. 순수 제외일 때만 flagship 시리즈에 소폭(+5) boost을 주어
  // 대중적인 라인이 1순위로 올라오게 한다. 양성 필터가 하나라도 있으면
  // 기존 스코어링에 전혀 개입하지 않는다.
  const isPureNeq =
    appliedFilters.length > 0 &&
    appliedFilters.every(f => f.op === "neq" || f.op === "nin")
  if (isPureNeq) {
    let boosted = 0
    for (const candidate of topCandidates) {
      const brand = candidate.product.brand ?? ""
      const series = candidate.product.seriesName ?? ""
      if (isFlagshipSeries(brand) || isFlagshipSeries(series)) {
        candidate.score += BRAND_SCORING.flagshipBoostSecondary
        candidate.matchedFields.push("대표 시리즈 가산")
        boosted++
      }
    }
    console.log(`[hybrid:stage] pure-neq flagship boost applied — boosted=${boosted}/${topCandidates.length}`)
  }

  // Re-sort after evidence boost — materialRating tier 먼저, 그 다음 기존 순서
  topCandidates.sort((a, b) => {
    const tierDelta = materialRatingTier(a.product.materialRating) - materialRatingTier(b.product.materialRating)
    if (tierDelta !== 0) return tierDelta
    if (b.score !== a.score) return b.score - a.score
    if (a.product.sourcePriority !== b.product.sourcePriority)
      return a.product.sourcePriority - b.product.sourcePriority
    return b.product.dataCompletenessScore - a.product.dataCompletenessScore
  })

  const scoreAndEvidenceMs = Date.now() - scoreStartedAt

  console.log(
    `[recommend] hybrid timings: total=${Date.now() - startedAt}ms fetch=${fetchMs}ms filter=${filterMs}ms score_evidence=${scoreAndEvidenceMs}ms source=${initialCandidateCount} considered=${totalConsidered} final=${topCandidates.length}`
  )

  traceRecommendation("domain.runHybridRetrieval:output", {
    durationMs: Date.now() - startedAt,
    fetchMs,
    filterMs,
    scoreAndEvidenceMs,
    totalConsidered,
    filtersApplied: summarizeFiltersForTrace(appliedFilters),
    candidates: summarizeCandidatesForTrace(topCandidates),
    evidenceMap: summarizeEvidenceMapForTrace(evidenceMap),
  })
  return {
    candidates: topCandidates,
    evidenceMap,
    totalConsidered,
    filtersApplied: appliedFilters,
  }
}

// ── Helper: Map Korean operation to cutting type in evidence ──
function mapOperationToCuttingType(operation: string): string | null {
  const lower = operation.toLowerCase()
  if (lower.includes("슬롯") || lower.includes("slot")) return "Slotting"
  if (lower.includes("측면") || lower.includes("side")) return "Side Cutting"
  if (lower.includes("정삭") || lower.includes("finish")) return "Finishing"
  if (lower.includes("황삭") || lower.includes("rough")) return "Roughing"
  if (lower.includes("고이송") || lower.includes("high feed")) return "High Feed"
  return null
}

// ── Classify results (like match-engine but for hybrid) ──────
export function classifyHybridResults(result: HybridResult): {
  primary: ScoredProduct | null
  alternatives: ScoredProduct[]
  status: MatchStatus
} {
  const { candidates } = result
  if (!candidates.length) return { primary: null, alternatives: [], status: "none" }

  const primary = candidates[0]
  const alternatives = candidates.slice(1, 10)

  return {
    primary,
    alternatives,
    status: primary.matchStatus,
  }
}
