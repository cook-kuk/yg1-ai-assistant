/**
 * Intent Classifier Agent — Haiku
 *
 * Classifies each user message into a narrowing-specific intent.
 * Uses deterministic patterns first, falls back to Haiku LLM for ambiguous cases.
 */

import { resolveModel, type LLMProvider } from "@/lib/recommendation/infrastructure/llm/recommendation-llm"
import type { ExplorationSessionState } from "@/lib/recommendation/domain/types"
import type { NarrowingIntent, IntentClassification } from "./types"
import { resolveUndoTarget } from "@/lib/recommendation/domain/request-preparation"
import {
  RESET_KEYWORDS,
  RECOMMEND_PATTERNS as SHARED_RECOMMEND_PATTERNS,
  COMPARE_PATTERNS as SHARED_COMPARE_PATTERNS,
  NONSENSE_PATTERNS as SHARED_NONSENSE_PATTERNS,
  isSkipToken,
} from "@/lib/recommendation/shared/patterns"

const INTENT_CLASSIFIER_MODEL = resolveModel("opus", "intent-classifier")

// ── Deterministic Patterns (fast path, no LLM) ──────────────
// 공유 패턴은 shared/patterns.ts에서 import

const RESET_EXACT = RESET_KEYWORDS
const RECOMMEND_PATTERNS = SHARED_RECOMMEND_PATTERNS
const COMPARE_PATTERNS = SHARED_COMPARE_PATTERNS
const EXPLAIN_PATTERNS = [/그게\s*뭐/, /그건\s*뭐/, /이게\s*뭐/, /뭐야/, /차이.*뭐/, /뭐가\s*다/, /설명/, /왜\s*이/, /이유/]
const META_QUESTION_PATTERNS = [
  /아니야\s*\?*$/, /아닌가\s*\?*$/, /않아\s*\?*$/, /잖아/,
  /해야\s*(하|되)/, /맞아\s*\?*$/, /맞지\s*\?*$/, /아닌데/,
  /이상하/, /왜.*그/, /왜.*이렇/, /어떻게.*된/, /뭐가.*잘못/,
  /내에서/, /중에서/, /안에서/,
]
const REFINEMENT_PATTERNS = [
  /피삭재.*(바꿔|변경|바꾸|다시)|소재.*(바꿔|변경|바꾸|다시|싶)/,
  /재질.*(바꿔|변경|바꾸|다시|싶)/,
  /직경.*(바꿔|변경|바꾸)|다른\s*직경/,
  /코팅.*(바꿔|변경|바꾸|싶)|다른\s*코팅/,
  /날수.*(바꿔|변경)|날.*(변경|바꿔)|다른\s*날/,
  /조건.*(바꿔|변경).*(검색|추천|싶)/,
  /다른\s*소재|다른\s*재질/,
  /스테인.*궁금|스테인.*추천|스테인.*바꿔/,
  /(스테인|알루미늄|탄소강|주철|티타늄|고경도).*(로|으로)\s*(다시|추천|검색|볼래|보고)/,
  /다시.*(추천|검색|볼래|보고).*싶/,
]
const SKIP_PATTERNS_LOCAL: string[] = [] // skip 판단은 isSkipToken()으로 통합
const NONSENSE_PATTERNS = SHARED_NONSENSE_PATTERNS

/**
 * Classify user intent — deterministic first, Haiku fallback for ambiguity.
 */
