/**
 * Intent Classifier Agent — Haiku
 *
 * Classifies each user message into a narrowing-specific intent.
 * Uses deterministic patterns first, falls back to Haiku LLM for ambiguous cases.
 */

import { resolveModel, type LLMProvider } from "@/lib/llm/provider"
import type { ExplorationSessionState } from "@/lib/types/exploration"
import type { NarrowingIntent, IntentClassification } from "./types"
import { resolveUndoTarget } from "@/lib/domain/request-preparation"
import {
  RESET_KEYWORDS,
  NONSENSE_PATTERNS as SHARED_NONSENSE_PATTERNS,
  isSkipToken,
} from "@/lib/recommendation/shared/patterns"
import { LLM_FREE_INTERPRETATION } from "@/lib/feature-flags"

const INTENT_CLASSIFIER_MODEL = resolveModel("opus", "intent-classifier")

// ── Deterministic Patterns (fast path, no LLM) ──────────────
// 공유 패턴은 shared/patterns.ts에서 import

const RESET_PATTERNS = RESET_KEYWORDS
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

  // ── 0. LLM Free Interpretation — deterministic 스킵, LLM 직행 ──
  if (LLM_FREE_INTERPRETATION) {
    // 빈 메시지와 리셋만 deterministic으로 처리 (안전)
    if (!clean || NONSENSE_PATTERNS.some(p => p.test(clean))) {
      return { intent: "OUT_OF_SCOPE", confidence: 0.95, modelUsed: INTENT_CLASSIFIER_MODEL }
    }
    if (RESET_PATTERNS.some(p => clean.includes(p))) {
      return { intent: "RESET_SESSION", confidence: 0.98, modelUsed: INTENT_CLASSIFIER_MODEL }
    }
    // 칩 매칭은 유지 (UI 클릭은 deterministic이 정확)
    if (sessionState) {
      const chipClean = clean.replace(/\s*\(\d+개\)\s*$/, "").replace(/\s*—\s*.+$/, "").trim()
      const metaChips = ["상관없음", "⟵ 이전 단계", "처음부터 다시", "추천해주세요", "추천 이어서", "비교해줘", "절삭조건 문의"]
      if (!metaChips.includes(chipClean) && sessionState.displayedOptions?.length > 0) {
        for (const opt of sessionState.displayedOptions) {
          const optVal = opt.value.toLowerCase()
          const optLabel = opt.label.toLowerCase().replace(/\s*\(\d+개\)\s*$/, "").replace(/\s*—\s*.+$/, "").trim()
          if (chipClean === optVal || chipClean === optLabel || clean.startsWith(optVal) || clean.startsWith(optLabel)) {
            return { intent: "SELECT_OPTION", confidence: 0.98, extractedValue: opt.value, reasoning: `Chip match: ${opt.label}`, modelUsed: INTENT_CLASSIFIER_MODEL }
          }
        }
      }
    }
    // 나머지 전부 LLM에 위임
    if (provider.available()) {
      try {
        return await classifyWithHaiku(message, sessionState, provider)
      } catch (e) {
        console.warn("[intent-classifier] LLM-free-interpretation fallback failed:", e)
      }
    }
    // LLM 실패 시 fallthrough to deterministic below
  }

  // ── 1. Nonsense ──
  if (!clean || NONSENSE_PATTERNS.some(p => p.test(clean))) {
    return { intent: "OUT_OF_SCOPE", confidence: 0.95, modelUsed: INTENT_CLASSIFIER_MODEL }
  }

  // ── 2. Reset (highest priority navigation) ──
  if (RESET_PATTERNS.some(p => clean.includes(p))) {
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

  // ── 4. Skip tokens (deterministic — clear user intent) ──
  if (isSkipToken(clean)) {
    return { intent: "SELECT_OPTION", confidence: 0.95, extractedValue: "상관없음", modelUsed: INTENT_CLASSIFIER_MODEL }
  }

  // ── 5. Numbered option matching (e.g., "1번", "2번") ──
  if (sessionState?.displayedOptions?.length) {
    const numMatch = clean.match(/^(\d+)\s*번?$/)
    if (numMatch) {
      const idx = parseInt(numMatch[1], 10)
      const opt = sessionState.displayedOptions.find(o => o.index === idx)
      if (opt) {
        return { intent: "SELECT_OPTION", confidence: 0.95, extractedValue: opt.value, reasoning: `Numbered option: ${idx}번 → ${opt.label}`, modelUsed: INTENT_CLASSIFIER_MODEL }
      }
    }
  }

  // ── 6~8: Removed — LLM handles intent classification ──

  // ── 9. Ambiguous: use Haiku LLM ──
  if (provider.available()) {
    try {
      return await classifyWithHaiku(message, sessionState, provider)
    } catch (e) {
      console.warn("[intent-classifier] Haiku fallback failed:", e)
    }
  }

  // ── 10. Final fallback ──
  if (sessionState) {
    // In any active session (narrowing OR resolved), route to general answer
    // This prevents "dead" responses after comparison or recommendation
    return { intent: "START_NEW_TOPIC", confidence: 0.5, extractedValue: clean, modelUsed: INTENT_CLASSIFIER_MODEL }
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

