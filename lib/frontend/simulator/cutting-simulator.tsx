"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { Search, Gauge, Zap, Shield, BarChart3, RefreshCw } from "lucide-react"
import {
  calculateCutting,
  getDefaultRange,
  applyOptimizationMode,
  ISO_LABELS,
  KC_TABLE,
  type CatalogRange,
  type OptimizationMode,
} from "./cutting-calculator"

interface CatalogCondition {
  seriesName: string
  isoGroup: string
  cuttingType: string
  diameterMm: number | null
  Vc: string | null
  fz: string | null
  ap: string | null
  ae: string | null
  n: string | null
  vf: string | null
  confidence: number
}

interface SimulatorApiResponse {
  found: boolean
  count: number
  series: string
  diameter: number | null
  material: string | null
  conditions: CatalogCondition[]
  ranges: { VcMin: number; VcMax: number; fzMin: number; fzMax: number } | null
  interpolated: boolean
}

interface CuttingSimulatorProps {
  initialProduct?: string
  initialMaterial?: string
  initialOperation?: string
}

interface SimulatorExample {
  label: string
  brand: string
  series: string
  iso: string
  diameter: number
  flutes: number
  hint: string
}

const SIMULATOR_EXAMPLES: SimulatorExample[] = [
  {
    label: "프리하든강 미세 볼",
    brand: "E-FORCE",
    series: "GNX98",
    iso: "P",
    diameter: 0.5,
    flutes: 2,
    hint: "30~45HRC · 2날 볼 엔드밀",
  },
  {
    label: "스테인리스 측면",
    brand: "SUS-CUT",
    series: "EHD84",
    iso: "M",
    diameter: 10,
    flutes: 4,
    hint: "SUS304 · 4날 스퀘어",
  },
  {
    label: "주철 슬로팅",
    brand: "V7 PLUS",
    series: "GMG87",
    iso: "K",
    diameter: 8,
    flutes: 4,
    hint: "GC계 주철 · 4날 스퀘어",
  },
  {
    label: "인녹스 드릴",
    brand: "DRILL",
    series: "DH453",
    iso: "M",
    diameter: 8,
    flutes: 2,
    hint: "스테인리스 · 쿨런트 홀 드릴",
  },
  {
    label: "고경도 4G 볼",
    brand: "4G MILLS",
    series: "SEM846",
    iso: "H",
    diameter: 6,
    flutes: 2,
    hint: "55~65HRC · 2날 롱넥 볼",
  },
  {
    label: "알루미늄 라핑",
    brand: "M42 HSS",
    series: "CE7406",
    iso: "N",
    diameter: 10,
    flutes: 3,
    hint: "비철 · 3날 라핑 HSS",
  },
]

