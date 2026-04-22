/**
 * Tool Recommender — 3-mode demo UI
 *
 * 목적: 시뮬레이터 ← 추천 API 연결. 연구소장 대면 데모 지원.
 * 연결: GET /api/simulator/recommend (route.ts 변경 없음)
 *
 * 3 모드:
 *  🎯 current       — 현재 조건(iso/diameter/shape/hardness) 그대로 추천 (기본, 기존 동작 흡수)
 *  🔍 diameter-only — iso + diameter만 (shape/hardness 생략) → 넓은 탐색
 *  💎 strict        — 모든 필터 엄격 → 최고 매칭 top 1~2
 *
 * onPick (실연동): setProductCode + setDiameter + fetchCatalog 까지 전파되는 기존 콜백 그대로 유지.
 *
 * 보강:
 *  - DEMO 배지, 🥇🥈🥉 메달 + 금/은/동 배경 그라데이션
 *  - 다크모드 (dark: prefix)
 *  - 에러 배너 + 재시도, 10s AbortController 타임아웃
 *  - 결과 닫기 X 버튼
 */

// SPDX-License-Identifier: MIT
"use client"

import { useCallback, useEffect, useState } from "react"
import { Wrench, Sparkles, RefreshCw, Loader2, Target, Search, Gem, X, RotateCcw } from "lucide-react"

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

interface RecommendResponse {
  iso: string
  diameter: number | null
  shape: string | null
  hardness: string | null
  total: number
  recommendations: Recommendation[]
}

interface ToolRecommenderProps {
  iso: string
  diameter: number
  shape: string
  hardness?: string
  onPick: (series: string, closestDiameter: number | null) => void
}

type Mode = "current" | "diameter-only" | "strict"

const MODE_META: Record<Mode, { icon: typeof Target; title: string; subtitle: string; emoji: string }> = {
  current: { icon: Target, title: "현재 조건 그대로", subtitle: "iso + 직경 + 형상 + 경도", emoji: "🎯" },
  "diameter-only": { icon: Search, title: "직경만 넓게 탐색", subtitle: "iso + 직경만 (형상/경도 생략)", emoji: "🔍" },
  strict: { icon: Gem, title: "프리미엄 매칭", subtitle: "모든 필터 엄격 → top 1~2", emoji: "💎" },
}

async function fetchRecs(params: {
  iso: string
  diameter?: number
  shape?: string
  hardness?: string
}): Promise<RecommendResponse> {
  const query = new URLSearchParams({ iso: params.iso })
  if (params.diameter) query.set("diameter", String(params.diameter))
  if (params.shape) query.set("shape", params.shape)
  if (params.hardness) query.set("hardness", params.hardness)
  query.set("limit", "6")

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 10000)
  try {
    const res = await fetch(`/api/simulator/recommend?${query.toString()}`, { signal: controller.signal })
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: "알 수 없는 오류" }))
      throw new Error(err.error || `HTTP ${res.status}`)
    }
    return res.json()
  } finally {
    clearTimeout(timeout)
  }
}

