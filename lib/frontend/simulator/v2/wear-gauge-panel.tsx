// SPDX-License-Identifier: MIT
// YG-1 ARIA Simulator v3 — 공구 마모 예측 게이지 패널
// Taylor 공식 기반 예상 공구 수명 대비 누적 가공 시간 입력 → 남은 수명 % 시각화.
// 100% 클라이언트 사이드, cutting-simulator-v2.tsx 와 독립.
"use client"

import { useMemo, useState } from "react"
import { Wrench, RotateCcw, Plus, AlertTriangle, CheckCircle2, Siren, BookOpen } from "lucide-react"
import FeatureExplainer from "./feature-explainer"

// ─────────────────────────────────────────────────────────────────────
// 상수 (로컬 SSOT — 임계치/색상/빠른버튼 값)
// ─────────────────────────────────────────────────────────────────────

const THRESHOLD_SAFE = 60   // >= 60% → 정상
const THRESHOLD_WARN = 30   // 30~60% → 교체 준비, < 30% → 교체 권장
const TAYLOR_N_CARBIDE = 0.25
const QUICK_ADD_MIN: readonly number[] = [5, 30]

// 원형 게이지 지오메트리
const GAUGE_RADIUS = 72
const GAUGE_STROKE = 14
const GAUGE_SIZE = (GAUGE_RADIUS + GAUGE_STROKE) * 2 + 4  // viewBox
const GAUGE_CIRC = 2 * Math.PI * GAUGE_RADIUS

// ─────────────────────────────────────────────────────────────────────
// Props
// ─────────────────────────────────────────────────────────────────────

export interface WearGaugePanelProps {
  /** estimateToolLifeMin 결과 — 이미 cutting-calculator 에 있음 */
  predictedLifeMin: number
  /** 현재 Vc (m/min) */
  currentVc: number
  /** 카탈로그 권장 Vc (m/min) */
  vcRef: number
  darkMode?: boolean
}

// ─────────────────────────────────────────────────────────────────────
// 유틸
// ─────────────────────────────────────────────────────────────────────

type Band = "safe" | "warn" | "danger"

function bandOf(remainingPct: number): Band {
  if (remainingPct >= THRESHOLD_SAFE) return "safe"
  if (remainingPct >= THRESHOLD_WARN) return "warn"
  return "danger"
}

function clamp(n: number, lo: number, hi: number): number {
  if (!Number.isFinite(n)) return lo
  return Math.max(lo, Math.min(hi, n))
}

function fmt(n: number, d = 1): string {
  if (!Number.isFinite(n)) return "—"
  return n.toFixed(d)
}

interface BandTheme {
  stroke: string          // SVG stroke hex
  centerText: string      // 중앙 큰 숫자 클래스
  bannerBg: string        // 경고 배너 bg
  bannerText: string
  bannerBorder: string
  sliderAccent: string
}

function bandTheme(b: Band, darkMode: boolean): BandTheme {
  if (b === "safe") {
    return {
      stroke: darkMode ? "#34d399" : "#10b981",
      centerText: darkMode ? "text-emerald-300" : "text-emerald-700",
      bannerBg: darkMode ? "bg-emerald-900/30" : "bg-emerald-50",
      bannerText: darkMode ? "text-emerald-200" : "text-emerald-800",
      bannerBorder: darkMode ? "border-emerald-700" : "border-emerald-300",
      sliderAccent: "accent-emerald-500",
    }
  }
  if (b === "warn") {
    return {
      stroke: darkMode ? "#fbbf24" : "#f59e0b",
      centerText: darkMode ? "text-amber-300" : "text-amber-700",
      bannerBg: darkMode ? "bg-amber-900/30" : "bg-amber-50",
      bannerText: darkMode ? "text-amber-200" : "text-amber-800",
      bannerBorder: darkMode ? "border-amber-700" : "border-amber-300",
      sliderAccent: "accent-amber-500",
    }
  }
  return {
    stroke: darkMode ? "#fb7185" : "#e11d48",
    centerText: darkMode ? "text-rose-300" : "text-rose-700",
    bannerBg: darkMode ? "bg-rose-900/30" : "bg-rose-50",
    bannerText: darkMode ? "text-rose-200" : "text-rose-800",
    bannerBorder: darkMode ? "border-rose-700" : "border-rose-300",
    sliderAccent: "accent-rose-500",
  }
}

// ─────────────────────────────────────────────────────────────────────
// 컴포넌트
// ─────────────────────────────────────────────────────────────────────

