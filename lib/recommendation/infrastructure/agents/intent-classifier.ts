/**
 * Intent Classifier Agent
 *
 * Classifies each user message into a narrowing-specific intent.
 * Uses deterministic patterns first, then the configured primary model for ambiguous cases.
 */

import { resolveModel, type LLMProvider } from "@/lib/recommendation/infrastructure/llm/recommendation-llm"
import type { ExplorationSessionState } from "@/lib/recommendation/domain/types"
import type { NarrowingIntent, IntentClassification } from "./types"
import { resolveUndoTarget } from "@/lib/recommendation/domain/request-preparation"
import {
  RESET_KEYWORDS,
  NONSENSE_PATTERNS as SHARED_NONSENSE_PATTERNS,
  isSkipToken,
} from "@/lib/recommendation/shared/patterns"
import { LLM_FREE_INTERPRETATION } from "@/lib/feature-flags"

const INTENT_CLASSIFIER_MODEL = resolveModel("sonnet", "intent-classifier")

// ── Deterministic Patterns (fast path, no LLM) ──────────────
// 공유 패턴은 shared/patterns.ts에서 import

const RESET_EXACT = RESET_KEYWORDS
const NONSENSE_PATTERNS = SHARED_NONSENSE_PATTERNS

// REFINE_CONDITION 의 deterministic regex 는 제거 — LLM 프롬프트가 담당.
// "스테인리스", "DLC" 같은 bare 토큰은 사용자가 refine 의도 없이 그냥 질문하는
// 상황(ASK_EXPLANATION)도 매우 흔해서, resolved 세션 한정이라도 false-positive 위험이
// 컸다. 정답 분기는 LLM unified-haiku-judgment / primary model 이 intentAction +
// field hint 로 내려준다.

/**
 * Classify user intent — deterministic first, primary model fallback for ambiguity.
 */
export async function classifyIntent(
  message: string,
  sessionState: ExplorationSessionState | null,
  provider: LLMProvider
): Promise<IntentClassification> {
  const clean = message.trim().toLowerCase()

  // ── 0. LLM Free Interpretation — deterministic 스킵, LLM 직행 ──
  if (LLM_FREE_INTERPRETATION) {
    if (!clean || NONSENSE_PATTERNS.some(p => p.test(clean))) {
      return { intent: "OUT_OF_SCOPE", confidence: 0.95, modelUsed: INTENT_CLASSIFIER_MODEL }
    }
    if (isExplicitResetIntent(clean)) {
      return { intent: "RESET_SESSION", confidence: 0.98, modelUsed: INTENT_CLASSIFIER_MODEL }
    }
    // 칩 매칭만 유지 (UI 클릭)
    if (sessionState?.displayedOptions?.length) {
      const chipClean = clean.replace(/\s*\(\d+개\)\s*$/, "").replace(/\s*—\s*.+$/, "").trim()
      for (const opt of sessionState.displayedOptions) {
        const optVal = opt.value.toLowerCase()
        const optLabel = opt.label.toLowerCase().replace(/\s*\(\d+개\)\s*$/, "").replace(/\s*—\s*.+$/, "").trim()
        if (chipClean === optVal || chipClean === optLabel) {
          return { intent: "SELECT_OPTION", confidence: 0.98, extractedValue: opt.value, reasoning: `Chip match`, modelUsed: INTENT_CLASSIFIER_MODEL }
        }
      }
    }
    // LLM 직행 — configured primary model
    if (provider.available()) {
      try {
        return await classifyWithPrimaryModel(message, sessionState, provider)
      } catch (e) {
        console.warn("[intent-classifier] LLM-free-interpretation fallback failed:", e)
      }
    }
  }

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

  // ── 4~8: Removed — LLM handles REFINE_CONDITION + general intent classification ──

  // ── 9. Ambiguous: configured primary model fallback ──
  if (provider.available()) {
    try {
      return await classifyWithPrimaryModel(message, sessionState, provider)
    } catch (e) {
      console.warn("[intent-classifier] Primary model fallback failed:", e)
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

// ── Primary Model Classification ─────────────────────────────

async function classifyWithPrimaryModel(
  message: string,
  sessionState: ExplorationSessionState | null,
  provider: LLMProvider
): Promise<IntentClassification> {
  const sessionSummary = sessionState
    ? `현재 세션: 후보 ${sessionState.candidateCount}개, 필터 [${sessionState.appliedFilters.map(f => `${f.field}=${f.value}`).join(", ")}], 상태: ${sessionState.resolutionStatus}`
    : "세션 없음"

  const isResolvedSession = sessionState?.resolutionStatus?.startsWith("resolved") === true

  const systemPrompt = LLM_FREE_INTERPRETATION
    ? `You are an intent classifier for a Korean cutting tool recommendation system.
Analyze the user's message in context and classify their intent.

Session: ${sessionSummary}${isResolvedSession ? " (already resolved — user may want to refine)" : ""}

Key distinction:
- REFINE_CONDITION = user wants to CHANGE an already-applied filter (e.g., "소재 바꿔", "다른 직경", "다시 추천해"). Put the target field in extractedValue: "material" | "diameter" | "coating" | "fluteCount" | "toolSubtype".
- ASK_EXPLANATION = user asks about a concept or material without wanting to change filters (e.g., "스테인리스가 뭐야?", "DLC 장점?"). Bare material/coating mentions without a change verb usually mean ASK_EXPLANATION.

Respond: {"intent": "...", "confidence": 0.0-1.0, "extractedValue": "..." or null}`
    : `You are an intent classifier for an industrial cutting tool recommendation system.
Classify the user's message into exactly one intent. Respond with JSON only.

Active session context: ${sessionSummary}${isResolvedSession ? " (already resolved — user may want to refine an applied filter)" : ""}

Intents:
- SET_PARAMETER: user provides a specific value (diameter, material, etc.)
- SELECT_OPTION: user picks from presented options (e.g., "4날", "Square", "AlTiN")
- ASK_RECOMMENDATION: user wants to see results now
- ASK_COMPARISON: user wants to compare products
- ASK_REASON: user asks why something was recommended
- ASK_EXPLANATION: user asks about a concept or term (e.g., "스테인리스가 뭐야", "DLC 장점")
- REFINE_CONDITION: user wants to change an already-applied filter post-resolution (e.g., "소재 바꿔", "다른 직경", "다시 추천해", "코팅 변경"). Set extractedValue to the target field: "material" | "diameter" | "coating" | "fluteCount" | "toolSubtype".
- GO_BACK_ONE_STEP: user wants to go back one step
- GO_BACK_TO_SPECIFIC_STAGE: user wants to go back to a specific stage
- RESET_SESSION: user wants to restart
- START_NEW_TOPIC: unrelated topic change
- OUT_OF_SCOPE: nonsense or off-domain

Critical distinction — bare material/coating tokens:
- "스테인리스 뭐야?", "DLC 좋아?" → ASK_EXPLANATION (curiosity, no change verb)
- "스테인리스로 바꿔줘", "DLC로 다시" → REFINE_CONDITION (explicit change verb)
- Bare mentions in a resolved session default to ASK_EXPLANATION unless a change verb (바꿔/변경/다시/다른) is present.

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
      reasoning: `Primary model: ${parsed.intent}`,
      modelUsed: INTENT_CLASSIFIER_MODEL,
    }
  } catch {
    return { intent: "SET_PARAMETER", confidence: 0.4, modelUsed: INTENT_CLASSIFIER_MODEL }
  }
}

// ── Helpers ──────────────────────────────────────────────────

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

