// Knowledge-based fallback retrieval source.
// Used ONLY when DB retrieval returns 0 candidates.
// Loaded once at first call (lazy), then served from memory.
//
// Background: Postgres `products` table is missing many real YG-1 series
// (SUPER ALLOY, TITANOX, X-POWER, E-FORCE, WIDE-CUT, CGM3S37 등).
// The slim catalog JSON at data/series-knowledge.json has 2134 series
// extracted from the official PDFs and is the source of truth for
// what YG-1 actually sells until the DB is reloaded.

import fs from "fs"
import path from "path"

import type { CanonicalProduct, RecommendationInput, ScoredProduct } from "@/lib/types/canonical"
import { TOOL_SUBTYPE_ALIASES, canonicalizeToolSubtype } from "@/lib/recommendation/shared/patterns"
import { getDbSchemaSync } from "@/lib/recommendation/core/sql-agent-schema-cache"

interface KnowledgeEntry {
  series?: string
  brand?: string
  product_name?: string
  tool_type?: string
  tool_subtype?: string
  flute_count?: string
  tool_material?: string
  coating?: string
  helix_angle?: string
  point_angle?: string
  coolant?: string
  shank_type?: string
  features?: string[]
  applications?: string[]
  target_materials?: string[]
  iso_groups?: string[]
  diameter_range?: string
  depth_ratio?: string
  source_catalog?: string
}

let cache: KnowledgeEntry[] | null = null

function loadOnce(): KnowledgeEntry[] {
  if (cache) return cache
  const filePath = path.join(process.cwd(), "data", "series-knowledge.json")
  try {
    const raw = fs.readFileSync(filePath, "utf8")
    const parsed = JSON.parse(raw) as unknown
    cache = Array.isArray(parsed) ? (parsed as KnowledgeEntry[]) : (Object.values(parsed as Record<string, KnowledgeEntry>))
    console.log(`[knowledge-fallback] loaded ${cache.length} series from ${filePath}`)
  } catch (err) {
    console.warn(`[knowledge-fallback] failed to load ${filePath}:`, (err as Error).message)
    cache = []
  }
  return cache
}

// Map natural-language material text → ISO turning groups (P/M/K/N/S/H).
function inferIsoGroups(text: string): Set<string> {
  const s = text.toLowerCase()
  const groups = new Set<string>()
  if (/super\s*alloy|inconel|hastelloy|nimonic|초내열|내열\s*합금|니켈|nickel|heat\s*resistant/.test(s)) groups.add("S")
  if (/titanium|티타늄|타이타늄/.test(s)) groups.add("S")
  if (/stainless|sus|스테인|sts/.test(s)) groups.add("M")
  if (/탄소강|carbon\s*steel|구조용강|alloy\s*steel|합금강|tool\s*steel|공구강/.test(s)) groups.add("P")
  if (/주철|cast\s*iron|gcd|fc/.test(s)) groups.add("K")
  if (/alumin|알루미|비철|non.?ferrous|구리|copper|brass|황동|마그네슘|magnesium/.test(s)) groups.add("N")
  if (/경화강|hardened|hrc/.test(s)) groups.add("H")
  return groups
}

interface SimpleFilter {
  field?: string
  value?: unknown
  op?: string
}

function getFilterValue(filters: readonly SimpleFilter[], field: string): string | null {
  for (const f of filters) {
    if (f.field === field && typeof f.value === "string" && f.value.trim()) return f.value.trim()
  }
  return null
}

function parseDiameterRange(range: string): { min: number; max: number } | null {
  if (!range) return null
  const m = range.match(/D?\s*([\d.]+)\s*[~\-–]\s*D?\s*([\d.]+)/)
  if (!m) return null
  const min = parseFloat(m[1])
  const max = parseFloat(m[2])
  if (Number.isNaN(min) || Number.isNaN(max)) return null
  return { min, max }
}

