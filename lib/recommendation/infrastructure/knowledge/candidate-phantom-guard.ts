// Candidate-scoped phantom guard.
//
// On negation paths ("CRX S 빼고", "A 제외") the LLM has historically
// invented series/brand names that aren't in the returned candidate set,
// or recommended the very brand that was excluded. The global
// series-validator can't catch this because it only checks against the
// catalog-wide known set — it has no idea what the current request
// actually returned.
//
// This guard checks: every brand/series-like phrase mentioned in the
// response text must either appear in the current candidate snapshot
// OR appear only inside an exclusion phrase ("A는 빼드렸고", "A는 제외").
// Anything else is treated as phantom and the caller should rewrite.

import type { AppliedFilter, CandidateSnapshot } from "@/lib/types/exploration"

function normalizeKey(s: string): string {
  return s.toUpperCase().replace(/[\s\-./()_]+/g, "").replace(/[^A-Z0-9]/g, "")
}

// Matches multi-word series phrases ("3S MILL", "V7 PLUS", "CRX S") and
// alphanumeric single tokens ("XSEME60", "EMH77"). Korean characters
// around the phrase are fine — the lookaround only blocks ASCII bleed.
const SERIES_PHRASE_RE = /(?<![A-Za-z0-9])[A-Za-z][A-Za-z0-9.\-]*(?:\s+[A-Za-z0-9][A-Za-z0-9.\-]*)*(?![A-Za-z0-9])/g

// Tokens that look series-like but are generic terms / acronyms / materials.
const STOP_TOKENS = new Set([
  "YG", "YG1", "ISO", "ISOS", "ISOP", "ISOM", "ISOK", "ISON", "ISOH",
  "DIN", "AISI", "JIS", "ANSI", "EDP", "PVD", "CVD", "HSS", "HSK", "HPC",
  "HRC", "RPM", "CNC", "API", "DB", "AI", "PDF", "URL", "MM", "INCH",
  "SUS", "SUS304", "SUS316", "SUS316L", "SKD", "SKD11", "SKD61",
  "SCM440", "A6061", "A7075", "TI6AL4V", "INCONEL", "INCONEL718",
  "ALCRN", "TIALN", "TIAIN", "TICN", "TIN", "DLC", "ALTIN", "CRN", "ZRN",
  "YCOATING", "TCOATING",
  "BALL", "SQUARE", "RADIUS", "CORNER", "DRILL", "TAP", "MILL", "ENDMILL",
])

function looksLikeSeriesName(phrase: string): boolean {
  // Must contain an uppercase letter.
  if (!/[A-Z]/.test(phrase)) return false
  // Must be at least 2 chars after normalization.
  if (normalizeKey(phrase).length < 3) return false
  // Must be one of:
  //  - multi-word ("3S MILL", "V7 PLUS", "CRX S")
  //  - alphanumeric mix single token ("XSEME60", "CG3S60", "EMH77")
  const hasSpace = /\s/.test(phrase.trim())
  const hasLetter = /[A-Za-z]/.test(phrase)
  const hasDigit = /\d/.test(phrase)
  if (hasSpace) return true
  if (hasLetter && hasDigit) return true
  return false
}

// Returns true if `phrase` appears inside an exclusion clause — i.e. the
// text explicitly says it was removed. This lets the LLM legally mention
// the neq'd brand once for confirmation without being flagged.
function mentionedOnlyAsExclusion(text: string, phrase: string): boolean {
  const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  // Accept forms like "{phrase}는 빼드렸", "{phrase}는 제외", "{phrase}는 빼고",
  // "{phrase} 말고", "{phrase} 제외했", "{phrase}는 뺐", "{phrase}은 제외",
  // "{phrase} 아닌", "{phrase}가 아닌".
  const rx = new RegExp(
    `${escaped}(?:\\s*시리즈)?\\s*(?:는|은|을|를|이|가)?\\s*(?:시리즈\\s*)?(?:빼|제외|말고|뺐|빼고|제외했|빼드|아닌|아닙)`,
    "u",
  )
  return rx.test(text)
}

