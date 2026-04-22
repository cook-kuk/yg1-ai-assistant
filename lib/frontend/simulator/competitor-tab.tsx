"use client"

import { useCallback, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { ArrowRight, Filter, Search, Sparkles, Target } from "lucide-react"
import { stateToQuery, type SerializableState } from "@/lib/frontend/simulator/v2/state-serde"

interface CompetitorCondition {
  vcRange: [number, number]
  fzRange: [number, number]
}

interface YG1Alternative {
  brand: string
  series: string
  score: number
  vcRange?: [number, number] | null
  fzRange?: [number, number] | null
  dataPoints?: number | null
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

const ISO_OPTIONS = ["P", "M", "K", "N", "S", "H"] as const
const QUICK_EXAMPLES = ["AE-VMS", "2P342", "CoroMill Plura", "OSG AE-VMS 10", "Sandvik 2P342"]

function mid(range: [number, number] | null | undefined): number | null {
  if (!range) return null
  return (range[0] + range[1]) / 2
}

function pctDelta(base: number | null, target: number | null): number | null {
  if (base == null || target == null || Math.abs(base) < 1e-9) return null
  return ((target - base) / base) * 100
}

function formatPct(v: number | null): string {
  if (v == null || !Number.isFinite(v)) return "—"
  const rounded = Math.round(v)
  return rounded > 0 ? `+${rounded}%` : `${rounded}%`
}

function scoreTone(score: number): string {
  if (score >= 95) return "bg-emerald-50 text-emerald-700 border-emerald-200"
  if (score >= 85) return "bg-sky-50 text-sky-700 border-sky-200"
  return "bg-amber-50 text-amber-700 border-amber-200"
}

function mapShape(shape: string | null | undefined): string {
  const key = (shape ?? "").toLowerCase()
  if (key.includes("ball")) return "ball"
  if (key.includes("radius")) return "radius"
  if (key.includes("chamfer")) return "chamfer"
  return "square"
}

function buildSimulatorHref(competitor: CompetitorResult["competitor"], alt: YG1Alternative): string {
  const cond = alt.yg1ConditionsDiameterFiltered ?? alt.yg1Conditions
  const diameter = competitor.diameter ?? undefined
  const fluteCount = competitor.flutes ?? undefined
  const state: SerializableState = {
    isoGroup: competitor.iso[0] ?? "P",
    diameter,
    fluteCount,
    activeShape: mapShape(competitor.shape),
    operation: "Side_Milling",
    Vc: cond ? Number(mid(cond.vcRange)?.toFixed(1)) : undefined,
    fz: cond?.fzRange ? Number(mid(cond.fzRange)?.toFixed(4)) : undefined,
    ap: diameter != null ? Number(Math.max(0.3, diameter * 0.5).toFixed(1)) : undefined,
    ae: diameter != null ? Number(Math.max(0.1, diameter * 0.2).toFixed(1)) : undefined,
    stickoutMm: diameter != null ? Number(Math.max(12, diameter * 3).toFixed(1)) : undefined,
    productCode: alt.series,
  }
  return `/simulator_v2?${stateToQuery(state)}`
}

export function CompetitorTab() {
  const router = useRouter()
  const [brand, setBrand] = useState("")
  const [query, setQuery] = useState("")
  const [iso, setIso] = useState("")
  const [diameter, setDiameter] = useState("")
  const [loading, setLoading] = useState(false)
  const [data, setData] = useState<SearchResponse | null>(null)
  const [error, setError] = useState("")
  const [featuredKey, setFeaturedKey] = useState("")

  const availableBrands = useMemo(
    () => data?.brands.filter(Boolean).sort((a, b) => a.localeCompare(b, "en")) ?? [],
    [data],
  )

  const search = useCallback(async () => {
    if (!query.trim() && !brand) return
    setLoading(true)
    setError("")
    try {
      const params = new URLSearchParams()
      if (query.trim()) params.set("q", query.trim())
      if (brand) params.set("brand", brand)
      if (iso) params.set("iso", iso)
      if (diameter) params.set("diameter", diameter)
      const res = await fetch(`/api/competitor?${params}`)
      if (!res.ok) throw new Error(await res.text())
      const nextData = await res.json() as SearchResponse
      setData(nextData)
      const first = nextData.results[0]
      const featuredAlt = first?.yg1Alternatives[0]
      setFeaturedKey(first && featuredAlt ? `${first.competitor.code}__${featuredAlt.series}` : "")
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [query, brand, iso, diameter])

  const featured = useMemo(() => {
    if (!data || !featuredKey) return null
    for (const result of data.results) {
      for (const alt of result.yg1Alternatives) {
        const key = `${result.competitor.code}__${alt.series}`
        if (key === featuredKey) return { result, alt }
      }
    }
    return null
  }, [data, featuredKey])

  const openSimulator = useCallback((competitor: CompetitorResult["competitor"], alt: YG1Alternative) => {
    router.push(buildSimulatorHref(competitor, alt))
  }, [router])

  return (
    <div className="space-y-5 px-2 py-4" data-testid="competitor-tab">
      <div className="rounded-2xl border border-slate-200 bg-gradient-to-br from-white via-slate-50 to-amber-50 p-4 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-amber-700">Competitor Replacement</div>
            <h2 className="mt-1 text-lg font-semibold text-slate-900">경쟁사 대체 추천</h2>
            <p className="mt-1 text-sm text-slate-600">
              경쟁사 코드로 검색하고, YG-1 대체 후보를 바로 비교한 뒤 시뮬레이터 조건으로 이어집니다.
            </p>
          </div>
          <div className="flex flex-wrap gap-1.5 text-[10px]">
            <span className="rounded-full border border-slate-200 bg-white px-2 py-1 text-slate-600">Harvey / Sandvik 스타일 비교</span>
            <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-1 font-semibold text-emerald-700">YG-1 대체 후보 즉시 연결</span>
          </div>
        </div>

        <div className="mt-4 grid gap-2 lg:grid-cols-[180px_minmax(0,1fr)_100px_120px_140px]">
          <select
            className="rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm"
            value={brand}
            onChange={e => setBrand(e.target.value)}
            data-testid="competitor-brand-filter"
          >
            <option value="">전체 브랜드</option>
            {(availableBrands.length > 0 ? availableBrands : ["OSG", "Sandvik"]).map(b => <option key={b} value={b}>{b}</option>)}
          </select>
          <input
            className="rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm"
            placeholder="경쟁사 제품코드 또는 시리즈 (예: AE-VMS, 2P342, CoroMill)"
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={e => e.key === "Enter" && search()}
            data-testid="competitor-query-input"
          />
          <select
            className="rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm"
            value={iso}
            onChange={e => setIso(e.target.value)}
            data-testid="competitor-iso-filter"
          >
            <option value="">전체 ISO</option>
            {ISO_OPTIONS.map(item => <option key={item} value={item}>{item}</option>)}
          </select>
          <input
            className="rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm"
            placeholder="직경 mm"
            inputMode="decimal"
            value={diameter}
            onChange={e => setDiameter(e.target.value)}
            onKeyDown={e => e.key === "Enter" && search()}
            data-testid="competitor-diameter-filter"
          />
          <button
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-blue-700 disabled:bg-slate-300"
            onClick={search}
            disabled={loading || (!query.trim() && !brand)}
            data-testid="competitor-search-button"
          >
            <Search className="h-4 w-4" />
            {loading ? "검색 중..." : "대체품 검색"}
          </button>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          {QUICK_EXAMPLES.map(example => (
            <button
              key={example}
              className="rounded-full border border-blue-200 bg-blue-50 px-2.5 py-1 text-[10px] text-blue-700 hover:bg-blue-100"
              onClick={() => setQuery(example)}
            >
              {example}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{error}</div>
      )}

      {featured && (
        <FeaturedRecommendation
          item={featured}
          onSelect={() => setFeaturedKey(`${featured.result.competitor.code}__${featured.alt.series}`)}
          onOpenSimulator={() => openSimulator(featured.result.competitor, featured.alt)}
        />
      )}

      {data && data.results.length === 0 && (
        <div className="rounded-xl border border-slate-200 bg-white py-10 text-center text-sm text-slate-500">
          검색 결과가 없습니다. 다른 시리즈명이나 제품코드를 입력해 보세요.
        </div>
      )}

      {data && data.results.length > 0 && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
            <span>{data.totalAvailable}건 중 {data.count}건 표시</span>
            {(brand || iso || diameter) && (
              <span className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white px-2 py-1">
                <Filter className="h-3 w-3" />
                {brand || "All brand"} · {iso || "All ISO"} · {diameter || "All dia"}
              </span>
            )}
          </div>

          {data.results.map((result, idx) => (
            <CompetitorCard
              key={`${result.competitor.code}-${idx}`}
              result={result}
              featuredKey={featuredKey}
              onFeature={setFeaturedKey}
              onOpenSimulator={openSimulator}
            />
          ))}
        </div>
      )}

      {!data && !loading && (
        <div className="flex flex-col items-center justify-center rounded-2xl border border-slate-200 bg-white py-12 text-center">
          <div className="text-4xl">🔄</div>
          <h3 className="mt-3 text-base font-semibold text-slate-900">경쟁사 대체 추천</h3>
          <p className="mt-1 text-xs text-slate-500">
            검색 후 상위 YG-1 대체품을 바로 시뮬레이터 조건으로 넘길 수 있습니다.
          </p>
        </div>
      )}
    </div>
  )
}

function FeaturedRecommendation({
  item,
  onSelect,
  onOpenSimulator,
}: {
  item: { result: CompetitorResult; alt: YG1Alternative }
  onSelect: () => void
  onOpenSimulator: () => void
}) {
  const { result, alt } = item
  const cond = alt.yg1ConditionsDiameterFiltered ?? alt.yg1Conditions
  const compVc = mid(result.competitor.conditions.vcRange)
  const ygVc = mid(cond?.vcRange)
  const compFz = mid(result.competitor.conditions.fzRange)
  const ygFz = mid(cond?.fzRange ?? null)

  return (
    <div className="rounded-2xl border border-emerald-200 bg-gradient-to-r from-emerald-50 via-white to-amber-50 p-4 shadow-sm" data-testid="competitor-featured-recommendation">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-white px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-emerald-700">
            <Sparkles className="h-3 w-3" />
            추천 1순위
          </div>
          <div className="mt-2 text-lg font-semibold text-slate-900">{alt.series}</div>
          <div className="text-sm text-slate-600">
            {result.competitor.brand} {result.competitor.code} 대체 · score {alt.score}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
            onClick={onSelect}
          >
            대표안 유지
          </button>
          <button
            type="button"
            className="inline-flex items-center gap-2 rounded-xl bg-amber-500 px-3 py-2 text-sm font-semibold text-white hover:bg-amber-600"
            onClick={onOpenSimulator}
            data-testid="competitor-open-simulator"
          >
            추천 조건으로 시뮬레이터 열기
            <ArrowRight className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-4">
        <SummaryStat label="경쟁사 Vc 중앙값" value={compVc != null ? `${Math.round(compVc)} m/min` : "—"} />
        <SummaryStat label="YG-1 Vc 중앙값" value={ygVc != null ? `${Math.round(ygVc)} m/min` : "—"} accent />
        <SummaryStat label="Vc 차이" value={formatPct(pctDelta(compVc, ygVc))} />
        <SummaryStat label="fz 차이" value={formatPct(pctDelta(compFz, ygFz))} />
      </div>
    </div>
  )
}

function SummaryStat({ label, value, accent = false }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className={`rounded-xl border p-3 ${accent ? "border-amber-200 bg-amber-50" : "border-slate-200 bg-white"}`}>
      <div className="text-[10px] font-semibold uppercase tracking-[0.15em] text-slate-500">{label}</div>
      <div className="mt-1 text-sm font-semibold text-slate-900">{value}</div>
    </div>
  )
}

function CompetitorCard({
  result,
  featuredKey,
  onFeature,
  onOpenSimulator,
}: {
  result: CompetitorResult
  featuredKey: string
  onFeature: (key: string) => void
  onOpenSimulator: (competitor: CompetitorResult["competitor"], alt: YG1Alternative) => void
}) {
  const { competitor: c, yg1Alternatives: alts } = result

  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm" data-testid="competitor-result-card">
      <div className="border-b border-slate-200 bg-slate-50 px-4 py-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">{c.brand}</div>
            <h4 className="mt-1 text-base font-semibold text-slate-900">{c.code}</h4>
            <p className="text-sm text-slate-600">{c.series}</p>
          </div>
          <div className="flex flex-wrap gap-1.5 text-right">
            {c.diameter != null && <Chip label={`Ø${c.diameter}mm`} />}
            {c.flutes != null && <Chip label={`${c.flutes}날`} />}
            {c.iso.map(i => <Chip key={i} label={i} color="blue" />)}
            {c.shape && <Chip label={c.shape} color="green" />}
          </div>
        </div>

        <div className="mt-3 grid gap-2 md:grid-cols-2">
          <div className="rounded-xl border border-slate-200 bg-white p-3 text-xs text-slate-600">
            <div className="text-[10px] font-semibold uppercase tracking-[0.15em] text-slate-500">경쟁사 절삭 조건</div>
            <div className="mt-1">Vc <b>{c.conditions.vcRange[0]}~{c.conditions.vcRange[1]}</b> m/min</div>
            <div>Fz <b>{c.conditions.fzRange[0]}~{c.conditions.fzRange[1]}</b> mm/tooth</div>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-3 text-xs text-slate-600">
            <div className="text-[10px] font-semibold uppercase tracking-[0.15em] text-slate-500">추천 포인트</div>
            <div className="mt-1">직경·ISO·날수 기준으로 YG-1 후보를 점수화했습니다.</div>
            <div>상위 후보는 바로 `/simulator_v2` 조건으로 이어집니다.</div>
          </div>
        </div>
      </div>

      <div className="divide-y divide-slate-100">
        {alts.map((alt, i) => {
          const rowKey = `${c.code}__${alt.series}`
          return (
            <YG1Row
              key={rowKey}
              alt={alt}
              competitor={c}
              rank={i + 1}
              featured={featuredKey === rowKey}
              onFeature={() => onFeature(rowKey)}
              onOpenSimulator={() => onOpenSimulator(c, alt)}
            />
          )
        })}
      </div>
    </div>
  )
}

function YG1Row({
  alt,
  competitor,
  rank,
  featured,
  onFeature,
  onOpenSimulator,
}: {
  alt: YG1Alternative
  competitor: CompetitorResult["competitor"]
  rank: number
  featured: boolean
  onFeature: () => void
  onOpenSimulator: () => void
}) {
  const cond = alt.yg1ConditionsDiameterFiltered ?? alt.yg1Conditions
  const competitorVcMid = mid(competitor.conditions.vcRange)
  const competitorFzMid = mid(competitor.conditions.fzRange)
  const ygVcMid = mid(cond?.vcRange)
  const ygFzMid = mid(cond?.fzRange ?? alt.fzRange ?? null)
  const vcGap = pctDelta(competitorVcMid, ygVcMid)
  const fzGap = pctDelta(competitorFzMid, ygFzMid)

  return (
    <div className={`px-4 py-3 ${featured ? "bg-amber-50/60" : "bg-white"}`}>
      <div className="flex flex-wrap items-start gap-3">
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-blue-100 text-[11px] font-bold text-blue-700">
          {rank}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="truncate text-sm font-semibold text-slate-900">{alt.series}</span>
            <span className="text-[10px] text-slate-400">{alt.brand}</span>
            <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${scoreTone(alt.score)}`}>score {alt.score}</span>
            {featured && <span className="rounded-full border border-amber-200 bg-white px-2 py-0.5 text-[10px] font-semibold text-amber-700">대표안</span>}
          </div>

          {cond ? (
            <div className="mt-2 grid gap-2 md:grid-cols-[1.2fr_1fr_1fr_auto]">
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-2 text-xs text-slate-600">
                <div>Vc {cond.vcRange[0]}~{cond.vcRange[1]} m/min</div>
                {cond.fzRange && <div>Fz {cond.fzRange[0]}~{cond.fzRange[1]} mm/tooth</div>}
                <div className="text-[10px] text-slate-400">{cond.dataPoints}건 데이터</div>
              </div>
              <ComparePill label="Vc 차이" value={formatPct(vcGap)} />
              <ComparePill label="fz 차이" value={formatPct(fzGap)} />
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs text-slate-700 hover:bg-slate-50"
                  onClick={onFeature}
                >
                  대표안으로 보기
                </button>
                <button
                  type="button"
                  className="inline-flex items-center gap-1 rounded-xl bg-orange-500 px-3 py-2 text-xs font-semibold text-white hover:bg-orange-600"
                  onClick={onOpenSimulator}
                  data-testid="competitor-row-open-simulator"
                >
                  이 조건으로 시뮬레이터 열기
                  <ArrowRight className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          ) : (
            <div className="mt-2 text-xs text-slate-400">가공조건 데이터가 없어 직접 시뮬레이션 값 보정이 필요합니다.</div>
          )}
        </div>
      </div>
    </div>
  )
}

function ComparePill({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-2 text-xs">
      <div className="text-[10px] font-semibold uppercase tracking-[0.15em] text-slate-400">{label}</div>
      <div className="mt-1 font-semibold text-slate-800">{value}</div>
    </div>
  )
}

function Chip({ label, color = "gray" }: { label: string; color?: string }) {
  const cls = color === "blue"
    ? "bg-blue-50 text-blue-700 border-blue-200"
    : color === "green"
      ? "bg-green-50 text-green-700 border-green-200"
      : "bg-slate-50 text-slate-600 border-slate-200"

  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium ${cls}`}>
      {label}
    </span>
  )
}
