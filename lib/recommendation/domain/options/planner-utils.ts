/**
 * Shared utilities for option planning modules.
 *
 * Counter, ID generation, and field label helpers.
 */

import type { SmartOptionFamily } from "./types"

let optionCounter = 0

export function nextOptionId(family: SmartOptionFamily): string {
  return `${family}_${++optionCounter}`
}

/** Reset counter between test runs */
export function resetOptionCounter(): void {
  optionCounter = 0
}

export function getFieldLabel(field: string): string {
  const labels: Record<string, string> = {
    material: "소재", coating: "코팅", diameterMm: "직경",
    fluteCount: "날 수", toolSubtype: "공구 형상", seriesName: "시리즈",
    cuttingType: "가공 유형", operationType: "가공 방식", workPieceName: "세부 피삭재",
  }
  return labels[field] ?? field
}
