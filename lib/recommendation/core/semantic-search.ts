/**
 * Semantic KB Search — auto-synonym 토큰화 + Jaccard 유사도 기반 검색.
 *
 * 임베딩 서버 없이도 동작. 대상 KB:
 *   1. data/series-knowledge.json (시리즈 features/applications/target_materials)
 *   2. data/domain-knowledge/material-coating-guide.json
 *   3. data/domain-knowledge/troubleshooting.json
 *   4. data/domain-knowledge/operation-guide.json
 *
 * 응답 LLM 프롬프트에 RAG context로 주입하여 도메인 근거를 제공.
 */

import { tokenize, jaccardSimilarity } from "./auto-synonym"

export type KBSource =
  | "series-knowledge"
  | "material-guide"
  | "troubleshooting"
  | "operation-guide"

export interface KBEntry {
  id: string
  source: KBSource
  text: string
  tokens: Set<string>
  metadata: Record<string, unknown>
}

export interface SemanticHit {
  entry: KBEntry
  score: number
  /** 응답 LLM에 그대로 주입할 수 있는 한 줄 라벨 */
  label: string
}

let _entries: KBEntry[] = []
let _loaded = false

function safeRequire<T>(path: string): T | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require(path) as T
  } catch {
    return null
  }
}

function pushEntry(
  id: string,
  source: KBSource,
  text: string,
  metadata: Record<string, unknown>,
): void {
  if (!text || text.trim().length === 0) return
  _entries.push({ id, source, text, tokens: tokenize(text), metadata })
}

export function loadKB(): void {
  if (_loaded) return
  _entries = []

  // 1. series-knowledge.json
  const series = safeRequire<Array<Record<string, unknown>>>(
    "../../../data/series-knowledge.json",
  )
  if (Array.isArray(series)) {
    for (const s of series) {
      const features = Array.isArray(s.features) ? (s.features as string[]) : []
      const applications = Array.isArray(s.applications)
        ? (s.applications as string[])
        : []
      const targets = Array.isArray(s.target_materials)
        ? (s.target_materials as string[])
        : []
      const text = [
        s.product_name as string | undefined,
        ...features,
        ...applications,
        ...targets,
      ]
        .filter(Boolean)
        .join(" ")
      pushEntry(`series:${s.series ?? s.brand ?? ""}`, "series-knowledge", text, {
        type: "series",
        series: s.series,
        brand: s.brand,
        product_name: s.product_name,
      })
    }
  }

  // 2. material-coating-guide.json
  const matGuide = safeRequire<Array<Record<string, unknown>>>(
    "../../../data/domain-knowledge/material-coating-guide.json",
  )
  if (Array.isArray(matGuide)) {
    for (const m of matGuide) {
      const tips = Array.isArray(m.machining_tips)
        ? (m.machining_tips as string[])
        : []
      const coatings = Array.isArray(m.recommended_coatings)
        ? (m.recommended_coatings as Array<{ coating?: string; reason?: string }>)
        : []
      const coatText = coatings
        .map(c => `${c.coating ?? ""} ${c.reason ?? ""}`)
        .join(" ")
      const text = `${m.material ?? ""} ${m.characteristics ?? ""} ${coatText} ${tips.join(" ")}`
      pushEntry(
        `material:${m.material ?? ""}`,
        "material-guide",
        text,
        m as Record<string, unknown>,
      )
    }
  }

  // 3. troubleshooting.json
  const trouble = safeRequire<Array<Record<string, unknown>>>(
    "../../../data/domain-knowledge/troubleshooting.json",
  )
  if (Array.isArray(trouble)) {
    for (const t of trouble) {
      const aliases = Array.isArray(t.aliases) ? (t.aliases as string[]) : []
      const causes = Array.isArray(t.causes) ? (t.causes as string[]) : []
      const sols = Array.isArray(t.solutions)
        ? (t.solutions as Array<{ action?: string; detail?: string }>)
        : []
      const solText = sols
        .map(s => `${s.action ?? ""} ${s.detail ?? ""}`)
        .join(" ")
      const text = `${t.symptom ?? ""} ${aliases.join(" ")} ${causes.join(" ")} ${solText}`
      pushEntry(
        `trouble:${t.symptom ?? ""}`,
        "troubleshooting",
        text,
        t as Record<string, unknown>,
      )
    }
  }

  // 4. operation-guide.json
  const ops = safeRequire<Array<Record<string, unknown>>>(
    "../../../data/domain-knowledge/operation-guide.json",
  )
  if (Array.isArray(ops)) {
    for (const o of ops) {
      const aliases = Array.isArray(o.aliases) ? (o.aliases as string[]) : []
      const strat = Array.isArray(o.strategy) ? (o.strategy as string[]) : []
      const text = `${o.operation ?? ""} ${aliases.join(" ")} ${o.description ?? ""} ${strat.join(" ")}`
      pushEntry(
        `op:${o.operation ?? ""}`,
        "operation-guide",
        text,
        o as Record<string, unknown>,
      )
    }
  }

  _loaded = true
  // eslint-disable-next-line no-console
  console.log(`[semantic-kb] loaded ${_entries.length} entries`)
}

