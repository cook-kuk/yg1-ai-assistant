/**
 * Semantic KB Search — domain-knowledge JSON 파일들을 토큰 기반으로 검색.
 *
 * auto-synonym.ts의 tokenize + jaccardSimilarity 사용 → 하드코딩 0.
 * "떨림 줄이고 싶어" → troubleshooting.json의 "채터/진동" 매칭.
 * "AlCrN이 왜 좋아?" → coating-properties.json + material-coating-guide.json 매칭.
 *
 * 서버 시작 시 1회 로드, data/domain-knowledge 폴더의 모든 JSON 자동 스캔.
 * 새 JSON 파일 추가 시 코드 수정 0 — 서버 재시작만.
 */

import { tokenize, jaccardSimilarity } from "./auto-synonym"
import fs from "fs"
import path from "path"

// ── Types ────────────────────────────────────────

export interface KBEntry {
  id: string
  source: string         // 파일명 (coating-properties, troubleshooting 등)
  category: string       // 카테고리 (coating, material, troubleshooting, operation, competitor 등)
  searchText: string
  tokens: Set<string>
  data: Record<string, unknown>
  /** 응답 LLM에 주입할 한국어 요약 (1~3문장) */
  summary: string
}

export interface KBSearchResult {
  entry: KBEntry
  score: number
}

/** 하위 호환 — 구버전 호출자용 */
export type SemanticHit = KBSearchResult & { label: string }

// ── State ────────────────────────────────────────

let _entries: KBEntry[] = []
let _loaded = false

// ── Loader ───────────────────────────────────────

export function loadKB(): void {
  const dir = path.join(process.cwd(), "data", "domain-knowledge")
  if (!fs.existsSync(dir)) {
    console.warn("[semantic-kb] data/domain-knowledge/ not found — KB empty")
    _loaded = true
    return
  }

  _entries = []
  const files = fs
    .readdirSync(dir)
    .filter(f => f.endsWith(".json") && !f.startsWith("raw"))

  for (const file of files) {
    try {
      const raw = JSON.parse(fs.readFileSync(path.join(dir, file), "utf8"))
      const baseName = file.replace(".json", "")
      const items = Array.isArray(raw) ? raw : [raw]
      for (let i = 0; i < items.length; i++) {
        const parsed = parseKBItem(baseName, items[i] as Record<string, unknown>, i)
        if (parsed) _entries.push(parsed)
      }
    } catch (e) {
      console.warn(`[semantic-kb] failed to load ${file}:`, (e as Error).message)
    }
  }

  _loaded = true
  console.log(`[semantic-kb] loaded ${_entries.length} entries from ${files.length} files`)
}

