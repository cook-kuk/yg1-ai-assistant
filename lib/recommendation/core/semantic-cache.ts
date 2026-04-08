/**
 * Semantic Cache — 의미적으로 동일한 쿼리의 LLM 결과 재사용.
 *
 * 전략: 한국어 형태소 간이 분리 + 영어 lowercase + 동의어 정규화 후
 * Jaccard similarity. 외부 임베딩 API 불필요. 0 latency.
 *
 * 캐시 컨텍스트: 같은 메시지라도 현재 적용된 필터가 다르면 결과가 달라짐
 * → (query, filters) 쌍 기준으로 hit/miss 결정.
 *
 * TTL 30분, LRU 최대 500항목.
 */

import type { AppliedFilter } from "@/lib/recommendation/domain/types"

// ── Types ────────────────────────────────────────────────────

export interface CachedAction {
  type: string
  field?: string
  value?: unknown
  value2?: unknown
  op?: string
  from?: unknown
  to?: unknown
  targets?: string[]
  message?: string
}

export interface CachedResult {
  source: "scr" | "sql-agent" | "det-scr"
  actions: CachedAction[]
  reasoning?: string
  answer?: string
}

interface CacheEntry {
  query: string
  tokens: Set<string>
  filterKey: string
  result: CachedResult
  createdAt: number
  hitCount: number
}

// ── Constants ────────────────────────────────────────────────

const CACHE_MAX_SIZE = 500
const CACHE_TTL_MS = 30 * 60 * 1000 // 30 min
const SIMILARITY_THRESHOLD = 0.75

// ── Synonym map ──────────────────────────────────────────────
// 같은 의미의 한국어/영어/약어를 단일 정규형으로 합친다.
// 새 토큰이 필요하면 여기 한 줄만 추가하면 됨.
const SYNONYM_MAP: Record<string, string> = {
  // workpiece
  스테인리스: "stainless", 스텐: "stainless", sus: "stainless", sus304: "stainless",
  sus316: "stainless", sts304: "stainless", stainless: "stainless",
  티타늄: "titanium", ti6al4v: "titanium", ti: "titanium", titanium: "titanium",
  알루미늄: "aluminum", 알미늄: "aluminum", al: "aluminum", a6061: "aluminum",
  a7075: "aluminum", aluminum: "aluminum", aluminium: "aluminum",
  주철: "castiron", fc: "castiron", fcd: "castiron", castiron: "castiron",
  탄소강: "carbonsteel", sm45c: "carbonsteel", s45c: "carbonsteel", carbonsteel: "carbonsteel",
  고경도강: "hardened", skd11: "hardened", skd61: "hardened", hrc: "hardened", hardened: "hardened",
  인코넬: "inconel", 하스텔로이: "inconel", 내열합금: "inconel", inconel: "inconel",
  구리: "copper", 동: "copper", 황동: "copper", brass: "copper", copper: "copper",
  합금강: "alloysteel", scm440: "alloysteel", alloysteel: "alloysteel",
  복합재: "composite", cfrp: "composite", composite: "composite",
  흑연: "graphite", graphite: "graphite",

  // tool subtype
  스퀘어: "square", 평날: "square", 평엔드밀: "square", square: "square",
  볼: "ball", 볼엔드밀: "ball", 볼노즈: "ball", ball: "ball",
  라디우스: "radius", 레디우스: "radius", 코너r: "radius", radius: "radius",
  러핑: "roughing", 황삭: "roughing", roughing: "roughing",
  테이퍼: "taper", taper: "taper",
  챔퍼: "chamfer", 모따기: "chamfer", 면취: "chamfer", chamfer: "chamfer",
  하이피드: "highfeed", 고이송: "highfeed", highfeed: "highfeed", "high-feed": "highfeed",

  // coating
  tialn: "tialn", x코팅: "tialn", 엑스코팅: "tialn", "x-coating": "tialn",
  alcrn: "alcrn", y코팅: "alcrn", 와이코팅: "alcrn", "y-coating": "alcrn",
  dlc: "dlc",
  무코팅: "uncoated", 비코팅: "uncoated", uncoated: "uncoated", bright: "uncoated",

  // tool material
  초경: "carbide", 카바이드: "carbide", carbide: "carbide", 솔리드: "carbide",
  하이스: "hss", hss: "hss", 고속도강: "hss",

  // units / measures
  mm: "_mm", 밀리: "_mm", 미리: "_mm", 파이: "_mm", "ø": "_mm",
  날: "_flute", flute: "_flute", flutes: "_flute", f: "_flute",
  도: "_deg", deg: "_deg", degree: "_deg",

  // intent
  추천: "_recommend", 추천해줘: "_recommend", 골라줘: "_recommend",
  보여줘: "_recommend", 찾아줘: "_recommend",
  빼고: "_exclude", 제외: "_exclude", 말고: "_exclude", 없는: "_exclude",
}

