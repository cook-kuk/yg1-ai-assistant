// ============================================================
// Fact Check Types
// VerifiedField<T> wraps every displayed value with verification status.
// FactCheckedRecommendation = render-safe output after 5-step check.
// ============================================================

import type { CuttingConditions } from "./evidence"
import type { RecommendationExplanation } from "./explanation"

// ── Verification Status ─────────────────────────────────────
export type VerificationStatus =
  | "verified"     // confirmed from canonical data
  | "partial"      // partially confirmed (some data missing)
  | "conflict"     // data conflict between sources
  | "unverified"   // data not available for verification

// ── Verified Field ──────────────────────────────────────────
export interface VerifiedField<T> {
  value: T
  status: VerificationStatus
  source: string              // which repo/data source confirmed this
  checkedAt: string           // step name: "product_identity" | "spec_check" | "cutting_condition" | "inventory_check" | "render_safe"
}

// ── Fact Check Step Result ──────────────────────────────────
export interface FactCheckStep {
  step: number                // 1-5
  name: string                // "product_identity" | "spec_check" | "cutting_condition" | "inventory_check" | "render_safe"
  label: string               // Korean label
  passed: boolean
  issues: string[]            // any problems found
  fieldsChecked: number
  fieldsVerified: number
}

// ── Fact Check Report ───────────────────────────────────────
export interface FactCheckReport {
  steps: FactCheckStep[]
  overallStatus: VerificationStatus
  totalFieldsChecked: number
  totalFieldsVerified: number
  verificationPct: number     // 0-100
  criticalIssues: string[]
}

// ── Fact-Checked Recommendation ─────────────────────────────
export interface FactCheckedRecommendation {
  // Product identity (Step 1)
  productCode: VerifiedField<string>
  displayCode: VerifiedField<string>
  seriesName: VerifiedField<string | null>
  manufacturer: VerifiedField<string>

  // Specs (Step 2)
  diameterMm: VerifiedField<number | null>
  fluteCount: VerifiedField<number | null>
  coating: VerifiedField<string | null>
  toolMaterial: VerifiedField<string | null>
  materialTags: VerifiedField<string[]>
  lengthOfCutMm: VerifiedField<number | null>
  overallLengthMm: VerifiedField<number | null>

  // Cutting conditions (Step 3)
  hasCuttingConditions: boolean
  bestCondition: VerifiedField<CuttingConditions | null>
  conditionConfidence: VerifiedField<number>
  conditionSourceCount: VerifiedField<number>

  // Inventory & lead time (Step 4)
  stockStatus: VerifiedField<string>
  totalStock: VerifiedField<number | null>
  minLeadTimeDays: VerifiedField<number | null>

  // Scores (Step 5 — render-safe)
  matchPct: number
  matchStatus: "exact" | "approximate" | "none"
  score: number

  // Explanation layer
  explanation: RecommendationExplanation

  // Fact check report
  factCheckReport: FactCheckReport
}