export async function classifyIntent(
  message: string,
  sessionState: ExplorationSessionState | null,
  provider: LLMProvider
): Promise<IntentClassification> {
  const clean = message.trim().toLowerCase()
  const startMs = Date.now()

  // ── 1. Nonsense ──
  if (!clean || NONSENSE_PATTERNS.some(p => p.test(clean))) {
    return { intent: "OUT_OF_SCOPE", confidence: 0.95, modelUsed: INTENT_CLASSIFIER_MODEL }
  }

  // ── 2. Reset (highest priority navigation) ──
  // Only match if the message IS a reset command, not a quote/meta-question containing one
  if (isExplicitResetIntent(clean)) {
    return { intent: "RESET_SESSION", confidence: 0.98, modelUsed: INTENT_CLASSIFIER_MODEL }
  }

  // ── 3. Undo / Back navigation (must be before general patterns) ──
  if (sessionState) {
    const undoResult = resolveUndoTarget(message, sessionState)
    if (undoResult) {
      if (undoResult.type === "to_filter") {
        return {
          intent: "GO_BACK_TO_SPECIFIC_STAGE",
          confidence: 0.95,
          extractedValue: undoResult.target.filterValue ?? undoResult.target.filterField,
          modelUsed: INTENT_CLASSIFIER_MODEL,
        }
      }
      return { intent: "GO_BACK_ONE_STEP", confidence: 0.95, modelUsed: INTENT_CLASSIFIER_MODEL }
    }
  }

  // ── 3.4. QUESTION ASSIST MODE — field-bound skip/delegate ──
  // If there is a pending question (lastAskedField), intercept skip/delegate/don't-care
  // DETERMINISTICALLY before the LLM gets involved.
  // This prevents the "no active question" bug after explanation turns.
  if (sessionState?.lastAskedField && !sessionState.resolutionStatus?.startsWith("resolved")) {
    const pendingField = sessionState.lastAskedField

    // Skip / don't care → SELECT_OPTION with "상관없음" (field-bound)
    if (isSkipToken(clean)) {
      return {
        intent: "SELECT_OPTION",
        confidence: 0.95,
        extractedValue: "상관없음",
        reasoning: `Question-assist: skip ${pendingField} (pending field)`,
        modelUsed: INTENT_CLASSIFIER_MODEL,
      }
    }

    // Delegation → SELECT_OPTION with "skip" (system chooses for this field)
    const DELEGATE_CLEAN = [/추천.*골라/, /알아서/, /골라.*줘/, /네가.*골라/, /니가.*골라/, /무난한.*걸로/, /네가.*정해/, /니가.*정해/, /시스템.*추천/]
    if (DELEGATE_CLEAN.some(p => p.test(clean))) {
      return {
        intent: "SELECT_OPTION",
        confidence: 0.92,
        extractedValue: "상관없음",
        reasoning: `Question-assist: delegate ${pendingField} (pending field)`,
        modelUsed: INTENT_CLASSIFIER_MODEL,
      }
    }

    // Novice / confusion signals → ASK_EXPLANATION (but question stays alive)
    // This is already handled downstream — just ensure it doesn't fall to general chat
    const NOVICE_PATTERNS = [/신입/, /처음/, /초보/, /입문/, /뉴비/, /하나도.*몰라/, /잘.*몰라/]
    if (NOVICE_PATTERNS.some(p => p.test(clean)) && clean.length < 40) {
      return { intent: "ASK_EXPLANATION", confidence: 0.9, extractedValue: pendingField, modelUsed: INTENT_CLASSIFIER_MODEL }
    }
  }

  // ── 3.5. CHIP TEXT MATCHING (safety net for when tool-use fails) ──
  if (sessionState) {
    const chipClean = clean.replace(/\s*\(\d+개\)\s*$/, "").replace(/\s*—\s*.+$/, "").trim()
    const metaChips = ["상관없음", "⟵ 이전 단계", "처음부터 다시", "추천해주세요", "추천 이어서", "비교해줘", "절삭조건 문의"]
    if (!metaChips.includes(chipClean)) {
      if (sessionState.displayedOptions?.length > 0) {
        for (const opt of sessionState.displayedOptions) {
          const optVal = opt.value.toLowerCase()
          const optLabel = opt.label.toLowerCase().replace(/\s*\(\d+개\)\s*$/, "").replace(/\s*—\s*.+$/, "").trim()
          if (chipClean === optVal || chipClean === optLabel || clean.startsWith(optVal) || clean.startsWith(optLabel)) {
            return { intent: "SELECT_OPTION", confidence: 0.98, extractedValue: opt.value, reasoning: `Chip match: ${opt.label}`, modelUsed: INTENT_CLASSIFIER_MODEL }
          }
        }
      }
      if (sessionState.displayedChips?.length > 0) {
        for (const chip of sessionState.displayedChips) {
          if (metaChips.includes(chip)) continue
          const cv = chip.toLowerCase().replace(/\s*\(\d+개\)\s*$/, "").replace(/\s*—\s*.+$/, "").trim()
          if (chipClean === cv || clean === chip.toLowerCase()) {
            return { intent: "SELECT_OPTION", confidence: 0.95, extractedValue: chip.replace(/\s*\(\d+개\)\s*$/, "").replace(/\s*—\s*.+$/, "").trim(), modelUsed: INTENT_CLASSIFIER_MODEL }
          }
        }
      }
    }
  }

  // ── 3.6. Refinement (post-recommendation condition change) ──
  if (sessionState?.resolutionStatus?.startsWith("resolved")) {
    if (REFINEMENT_PATTERNS.some(p => p.test(clean))) {
      // Detect which field to refine
      const field = detectRefinementField(clean)
      return { intent: "REFINE_CONDITION", confidence: 0.92, extractedValue: field, modelUsed: INTENT_CLASSIFIER_MODEL }
    }
  }

  // ── 4. Comparison requests ──
  for (const p of COMPARE_PATTERNS) {
    if (p instanceof RegExp ? p.test(clean) : clean.includes(p)) {
      const targets = extractComparisonTargets(clean)
      return {
        intent: "ASK_COMPARISON",
        confidence: 0.9,
        extractedValue: targets.join(","),
        modelUsed: INTENT_CLASSIFIER_MODEL,
      }
    }
  }

  // ── 5. Explanation requests ──
  if (EXPLAIN_PATTERNS.some(p => p.test(clean))) {
    return { intent: "ASK_EXPLANATION", confidence: 0.85, modelUsed: INTENT_CLASSIFIER_MODEL }
  }

  // ── 6. Immediate recommendation ──
  if (RECOMMEND_PATTERNS.some(p => clean.includes(p))) {
    return { intent: "ASK_RECOMMENDATION", confidence: 0.9, modelUsed: INTENT_CLASSIFIER_MODEL }
  }

  // ── 7. Skip/Don't care ──
  if (isSkipToken(clean)) {
    return { intent: "SELECT_OPTION", confidence: 0.9, extractedValue: "상관없음", modelUsed: INTENT_CLASSIFIER_MODEL }
  }

  // ── 7.5. Numbered option selection ("2번", "2번으로", "두번째로") ──
  if (sessionState) {
    const optionIndex = parseNumberedOption(clean)
    if (optionIndex !== null && sessionState.displayedOptions?.length > 0) {
      const option = sessionState.displayedOptions.find(o => o.index === optionIndex)
      if (option) {
        return {
          intent: "SELECT_OPTION",
          confidence: 0.95,
          extractedValue: option.value,
          reasoning: `Numbered option #${optionIndex}: ${option.label}`,
          modelUsed: INTENT_CLASSIFIER_MODEL,
        }
      }
    }
  }

  // ── 7.6. Meta-questions about the process (NOT parameters) ──
  if (META_QUESTION_PATTERNS.some(p => p.test(clean))) {
    return { intent: "ASK_EXPLANATION", confidence: 0.85, modelUsed: INTENT_CLASSIFIER_MODEL }
  }

  // ── 8. In active narrowing session: likely a parameter/option ──
  if (sessionState && !sessionState.resolutionStatus?.startsWith("resolved")) {
    // Check if message matches a known option pattern
    const paramResult = tryDeterministicExtraction(clean)
    if (paramResult) {
      return {
        intent: "SELECT_OPTION",
        confidence: 0.85,
        extractedValue: paramResult,
        modelUsed: INTENT_CLASSIFIER_MODEL,
      }
    }
  }

  // ── 9. Ambiguous: use Haiku LLM ──
  if (provider.available()) {
    try {
      return await classifyWithHaiku(message, sessionState, provider)
    } catch (e) {
      console.warn("[intent-classifier] Haiku fallback failed:", e)
    }
  }

  // ── 10. Final fallback — prefer staying in session when context exists ──
  if (sessionState) {
    // If there's a pending question, treat unclassified input as an answer attempt
    if (sessionState.lastAskedField && !sessionState.resolutionStatus?.startsWith("resolved")) {
      return { intent: "SELECT_OPTION", confidence: 0.45, extractedValue: clean, reasoning: "fallback: pending field answer attempt", modelUsed: INTENT_CLASSIFIER_MODEL }
    }
    // After resolution or with displayed products, keep in-session as explanation
    if (sessionState.resolutionStatus?.startsWith("resolved") || (sessionState.displayedCandidates?.length ?? 0) > 0) {
      return { intent: "ASK_EXPLANATION", confidence: 0.45, extractedValue: clean, modelUsed: INTENT_CLASSIFIER_MODEL }
    }
    return { intent: "START_NEW_TOPIC", confidence: 0.4, extractedValue: clean, modelUsed: INTENT_CLASSIFIER_MODEL }
  }
  return { intent: "OUT_OF_SCOPE", confidence: 0.3, modelUsed: INTENT_CLASSIFIER_MODEL }
}

