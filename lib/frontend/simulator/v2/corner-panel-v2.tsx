// SPDX-License-Identifier: MIT
// YG-1 ARIA Simulator v3 — STEP 5-2 Corner Adjustment V2
// 기존 corner-panel.tsx의 MAP-grade 강화 버전. "Reference Only" 명시.
// HEM/Finishing 전용 활성화. Internal/External 코너 IPM 공식 시각화.
"use client"

import { useMemo, useState } from "react"
import { Info, Sparkles } from "lucide-react"
import { internalCornerFeed, externalCornerFeed } from "../cutting-calculator"
import { EduCallout } from "./education-widgets"
import { useEducation } from "./education-context"

interface Props {
  toolPath: string
  baseFeed: number
  toolDiameter: number
  cornerReductionPct: number
  onReductionChange: (pct: number) => void
}

// HEM 또는 Finishing 계열 tool path만 활성
const ACTIVE_PATHS = new Set([
  "hem",
  "conventional", // Finishing은 대체로 conventional 계열로 처리
  "adaptive",
  "dynamic",
  "trochoidal",
])

// Finishing-style operations (이 모드에서만 active로 간주하는 추가 로직)
// — 단, Props에서는 operation 정보를 받지 않으므로 toolPath만으로 판정
function isActiveForPath(path: string): boolean {
  return ACTIVE_PATHS.has(path)
}