function entryMatches(
  entry: KnowledgeEntry,
  input: RecommendationInput,
  filters: readonly SimpleFilter[],
  isoGroups: Set<string>
): boolean {
  // 1) Material / ISO group match. If user specified a material, the entry
  //    must either share an ISO group or mention the material in target_materials.
  if (isoGroups.size > 0) {
    const entryIso = new Set((entry.iso_groups ?? []).map(g => g.toUpperCase()))
    const isoOverlap = [...isoGroups].some(g => entryIso.has(g))
    if (!isoOverlap) {
      const targets = (entry.target_materials ?? []).join(" ").toLowerCase()
      const materialText = (input.material ?? "") + " " + (input.workPieceName ?? "")
      const tokens = materialText.toLowerCase().split(/[\s,]+/).filter(t => t.length >= 3)
      const tokenHit = tokens.some(t => targets.includes(t))
      if (!tokenHit) return false
    }
  }

  // 2) Tool type (End Mill / Drill / Tap / Insert ...)
  const wantToolType = (input.toolType ?? getFilterValue(filters, "toolType") ?? "").toLowerCase().trim()
  if (wantToolType && entry.tool_type) {
    const et = entry.tool_type.toLowerCase()
    if (!et.includes(wantToolType) && !wantToolType.includes(et.split(/\s+/)[0])) return false
  }

  // 3) Tool subtype (Square / Ball / Roughing / Corner Radius ...)
  const wantSubtype = (input.toolSubtype ?? getFilterValue(filters, "toolSubtype") ?? "").toLowerCase().trim()
  if (wantSubtype && (entry.tool_subtype || entry.applications?.length)) {
    const subs = (entry.tool_subtype ?? "").toLowerCase()
    const apps = (entry.applications ?? []).join(" ").toLowerCase()
    // Delegate subtype alias resolution to patterns.TOOL_SUBTYPE_ALIASES (single source).
    // Collect every alias that canonicalizes to the same subtype as wantSubtype.
    const canonWant = canonicalizeToolSubtype(wantSubtype)?.toLowerCase() ?? null
    const variants = new Set<string>([wantSubtype])
    if (canonWant) {
      variants.add(canonWant)
      for (const [alias, canon] of Object.entries(TOOL_SUBTYPE_ALIASES)) {
        if (canon.toLowerCase() === canonWant) variants.add(alias.toLowerCase())
      }
    }
    const hit = Array.from(variants).some(v => subs.includes(v) || apps.includes(v))
    if (!hit) return false
  }

  // 4) Diameter inside the entry's published range
  const dia = input.diameterMm
  if (dia != null && entry.diameter_range) {
    const range = parseDiameterRange(entry.diameter_range)
    if (range && (dia < range.min || dia > range.max)) return false
  }

  // 5) Flute count
  const wantFlutes = input.flutePreference
  if (wantFlutes != null && entry.flute_count) {
    const ec = parseInt(entry.flute_count, 10)
    if (!Number.isNaN(ec) && ec !== wantFlutes) return false
  }

  return true
}

function entryToScoredProduct(entry: KnowledgeEntry, idx: number): ScoredProduct {
  const series = entry.series ?? `KB-${idx}`
  const fluteNum = parseInt(entry.flute_count ?? "", 10)
  const helixNum = parseFloat((entry.helix_angle ?? "").replace(/[^\d.]/g, ""))

  const product: CanonicalProduct = {
    id: `kb-${series}-${idx}`,
    manufacturer: "YG-1",
    brand: entry.brand ?? "YG-1",
    sourcePriority: 3,
    sourceType: "smart-catalog",
    rawSourceFile: "series-knowledge.json",
    rawSourceSheet: null,
    normalizedCode: series.toUpperCase().replace(/[\s\-./]+/g, ""),
    displayCode: series,
    seriesName: series,
    productName: entry.product_name ?? series,
    toolType: entry.tool_type ?? null,
    toolSubtype: entry.tool_subtype ?? null,
    diameterMm: null,
    diameterInch: null,
    fluteCount: Number.isFinite(fluteNum) ? fluteNum : null,
    coating: entry.coating ?? null,
    toolMaterial: entry.tool_material ?? null,
    shankDiameterMm: null,
    lengthOfCutMm: null,
    overallLengthMm: null,
    helixAngleDeg: Number.isFinite(helixNum) ? helixNum : null,
    ballRadiusMm: null,
    taperAngleDeg: null,
    coolantHole: null,
    applicationShapes: entry.applications ?? [],
    materialTags: entry.iso_groups ?? [],
    country: null,
    description: (entry.features ?? []).slice(0, 3).join(" / ") || null,
    featureText: (entry.features ?? []).join(" / ") || null,
    seriesIconUrl: null,
    materialRatingScore: null,
    workpieceMatched: undefined,
    sourceConfidence: "medium",
    dataCompletenessScore: 0.5,
    evidenceRefs: [],
  }

  return {
    product,
    score: 50,
    scoreBreakdown: null,
    matchedFields: ["knowledge-fallback"],
    matchStatus: "approximate",
    inventory: [],
    leadTimes: [],
    evidence: [],
    stockStatus: "unknown",
    totalStock: null,
    minLeadTimeDays: null,
  }
}

