/**
 * Meta / Quote / Echo Detector — Determines whether a user message is
 * a direct command or is quoting/discussing/criticizing prior assistant output.
 *
 * This is the first gate in the pipeline, BEFORE intent classification.
 * If the message is detected as quoted/meta, downstream routing must NOT
 * treat embedded command phrases as fresh commands.
 *
 * Deterministic. No LLM calls.
 */

// ── Message Kind ─────────────────────────────────────────────
export type MessageKind =
  | "direct_command"
  | "quoted_command_text"
  | "meta_feedback"
  | "pasted_assistant_output"
  | "memory_inspection_request"
  | "clarification_request"

export interface MetaDetectionResult {
  kind: MessageKind
  confidence: number
  /** If true, any reset/undo/action phrases in the message should be ignored */
  blockCommandExecution: boolean
  /** If true, the system should regenerate options from session state */
  shouldRegenerateOptions: boolean
  /** Extracted "real" intent behind the meta message, if detectable */
  underlyingIntent: "regenerate_chips" | "explain_behavior" | "revise_input" | "show_memory" | "none"
}

// ── Known assistant-generated phrases that should NOT be re-executed ──
const ASSISTANT_PHRASES = [
  "처음부터 다시",
  "이전으로",
  "이전 단계",
  "⟵ 이전 단계",
  "추천해주세요",
  "상관없음",
  "절삭조건 알려줘",
  "대체 후보",
  "코팅 비교",
  "다른 직경",
  "처음부터 다시 시작",
]

// ── Meta-feedback patterns ───────────────────────────────────
const META_FEEDBACK_PATTERNS = [
  /이걸.*기반으로/,
  /이것.*기반으로/,
  /이거.*기반으로/,
  /칩.*만들어/,
  /옵션.*만들어/,
  /칩.*보여/,
  /옵션.*보여/,
  /칩.*줘/,
  /옵션.*줘/,
  /보기로.*내놔/,
  /보기로.*줘/,
  /왜.*안.*나와/,
  /왜.*없어/,
  /선택지.*없/,
  /선택.*할.*수.*없/,
  /고칠.*수.*없/,
  /수정.*할.*수.*없/,
  /입력.*고칠/,
  /바꿀.*수.*없/,
]

// ── Clarification about system behavior ──────────────────────
const CLARIFICATION_PATTERNS = [
  /왜.*처음부터/,
  /왜.*리셋/,
  /왜.*초기화/,
  /왜.*다시.*시작/,
  /왜.*그래/,
  /왜.*그런/,
  /왜.*이래/,
  /왜.*이런/,
  /어떻게.*된.*거/,
  /뭐가.*잘못/,
  /무슨.*일/,
]

// ── Memory / debug inspection ────────────────────────────────
const MEMORY_PATTERNS = [
  /메모리.*보여/,
  /메모리.*보고/,
  /메모리.*알려/,
  /memory.*show/i,
  /프롬프트.*보여/,
  /prompt.*보여/,
  /내부.*상태/,
  /세션.*상태/,
  /지금.*상태/,
  /디버그/,
  /debug/i,
]

