import { NextRequest, NextResponse } from "next/server"
import { EvidenceRepo } from "@/lib/data/repos/evidence-repo"

// 조건 기반 공구 시리즈 추천 — Harvey MAP식
// 입력: ISO, 직경, 형상, 가공형상 (optional)
// 출력: 매칭 점수가 높은 시리즈 top N
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const iso = searchParams.get("iso")
  const diameter = searchParams.get("diameter")
  const shape = searchParams.get("shape") // square/ball/radius/chamfer
  const hardness = searchParams.get("hardness")
  const limit = parseInt(searchParams.get("limit") ?? "8")

  if (!iso) return NextResponse.json({ error: "iso required" }, { status: 400 })

  try {
    const D = diameter ? parseFloat(diameter) : undefined

    // Fetch all chunks matching ISO (loose filter)
    const chunks = await EvidenceRepo.filterByConditions({
      isoGroup: iso,
      diameterMm: D ?? null,
      toleranceMm: D ? Math.max(1, D * 0.3) : undefined, // ±30% diameter tolerance
    })

    // Group by seriesName
    interface SeriesAgg {
      seriesName: string
      count: number
      isoGroups: Set<string>
      diameters: Set<number>
      cuttingTypes: Set<string>
      toolShapes: Set<string>
      workpieces: Set<string>
      hardnesses: Set<string>
      avgConfidence: number
      confidenceSum: number
    }
    const groups = new Map<string, SeriesAgg>()
    for (const c of chunks) {
      const key = c.seriesName ?? ""
      if (!key) continue
      if (!groups.has(key)) {
        groups.set(key, {
          seriesName: key, count: 0,
          isoGroups: new Set(), diameters: new Set(), cuttingTypes: new Set(),
          toolShapes: new Set(), workpieces: new Set(), hardnesses: new Set(),
          avgConfidence: 0, confidenceSum: 0,
        })
      }
      const g = groups.get(key)!
      g.count++
      if (c.isoGroup) g.isoGroups.add(c.isoGroup.toUpperCase())
      if (c.diameterMm != null) g.diameters.add(c.diameterMm)
      if (c.cuttingType) g.cuttingTypes.add(c.cuttingType)
      if (c.toolShape) g.toolShapes.add(c.toolShape)
      if (c.workpiece) g.workpieces.add(c.workpiece)
      if (c.hardnessHrc) g.hardnesses.add(c.hardnessHrc)
      g.confidenceSum += c.confidence ?? 0.5
    }

    // Compute match score
    const shapeKeywords: Record<string, string[]> = {
      square: ["스퀘어", "square", "사이드", "slot", "슬로팅"],
      ball: ["볼", "ball", "nose"],
      radius: ["래디우스", "radius", "코너", "corner"],
      chamfer: ["챔퍼", "chamfer", "챔퍼링", "모따기", "deburr"],
    }

    const results: Array<{
      series: string
      score: number
      count: number
      diameters: number[]
      cuttingTypes: string[]
      toolShapes: string[]
      sampleWorkpieces: string[]
      hardnessRanges: string[]
      matchReasons: string[]
      closestDiameter: number | null
    }> = []

    for (const g of groups.values()) {
      let score = 0
      const reasons: string[] = []
      // ISO match
      if (g.isoGroups.has(iso.toUpperCase())) { score += 40; reasons.push(`ISO ${iso} ✓`) }
      // Diameter proximity
      let closestD: number | null = null
      if (D && g.diameters.size > 0) {
        const sorted = [...g.diameters].sort((a, b) => Math.abs(a - D) - Math.abs(b - D))
        closestD = sorted[0]
        const dev = Math.abs(closestD - D) / D
        if (dev < 0.05) { score += 30; reasons.push(`⌀${closestD}mm 정확 매칭`) }
        else if (dev < 0.15) { score += 20; reasons.push(`⌀${closestD}mm 근사 (${(dev*100).toFixed(0)}%)`) }
        else if (dev < 0.30) { score += 10; reasons.push(`⌀${closestD}mm 범위 (${(dev*100).toFixed(0)}%)`) }
      }
      // Shape keyword match
      if (shape && shapeKeywords[shape]) {
        const kws = shapeKeywords[shape]
        const shapesStr = [...g.toolShapes, ...g.cuttingTypes].join(" ").toLowerCase()
        const matched = kws.some(kw => shapesStr.includes(kw.toLowerCase()))
        if (matched) { score += 20; reasons.push(`형상 ${shape} ✓`) }
      }
      // Hardness (loose — any overlap)
      if (hardness && g.hardnesses.size > 0) {
        const hardnessesStr = [...g.hardnesses].join(" ")
        if (hardnessesStr.includes(hardness.replace(/[^0-9]/g, ""))) {
          score += 10; reasons.push(`경도 ${hardness} 대응`)
        }
      }
      // Data confidence
      const avgConf = g.confidenceSum / g.count
      score += Math.min(10, avgConf * 10)
      // Data coverage bonus (more data = more trustworthy)
      if (g.count > 50) score += 5
      else if (g.count > 20) score += 3

      if (score > 20) {
        results.push({
          series: g.seriesName, score: Math.round(score),
          count: g.count,
          diameters: [...g.diameters].sort((a, b) => a - b).slice(0, 8),
          cuttingTypes: [...g.cuttingTypes].slice(0, 4),
          toolShapes: [...g.toolShapes].slice(0, 4),
          sampleWorkpieces: [...g.workpieces].slice(0, 3),
          hardnessRanges: [...g.hardnesses].slice(0, 3),
          matchReasons: reasons,
          closestDiameter: closestD,
        })
      }
    }

    results.sort((a, b) => b.score - a.score)
    return NextResponse.json({
      iso, diameter: D ?? null, shape, hardness,
      total: results.length,
      recommendations: results.slice(0, limit),
    })
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
