"use client"

import { useEffect, useState } from "react"
import { Wrench, Sparkles, RefreshCw } from "lucide-react"

interface Recommendation {
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
}

interface ToolRecommenderProps {
  iso: string
  diameter: number
  shape: string
  hardness?: string
  onPick: (series: string, closestDiameter: number | null) => void
}

export function ToolRecommender({ iso, diameter, shape, hardness, onPick }: ToolRecommenderProps) {
  const [recs, setRecs] = useState<Recommendation[]>([])
  const [loading, setLoading] = useState(false)
  const [open, setOpen] = useState(false)
  const [lastFetch, setLastFetch] = useState<string>("")

  const fetchRecs = async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams({
        iso, diameter: String(diameter), shape,
      })
      if (hardness) params.set("hardness", hardness)
      const res = await fetch(`/api/simulator/recommend?${params.toString()}`)
      if (res.ok) {
        const data = await res.json()
        setRecs(data.recommendations ?? [])
        setLastFetch(`${iso}·⌀${diameter}·${shape}`)
      }
    } catch {
      setRecs([])
    } finally {
      setLoading(false)
    }
  }

  // Auto-open and fetch when panel opens
  useEffect(() => {
    if (open && !lastFetch) fetchRecs()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  return (
    <div className="rounded-xl border border-indigo-200 bg-gradient-to-br from-indigo-50/50 to-white">
      <button onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-indigo-50/50 transition-colors">
        <span className="text-sm font-semibold text-indigo-900 flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-indigo-600" />
          이 조건에 맞는 YG-1 공구 추천 (DB 연동)
          {recs.length > 0 && <span className="text-[10px] font-mono bg-indigo-100 text-indigo-700 px-1.5 py-0.5 rounded">{recs.length}종</span>}
        </span>
        <span className={`text-xs transition-transform ${open ? "rotate-180" : ""}`}>▼</span>
      </button>
      {open && (
        <div className="border-t border-indigo-200 p-3 space-y-2.5">
          <div className="flex items-center gap-2 text-[10px] text-gray-500">
            <span>조건: <b className="text-gray-800">ISO {iso} · ⌀{diameter}mm · {shape}</b>{hardness && <> · 경도 {hardness}</>}</span>
            <button onClick={fetchRecs} disabled={loading}
              className="ml-auto flex items-center gap-1 rounded border border-indigo-300 bg-white px-2 py-0.5 text-[10px] text-indigo-700 hover:bg-indigo-50 disabled:opacity-50">
              {loading ? <RefreshCw className="h-2.5 w-2.5 animate-spin" /> : "🔄"} 새로 찾기
            </button>
          </div>
          {loading && (
            <div className="text-center py-4 text-[11px] text-gray-500">
              <RefreshCw className="h-4 w-4 animate-spin inline mr-1.5" />
              카탈로그 검색 중...
            </div>
          )}
          {!loading && recs.length === 0 && lastFetch && (
            <div className="text-[11px] text-gray-500 py-3 text-center">해당 조건에 매칭된 시리즈 없음. 직경 범위를 넓혀보세요.</div>
          )}
          {!loading && recs.length > 0 && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              {recs.map((r, i) => (
                <div key={r.series} className="rounded-lg border border-indigo-100 bg-white p-2.5 hover:border-indigo-400 hover:shadow-sm transition-all">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 mb-1">
                        <span className="text-[9px] font-bold text-white bg-indigo-600 px-1.5 py-0.5 rounded">#{i + 1}</span>
                        <span className="font-mono font-bold text-gray-900">{r.series}</span>
                        <span className="text-[9px] font-mono bg-emerald-50 text-emerald-700 px-1.5 py-0.5 rounded">Score {r.score}</span>
                      </div>
                      <div className="text-[10px] text-gray-600 space-y-0.5">
                        <div>데이터 {r.count}건 {r.closestDiameter != null && <>· 최근접 ⌀<b>{r.closestDiameter}mm</b></>}</div>
                        {r.cuttingTypes.length > 0 && <div className="truncate">형상: {r.cuttingTypes.slice(0, 2).join(", ")}</div>}
                        {r.sampleWorkpieces.length > 0 && <div className="truncate text-gray-500">소재: {r.sampleWorkpieces.slice(0, 2).join(", ")}</div>}
                      </div>
                      <div className="mt-1 flex flex-wrap gap-1">
                        {r.matchReasons.slice(0, 3).map((reason, j) => (
                          <span key={j} className="text-[9px] font-mono bg-indigo-50 text-indigo-700 px-1.5 py-0.5 rounded">{reason}</span>
                        ))}
                      </div>
                    </div>
                    <button onClick={() => onPick(r.series, r.closestDiameter)}
                      className="flex items-center gap-1 rounded bg-indigo-600 text-white px-2 py-1 text-[10px] font-semibold hover:bg-indigo-700 flex-shrink-0">
                      <Wrench className="h-3 w-3" /> 적용
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