const MAX_FALLBACK_RESULTS = 30

// 더 구체적으로(좁게) 매칭되는 시리즈를 우선. 범용(ISO 6개 다 지원) 시리즈가
// 상위를 차지해 SUPER ALLOY 같은 전용 시리즈가 잘리는 걸 방지.
function rankEntry(entry: KnowledgeEntry, isoGroups: Set<string>, wantSubtype: string, wantBrand: string): number {
  let score = 0
  const entryIso = entry.iso_groups ?? []
  const isoSize = entryIso.length || 6
  // ISO 특이성: ISO=[S]만 가진 시리즈는 ISO=[P,M,K,N,S,H]보다 우선 (S 검색 시)
  if (isoGroups.size > 0 && entryIso.length > 0) {
    const overlap = entryIso.filter(g => isoGroups.has(g.toUpperCase())).length
    score += overlap * 20 - isoSize * 2
  }
  // Subtype/applications 정확 매칭 보너스
  if (wantSubtype) {
    const sub = (entry.tool_subtype ?? "").toLowerCase()
    const apps = (entry.applications ?? []).join(" ").toLowerCase()
    if (sub.includes(wantSubtype)) score += 15
    else if (apps.includes(wantSubtype)) score += 5
  }
  // 브랜드명에 사용자가 언급한 시리즈명이 들어있으면 큰 가산
  if (wantBrand) {
    const brand = (entry.brand ?? "").toLowerCase()
    const series = (entry.series ?? "").toLowerCase()
    if (brand.includes(wantBrand) || series.includes(wantBrand)) score += 50
  }
  return score
}

export function searchKnowledgeFallback(
  input: RecommendationInput,
  filters: readonly SimpleFilter[]
): ScoredProduct[] {
  const all = loadOnce()
  if (all.length === 0) return []

  const materialText = [
    input.material,
    input.workPieceName,
    input.queryText,
    ...filters.filter(f => f.field === "material" || f.field === "materialTag" || f.field === "workPieceName")
      .map(f => (typeof f.value === "string" ? f.value : "")),
  ].filter(Boolean).join(" ")
  const isoGroups = inferIsoGroups(materialText)
  const wantSubtype = (input.toolSubtype ?? getFilterValue(filters, "toolSubtype") ?? "").toLowerCase().trim()
  // 사용자 발화에서 시리즈/브랜드 키워드 추출 (SUPER ALLOY, V7 PLUS, X-POWER 등)
  const allText = [input.queryText, input.material, input.workPieceName, input.seriesName, input.brand]
    .filter(Boolean).join(" ").toLowerCase()
  // Brand hints come from the live DB schema cache (sql-agent-schema-cache.brands).
  // Falls back to the knowledge-entry brand column itself if the cache is cold.
  const dbBrands = getDbSchemaSync()?.brands ?? []
  const brandHints = dbBrands.length > 0
    ? dbBrands.map(b => b.toLowerCase())
    : Array.from(new Set(all.map(e => (e.brand ?? "").toLowerCase()).filter(Boolean)))
  const wantBrand = brandHints.find(b => b && allText.includes(b)) ?? ""

  const candidates: Array<{ entry: KnowledgeEntry; idx: number; rank: number }> = []
  for (let i = 0; i < all.length; i++) {
    const entry = all[i]
    if (entryMatches(entry, input, filters, isoGroups)) {
      candidates.push({ entry, idx: i, rank: rankEntry(entry, isoGroups, wantSubtype, wantBrand) })
    }
  }
  candidates.sort((a, b) => b.rank - a.rank)
  return candidates.slice(0, MAX_FALLBACK_RESULTS).map(c => entryToScoredProduct(c.entry, c.idx))
}