// ── Quote / paste detection ──────────────────────────────────
const QUOTE_MARKERS = [
  /^[">]/,          // starts with quote char
  /^「/,            // Japanese-style quote
  /^'/,             // starts with backtick
  /^"/,             // starts with curly quote
  /라고.*했/,        // "you said"
  /라고.*나와/,      // "it shows"
  /라고.*나왔/,
  /라고.*뜨/,        // "it appears"
  /라고.*떴/,
  /라는.*옵션/,      // "the option called..."
  /라는.*게/,        // "the thing called..."
  /이렇게.*나오/,    // "it shows like this"
  /이렇게.*뜨/,
  /이런.*말/,        // "this kind of message"
  /이런.*문구/,
  /위에.*나온/,      // "shown above"
  /아까.*나온/,      // "shown before"
]

/**
 * Detect whether a user message is a direct command or meta/quote/echo.
 *
 * Must run BEFORE intent classification.
 * If blockCommandExecution is true, embedded command phrases must not be executed.
 */
export function detectMetaMessage(
  message: string,
  previousAssistantText: string | null,
  displayedChips: string[] | null
): MetaDetectionResult {
  const clean = message.trim()
  const lower = clean.toLowerCase()

  // ── 1. Memory / debug inspection ──
  if (MEMORY_PATTERNS.some(p => p.test(lower))) {
    return {
      kind: "memory_inspection_request",
      confidence: 0.95,
      blockCommandExecution: true,
      shouldRegenerateOptions: false,
      underlyingIntent: "show_memory",
    }
  }

  // ── 2. Clarification about system behavior ──
  if (CLARIFICATION_PATTERNS.some(p => p.test(lower))) {
    return {
      kind: "clarification_request",
      confidence: 0.9,
      blockCommandExecution: true,
      shouldRegenerateOptions: true,
      underlyingIntent: "explain_behavior",
    }
  }

  // ── 3. Frustration about inability to revise (before generic meta-feedback) ──
  if (/고칠.*수.*없|바꿀.*수.*없|수정.*못|되돌릴.*수.*없/.test(lower)) {
    return {
      kind: "meta_feedback",
      confidence: 0.85,
      blockCommandExecution: true,
      shouldRegenerateOptions: true,
      underlyingIntent: "revise_input",
    }
  }

  // ── 4. Meta-feedback about chips/options ──
  if (META_FEEDBACK_PATTERNS.some(p => p.test(lower))) {
    return {
      kind: "meta_feedback",
      confidence: 0.9,
      blockCommandExecution: true,
      shouldRegenerateOptions: true,
      underlyingIntent: "regenerate_chips",
    }
  }

  // ── 4. Quote/paste detection ──
  const hasQuoteMarkers = QUOTE_MARKERS.some(p => p.test(lower))
  const containsAssistantPhrases = ASSISTANT_PHRASES.some(p => lower.includes(p.toLowerCase()))
  const isLong = clean.length > 40

  // Long message containing assistant phrases + quote markers → pasted/quoted
  if (containsAssistantPhrases && hasQuoteMarkers) {
    return {
      kind: "quoted_command_text",
      confidence: 0.95,
      blockCommandExecution: true,
      shouldRegenerateOptions: true,
      underlyingIntent: "regenerate_chips",
    }
  }

  // Long message containing assistant phrases → likely pasting
  if (containsAssistantPhrases && isLong) {
    // Check if the message also contains meta-commentary
    const hasMetaCommentary = /이걸|이거|이것|이런|위에|아까|왜|보여|만들|줘야|내놔|없네/.test(lower)
    if (hasMetaCommentary) {
      return {
        kind: "pasted_assistant_output",
        confidence: 0.85,
        blockCommandExecution: true,
        shouldRegenerateOptions: true,
        underlyingIntent: "regenerate_chips",
      }
    }
  }

  // ── 5. Exact match against previous assistant text ──
  if (previousAssistantText) {
    const prevLower = previousAssistantText.toLowerCase()
    // If user message is a substring of previous assistant output (> 20 chars)
    if (lower.length > 20 && prevLower.includes(lower)) {
      return {
        kind: "pasted_assistant_output",
        confidence: 0.9,
        blockCommandExecution: true,
        shouldRegenerateOptions: false,
        underlyingIntent: "none",
      }
    }
  }

  // ── 6. Check if the message exactly matches a displayed chip ──
  // This is a VALID direct command, not a quote
  if (displayedChips && displayedChips.length > 0) {
    const chipClean = lower.replace(/\s*\(\d+개\)\s*$/, "").replace(/\s*—\s*.+$/, "").trim()
    const isExactChipMatch = displayedChips.some(chip => {
      const cv = chip.toLowerCase().replace(/\s*\(\d+개\)\s*$/, "").replace(/\s*—\s*.+$/, "").trim()
      return chipClean === cv
    })
    if (isExactChipMatch) {
      return {
        kind: "direct_command",
        confidence: 0.98,
        blockCommandExecution: false,
        shouldRegenerateOptions: false,
        underlyingIntent: "none",
      }
    }
  }

  // ── Default: direct command ──
  return {
    kind: "direct_command",
    confidence: 0.7,
    blockCommandExecution: false,
    shouldRegenerateOptions: false,
    underlyingIntent: "none",
  }
}

/**
 * Check if a reset should be blocked based on meta detection.
 * This is the reset guard — call this BEFORE executing any reset action.
 */
export function shouldBlockReset(
  message: string,
  metaResult: MetaDetectionResult
): boolean {
  // If the message is quoted/meta/pasted → always block reset
  if (metaResult.blockCommandExecution) return true

  // Additional guard: long message with reset phrase is likely not a reset command
  const clean = message.trim().toLowerCase()
  if (clean.length > 30 && /처음부터|리셋|초기화/.test(clean)) {
    // Check for question/meta markers
    if (/\?|왜|어떻게|뭐가|아니야|잖아|해야|ㅠ|ㅜ/.test(clean)) return true
  }

  return false
}
