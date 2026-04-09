/**
 * Auto-Synonym Engine — 동의어 맵을 하드코딩 없이 자동 구축.
 *
 * 3개 소스:
 * 1. patterns.ts → MATERIAL_KEYWORDS, TOOL_SUBTYPE_ALIASES, COATING_KO_ALIASES,
 *                  COATING_CHEMICAL_DB_ALIASES, OPERATION_KEYWORDS
 * 2. knowledge-graph.ts → ENTITY_NODES[].aliases
 * 3. DB schema cache (sql-agent-schema-cache.ts) → sampleValues, brands, workpieces, countries
 *
 * 스키마 캐시(1시간 TTL)가 갱신되면 자동 리빌드.
 */

import { getDbSchemaSync, type DbSchema } from "./sql-agent-schema-cache"
import {
  MATERIAL_KEYWORDS,
  TOOL_SUBTYPE_ALIASES,
  COATING_KO_ALIASES,
  COATING_CHEMICAL_DB_ALIASES,
  OPERATION_KEYWORDS,
} from "@/lib/recommendation/shared/patterns"
import { ENTITY_NODES } from "./knowledge-graph"

let _map: Map<string, string> = new Map()
let _version = -1

export function getSynonymMap(): Map<string, string> {
  const schema = getDbSchemaSync()
  const v = schema?.loadedAt ?? 0
  if (_map.size === 0 || v > _version) {
    _map = build(schema)
    _version = v
    console.log(`[auto-synonym] rebuilt: ${_map.size} entries (schema v=${v})`)
  }
  return _map
}

function addCompact(m: Map<string, string>, key: string, val: string): void {
  m.set(key, val)
  const compact = key.replace(/[\s\-_]/g, "")
  if (compact !== key && compact.length > 1) m.set(compact, val)
}

function build(schema: DbSchema | null): Map<string, string> {
  const m = new Map<string, string>()

  // === Source 1: patterns.ts ===
  for (const [canonical, aliases] of Object.entries(MATERIAL_KEYWORDS)) {
    const norm = canonical.toLowerCase()
    for (const a of aliases) addCompact(m, a.toLowerCase(), norm)
  }
  for (const [alias, canon] of Object.entries(TOOL_SUBTYPE_ALIASES)) {
    addCompact(m, alias.toLowerCase(), canon.toLowerCase())
  }
  for (const [alias, canon] of Object.entries(COATING_KO_ALIASES)) {
    addCompact(m, alias.toLowerCase(), canon.toLowerCase())
  }
  for (const [chemical, dbNames] of Object.entries(COATING_CHEMICAL_DB_ALIASES)) {
    const norm = chemical.toLowerCase()
    for (const dn of dbNames) addCompact(m, dn.toLowerCase(), norm)
  }
  for (const [canonical, aliases] of Object.entries(OPERATION_KEYWORDS)) {
    const norm = canonical.toLowerCase()
    for (const a of aliases) addCompact(m, a.toLowerCase(), norm)
  }

  // === Source 2: knowledge-graph.ts ENTITY_NODES ===
  for (const node of ENTITY_NODES) {
    const norm = `${node.field}:${node.canonical.toLowerCase()}`
    for (const a of node.aliases) addCompact(m, a.toLowerCase(), norm)
  }

  // === Source 3: DB schema sample values (완전 동적) ===
  if (schema) {
    for (const [col, values] of Object.entries(schema.sampleValues)) {
      for (const val of values) {
        if (!val || val.length > 50) continue
        const lower = val.toLowerCase()
        addCompact(m, lower, `${col}:${lower}`)
      }
    }
    for (const brand of schema.brands) {
      addCompact(m, brand.toLowerCase(), `brand:${brand.toLowerCase()}`)
    }
    for (const wp of schema.workpieces) {
      const target = `wp:${(wp.normalized_work_piece_name ?? "").toLowerCase()}`
      if (wp.tag_name) addCompact(m, wp.tag_name.toLowerCase(), target)
      if (wp.normalized_work_piece_name) addCompact(m, wp.normalized_work_piece_name.toLowerCase(), target)
    }
    for (const cc of schema.countries ?? []) {
      addCompact(m, cc.toLowerCase(), `country:${cc.toLowerCase()}`)
    }
  }

  // === 한국어 단위/조사 (보편적, 도메인 무관) ===
  for (const [k, v] of Object.entries({
    mm: "_dim", 밀리: "_dim", 미리: "_dim", 파이: "_dim", "ø": "_dim",
    날: "_flute", flute: "_flute", flutes: "_flute", f: "_flute",
    도: "_deg", deg: "_deg", degree: "_deg",
    추천: "_rec", 골라줘: "_rec", 보여줘: "_rec", 찾아줘: "_rec",
    빼고: "_exc", 제외: "_exc", 말고: "_exc", 없는: "_exc",
  })) m.set(k, v)

  return m
}

// ── Tokenization (auto-synonym 적용) ──────────────────────────

const PARTICLES = /(?:이요|으로|이랑|에서|한테|부터|까지|로|은|는|이|가|을|를|요|해줘|해|줘|입니다|이에요|예요|할건데|가공|쯤|정도|근처|대략)\b/gu

export function tokenize(text: string): Set<string> {
  const map = getSynonymMap()
  const lower = text.toLowerCase()
  const stripped = lower
    .replace(PARTICLES, " ")
    .replace(/(\d(?:\.\d+)?)([a-zA-Z가-힣])/g, "$1 $2")
    .replace(/([a-zA-Z가-힣])(\d)/g, "$1 $2")
  const raw = stripped.split(/[\s,./()[\]{}!?;:'"~\-]+/).filter(t => t.length > 0)
  const out = new Set<string>()
  for (const token of raw) {
    const syn = map.get(token)
    if (syn) {
      const ci = syn.indexOf(":")
      out.add(ci >= 0 ? syn.slice(ci + 1) : syn)
    } else {
      out.add(token)
    }
    if (/^\d+(?:\.\d+)?$/.test(token)) out.add(token)
  }
  return out
}

export function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0
  let intersection = 0
  for (const t of a) if (b.has(t)) intersection++
  const union = a.size + b.size - intersection
  return union === 0 ? 0 : intersection / union
}

// 테스트용 — 캐시 강제 리빌드
export function _resetSynonymMapForTest(): void {
  _map = new Map()
  _version = -1
}
