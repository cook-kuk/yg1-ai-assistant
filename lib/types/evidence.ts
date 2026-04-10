// ============================================================
// YG-1 AI Assistant — Evidence Chunk Types
// Cutting condition data extracted from PDF catalogs.
// Each chunk = one product × one ISO group × one cutting type.
// ============================================================

/** Cutting condition values (strings as-is from catalog) */
export interface CuttingConditions {
  Vc: string | null   // cutting speed, e.g. "330 m/min"
  n: string | null     // spindle speed, e.g. "35000 rpm"
  fz: string | null    // feed per tooth, e.g. "0.040 mm/tooth"
  vf: string | null    // table feed, e.g. "2800 mm/min"
  ap: string | null    // depth of cut, e.g. "0.02D" or "1.5 mm"
  ae: string | null    // radial depth, e.g. "0.05D" or "6.0 mm"
}

/** A single evidence chunk — one row of cutting condition data */
export interface EvidenceChunk {
  id: string                      // stable hash ID: "ev-{hash12}"
  productCode: string             // normalized (uppercase, no spaces/hyphens)
  seriesName: string | null
  toolType: string | null         // "End Mill", "Drill", etc.
  toolSubtype: string | null      // "Ball End Mill", "Square", etc.
  cuttingType: string | null      // "Slotting", "Side Cutting", etc.
  isoGroup: string | null         // "P", "M", "K", "N", "S", "H"
  diameterMm: number | null
  conditions: CuttingConditions
  coating: string | null
  toolMaterial: string | null
  fluteCount: number | null
  helixAngle: number | null
  confidence: number              // 0-1 from extraction pipeline
  sourceFile: string              // "yg1_4G_mill" | "yg1_alu_cut"
  pdfFile: string | null          // original PDF filename
  referencePages: string | null   // page numbers in PDF
  pageTitle: string | null        // catalog page title (legacy: also workpiece for older rows)
  searchText: string              // concatenated text for lexical search
  // ── Harvey-MAP 수준 세부 필드 (merged_all_clean.csv 기반, 일부 chunk 는 미보유) ──
  workpiece?: string | null        // 소재 세부등급 (예: SUS304, 프리하든강, 가단주철)
  hardnessHrc?: string | null      // 경도 범위 텍스트 (예: "35~45", "55~65")
  toolShape?: string | null        // 공구 형상 (예: 볼, 스퀘어, 래디우스, 롱넥 볼)
}

/** Numeric range aggregated across many chunks */
export interface ConditionRange {
  min: number
  max: number
  count: number
}

/** Per-ISO-group Vc/fz range across the entire series (ignoring diameter filter) */
export interface SeriesIsoRange {
  isoGroup: string
  vc: ConditionRange | null
  fz: ConditionRange | null
  ap: ConditionRange | null
  ae: ConditionRange | null
  count: number
}

/** Summary of evidence for a product (used in API responses) */
export interface EvidenceSummary {
  productCode: string
  seriesName: string | null
  chunks: EvidenceChunk[]
  bestCondition: CuttingConditions | null  // highest confidence match
  bestConfidence: number
  sourceCount: number
  /** Series-level Vc/fz/ap/ae ranges grouped by ISO group (for "권장 절삭조건: Vc 80~120" UI) */
  seriesRangeByIso?: SeriesIsoRange[]
}