export function ToolRecommender({ iso, diameter, shape, hardness, onPick }: ToolRecommenderProps) {
  const [recs, setRecs] = useState<Recommendation[]>([])
  const [loading, setLoading] = useState<Mode | null>(null)
  const [open, setOpen] = useState(false)
  const [activeMode, setActiveMode] = useState<Mode>("current")
  const [error, setError] = useState<string | null>(null)
  const [lastMode, setLastMode] = useState<Mode | null>(null)

  const hasMinimum = Boolean(iso && diameter && diameter > 0)

  const run = useCallback(
    async (mode: Mode) => {
      if (!hasMinimum) return
      setLoading(mode)
      setError(null)
      setActiveMode(mode)
      try {
        const params: Parameters<typeof fetchRecs>[0] = { iso, diameter }
        if (mode === "current" || mode === "strict") {
          if (shape) params.shape = shape
          if (hardness) params.hardness = hardness
        }
        const data = await fetchRecs(params)
        setRecs(data.recommendations ?? [])
        setLastMode(mode)
      } catch (e) {
        const msg = e instanceof Error ? e.message : "네트워크 오류"
        setError(msg)
        setRecs([])
      } finally {
        setLoading(null)
      }
    },
    [iso, diameter, shape, hardness, hasMinimum]
  )

  // 기존 동작 보존: 패널 열 때 현재 조건으로 자동 fetch (= "current" 모드)
  useEffect(() => {
    if (open && recs.length === 0 && !error && !loading && lastMode === null) {
      run("current")
    }
  }, [open, recs.length, error, loading, lastMode, run])

  const retry = () => {
    if (lastMode) run(lastMode)
    else run("current")
  }

  const clearResults = () => {
    setRecs([])
    setError(null)
    setLastMode(null)
  }

  const meta = MODE_META[activeMode]

  return (
    <div className="rounded-xl border border-indigo-200 dark:border-indigo-800 bg-gradient-to-br from-indigo-50/50 to-white dark:from-slate-800 dark:to-slate-900">
      {/* 헤더 (토글) */}
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-indigo-50/50 dark:hover:bg-slate-700/50 transition-colors"
      >
        <span className="text-sm font-semibold text-indigo-900 dark:text-indigo-200 flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-indigo-600 dark:text-indigo-400" />
          이 조건에 맞는 YG-1 공구 추천 (DB 연동)
          <span className="inline-flex items-center rounded-full bg-amber-100 dark:bg-amber-900 px-2 py-0.5 text-[10px] font-medium text-amber-800 dark:text-amber-200">
            DEMO
          </span>
          {recs.length > 0 && (
            <span className="text-[10px] font-mono bg-indigo-100 dark:bg-indigo-900 text-indigo-700 dark:text-indigo-200 px-1.5 py-0.5 rounded">
              {recs.length}종
            </span>
          )}
        </span>
        <span className={`text-xs text-slate-500 transition-transform ${open ? "rotate-180" : ""}`}>▼</span>
      </button>

      {open && (
        <div className="border-t border-indigo-200 dark:border-indigo-800 p-3 space-y-2.5">
          {/* 3 모드 버튼 */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
            {(Object.keys(MODE_META) as Mode[]).map((m) => {
              const mm = MODE_META[m]
              const Icon = mm.icon
              const active = activeMode === m && lastMode === m
              const isLoadingThis = loading === m
              return (
                <button
                  key={m}
                  type="button"
                  onClick={() => run(m)}
                  disabled={loading !== null || !hasMinimum}
                  title={!hasMinimum ? "재질(ISO)과 직경을 먼저 설정하세요" : undefined}
                  className={`flex flex-col items-start gap-1 rounded-lg border-2 p-2.5 text-left transition disabled:opacity-50 disabled:cursor-not-allowed ${
                    active
                      ? "border-indigo-500 bg-indigo-50 dark:bg-indigo-900/40 dark:border-indigo-400"
                      : "border-indigo-200 dark:border-indigo-800 bg-white dark:bg-slate-800 hover:border-indigo-400 hover:shadow-sm"
                  }`}
                >
                  <div className="flex items-center gap-1.5 text-indigo-700 dark:text-indigo-300 font-semibold">
                    {isLoadingThis ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Icon className="h-3.5 w-3.5" />}
                    <span className="text-xs">
                      {mm.emoji} {mm.title}
                    </span>
                  </div>
                  <div className="text-[10px] text-slate-500 dark:text-slate-400">
                    {isLoadingThis ? "추천 중..." : mm.subtitle}
                  </div>
                </button>
              )
            })}
          </div>

          {/* 현재 조건 요약 + Refresh */}
          <div className="flex items-center gap-2 text-[10px] text-gray-500 dark:text-gray-400">
            <span>
              현재 조건:{" "}
              <b className="text-gray-800 dark:text-gray-200">
                ISO {iso} · ⌀{diameter}mm · {shape}
              </b>
              {hardness && <> · 경도 {hardness}</>}
            </span>
            {recs.length > 0 && !loading && (
              <>
                <button
                  onClick={() => run(activeMode)}
                  className="ml-auto flex items-center gap-1 rounded border border-indigo-300 dark:border-indigo-700 bg-white dark:bg-slate-800 px-2 py-0.5 text-[10px] text-indigo-700 dark:text-indigo-300 hover:bg-indigo-50 dark:hover:bg-indigo-900/40"
                  aria-label={`${meta.title} 재조회`}
                >
                  <RefreshCw className="h-2.5 w-2.5" /> 새로 찾기
                </button>
                <button
                  onClick={clearResults}
                  className="rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-slate-800 px-1.5 py-0.5 text-[10px] text-gray-500 hover:text-red-600 hover:border-red-300"
                  aria-label="결과 닫기"
                >
                  <X className="h-2.5 w-2.5" />
                </button>
              </>
            )}
          </div>

          {/* 에러 배너 */}
          {error && (
            <div className="rounded-lg border border-red-300 dark:border-red-700 bg-red-50 dark:bg-red-900/30 p-2.5">
              <div className="flex items-center justify-between gap-2">
                <div className="text-[11px] text-red-800 dark:text-red-200">
                  <span className="font-semibold">⚠ 추천 실패:</span> {error}
                </div>
                <button
                  onClick={retry}
                  className="inline-flex items-center gap-1 rounded border border-red-400 bg-white dark:bg-slate-800 px-2 py-0.5 text-[10px] font-medium text-red-700 dark:text-red-300 hover:bg-red-50 dark:hover:bg-red-950"
                >
                  <RotateCcw className="h-2.5 w-2.5" /> 재시도
                </button>
              </div>
            </div>
          )}

          {/* 로딩 플레이스홀더 (첫 fetch 시) */}
          {loading && recs.length === 0 && !error && (
            <div className="text-center py-4 text-[11px] text-gray-500 dark:text-gray-400">
              <RefreshCw className="h-4 w-4 animate-spin inline mr-1.5" />
              카탈로그 검색 중...
            </div>
          )}

          {/* 결과 없음 */}
          {!loading && recs.length === 0 && lastMode && !error && (
            <div className="text-[11px] text-gray-500 dark:text-gray-400 py-3 text-center">
              해당 조건에 매칭된 시리즈 없음. 다른 모드로 시도해보세요.
            </div>
          )}

          {/* 결과 카드 */}
          {!loading && recs.length > 0 && (
            <div className="space-y-2">
              <div className="text-[10px] text-slate-500 dark:text-slate-400 font-mono">
                [{meta.emoji} {meta.title}] 상위 {recs.length}개 표시
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                {recs.map((r, i) => {
                  // 금/은/동 카드 배경
                  const cardStyle =
                    i === 0
                      ? "bg-gradient-to-br from-amber-50 to-amber-100 border-amber-400 dark:from-amber-900/30 dark:to-amber-950/30 dark:border-amber-600"
                      : i === 1
                      ? "bg-gradient-to-br from-slate-50 to-slate-100 border-slate-400 dark:from-slate-800 dark:to-slate-900 dark:border-slate-500"
                      : i === 2
                      ? "bg-gradient-to-br from-orange-50 to-orange-100 border-orange-300 dark:from-orange-900/20 dark:to-orange-950/20 dark:border-orange-700"
                      : "bg-white border-indigo-100 dark:bg-slate-800/50 dark:border-slate-700"
                  const medal = i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : `#${i + 1}`
                  return (
                    <div
                      key={r.series}
                      className={`rounded-lg border-2 p-2.5 transition hover:shadow-md ${cardStyle}`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5 mb-1">
                            <span className="text-base leading-none">{medal}</span>
                            <span className="font-mono font-bold text-gray-900 dark:text-gray-100">
                              {r.series}
                            </span>
                            <span className="text-[9px] font-mono bg-emerald-50 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300 px-1.5 py-0.5 rounded">
                              Score {r.score}
                            </span>
                          </div>
                          <div className="text-[10px] text-gray-600 dark:text-gray-400 space-y-0.5">
                            <div>
                              데이터 {r.count}건
                              {r.closestDiameter != null && (
                                <>
                                  {" "}
                                  · 최근접 ⌀<b>{r.closestDiameter}mm</b>
                                </>
                              )}
                            </div>
                            {r.cuttingTypes.length > 0 && (
                              <div className="truncate">형상: {r.cuttingTypes.slice(0, 2).join(", ")}</div>
                            )}
                            {r.sampleWorkpieces.length > 0 && (
                              <div className="truncate text-gray-500 dark:text-gray-500">
                                소재: {r.sampleWorkpieces.slice(0, 2).join(", ")}
                              </div>
                            )}
                          </div>
                          <div className="mt-1 flex flex-wrap gap-1">
                            {r.matchReasons.slice(0, 3).map((reason, j) => (
                              <span
                                key={j}
                                className="text-[9px] font-mono bg-indigo-50 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300 px-1.5 py-0.5 rounded"
                              >
                                {reason}
                              </span>
                            ))}
                          </div>
                        </div>
                        <button
                          onClick={() => onPick(r.series, r.closestDiameter)}
                          className="flex items-center gap-1 rounded bg-indigo-600 hover:bg-indigo-700 text-white px-2 py-1 text-[10px] font-semibold flex-shrink-0 transition"
                        >
                          <Wrench className="h-3 w-3" /> 적용
                        </button>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
