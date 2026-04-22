"use client"

/**
 * 가공조건 히트맵 패널 (v3 STEP 6-2)
 *
 * ADOC(ap) × RDOC(ae) 공간을 2D 히트맵으로 시각화:
 *  - X축: RDOC (ae) 0 ~ D
 *  - Y축: ADOC (ap) 0 ~ 2·D
 *  - 색상: 각 (ap, ae) 조합에서 계산된 MRR (녹색 그라데이션)
 *  - 경고 오버레이 (반투명 빨간색):
 *      • ap > 2D (물리 한계)
 *      • Pc > maxKw (파워 초과)
 *      • ae > D (슬로팅 한계)
 *  - 현재 조건 점: 녹색 원 + 중앙 십자
 *  - Sweet spot: 경고 없는 MRR 상위 20% 중 현재점 근처를 녹색 투명 overlay
 *  - 클릭 시 onSpotClick(ap, ae) 콜백
 *  - 교육 모드 on: 각 영역 위 툴팁 해설
 *
 * recharts 의존성 최소화 — 자립적으로 SVG를 직접 렌더합니다.
 * (20×20 = 400 격자 cell 렌더 시 recharts ScatterChart는 tooltip 처리가
 *  무거워지므로 native SVG + useMemo 로 성능을 확보.)
 */

import { useCallback, useMemo, useState } from "react"
import {
  calculateCutting,
  estimateChatterRisk,
} from "@/lib/frontend/simulator/cutting-calculator"
import FeatureExplainer from "./feature-explainer"

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────

export interface HeatmapPanelProps {
  /** 현재 ap (mm) */
  currentAp: number
  /** 현재 ae (mm) */
  currentAe: number
  /** 공구 직경 D (mm) */
  D: number
  /** 공구 날수 Z */
  Z: number
  /** ISO 공작물 그룹 (P/M/K/N/S/H) */
  isoGroup: string
  /** 절삭속도 Vc (m/min) — 고정, 히트맵 내부 재계산에 사용 */
  Vc: number
  /** 날당 이송 fz (mm/tooth) — 고정 */
  fz: number
  /** 스핀들 최대 파워 (kW) */
  maxKw: number
  /** 클릭 시 좌표 콜백 */
  onSpotClick?: (ap: number, ae: number) => void
  /** 교육 모드: 해설 툴팁 활성화 */
  educationMode?: boolean
  /** stickout (L/D 계산용) — chatter risk 가늠 */
  stickoutMm?: number
  /** 워크홀딩 (0~100) */
  workholding?: number
  className?: string
}

interface Cell {
  /** 셀 중심 ap (mm) */
  ap: number
  /** 셀 중심 ae (mm) */
  ae: number
  apIdx: number
  aeIdx: number
  MRR: number
  Pc: number
  n: number
  /** 경고 플래그 */
  warnApOverLimit: boolean // ap > 2D
  warnAeOverD: boolean     // ae > D (슬로팅)
  warnPower: boolean       // Pc > maxKw
  /** 합산 경고 */
  hasWarning: boolean
}

// ─────────────────────────────────────────────────────────────
// 상수
// ─────────────────────────────────────────────────────────────

const GRID_N = 20 // 20×20 샘플링
const MARGIN = { top: 16, right: 16, bottom: 44, left: 52 }
const SVG_W = 520
const SVG_H = 420

// 녹색 그라데이션: MRR 낮음(밝은 연두) → 높음(진한 청록 녹색)
function mrrColor(ratio: number): string {
  // ratio ∈ [0, 1]
  const r = Math.min(1, Math.max(0, ratio))
  // HSL: H 120 (green) → 160 (teal), S 50→75, L 85→35
  const h = 120 + r * 40
  const s = 50 + r * 25
  const l = 85 - r * 50
  return `hsl(${h.toFixed(0)} ${s.toFixed(0)}% ${l.toFixed(0)}%)`
}

// ─────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────