export function WearGaugePanel({
  predictedLifeMin,
  currentVc,
  vcRef,
  darkMode = false,
}: WearGaugePanelProps) {
  const [usedMin, setUsedMin] = useState<number>(0)

  const safeLife = Number.isFinite(predictedLifeMin) && predictedLifeMin > 0 ? predictedLifeMin : 1

  const clampedUsed = clamp(usedMin, 0, safeLife)
  const remainingMin = Math.max(0, safeLife - clampedUsed)
  const remainingPct = clamp((remainingMin / safeLife) * 100, 0, 100)

  const band = bandOf(remainingPct)
  const theme = useMemo(() => bandTheme(band, darkMode), [band, darkMode])

  // SVG 원형 게이지 — 상단 12시부터 시계방향, 남은 % 만큼 채움
  const dashOffset = useMemo(() => GAUGE_CIRC * (1 - remainingPct / 100), [remainingPct])

  const handleReset = () => setUsedMin(0)
  const handleAdd = (delta: number) => setUsedMin(prev => clamp(prev + delta, 0, safeLife))
  const handleInput = (v: string) => {
    const num = Number.parseFloat(v)
    if (Number.isFinite(num)) setUsedMin(clamp(num, 0, safeLife))
    else if (v === "") setUsedMin(0)
  }
  const handleSlider = (v: string) => {
    const num = Number.parseFloat(v)
    if (Number.isFinite(num)) setUsedMin(clamp(num, 0, safeLife))
  }

  // ── 외곽 카드 스타일 ──
  const cardCls = darkMode
    ? "rounded-xl border border-slate-700 bg-gradient-to-br from-slate-900 to-amber-950/20"
    : "rounded-xl border border-slate-200 bg-gradient-to-br from-slate-50 to-amber-50/30"

  const headerTitleCls = darkMode ? "text-slate-100" : "text-slate-800"
  const subTextCls = darkMode ? "text-slate-400" : "text-slate-600"
  const inputCls = darkMode
    ? "w-full rounded-md border border-slate-600 bg-slate-800 px-2 py-1 text-sm text-slate-100 focus:outline-none focus:ring-2 focus:ring-amber-500"
    : "w-full rounded-md border border-slate-300 bg-white px-2 py-1 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-amber-400"

  const buttonCls = darkMode
    ? "inline-flex items-center gap-1 rounded-md border border-slate-600 bg-slate-800 px-2 py-1 text-xs text-slate-200 hover:bg-slate-700"
    : "inline-flex items-center gap-1 rounded-md border border-slate-300 bg-white px-2 py-1 text-xs text-slate-700 hover:bg-slate-100"

  const calloutCls = darkMode
    ? "rounded-lg border border-slate-700 bg-slate-900/60 p-3 text-xs text-slate-300"
    : "rounded-lg border border-slate-200 bg-white/70 p-3 text-xs text-slate-600"

  // 배경 원 stroke
  const bgRingStroke = darkMode ? "#334155" : "#e2e8f0"

  // 배너 내용
  const bannerNode = (() => {
    if (band === "danger") {
      return (
        <div className={`flex items-center gap-2 rounded-lg border ${theme.bannerBorder} ${theme.bannerBg} px-3 py-2 text-sm font-semibold ${theme.bannerText}`}>
          <Siren className="h-4 w-4 shrink-0" />
          <span>🚨 교체 권장 — 잔여 {remainingPct.toFixed(0)}%. 지금 교체하세요.</span>
        </div>
      )
    }
    if (band === "warn") {
      return (
        <div className={`flex items-center gap-2 rounded-lg border ${theme.bannerBorder} ${theme.bannerBg} px-3 py-2 text-sm font-semibold ${theme.bannerText}`}>
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span>⚠ 교체 준비 — 잔여 {remainingPct.toFixed(0)}%. 다음 공구 준비 권장.</span>
        </div>
      )
    }
    return (
      <div className={`flex items-center gap-2 rounded-lg border ${theme.bannerBorder} ${theme.bannerBg} px-3 py-2 text-sm font-semibold ${theme.bannerText}`}>
        <CheckCircle2 className="h-4 w-4 shrink-0" />
        <span>✅ 정상 — 잔여 {remainingPct.toFixed(0)}%. 계속 가공 가능.</span>
      </div>
    )
  })()

  return (
    <div className={`${cardCls} p-4 sm:p-5 shadow-sm`}>
      {/* 헤더 */}
      <div className="mb-4 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Wrench className={darkMode ? "h-5 w-5 text-amber-400" : "h-5 w-5 text-amber-600"} />
          <h3 className={`text-base font-bold sm:text-lg ${headerTitleCls}`}>🔧 공구 마모 예측 게이지</h3>
          <FeatureExplainer featureId="wear-gauge" inline darkMode={darkMode} />
        </div>
        {/* TODO: <VendorTag featureId="wear-gauge" /> */}
      </div>

      {/* 본문: 모바일 세로 스택 / 데스크탑 좌우 */}
      <div className="flex flex-col gap-4 lg:flex-row lg:items-stretch">
        {/* 좌: 원형 게이지 */}
        <div className="flex flex-1 items-center justify-center">
          <div className="relative" style={{ width: GAUGE_SIZE, height: GAUGE_SIZE }}>
            <svg
              viewBox={`0 0 ${GAUGE_SIZE} ${GAUGE_SIZE}`}
              width={GAUGE_SIZE}
              height={GAUGE_SIZE}
              className="-rotate-90"
            >
              {/* 배경 링 */}
              <circle
                cx={GAUGE_SIZE / 2}
                cy={GAUGE_SIZE / 2}
                r={GAUGE_RADIUS}
                fill="none"
                stroke={bgRingStroke}
                strokeWidth={GAUGE_STROKE}
              />
              {/* 진행 링 */}
              <circle
                cx={GAUGE_SIZE / 2}
                cy={GAUGE_SIZE / 2}
                r={GAUGE_RADIUS}
                fill="none"
                stroke={theme.stroke}
                strokeWidth={GAUGE_STROKE}
                strokeLinecap="round"
                strokeDasharray={GAUGE_CIRC}
                strokeDashoffset={dashOffset}
                style={{ transition: "stroke-dashoffset 260ms ease, stroke 260ms ease" }}
              />
            </svg>
            {/* 중앙 텍스트 */}
            <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
              <div className={`text-4xl font-extrabold leading-none sm:text-5xl ${theme.centerText}`}>
                {remainingPct.toFixed(0)}%
              </div>
              <div className={`mt-1 text-[11px] font-medium ${subTextCls}`}>
                {fmt(remainingMin, 1)} / {fmt(safeLife, 1)} min 남음
              </div>
            </div>
          </div>
        </div>

        {/* 우: 입력 + 배너 */}
        <div className="flex flex-1 flex-col gap-3">
          {bannerNode}

          {/* 입력 블록 */}
          <div className="flex flex-col gap-2">
            <label className={`text-xs font-semibold ${subTextCls}`}>
              누적 가공 시간 (min)
            </label>
            <div className="flex items-center gap-2">
              <input
                type="number"
                min={0}
                max={safeLife}
                step={0.1}
                value={clampedUsed}
                onChange={(e) => handleInput(e.target.value)}
                className={inputCls}
                aria-label="누적 가공 시간"
              />
            </div>
            <input
              type="range"
              min={0}
              max={safeLife}
              step={Math.max(0.1, safeLife / 200)}
              value={clampedUsed}
              onChange={(e) => handleSlider(e.target.value)}
              className={`w-full ${theme.sliderAccent}`}
              aria-label="누적 가공 시간 슬라이더"
            />

            {/* 빠른 버튼 */}
            <div className="flex flex-wrap items-center gap-2">
              {QUICK_ADD_MIN.map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => handleAdd(m)}
                  className={buttonCls}
                >
                  <Plus className="h-3 w-3" />
                  {m}분 추가
                </button>
              ))}
              <button
                type="button"
                onClick={handleReset}
                className={buttonCls}
                aria-label="누적 시간 리셋"
              >
                <RotateCcw className="h-3 w-3" />
                리셋
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Taylor 설명 캘러웃 */}
      <div className={`mt-4 ${calloutCls}`}>
        <div className="mb-1 flex items-center gap-1.5 font-semibold">
          <BookOpen className="h-3.5 w-3.5" />
          <span>📘 Taylor의 공구 수명 공식</span>
        </div>
        <div className="font-mono leading-relaxed">
          T = T_ref × (Vc_ref / Vc)^(1/n)
        </div>
        <div className="mt-1 leading-relaxed">
          → 현재 Vc={fmt(currentVc, 1)}, Vc_ref={fmt(vcRef, 1)}, n={TAYLOR_N_CARBIDE} (carbide)
          <br />
          → 예상 수명 {fmt(safeLife, 1)} min
        </div>
      </div>
    </div>
  )
}

export default WearGaugePanel
