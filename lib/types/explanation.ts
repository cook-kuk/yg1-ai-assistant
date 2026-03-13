// ============================================================
// Recommendation Explanation Types
// Structured matched/unmatched facts with supporting evidence.
// All facts come from canonical data — never LLM-generated.
// ============================================================

import type { CuttingConditions } from "./evidence"

// ── Matched Fact ────────────────────────────────────────────
export interface MatchedFact {
  field: string                // e.g. "diameter", "materialTag", "fluteCount"
  label: string                // Korean display: "직경", "소재군", "날 수"
  requestedValue: string       // what user asked for
  productValue: string         // what the product has
  matchType: "exact" | "close" | "partial"
  score: number                // contribution to total score
  maxScore: number             // maximum possible for this dimension
}

// ── Unmatched Fact ───────────────────────────────────────────
export interface UnmatchedFact {
  field: string
  label: string
  requestedValue: string
  productValue: string | null  // null = data not available
  reason: string               // Korean explanation
  impact: "critical" | "moderate" | "minor"
}

// ── Supporting Evidence ─────────────────────────────────────
export interface SupportingEvidence {
  type: "cutting_condition" | "catalog_spec" | "inventory" | "lead_time"
  summary: string              // Korean one-liner
  conditions: CuttingConditions | null
  confidence: number           // 0-1
  source: string               // e.g. "yg1_4G_mill p.47"
  sourceCount: number
}

// ── Full Recommendation Explanation ─────────────────────────
export interface RecommendationExplanation {
  productCode: string
  displayCode: string
  matchPct: number             // 0-100
  matchStatus: "exact" | "approximate" | "none"
  matchedFacts: MatchedFact[]
  unmatchedFacts: UnmatchedFact[]
  supportingEvidence: SupportingEvidence[]
  warnings: string[]
  summaryText: string          // deterministic Korean summary
}
