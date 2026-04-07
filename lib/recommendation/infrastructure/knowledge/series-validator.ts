// LLM 환각 시리즈 감지기.
//
// LLM이 응답에 "3S MILL", "X-FORCE 시리즈" 같이 카탈로그에 없는 시리즈명을
// 만들어내는 사례가 발견됨 (한지희/이동건 피드백, 2026-04-06).
// 이 모듈은 series-knowledge.json + DB seed series 양쪽의 known-set을 lazy 로드해서
// 응답 텍스트에서 의심 토큰을 추출, 그중 known-set에 없는 것을 환각으로 판정한다.
//
// 정책: 응답 텍스트는 수정하지 않는다 (NLG flow 깨질 위험).
// - 환각이 발견되면 콘솔 warn + 결과 반환 → 호출자가 disclaimer 추가/로그/거부 결정.

import fs from "fs"
import path from "path"

interface KnowledgeEntry {
  series?: string
  brand?: string
  product_name?: string
}

let knownTokens: Set<string> | null = null
let knownDisplay: Map<string, string> | null = null

// 환각 판정에서 제외할 일반 단어 (대문자/약어)
const STOP_TOKENS = new Set([
  "YG", "YG-1", "YG1", "ISO", "ISO-S", "ISO-P", "ISO-M", "ISO-K", "ISO-N", "ISO-H",
  "DB", "AI", "API", "DIN", "AISI", "JIS", "ANSI", "EDP", "PVD", "CVD",
  "HSS", "HRC", "HSK", "BT", "CT", "CNC", "HPC", "DPI", "RPM",
  "PDF", "URL", "PDF의", "OK", "USA", "EU", "KR", "JP", "CN",
  "I.D.", "O.D.", "MM", "INCH",
  // Material classes
  "P", "M", "K", "N", "S", "H",
])

function normalizeKey(s: string): string {
  return s.toUpperCase().replace(/[\s\-./()_]+/g, "").replace(/[^A-Z0-9]/g, "")
}

function loadOnce(): { tokens: Set<string>; display: Map<string, string> } {
  if (knownTokens && knownDisplay) return { tokens: knownTokens, display: knownDisplay }

  const tokens = new Set<string>()
  const display = new Map<string, string>()
  const filePath = path.join(process.cwd(), "data", "series-knowledge.json")
  try {
    const raw = fs.readFileSync(filePath, "utf8")
    const parsed = JSON.parse(raw) as unknown
    const list = Array.isArray(parsed) ? (parsed as KnowledgeEntry[]) : Object.values(parsed as Record<string, KnowledgeEntry>)
    for (const e of list) {
      for (const field of [e.series, e.brand, e.product_name]) {
        if (!field || typeof field !== "string") continue
        // 전체 문구
        const key = normalizeKey(field)
        if (key.length >= 2) {
          tokens.add(key)
          if (!display.has(key)) display.set(key, field)
        }
        // 슬래시/플러스 등으로 분리된 내부 토큰도 추가 (예: "Square / Radius" → "SQUARE", "RADIUS")
        for (const part of field.split(/[\/+,;]/)) {
          const k = normalizeKey(part)
          if (k.length >= 3 && !STOP_TOKENS.has(k)) {
            tokens.add(k)
            if (!display.has(k)) display.set(k, part.trim())
          }
        }
      }
    }
    console.log(`[series-validator] loaded ${tokens.size} known series tokens from ${filePath}`)
  } catch (err) {
    console.warn(`[series-validator] load failed:`, (err as Error).message)
  }

  knownTokens = tokens
  knownDisplay = display
  return { tokens, display }
}

// "SUPER ALLOY", "V7 PLUS", "3S MILL", "EMH77", "X-POWER PRO" 같은 시리즈 후보 토큰을
// 텍스트에서 추출. 한글 사이에 끼어있어도 잡힘.
//
// SERIES_PHRASE: 2개 이상의 연속된 시리즈성 토큰 (각 토큰은 대문자/숫자/하이픈으로 구성).
// 첫 토큰이 숫자로 시작해도 허용 ("3S MILL").
// SERIES_TOKEN: 단일 토큰. 영문+숫자 혼합만 허용 (false positive 최소화).
const SERIES_TOKEN = /(?<![A-Z0-9])[A-Z][A-Z0-9](?:[A-Z0-9.\-]*[A-Z0-9])?(?![A-Z0-9])/g
const SERIES_PHRASE = /(?<![A-Z0-9])[A-Z0-9][A-Z0-9.\-]*(?:\s+[A-Z0-9][A-Z0-9.\-]+)+(?![A-Z0-9])/g

export interface HallucinationHit {
  raw: string
  normalized: string
}

export function findHallucinatedSeries(text: string): HallucinationHit[] {
  if (!text) return []
  const { tokens } = loadOnce()
  if (tokens.size === 0) return []

  const hits: HallucinationHit[] = []
  const seen = new Set<string>()

  // 1) 다중 토큰 구절 (e.g. "SUPER ALLOY", "3S MILL", "V7 PLUS")
  const phrases = text.match(SERIES_PHRASE) ?? []
  for (const phrase of phrases) {
    const trimmed = phrase.trim()
    // 단일 단어면 다음 단계에서 처리
    if (!/\s/.test(trimmed)) continue
    const key = normalizeKey(trimmed)
    if (key.length < 4 || STOP_TOKENS.has(key)) continue
    if (seen.has(key)) continue
    seen.add(key)
    if (!tokens.has(key)) {
      // 부분 매칭도 허용 ("V7 PLUS HPC" → "V7PLUS"가 known이면 OK)
      let partialOk = false
      for (const part of trimmed.split(/\s+/)) {
        const pk = normalizeKey(part)
        if (pk.length >= 3 && tokens.has(pk)) { partialOk = true; break }
      }
      if (!partialOk) hits.push({ raw: trimmed, normalized: key })
    }
  }

  // 2) 단일 강력 토큰 (e.g. "EMH77", "TITANNOX") — 길이 4 이상 + 영문+숫자 혼합인 것만
  const singles = text.match(SERIES_TOKEN) ?? []
  for (const tok of singles) {
    const key = normalizeKey(tok)
    if (key.length < 4 || STOP_TOKENS.has(key)) continue
    if (seen.has(key)) continue
    if (!/[A-Z]/.test(key) || !/[0-9]/.test(key)) continue // 영+숫자 혼합만
    seen.add(key)
    if (!tokens.has(key)) hits.push({ raw: tok, normalized: key })
  }

  return hits
}

export function isKnownSeriesName(name: string): boolean {
  if (!name) return false
  const { tokens } = loadOnce()
  return tokens.has(normalizeKey(name))
}