export function CornerFeedPanelV2({
  toolPath,
  baseFeed,
  toolDiameter,
  cornerReductionPct,
  onReductionChange,
}: Props) {
  const edu = useEducation()
  const active = isActiveForPath(toolPath)

  const [mode, setMode] = useState<"internal" | "external">("internal")
  const [workpieceDim, setWorkpieceDim] = useState<number>(40) // OD 또는 ID (mm)

  // ── 실시간 계산 ──────────────────────────────────────────────────
  const calc = useMemo(() => {
    const D = toolDiameter
    const Fbase = baseFeed
    const Wdim = Math.max(0, workpieceDim)
    const adjFormula =
      mode === "internal"
        ? internalCornerFeed(Fbase, Wdim, D)
        : externalCornerFeed(Fbase, Wdim, D)
    const adjSlider = Fbase * (1 - cornerReductionPct / 100)
    const pctFormula = Fbase > 0 ? (adjFormula / Fbase) * 100 : 100
    const pctSlider = Fbase > 0 ? (adjSlider / Fbase) * 100 : 100
    return {
      D,
      Fbase,
      Wdim,
      adjFormula: Math.max(0, adjFormula),
      adjSlider: Math.max(0, adjSlider),
      pctFormula,
      pctSlider,
    }
  }, [mode, baseFeed, toolDiameter, workpieceDim, cornerReductionPct])

  return (
    <div
      className={`rounded-lg border p-3 space-y-2 transition-opacity ${
        active
          ? "border-amber-300 bg-amber-50/60 dark:bg-amber-900/10 dark:border-amber-700"
          : "border-gray-200 bg-gray-50/70 dark:bg-gray-800 dark:border-gray-700 opacity-70"
      }`}
    >
      {/* ── 헤더 + Reference Only 배너 ────────────────────────────── */}
      <div className="flex items-start justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-1.5">
          <Sparkles className="h-3.5 w-3.5 text-amber-600" />
          <h5 className="text-xs font-bold text-amber-900 dark:text-amber-200">
            비선형 경로 코너 보정 (Harvey MAP)
          </h5>
        </div>
        <span
          className="inline-flex items-center gap-1 rounded-full bg-amber-100 dark:bg-amber-900/40 text-amber-800 dark:text-amber-200 text-[9px] font-bold px-1.5 py-0.5 border border-amber-300 dark:border-amber-700"
          title="실제 CAM 경로가 아닌 참고용 계산"
        >
          <Info className="h-2.5 w-2.5" />
          REFERENCE ONLY
        </span>
      </div>

      {/* ── 비활성 안내 ───────────────────────────────────────── */}
      {!active && (
        <div className="rounded bg-white/80 dark:bg-gray-900/50 border border-dashed border-gray-300 dark:border-gray-600 px-2 py-1.5 text-[10px] text-gray-600 dark:text-gray-400 flex items-start gap-1.5">
          <Info className="h-3 w-3 mt-0.5 flex-shrink-0 text-gray-500" />
          <span>
            이 기능은 <b>HEM / Finishing / Conventional / Adaptive / Dynamic / Trochoidal</b> 경로에서만
            활성화됩니다. 현재 <b className="font-mono">{toolPath}</b> — 참고용으로만 표시됩니다.
          </span>
        </div>
      )}

      {/* ── 모드 선택 (Internal / External) ─────────────────────── */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="flex rounded-md overflow-hidden text-[10px] border border-amber-300 dark:border-amber-700">
          <button
            type="button"
            onClick={() => setMode("internal")}
            disabled={!active}
            className={`px-2 py-1 font-semibold transition-colors ${
              mode === "internal"
                ? "bg-amber-600 text-white"
                : "bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300"
            } ${!active ? "cursor-not-allowed" : ""}`}
          >
            Internal 코너
          </button>
          <button
            type="button"
            onClick={() => setMode("external")}
            disabled={!active}
            className={`px-2 py-1 font-semibold transition-colors ${
              mode === "external"
                ? "bg-amber-600 text-white"
                : "bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300"
            } ${!active ? "cursor-not-allowed" : ""}`}
          >
            External 코너
          </button>
        </div>
      </div>

      {/* ── 입력: OD / ID, TD (read-only) ───────────────────────── */}
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="text-[10px] text-gray-600 dark:text-gray-400">
            {mode === "internal" ? "외경 OD (mm)" : "내경 ID (mm)"}
          </label>
          <input
            type="number"
            value={workpieceDim}
            min={0}
            step={0.5}
            disabled={!active}
            onChange={(e) => setWorkpieceDim(parseFloat(e.target.value) || 0)}
            className="w-full rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-2 py-1 text-xs font-mono text-gray-900 dark:text-gray-100 disabled:bg-gray-100 disabled:dark:bg-gray-900 disabled:cursor-not-allowed"
          />
        </div>
        <div>
          <label className="text-[10px] text-gray-600 dark:text-gray-400">공구 직경 TD (mm)</label>
          <input
            type="text"
            value={toolDiameter.toFixed(2)}
            readOnly
            className="w-full rounded border border-gray-200 dark:border-gray-700 bg-gray-100 dark:bg-gray-900 px-2 py-1 text-xs font-mono text-gray-700 dark:text-gray-300"
          />
        </div>
      </div>

      {/* ── 공식 시각화 ──────────────────────────────────────── */}
      <div className="font-mono text-[11px] bg-white dark:bg-gray-900 rounded px-2 py-1.5 border border-amber-200 dark:border-amber-700">
        <div className="text-[9px] uppercase tracking-wide text-amber-600 mb-0.5">
          Harvey IPM 보정 공식
        </div>
        {mode === "internal" ? (
          <>
            F_adj = F × (OD − TD) / OD
            <br />
            <span className="text-gray-600 dark:text-gray-300">
              = {calc.Fbase.toFixed(0)} × ({calc.Wdim.toFixed(0)} − {calc.D.toFixed(0)}) /{" "}
              {calc.Wdim.toFixed(0)}
            </span>
            <br />={" "}
            <b className="text-amber-700 dark:text-amber-300">{calc.adjFormula.toFixed(0)} mm/min</b>{" "}
            <span className="text-gray-500">({calc.pctFormula.toFixed(0)}% of base)</span>
          </>
        ) : (
          <>
            F_adj = F × (ID + TD) / ID
            <br />
            <span className="text-gray-600 dark:text-gray-300">
              = {calc.Fbase.toFixed(0)} × ({calc.Wdim.toFixed(0)} + {calc.D.toFixed(0)}) /{" "}
              {calc.Wdim.toFixed(0)}
            </span>
            <br />={" "}
            <b className="text-amber-700 dark:text-amber-300">{calc.adjFormula.toFixed(0)} mm/min</b>{" "}
            <span className="text-gray-500">({calc.pctFormula.toFixed(0)}% of base)</span>
          </>
        )}
      </div>

      {/* ── 슬라이더: 수동 감속률 ──────────────────────────────── */}
      <div className="rounded bg-white/70 dark:bg-gray-900/50 px-2 py-1.5 border border-amber-200 dark:border-amber-700">
        <div className="flex items-center justify-between mb-1">
          <label className="text-[10px] text-gray-700 dark:text-gray-300">
            수동 감속률 (G-Code용, 0~70%)
          </label>
          <span className="font-mono text-[10px] font-bold text-amber-700 dark:text-amber-300">
            -{cornerReductionPct}%
          </span>
        </div>
        <input
          type="range"
          min={0}
          max={70}
          step={5}
          value={cornerReductionPct}
          disabled={!active}
          onChange={(e) => onReductionChange(parseInt(e.target.value))}
          className="w-full accent-amber-600 disabled:opacity-40"
        />
        <div className="mt-1 text-[10px] text-gray-700 dark:text-gray-300">
          Vf → <b className="font-mono">{calc.adjSlider.toFixed(0)} mm/min</b>{" "}
          <span className="text-gray-500">({calc.pctSlider.toFixed(0)}% of base)</span>
        </div>
      </div>

      {/* ── 공식 한계 경고: OD ≤ TD ────────────────────────── */}
      {active && mode === "internal" && calc.Wdim > 0 && calc.Wdim <= calc.D && (
        <EduCallout
          level="error"
          title={`OD (${calc.Wdim.toFixed(1)}mm) ≤ TD (${calc.D.toFixed(1)}mm)`}
          detail="Internal 코너에서 OD가 공구 직경보다 작거나 같으면 공식이 음수/영을 반환. 물리적으로 불가능한 조건이므로 OD를 증가시키거나 작은 공구로 변경하세요."
          relatedId="adoc-rdoc"
        />
      )}

      {/* ── 일반 설명 ─────────────────────────────────────── */}
      <div className="text-[10px] text-gray-700 dark:text-gray-300 leading-relaxed">
        {mode === "internal" ? (
          <>
            <b>내부 코너 진입</b>: 공구가 안쪽 코너에 접근할수록 칩 engagement가 커져 이송 감속 필요.
            OD가 작을수록 감속량이 커집니다.
          </>
        ) : (
          <>
            <b>외부 코너 이탈</b>: 공구가 바깥 코너에서 빠져나올 때 engagement가 감소 → 이송 증가 가능.
            ID가 작을수록 증가량이 커집니다.
          </>
        )}
      </div>

      {/* ── 교육 모드: 공식 유도 해설 ──────────────────────── */}
      {edu.enabled && (
        <div className="rounded bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 px-2 py-1.5 text-[10px] text-blue-900 dark:text-blue-200">
          <div className="font-bold text-[10px] flex items-center gap-1">
            <Info className="h-2.5 w-2.5" />
            공식 유도 (Harvey 비선형 경로 보정)
          </div>
          <p className="mt-1 leading-relaxed">
            코너 반경을 통과할 때 공구 중심 경로와 칩 제거 경로의 곡률차에 의해 실효 fz가 변합니다.
            Internal: 공구 중심이 OD 내부로 접근 → 실효 fz ↑ → F 하향 필요 (F×(OD−TD)/OD).
            External: 공구 중심이 ID 외부로 이탈 → 실효 fz ↓ → F 상향 가능 (F×(ID+TD)/ID).
            <br />이 보정은 fz 상수·공구 수명·표면 품질을 유지하는 핵심 방법입니다.
          </p>
        </div>
      )}
    </div>
  )
}

export default CornerFeedPanelV2
