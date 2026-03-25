/**
 * LLM Chip Pipeline — Extract, validate, and convert LLM-suggested chips
 * into DisplayedOption[] for the UI.
 *
 * Pure deterministic validation — no LLM calls.
 */

import type {
  CandidateSnapshot,
  DisplayedOption,
  ExplorationSessionState,
} from "@/lib/recommendation/domain/types"

// ── Types ───────────────────────────────────────────────────────

export interface LlmSuggestedChip {
  label: string
  type: "option" | "action" | "filter" | "navigation"
}

const VALID_CHIP_TYPES = new Set<LlmSuggestedChip["type"]>([
  "option",
  "action",
  "filter",
  "navigation",
])

const MAX_LABEL_LENGTH = 20
const MAX_CHIPS = 10

// Type priority for sorting (lower = higher priority)
const TYPE_PRIORITY: Record<LlmSuggestedChip["type"], number> = {
  option: 0,
  filter: 1,
  action: 2,
  navigation: 3,
}

// ── Filterable fields whitelist ──────────────────────────────────
// Only fields that actually exist in the product DB and have in-memory
// filter handlers in hybrid-retrieval.ts are allowed.
// Chips referencing non-filterable fields (e.g. RPM, 가격, 납기) must be blocked.
export const FILTERABLE_FIELDS = new Set([
  "fluteCount",
  "coating",
  "materialTag",
  "toolSubtype",
  "seriesName",
  "toolMaterial",
  "toolType",
  "brand",
  "edpBrandName",
  "edpSeriesName",
  "coolantHole",
  "shankDiameterMm",
  "lengthOfCutMm",
  "overallLengthMm",
  "helixAngleDeg",
  "workPieceName",
  "diameterMm",
])

// Keywords that indicate a chip references a non-filterable concept
const NON_FILTERABLE_KEYWORDS = /회전수|RPM|rpm|이송|절삭속도|Vc|절삭조건범위|가격|납기|무게|경도|인장강도|토크|스핀들/i

/**
 * Returns true if a chip label references a field that cannot be filtered in the DB.
 */
export function isUnfilterableChip(label: string): boolean {
  return NON_FILTERABLE_KEYWORDS.test(label)
}

// ── Filter detection patterns ───────────────────────────────────

interface FilterDetection {
  field: string
  value: string
}

function detectFilterFromLabel(label: string): FilterDetection | null {
  // fluteCount: "3날", "4날", etc.
  const fluteMatch = label.match(/(\d+)날/)
  if (fluteMatch) {
    return { field: "fluteCount", value: fluteMatch[1] }
  }

  // stockStatus: "재고 있음", "재고있는", etc.
  if (/재고.*있/.test(label)) {
    return { field: "stockStatus", value: "instock" }
  }

  // coating
  const coatingMatch = label.match(/(DLC|TiAlN|AlTiN|코팅)/i)
  if (coatingMatch) {
    return { field: "coating", value: coatingMatch[1] }
  }

  // toolSubtype
  const subtypeMatch = label.match(/(Square|Radius|Ball)/i)
  if (subtypeMatch) {
    return { field: "toolSubtype", value: subtypeMatch[1] }
  }

  return null
}

// ── Extract ─────────────────────────────────────────────────────

/**
 * Extract suggestedChips from LLM response JSON.
 * Returns empty array if not present or malformed.
 */
export function extractSuggestedChips(
  llmResponseJson: Record<string, unknown>,
): LlmSuggestedChip[] {
  const raw = llmResponseJson.suggestedChips
  if (!Array.isArray(raw)) return []

  const chips: LlmSuggestedChip[] = []

  for (const item of raw) {
    if (chips.length >= MAX_CHIPS) break
    if (item == null || typeof item !== "object") continue

    const obj = item as Record<string, unknown>
    const label = typeof obj.label === "string" ? obj.label.trim() : ""
    const type = obj.type as string

    if (!label || label.length > MAX_LABEL_LENGTH) continue
    if (!VALID_CHIP_TYPES.has(type as LlmSuggestedChip["type"])) continue

    chips.push({ label, type: type as LlmSuggestedChip["type"] })
  }

  return chips
}

