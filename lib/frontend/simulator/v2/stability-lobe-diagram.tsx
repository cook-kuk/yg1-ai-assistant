// SPDX-License-Identifier: MIT
// YG-1 ARIA Simulator v3 — Stability Lobe Diagram (채터 안정 영역)
// Altintas-Budak 단순화 모델로 (RPM × ap) 평면의 채터 안정/위험 영역을 시각화.
// sidecar only — cutting-simulator-v2.tsx 는 수정하지 않는다.
"use client"

import * as React from "react"
import {
  ScatterChart,
  Scatter,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceDot,
} from "recharts"
import { HolographicFrame, type HoloAccent, type HoloIntensity } from "./holographic-frame"
import { LiveIndicator } from "./live-indicator"

// ── Props ───────────────────────────────────────────────────────────────────

export interface StabilityLobeDiagramProps {
  spindleRpm: number           // 현재 스핀들 회전수 (rpm)
  apMm: number                 // 현재 절입 깊이 ap (mm)
  material: string             // 재료명 (AL6061, S45C, SUS304, Ti6Al4V, Inconel718 …)
  toolDiameterMm: number       // 공구 지름 (mm) — 자연진동수 추정에 사용
  teethCount?: number          // 날 수 (default 4)
  darkMode?: boolean
  accent?: HoloAccent          // Holographic Frame accent
  intensity?: HoloIntensity    // Holographic Frame intensity
}

// ── Physics / Math (단순화 Altintas-Budak) ──────────────────────────────────

/** 재료별 specific cutting force 기반 상수 (ap_lim 스케일). */
const K_MATERIAL: Record<string, number> = {
  AL6061: 2.5,
  S45C: 1.6,
  SUS304: 1.2,
  Ti6Al4V: 0.9,
  Inconel718: 0.7,
}
const K_MATERIAL_FALLBACK = 1.0

const RPM_MIN = 1000
const RPM_MAX = 20000
const SAMPLE_COUNT = 100
const LOBE_COUNT = 4
/** Y축 상한 (mm) — 현장 엔드밀 ap 최대치 가정 */
const AP_CEILING_MM = 12
/** 수치 안정을 위한 분모 floor */
const EPS = 1e-3

/** 재료명 → K 값 lookup (대소문자/하이픈/공백 무시) */
function lookupK(material: string): number {
  if (!material) return K_MATERIAL_FALLBACK
  const norm = material.replace(/[\s\-_]/g, "").toUpperCase()
  for (const key of Object.keys(K_MATERIAL)) {
    if (key.toUpperCase() === norm) return K_MATERIAL[key]!
  }
  return K_MATERIAL_FALLBACK
}

/**
 * 공구 자연진동수 f_n (Hz) — 지름 기반 경험식.
 * 얇을수록 강성이 낮아 f_n 하락. 시각화 안정성을 위해 bounded.
 */
function naturalFreqHz(toolDiameterMm: number): number {
  const d = Math.max(toolDiameterMm, 1)
  // 6 mm → ~450 Hz, 12 mm → ~900 Hz, 20 mm → ~1500 Hz 근방에 떨어지도록 튜닝
  const f = 75 * d
  return Math.min(Math.max(f, 200), 2500)
}

/** 하나의 RPM 에서 LOBE_COUNT 개 lobe 의 최소 ap_lim (채터 한계) 반환.
 *  denom ∈ [0, 4]. 0 근방이면 ap_lim 폭발 → AP_CEILING_MM 로 clamp. */
function apLimitAt(rpm: number, kMaterial: number, teethCount: number, fnHz: number): number {
  const toothFreqHz = (rpm * teethCount) / 60 // 치아 통과 주파수 (Hz)
  let apMin = Number.POSITIVE_INFINITY
  for (let j = 1; j <= LOBE_COUNT; j++) {
    const denom = 2 * (1 + Math.cos((2 * Math.PI * toothFreqHz) / Math.max(fnHz * j, EPS)))
    const ap = kMaterial / Math.max(denom, EPS)
    if (ap < apMin) apMin = ap
  }
  if (!Number.isFinite(apMin)) apMin = AP_CEILING_MM
  return Math.min(apMin, AP_CEILING_MM)
}

interface LobeSample {
  rpm: number
  apLim: number
}