export function HeatmapPanel(props: HeatmapPanelProps) {
  const {
    currentAp,
    currentAe,
    D,
    Z,
    isoGroup,
    Vc,
    fz,
    maxKw,
    onSpotClick,
    educationMode = false,
    stickoutMm = 30,
    workholding = 65,
    className = "",
  } = props

  // ── 격자 계산 (20×20 = 400) ────────────────────────────────
  const { cells, mrrMax, mrrMin, apMax, aeMax } = useMemo(() => {
    const apMaxLocal = Math.max(D * 2, 0.001)
    const aeMaxLocal = Math.max(D, 0.001)
    const apStep = apMaxLocal / GRID_N
    const aeStep = aeMaxLocal / GRID_N

    const list: Cell[] = []
    let minMRR = Infinity
    let maxMRR = 0

    for (let i = 0; i < GRID_N; i++) {
      for (let j = 0; j < GRID_N; j++) {
        // cell center coords
        const ap = (i + 0.5) * apStep
        const ae = (j + 0.5) * aeStep
        const r = calculateCutting({ Vc, fz, ap, ae, D, Z, isoGroup })

        const warnApOverLimit = ap > 2 * D
        const warnAeOverD = ae > D
        const warnPower = r.Pc > maxKw

        const cell: Cell = {
          ap,
          ae,
          apIdx: i,
          aeIdx: j,
          MRR: r.MRR,
          Pc: r.Pc,
          n: r.n,
          warnApOverLimit,
          warnAeOverD,
          warnPower,
          hasWarning: warnApOverLimit || warnAeOverD || warnPower,
        }
        list.push(cell)
        if (!cell.hasWarning) {
          if (r.MRR > maxMRR) maxMRR = r.MRR
          if (r.MRR < minMRR) minMRR = r.MRR
        }
      }
    }
    if (!Number.isFinite(minMRR)) minMRR = 0

    return {
      cells: list,
      mrrMax: maxMRR,
      mrrMin: minMRR,
      apMax: apMaxLocal,
      aeMax: aeMaxLocal,
    }
  }, [D, Z, isoGroup, Vc, fz, maxKw])

  // ── Sweet spot: 경고 없고 MRR 상위 20% 중 현재점 근처 ───────
  const sweetSpots = useMemo(() => {
    const safe = cells.filter((c) => !c.hasWarning && c.MRR > 0)
    if (safe.length === 0) return new Set<string>()
    const sorted = [...safe].sort((a, b) => b.MRR - a.MRR)
    const threshold = sorted[Math.floor(sorted.length * 0.2)]?.MRR ?? 0

    // 현재점 근처 (L∞ norm in idx space, 반경 4 격자)
    const curApIdx = Math.min(
      GRID_N - 1,
      Math.max(0, Math.floor((currentAp / apMax) * GRID_N)),
    )
    const curAeIdx = Math.min(
      GRID_N - 1,
      Math.max(0, Math.floor((currentAe / aeMax) * GRID_N)),
    )
    const RADIUS = 4

    const set = new Set<string>()
    for (const c of safe) {
      if (c.MRR < threshold) continue
      const d = Math.max(
        Math.abs(c.apIdx - curApIdx),
        Math.abs(c.aeIdx - curAeIdx),
      )
      if (d <= RADIUS) set.add(`${c.apIdx}_${c.aeIdx}`)
    }
    return set
  }, [cells, currentAp, currentAe, apMax, aeMax])

  // ── Chatter risk (정보용) ─────────────────────────────────
  const chatterInfo = useMemo(() => {
    // 현재 셀 기준 deflection 없이 대략적 risk — 표시만
    const apHereCell = cells.find((c) => {
      const dx = Math.abs(c.ap - currentAp)
      const dy = Math.abs(c.ae - currentAe)
      return dx <= apMax / GRID_N / 2 && dy <= aeMax / GRID_N / 2
    })
    const PcHere = apHereCell?.Pc ?? 0
    return estimateChatterRisk({
      stickoutMm,
      D,
      Pc: PcHere,
      maxKw,
      workholdingSecurity: workholding,
      deflectionUm: 0,
    })
  }, [
    cells,
    currentAp,
    currentAe,
    apMax,
    aeMax,
    stickoutMm,
    D,
    maxKw,
    workholding,
  ])

  // ── 스케일 함수 ────────────────────────────────────────────
  const innerW = SVG_W - MARGIN.left - MARGIN.right
  const innerH = SVG_H - MARGIN.top - MARGIN.bottom
  const cellW = innerW / GRID_N
  const cellH = innerH / GRID_N

  const xScale = useCallback(
    (ae: number) => MARGIN.left + (ae / aeMax) * innerW,
    [aeMax, innerW],
  )
  // Y축은 ap (뒤집음: ap 0이 아래)
  const yScale = useCallback(
    (ap: number) => MARGIN.top + innerH - (ap / apMax) * innerH,
    [apMax, innerH],
  )

  // ── Hover state ────────────────────────────────────────────
  const [hover, setHover] = useState<Cell | null>(null)

  const handleCellClick = useCallback(
    (c: Cell) => {
      if (!onSpotClick) return
      // 경고 있는 셀 클릭은 무시 (사용자 실수 방지)
      if (c.hasWarning) return
      onSpotClick(
        parseFloat(c.ap.toFixed(2)),
        parseFloat(c.ae.toFixed(2)),
      )
    },
    [onSpotClick],
  )

  // ── Axis ticks ─────────────────────────────────────────────
  const xTicks = useMemo(() => {
    const arr: number[] = []
    const step = aeMax / 4
    for (let i = 0; i <= 4; i++) arr.push(i * step)
    return arr
  }, [aeMax])
  const yTicks = useMemo(() => {
    const arr: number[] = []
    const step = apMax / 4
    for (let i = 0; i <= 4; i++) arr.push(i * step)
    return arr
  }, [apMax])

  // ── MRR 정규화 ─────────────────────────────────────────────
  const normalize = useCallback(
    (mrr: number) => {
      if (mrrMax <= mrrMin) return 0
      return (mrr - mrrMin) / (mrrMax - mrrMin)
    },
    [mrrMax, mrrMin],
  )

  // 교육 모드 영역 해설
  const eduRegionHint = useMemo(() => {
    if (!educationMode || !hover) return null
    const { ap, ae } = hover
    const aeRatio = ae / D
    const apRatio = ap / D
    // HEM 영역: ap 크고 ae 작음
    if (apRatio >= 1.0 && aeRatio <= 0.3) {
      return "HEM 황금지대 — ap 크고 ae 작아서 공구 수명 양호 + MRR 높음 (Helical HEM 권장)"
    }
    if (aeRatio >= 0.95) {
      return "슬로팅 한계 영역 — ae ≈ D 는 chip evacuation 불리, 공구 파손 위험"
    }
    if (apRatio > 2) {
      return "LOC 초과 영역 — ap > 2D 는 물리적 한계, 공구 제원 위반"
    }
    if (hover.warnPower) {
      return `파워 초과 영역 — Pc ${hover.Pc.toFixed(2)}kW > 스핀들 ${maxKw}kW`
    }
    if (apRatio <= 0.3 && aeRatio >= 0.5) {
      return "전통 슬로팅 영역 — ap 작고 ae 큼, 마감에 적합하나 MRR 낮음"
    }
    return "일반 영역 — 표준 사이드밀링 조건"
  }, [educationMode, hover, D, maxKw])

  const showSweetSpots = sweetSpots.size > 0

  return (
    <section
      className={`rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-sm ${className}`}
      data-testid="heatmap-panel"
    >
      {/* Header */}
      <header className="flex items-center justify-between gap-2 border-b border-slate-100 dark:border-slate-800 px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="text-lg" aria-hidden>
            📊
          </span>
          <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100">
            가공조건 히트맵 (ADOC × RDOC)
          </h3>
          {educationMode && (
            <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-emerald-800">
              EDU
            </span>
          )}
          <FeatureExplainer featureId="heatmap" inline />
        </div>

        <div className="text-[11px] text-slate-500 dark:text-slate-400">
          D={D}mm · Z={Z} · Vc={Vc} · fz={fz} · ISO {isoGroup}
        </div>
      </header>

      {/* Body */}
      <div className="flex flex-col gap-3 p-4 md:flex-row md:items-start">
        {/* SVG 차트 */}
        <div className="flex-shrink-0 overflow-x-auto -mx-1 px-1">
          <svg
            viewBox={`0 0 ${SVG_W} ${SVG_H}`}
            className="max-w-full"
            style={{ width: SVG_W, height: SVG_H, minWidth: 480 }}
            role="img"
            aria-label="가공조건 히트맵"
            onMouseLeave={() => setHover(null)}
          >
            <defs>
              <pattern
                id="heatmap-warn-pattern"
                width="6"
                height="6"
                patternUnits="userSpaceOnUse"
                patternTransform="rotate(45)"
              >
                <rect width="6" height="6" fill="rgba(239,68,68,0.18)" />
                <line
                  x1="0"
                  y1="0"
                  x2="0"
                  y2="6"
                  stroke="rgba(239,68,68,0.45)"
                  strokeWidth="1"
                />
              </pattern>
            </defs>

            {/* Plot background */}
            <rect
              x={MARGIN.left}
              y={MARGIN.top}
              width={innerW}
              height={innerH}
              fill="#fafafa"
              stroke="#e2e8f0"
            />

            {/* Cells */}
            <g>
              {cells.map((c) => {
                const x = xScale(c.ae) - cellW / 2
                const y = yScale(c.ap) - cellH / 2
                const ratio = normalize(c.MRR)
                const baseFill = c.hasWarning
                  ? "#fee2e2"
                  : mrrColor(ratio)
                const isSweet = sweetSpots.has(`${c.apIdx}_${c.aeIdx}`)
                return (
                  <g key={`${c.apIdx}_${c.aeIdx}`}>
                    <rect
                      x={x}
                      y={y}
                      width={cellW + 0.5}
                      height={cellH + 0.5}
                      fill={baseFill}
                      opacity={c.hasWarning ? 0.5 : 1}
                      onMouseEnter={() => setHover(c)}
                      onClick={() => handleCellClick(c)}
                      style={{
                        cursor: c.hasWarning ? "not-allowed" : "pointer",
                      }}
                    />
                    {c.hasWarning && (
                      <rect
                        x={x}
                        y={y}
                        width={cellW + 0.5}
                        height={cellH + 0.5}
                        fill="url(#heatmap-warn-pattern)"
                        pointerEvents="none"
                      />
                    )}
                    {isSweet && (
                      <rect
                        x={x + 1}
                        y={y + 1}
                        width={cellW - 1.5}
                        height={cellH - 1.5}
                        fill="rgba(16,185,129,0.22)"
                        stroke="rgba(5,150,105,0.55)"
                        strokeWidth={0.7}
                        pointerEvents="none"
                      />
                    )}
                  </g>
                )
              })}
            </g>

            {/* X axis (ae) */}
            <g>
              <line
                x1={MARGIN.left}
                y1={MARGIN.top + innerH}
                x2={MARGIN.left + innerW}
                y2={MARGIN.top + innerH}
                stroke="#94a3b8"
              />
              {xTicks.map((t, i) => (
                <g key={`xt_${i}`}>
                  <line
                    x1={xScale(t)}
                    y1={MARGIN.top + innerH}
                    x2={xScale(t)}
                    y2={MARGIN.top + innerH + 4}
                    stroke="#94a3b8"
                  />
                  <text
                    x={xScale(t)}
                    y={MARGIN.top + innerH + 16}
                    textAnchor="middle"
                    fontSize="10"
                    fill="#64748b"
                  >
                    {t.toFixed(1)}
                  </text>
                </g>
              ))}
              <text
                x={MARGIN.left + innerW / 2}
                y={SVG_H - 6}
                textAnchor="middle"
                fontSize="11"
                fill="#475569"
              >
                RDOC (ae, mm) — 0 ~ D ({D})
              </text>
            </g>

            {/* Y axis (ap) */}
            <g>
              <line
                x1={MARGIN.left}
                y1={MARGIN.top}
                x2={MARGIN.left}
                y2={MARGIN.top + innerH}
                stroke="#94a3b8"
              />
              {yTicks.map((t, i) => (
                <g key={`yt_${i}`}>
                  <line
                    x1={MARGIN.left - 4}
                    y1={yScale(t)}
                    x2={MARGIN.left}
                    y2={yScale(t)}
                    stroke="#94a3b8"
                  />
                  <text
                    x={MARGIN.left - 8}
                    y={yScale(t) + 3}
                    textAnchor="end"
                    fontSize="10"
                    fill="#64748b"
                  >
                    {t.toFixed(1)}
                  </text>
                </g>
              ))}
              <text
                x={14}
                y={MARGIN.top + innerH / 2}
                textAnchor="middle"
                fontSize="11"
                fill="#475569"
                transform={`rotate(-90 14 ${MARGIN.top + innerH / 2})`}
              >
                ADOC (ap, mm) — 0 ~ 2D ({(2 * D).toFixed(1)})
              </text>
            </g>

            {/* 현재 조건 점 */}
            {currentAp >= 0 &&
              currentAp <= apMax &&
              currentAe >= 0 &&
              currentAe <= aeMax && (
                <g pointerEvents="none">
                  <circle
                    cx={xScale(currentAe)}
                    cy={yScale(currentAp)}
                    r={9}
                    fill="rgba(5,150,105,0.25)"
                    stroke="#059669"
                    strokeWidth={2}
                  />
                  <line
                    x1={xScale(currentAe) - 6}
                    y1={yScale(currentAp)}
                    x2={xScale(currentAe) + 6}
                    y2={yScale(currentAp)}
                    stroke="#065f46"
                    strokeWidth={1.5}
                  />
                  <line
                    x1={xScale(currentAe)}
                    y1={yScale(currentAp) - 6}
                    x2={xScale(currentAe)}
                    y2={yScale(currentAp) + 6}
                    stroke="#065f46"
                    strokeWidth={1.5}
                  />
                </g>
              )}
          </svg>
        </div>

        {/* Sidebar */}
        <div className="flex w-full flex-col gap-2 text-xs md:w-60">
          {/* Hover info */}
          <div className="rounded-md border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2">
            <div className="font-semibold text-slate-700 dark:text-slate-200">
              {hover ? "호버된 조건" : "커서를 셀 위로 올리세요"}
            </div>
            {hover && (
              <dl className="mt-1 space-y-0.5 text-[11px] text-slate-700 dark:text-slate-200">
                <div className="flex justify-between">
                  <dt>ap</dt>
                  <dd className="font-mono">{hover.ap.toFixed(2)}mm</dd>
                </div>
                <div className="flex justify-between">
                  <dt>ae</dt>
                  <dd className="font-mono">{hover.ae.toFixed(2)}mm</dd>
                </div>
                <div className="flex justify-between">
                  <dt>MRR</dt>
                  <dd className="font-mono">
                    {hover.MRR.toFixed(2)} cm³/min
                  </dd>
                </div>
                <div className="flex justify-between">
                  <dt>Pc</dt>
                  <dd
                    className={`font-mono ${
                      hover.warnPower ? "text-rose-600" : ""
                    }`}
                  >
                    {hover.Pc.toFixed(2)} kW
                  </dd>
                </div>
                <div className="flex justify-between">
                  <dt>n</dt>
                  <dd className="font-mono">
                    {hover.n.toLocaleString()} rpm
                  </dd>
                </div>
                {hover.hasWarning && (
                  <div className="mt-1 rounded bg-rose-50 px-1.5 py-1 text-[10px] text-rose-700">
                    {hover.warnApOverLimit && <div>• ap &gt; 2D</div>}
                    {hover.warnAeOverD && <div>• ae &gt; D (슬로팅)</div>}
                    {hover.warnPower && (
                      <div>• Pc &gt; {maxKw}kW (파워 초과)</div>
                    )}
                  </div>
                )}
              </dl>
            )}
            {eduRegionHint && (
              <div className="mt-2 rounded bg-emerald-50 px-2 py-1 text-[10.5px] leading-snug text-emerald-900 ring-1 ring-emerald-200">
                💡 {eduRegionHint}
              </div>
            )}
          </div>

          {/* 범례 */}
          <div className="rounded-md border border-slate-200 dark:border-slate-700 px-3 py-2">
            <div className="mb-1 text-[11px] font-semibold text-slate-700 dark:text-slate-200">
              범례
            </div>
            <div className="space-y-1 text-[10.5px] text-slate-600 dark:text-slate-300">
              <LegendRow
                swatch={
                  <div
                    className="h-3 w-6 rounded"
                    style={{
                      background: `linear-gradient(to right, ${mrrColor(0)}, ${mrrColor(0.5)}, ${mrrColor(1)})`,
                    }}
                  />
                }
                label={`MRR ${mrrMin.toFixed(1)} → ${mrrMax.toFixed(1)} cm³/min`}
              />
              <LegendRow
                swatch={
                  <svg width="24" height="12" aria-hidden>
                    <rect
                      width="24"
                      height="12"
                      fill="url(#heatmap-warn-pattern)"
                    />
                  </svg>
                }
                label="경고 (ap&gt;2D · ae&gt;D · Pc 초과)"
              />
              {showSweetSpots && (
                <LegendRow
                  swatch={
                    <div className="h-3 w-6 rounded bg-emerald-400/40 ring-1 ring-emerald-600/50" />
                  }
                  label="Sweet spot (MRR 상위 20% · 현재점 인접)"
                />
              )}
              <LegendRow
                swatch={
                  <svg width="18" height="14" aria-hidden>
                    <circle
                      cx="9"
                      cy="7"
                      r="6"
                      fill="rgba(5,150,105,0.25)"
                      stroke="#059669"
                      strokeWidth="1.5"
                    />
                    <line
                      x1="5"
                      y1="7"
                      x2="13"
                      y2="7"
                      stroke="#065f46"
                    />
                    <line
                      x1="9"
                      y1="3"
                      x2="9"
                      y2="11"
                      stroke="#065f46"
                    />
                  </svg>
                }
                label="현재 조건"
              />
            </div>
          </div>

          {/* Chatter 상태 */}
          <div className="rounded-md border border-slate-200 dark:border-slate-700 px-3 py-2 text-[11px]">
            <div className="mb-1 font-semibold text-slate-700 dark:text-slate-200">
              Chatter 추정
            </div>
            <div
              className={
                chatterInfo.level === "high"
                  ? "text-rose-600"
                  : chatterInfo.level === "med"
                    ? "text-amber-600"
                    : "text-emerald-600"
              }
            >
              {chatterInfo.level.toUpperCase()} · risk {chatterInfo.risk}
            </div>
            {chatterInfo.reasons.length > 0 && (
              <ul className="mt-0.5 list-disc pl-4 text-[10.5px] text-slate-500 dark:text-slate-400">
                {chatterInfo.reasons.map((r, i) => (
                  <li key={i}>{r}</li>
                ))}
              </ul>
            )}
          </div>

          {onSpotClick && (
            <div className="rounded-md border border-slate-200 dark:border-slate-700 bg-sky-50 px-3 py-2 text-[10.5px] leading-snug text-sky-800">
              💡 안전한 셀을 클릭하면 ap·ae 값이 시뮬레이터에 반영됩니다.
            </div>
          )}
        </div>
      </div>

      <footer className="border-t border-slate-100 dark:border-slate-800 px-4 py-2 text-[10px] text-slate-400 dark:text-slate-500">
        20×20 grid sampling · 계산식: <code>calculateCutting</code>{" "}
        (Sandvik Pc 공식) + <code>estimateChatterRisk</code>
      </footer>
    </section>
  )
}

function LegendRow({
  swatch,
  label,
}: {
  swatch: React.ReactNode
  label: string
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="flex-shrink-0">{swatch}</span>
      <span>{label}</span>
    </div>
  )
}

export default HeatmapPanel