export interface CandidatePhantomResult {
  phantoms: string[]         // names mentioned but not in candidates and not exclusion-framed
  excludedMentioned: string[] // neq'd values mentioned even though they were excluded
}

export function findCandidateScopedPhantoms(
  text: string,
  candidates: CandidateSnapshot[],
  filters: AppliedFilter[],
): CandidatePhantomResult {
  const empty: CandidatePhantomResult = { phantoms: [], excludedMentioned: [] }
  if (!text) return empty

  const allowed = new Set<string>()
  for (const c of candidates.slice(0, 50)) {
    if (c.brand) allowed.add(normalizeKey(c.brand))
    if (c.seriesName) allowed.add(normalizeKey(c.seriesName))
  }

  const neqKeys = new Set<string>()
  const neqRawByKey = new Map<string, string>()
  for (const f of filters) {
    if (f.op !== "neq" && f.op !== "nin") continue
    const pushOne = (v: unknown) => {
      if (typeof v !== "string") return
      const k = normalizeKey(v)
      if (k.length < 2) return
      neqKeys.add(k)
      if (!neqRawByKey.has(k)) neqRawByKey.set(k, v)
    }
    if (Array.isArray(f.value)) f.value.forEach(pushOne)
    else pushOne(f.value)
    if (Array.isArray(f.rawValue)) f.rawValue.forEach(pushOne)
    else pushOne(f.rawValue)
  }

  const phantoms: string[] = []
  const excludedMentioned: string[] = []
  const seen = new Set<string>()

  const matches = text.match(SERIES_PHRASE_RE) ?? []
  for (const raw of matches) {
    const phrase = raw.trim()
    if (!looksLikeSeriesName(phrase)) continue
    const key = normalizeKey(phrase)
    if (STOP_TOKENS.has(key)) continue
    if (seen.has(key)) continue
    seen.add(key)

    // neq target — allowed only as an exclusion mention.
    if (neqKeys.has(key)) {
      const raw = neqRawByKey.get(key) ?? phrase
      if (!mentionedOnlyAsExclusion(text, raw)) {
        excludedMentioned.push(phrase)
      }
      continue
    }

    // In-candidate — OK. Also accept partial containment (e.g. "V7 PLUS HPC"
    // carries "V7 PLUS"; "3S MILL 시리즈" carries "3S MILL").
    if (allowed.has(key)) continue
    let partial = false
    for (const a of allowed) {
      if (a.length >= 4 && (key.includes(a) || a.includes(key))) {
        partial = true
        break
      }
    }
    if (partial) continue

    phantoms.push(phrase)
  }

  return { phantoms, excludedMentioned }
}

// Build a safe deterministic narrative for negation paths when the LLM
// polish output is rejected. Cites top-candidate series only by names
// actually present in the snapshot; makes no claims about material tags
// or mechanisms beyond what's already printed on the card.
export function buildNegationFallbackText(
  totalCandidateCount: number,
  candidates: CandidateSnapshot[],
  excludedRaw: string | null,
): string {
  const topSeries: string[] = []
  const seen = new Set<string>()
  for (const c of candidates.slice(0, 10)) {
    const name = c.seriesName ?? c.brand ?? null
    if (!name) continue
    const key = name.toUpperCase().trim()
    if (seen.has(key)) continue
    seen.add(key)
    topSeries.push(name)
    if (topSeries.length >= 2) break
  }

  const excludedLabel = excludedRaw ? excludedRaw : "해당 시리즈"
  const prefix = `${excludedLabel}는 제외했습니다. 남은 후보가 ${totalCandidateCount}개입니다.`
  if (topSeries.length === 0) {
    return `${prefix} 더 좁히고 싶으시면 소재나 직경 같은 조건을 알려주세요.`
  }
  const listed = topSeries.join(", ")
  return `${prefix} 상위에 ${listed} 시리즈가 올라와 있습니다. 더 좁히고 싶으시면 소재나 직경 같은 조건을 알려주세요.`
}