function buildLobeCurve(material: string, toolDiameterMm: number, teethCount: number): LobeSample[] {
  const kMaterial = lookupK(material)
  const fnHz = naturalFreqHz(toolDiameterMm)
  const step = (RPM_MAX - RPM_MIN) / (SAMPLE_COUNT - 1)
  const out: LobeSample[] = []
  for (let i = 0; i < SAMPLE_COUNT; i++) {
    const rpm = RPM_MIN + step * i
    const apLim = apLimitAt(rpm, kMaterial, teethCount, fnHz)
    out.push({ rpm: Math.round(rpm), apLim: Math.round(apLim * 1000) / 1000 })
  }
  return out
}

/** 선형 보간으로 rpm 에서의 ap_lim 추정 */
function interpolateApLimit(curve: LobeSample[], rpm: number): number {
  if (curve.length === 0) return AP_CEILING_MM
  if (rpm <= curve[0]!.rpm) return curve[0]!.apLim
  const last = curve[curve.length - 1]!
  if (rpm >= last.rpm) return last.apLim
  for (let i = 1; i < curve.length; i++) {
    const a = curve[i - 1]!
    const b = curve[i]!
    if (rpm >= a.rpm && rpm <= b.rpm) {
      const t = (rpm - a.rpm) / Math.max(b.rpm - a.rpm, EPS)
      return a.apLim + t * (b.apLim - a.apLim)
    }
  }
  return last.apLim
}

// ── Tooltip ─────────────────────────────────────────────────────────────────

interface TooltipPayloadItem {
  name?: string
  value?: number
  dataKey?: string
  payload?: LobeSample
}

function LobeTooltip({ active, payload, darkMode }: { active?: boolean; payload?: TooltipPayloadItem[]; darkMode?: boolean }) {
  if (!active || !payload || payload.length === 0) return null
  const sample = payload[0]?.payload
  if (!sample) return null
  const bg = darkMode ? "#0f172a" : "#ffffff"
  const fg = darkMode ? "#f1f5f9" : "#0f172a"
  const border = darkMode ? "#334155" : "#e2e8f0"
  return (
    <div style={{ background: bg, color: fg, border: `1px solid ${border}`, borderRadius: 6, padding: "6px 10px", fontSize: 12, boxShadow: "0 2px 6px rgba(0,0,0,0.18)" }}>
      <div style={{ fontWeight: 600, marginBottom: 2 }}>RPM = {sample.rpm.toLocaleString("ko-KR")}</div>
      <div style={{ color: "#10b981" }}>안정 한계 ap_lim ≈ {sample.apLim.toFixed(2)} mm</div>
    </div>
  )
}

// ── Main Component ──────────────────────────────────────────────────────────

