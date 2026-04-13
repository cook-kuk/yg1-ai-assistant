import { normalizeIdentifierLookupKey } from "@/lib/recommendation/shared/canonical-values"
import { getKnownEntityValues } from "@/lib/recommendation/shared/entity-registry"

interface KnownSeriesCache {
  display: Map<string, string>
  tokens: Set<string>
}

const STOP_TOKENS = new Set([
  "YG", "YG-1", "YG1", "ISO", "ISO-S", "ISO-P", "ISO-M", "ISO-K", "ISO-N", "ISO-H",
  "DB", "AI", "API", "DIN", "AISI", "JIS", "ANSI", "EDP", "PVD", "CVD",
  "HSS", "HRC", "HSK", "BT", "CT", "CNC", "HPC", "DPI", "RPM",
  "PDF", "URL", "OK", "USA", "EU", "KR", "JP", "CN",
  "I.D.", "O.D.", "MM", "INCH",
  "P", "M", "K", "N", "S", "H",
])

const MATERIAL_GRADE_PATTERNS = [
  /^SUS\d{3,4}[A-Z]*$/,
  /^SKD\d+[A-Z]*$/,
  /^SKH\d+[A-Z]*$/,
  /^SCM\d+[A-Z]*$/,
  /^SM\d+[A-Z]*$/,
  /^S\d{2,4}C$/,
  /^A\d{4}$/,
  /^TI\d+AL\d+V?\d*$/,
  /^INCONEL\d+$/,
  /^FCD?\d+$/,
  /^HRC\d+$/,
]

const SERIES_TOKEN = /(?<![A-Z0-9])[A-Z][A-Z0-9](?:[A-Z0-9.\-]*[A-Z0-9])?(?![A-Z0-9])/g
const SERIES_PHRASE = /(?<![A-Z0-9])[A-Z0-9][A-Z0-9.\-]*(?:\s+[A-Z0-9][A-Z0-9.\-]+)+(?![A-Z0-9])/g

let knownSeriesCache: KnownSeriesCache | null = null

function isMaterialGradeToken(key: string): boolean {
  return MATERIAL_GRADE_PATTERNS.some(pattern => pattern.test(key))
}

function addKnownValue(tokens: Set<string>, display: Map<string, string>, rawValue: string): void {
  const value = String(rawValue ?? "").trim()
  if (!value) return

  const normalized = normalizeIdentifierLookupKey(value)
  if (normalized.length >= 2) {
    tokens.add(normalized)
    if (!display.has(normalized)) display.set(normalized, value)
  }

  for (const part of value.split(/[\/+,;]/)) {
    const trimmed = part.trim()
    const key = normalizeIdentifierLookupKey(trimmed)
    if (key.length < 3 || STOP_TOKENS.has(key) || isMaterialGradeToken(key)) continue
    tokens.add(key)
    if (!display.has(key)) display.set(key, trimmed)
  }
}

function loadOnce(): KnownSeriesCache {
  if (knownSeriesCache) return knownSeriesCache

  const tokens = new Set<string>()
  const display = new Map<string, string>()

  for (const series of getKnownEntityValues("series")) {
    addKnownValue(tokens, display, series)
  }

  knownSeriesCache = { tokens, display }
  return knownSeriesCache
}

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

  for (const phrase of text.match(SERIES_PHRASE) ?? []) {
    const trimmed = phrase.trim()
    if (!/\s/.test(trimmed)) continue

    const key = normalizeIdentifierLookupKey(trimmed)
    if (key.length < 4 || STOP_TOKENS.has(key) || isMaterialGradeToken(key) || seen.has(key)) continue

    seen.add(key)
    if (tokens.has(key)) continue

    let partialOk = false
    for (const part of trimmed.split(/\s+/)) {
      const partKey = normalizeIdentifierLookupKey(part)
      if (partKey.length >= 3 && tokens.has(partKey)) {
        partialOk = true
        break
      }
    }

    if (!partialOk) {
      hits.push({ raw: trimmed, normalized: key })
    }
  }

  for (const token of text.match(SERIES_TOKEN) ?? []) {
    const key = normalizeIdentifierLookupKey(token)
    if (key.length < 4 || STOP_TOKENS.has(key) || isMaterialGradeToken(key) || seen.has(key)) continue
    if (!/[A-Z]/.test(key) || !/[0-9]/.test(key)) continue

    seen.add(key)
    if (tokens.has(key)) continue

    let prefixOk = false
    for (let length = key.length - 1; length >= 4; length -= 1) {
      if (tokens.has(key.slice(0, length))) {
        prefixOk = true
        break
      }
    }

    if (!prefixOk) {
      hits.push({ raw: token, normalized: key })
    }
  }

  return hits
}

export function isKnownSeriesName(name: string): boolean {
  if (!name) return false
  return loadOnce().tokens.has(normalizeIdentifierLookupKey(name))
}
