// 전략/관리 시리즈 부스트 — data/preferred-series.json 기반.
// match-engine.ts에서 score 계산 후 가산되어, 동등한 적합도에서 우선 노출시킨다.
// 박소영 피드백(2026-04-06): 'CGM3S37 시리즈가 우선적으로 추천되었으면 합니다.'

import fs from "fs"
import path from "path"

interface BoostEntry {
  series: string
  boost: number
  reason?: string
}

let cache: Map<string, number> | null = null

function normalizeKey(s: string): string {
  return s.toUpperCase().replace(/[\s\-./_]+/g, "")
}

function loadOnce(): Map<string, number> {
  if (cache) return cache
  cache = new Map()
  try {
    const filePath = path.join(process.cwd(), "data", "preferred-series.json")
    const raw = fs.readFileSync(filePath, "utf8")
    const parsed = JSON.parse(raw) as { boosts?: BoostEntry[] }
    for (const b of parsed.boosts ?? []) {
      if (b.series && typeof b.boost === "number") {
        cache.set(normalizeKey(b.series), b.boost)
      }
    }
    console.log(`[preferred-series] loaded ${cache.size} boost entries`)
  } catch (err) {
    console.warn(`[preferred-series] load failed:`, (err as Error).message)
  }
  return cache
}

export function getPreferredSeriesBoost(seriesName: string | null | undefined, brand: string | null | undefined): number {
  if (!seriesName && !brand) return 0
  const map = loadOnce()
  if (map.size === 0) return 0
  if (seriesName) {
    const v = map.get(normalizeKey(seriesName))
    if (v) return v
  }
  if (brand) {
    const v = map.get(normalizeKey(brand))
    if (v) return v
  }
  return 0
}
