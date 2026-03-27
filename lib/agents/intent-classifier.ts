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

const RESET_PATTERNS = ["처음부터 다시", "다시 시작", "리셋", "처음부터", "새로 시작", "초기화", "reset"]
const RECOMMEND_PATTERNS = ["추천해주세요", "바로 보여주세요", "결과 보기", "추천 받기", "추가 조건 없음", "그냥 줘", "빨리", "알아서", "그냥", "보여줘", "결과", "추천해줘", "추천 해줘", "결과보기"]
const COMPARE_PATTERNS = [
  /비교/, /차이/, /(\d+)번.*(\d+)번/, /상위.*비교/, /위.*비교/, /이\s*중/,
  /(\d+)\s*번.*이랑/, /(\d+)~(\d+)\s*번/, /(\d+)\s*번.*하고.*(\d+)\s*번/,
  /둘.*비교/, /셋.*비교/, /전부.*비교/, /다.*비교/,
  /(\d+)\s*개.*비교/, /상위\s*(\d+)\s*개/,
]
const EXPLAIN_PATTERNS = [
  /그게\s*뭐/, /그건\s*뭐/, /이게\s*뭐/, /뭐야/, /차이.*뭐/, /뭐가\s*다/, /설명/, /왜\s*이/, /이유/,
  /알려\s*줘/, /알려줘/, /어떤\s*거/, /뭐\s*좋/, /좋은\s*거/,
  /코팅.*종류/, /종류.*알려/, /특징/, /장단점/,
  /뭐야\s*\?*$/, /뭔가요/, /뭐에요/, /뭐죠/,
  /에\s*대해(서)?\s*(설명|알려)/, /대해\s*설명/, /대해서\s*알려/,
  /.+[,\s].+[,\s].+(설명|알려|뭐야|차이)/, // "A, B, C 설명해줘" — 복수 옵션 나열 + 설명 요청
  /각각.*설명/, /하나씩.*설명/, /비교.*설명/,
  /뭔지\s*(몰라|모르|잘\s*몰|모르겠)/, // "뭔지 몰라요", "뭔지 모르겠어요"
  /몰라(요|서)?$/, /모르겠(어요|습니다|네)?/, // "몰라요", "모르겠어요"
  /설명\s*(해\s*줄\s*수|좀|해\s*줘|해\s*주세요|해줘)/, // "설명해줄수 있어?"
]
const SCOPE_CONFIRM_PATTERNS = [
  /지금.*상태/, /현재.*상태/, /지금.*어떤/, /뭐.*적용/, /어디까지/, /몇\s*개.*남/,
  /필터.*뭐/, /조건.*뭐/, /지금.*조건/, /현재.*조건/,
]
const SUMMARIZE_PATTERNS = [
  /정리/, /요약/, /지금까지/, /어디까지.*했/, /진행.*상황/,
]
const META_QUESTION_PATTERNS = [
  /아니야\s*\?*$/, /아닌가\s*\?*$/, /않아\s*\?*$/, /잖아/,
  /해야\s*(하|되)/, /맞아\s*\?*$/, /맞지\s*\?*$/, /아닌데/,
  /이상하/, /왜.*그/, /왜.*이렇/, /어떻게.*된/, /뭐가.*잘못/,
  /내에서/, /중에서/, /안에서/,
  /왜.*추천/, /이거.*왜/, /왜.*이거/,
]
const SKIP_PATTERNS = ["상관없음", "모름", "패스", "넘어", "넘겨", "스킵", "아무거나", "다음", "다음으로"]
const NONSENSE_PATTERNS = [/^[ㅋㅎㅠㅜ]+$/, /^[?!.]+$/, /^\s*$/]
const SIDE_CHAT_PATTERNS = [
  /^안녕/, /^ㅎㅇ/, /^하이/, /^hello/i, /^hi\b/i,
  /고마워/, /감사/, /thanks/i, /ㄳ/,
  /\d+\s*[+\-*/]\s*\d+/,  // math
]

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
            return { intent: "SELECT_OPTION", confidence: 0.98, extractedValue: opt.value, reasoning: `Chip match: ${opt.label}`, modelUsed: "haiku" }
          }
        }
      }
      if (sessionState.displayedChips?.length > 0) {
        for (const chip of sessionState.displayedChips) {
          if (metaChips.includes(chip)) continue
          const cv = chip.toLowerCase().replace(/\s*\(\d+개\)\s*$/, "").replace(/\s*—\s*.+$/, "").trim()
          if (chipClean === cv || clean === chip.toLowerCase()) {
            return { intent: "SELECT_OPTION", confidence: 0.95, extractedValue: chip.replace(/\s*\(\d+개\)\s*$/, "").replace(/\s*—\s*.+$/, "").trim(), modelUsed: "haiku" }
          }
        }
      }
    }
  }

  // ── 4. Explanation requests (BEFORE comparison — "차이 설명해줘" is explanation, not comparison) ──
  if (EXPLAIN_PATTERNS.some(p => p.test(clean))) {
    return { intent: "ASK_EXPLANATION", confidence: 0.9, modelUsed: "haiku" }
  }

  // ── 5. Comparison requests ──
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

  // ── 7.6. Scope confirmation ("지금 어떤 상태야?") ──
  if (SCOPE_CONFIRM_PATTERNS.some(p => p.test(clean))) {
    return { intent: "ASK_EXPLANATION", confidence: 0.9, extractedValue: "__confirm_scope__", modelUsed: "haiku" }
  }

  // ── 7.7. Task summary ("지금까지 정리해줘") ──
  if (SUMMARIZE_PATTERNS.some(p => p.test(clean))) {
    return { intent: "ASK_EXPLANATION", confidence: 0.9, extractedValue: "__summarize_task__", modelUsed: "haiku" }
  }

  // ── 7.8. Meta-questions about the process (NOT parameters) ──
  if (META_QUESTION_PATTERNS.some(p => p.test(clean))) {
    return { intent: "ASK_EXPLANATION", confidence: 0.85, modelUsed: "haiku" }
  }

  // ── 7.9. Side conversation (greetings, thanks, math) ──
  if (SIDE_CHAT_PATTERNS.some(p => p.test(clean))) {
    return { intent: "START_NEW_TOPIC", confidence: 0.85, modelUsed: "haiku" }
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
  if (sessionState) {
    // In any active session (narrowing OR resolved), route to general answer
    // This prevents "dead" responses after comparison or recommendation
    return { intent: "START_NEW_TOPIC", confidence: 0.5, extractedValue: clean, modelUsed: "haiku" }
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
    1500,
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
  // Flute count: "4날", "날수 4", "4 flute"
  const fluteMatch = clean.match(/^(\d+)\s*날/) || clean.match(/날수?\s*(\d+)/) || clean.match(/(\d+)\s*f(?:lute)?$/i)
  if (fluteMatch) return `${fluteMatch[1]}날`

  // Diameter: "4mm", "직경 4mm", "φ4", "4밀리"
  const diamMatch = clean.match(/^([\d.]+)\s*mm/) || clean.match(/직경\s*([\d.]+)/) || clean.match(/φ\s*([\d.]+)/) || clean.match(/([\d.]+)\s*밀리/)
  if (diamMatch) return `${diamMatch[1]}mm`

  // Known coating keywords
  const coatings = ["altin", "tialn", "dlc", "무코팅", "y-코팅", "ticn", "bright finish", "diamond", "x-coating", "t-coating", "uncoated", "alcrn", "다이아몬드", "코팅없"]
  for (const c of coatings) {
    if (clean.includes(c)) return c
  }

  // Known subtypes
  const subtypes = ["square", "ball", "radius", "스퀘어", "볼", "라디우스", "하이피드", "flat", "chamfer", "taper"]
  for (const s of subtypes) {
    if (clean.includes(s)) return s
  }

  // Series code pattern (expanded)
  const seriesMatch = clean.match(/(ce\d+[a-z]*\d*|gnx\d+|sem[a-z]*\d+|e\d+[a-z]\d+|v\d+[a-z]*|alu[_-]?cut)/i)
  if (seriesMatch) return seriesMatch[1]

  // Material keywords (when user types workpiece material as answer)
  const materials = ["알루미늄", "스테인리스", "탄소강", "합금강", "주철", "티타늄", "구리", "인코넬", "sus", "s45c", "aluminum", "stainless"]
  for (const m of materials) {
    if (clean.includes(m)) return m
  }

  return null
}