// ── Build Final Chips ───────────────────────────────────────────

/**
 * Full pipeline: extract → validate → fallback → convert to DisplayedOptions.
 */
export function buildFinalChipsFromLLM(
  llmChips: LlmSuggestedChip[],
  sessionState: ExplorationSessionState | null,
  candidates: CandidateSnapshot[],
  previousChips: string[],
): { displayedOptions: DisplayedOption[]; chips: string[] } {
  // Normalize previous chips for robust dedup (case-insensitive, trim whitespace)
  const prevSet = new Set(previousChips.map(c => c.trim().toLowerCase().replace(/\s+/g, "")))

  // 1. Deduplicate vs previous turn (normalized comparison)
  let chips = llmChips.filter((c) => !prevSet.has(c.label.trim().toLowerCase().replace(/\s+/g, "")))

  // 2. Block chips that reference non-filterable DB fields (e.g. RPM, 가격)
  chips = chips.filter((c) => {
    if (isUnfilterableChip(c.label)) {
      console.log(`[llm-chip-pipeline] Blocked unfilterable chip: "${c.label}"`)
      return false
    }
    return true
  })

  // 3. Validate filter chips against actual candidate values
  chips = chips.filter((c) => {
    if (c.type !== "filter") return true
    const detection = detectFilterFromLabel(c.label)
    if (!detection) return true // keep unrecognized filters (LLM may know better)
    // Check at least one candidate has the referenced value
    return candidates.some((cand) => {
      const val = cand[detection.field as keyof CandidateSnapshot]
      return String(val) === detection.value
    })
  })

  // 4. Add mandatory fallback chips based on state
  const existingLabels = new Set(chips.map((c) => c.label))

  if (sessionState?.lastAskedField) {
    // Narrowing mode: ensure skip and back navigation
    if (!existingLabels.has("상관없음")) {
      chips.push({ label: "상관없음", type: "option" })
      existingLabels.add("상관없음")
    }
    if (!existingLabels.has("← 이전")) {
      chips.push({ label: "← 이전", type: "navigation" })
      existingLabels.add("← 이전")
    }
  }

  if (candidates.length > 0) {
    // Post-rec: ensure at least one exploration chip
    const hasExplore = chips.some(
      (c) => c.type === "action" || c.type === "filter",
    )
    if (!hasExplore && !existingLabels.has("더 보기")) {
      chips.push({ label: "더 보기", type: "action" })
      existingLabels.add("더 보기")
    }
  }

  if (sessionState?.suspendedFlow) {
    if (!existingLabels.has("추천 이어가기")) {
      chips.push({ label: "추천 이어가기", type: "action" })
      existingLabels.add("추천 이어가기")
    }
  }

  // 5. Sort by type priority
  chips.sort((a, b) => TYPE_PRIORITY[a.type] - TYPE_PRIORITY[b.type])

  // 6. Limit
  chips = chips.slice(0, MAX_CHIPS)

  // 7. Convert to DisplayedOption[]
  const lastAskedField = sessionState?.lastAskedField

  const displayedOptions: DisplayedOption[] = chips.map((chip, idx) => {
    let field: string
    let value: string

    switch (chip.type) {
      case "option":
        field = lastAskedField ?? "_option"
        value = chip.label
        break
      case "action":
        field = "_action"
        value = chip.label
        break
      case "filter": {
        const detection = detectFilterFromLabel(chip.label)
        field = detection?.field ?? "_filter"
        value = detection?.value ?? chip.label
        break
      }
      case "navigation":
        field = "_control"
        value = chip.label
        break
    }

    return {
      index: idx + 1,
      label: chip.label,
      field,
      value,
      count: 0,
    }
  })

  return {
    displayedOptions,
    chips: displayedOptions.map((o) => o.label),
  }
}
