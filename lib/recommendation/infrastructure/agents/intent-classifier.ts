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
  NONSENSE_PATTERNS as SHARED_NONSENSE_PATTERNS,
  isSkipToken,
} from "@/lib/recommendation/shared/patterns"
import { LLM_FREE_INTERPRETATION } from "@/lib/feature-flags"

const INTENT_CLASSIFIER_MODEL = resolveModel("sonnet", "intent-classifier")

// ── Deterministic Patterns (fast path, no LLM) ──────────────
// 공유 패턴은 shared/patterns.ts에서 import

const RESET_EXACT = RESET_KEYWORDS
const NONSENSE_PATTERNS = SHARED_NONSENSE_PATTERNS

// Refinement patterns — post-recommendation "change X" intent detection
const REFINEMENT_PATTERNS: RegExp[] = [
  /피삭재.*바꿔/, /소재.*바꿔/, /소재.*바꾸/, /재질.*바꿔/, /재질.*바꾸/,
  /직경.*변경/, /직경.*바꿔/, /다른.*직경/,
  /코팅.*변경/, /코팅.*바꿔/, /대체.*코팅/, /코팅.*대체/, /다른.*코팅/,
  /대체.*추천/, /대체.*해/, /.*대체/,
  /다시.*추천/, /다시.*볼래/, /다시.*보고/,
  /스테인리스/, /알루미늄/, /탄소강/, /티타늄/,
  /AlCrN/i, /AlTiN/i, /TiAlN/i, /DLC/i, /무코팅/,
]