export function StabilityLobeDiagram({
  spindleRpm,
  apMm,
  material,
  toolDiameterMm,
  teethCount = 4,
  darkMode = false,
  accent = "emerald",
  intensity = "medium",
}: StabilityLobeDiagramProps): React.ReactElement {
  const curve = React.useMemo(
    () => buildLobeCurve(material, toolDiameterMm, teethCount),
    [material, toolDiameterMm, teethCount],
  )

  const apLimitHere = React.useMemo(
    () => interpolateApLimit(curve, spindleRpm),
    [curve, spindleRpm],
  )
  const isStable = apMm <= apLimitHere
  const dotColor = isStable ? "#10b981" : "#ef4444"
  const verdictLabel = isStable ? "안정 영역" : "채터 위험"

  // Theme tokens
  const fg = darkMode ? "#f1f5f9" : "#0f172a"
  const subFg = darkMode ? "#94a3b8" : "#475569"
  const gridStroke = darkMode ? "#334155" : "#e2e8f0"
  const axisStroke = darkMode ? "#94a3b8" : "#64748b"
  const kMaterial = lookupK(material)
  const fnHz = Math.round(naturalFreqHz(toolDiameterMm))

  return (
    <HolographicFrame accent={accent} intensity={intensity} darkMode={darkMode}>
      <div className={`p-4 ${darkMode ? "text-slate-100" : "text-slate-900"}`}>
        {/* Header */}
        <div className="flex items-center justify-between mb-3">
          <h3 className="flex items-center gap-2 text-sm font-bold tracking-tight">
            <span aria-hidden>🌀</span>
            <span>Stability Lobe · 채터 안정 영역</span>
            <LiveIndicator
              watch={[spindleRpm, apMm, toolDiameterMm, teethCount]}
              color={isStable ? "emerald" : "rose"}
              darkMode={darkMode}
            />
          </h3>
          <div className="text-[11px]" style={{ color: subFg }}>
            {material || "—"} · D={toolDiameterMm}mm · z={teethCount} · f<sub>n</sub>≈{fnHz}Hz · K={kMaterial}
          </div>
        </div>

        {/* Verdict pill */}
        <div className="mb-3 flex items-center gap-2">
          <span
            className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold"
            style={{
              background: isStable ? "rgba(16,185,129,0.14)" : "rgba(239,68,68,0.14)",
              color: dotColor,
              border: `1px solid ${dotColor}`,
            }}
          >
            <span className="h-1.5 w-1.5 rounded-full" style={{ background: dotColor }} aria-hidden />
            {verdictLabel}
          </span>
          <span className="text-[11px]" style={{ color: subFg }}>
            현재 ap = <strong style={{ color: fg }}>{apMm.toFixed(2)} mm</strong>
            {" "}· 한계 ap<sub>lim</sub> ≈{" "}
            <strong style={{ color: "#10b981" }}>{apLimitHere.toFixed(2)} mm</strong>
          </span>
        </div>

        {/* Chart */}
        <ResponsiveContainer width="100%" height={300}>
          <ScatterChart data={curve} margin={{ top: 10, right: 24, left: 8, bottom: 20 }}>
            <defs>
              <linearGradient id="stableGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#10b981" stopOpacity={0.45} />
                <stop offset="100%" stopColor="#10b981" stopOpacity={0.05} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} />
            <XAxis
              type="number"
              dataKey="rpm"
              domain={[RPM_MIN, RPM_MAX]}
              stroke={axisStroke}
              tick={{ fill: axisStroke, fontSize: 11 }}
              tickFormatter={(v: number) => `${Math.round(v / 1000)}k`}
              label={{ value: "스핀들 RPM", position: "insideBottom", offset: -8, fill: subFg, fontSize: 11 }}
            />
            <YAxis
              type="number"
              dataKey="apLim"
              domain={[0, AP_CEILING_MM]}
              stroke={axisStroke}
              tick={{ fill: axisStroke, fontSize: 11 }}
              label={{ value: "절입 깊이 ap (mm)", angle: -90, position: "insideLeft", fill: subFg, fontSize: 11 }}
            />
            <Tooltip content={<LobeTooltip darkMode={darkMode} />} cursor={{ stroke: axisStroke, strokeDasharray: "2 2" }} />

            {/* 안정 영역 envelope (아래=안정, 위=채터 위험) */}
            <Area
              type="monotone"
              dataKey="apLim"
              stroke="#10b981"
              strokeWidth={2}
              fill="url(#stableGradient)"
              isAnimationActive={false}
              name="안정 한계 ap_lim"
            />

            {/* 보이지 않는 scatter — Tooltip 활성화를 위한 데이터 앵커 */}
            <Scatter data={curve} fill="transparent" isAnimationActive={false} />

            {/* 현재 조건 — 안정이면 초록, 위험이면 빨강 */}
            <ReferenceDot
              x={Math.min(Math.max(spindleRpm, RPM_MIN), RPM_MAX)}
              y={Math.min(Math.max(apMm, 0), AP_CEILING_MM)}
              r={7}
              fill={dotColor}
              stroke={darkMode ? "#0f172a" : "#ffffff"}
              strokeWidth={2}
              isFront
              label={{ value: "현재", position: "top", fill: dotColor, fontSize: 11, fontWeight: 700 }}
            />
          </ScatterChart>
        </ResponsiveContainer>

        {/* Legend */}
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px]" style={{ color: subFg }}>
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block h-2 w-3 rounded-sm" style={{ background: "rgba(16,185,129,0.4)", border: "1px solid #10b981" }} aria-hidden />
            안정 영역 (초록) — ap ≤ ap<sub>lim</sub>
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block h-2 w-3 rounded-sm" style={{ background: "transparent", border: "1px dashed #ef4444" }} aria-hidden />
            채터 위험 (빨강) — ap &gt; ap<sub>lim</sub>
          </span>
          <span className="opacity-70">
            모델: Altintas-Budak 단순화 · RPM {RPM_MIN.toLocaleString("ko-KR")}–{RPM_MAX.toLocaleString("ko-KR")} · lobes={LOBE_COUNT}
          </span>
        </div>
      </div>
    </HolographicFrame>
  )
}

export default StabilityLobeDiagram
