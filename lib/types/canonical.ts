// ============================================================
// YG-1 AI Assistant — Canonical Data Types
// Source of truth for all data models in the system.
// LLM never generates values for these fields — only real data.
// ============================================================

import { z } from "zod"

// ── Source Priority ──────────────────────────────────────────
export type SourcePriority = 1 | 2 | 3 | 4 | 5
export type SourceType = "smart-catalog" | "catalog-csv" | "inventory" | "lead-time" | "competitor" | "llm"
export type MatchStatus = "exact" | "approximate" | "none"
export type StockStatus = "instock" | "limited" | "outofstock" | "unknown"

// ── Material Taxonomy ────────────────────────────────────────
export const MaterialTaxonomySchema = z.object({
  tag: z.string(),               // ISO tag: P, M, K, N, S, H
  displayNameKo: z.string(),
  displayNameEn: z.string(),
  aliases: z.array(z.string()),  // all name variants for matching
  rawNamesByLocale: z.record(z.string()),
})
export type MaterialTaxonomy = z.infer<typeof MaterialTaxonomySchema>

// ── Product Evidence ─────────────────────────────────────────
export const ProductEvidenceSchema = z.object({
  productCode: z.string(),
  normalizedCode: z.string(),
  pdfFile: z.string().nullable(),
  referencePages: z.array(z.string()),
  dataPage: z.string().nullable(),
  pageTitle: z.string().nullable(),
  imagePath: z.string().nullable(),
  markdownPath: z.string().nullable(),
  notes: z.string().nullable(),
  confidence: z.string().nullable(),
})
export type ProductEvidence = z.infer<typeof ProductEvidenceSchema>

// ── Canonical Product ────────────────────────────────────────
export const CanonicalProductSchema = z.object({
  id: z.string(),                        // internal UUID
  manufacturer: z.string(),
  brand: z.string(),
  sourcePriority: z.number() as z.ZodType<SourcePriority>,
  sourceType: z.string() as z.ZodType<SourceType>,
  rawSourceFile: z.string(),
  rawSourceSheet: z.string().nullable(),

  // Codes
  normalizedCode: z.string(),            // UPPERCASE, no spaces/hyphens
  displayCode: z.string(),               // original EDP as-is
  seriesName: z.string().nullable(),
  productName: z.string().nullable(),

  // Geometry
  toolType: z.string().nullable(),       // e.g. "Solid", "Indexable"
  toolSubtype: z.string().nullable(),    // e.g. "Square", "Ball", "High-Feed"
  diameterMm: z.number().nullable(),
  diameterInch: z.number().nullable(),
  fluteCount: z.number().nullable(),
  coating: z.string().nullable(),
  toolMaterial: z.string().nullable(),
  shankDiameterMm: z.number().nullable(),
  lengthOfCutMm: z.number().nullable(),
  overallLengthMm: z.number().nullable(),
  helixAngleDeg: z.number().nullable(),
  ballRadiusMm: z.number().nullable(),
  taperAngleDeg: z.number().nullable(),
  coolantHole: z.boolean().nullable(),

  // Application
  applicationShapes: z.array(z.string()),  // Side_Milling, Slotting, etc.
  materialTags: z.array(z.string()),        // ISO tags: P, M, K, N, S, H

  // Meta
  region: z.string().nullable(),
  description: z.string().nullable(),
  featureText: z.string().nullable(),       // HTML stripped to plain text
  seriesIconUrl: z.string().nullable(),

  // Quality
  sourceConfidence: z.string().nullable(),  // high/medium/low
  dataCompletenessScore: z.number(),        // 0-1

  // Evidence refs
  evidenceRefs: z.array(z.string()),        // product codes in evidence DB
})
export type CanonicalProduct = z.infer<typeof CanonicalProductSchema>

// ── Inventory Snapshot ───────────────────────────────────────
export const InventorySnapshotSchema = z.object({
  edp: z.string(),
  normalizedEdp: z.string(),
  description: z.string().nullable(),
  spec: z.string().nullable(),
  warehouseOrRegion: z.string(),
  quantity: z.number().nullable(),
  snapshotDate: z.string().nullable(),
  price: z.number().nullable(),
  currency: z.string().nullable(),
  unit: z.string().nullable(),
  sourceFile: z.string(),
})
export type InventorySnapshot = z.infer<typeof InventorySnapshotSchema>

// ── Lead Time Record ─────────────────────────────────────────
export const LeadTimeRecordSchema = z.object({
  edp: z.string(),
  normalizedEdp: z.string(),
  plant: z.string(),
  leadTimeDays: z.number().nullable(),
})
export type LeadTimeRecord = z.infer<typeof LeadTimeRecordSchema>

// ── Recommendation Input ─────────────────────────────────────
export const RecommendationInputSchema = z.object({
  queryText: z.string().optional(),
  material: z.string().optional(),       // Korean or English material name
  operationType: z.string().optional(),  // 황삭/정삭/고이송/측면/슬롯 etc.
  toolType: z.string().optional(),
  toolSubtype: z.string().optional(),
  diameterMm: z.number().optional(),
  diameterUnit: z.enum(["mm", "inch"]).optional(),
  flutePreference: z.number().optional(),
  coatingPreference: z.string().optional(),
  manufacturerScope: z.enum(["yg1-only", "include-competitor"]).default("yg1-only"),
  locale: z.string().default("ko"),
  region: z.string().optional(),  // DB region codes: "KOR", "ENG", "CHN", ... or "ALL"
  unitSystem: z.enum(["METRIC", "INCH", "ALL"]).optional(),
})
export type RecommendationInput = z.infer<typeof RecommendationInputSchema>

// ── Score Breakdown (Explainable AI) ─────────────────────────
export interface ScoreBreakdown {
  diameter: { score: number; max: number; detail: string }
  flutes: { score: number; max: number; detail: string }
  materialTag: { score: number; max: number; detail: string }
  operation: { score: number; max: number; detail: string }
  coating: { score: number; max: number; detail: string }
  completeness: { score: number; max: number; detail: string }
  evidence: { score: number; max: number; detail: string }
  total: number
  maxTotal: number
  matchPct: number  // 0-100
}

// ── Scored Product ───────────────────────────────────────────
export interface ScoredProduct {
  product: CanonicalProduct
  score: number
  scoreBreakdown: ScoreBreakdown | null
  matchedFields: string[]
  matchStatus: MatchStatus
  inventory: InventorySnapshot[]
  leadTimes: LeadTimeRecord[]
  evidence: ProductEvidence[]
  stockStatus: StockStatus
  totalStock: number | null
  minLeadTimeDays: number | null
}

// ── Recommendation Result ────────────────────────────────────
export interface RecommendationResult {
  status: MatchStatus
  query: RecommendationInput
  primaryProduct: ScoredProduct | null
  alternatives: ScoredProduct[]
  warnings: string[]
  rationale: string[]
  sourceSummary: string[]
  deterministicSummary: string
  llmSummary: string | null
  totalCandidatesConsidered: number
}

// ── Chat Message (for LLM conversation) ─────────────────────
export interface ChatMessage {
  role: "user" | "ai"
  text: string
}

// ── LLM Response (from /api/recommend) ──────────────────────
export interface LLMRecommendResponse {
  text: string
  purpose?: string
  chips?: string[]
  extractedField?: {
    label: string
    value: string
    confidence: "high" | "medium" | "low"
    step?: number
  } | null
  isComplete: boolean
  recommendation?: RecommendationResult | null
  error?: string
  detail?: string
}
