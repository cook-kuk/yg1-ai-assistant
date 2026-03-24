/**
 * User Understanding Detector — Detects whether the user is confused,
 * uncertain, delegating, or clear about what they want.
 *
 * When confusion is detected, chips must prioritize explanation/delegation/skip.
 * Deterministic. No LLM calls.
 */

export type UserCognitiveState =
  | "clear"           // user knows what they want
  | "confused"        // user doesn't understand the options
  | "uncertain"       // user is unsure which to pick
  | "wants_explanation" // user explicitly asks for explanation
  | "wants_delegation" // user wants the system to choose
  | "wants_skip"      // user wants to skip this step
  | "wants_revision"  // user wants to go back or change something

export interface UserStateResult {
  state: UserCognitiveState
  confidence: number
  /** If confused about a specific option, which one? */
  confusedAbout: string | null
  /** The field this state is bound to (from pending question) */
  boundField: string | null
}

// ── Confusion / uncertainty patterns ─────────────────────────
const CONFUSION_PATTERNS = [
  /뭔지.*몰라/, /몰라/, /모르겠/, /뭐야\s*[?？]*$/, /뭐지/,
  /이게.*뭐/, /그게.*뭐/, /이건.*뭐/,
  /잘.*모르/, /전혀.*모르/, /처음.*들어/,
  /뭔.*소리/, /무슨.*말/, /이해.*안/,
  /어려워/, /복잡해/, /헷갈/,
]

const DELEGATION_PATTERNS = [
  /추천.*골라/, /알아서.*골라/, /알아서.*해/,
  /추천.*해줘/, /골라.*줘/, /선택.*해줘/,
  /맡길/, /니가.*골라/, /네가.*골라/, /네가.*정해/,
  /아무거나/, /그냥.*추천/, /그냥.*골라/,
  /자동/, /시스템.*추천/,
  /무난한/, /적당한.*걸로/, /보통.*걸로/,
]

const SKIP_PATTERNS = [
  /상관.*없/, /괜찮/, /패스/, /넘어/, /넘겨/, /스킵/,
  /다음/, /건너/, /됐어/, /몰라/,
]

const NOVICE_PATTERNS = [
  /초보/, /잘.*몰라/, /처음이/, /모르겠/,
  /뭘.*골라야/, /어떤.*게.*좋/, /추천.*해줘/,
  /도움/, /도와줘/, /가르쳐/, /알려줘/,
]

const EXPLANATION_PATTERNS = [
  /설명.*해/, /알려.*줘/, /차이.*뭐/, /뭐가.*다/,
  /어떤.*거/, /어떤.*차이/, /장단점/, /비교.*해/,
  /쉽게.*설명/, /간단히.*설명/,
  /.+[가이은는]?\s*뭐야/, // "X가 뭐야?" — asking about a specific thing
]

const REVISION_PATTERNS = [
  /다시/, /바꾸/, /변경/, /고치/, /돌아/, /이전/,
  /되돌/, /취소/, /수정/,
]

/**
 * Detect the user's cognitive state from their latest message.
 */
export function detectUserState(
  userMessage: string | null,
  pendingQuestionField?: string | null
): UserStateResult {
  const field = pendingQuestionField ?? null

  if (!userMessage) return { state: "clear", confidence: 0.5, confusedAbout: null, boundField: field }

  const clean = userMessage.trim().toLowerCase()

  // Delegation (field-bound: "추천으로 골라줘" = delegate THIS field)
  if (DELEGATION_PATTERNS.some(p => p.test(clean))) {
    return { state: "wants_delegation", confidence: 0.9, confusedAbout: null, boundField: field }
  }

  // Explicit explanation request (field-bound: "이거 뭐야?" = explain THIS field's options)
  if (EXPLANATION_PATTERNS.some(p => p.test(clean))) {
    const aboutMatch = clean.match(/(.+?)\s*(이|가|은|는)?\s*(뭐야|뭐지|뭔지|차이)/)
    return {
      state: "wants_explanation",
      confidence: 0.9,
      confusedAbout: aboutMatch ? aboutMatch[1].trim() : null,
      boundField: field,
    }
  }

  // Confusion (field-bound: confusion about THIS field)
  if (CONFUSION_PATTERNS.some(p => p.test(clean))) {
    const aboutMatch = clean.match(/(.+?)\s*(이|가|은|는)?\s*(뭔지|뭐야|뭐지|몰라|모르겠)/)
    return {
      state: "confused",
      confidence: 0.85,
      confusedAbout: aboutMatch ? aboutMatch[1].trim() : field,
      boundField: field,
    }
  }

  // Novice/help (field-bound if pending question exists)
  if (NOVICE_PATTERNS.some(p => p.test(clean))) {
    return { state: "confused", confidence: 0.8, confusedAbout: null, boundField: field }
  }

  // Skip (field-bound: "상관없음" = skip THIS field)
  if (SKIP_PATTERNS.some(p => p.test(clean))) {
    return { state: "wants_skip", confidence: 0.85, confusedAbout: null, boundField: field }
  }

  // Revision
  if (REVISION_PATTERNS.some(p => p.test(clean))) {
    return { state: "wants_revision", confidence: 0.8, confusedAbout: null, boundField: field }
  }

  // Uncertain (short message with question marks but no clear intent)
  if (clean.length < 15 && /[?？]/.test(clean) && !/\d/.test(clean)) {
    return { state: "uncertain", confidence: 0.6, confusedAbout: null, boundField: field }
  }

  return { state: "clear", confidence: 0.7, confusedAbout: null, boundField: field }
}