function buildLabel(entry: KBEntry): string {
  const meta = entry.metadata as Record<string, unknown>
  switch (entry.source) {
    case "material-guide": {
      const tips = Array.isArray(meta.machining_tips)
        ? (meta.machining_tips as string[]).slice(0, 2).join(" / ")
        : ""
      const coatings = Array.isArray(meta.recommended_coatings)
        ? (meta.recommended_coatings as Array<{ coating?: string }>)
            .map(c => c.coating)
            .filter(Boolean)
            .join(", ")
        : ""
      return `[소재가이드] ${meta.material}: 추천코팅=${coatings}. ${tips}`
    }
    case "troubleshooting": {
      const sols = Array.isArray(meta.solutions)
        ? (meta.solutions as Array<{ action?: string }>)
            .slice(0, 3)
            .map(s => s.action)
            .filter(Boolean)
            .join(" / ")
        : ""
      return `[트러블슈팅] ${meta.symptom}: ${sols}`
    }
    case "operation-guide": {
      const strat = Array.isArray(meta.strategy)
        ? (meta.strategy as string[]).slice(0, 2).join(" / ")
        : ""
      return `[가공가이드] ${meta.operation}: ${strat}`
    }
    case "series-knowledge":
    default:
      return `[시리즈] ${meta.brand ?? ""} ${meta.series ?? ""} — ${(meta.product_name as string | undefined) ?? ""}`
  }
}

export function searchKB(query: string, topK = 3, minScore = 0.08): SemanticHit[] {
  if (!_loaded) loadKB()
  if (_entries.length === 0 || !query || query.trim().length === 0) return []
  const qt = tokenize(query)
  if (qt.size === 0) return []
  const scored: SemanticHit[] = []
  for (const entry of _entries) {
    const score = jaccardSimilarity(qt, entry.tokens)
    if (score >= minScore) {
      scored.push({ entry, score, label: buildLabel(entry) })
    }
  }
  scored.sort((a, b) => b.score - a.score)
  return scored.slice(0, topK)
}

/** 응답 LLM에 주입할 RAG context 블록을 생성. 검색 결과 없으면 빈 문자열. */
export function buildKBContextBlock(query: string, topK = 3): string {
  const hits = searchKB(query, topK)
  if (hits.length === 0) return ""
  const lines = hits.map(h => `• ${h.label}`)
  return `\n\n═══ 관련 도메인 지식 (RAG) ═══\n${lines.join("\n")}\n위 지식은 추천 근거로만 활용하고, 원문 그대로 복사하지 말고 자연스럽게 응답에 녹이세요.`
}

/** 테스트용 */
export function _resetKBForTest(): void {
  _entries = []
  _loaded = false
}