export function CuttingSimulator({ initialProduct, initialMaterial, initialOperation }: CuttingSimulatorProps) {
  // Input state
  const [productCode, setProductCode] = useState(initialProduct ?? "")
  const [isoGroup, setIsoGroup] = useState(initialMaterial ?? "P")
  const [operation, setOperation] = useState(initialOperation ?? "Side_Milling")
  const [diameter, setDiameter] = useState(10)
  const [fluteCount, setFluteCount] = useState(4)

  // Catalog data
  const [catalogData, setCatalogData] = useState<SimulatorApiResponse | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [dataSource, setDataSource] = useState<"catalog" | "interpolated" | "default">("default")

  // Slider values
  const [Vc, setVc] = useState(200)
  const [fz, setFz] = useState(0.05)
  const [ap, setAp] = useState(10)
  const [ae, setAe] = useState(5)

  // Optimization mode
  const [mode, setMode] = useState<OptimizationMode>("balanced")

  // Catalog range (from API or default)
  const range = useMemo<CatalogRange>(() => {
    if (catalogData?.ranges) {
      return {
        VcMin: catalogData.ranges.VcMin * 0.7,
        VcMax: catalogData.ranges.VcMax * 1.3,
        fzMin: Math.max(0.005, catalogData.ranges.fzMin * 0.5),
        fzMax: catalogData.ranges.fzMax * 1.5,
        apMax: diameter * 2,
        aeMax: diameter,
      }
    }
    return getDefaultRange(diameter)
  }, [catalogData, diameter])

  // Calculate result
  const result = useMemo(() => calculateCutting({
    Vc, fz, ap, ae, D: diameter, Z: fluteCount, isoGroup,
  }), [Vc, fz, ap, ae, diameter, fluteCount, isoGroup])

  // Fetch catalog data
  const fetchCatalog = useCallback(async () => {
    if (!productCode.trim()) return
    setIsLoading(true)
    try {
      // Extract series name from product code (remove trailing digits for diameter/length variants)
      const series = productCode.trim()
      const res = await fetch(`/api/simulator?series=${encodeURIComponent(series)}&diameter=${diameter}&material=${isoGroup}`)
      if (!res.ok) throw new Error("API error")
      const data: SimulatorApiResponse = await res.json()
      setCatalogData(data)

      if (data.found && data.ranges) {
        setDataSource(data.interpolated ? "interpolated" : "catalog")
        const mid = applyOptimizationMode({
          ...range,
          VcMin: data.ranges.VcMin,
          VcMax: data.ranges.VcMax,
          fzMin: data.ranges.fzMin,
          fzMax: data.ranges.fzMax,
        }, mode)
        setVc(Math.round(mid.Vc))
        setFz(parseFloat(mid.fz.toFixed(4)))
      } else {
        setDataSource("default")
      }
    } catch {
      setDataSource("default")
    } finally {
      setIsLoading(false)
    }
  }, [productCode, diameter, isoGroup, mode, range])

  // Apply optimization mode
  useEffect(() => {
    const vals = applyOptimizationMode(range, mode)
    setVc(Math.round(vals.Vc))
    setFz(parseFloat(vals.fz.toFixed(4)))
  }, [mode, range])

  // Auto-fetch on initial params
  useEffect(() => {
    if (initialProduct) fetchCatalog()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const applyExample = useCallback((ex: SimulatorExample) => {
    setProductCode(ex.series)
    setIsoGroup(ex.iso)
    setDiameter(ex.diameter)
    setFluteCount(ex.flutes)
    // Defer fetch to next tick so state updates are flushed
    setTimeout(() => {
      void (async () => {
        setIsLoading(true)
        try {
          const res = await fetch(`/api/simulator?series=${encodeURIComponent(ex.series)}&diameter=${ex.diameter}&material=${ex.iso}`)
          if (!res.ok) throw new Error("API error")
          const data: SimulatorApiResponse = await res.json()
          setCatalogData(data)
          if (data.found && data.ranges) {
            setDataSource(data.interpolated ? "interpolated" : "catalog")
            setVc(Math.round((data.ranges.VcMin + data.ranges.VcMax) / 2))
            setFz(parseFloat(((data.ranges.fzMin + data.ranges.fzMax) / 2).toFixed(4)))
          } else {
            setDataSource("default")
          }
        } catch {
          setDataSource("default")
        } finally {
          setIsLoading(false)
        }
      })()
    }, 0)
  }, [])

  return (
    <div className="space-y-6">
      {/* ── 예시 칩 ── */}
      <div className="rounded-xl border border-blue-100 bg-blue-50/40 p-3">
        <div className="text-[11px] font-semibold text-blue-800 mb-2 flex items-center gap-1.5">
          ⚡ 예시로 빠르게 시작
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
          {SIMULATOR_EXAMPLES.map(ex => (
            <button
              key={ex.series}
              onClick={() => applyExample(ex)}
              className="text-left rounded-lg border border-blue-200 bg-white px-3 py-2 hover:border-blue-400 hover:shadow-sm transition-all"
            >
              <div className="flex items-center gap-1.5 mb-0.5">
                <span className="text-[9px] font-bold uppercase tracking-wider text-purple-700 bg-purple-50 px-1.5 py-0.5 rounded">{ex.brand}</span>
                <span className="text-xs font-mono font-bold text-gray-900">{ex.series}</span>
              </div>
              <div className="text-[11px] text-gray-700 font-medium">{ex.label}</div>
              <div className="text-[10px] text-gray-500 mt-0.5">{ex.hint} · ⌀{ex.diameter}mm · ISO {ex.iso}</div>
            </button>
          ))}
        </div>
      </div>

      {/* ── 입력부 ── */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* 제품 선택 */}
        <div className="rounded-xl border border-gray-200 bg-white p-4 space-y-3">
          <h3 className="text-sm font-semibold text-gray-900 flex items-center gap-1.5">
            🔧 제품 정보
          </h3>
          <div className="flex gap-2">
            <input
              className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm placeholder:text-gray-400 focus:border-blue-400 focus:outline-none"
              placeholder="시리즈명 (예: E5E83, CG3S13)"
              value={productCode}
              onChange={e => setProductCode(e.target.value)}
              onKeyDown={e => e.key === "Enter" && fetchCatalog()}
            />
            <button
              onClick={fetchCatalog}
              disabled={isLoading || !productCode.trim()}
              className="rounded-lg bg-blue-600 px-3 py-2 text-sm text-white hover:bg-blue-700 disabled:opacity-50 flex items-center gap-1"
            >
              {isLoading ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />}
            </button>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-[10px] text-gray-500">직경 (mm)</label>
              <input
                type="number"
                className="w-full rounded-lg border border-gray-300 px-2.5 py-1.5 text-sm focus:border-blue-400 focus:outline-none"
                value={diameter}
                onChange={e => setDiameter(parseFloat(e.target.value) || 10)}
                min={0.5} max={50} step={0.5}
              />
            </div>
            <div>
              <label className="text-[10px] text-gray-500">날수</label>
              <select
                className="w-full rounded-lg border border-gray-300 px-2.5 py-1.5 text-sm focus:border-blue-400 focus:outline-none"
                value={fluteCount}
                onChange={e => setFluteCount(parseInt(e.target.value))}
              >
                {[1,2,3,4,5,6].map(n => <option key={n} value={n}>{n}날</option>)}
              </select>
            </div>
          </div>
          {dataSource !== "default" && (
            <div className={`rounded-lg px-2.5 py-1.5 text-[10px] font-medium ${
              dataSource === "catalog"
                ? "bg-green-50 text-green-700 border border-green-200"
                : "bg-amber-50 text-amber-700 border border-amber-200"
            }`}>
              {dataSource === "catalog" ? "✓ 카탈로그 데이터 기반" : "⚠ 보간값 (근사치)"}
            </div>
          )}
        </div>

        {/* 소재 선택 */}
        <div className="rounded-xl border border-gray-200 bg-white p-4 space-y-3">
          <h3 className="text-sm font-semibold text-gray-900">🧱 가공 소재</h3>
          <div className="grid grid-cols-3 gap-1.5">
            {Object.entries(ISO_LABELS).map(([key, label]) => (
              <button
                key={key}
                onClick={() => setIsoGroup(key)}
                className={`rounded-lg border-2 px-2 py-2 text-center transition-all text-xs ${
                  isoGroup === key
                    ? "border-blue-500 bg-blue-50 font-bold"
                    : "border-gray-200 hover:border-gray-300"
                }`}
              >
                <div className={`text-base font-bold ${isoGroup === key ? "text-blue-700" : "text-gray-500"}`}>{key}</div>
                <div className={`text-[9px] ${isoGroup === key ? "text-blue-600" : "text-gray-400"}`}>{label.split("(")[0].trim()}</div>
              </button>
            ))}
          </div>
          <div className="text-[10px] text-gray-400">
            비절삭저항 kc = {KC_TABLE[isoGroup] ?? 2000} N/mm²
          </div>
        </div>

        {/* 가공 유형 */}
        <div className="rounded-xl border border-gray-200 bg-white p-4 space-y-3">
          <h3 className="text-sm font-semibold text-gray-900">📐 가공 유형</h3>
          <select
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-400 focus:outline-none"
            value={operation}
            onChange={e => setOperation(e.target.value)}
          >
            <option value="Side_Milling">Side Milling (측면가공)</option>
            <option value="Slotting">Slotting (슬롯가공)</option>
            <option value="Profiling">Profiling (윤곽가공)</option>
            <option value="Facing">Facing (정면가공)</option>
            <option value="Trochoidal">Trochoidal (트로코이달)</option>
            <option value="Drilling">Drilling (드릴링)</option>
          </select>

          {/* 최적화 모드 */}
          <h4 className="text-xs font-medium text-gray-700 mt-4">최적화 모드</h4>
          <div className="flex rounded-lg border border-gray-200 overflow-hidden">
            {([
              { value: "productivity" as const, label: "생산성", icon: Zap },
              { value: "balanced" as const, label: "균형", icon: Gauge },
              { value: "toollife" as const, label: "공구수명", icon: Shield },
            ]).map(({ value, label, icon: Icon }) => (
              <button
                key={value}
                onClick={() => setMode(value)}
                className={`flex-1 flex items-center justify-center gap-1 py-2 text-xs font-medium transition-all ${
                  mode === value
                    ? "bg-blue-600 text-white"
                    : "bg-white text-gray-600 hover:bg-gray-50"
                }`}
              >
                <Icon className="h-3 w-3" />
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ── 슬라이더 + 계산부 ── */}
      <div className="rounded-xl border border-gray-200 bg-white p-5">
        <h3 className="text-sm font-semibold text-gray-900 mb-4 flex items-center gap-1.5">
          <BarChart3 className="h-4 w-4" />
          절삭 파라미터 조절
        </h3>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Vc slider */}
          <div>
            <div className="flex justify-between mb-1">
              <label className="text-xs font-medium text-gray-700">Vc (절삭속도)</label>
              <span className="text-xs font-bold text-blue-700">{Vc} m/min</span>
            </div>
            <input
              type="range"
              min={Math.round(range.VcMin)}
              max={Math.round(range.VcMax)}
              step={1}
              value={Vc}
              onChange={e => setVc(parseInt(e.target.value))}
              className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-blue-600"
            />
            <div className="flex justify-between text-[10px] text-gray-400 mt-0.5">
              <span>{Math.round(range.VcMin)}</span>
              {catalogData?.ranges && <span className="text-green-600">카탈로그: {catalogData.ranges.VcMin}~{catalogData.ranges.VcMax}</span>}
              <span>{Math.round(range.VcMax)}</span>
            </div>
          </div>

          {/* fz slider */}
          <div>
            <div className="flex justify-between mb-1">
              <label className="text-xs font-medium text-gray-700">fz (날당이송)</label>
              <span className="text-xs font-bold text-blue-700">{fz.toFixed(4)} mm/t</span>
            </div>
            <input
              type="range"
              min={range.fzMin}
              max={range.fzMax}
              step={0.001}
              value={fz}
              onChange={e => setFz(parseFloat(e.target.value))}
              className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-blue-600"
            />
            <div className="flex justify-between text-[10px] text-gray-400 mt-0.5">
              <span>{range.fzMin.toFixed(3)}</span>
              {catalogData?.ranges && <span className="text-green-600">카탈로그: {catalogData.ranges.fzMin}~{catalogData.ranges.fzMax}</span>}
              <span>{range.fzMax.toFixed(3)}</span>
            </div>
          </div>

          {/* ap slider */}
          <div>
            <div className="flex justify-between mb-1">
              <label className="text-xs font-medium text-gray-700">ap (축방향 절입)</label>
              <span className="text-xs font-bold text-blue-700">{ap.toFixed(1)} mm</span>
            </div>
            <input
              type="range"
              min={0.1}
              max={range.apMax}
              step={0.1}
              value={ap}
              onChange={e => setAp(parseFloat(e.target.value))}
              className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-blue-600"
            />
            <div className="flex justify-between text-[10px] text-gray-400 mt-0.5">
              <span>0.1</span>
              <span>{range.apMax.toFixed(1)}</span>
            </div>
          </div>

          {/* ae slider */}
          <div>
            <div className="flex justify-between mb-1">
              <label className="text-xs font-medium text-gray-700">ae (경방향 절입)</label>
              <span className="text-xs font-bold text-blue-700">{ae.toFixed(1)} mm</span>
            </div>
            <input
              type="range"
              min={0.1}
              max={range.aeMax}
              step={0.1}
              value={ae}
              onChange={e => setAe(parseFloat(e.target.value))}
              className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-blue-600"
            />
            <div className="flex justify-between text-[10px] text-gray-400 mt-0.5">
              <span>0.1</span>
              <span>{range.aeMax.toFixed(1)}</span>
            </div>
          </div>
        </div>
      </div>

      {/* ── 결과부 ── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <ResultCard label="RPM (n)" value={result.n.toLocaleString()} unit="rpm" color="blue" />
        <ResultCard label="테이블이송 (Vf)" value={result.Vf.toLocaleString()} unit="mm/min" color="green" />
        <ResultCard label="금속제거율 (MRR)" value={result.MRR.toLocaleString()} unit="cm³/min" color="amber" />
        <ResultCard label="소요동력 (Pc)" value={result.Pc.toLocaleString()} unit="kW" color="red" />
      </div>

      {/* ── 카탈로그 조건 테이블 ── */}
      {catalogData?.conditions && catalogData.conditions.length > 0 && (
        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <h3 className="text-sm font-semibold text-gray-900 mb-3">📋 카탈로그 절삭조건 ({catalogData.count}건)</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b text-left text-gray-500">
                  <th className="pb-2 pr-3">가공형상</th>
                  <th className="pb-2 pr-3">직경</th>
                  <th className="pb-2 pr-3">Vc</th>
                  <th className="pb-2 pr-3">fz</th>
                  <th className="pb-2 pr-3">ap</th>
                  <th className="pb-2 pr-3">ae</th>
                  <th className="pb-2 pr-3">RPM</th>
                  <th className="pb-2">Vf</th>
                </tr>
              </thead>
              <tbody>
                {catalogData.conditions.map((c, i) => (
                  <tr key={i} className="border-b border-gray-100 last:border-0">
                    <td className="py-1.5 pr-3 text-gray-700">{c.cuttingType}</td>
                    <td className="py-1.5 pr-3">{c.diameterMm ?? "-"}</td>
                    <td className="py-1.5 pr-3 font-mono">{c.Vc ?? "-"}</td>
                    <td className="py-1.5 pr-3 font-mono">{c.fz ?? "-"}</td>
                    <td className="py-1.5 pr-3 font-mono">{c.ap ?? "-"}</td>
                    <td className="py-1.5 pr-3 font-mono">{c.ae ?? "-"}</td>
                    <td className="py-1.5 pr-3 font-mono">{c.n ?? "-"}</td>
                    <td className="py-1.5 font-mono">{c.vf ?? "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}

function ResultCard({ label, value, unit, color }: { label: string; value: string; unit: string; color: string }) {
  const colorMap: Record<string, string> = {
    blue: "from-blue-500 to-blue-600",
    green: "from-emerald-500 to-emerald-600",
    amber: "from-amber-500 to-amber-600",
    red: "from-red-500 to-red-600",
  }
  return (
    <div className={`rounded-xl bg-gradient-to-br ${colorMap[color]} p-4 text-white shadow-lg`}>
      <div className="text-[10px] uppercase tracking-wider opacity-80">{label}</div>
      <div className="text-2xl font-bold mt-1">{value}</div>
      <div className="text-xs opacity-70">{unit}</div>
    </div>
  )
}
