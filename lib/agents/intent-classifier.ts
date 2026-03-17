/**
 * Intent Classifier Agent — Haiku
 *
 * Classifies each user message into a narrowing-specific intent.
 * Uses deterministic patterns first, falls back to Haiku LLM for ambiguous cases.
 */

import type { LLMProvider } from "@/lib/llm/provider"
import type { ExplorationSessionState } from "@/lib/types/exploration"
import type { NarrowingIntent, IntentClassification } from "./types"
import { resolveUndoTarget } from "@/lib/domain/request-preparation"

// ── Deterministic Patterns (fast path, no LLM) ──────────────

const RESET_PATTERNS = ["처음부터 다시", "다시 시작", "리셋", "처음부터"]
const RECOMMEND_PATTERNS = ["추천해주세요", "바로 보여주세요", "결과 보기", "추천 받기", "추가 조건 없음", "그냥 줘", "빨리", "알아서", "그냥"]
const COMPARE_PATTERNS = [/비교/, /차이/, /(\d+)번.*(\d+)번/, /상위.*비교/, /위.*비교/, /이\s*중/]
const EXPLAIN_PATTERNS = [/그게\s*뭐/, /그건\s*뭐/, /이게\s*뭐/, /뭐야/, /차이.*뭐/, /뭐가\s*다/, /설명/, /왜\s*이/, /이유/]
const META_QUESTION_PATTERNS = [
  /아니야\s*\?*$/, /아닌가\s*\?*$/, /않아\s*\?*$/, /잖아/,
  /해야\s*(하|되)/, /맞아\s*\?*$/, /맞지\s*\?*$/, /아닌데/,
  /이상하/, /왜.*그/, /왜.*이렇/, /어떻게.*된/, /뭐가.*잘못/,
  /내에서/, /중에서/, /안에서/,
]
const SKIP_PATTERNS = ["상관없음", "모름", "패스", "넘어", "넘겨", "스킵", "아무거나"]
const NONSENSE_PATTERNS = [/^[ㅋㅎㅠㅜ]+$/, /^[?!.]+$/, /^\s*$/]

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
    return { intent: "OUT_OF_SCOPE", confidence: 0.95, modelUsed: "haiku" }
  }

  // ── 2. Reset (highest priority navigation) ──
  if (RESET_PATTERNS.some(p => clean.includes(p))) {
    return { intent: "RESET_SESSION", confidence: 0.98, modelUsed: "haiku" }
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
          modelUsed: "haiku",
        }
      }
      return { intent: "GO_BACK_ONE_STEP", confidence: 0.95, modelUsed: "haiku" }
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
        modelUsed: "haiku",
      }
    }
  }

  // ── 5. Explanation requests ──
  if (EXPLAIN_PATTERNS.some(p => p.test(clean))) {
    return { intent: "ASK_EXPLANATION", confidence: 0.85, modelUsed: "haiku" }
  }

  // ── 6. Immediate recommendation ──
  if (RECOMMEND_PATTERNS.some(p => clean.includes(p))) {
    return { intent: "ASK_RECOMMENDATION", confidence: 0.9, modelUsed: "haiku" }
  }

  // ── 7. Skip/Don't care ──
  if (SKIP_PATTERNS.some(p => clean.includes(p))) {
    return { intent: "SELECT_OPTION", confidence: 0.9, extractedValue: "상관없음", modelUsed: "haiku" }
  }

  // ── 7.5. Meta-questions about the process (NOT parameters) ──
  if (META_QUESTION_PATTERNS.some(p => p.test(clean))) {
    return { intent: "ASK_EXPLANATION", confidence: 0.85, modelUsed: "haiku" }
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
        modelUsed: "haiku",
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

  // ── 10. Final fallback ──
  if (sessionState && !sessionState.resolutionStatus?.startsWith("resolved")) {
    return { intent: "SET_PARAMETER", confidence: 0.5, extractedValue: clean, modelUsed: "haiku" }
  }
  return { intent: "OUT_OF_SCOPE", confidence: 0.3, modelUsed: "haiku" }
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
    200,
    "haiku"
  )

  try {
    const parsed = JSON.parse(raw.trim().replace(/```json\n?|\n?```/g, ""))
    return {
      intent: parsed.intent as NarrowingIntent,
      confidence: parsed.confidence ?? 0.7,
      extractedValue: parsed.extractedValue ?? undefined,
      reasoning: `Haiku: ${parsed.intent}`,
      modelUsed: "haiku",
    }
  } catch {
    return { intent: "SET_PARAMETER", confidence: 0.4, modelUsed: "haiku" }
  }
}

// ── Helpers ──────────────────────────────────────────────────

function extractComparisonTargets(clean: string): string[] {
  const targets: string[] = []
  // "1번이랑 2번" / "1번 2번"
  const numMatch = clean.matchAll(/(\d+)\s*번/g)
  for (const m of numMatch) targets.push(`${m[1]}번`)
  // "상위 3개"
  const topMatch = clean.match(/상위\s*(\d+)/)
  if (topMatch) targets.push(`상위${topMatch[1]}`)
  return targets
}

function tryDeterministicExtraction(clean: string): string | null {
  // Flute count
  const fluteMatch = clean.match(/^(\d+)\s*날/)
  if (fluteMatch) return `${fluteMatch[1]}날`

  // Diameter
  const diamMatch = clean.match(/^([\d.]+)\s*mm/)
  if (diamMatch) return `${diamMatch[1]}mm`

  // Known coating keywords
  const coatings = ["altin", "tialn", "dlc", "무코팅", "y-코팅", "ticn"]
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
