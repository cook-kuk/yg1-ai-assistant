/**
 * Pending Question Detector — Detects whether the assistant's latest response
 * contains an unresolved question that should anchor chip generation.
 *
 * When detected, chips must directly correspond to that question,
 * NOT generic follow-up actions.
 *
 * Deterministic. No LLM calls.
 */

// ── Question Shape ───────────────────────────────────────────
export type QuestionShape =
  | "binary_yes_no"        // "~하시겠습니까?" → 예/아니요
  | "binary_proceed"       // "~로 진행할까요?" → 진행/다른조건
  | "explicit_choice"      // "A / B 중 어떤..." → A / B
  | "constrained_options"  // "2날/4날이 있습니다" → 2날 / 4날
  | "revise_or_continue"   // "다시 찾아보시겠어요?" → 유지/변경
  | "open_ended"           // "어떤 조건이 필요하신가요?" → 기존 chips
  | "none"                 // no question detected

export interface PendingQuestion {
  shape: QuestionShape
  /** The raw question text from assistant */
  questionText: string
  /** Extracted concrete options from the question, if any */
  extractedOptions: string[]
  /** The field this question is about, if identifiable */
  field: string | null
  /** Whether this question expects a yes/no answer */
  isBinary: boolean
  /** Whether this question offers specific choices */
  hasExplicitChoices: boolean
}

export interface PendingQuestionResult {
  hasPendingQuestion: boolean
  question: PendingQuestion | null
}

// ── Binary question patterns ─────────────────────────────────
const BINARY_YES_NO_PATTERNS = [
  /하시겠습니까\s*\?*/,
  /할까요\s*\?*/,
  /하실래요\s*\?*/,
  /괜찮으시겠어요\s*\?*/,
  /원하시나요\s*\?*/,
  /맞으신가요\s*\?*/,
]

const BINARY_PROCEED_PATTERNS = [
  /진행할까요\s*\?*/,
  /진행하시겠어요\s*\?*/,
  /선택하시겠습니까\s*\?*/,
  /선택하시겠어요\s*\?*/,
  /적용할까요\s*\?*/,
  /보여드릴까요\s*\?*/,
]

const REVISE_OR_CONTINUE_PATTERNS = [
  /다시.*찾아보시겠/,
  /다시.*검색하시겠/,
  /다른.*조건으로/,
  /변경하시겠/,
  /조정하시겠/,
]

// ── Choice extraction patterns ───────────────────────────────
// "A / B 중", "A, B 중", "A와 B 중"
const EXPLICIT_CHOICE_PATTERN = /(.+?)\s*[,/와과이랑]\s*(.+?)\s*중/
// "A을(를) 선택하시겠습니까? 아니면 B"
const OR_CHOICE_PATTERN = /(.+?)\s*[?？]\s*아니면\s*(.+?)(?:\s*[?？]|\s*$)/

// ── Option extraction from parenthetical lists ───────────────
// "2날(30개), 4날(20개)"
const OPTION_LIST_PATTERN = /(\d+날|\w+)\s*\(\d+개?\)/g
// "2날 / 4날" style
const SLASH_OPTIONS_PATTERN = /(\d+날)\s*[/,]\s*(\d+날)/

// ── Field detection from question context ────────────────────
const FIELD_KEYWORDS: Record<string, RegExp> = {
  fluteCount: /날\s*수|날수|날을|플루트|flute/i,
  coating: /코팅|coating/i,
  material: /소재|재질|피삭재|material/i,
  diameterMm: /직경|지름|diameter/i,
  toolSubtype: /형상|shape|type|square|ball/i,
  seriesName: /시리즈|series/i,
}

/**
 * Detect a pending question from the assistant's latest response text.
 */
