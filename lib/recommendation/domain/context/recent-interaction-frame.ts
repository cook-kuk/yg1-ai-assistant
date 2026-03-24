/**
 * Recent Interaction Frame — Captures the most relevant immediate context
 * for chip generation: what was just asked, how the user reacted, and
 * what UI block the user is likely looking at.
 *
 * This frame DOMINATES chip generation. Generic fallback chips must be
 * suppressed when the frame provides enough signal.
 *
 * Deterministic. No LLM calls.
 */

import type { ExplorationSessionState, CandidateSnapshot } from "@/lib/recommendation/domain/types"
import { inferLikelyReferencedBlock, type UIArtifactKind } from "./ui-context-extractor"

// ── User relation to the latest question ─────────────────────
export type UserRelation =
  | "direct_answer"        // user answered the question directly
  | "confusion"            // user is confused about the question/options
  | "challenge"            // user disagrees or questions availability ("4날 없어?")
  | "revise"               // user wants to change a prior selection
  | "followup_on_result"   // user is reacting to recommendation/comparison results
  | "compare_request"      // user wants to compare displayed products
  | "detail_request"       // user wants more detail about a product/condition
  | "meta_feedback"        // user is commenting on the system behavior
  | "restart"              // user wants to start over

// ── UI block the user is likely looking at ───────────────────
export type UIBlockReference =
  | "question_prompt"      // assistant just asked a question with options
  | "recommendation_card"  // a recommendation result is displayed
  | "comparison_table"     // a comparison table is displayed
  | "candidate_list"       // a list of candidates is shown
  | "cutting_conditions"   // cutting conditions are displayed
  | "chips_bar"            // user is looking at current chips
  | "explanation_text"     // assistant just explained something
  | "unknown"

// ── The Frame ────────────────────────────────────────────────
export interface RecentInteractionFrame {
  /** The assistant's latest question text, if any */
  latestAssistantQuestion: string | null
  /** The user's latest message */
  latestUserMessage: string
  /** How the user's message relates to the assistant's last question */
  relation: UserRelation
  /** Pending question info extracted from session */
  currentPendingQuestion: {
    kind: "binary" | "choice" | "field_selection" | "explanation" | "revision"
    field: string | null
    options: string[]
  } | null
  /** Which UI block the user is most likely reacting to */
  uiBlock: UIBlockReference
  /** Product codes the user is likely referencing */
  referencedProducts: string[]
  /** Whether existing context should be preserved */
  preserveContext: boolean
  /** Whether generic fallback chips should be suppressed */
  suppressGenericChips: boolean
  /** Which UI artifact the user is most likely reacting to */
  likelyReferencedUIBlock: UIArtifactKind
}

// ── Patterns ─────────────────────────────────────────────────
const CONFUSION_PATTERNS = [/뭔지.*몰라/, /몰라/, /모르겠/, /뭐야/, /뭐지/, /이해.*안/, /어려워/, /헷갈/, /뭐하는/]
const CHALLENGE_PATTERNS = [/없어\s*[?？]*/, /없나\s*[?？]*/, /없는거/, /안.*나와/, /왜.*없/, /0개/, /빠졌/, /못.*찾/]
const REVISE_PATTERNS = [/바꿔/, /변경/, /고치/, /다시.*고르/, /다시.*선택/, /이전으로/, /되돌/]
const COMPARE_PATTERNS = [/비교/, /차이/, /vs/, /어떤.*게.*나/, /뭐가.*다/]
const DETAIL_PATTERNS = [/절삭조건/, /가공조건/, /재고/, /납기/, /스펙/, /상세/, /자세히/]
const META_PATTERNS = [/칩.*만들/, /옵션.*만들/, /보기.*줘/, /선택지/, /기반으로/, /왜.*그래/, /어떻게.*된/]
const RESTART_PATTERNS = [/처음부터/, /리셋/, /다시.*시작/]
const RESULT_REACTION_PATTERNS = [/이.*제품/, /이거/, /추천.*제품/, /1번/, /2번/, /3번/, /대체/, /다른.*제품/]

/**
 * Build a recent interaction frame from the latest exchange.
 */
