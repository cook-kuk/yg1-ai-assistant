/**
 * Domain Knowledge Loader
 * data/domain-knowledge/*.json 을 런타임에 1회 로드해 검색 가능한 포맷으로 보관.
 * explain/question 분기에서 사용자 질의 키워드와 매칭되는 항목만 추출해
 * LLM 응답에 grounded 컨텍스트로 주입.
 * 하드코딩 없음 — JSON 파일 자체가 SSOT.
 */

import fs from "fs"
import path from "path"

export interface DomainKnowledgeEntry {
  source: string
  title: string
  body: string
  keywords: string[]
}

let _cache: DomainKnowledgeEntry[] | null = null

function safeLoad<T = unknown>(file: string): T | null {
  const p = path.join(process.cwd(), "data", "domain-knowledge", file)
  if (!fs.existsSync(p)) return null
  try {
    return JSON.parse(fs.readFileSync(p, "utf-8")) as T
  } catch (err) {
    console.warn(`[domain-kb] parse fail ${file}: ${err instanceof Error ? err.message : err}`)
    return null
  }
}

function pushIfPresent(entries: DomainKnowledgeEntry[], e: DomainKnowledgeEntry) {
  if (!e.title && !e.body) return
  entries.push(e)
}

function collectKeywords(...parts: Array<string | string[] | undefined | null>): string[] {
  const out = new Set<string>()
  for (const p of parts) {
    if (!p) continue
    const list = Array.isArray(p) ? p : [p]
    for (const v of list) {
      const s = String(v ?? "").toLowerCase().trim()
      if (s.length >= 2) out.add(s)
    }
  }
  return [...out]
}

function loadAll(): DomainKnowledgeEntry[] {
  if (_cache) return _cache
  const entries: DomainKnowledgeEntry[] = []

  // machining-knowhow: topic / content_ko
  const mk = safeLoad<Array<{ topic?: string; category?: string; content_ko?: string; content_en?: string }>>("machining-knowhow.json")
  if (Array.isArray(mk)) {
    for (const e of mk) {
      pushIfPresent(entries, {
        source: "machining-knowhow",
        title: e.topic ?? "",
        body: e.content_ko ?? e.content_en ?? "",
        keywords: collectKeywords(e.topic, e.category),
      })
    }
  }

  // coating-properties: coating_name / composition / materials
  const cp = safeLoad<Array<{ coating_name?: string; composition?: string; hardness_hv?: number; max_operating_temperature_c?: number; recommended_materials?: string[]; [k: string]: unknown }>>("coating-properties.json")
  if (Array.isArray(cp)) {
    for (const e of cp) {
      const lines = [
        e.composition && `조성: ${e.composition}`,
        typeof e.hardness_hv === "number" && `경도: ${e.hardness_hv} HV`,
        typeof e.max_operating_temperature_c === "number" && `최대 사용 온도: ${e.max_operating_temperature_c}°C`,
        Array.isArray(e.recommended_materials) && e.recommended_materials.length > 0 && `권장 피삭재: ${e.recommended_materials.join(", ")}`,
      ].filter(Boolean)
      pushIfPresent(entries, {
        source: "coating-properties",
        title: e.coating_name ?? "",
        body: lines.join("\n"),
        keywords: collectKeywords(e.coating_name, e.composition),
      })
    }
  }

  // material-coating-guide: material / iso_group / recommended_coatings
  const mcg = safeLoad<Array<{ material?: string; iso_group?: string; characteristics?: string; recommended_coatings?: Array<{ coating?: string; yg1_name?: string; reason?: string; priority?: number }> }>>("material-coating-guide.json")
  if (Array.isArray(mcg)) {
    for (const e of mcg) {
      const rec = (e.recommended_coatings ?? [])
        .sort((a, b) => (a.priority ?? 99) - (b.priority ?? 99))
        .map(r => `  - ${r.coating}${r.yg1_name ? ` (YG1: ${r.yg1_name})` : ""}${r.reason ? ` — ${r.reason}` : ""}`)
        .join("\n")
      pushIfPresent(entries, {
        source: "material-coating-guide",
        title: `${e.material ?? ""} 코팅 가이드`,
        body: [e.characteristics ? `특징: ${e.characteristics}` : "", rec].filter(Boolean).join("\n"),
        keywords: collectKeywords(e.material, e.iso_group),
      })
    }
  }

  // operation-guide: operation / aliases / description / tool_selection / strategy
  const og = safeLoad<Array<{ operation?: string; aliases?: string[]; description?: string; tool_selection?: Record<string, string>; strategy?: string[] }>>("operation-guide.json")
  if (Array.isArray(og)) {
    for (const e of og) {
      const ts = e.tool_selection ? Object.entries(e.tool_selection).map(([k, v]) => `  - ${k}: ${v}`).join("\n") : ""
      const strat = Array.isArray(e.strategy) ? e.strategy.map(s => `  - ${s}`).join("\n") : ""
      const body = [
        e.description,
        ts && `공구 선정:\n${ts}`,
        strat && `전략:\n${strat}`,
      ].filter(Boolean).join("\n")
      pushIfPresent(entries, {
        source: "operation-guide",
        title: e.operation ?? "",
        body,
        keywords: collectKeywords(e.operation, e.aliases),
      })
    }
  }

  // troubleshooting: symptom / aliases / causes / solutions
  const ts = safeLoad<Array<{ symptom?: string; aliases?: string[]; causes?: string[]; solutions?: Array<{ action?: string; detail?: string }> }>>("troubleshooting.json")
  if (Array.isArray(ts)) {
    for (const e of ts) {
      const causes = Array.isArray(e.causes) ? e.causes.map(c => `  - ${c}`).join("\n") : ""
      const sols = Array.isArray(e.solutions) ? e.solutions.map(s => `  - ${s.action}${s.detail ? `: ${s.detail}` : ""}`).join("\n") : ""
      const body = [causes && `원인:\n${causes}`, sols && `해결:\n${sols}`].filter(Boolean).join("\n")
      pushIfPresent(entries, {
        source: "troubleshooting",
        title: e.symptom ?? "",
        body,
        keywords: collectKeywords(e.symptom, e.aliases),
      })
    }
  }

  _cache = entries
  try { console.log(`[domain-kb] loaded ${entries.length} entries`) } catch { /* no-op */ }
  return entries
}

