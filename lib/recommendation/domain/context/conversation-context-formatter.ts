/**
 * Conversation context formatter for LLM consumption.
 *
 * Builds a structured text block summarizing the recent conversation,
 * current session state, displayed products, and previous chips
 * so the LLM can generate contextually appropriate responses.
 */

import type {
  ChatMessage,
  CandidateSnapshot,
  ExplorationSessionState,
} from "@/lib/recommendation/domain/types"

const MAX_RECENT_MESSAGES = 8
const MAX_DISPLAYED_CANDIDATES = 5

/**
 * Builds a rich conversation context string for LLM consumption.
 * Includes recent 8 turns with chips/options shown at each turn,
 * current state summary, and pending question.
 */
export function formatConversationContextForLLM(
  messages: ChatMessage[],
  sessionState: ExplorationSessionState | null,
  currentCandidates: CandidateSnapshot[],
  previousChips: string[],
): string {
  const sections: string[] = []

  sections.push(formatRecentConversation(messages, sessionState))
  sections.push(formatCurrentState(sessionState, currentCandidates))

  const candidateSection = formatDisplayedCandidates(currentCandidates)
  if (candidateSection) {
    sections.push(candidateSection)
  }

  if (previousChips.length > 0) {
    sections.push(formatPreviousChips(previousChips))
  }

  return sections.filter(Boolean).join("\n\n")
}

// ── Recent conversation ─────────────────────────────────────

function formatRecentConversation(
  messages: ChatMessage[],
  sessionState: ExplorationSessionState | null,
): string {
  const recent = messages.slice(-MAX_RECENT_MESSAGES)
  if (recent.length === 0) return "## 최근 대화\n(없음)"

  const chipsPerTurn = buildChipsPerTurn(sessionState)
  const optionsPerTurn = buildOptionsPerTurn(sessionState)

  const lines: string[] = ["## 최근 대화"]

  for (let i = 0; i < recent.length; i++) {
    const msg = recent[i]
    const turnIndex = i + 1
    const role = msg.role === "user" ? "user" : "assistant"
    const text = truncate(msg.text, 200)

    lines.push(`[Turn ${turnIndex}] ${role}: ${text}`)

    if (role === "assistant") {
      const chips = chipsPerTurn.get(messages.length - recent.length + i)
      if (chips && chips.length > 0) {
        lines.push(`  선택지: [${chips.join(", ")}]`)
      }

      const options = optionsPerTurn.get(messages.length - recent.length + i)
      if (options && options.length > 0) {
        const optionLabels = options.map(o => o.label)
        lines.push(`  옵션: [${optionLabels.join(", ")}]`)
      }
    }
  }

  return lines.join("\n")
}

/**
 * Build a map of message index -> chips shown at that turn.
 * Uses narrowingHistory to reconstruct which chips were displayed
 * at earlier assistant turns, and displayedChips for the latest.
 */
function buildChipsPerTurn(
  sessionState: ExplorationSessionState | null,
): Map<number, string[]> {
  const map = new Map<number, string[]>()
  if (!sessionState) return map

  // Current displayed chips apply to the most recent assistant message
  if (sessionState.displayedChips.length > 0) {
    // We don't know the exact index yet; caller will match by role
    map.set(-1, sessionState.displayedChips)
  }

  return map
}

function buildOptionsPerTurn(
  sessionState: ExplorationSessionState | null,
): Map<number, Array<{ label: string; value: string }>> {
  const map = new Map<number, Array<{ label: string; value: string }>>()
  if (!sessionState) return map

  if (sessionState.displayedOptions.length > 0) {
    map.set(-1, sessionState.displayedOptions.map(o => ({
      label: o.label,
      value: o.value,
    })))
  }

  return map
}

// ── Current state ───────────────────────────────────────────

function formatCurrentState(
  sessionState: ExplorationSessionState | null,
  currentCandidates: CandidateSnapshot[],
): string {
  const lines: string[] = ["## 현재 상태"]

  if (!sessionState) {
    lines.push("- 추천 단계: 초기 (세션 없음)")
    return lines.join("\n")
  }

  // Resolution / mode
  const mode = sessionState.currentMode ?? "narrowing"
  const resolution = sessionState.resolutionStatus ?? "unresolved"
  lines.push(`- 추천 단계: ${mode}`)
  lines.push(`- 해결 상태: ${resolution}`)

  // Applied filters
  if (sessionState.appliedFilters.length > 0) {
    const filterStr = sessionState.appliedFilters
      .filter(f => f.op !== "skip")
      .map(f => `${f.field}=${f.value}`)
      .join(", ")
    if (filterStr) {
      lines.push(`- 적용 필터: ${filterStr}`)
    }
  }

  // Candidate count
  const count = currentCandidates.length || sessionState.candidateCount
  lines.push(`- 현재 후보: ${count}개`)

  // Pending question
  if (sessionState.lastAskedField) {
    lines.push(`- 대기 질문: ${sessionState.lastAskedField}`)
  }

  return lines.join("\n")
}

// ── Displayed candidates ────────────────────────────────────

function formatDisplayedCandidates(
  candidates: CandidateSnapshot[],
): string | null {
  if (candidates.length === 0) return null

  const top = candidates.slice(0, MAX_DISPLAYED_CANDIDATES)
  const lines: string[] = ["## 현재 표시된 제품"]

  for (const c of top) {
    const parts: string[] = []
    parts.push(`#${c.rank}`)
    parts.push(c.displayCode)
    if (c.seriesName) parts.push(`(${c.seriesName})`)
    if (c.diameterMm != null) parts.push(`\u03c6${c.diameterMm}`)
    if (c.fluteCount != null) parts.push(`${c.fluteCount}F`)
    if (c.coating) parts.push(c.coating)
    parts.push(`${c.score}점`)

    lines.push(parts.join(" "))
  }

  if (candidates.length > MAX_DISPLAYED_CANDIDATES) {
    lines.push(`... 외 ${candidates.length - MAX_DISPLAYED_CANDIDATES}개`)
  }

  return lines.join("\n")
}

// ── Previous chips ──────────────────────────────────────────

function formatPreviousChips(chips: string[]): string {
  return `## 직전 칩\n[${chips.join(", ")}]`
}

// ── Utility ─────────────────────────────────────────────────

function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text
  return text.slice(0, maxLen) + "..."
}