export function buildRecentInteractionFrame(
  latestAssistantText: string | null,
  latestUserMessage: string,
  sessionState: ExplorationSessionState | null
): RecentInteractionFrame {
  const clean = latestUserMessage.trim().toLowerCase()

  // 1. Detect user relation to the latest question
  const relation = detectRelation(clean, sessionState)

  // 2. Detect which UI block the user is likely looking at
  const uiBlock = detectUIBlock(sessionState, relation)

  // 3. Extract pending question from session
  const currentPendingQuestion = extractPendingQuestion(sessionState)

  // 4. Extract referenced products
  const referencedProducts = extractReferencedProducts(clean, sessionState)

  // 5. Determine if generic chips should be suppressed
  const suppressGenericChips =
    relation === "confusion" ||
    relation === "challenge" ||
    relation === "compare_request" ||
    relation === "detail_request" ||
    relation === "revise" ||
    relation === "meta_feedback" ||
    (relation === "followup_on_result" && referencedProducts.length > 0) ||
    currentPendingQuestion !== null

  // 6. Extract latest assistant question
  const latestAssistantQuestion = latestAssistantText
    ? extractQuestion(latestAssistantText)
    : null

  // 7. Infer which UI artifact the user is most likely reacting to
  const likelyReferencedUIBlock = inferLikelyReferencedBlock(sessionState, latestUserMessage)

  return {
    latestAssistantQuestion,
    latestUserMessage,
    relation,
    currentPendingQuestion,
    uiBlock,
    referencedProducts,
    preserveContext: relation !== "restart",
    suppressGenericChips,
    likelyReferencedUIBlock,
  }
}

function detectRelation(clean: string, sessionState: ExplorationSessionState | null): UserRelation {
  // Order matters — most specific first

  if (RESTART_PATTERNS.some(p => p.test(clean)) && clean.length < 20) return "restart"
  if (META_PATTERNS.some(p => p.test(clean))) return "meta_feedback"
  if (CHALLENGE_PATTERNS.some(p => p.test(clean))) return "challenge"
  if (CONFUSION_PATTERNS.some(p => p.test(clean))) return "confusion"
  if (COMPARE_PATTERNS.some(p => p.test(clean))) return "compare_request"
  if (DETAIL_PATTERNS.some(p => p.test(clean))) return "detail_request"
  if (REVISE_PATTERNS.some(p => p.test(clean))) return "revise"
  if (RESULT_REACTION_PATTERNS.some(p => p.test(clean))) return "followup_on_result"

  // If in resolved state and user says something, likely a follow-up on result
  if (sessionState?.resolutionStatus?.startsWith("resolved")) return "followup_on_result"

  return "direct_answer"
}

function detectUIBlock(
  sessionState: ExplorationSessionState | null,
  relation: UserRelation
): UIBlockReference {
  if (!sessionState) return "unknown"

  const lastAction = sessionState.lastAction
  const mode = sessionState.currentMode

  if (lastAction === "compare_products" || mode === "comparison") return "comparison_table"
  if (lastAction === "show_recommendation" || mode === "recommendation") return "recommendation_card"
  if (lastAction === "explain_product" || lastAction === "answer_general") return "explanation_text"

  if (relation === "confusion" || relation === "challenge") return "question_prompt"
  if (relation === "compare_request") return "candidate_list"

  if (sessionState.displayedCandidates?.length > 0 && sessionState.resolutionStatus?.startsWith("resolved")) {
    return "recommendation_card"
  }

  if (sessionState.displayedOptions?.length > 0 || sessionState.displayedChips?.length > 0) {
    return "question_prompt"
  }

  return "unknown"
}

function extractPendingQuestion(
  sessionState: ExplorationSessionState | null
): RecentInteractionFrame["currentPendingQuestion"] {
  if (!sessionState) return null

  const field = sessionState.lastAskedField ?? null
  const options = (sessionState.displayedOptions ?? [])
    .map(o => o.value)
    .filter(v => v && v !== "skip")

  if (options.length === 0 && !field) return null

  const kind: "binary" | "choice" | "field_selection" | "explanation" | "revision" =
    options.length === 2 ? "binary"
    : options.length > 2 ? "choice"
    : field ? "field_selection"
    : "choice"

  return { kind, field, options }
}

function extractReferencedProducts(
  clean: string,
  sessionState: ExplorationSessionState | null
): string[] {
  if (!sessionState?.displayedCandidates) return []

  const products: string[] = []

  // Product code mentions
  const codeMatch = clean.match(/(ce\d+[a-z]*\d*|gnx\d+|sem[a-z]*\d+)/gi)
  if (codeMatch) products.push(...codeMatch.map(m => m.toUpperCase()))

  // Rank references
  const rankMatches = Array.from(clean.matchAll(/(\d+)\s*번/g))
  for (const m of rankMatches) {
    const rank = parseInt(m[1])
    const candidate = sessionState.displayedCandidates.find(c => c.rank === rank)
    if (candidate) products.push(candidate.displayCode)
  }

  return products
}

function extractQuestion(text: string): string | null {
  const sentences = text.split(/[.。!\n]/).filter(s => s.trim().length > 3)
  const questionSentences = sentences.filter(s =>
    /[?？]/.test(s) || /시겠|할까|원하시|보시겠|하실래|괜찮/.test(s)
  )
  return questionSentences.length > 0
    ? questionSentences[questionSentences.length - 1].trim()
    : null
}