// ── Haiku LLM Classification ─────────────────────────────────

async function classifyWithHaiku(
  message: string,
  sessionState: ExplorationSessionState | null,
  provider: LLMProvider
): Promise<IntentClassification> {
  const sessionSummary = sessionState
    ? `현재 세션: 후보 ${sessionState.candidateCount}개, 필터 [${sessionState.appliedFilters.map(f => `${f.field}=${f.value}`).join(", ")}], 상태: ${sessionState.resolutionStatus}`
    : "세션 없음"

  const systemPrompt = `You are an intent classifier for an industrial cutting tool recommendation system.
Classify the user's message into exactly one intent. Respond with JSON only.

Active session context: ${sessionSummary}

Intents:
- SET_PARAMETER: user provides a specific value (diameter, material, etc.)
- SELECT_OPTION: user picks from presented options (e.g., "4날", "Square", "AlTiN")
- ASK_RECOMMENDATION: user wants to see results now
- ASK_COMPARISON: user wants to compare products
- ASK_REASON: user asks why something was recommended
- ASK_EXPLANATION: user asks about a concept or term
- GO_BACK_ONE_STEP: user wants to go back one step
- GO_BACK_TO_SPECIFIC_STAGE: user wants to go back to a specific stage
- RESET_SESSION: user wants to restart
- START_NEW_TOPIC: unrelated topic change
- OUT_OF_SCOPE: nonsense or off-domain

Respond: {"intent":"...", "confidence": 0.0-1.0, "extractedValue": "..." or null}`

  const raw = await provider.complete(
    systemPrompt,
    [{ role: "user", content: message }],
    1500,
    INTENT_CLASSIFIER_MODEL,
    "intent-classifier"
  )

  try {
    const parsed = JSON.parse(raw.trim().replace(/```json\n?|\n?```/g, ""))
    return {
      intent: parsed.intent as NarrowingIntent,
      confidence: parsed.confidence ?? 0.7,
      extractedValue: parsed.extractedValue ?? undefined,
      reasoning: `Haiku: ${parsed.intent}`,
      modelUsed: INTENT_CLASSIFIER_MODEL,
    }
  } catch {
    return { intent: "SET_PARAMETER", confidence: 0.4, modelUsed: INTENT_CLASSIFIER_MODEL }
  }
}