// ── Cache state ──────────────────────────────────────────────

const cache: CacheEntry[] = []

// ── Tokenization ─────────────────────────────────────────────

function tokenize(text: string): Set<string> {
  const lower = text.toLowerCase()
  // Strip Korean particles + common suffixes
  const stripped = lower.replace(/(?:이요|으로|이랑|에서|한테|부터|까지|로|은|는|이|가|을|를|요|해줘|해|줘|입니다|이에요|예요)\b/gu, " ")
  const raw = stripped.split(/[\s,./()[\]{}!?;:'"~]+/).filter(t => t.length > 0)
  const normalized = new Set<string>()
  for (const token of raw) {
    if (token.length === 0) continue
    normalized.add(SYNONYM_MAP[token] ?? token)
  }
  return normalized
}

function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0
  let intersection = 0
  for (const t of a) if (b.has(t)) intersection++
  const union = a.size + b.size - intersection
  return union === 0 ? 0 : intersection / union
}

function computeFilterKey(filters: AppliedFilter[]): string {
  return filters
    .map(f => `${f.field}:${typeof f.value === "object" ? JSON.stringify(f.value) : String(f.value)}`)
    .sort()
    .join("|")
}

// ── Public API ───────────────────────────────────────────────

export function lookupCache(query: string, currentFilters: AppliedFilter[]): CachedResult | null {
  pruneExpired()
  const queryTokens = tokenize(query)
  if (queryTokens.size === 0) return null
  const filterKey = computeFilterKey(currentFilters)

  let best: CacheEntry | null = null
  let bestSim = 0
  for (const entry of cache) {
    if (entry.filterKey !== filterKey) continue
    const sim = jaccardSimilarity(queryTokens, entry.tokens)
    if (sim > bestSim) {
      bestSim = sim
      best = entry
    }
  }

  if (best && bestSim >= SIMILARITY_THRESHOLD) {
    best.hitCount++
    console.log(`[semantic-cache:hit] "${query.slice(0, 40)}" ≈ "${best.query.slice(0, 40)}" jaccard=${bestSim.toFixed(3)} hits=${best.hitCount}`)
    return best.result
  }
  return null
}

export function storeCache(query: string, currentFilters: AppliedFilter[], result: CachedResult): void {
  const tokens = tokenize(query)
  if (tokens.size === 0) return
  const filterKey = computeFilterKey(currentFilters)

  // Dedupe: skip if exact same query+filterKey already cached
  const existing = cache.find(e => e.query === query && e.filterKey === filterKey)
  if (existing) {
    existing.result = result
    existing.createdAt = Date.now()
    return
  }

  cache.push({
    query,
    tokens,
    filterKey,
    result,
    createdAt: Date.now(),
    hitCount: 0,
  })

  if (cache.length > CACHE_MAX_SIZE) {
    cache.sort((a, b) => a.hitCount - b.hitCount || a.createdAt - b.createdAt)
    cache.splice(0, cache.length - CACHE_MAX_SIZE)
  }
}

function pruneExpired(): void {
  const cutoff = Date.now() - CACHE_TTL_MS
  for (let i = cache.length - 1; i >= 0; i--) {
    if (cache[i].createdAt < cutoff) cache.splice(i, 1)
  }
}

export function getCacheStats(): { size: number; totalHits: number } {
  return {
    size: cache.length,
    totalHits: cache.reduce((sum, e) => sum + e.hitCount, 0),
  }
}

// Test helper
export function _resetCacheForTest(): void {
  cache.length = 0
}
