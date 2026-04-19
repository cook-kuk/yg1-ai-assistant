/**
 * Client for the Python /products + /filter-options pipeline. Calls go to
 * same-origin Next.js proxies (/api/products, /api/products/stream,
 * /api/products/page, /api/filter-options), each of which forwards to the
 * FastAPI service. Keeping the proxy layer avoids CORS / reachability issues
 * when the browser can't hit the Python port directly (VM NSG, nginx, etc.).
 * Types mirror python-api/schemas.py — keep in sync when the Python side
 * changes.
 */

import type {
  RecommendationAppliedFilterDto,
  RecommendationCandidateDto,
  RecommendationPublicSessionDto,
  RecommendationResponseDto,
} from "@/lib/contracts/recommendation"
import { DEFAULT_RECOMMENDATION_CAPABILITIES } from "@/lib/frontend/recommendation/recommendation-view-model"

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
  // P0/P1 spec fields — added so the UI can render actual values instead
  // of "-" for shank dia / neck / effective length / corner or ball radius.
  edp_unit?: string | null       // "Metric" | "Inch" — drives inch→mm convert
  shank_dia?: string | null      // milling_shank_dia (may be "1/2" inch)
  ball_radius?: string | null    // milling_ball_radius (e.g. "R.125" inch)
  neck_diameter?: string | null
  effective_length?: string | null
  // Inventory summary forwarded from product_inventory_summary_mv.
  total_stock?: number | null
  warehouse_count?: number | null
  stock_status?: string | null   // "instock" | "limited" | "outofstock" | null
  // xAI narrative for the #1 card only.
  rationale?: string | null
  // Match-reason chips ("소재 N군 적합", "형상 Square 일치").
  matched_fields?: string[] | null
  // Brand × workpiece affinity tier. "EXCELLENT" | "GOOD" | "FAIR" | null.
  material_rating?: "EXCELLENT" | "GOOD" | "FAIR" | string | null
  cutting_conditions?: Array<Record<string, unknown>> | null
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
  stock_status?: string | null
  material_rating?: "EXCELLENT" | "GOOD" | "FAIR" | string | null
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
  // Python's SCORING_CONFIG max-per-axis dict. toScoreBreakdown() prefers
  // this over the hardcoded PY_WEIGHTS fallback so UI bars auto-track
  // weight changes without a frontend deploy.
  score_breakdown_max?: Record<string, number> | null
  // "조회한 상품" peek — populated when the user names a specific EDP/series
  // ("UGMG34919 보여줘") mid-session. These bypass the live filter state
  // so the UI can render them in a dedicated section without touching the
  // main ranked list.
  reference_products?: ProductCard[] | null
  reference_query?: string | null
}

export interface FilterOptionsResponse {
  field: string
  options: FilterOption[]
  total_with_current_filters: number
}

export interface ProductsPageResponse {
  products: ProductCard[]
  totalCount: number
  page: number
  pageSize: number
  totalPages: number
  session_id: string
  appliedFilters?: Record<string, unknown>
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

export async function fetchProductsPage(
  sessionId: string,
  page: number,
  pageSize: number,
): Promise<ProductsPageResponse> {
  const res = await fetch("/api/products/page", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ session_id: sessionId, page, pageSize }),
  })
  if (!res.ok) {
    const detail = await res.text().catch(() => "")
    throw new Error(`fetchProductsPage failed (${res.status}): ${detail || res.statusText}`)
  }
  return (await res.json()) as ProductsPageResponse
}

// ── Adapter: Python ProductsResponse → RecommendationResponseDto ─────
// Python has no thinking/evidence/explanation yet, so those slots are
// filled with null/empty so the existing UI doesn't break.

