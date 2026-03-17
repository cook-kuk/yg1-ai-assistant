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
  /해야\s*(하|되)/, /맞지\s*\?*$/, /아닌데/,
  /이상하/, /왜.*그/, /왜.*이렇/, /어떻게.*된/, /뭐가.*잘못/,
  /내에서/, /중에서/, /안에서/,
]
const SKIP_PATTERNS = ["상관없음", "모름", "패스", "넘어", "넘겨", "스킵", "아무거나"]
const NONSENSE_PATTERNS = [/^[ㅋㅎㅠㅜ]+$/, /^[?!.]+$/, /^\s*$/]

// ── New intent patterns ──────────────────────────────────────
const SLOT_REPLACE_PATTERNS = [/바꿔/, /변경/, /교체/, /대신/, /말고/]
const SIDE_CONVERSATION_PATTERNS = [/힘들어/, /피곤/, /감사합니다/, /고마워/, /수고/, /잘\s*지내/, /나랑\s*얘기/, /심심/, /외로/, /기분/]
const SIMPLE_MATH_PATTERNS = [/\d+\s*[\+\-\*\/x×÷]\s*\d+/]
const BOT_META_PATTERNS = [/넌\s*뭐/, /너\s*누구/, /AI야/, /봇이야/, /갑자기\s*왜/, /왜\s*추천/, /왜\s*갑자기/]
const RETURN_TO_RECOMMENDATION_PATTERNS = [/다시.*추천/, /이어서/, /돌아가/, /원래.*하던/, /추천.*이어/, /아까.*이어/]
const SCOPE_CONFIRMATION_PATTERNS = [/맞아\?/, /맞아요\?/, /보여주.*맞/, /지금.*만\s*보/, /현재.*맞/, /개\)?\s*만/, /해당하는.*맞/, /그\s*조건/]
const COMPARISON_FOLLOWUP_PATTERNS = [/그\s*중/, /뭐가\s*나/, /어떤\s*게\s*나/, /둘\s*중/, /셋\s*중/, /어느.*나/]

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

  // ── 3.5. Simple math (must be before comparison — "1+1" shouldn't match number patterns) ──
  if (SIMPLE_MATH_PATTERNS.some(p => p.test(clean))) {
    return { intent: "SIMPLE_MATH", confidence: 0.95, modelUsed: "haiku" }
  }

  // ── 3.6. Scope confirmation ("지금 Square만 맞아?", "이거 26개 맞아?") ──
  if (sessionState && SCOPE_CONFIRMATION_PATTERNS.some(p => p.test(clean))) {
    return { intent: "ASK_SCOPE_CONFIRMATION", confidence: 0.9, modelUsed: "haiku" }
  }

  // ── 3.7. Return to active recommendation (only when overlay is active) ──
  if (sessionState && sessionState.overlayMode === "side_conversation" &&
      RETURN_TO_RECOMMENDATION_PATTERNS.some(p => p.test(clean))) {
    return { intent: "RETURN_TO_ACTIVE_RECOMMENDATION", confidence: 0.95, modelUsed: "haiku" }
  }

  // ── 3.8. Bot meta questions ("넌 뭐야?", "갑자기 왜 추천해?") ──
  if (BOT_META_PATTERNS.some(p => p.test(clean))) {
    return { intent: "META_CONVERSATION", confidence: 0.9, modelUsed: "haiku" }
  }

  // ── 3.9. Side conversation / emotional chat ──
  if (SIDE_CONVERSATION_PATTERNS.some(p => p.test(clean))) {
    return { intent: "SIDE_CONVERSATION", confidence: 0.9, modelUsed: "haiku" }
  }

  // ── 3.10. Comparison follow-up with persisted scope ──
  if (sessionState?.lastComparedProductCodes?.length &&
      COMPARISON_FOLLOWUP_PATTERNS.some(p => p.test(clean))) {
    return {
      intent: "ASK_COMPARISON",
      confidence: 0.9,
      extractedValue: sessionState.lastComparedProductCodes.join(","),
      reasoning: "Comparison follow-up using persisted comparison scope",
      modelUsed: "haiku",
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
          modelUsed: "haiku",
        }
      }
    }
  }

  // ── 7.6. Slot replacement detection ("4mm로 바꿔줘", "직경 변경") ──
  if (sessionState && sessionState.appliedFilters.length > 0 &&
      SLOT_REPLACE_PATTERNS.some(p => p.test(clean))) {
    // Extract what value they want to change to
    const paramResult = tryDeterministicExtraction(clean)
    return {
      intent: "CHANGE_SINGLE_VALUED_SLOT",
      confidence: 0.9,
      extractedValue: paramResult ?? clean,
      modelUsed: "haiku",
    }
  }

  // ── 7.7. Implicit slot replacement: "Nmm로" when diameterMm filter already exists ──
  if (sessionState) {
    const diamMatch = clean.match(/([\d.]+)\s*mm/)
    if (diamMatch && sessionState.appliedFilters.some(f => f.field === "diameterMm" || f.field === "diameterRefine")) {
      return {
        intent: "CHANGE_SINGLE_VALUED_SLOT",
        confidence: 0.9,
        extractedValue: `${diamMatch[1]}mm`,
        modelUsed: "haiku",
      }
    }
    const fluteMatch = clean.match(/(\d+)\s*날/)
    if (fluteMatch && sessionState.appliedFilters.some(f => f.field === "fluteCount")) {
      return {
        intent: "CHANGE_SINGLE_VALUED_SLOT",
        confidence: 0.9,
        extractedValue: `${fluteMatch[1]}날`,
        modelUsed: "haiku",
      }
    }
  }

  // ── 7.8. Meta-questions about the process (NOT parameters) ──
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
- CHANGE_SINGLE_VALUED_SLOT: user replaces a previously set value ("4mm로 바꿔줘", "직경 변경해줘")
- ASK_RECOMMENDATION: user wants to see results now
- ASK_COMPARISON: user wants to compare products
- ASK_REASON: user asks why something was recommended
- ASK_SCOPE_CONFIRMATION: user asks if current scope/count is correct ("지금 26개 맞아?")
- ASK_EXPLANATION: user asks about a concept or term
- GO_BACK_ONE_STEP: user wants to go back one step
- GO_BACK_TO_SPECIFIC_STAGE: user wants to go back to a specific stage
- RESET_SESSION: user wants to restart
- SIDE_CONVERSATION: emotional/social chat ("힘들어", "감사합니다")
- SIMPLE_MATH: arithmetic question ("1+1은?")
- META_CONVERSATION: questions about the bot itself ("넌 뭐야?", "왜 갑자기 추천해?")
- RETURN_TO_ACTIVE_RECOMMENDATION: user wants to resume recommendation ("다시 추천 이어가자")
- START_NEW_TOPIC: unrelated topic change
- OUT_OF_SCOPE: nonsense or off-domain

Respond: {"intent":"...", "confidence": 0.0-1.0, "extractedValue": "..." or null}`

  const raw = await provider.complete(
    systemPrompt,
    [{ role: "user", content: message }],
    200,
    "haiku",
    "intent-classifier"
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