/**
 * Tokenize user message: 2+ char substrings, lowercase. Hangul + latin both supported.
 */
function tokenize(msg: string): string[] {
  const lower = msg.toLowerCase()
  const tokens = new Set<string>()
  for (const m of lower.matchAll(/[a-z0-9가-힣]{2,}/g)) tokens.add(m[0])
  return [...tokens]
}

/**
 * Score an entry against user message tokens.
 * Keyword exact match > title/body substring.
 */
function scoreEntry(entry: DomainKnowledgeEntry, tokens: string[], rawMsg: string): number {
  let score = 0
  const msg = rawMsg.toLowerCase()
  for (const kw of entry.keywords) {
    if (msg.includes(kw)) score += 3
  }
  const hay = `${entry.title}\n${entry.body}`.toLowerCase()
  for (const t of tokens) {
    if (t.length < 2) continue
    if (hay.includes(t)) score += 1
  }
  return score
}

export function retrieveDomainKnowledge(userMsg: string, limit = 3): DomainKnowledgeEntry[] {
  const entries = loadAll()
  if (!entries.length || !userMsg) return []
  const tokens = tokenize(userMsg)
  if (!tokens.length) return []
  const ranked = entries
    .map(e => ({ e, s: scoreEntry(e, tokens, userMsg) }))
    .filter(x => x.s >= 3)
    .sort((a, b) => b.s - a.s)
    .slice(0, limit)
  return ranked.map(x => x.e)
}

export function formatDomainKnowledgeFooter(userMsg: string, limit = 3): string | null {
  const hits = retrieveDomainKnowledge(userMsg, limit)
  if (hits.length === 0) return null
  const lines: string[] = ["", "━ 참고 도메인 지식 ━"]
  for (const h of hits) {
    lines.push(`• [${h.source}] ${h.title}`)
    const bodyLines = h.body.split("\n").map(l => `  ${l}`).join("\n")
    lines.push(bodyLines)
  }
  return lines.join("\n")
}