// ── Helpers ──────────────────────────────────────────────────

/** Parse "2번", "2번으로", "두번째", "두번째로 가자" etc. */
function parseNumberedOption(clean: string): number | null {
  // "N번" pattern
  const numMatch = clean.match(/^(\d+)\s*번/)
  if (numMatch) return parseInt(numMatch[1])
  // "N번으로" / "N번 선택"
  const numActionMatch = clean.match(/(\d+)\s*번\s*(으로|선택|으로\s*(가|줄여|나가|좁혀))/)
  if (numActionMatch) return parseInt(numActionMatch[1])
  // Korean: "두번째로", "세번째"
  const korMatch = clean.match(/(한|두|세|네|다섯|여섯)\s*번째/)
  if (korMatch) {
    const map: Record<string, number> = { "한": 1, "두": 2, "세": 3, "네": 4, "다섯": 5, "여섯": 6 }
    return map[korMatch[1]] ?? null
  }
  return null
}

const KOREAN_NUMBERS: Record<string, number> = {
  "한": 1, "하나": 1, "두": 2, "둘": 2, "세": 3, "셋": 3,
  "네": 4, "넷": 4, "다섯": 5, "여섯": 6, "일곱": 7, "여덟": 8,
}

function parseKoreanNumber(s: string): number | null {
  const digit = parseInt(s)
  if (!isNaN(digit)) return digit
  return KOREAN_NUMBERS[s] ?? null
}

