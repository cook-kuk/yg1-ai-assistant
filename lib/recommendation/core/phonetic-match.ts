/**
 * Phonetic matching for Korean ↔ English brand/coating/series values.
 *
 * Goal: when a user types "엑스파워" we should match it to "X-POWER" without
 * a hardcoded alias map. This module romanizes Hangul via Unicode jamo
 * decomposition (RR-style approximate) and uses Levenshtein distance against
 * the canonical English value list.
 *
 * NO hardcoded brand/coating/series aliases — DB values are the source of
 * truth. The romanizer table only encodes the Hangul phoneme system itself
 * (which is fixed, not domain knowledge).
 */

// ── Hangul jamo tables (Revised Romanization, simplified) ──
// 19 leading consonants (초성)
// Note: ㄹ is "r" in RR but Korean transliteration of English uses it for "l"
// (알루 = "alu" not "aru"). We use "l" because the loose key compares against
// English brand spellings, not Korean orthography.
const INITIALS = [
  "g", "kk", "n", "d", "tt", "l", "m", "b", "pp", "s",
  "ss", "", "j", "jj", "ch", "k", "t", "p", "h",
]
// 21 medial vowels (중성)
const MEDIALS = [
  "a", "ae", "ya", "yae", "eo", "e", "yeo", "ye", "o", "wa",
  "wae", "oe", "yo", "u", "wo", "we", "wi", "yu", "eu", "ui", "i",
]
// 28 trailing consonants (종성, index 0 = none)
const FINALS = [
  "", "g", "kk", "ks", "n", "nj", "nh", "d", "l", "lg",
  "lm", "lb", "ls", "lt", "lp", "lh", "m", "b", "bs", "s",
  "ss", "ng", "j", "ch", "k", "t", "p", "h",
]

const HANGUL_BASE = 0xac00
const HANGUL_END = 0xd7a3

/**
 * Romanize Korean text approximately. Non-Hangul characters pass through
 * unchanged (after lowercasing). Punctuation and whitespace are stripped to
 * a single canonical form for comparison.
 */
export function romanizeHangul(text: string): string {
  let out = ""
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0
    if (code >= HANGUL_BASE && code <= HANGUL_END) {
      const idx = code - HANGUL_BASE
      const initial = Math.floor(idx / (21 * 28))
      const medial = Math.floor((idx % (21 * 28)) / 28)
      const final = idx % 28
      out += INITIALS[initial] + MEDIALS[medial] + FINALS[final]
    } else {
      out += ch.toLowerCase()
    }
  }
  // Normalize: drop punctuation/spaces so "X-POWER" and "엑스파워" canonicalize
  // to comparable forms.
  return out.replace(/[^a-z0-9]/g, "")
}

/**
 * Consonant-skeleton normalization shared by both Korean (romanized) and
 * English forms. Vowels in Korean transliteration of English brand names
 * are unreliable (Korean uses ㅡ as filler, ㅐ for English "a", different
 * vowel quality between 워/어/오), so we strip them entirely and compare
 * only the consonant skeleton with a few transliteration adjustments.
 *
 * Rules (applied in order):
 *   x → ks       (English X = Korean 엑스, two consonants in pronunciation)
 *   q → k        (English Q sounds like K)
 *   c → k        (Korean transliterates hard C as K)
 *   drop vowels  (aeiouy)
 *   ng → n       (Korean ㅇ final == English n in this context)
 *   collapse runs
 */
export function loosePhonetic(rawRomanized: string): string {
  let s = rawRomanized.toLowerCase().replace(/[^a-z0-9]/g, "")
  s = s.replace(/x/g, "ks")
  s = s.replace(/q/g, "k")
  s = s.replace(/c/g, "k")
  s = s.replace(/ng/g, "n") // 탱 → taeng → taen (must run BEFORE g→k)
  // Korean ㄱ/ㄷ/ㅂ romanize as g/d/b but in transliteration of English they
  // stand in for k/t/p sounds (엑스 = "egs" but English X = "ks"). Collapse
  // voiced/voiceless plosive pairs to the voiceless form so skeletons converge.
  s = s.replace(/g/g, "k")
  s = s.replace(/d/g, "t")
  s = s.replace(/b/g, "p")
  s = s.replace(/[aeiouy]/g, "")
  s = s.replace(/(.)\1+/g, "$1")
  return s
}

/** Convenience: romanize hangul + apply loose phonetic normalization. */
export function phoneticKey(text: string): string {
  return loosePhonetic(romanizeHangul(text))
}

/** Standard Levenshtein distance. */
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0
  if (a.length === 0) return b.length
  if (b.length === 0) return a.length
  const m = a.length
  const n = b.length
  const dp: number[] = new Array(n + 1)
  for (let j = 0; j <= n; j++) dp[j] = j
  for (let i = 1; i <= m; i++) {
    let prev = dp[0]
    dp[0] = i
    for (let j = 1; j <= n; j++) {
      const tmp = dp[j]
      dp[j] = a[i - 1] === b[j - 1]
        ? prev
        : 1 + Math.min(prev, dp[j], dp[j - 1])
      prev = tmp
    }
  }
  return dp[n]
}

export interface FuzzyMatch {
  value: string
  distance: number
  similarity: number
}

/**
 * Tokenize Korean text into candidate spans, romanize each, and find the
 * closest match against `values`. Returns null if no candidate clears the
 * similarity threshold.
 *
 * `values` are expected to be DB-canonical (English-ish), e.g.
 * ["X-POWER", "ALU-POWER", "TitaNox"]. Threshold defaults to 0.7 similarity
 * (1 - distance / max_length).
 */
export function findFuzzyMatch(
  text: string,
  values: string[],
  threshold = 0.7,
): FuzzyMatch | null {
  if (!text || values.length === 0) return null

  const normalizedValues = values.map(v => ({
    original: v,
    key: phoneticKey(v),
  }))

  const fullKey = phoneticKey(text)
  if (!fullKey) return null

  // Fast path: phonetic substring match
  for (const v of normalizedValues) {
    if (v.key && fullKey.includes(v.key)) {
      return { value: v.original, distance: 0, similarity: 1 }
    }
  }

  // Sliding window over phonetic key
  let best: FuzzyMatch | null = null
  for (const v of normalizedValues) {
    const target = v.key
    if (target.length < 2) continue
    const minLen = Math.max(2, target.length - 2)
    const maxLen = target.length + 3
    for (let len = minLen; len <= maxLen; len++) {
      for (let start = 0; start + len <= fullKey.length; start++) {
        const window = fullKey.slice(start, start + len)
        const dist = levenshtein(window, target)
        const maxLen2 = Math.max(window.length, target.length)
        const sim = maxLen2 === 0 ? 1 : 1 - dist / maxLen2
        if (sim >= threshold && (!best || sim > best.similarity)) {
          best = { value: v.original, distance: dist, similarity: sim }
        }
      }
    }
  }

  return best
}