function detectRefinementField(clean: string): string | undefined {
  if (/피삭재|소재|재질|스테인리스|알루미늄|탄소강|티타늄/.test(clean)) return "material"
  if (/직경|mm|밀리/.test(clean)) return "diameter"
  if (/코팅/.test(clean)) return "coating"
  if (/날|flute|플루트/.test(clean)) return "fluteCount"
  if (/형상|subtype|square|ball|radius/.test(clean)) return "toolSubtype"
  return undefined
}

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
    // LLM 직행 — Groq 우선, 실패 시 Haiku
    if (process.env.GROQ_API_KEY) {
      try {
        const groqResult = await classifyWithGroq(message, sessionState)
        if (groqResult) return groqResult
      } catch (e) {
        console.warn("[intent-classifier] LLM-free Groq failed, trying Haiku:", e instanceof Error ? e.message : e)
      }
    }
    if (provider.available()) {
      try {
        return await classifyWithHaiku(message, sessionState, provider)
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

  // ── 4. Refinement intent (post-recommendation) ──
  if (sessionState?.resolutionStatus?.startsWith("resolved") && REFINEMENT_PATTERNS.some(p => p.test(clean))) {
    return { intent: "REFINE_CONDITION" as NarrowingIntent, confidence: 0.9, extractedValue: detectRefinementField(clean), modelUsed: INTENT_CLASSIFIER_MODEL }
  }

  // ── 5~8: Removed — LLM handles general intent classification ──

  // ── 9. Ambiguous: Groq fast path → Haiku LLM fallback ──
  // Groq (llama-3.3-70b-versatile) is ~5-10x faster than Sonnet for simple
  // intent classification. Fall through to Haiku if Groq is unavailable or
  // errors (timeout, network, 5xx, bad JSON).
  if (process.env.GROQ_API_KEY) {
    try {
      const groqResult = await classifyWithGroq(message, sessionState)
      if (groqResult) return groqResult
    } catch (e) {
      console.warn("[intent-classifier] Groq fast path failed, trying Haiku:", e instanceof Error ? e.message : e)
    }
  }
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

  const systemPrompt = LLM_FREE_INTERPRETATION
    ? `You are an intent classifier for a Korean cutting tool recommendation system.
Analyze the user's message in context and classify their intent.

Session: ${sessionSummary}

Respond: {"intent": "...", "confidence": 0.0-1.0, "extractedValue": "..." or null}`
    : `You are an intent classifier for an industrial cutting tool recommendation system.
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

// ── Groq fast-path classifier ────────────────────────────────
// llama-3.3-70b-versatile on Groq: sub-second JSON intent classification.
// Runs before classifyWithHaiku. Failure (timeout, network, 4xx/5xx, bad
// JSON) returns null so the caller falls through to Haiku. Zero side effects.
const GROQ_TIMEOUT_MS = 3000
const GROQ_ENDPOINT = "https://api.groq.com/openai/v1/chat/completions"
const GROQ_MODEL = process.env.GROQ_INTENT_MODEL || "llama-3.3-70b-versatile"

async function classifyWithGroq(
  message: string,
  sessionState: ExplorationSessionState | null,
): Promise<IntentClassification | null> {
  const apiKey = process.env.GROQ_API_KEY
  if (!apiKey) return null

  const sessionSummary = sessionState
    ? `candidates=${sessionState.candidateCount}, filters=[${sessionState.appliedFilters.map(f => `${f.field}=${f.value}`).join(", ")}], status=${sessionState.resolutionStatus}`
    : "no session"

  const systemPrompt = `YG-1 절삭공구 추천 챗봇의 의도 분류기. 한국어 사용자 입력을 JSON으로 분류.

세션: ${sessionSummary}

Intent 종류 (반드시 이 값 중 하나):
- SET_PARAMETER: 구체적인 값 제공 (직경/소재/날수/코팅 등)
- SELECT_OPTION: 제시된 옵션 중 선택
- ASK_RECOMMENDATION: 추천 결과 요청
- ASK_COMPARISON: 제품 비교 요청
- ASK_REASON: 추천 이유 질문
- ASK_EXPLANATION: 용어/개념 설명 질문 ("헬릭스가 뭐야?", "DLC란?")
- REFINE_CONDITION: 기존 필터 변경 ("코팅 바꿔", "AlCrN으로", "대체 추천")
- RESET_SESSION: 처음부터 다시, 초기화, 리셋
- START_NEW_TOPIC: 주제 전환
- OUT_OF_SCOPE: 무의미/범위 밖

도메인 매핑:
- 소재: SUS/스테인리스→Stainless Steels, SM45C/S45C→Carbon Steels, SCM→Alloy Steels, SKD→Hardened Steels, A7075/A6061→Aluminum, Ti6Al4V→Titanium, Inconel→Inconel
- 코팅: 와이/Y→Y-Coating, 엑스/X→X-Coating, AlCrN/TiAlN/DLC 원문 그대로
- 형상: 볼노즈→Ball, 플랫/스퀘어→Square, 코너R→Radius

규칙:
- "코팅 바꿔", "대체 추천", "다른 X" → REFINE_CONDITION (extractedValue=변경할 필드명 또는 값)
- "처음부터", "리셋", "다시 시작" → RESET_SESSION
- "~란?", "~뭐야?", "~설명" → ASK_EXPLANATION
- 단순 값 제공 → SET_PARAMETER (extractedValue=값)

반드시 JSON만 출력. 다른 텍스트 절대 금지.
{"intent":"...","confidence":0.0-1.0,"extractedValue":"..." 또는 null,"reasoning":"한 문장"}`

  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), GROQ_TIMEOUT_MS)
  try {
    const res = await fetch(GROQ_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: GROQ_MODEL,
        temperature: 0,
        max_tokens: 300,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: message },
        ],
      }),
      signal: ctrl.signal,
    })
    if (!res.ok) {
      const err = await res.text().catch(() => "")
      console.warn(`[intent-classifier] Groq HTTP ${res.status}: ${err.slice(0, 200)}`)
      return null
    }
    const json = await res.json() as {
      choices?: Array<{ message?: { content?: string } }>
    }
    const raw = json.choices?.[0]?.message?.content ?? ""
    if (!raw) return null
    const parsed = JSON.parse(raw.trim().replace(/```json\n?|\n?```/g, ""))
    if (!parsed || typeof parsed.intent !== "string") return null
    return {
      intent: parsed.intent as NarrowingIntent,
      confidence: typeof parsed.confidence === "number" ? parsed.confidence : 0.75,
      extractedValue: parsed.extractedValue ?? undefined,
      reasoning: `Groq(${GROQ_MODEL}): ${parsed.reasoning ?? parsed.intent}`,
      modelUsed: GROQ_MODEL,
    }
  } catch (e) {
    if ((e as Error)?.name === "AbortError") {
      console.warn(`[intent-classifier] Groq timeout (${GROQ_TIMEOUT_MS}ms)`)
    }
    return null
  } finally {
    clearTimeout(timer)
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