// Pull the first numeric token out of a free-form spec string. Handles:
//   - integers / decimals / negatives  ("43", "0.25", "-0.030")
//   - leading-dot decimals             ("R.125" → 0.125, critical fix)
//   - pure fractions                   ("1/2"  → 0.5)
//   - mixed fractions                  ("1-1/2" or "1 1/2" → 1.5)
//   - ranges/lists — takes the first   ("43;44;45" → 43)
// Returns null for empty/unparseable input. Unit stripping (°, mm, inch,
// quotes) is implicit because the regex is anchored to the first number, not
// the whole string.
function parseNumeric(raw: string | number | null | undefined): number | null {
  if (raw == null) return null
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null
  const s = String(raw).trim()
  if (!s) return null
  // Mixed fraction: "1-1/2", "1 1/2", "-1-1/2". Use explicit boundary so
  // "UGMG34" doesn't accidentally match.
  const mix = s.match(/^(-?\d+)[-\s](\d+)\/(\d+)/)
  if (mix) {
    const whole = Number(mix[1])
    const frac = Number(mix[2]) / Number(mix[3])
    return whole < 0 ? whole - frac : whole + frac
  }
  // Pure fraction anywhere in the string: "1/2", "R1/2".
  const frac = s.match(/(-?\d+)\/(\d+)/)
  if (frac) return Number(frac[1]) / Number(frac[2])
  // Regular number (including leading-dot decimals). The alternation is
  // ordered so "\d+(\.\d+)?" wins over ".\d+" when the digit is present.
  const m = s.match(/-?(?:\d+(?:\.\d+)?|\.\d+)/)
  return m ? Number(m[0]) : null
}