function parseKBItem(
  source: string,
  item: Record<string, unknown>,
  idx: number,
): KBEntry | null {
  if (!item || typeof item !== "object") return null

  let searchText = ""
  let summary = ""
  let category = source
  let id = `${source}:${idx}`

  if (source === "coating-properties" || source.includes("coating-prop")) {
    category = "coating"
    const name = String(item.coating_name ?? item.coating ?? `c${idx}`)
    id = `coating:${name}`
    const yg1Names = Array.isArray(item.yg1_names) ? (item.yg1_names as string[]).join(" ") : ""
    const recMat = Array.isArray(item.recommended_materials) ? (item.recommended_materials as string[]).join(" ") : ""
    searchText = `${name} ${yg1Names} ${item.composition ?? ""} ${item.deposition_method ?? item.deposition ?? ""} ${recMat} ${item.color ?? ""}`
    const recStr = Array.isArray(item.recommended_materials)
      ? (item.recommended_materials as string[]).join(", ")
      : ""
    summary = `${name}${yg1Names ? `(${yg1Names})` : ""}: 경도 ${item.hardness_hv ?? "?"}HV, 내열 ${item.max_operating_temperature_c ?? item.max_temperature_c ?? "?"}°C, 마찰 ${item.friction_coefficient ?? "?"}. 적합: ${recStr}`
  } else if (source === "material-coating-guide" || source.includes("material-coating")) {
    category = "material-guide"
    const mat = String(item.material ?? `m${idx}`)
    id = `matguide:${mat}`
    const tips = Array.isArray(item.machining_tips) ? (item.machining_tips as string[]).join(" ") : ""
    const chars = String(item.characteristics ?? "")
    searchText = `${mat} ${item.iso_group ?? ""} ${chars} ${tips}`
    const coatings = Array.isArray(item.recommended_coatings)
      ? (item.recommended_coatings as Array<{ coating?: string; yg1_name?: string }>)
          .map(c => `${c.coating ?? ""}${c.yg1_name ? `(${c.yg1_name})` : ""}`)
          .join(", ")
      : ""
    summary = `${mat}(ISO ${item.iso_group ?? "?"}): ${chars.slice(0, 80)}. 추천 코팅: ${coatings}`
  } else if (source === "material-properties" || source.includes("material-prop")) {
    category = "material"
    const name = String(item.name ?? `mat${idx}`)
    id = `material:${name}`
    const apps = Array.isArray(item.common_applications) ? (item.common_applications as string[]).join(" ") : ""
    searchText = `${name} ${item.standard ?? ""} ${item.iso_group ?? ""} ${item.category_ko ?? ""} ${item.category_en ?? ""} ${apps} ${item.machining_notes ?? ""}`
    summary = `${name}(${item.standard ?? ""}, ISO ${item.iso_group ?? "?"}): ${item.category_ko ?? ""}, 경도 ${item.hardness ?? "?"}, σ ${item.tensile_strength_mpa ?? "?"}MPa, 열전도 ${item.thermal_conductivity_w_mk ?? "?"}W/mK`
  } else if (source === "troubleshooting") {
    category = "troubleshooting"
    const sym = String(item.symptom ?? item.symptom_ko ?? `t${idx}`)
    id = `trouble:${sym}`
    const aliases = Array.isArray(item.aliases) ? (item.aliases as string[]).join(" ") : ""
    const causes = Array.isArray(item.causes) ? (item.causes as string[]).join(" ") : ""
    const solutions = Array.isArray(item.solutions)
      ? (item.solutions as Array<unknown>)
          .map(s => (typeof s === "object" && s ? ((s as { action?: string }).action ?? JSON.stringify(s)) : String(s)))
          .join(" ")
      : ""
    searchText = `${sym} ${item.symptom_en ?? ""} ${aliases} ${causes} ${solutions}`
    const topSolution = Array.isArray(item.solutions) && item.solutions[0]
      ? (typeof item.solutions[0] === "object"
          ? ((item.solutions[0] as { action?: string }).action ?? "")
          : String(item.solutions[0]))
      : ""
    summary = `[트러블슈팅] ${sym}: ${topSolution}`
  } else if (source === "operation-guide" || source.includes("operation")) {
    category = "operation"
    const op = String(item.operation ?? item.operation_ko ?? `o${idx}`)
    id = `operation:${op}`
    const aliases = Array.isArray(item.aliases) ? (item.aliases as string[]).join(" ") : ""
    const desc = String(item.description ?? item.recommended_strategy ?? "")
    const strategy = Array.isArray(item.cutting_strategy)
      ? (item.cutting_strategy as string[]).join(" ")
      : Array.isArray(item.strategy)
        ? (item.strategy as string[]).join(" ")
        : ""
    searchText = `${op} ${item.operation_en ?? ""} ${aliases} ${desc} ${strategy}`
    summary = `[가공 가이드] ${op}: ${desc.slice(0, 100)}`
  } else if (source === "competitor-cross-reference" || source.includes("competitor")) {
    category = "competitor"
    const brand = String(item.competitor_brand ?? item.competitor ?? "")
    const series = String(item.competitor_series ?? "")
    id = `competitor:${brand}-${series || idx}`
    const specs = item.specs && typeof item.specs === "object" ? JSON.stringify(item.specs) : String(item.competitor_specs ?? "")
    searchText = `${brand} ${series} ${item.competitor_model ?? ""} ${specs} ${item.yg1_equivalent ?? ""}`
    summary = `[경쟁사] ${brand} ${series} → YG-1 ${item.yg1_equivalent ?? "?"}: ${item.comparison_notes ?? item.yg1_advantage ?? ""}`
  } else if (source === "tap-drill-chart" || source.includes("tap")) {
    category = "reference"
    if (item.metric_coarse || item.metric || item.unc || item.formula_note) {
      searchText = "탭 드릴 사이즈 tap drill size 나사 하공 metric UNC UNF NPT BSP"
      const mc = Array.isArray(item.metric_coarse) ? (item.metric_coarse as unknown[]).length
        : Array.isArray(item.metric) ? (item.metric as unknown[]).length : 0
      summary = `[탭 드릴 차트] 미터 ${mc}개 + 세밀나사 + 인치 + 파이프 규격`
      id = "tapdrill:all"
    } else {
      searchText = `${item.thread ?? ""} ${item.pitch_mm ?? item.pitch ?? ""} tap drill ${item.tap_drill_mm ?? ""}`
      summary = `${item.thread}: 탭 드릴 Ø${item.tap_drill_mm ?? "?"}mm (피치 ${item.pitch_mm ?? item.pitch ?? "?"})`
    }
  } else if (source === "iso-standards" || source.includes("iso")) {
    category = "standard"
    id = `iso:${idx}`
    searchText = `ISO 513 1832 ${JSON.stringify(item).slice(0, 800)}`
    summary = `[ISO 표준] 절삭공구 분류 (513/1832)`
  } else if (source === "machining-knowhow" || source.includes("knowhow")) {
    category = "knowhow"
    const topic = String(item.topic ?? `k${idx}`)
    id = `knowhow:${topic}`
    const params = item.key_parameters && typeof item.key_parameters === "object" ? JSON.stringify(item.key_parameters) : ""
    searchText = `${topic} ${item.category ?? ""} ${item.content_ko ?? ""} ${item.content_en ?? ""} ${params}`
    summary = `[노하우] ${topic}: ${String(item.content_ko ?? item.content_en ?? "").slice(0, 100)}`
  } else {
    searchText = JSON.stringify(item).replace(/[{}"[\],]/g, " ").slice(0, 500)
    summary = `[${source}] ${searchText.slice(0, 100)}`
  }

  if (!searchText.trim()) return null

  return {
    id,
    source,
    category,
    searchText,
    tokens: tokenize(searchText),
    data: item,
    summary,
  }
}

// ── Search ───────────────────────────────────────

export function searchKB(
  query: string,
  topK = 3,
  minScore = 0.08,
  categories?: string[],
): KBSearchResult[] {
  if (!_loaded) loadKB()
  if (_entries.length === 0 || !query || query.trim().length === 0) return []

  const qt = tokenize(query)
  if (qt.size === 0) return []

  let pool = _entries
  if (categories && categories.length > 0) {
    const catSet = new Set(categories)
    pool = pool.filter(e => catSet.has(e.category))
  }

  return pool
    .map(entry => ({ entry, score: jaccardSimilarity(qt, entry.tokens) }))
    .filter(r => r.score >= minScore)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK)
}

export function getMaterialGuide(materialName: string): KBEntry | null {
  if (!_loaded) loadKB()
  const lower = materialName.toLowerCase()
  return (
    _entries.find(
      e =>
        e.category === "material-guide" &&
        String(e.data.material ?? "").toLowerCase().includes(lower),
    ) ?? null
  )
}

export function getCoatingProperties(coatingName: string): KBEntry | null {
  if (!_loaded) loadKB()
  const lower = coatingName.toLowerCase()
  return (
    _entries.find(
      e =>
        e.category === "coating" &&
        (String(e.data.coating_name ?? e.data.coating ?? "").toLowerCase().includes(lower) ||
          (Array.isArray(e.data.yg1_names) &&
            (e.data.yg1_names as string[]).some(n => n.toLowerCase().includes(lower)))),
    ) ?? null
  )
}

export function getTapDrill(thread: string): Record<string, unknown> | null {
  if (!_loaded) loadKB()
  const entry = _entries.find(e => e.id === "tapdrill:all")
  if (!entry) return null
  const data = entry.data as Record<string, unknown>
  const all: Array<Record<string, unknown>> = []
  for (const key of ["metric_coarse", "metric", "metric_fine", "unc", "unf", "npt", "bsp"]) {
    const arr = data[key]
    if (Array.isArray(arr)) all.push(...(arr as Array<Record<string, unknown>>))
  }
  const want = thread.toLowerCase().replace(/\s+/g, "")
  return (
    all.find(row => String(row.thread ?? "").toLowerCase().replace(/\s+/g, "") === want) ?? null
  )
}

export function getKBStats(): {
  totalEntries: number
  byCategory: Record<string, number>
  bySource: Record<string, number>
} {
  if (!_loaded) loadKB()
  const byCategory: Record<string, number> = {}
  const bySource: Record<string, number> = {}
  for (const e of _entries) {
    byCategory[e.category] = (byCategory[e.category] ?? 0) + 1
    bySource[e.source] = (bySource[e.source] ?? 0) + 1
  }
  return { totalEntries: _entries.length, byCategory, bySource }
}

// ── Backward-compat: buildKBContextBlock ─────────────────────

/** 응답 LLM에 주입할 RAG context 블록을 생성. 검색 결과 없으면 빈 문자열. */
export function buildKBContextBlock(query: string, topK = 3): string {
  const hits = searchKB(query, topK)
  if (hits.length === 0) return ""
  const lines = hits.map(h => `• ${h.entry.summary}`)
  return `\n\n═══ 관련 도메인 지식 (RAG) ═══\n${lines.join("\n")}\n위 지식은 추천 근거로만 활용하고, 원문 그대로 복사하지 말고 자연스럽게 응답에 녹이세요.`
}

// ── Test helper ──────────────────────────────────

export function _resetKBForTest(): void {
  _entries = []
  _loaded = false
}