function extractComparisonTargets(clean: string): string[] {
  const targets: string[] = []
  // "1번이랑 2번" / "1번 2번"
  const numMatch = clean.matchAll(/(\d+)\s*번/g)
  for (const m of numMatch) targets.push(`${m[1]}번`)
  // "상위 3개" / "상위 두개" / "상위 세개"
  const topMatch = clean.match(/상위\s*(\d+|한|하나|두|둘|세|셋|네|넷|다섯)\s*개?/)
  if (topMatch) {
    const n = parseKoreanNumber(topMatch[1])
    if (n) targets.push(`상위${n}`)
  }
  // "위에 2개" / "위 두개"
  const aboveMatch = clean.match(/위[에]?\s*(\d+|두|세|네)\s*개/)
  if (aboveMatch && targets.length === 0) {
    const n = parseKoreanNumber(aboveMatch[1])
    if (n) targets.push(`상위${n}`)
  }
  return targets
}

function detectRefinementField(clean: string): string {
  if (/피삭재|소재|재질|재료|스테인/.test(clean)) return "material"
  if (/직경|지름/.test(clean)) return "diameter"
  if (/코팅/.test(clean)) return "coating"
  if (/날수|날\s*변경/.test(clean)) return "fluteCount"
  return "material" // default: most common refinement
}

/**
 * Returns true only when the message is an explicit, standalone reset command.
 * Rejects meta-questions, quotes, pasted text, or long sentences that happen to contain reset words.
 */
export function isExplicitResetIntent(clean: string): boolean {
  // Must contain a reset keyword
  if (!RESET_EXACT.some(p => clean.includes(p))) return false
  // Short, direct command → reset
  if (RESET_EXACT.includes(clean)) return true
  // Too long to be a genuine reset command (likely a quote or meta-question)
  if (clean.length > 25) return false
  // Contains question markers or meta-question patterns → not a reset
  if (/\?|아니야|아닌가|잖아|않아|맞아|맞지|해야|나와야|보기로|어떻게|왜/.test(clean)) return false
  // Contains emoticons expressing frustration → not a reset, likely clarification
  if (/ㅠ|ㅜ/.test(clean)) return false
  // Contains meta-commentary markers → not a reset
  if (/기반으로|만들어|보여|줘야|내놔|라고|라는|이걸|이거|이것|위에|아까/.test(clean)) return false
  return true
}

function tryDeterministicExtraction(clean: string): string | null {
  // Flute count
  const fluteMatch = clean.match(/^(\d+)\s*날/)
  if (fluteMatch) return `${fluteMatch[1]}날`

  // Diameter
  const diamMatch = clean.match(/^([\d.]+)\s*mm/)
  if (diamMatch) return `${diamMatch[1]}mm`

  // Known coating keywords
  const coatings = ["altin", "tialn", "dlc", "무코팅", "y-코팅", "ticn", "bright finish", "diamond", "x-coating", "t-coating", "uncoated", "alcrn"]
  for (const c of coatings) {
    if (clean.includes(c)) return c
  }

  // Known subtypes
  const subtypes = ["square", "ball", "radius", "스퀘어", "볼", "라디우스", "하이피드"]
  for (const s of subtypes) {
    if (clean.includes(s)) return s
  }

  // Series code pattern
  const seriesMatch = clean.match(/^(ce\d+[a-z]*\d*|gnx\d+|sem[a-z]*\d+)/i)
  if (seriesMatch) return seriesMatch[1]

  return null
}