export function detectPendingQuestion(assistantText: string | null): PendingQuestionResult {
  if (!assistantText) return { hasPendingQuestion: false, question: null }

  const text = assistantText.trim()

  // Split into sentences and focus on the last 1-2 sentences (where questions usually are)
  const sentences = text.split(/[.。!\n]/).filter(s => s.trim().length > 3)
  const lastSentences = sentences.slice(-2).join(" ")
  const questionArea = lastSentences.trim()

  if (!questionArea) return { hasPendingQuestion: false, question: null }

  // Must contain a question marker
  const hasQuestionMark = /[?？]/.test(questionArea) ||
    BINARY_YES_NO_PATTERNS.some(p => p.test(questionArea)) ||
    BINARY_PROCEED_PATTERNS.some(p => p.test(questionArea))

  if (!hasQuestionMark) return { hasPendingQuestion: false, question: null }

  // Detect field
  const field = detectQuestionField(text)

  // ── 1. "A 선택하시겠습니까? 아니면 B" ──
  const orMatch = text.match(OR_CHOICE_PATTERN)
  if (orMatch) {
    const optA = orMatch[1].trim().replace(/을$|를$/, "")
    const optB = orMatch[2].trim().replace(/을$|를$|[?？]$/, "").replace(/시겠습니까$|시겠어요$/, "")
    return {
      hasPendingQuestion: true,
      question: {
        shape: "binary_proceed",
        questionText: questionArea,
        extractedOptions: [optA, optB],
        field,
        isBinary: true,
        hasExplicitChoices: true,
      },
    }
  }

  // ── 2. Explicit choice "A / B 중" ──
  const choiceMatch = questionArea.match(EXPLICIT_CHOICE_PATTERN)
  if (choiceMatch) {
    const optA = choiceMatch[1].trim()
    const optB = choiceMatch[2].trim()
    return {
      hasPendingQuestion: true,
      question: {
        shape: "explicit_choice",
        questionText: questionArea,
        extractedOptions: [optA, optB],
        field,
        isBinary: false,
        hasExplicitChoices: true,
      },
    }
  }

  // ── 3. Constrained options "2날, 4날" style ──
  const slashMatch = text.match(SLASH_OPTIONS_PATTERN)
  if (slashMatch) {
    return {
      hasPendingQuestion: true,
      question: {
        shape: "constrained_options",
        questionText: questionArea,
        extractedOptions: [slashMatch[1], slashMatch[2]],
        field: field ?? "fluteCount",
        isBinary: false,
        hasExplicitChoices: true,
      },
    }
  }

  // Option list from parenthetical
  const listMatches = Array.from(text.matchAll(OPTION_LIST_PATTERN))
  if (listMatches.length >= 2) {
    return {
      hasPendingQuestion: true,
      question: {
        shape: "constrained_options",
        questionText: questionArea,
        extractedOptions: listMatches.map(m => m[1]),
        field,
        isBinary: false,
        hasExplicitChoices: true,
      },
    }
  }

  // ── 4. Revise or continue ──
  if (REVISE_OR_CONTINUE_PATTERNS.some(p => p.test(questionArea))) {
    return {
      hasPendingQuestion: true,
      question: {
        shape: "revise_or_continue",
        questionText: questionArea,
        extractedOptions: [],
        field,
        isBinary: true,
        hasExplicitChoices: false,
      },
    }
  }

  // ── 5. Binary proceed (check BEFORE generic yes/no — more specific) ──
  if (BINARY_PROCEED_PATTERNS.some(p => p.test(questionArea))) {
    const proceedMatch = questionArea.match(/(\d+날|[가-힣]+)\s*(으로|을|를)?\s*(선택|진행|적용)/)
    const options = proceedMatch ? [proceedMatch[1]] : []

    return {
      hasPendingQuestion: true,
      question: {
        shape: "binary_proceed",
        questionText: questionArea,
        extractedOptions: options,
        field,
        isBinary: true,
        hasExplicitChoices: false,
      },
    }
  }

  // ── 6. Binary yes/no (generic) ──
  if (BINARY_YES_NO_PATTERNS.some(p => p.test(questionArea))) {
    const proceedMatch = questionArea.match(/(\d+날|[가-힣]+)\s*(으로|을|를)?\s*(선택|진행|적용)/)
    const options = proceedMatch ? [proceedMatch[1]] : []

    return {
      hasPendingQuestion: true,
      question: {
        shape: "binary_yes_no",
        questionText: questionArea,
        extractedOptions: options,
        field,
        isBinary: true,
        hasExplicitChoices: false,
      },
    }
  }

  return { hasPendingQuestion: false, question: null }
}

function detectQuestionField(text: string): string | null {
  for (const [field, pattern] of Object.entries(FIELD_KEYWORDS)) {
    if (pattern.test(text)) return field
  }
  return null
}