// Inch-aware wrapper. Rows with edp_unit === "Inch"/"INCH" store all
// dimensional values in inches, so the naive parse-then-render pipeline
// produces labels like "3mm" for what is really 3 inches. This multiplies
// the parsed value by 25.4 when the unit flag says inch.
const MM_PER_INCH = 25.4
function parseNumericMm(
  raw: string | number | null | undefined,
  unit: string | null | undefined,
): number | null {
  const n = parseNumeric(raw)
  if (n == null) return null
  if (typeof unit !== "string") return n
  const u = unit.trim().toLowerCase()
  return u === "inch" || u === "imperial" ? n * MM_PER_INCH : n
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

// Map a series name to the bundled series-icon file under public/images/series.
// The file names are raw series codes ("SGED28.jpg", "CRX S.jpg", "E-RDKT08 -
// Cylindrical.jpg") so we just encode the name and trust the fallback onError
// in the card component to swap in the placeholder when the .jpg is missing.
// Returns null for empty/whitespace series so the card goes straight to the
// placeholder without a doomed network request.
function deriveSeriesIconUrl(series: string | null | undefined): string | null {
  if (!series) return null
  const trimmed = String(series).trim()
  if (!trimmed) return null
  return `/images/series/${encodeURIComponent(trimmed)}.jpg`
}

// Python's scoring.py rank_candidates emits a flat { dimension: points } dict.
// The UI expects the legacy ScoreBreakdown shape — per-axis {score,max,detail}
// plus total/maxTotal/matchPct — so translate once here. Dimensions missing
// from the Python dict collapse to "미지정" rows so the bar chart renders
// with a consistent 8 axes.
// Fallback max values when Python doesn't ship score_breakdown_max.
// Mirrors scoring.SCORING_CONFIG at the time of writing; any drift is
// self-healing once the response starts including the max dict.
const PY_WEIGHTS_FALLBACK: Record<string, number> = {
  diameter: 40, flutes: 15, material: 20, shape: 15, coating: 5,
  operation: 15, affinity: 15, flagship: 10, material_pref: 5,
  stock: 3, hrc_match: 5, specialty: 20,
}
const _num = (x: unknown): number => (typeof x === "number" && Number.isFinite(x) ? x : 0)

function toScoreBreakdown(
  flat: Record<string, number> | null | undefined,
  cardScore: number,
  maxDict?: Record<string, number> | null,
): RecommendationCandidateDto["scoreBreakdown"] {
  if (!flat || typeof flat !== "object") return null
  const mx = (key: string, fallback: number): number => {
    if (maxDict && typeof maxDict[key] === "number" && maxDict[key] > 0) return maxDict[key]
    return PY_WEIGHTS_FALLBACK[key] ?? fallback
  }
  // Python's scoring.py redistributes missing-intent weight across the
  // remaining active dimensions, so an individual axis can exceed its
  // static weight ("diameter=67/40"). Cap each score to its weight so
  // the UI bar chart stays inside its max — the matchPct below still
  // reflects the true total via cardScore.
  const cap = (v: number, w: number) => Math.min(Math.round(v), w)
  const W = {
    diameter: mx("diameter", 40),
    flutes: mx("flutes", 15),
    material: mx("material", 20),
    shape: mx("shape", 15),
    coating: mx("coating", 5),
    operation: mx("operation", 15),
    affinity: mx("affinity", 15),
    flagship: mx("flagship", 10),
    materialPref: mx("material_pref", 5),
    stock: mx("stock", 3),
    hrc: mx("hrc_match", 5),
    specialty: mx("specialty", 20),
  }
  const d = cap(_num(flat.diameter), W.diameter)
  const f = cap(_num(flat.flutes), W.flutes)
  const m = cap(_num(flat.material), W.material)
  const s = cap(_num(flat.shape), W.shape)
  const c = cap(_num(flat.coating), W.coating)
  const op = cap(_num(flat.operation), W.operation)
  const affinity = _num(flat.affinity)
  const flagship = _num(flat.flagship)
  const materialPref = _num(flat.material_pref)
  const stock = _num(flat.stock)
  const hrc = _num(flat.hrc_match)
  const specialty = _num(flat.specialty)

  const bonusBits: string[] = []
  if (affinity) bonusBits.push(`affinity +${affinity.toFixed(1)}`)
  if (flagship) bonusBits.push(`flagship +${flagship.toFixed(1)}`)
  if (materialPref) bonusBits.push(`material-pref +${materialPref.toFixed(1)}`)
  if (stock) bonusBits.push(`stock +${stock.toFixed(1)}`)
  if (hrc) bonusBits.push(`HRC match +${hrc.toFixed(1)}`)
  if (specialty) bonusBits.push(`specialty +${specialty.toFixed(1)}`)
  const evidenceDetail = bonusBits.length > 0 ? bonusBits.join(" · ") : "증거 보조 미매칭"
  const evidenceScore = Math.round(affinity + hrc + materialPref + stock + specialty)
  // Evidence axis's max = sum of all bonus axes (affinity/flagship/...).
  const evidenceMax = W.affinity + W.flagship + W.materialPref + W.stock + W.hrc + W.specialty

  const total = Math.round(d + f + m + s + c + op + affinity + flagship + materialPref + stock + hrc + specialty)
  const maxTotal = W.diameter + W.flutes + W.material + W.shape + W.coating + W.operation + evidenceMax + 5
  // Card score is already 0–100 normalized on the Python side.
  const matchPct = Math.max(0, Math.min(100, Math.round(cardScore)))

  return {
    diameter: { score: Math.round(d), max: W.diameter, detail: `${d.toFixed(1)} / ${W.diameter}` },
    flutes: { score: Math.round(f), max: W.flutes, detail: `${f.toFixed(1)} / ${W.flutes}` },
    materialTag: { score: Math.round(m), max: W.material, detail: `${m.toFixed(1)} / ${W.material}` },
    operation: {
      score: Math.round(op),
      max: W.operation,
      detail: op > 0 ? `${op.toFixed(1)} / ${W.operation}` : "가공 방식 미지정",
    },
    toolShape: { score: Math.round(s), max: W.shape, detail: `${s.toFixed(1)} / ${W.shape}` },
    coating: { score: Math.round(c), max: W.coating, detail: `${c.toFixed(1)} / ${W.coating}` },
    completeness: { score: 5, max: 5, detail: "데이터 완성도 100%" },
    evidence: { score: evidenceScore, max: evidenceMax, detail: evidenceDetail },
    total,
    maxTotal,
    matchPct,
  }
}

function deriveMatchStatus(card: ProductCard): "exact" | "approximate" | "none" {
  // Cheap heuristic: if the card has a concrete diameter + flute count and
  // at least one matched-field chip, call it exact. Everything else drops
  // to approximate so the UI badge stays informative without over-promising.
  const hasDia = parseNumeric(card.diameter ?? null) !== null
  const hasFlutes = parseIntTok(card.flutes ?? null) !== null
  const hasMatch = Array.isArray(card.matched_fields) && card.matched_fields.length > 0
  if (hasDia && hasFlutes && hasMatch) return "exact"
  if (hasDia || hasFlutes || hasMatch) return "approximate"
  return "none"
}

// Known rating tiers — kept as a Set so adding a new value is one line.
// Anything outside the set is passed through verbatim (uppercased) so a
// future Python emit ("OUTSTANDING", a localized "탁월", …) renders as a
// neutral badge instead of disappearing into null.
const _KNOWN_RATING_TIERS = new Set([
  "EXCELLENT", "GOOD", "FAIR", "NULL",
])

function _coerceRating(
  v: unknown,
): "EXCELLENT" | "GOOD" | "FAIR" | "NULL" | (string & {}) | null {
  if (typeof v !== "string") return null
  const s = v.trim().toUpperCase()
  if (!s) return null
  if (_KNOWN_RATING_TIERS.has(s)) {
    return s as "EXCELLENT" | "GOOD" | "FAIR" | "NULL"
  }
  // Unknown but non-empty — return raw so the UI can render *something*.
  // Component-level fallback (recommendation-display.tsx, exploration-flow.tsx)
  // decides badge color/copy for unfamiliar tiers.
  return s
}

function adaptProductCard(
  card: ProductCard,
  rank: number,
  maxDict?: Record<string, number> | null,
): RecommendationCandidateDto {
  const totalStock = typeof card.total_stock === "number" && Number.isFinite(card.total_stock)
    ? card.total_stock : null
  const stockStatus = (card.stock_status ?? null) || (totalStock === null ? "unknown" : totalStock > 0 ? "instock" : "outofstock")
  const warehouseCount = typeof card.warehouse_count === "number" && card.warehouse_count > 0
    ? card.warehouse_count : null
  // Python's inventory_summary_mv gives {total_stock, warehouse_count} but no
  // per-warehouse breakdown; materialize a single location row so the UI's
  // "전체 지역 합산 재고" card has something to render.
  const inventoryLocations = totalStock !== null && totalStock > 0
    ? [{
        warehouseOrRegion: warehouseCount ? `GLC · ${warehouseCount}곳 합산` : "GLC 합산",
        quantity: totalStock,
      }]
    : []
  const bestCondition = Array.isArray(card.cutting_conditions) && card.cutting_conditions[0]
    ? (card.cutting_conditions[0] as unknown as RecommendationCandidateDto["bestCondition"])
    : null

  return {
    rank,
    productCode: card.edp_no,
    displayCode: card.edp_no,
    displayLabel: null,
    brand: card.brand ?? null,
    seriesName: card.series ?? null,
    seriesIconUrl: deriveSeriesIconUrl(card.series ?? null),
    // Convert inch rows to mm so "UGMG34919 · 1/2" shows as 12.7mm, not 1mm.
    // Helix angle is a pure angle so no unit conversion needed.
    diameterMm: parseNumericMm(card.diameter ?? null, card.edp_unit),
    fluteCount: parseIntTok(card.flutes ?? null),
    coating: card.coating ?? null,
    toolSubtype: card.subtype ?? null,
    toolMaterial: null,
    shankDiameterMm: parseNumericMm(card.shank_dia ?? null, card.edp_unit),
    shankType: card.shank_type ?? null,
    lengthOfCutMm: parseNumericMm(card.loc ?? null, card.edp_unit),
    overallLengthMm: parseNumericMm(card.oal ?? null, card.edp_unit),
    helixAngleDeg: parseNumeric(card.helix_angle ?? null),
    coolantHole: parseCoolantHole(card.coolant_hole ?? null),
    ballRadiusMm: parseNumericMm(card.ball_radius ?? null, card.edp_unit),
    taperAngleDeg: null,
    pointAngleDeg: null,
    threadPitchMm: null,
    // Full detail set — CandidateCard's expanded view renders these as rows
    // in its SpecTable. Populated via parseNumericMm so inch rows convert.
    neckDiameterMm: parseNumericMm(card.neck_diameter ?? null, card.edp_unit),
    neckLengthMm: null,
    effectiveLengthMm: parseNumericMm(card.effective_length ?? null, card.edp_unit),
    cornerRadiusMm: parseNumericMm(card.ball_radius ?? null, card.edp_unit),
    diameterTolerance: null,
    edpUnit: card.edp_unit ?? null,
    description: card.description ?? null,
    featureText: card.feature ?? null,
    materialTags: Array.isArray(card.material_tags)
      ? card.material_tags.filter((t): t is string => typeof t === "string")
      : [],
    materialRating: _coerceRating(card.material_rating),
    score: typeof card.score === "number" && Number.isFinite(card.score) ? card.score : 0,
    scoreBreakdown: toScoreBreakdown(
      card.score_breakdown ?? null,
      typeof card.score === "number" ? card.score : 0,
      maxDict,
    ),
    matchStatus: deriveMatchStatus(card),
    stockStatus,
    totalStock,
    inventorySnapshotDate: null,
    inventoryLocations,
    hasEvidence: Array.isArray(card.cutting_conditions) && card.cutting_conditions.length > 0,
    bestCondition,
    xaiNarrative: card.rationale ?? null,
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
    seriesIconUrl: deriveSeriesIconUrl(row.series ?? null),
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
    materialRating: _coerceRating(row.material_rating),
    score: typeof row.score === "number" && Number.isFinite(row.score) ? row.score : 0,
    scoreBreakdown: null,
    matchStatus: "approximate",
    stockStatus: row.stock_status ?? "unknown",
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

function buildSeriesGroups(
  candidates: RecommendationCandidateDto[],
  topN = 8,
): RecommendationPublicSessionDto["displayedSeriesGroups"] {
  // Bucket candidates by seriesName, tracking the count and best score per
  // series so the UI can render the "SGED31 · 최고 131점" summary badges.
  // Sorted by topScore desc so the highest-ranking series leads.
  const groups = new Map<string, { count: number; topScore: number; brand: string | null }>()
  for (const c of candidates) {
    const key = c.seriesName
    if (!key) continue
    const prev = groups.get(key)
    if (prev) {
      prev.count += 1
      if (c.score > prev.topScore) prev.topScore = c.score
    } else {
      groups.set(key, { count: 1, topScore: c.score, brand: c.brand })
    }
  }
  const sorted = [...groups.entries()]
    .sort((a, b) => b[1].topScore - a[1].topScore)
    .slice(0, topN)
  return sorted.map(([seriesName, g]) => ({
    seriesKey: seriesName,
    seriesName,
    candidateCount: g.count,
    // Python path doesn't emit series_material_rating per candidate yet, so
    // leave rating slots null — the UI badge degrades to showing just count.
    materialRating: null,
    materialRatingScore: null,
  }))
}

function buildMinimalSession(
  appliedFilters: RecommendationAppliedFilterDto[],
  totalCount: number,
  candidates: RecommendationCandidateDto[] = [],
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
    displayedSeriesGroups: buildSeriesGroups(candidates),
    capabilities: DEFAULT_RECOMMENDATION_CAPABILITIES,
  }
}

const DETAIL_LIMIT = 10

// Candidate-panel page size — SSOT for both the hook (initial + follow-up
// requests) and the adapter (fallback when callers don't pass their own).
// Flip here and both consumers follow.
export const DEFAULT_PAGE_SIZE = 20

export function adaptProductsToRecommendationDto(
  payload: ProductsResponse,
  opts: { pageSize?: number } = {},
): RecommendationResponseDto {
  const pageSize = opts.pageSize ?? DEFAULT_PAGE_SIZE

  const maxDict = (payload.score_breakdown_max ?? null) as Record<string, number> | null
  const detailed = (payload.products ?? []).slice(0, DETAIL_LIMIT).map((c, i) => adaptProductCard(c, i + 1, maxDict))
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

  // "조회한 상품" peek — bypasses the main filter state. Rendered as a
  // separate section below `candidates` so the live filter session stays
  // visually intact.
  const referenceCandidates = Array.isArray(payload.reference_products) && payload.reference_products.length > 0
    ? payload.reference_products.map((c, i) => adaptProductCard(c, i + 1, maxDict))
    : null
  const referenceQuery = typeof payload.reference_query === "string" && payload.reference_query.length > 0
    ? payload.reference_query
    : null

  return {
    text: payload.text ?? "",
    purpose: "recommendation",
    chips: Array.isArray(payload.chips) ? payload.chips : [],
    isComplete: payload.isComplete !== false,
    recommendation: null,
    session: {
      publicState: buildMinimalSession(appliedFilters, totalItems, candidates),
      engineState: null,
    },
    candidates: candidates.length > 0 ? candidates : null,
    referenceCandidates,
    referenceQuery,
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

// ── Page adapter ─────────────────────────────────────────────────────
// Candidate-panel pagination: every row gets full ProductCard detail, so
// the panel can render series icons / descriptions / material ratings for
// page 2+ without a second round-trip.
export function adaptProductsPage(payload: ProductsPageResponse): {
  candidates: RecommendationCandidateDto[]
  pagination: {
    page: number
    pageSize: number
    totalItems: number
    totalPages: number
  }
  appliedFilters: RecommendationAppliedFilterDto[]
} {
  const base = payload.page * payload.pageSize
  const candidates = (payload.products ?? []).map((c, i) => adaptProductCard(c, base + i + 1))
  return {
    candidates,
    pagination: {
      page: payload.page,
      pageSize: payload.pageSize,
      totalItems: payload.totalCount,
      totalPages: payload.totalPages,
    },
    appliedFilters: adaptAppliedFilters(payload.appliedFilters),
  }
}
