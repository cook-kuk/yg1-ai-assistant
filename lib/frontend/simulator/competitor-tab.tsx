"use client"

import { useState, useCallback } from "react"

interface CompetitorCondition {
  vcRange: [number, number]
  fzRange: [number, number]
}

interface YG1Alternative {
  brand: string
  series: string
  score: number
  yg1Conditions: {
    vcRange: [number, number]
    fzRange: [number, number] | null
    dataPoints: number
  } | null
  yg1ConditionsDiameterFiltered: {
    vcRange: [number, number]
    fzRange: [number, number] | null
    dataPoints: number
  } | null
}

interface CompetitorResult {
  competitor: {
    brand: string
    code: string
    series: string
    diameter: number | null
    flutes: number | null
    coating: string | null
    iso: string[]
    shape: string | null
    conditions: CompetitorCondition
  }
  yg1Alternatives: YG1Alternative[]
}

interface SearchResponse {
  count: number
  totalAvailable: number
  brands: string[]
  results: CompetitorResult[]
}

const BRANDS = ["SANDVIK", "OSG"]

export function CompetitorTab() {
  const [brand, setBrand] = useState("")
  const [query, setQuery] = useState("")
  const [loading, setLoading] = useState(false)
  const [data, setData] = useState<SearchResponse | null>(null)
  const [error, setError] = useState("")

  const search = useCallback(async () => {
    if (!query.trim() && !brand) return
    setLoading(true)
    setError("")
    try {
      const params = new URLSearchParams()
      if (query.trim()) params.set("q", query.trim())
      if (brand) params.set("brand", brand)
      const res = await fetch(`/api/competitor?${params}`)
      if (!res.ok) throw new Error(await res.text())
      setData(await res.json())
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [query, brand])

  return (
    <div className="space-y-4 px-2 py-4">
      {/* Search Bar */}
      <div className="flex gap-2">
        <select
          className="rounded-lg border border-gray-300 px-3 py-2.5 text-sm min-w-[140px]"
          value={brand}
          onChange={e => setBrand(e.target.value)}
        >
          <option value="">전체 브랜드</option>
          {BRANDS.map(b => <option key={b} value={b}>{b}</option>)}
        </select>
        <input
          className="flex-1 rounded-lg border border-gray-300 px-3 py-2.5 text-sm"
          placeholder="경쟁사 제품코드 또는 시리즈 (예: AE-VMS, 2P342, CoroMill)"
          value={query}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={e => e.key === "Enter" && search()}
        />
        <button
          className="rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-blue-700 disabled:bg-gray-300"
          onClick={search}
          disabled={loading || (!query.trim() && !brand)}
        >
          {loading ? "검색 중..." : "대체품 검색"}
        </button>
      </div>

      {error && (
        <div className="rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700">{error}</div>
      )}

      {/* Results */}
      {data && data.results.length === 0 && (
        <div className="text-center py-8 text-gray-500 text-sm">
          검색 결과가 없습니다. 다른 시리즈명이나 제품코드를 입력해 보세요.
        </div>
      )}

      {data && data.results.length > 0 && (
        <div className="space-y-3">
          <p className="text-xs text-gray-500">{data.totalAvailable}건 중 {data.count}건 표시</p>

          {data.results.map((r, idx) => (
            <CompetitorCard key={idx} result={r} />
          ))}
        </div>
      )}

      {/* Empty state */}
      {!data && !loading && (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <div className="text-4xl mb-3">🔄</div>
          <h3 className="text-base font-bold text-gray-900 mb-1">경쟁사 대체 추천</h3>
          <p className="text-xs text-gray-500 mb-4">
            Sandvik CoroMill Plura / OSG A Brand 시리즈 100개 DB 구축 완료
          </p>
          <div className="flex flex-wrap gap-1.5 justify-center max-w-sm">
            {["AE-VMS", "CoroMill Plura 2P342", "WXL", "PHX", "2P380"].map(ex => (
              <button
                key={ex}
                className="rounded-full border border-blue-200 bg-blue-50 px-2.5 py-1 text-[10px] text-blue-600 hover:bg-blue-100"
                onClick={() => { setQuery(ex); }}
              >
                {ex}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function CompetitorCard({ result }: { result: CompetitorResult }) {
  const { competitor: c, yg1Alternatives: alts } = result

  return (
    <div className="rounded-xl border border-gray-200 bg-white overflow-hidden">
      {/* Competitor header */}
      <div className="bg-gray-50 px-4 py-3 border-b border-gray-200">
        <div className="flex items-center justify-between">
          <div>
            <span className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">{c.brand}</span>
            <h4 className="text-sm font-bold text-gray-900">{c.code}</h4>
            <p className="text-xs text-gray-500">{c.series}</p>
          </div>
          <div className="flex gap-2 text-right">
            <Chip label={`Ø${c.diameter}mm`} />
            <Chip label={`${c.flutes}날`} />
            {c.iso.map(i => <Chip key={i} label={i} color="blue" />)}
            {c.shape && <Chip label={c.shape} color="green" />}
          </div>
        </div>

        {/* Competitor cutting conditions */}
        <div className="mt-2 flex gap-4 text-xs">
          <span className="text-gray-600">
            Vc: <b>{c.conditions.vcRange[0]}~{c.conditions.vcRange[1]}</b> m/min
          </span>
          <span className="text-gray-600">
            Fz: <b>{c.conditions.fzRange[0]}~{c.conditions.fzRange[1]}</b> mm/tooth
          </span>
        </div>
      </div>

      {/* YG-1 alternatives */}
      <div className="divide-y divide-gray-100">
        {alts.map((alt, i) => (
          <YG1Row key={i} alt={alt} competitor={c} rank={i + 1} />
        ))}
      </div>
    </div>
  )
}

function YG1Row({
  alt, competitor, rank,
}: {
  alt: YG1Alternative
  competitor: CompetitorResult["competitor"]
  rank: number
}) {
  const cond = alt.yg1ConditionsDiameterFiltered ?? alt.yg1Conditions

  // Vc comparison
  let vcDiff = ""
  let vcColor = "text-gray-500"
  if (cond?.vcRange) {
    const compMid = (competitor.conditions.vcRange[0] + competitor.conditions.vcRange[1]) / 2
    const yg1Mid = (cond.vcRange[0] + cond.vcRange[1]) / 2
    const pct = Math.round(((yg1Mid - compMid) / compMid) * 100)
    if (pct > 5) { vcDiff = `+${pct}%`; vcColor = "text-green-600 font-bold" }
    else if (pct < -5) { vcDiff = `${pct}%`; vcColor = "text-orange-500" }
    else { vcDiff = "동급"; vcColor = "text-blue-600" }
  }

  return (
    <div className="px-4 py-2.5 flex items-center gap-3">
      <span className="w-5 h-5 rounded-full bg-blue-100 text-blue-700 text-[10px] font-bold flex items-center justify-center shrink-0">
        {rank}
      </span>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-gray-900 truncate">{alt.series}</span>
          <span className="text-[10px] text-gray-400">{alt.brand}</span>
          <span className="ml-auto text-[10px] text-gray-400">score {alt.score}</span>
        </div>
        {cond ? (
          <div className="flex gap-4 mt-0.5 text-xs">
            <span className="text-gray-500">
              Vc: {cond.vcRange[0]}~{cond.vcRange[1]} m/min
            </span>
            {cond.fzRange && (
              <span className="text-gray-500">
                Fz: {cond.fzRange[0]}~{cond.fzRange[1]}
              </span>
            )}
            <span className={vcColor}>{vcDiff}</span>
            <span className="text-[10px] text-gray-300">{cond.dataPoints}건 데이터</span>
          </div>
        ) : (
          <span className="text-[10px] text-gray-300">가공조건 데이터 없음</span>
        )}
      </div>
    </div>
  )
}

function Chip({ label, color = "gray" }: { label: string; color?: string }) {
  const cls = color === "blue"
    ? "bg-blue-50 text-blue-700 border-blue-200"
    : color === "green"
    ? "bg-green-50 text-green-700 border-green-200"
    : "bg-gray-50 text-gray-600 border-gray-200"

  return (
    <span className={`inline-block rounded-full border px-2 py-0.5 text-[10px] font-medium ${cls}`}>
      {label}
    </span>
  )
}
