// SPDX-License-Identifier: MIT
/**
 * YG-1 ARIA Simulator v3 — STEP 6-7
 * MAP / SpeedLab 병렬 비교 위젯
 *
 * 3열 비교:
 *  - ARIA (우리 추천값)      — 현재 시뮬 결과에서 자동 주입
 *  - MAP  (Harvey MAP)       — 사용자가 붙여넣기
 *  - SpeedLab (YG-1 SpeedLab)— 사용자가 붙여넣기
 *
 * 각 지표에 대해 ARIA 대비 차이 %를 색상으로 표시.
 *  - |Δ| ≤ 10%    → 녹색 "일치"
 *  - |Δ| ≤ 20%    → 노랑 "보통 차이"
 *  - |Δ| > 20%    → 빨강 "큰 차이"
 *
 * 교육 모드 on일 때 큰 차이 원인 설명:
 *   - "ARIA가 낮은 이유: Workholding 55%로 보수적 조건"
 *   - "MAP이 높은 이유: 카탈로그 값이 이상적 조건(새공구·강건지그) 기준"
 *
 * B2B 영업 신뢰 확보 도구.
 */

"use client"

import { useMemo, useState } from "react"
import {
  Target, Copy, RotateCcw, TrendingUp, TrendingDown, Minus, Info, GraduationCap,
  CheckCircle2, AlertTriangle, AlertCircle,
} from "lucide-react"
import { useEducation } from "./education-context"

// ── Props ────────────────────────────────────────────
export interface CompetitorLiveCompareProps {
  ariaResults: {
    Vc: number     // m/min
    fz: number     // mm/tooth
    n: number      // rpm
    Vf: number     // mm/min
    MRR: number    // cm³/min
    SFM: number    // ft/min
    IPM: number    // in/min
  }
  educationMode?: boolean
}

// ── 지표 정의 ─────────────────────────────────────────
type MetricKey = "Vc" | "fz" | "n" | "Vf" | "MRR" | "SFM" | "IPM"
interface MetricMeta {
  key: MetricKey
  label: string
  unit: string
  digits: number
  tolerance?: number // 값이 너무 작으면 퍼센트 비교 skip
}
const METRICS: MetricMeta[] = [
  { key: "Vc", label: "Vc (절삭속도)", unit: "m/min", digits: 1, tolerance: 1 },
  { key: "fz", label: "fz (1날 이송)", unit: "mm/t", digits: 4, tolerance: 0.001 },
  { key: "n", label: "n (RPM)", unit: "rpm", digits: 0, tolerance: 100 },
  { key: "Vf", label: "Vf (테이블 이송)", unit: "mm/min", digits: 0, tolerance: 50 },
  { key: "SFM", label: "SFM", unit: "ft/min", digits: 0, tolerance: 5 },
  { key: "IPM", label: "IPM", unit: "in/min", digits: 2, tolerance: 0.5 },
  { key: "MRR", label: "MRR (금속제거율)", unit: "cm³/min", digits: 2, tolerance: 0.1 },
]

// ── 컬럼 타입 ─────────────────────────────────────────
type ColumnKey = "aria" | "map" | "speedlab"
interface ColumnSpec {
  key: ColumnKey
  title: string
  subtitle: string
  badgeColor: string
}

const COLUMNS: ColumnSpec[] = [
  { key: "aria", title: "ARIA", subtitle: "우리 추천값 (자동)", badgeColor: "bg-amber-500 text-white" },
  { key: "map", title: "Harvey MAP", subtitle: "사용자 입력 (수동)", badgeColor: "bg-sky-500 text-white" },
  { key: "speedlab", title: "YG-1 SpeedLab", subtitle: "사용자 입력 (수동)", badgeColor: "bg-violet-500 text-white" },
]

// 빈 값 상태 표현
type InputVals = Partial<Record<MetricKey, string>>

// ── 유틸 ───────────────────────────────────────────
function parseNum(v: string | undefined): number | null {
  if (v == null || v.trim() === "") return null
  const n = parseFloat(v)
  return Number.isFinite(n) ? n : null
}

function pctDiff(ref: number, actual: number): number | null {
  if (!Number.isFinite(ref) || Math.abs(ref) < 1e-9) return null
  return ((actual - ref) / ref) * 100
}

function severityColor(absPct: number): { level: "good" | "med" | "bad"; cls: string; label: string } {
  if (absPct <= 10) return { level: "good", cls: "text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-800", label: "일치" }
  if (absPct <= 20) return { level: "med", cls: "text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-800", label: "보통" }
  return { level: "bad", cls: "text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-950/30 border-rose-200 dark:border-rose-800", label: "큰 차이" }
}

function fmt(v: number | null, digits: number): string {
  if (v == null || !Number.isFinite(v)) return "—"
  if (digits === 0) return Math.round(v).toLocaleString()
  return v.toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits })
}

// ── 메인 컴포넌트 ─────────────────────────────────────
export function CompetitorLiveCompare({ ariaResults, educationMode }: CompetitorLiveCompareProps) {
  const edu = useEducation()
  const eduOn = educationMode ?? edu.enabled

  const [mapVals, setMapVals] = useState<InputVals>({})
  const [speedlabVals, setSpeedlabVals] = useState<InputVals>({})

  const ariaRec: Record<MetricKey, number> = {
    Vc: ariaResults.Vc,
    fz: ariaResults.fz,
    n: ariaResults.n,
    Vf: ariaResults.Vf,
    MRR: ariaResults.MRR,
    SFM: ariaResults.SFM,
    IPM: ariaResults.IPM,
  }

  const mapRec = useMemo<Record<MetricKey, number | null>>(() => ({
    Vc: parseNum(mapVals.Vc),
    fz: parseNum(mapVals.fz),
    n: parseNum(mapVals.n),
    Vf: parseNum(mapVals.Vf),
    MRR: parseNum(mapVals.MRR),
    SFM: parseNum(mapVals.SFM),
    IPM: parseNum(mapVals.IPM),
  }), [mapVals])

  const speedRec = useMemo<Record<MetricKey, number | null>>(() => ({
    Vc: parseNum(speedlabVals.Vc),
    fz: parseNum(speedlabVals.fz),
    n: parseNum(speedlabVals.n),
    Vf: parseNum(speedlabVals.Vf),
    MRR: parseNum(speedlabVals.MRR),
    SFM: parseNum(speedlabVals.SFM),
    IPM: parseNum(speedlabVals.IPM),
  }), [speedlabVals])

  // 차이 매트릭스 (ARIA 대비)
  const diffs = useMemo(() => {
    return METRICS.map(m => {
      const ariaV = ariaRec[m.key]
      const mapV = mapRec[m.key]
      const speedV = speedRec[m.key]
      const mapPct = mapV != null && (m.tolerance == null || Math.abs(ariaV) >= m.tolerance) ? pctDiff(ariaV, mapV) : null
      const speedPct = speedV != null && (m.tolerance == null || Math.abs(ariaV) >= m.tolerance) ? pctDiff(ariaV, speedV) : null
      return { meta: m, ariaV, mapV, speedV, mapPct, speedPct }
    })
  }, [ariaRec, mapRec, speedRec])

  // 일치도 배지 계산 (MAP, SpeedLab 각각, 평균 |Δ| → 100 - avg% 로 매치율)
  const matchScores = useMemo(() => {
    const calc = (col: "map" | "speedlab") => {
      const pcts = diffs
        .map(d => (col === "map" ? d.mapPct : d.speedPct))
        .filter((x): x is number => x != null)
      if (pcts.length === 0) return null
      const avgAbs = pcts.reduce((s, x) => s + Math.abs(x), 0) / pcts.length
      const match = Math.max(0, Math.min(100, 100 - avgAbs))
      return { avgAbs: parseFloat(avgAbs.toFixed(1)), match: Math.round(match), count: pcts.length }
    }
    return { map: calc("map"), speedlab: calc("speedlab") }
  }, [diffs])

  const setMapVal = (k: MetricKey, v: string) => setMapVals(s => ({ ...s, [k]: v }))
  const setSpeedVal = (k: MetricKey, v: string) => setSpeedlabVals(s => ({ ...s, [k]: v }))

  const clearAll = () => {
    setMapVals({})
    setSpeedlabVals({})
  }

  const prefillFromAria = (col: "map" | "speedlab") => {
    const vals: InputVals = {
      Vc: ariaRec.Vc.toString(),
      fz: ariaRec.fz.toString(),
      n: ariaRec.n.toString(),
      Vf: ariaRec.Vf.toString(),
      MRR: ariaRec.MRR.toString(),
      SFM: ariaRec.SFM.toString(),
      IPM: ariaRec.IPM.toString(),
    }
    if (col === "map") setMapVals(vals)
    else setSpeedlabVals(vals)
  }

  // 차이 사유 설명 (교육 모드용)
  const rationale = useMemo(() => buildRationale(diffs), [diffs])

  return (
    <div className="space-y-4">
      {/* 헤더 */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <Target className="h-5 w-5 text-indigo-600 dark:text-indigo-400" />
            ARIA · Harvey MAP · YG-1 SpeedLab 실시간 비교
          </h2>
          <p className="text-xs text-muted-foreground mt-1">
            각 툴에서 받은 값을 붙여넣으면 ARIA 대비 % 차이를 자동 계산합니다.
            10% 이내=일치, 10~20%=보통, 20% 초과=큰 차이.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={clearAll}
            className="inline-flex items-center gap-1 text-xs rounded-md border border-zinc-300 dark:border-zinc-700 px-2 py-1 hover:bg-zinc-100 dark:hover:bg-zinc-800"
          >
            <RotateCcw className="h-3.5 w-3.5" /> 초기화
          </button>
        </div>
      </div>

      {/* 일치도 배지 */}
      <div className="flex items-center gap-2 flex-wrap">
        {matchScores.map != null && (
          <MatchBadge
            label="ARIA ↔ MAP"
            score={matchScores.map.match}
            count={matchScores.map.count}
            avgAbs={matchScores.map.avgAbs}
            color="sky"
          />
        )}
        {matchScores.speedlab != null && (
          <MatchBadge
            label="ARIA ↔ SpeedLab"
            score={matchScores.speedlab.match}
            count={matchScores.speedlab.count}
            avgAbs={matchScores.speedlab.avgAbs}
            color="violet"
          />
        )}
        {matchScores.map == null && matchScores.speedlab == null && (
          <div className="text-xs text-muted-foreground">
            값을 하나라도 입력하면 실시간 일치도가 표시됩니다.
          </div>
        )}
      </div>

      {/* 3열 카드 */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {COLUMNS.map(col => (
          <div key={col.key} className="rounded-lg border border-zinc-200 dark:border-zinc-800 p-3 flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <div>
                <span className={`inline-block text-[10px] px-1.5 py-0.5 rounded ${col.badgeColor} font-semibold`}>
                  {col.title}
                </span>
                <div className="text-[11px] text-muted-foreground mt-1">{col.subtitle}</div>
              </div>
              {col.key !== "aria" && (
                <button
                  type="button"
                  onClick={() => prefillFromAria(col.key as "map" | "speedlab")}
                  className="text-[10px] inline-flex items-center gap-1 text-muted-foreground hover:text-foreground"
                  title="ARIA 값을 이 열에 복사"
                >
                  <Copy className="h-3 w-3" /> ARIA 복사
                </button>
              )}
            </div>

            <div className="border-t border-dashed border-zinc-200 dark:border-zinc-800 pt-2 space-y-1.5">
              {METRICS.map(m => {
                if (col.key === "aria") {
                  return (
                    <div key={m.key} className="flex items-center justify-between text-xs">
                      <span className="text-muted-foreground">{m.label}</span>
                      <span className="font-mono tabular-nums font-medium">
                        {fmt(ariaRec[m.key], m.digits)} <span className="text-muted-foreground font-normal">{m.unit}</span>
                      </span>
                    </div>
                  )
                }
                // MAP · SpeedLab — 입력 필드 + 차이 퍼센트
                const vals = col.key === "map" ? mapVals : speedlabVals
                const diff = diffs.find(d => d.meta.key === m.key)
                const pct = col.key === "map" ? diff?.mapPct : diff?.speedPct
                return (
                  <div key={m.key} className="space-y-0.5">
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="text-muted-foreground">{m.label} <span className="text-[10px]">({m.unit})</span></span>
                      {pct != null && (
                        <DiffBadge pct={pct} />
                      )}
                    </div>
                    <input
                      type="text"
                      inputMode="decimal"
                      value={vals[m.key] ?? ""}
                      onChange={(e) => {
                        if (col.key === "map") setMapVal(m.key, e.target.value)
                        else setSpeedVal(m.key, e.target.value)
                      }}
                      placeholder={fmt(ariaRec[m.key], m.digits)}
                      className="w-full text-xs font-mono tabular-nums rounded border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-2 py-1"
                    />
                  </div>
                )
              })}
            </div>
          </div>
        ))}
      </div>

      {/* 교육 모드 — 차이 원인 설명 */}
      {eduOn && rationale.length > 0 && (
        <div className="rounded-lg border border-indigo-200 dark:border-indigo-800 bg-indigo-50/60 dark:bg-indigo-950/20 p-4 space-y-2">
          <div className="flex items-center gap-2 font-semibold text-sm text-indigo-800 dark:text-indigo-300">
            <GraduationCap className="h-4 w-4" />
            왜 값이 다를까? (교육 모드)
          </div>
          <ul className="text-xs space-y-1.5">
            {rationale.map((r, i) => (
              <li key={i} className="flex gap-2">
                <Info className="h-3.5 w-3.5 text-indigo-600 dark:text-indigo-400 flex-shrink-0 mt-0.5" />
                <span>{r}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {!eduOn && (matchScores.map != null || matchScores.speedlab != null) && (
        <p className="text-[11px] text-muted-foreground flex items-center gap-1">
          <Info className="h-3 w-3" /> 교육 모드를 켜면 차이 원인 분석을 볼 수 있습니다.
        </p>
      )}
    </div>
  )
}

// ── 하위 컴포넌트 ─────────────────────────────────
function DiffBadge({ pct }: { pct: number }) {
  const abs = Math.abs(pct)
  const sev = severityColor(abs)
  const Icon = pct > 0.5 ? TrendingUp : pct < -0.5 ? TrendingDown : Minus
  return (
    <span className={`inline-flex items-center gap-0.5 text-[10px] px-1 py-0.5 rounded border font-mono ${sev.cls}`}>
      <Icon className="h-2.5 w-2.5" />
      {pct > 0 ? "+" : ""}{pct.toFixed(1)}%
    </span>
  )
}

function MatchBadge({ label, score, count, avgAbs, color }: {
  label: string
  score: number
  count: number
  avgAbs: number
  color: "sky" | "violet"
}) {
  const Icon = score >= 85 ? CheckCircle2 : score >= 70 ? AlertTriangle : AlertCircle
  const ringColor = score >= 85
    ? "border-emerald-300 dark:border-emerald-800 bg-emerald-50/60 dark:bg-emerald-950/20"
    : score >= 70
      ? "border-amber-300 dark:border-amber-800 bg-amber-50/60 dark:bg-amber-950/20"
      : "border-rose-300 dark:border-rose-800 bg-rose-50/60 dark:bg-rose-950/20"
  const textColor = score >= 85
    ? "text-emerald-700 dark:text-emerald-300"
    : score >= 70
      ? "text-amber-700 dark:text-amber-300"
      : "text-rose-700 dark:text-rose-300"
  const colorDot = color === "sky" ? "bg-sky-500" : "bg-violet-500"
  return (
    <div className={`inline-flex items-center gap-2 text-xs rounded-md border px-2.5 py-1.5 ${ringColor}`}>
      <span className={`inline-block w-2 h-2 rounded-full ${colorDot}`} />
      <span className="text-muted-foreground">{label}</span>
      <Icon className={`h-3.5 w-3.5 ${textColor}`} />
      <span className={`font-semibold ${textColor}`}>{score}% 일치</span>
      <span className="text-[10px] text-muted-foreground">
        (평균 Δ {avgAbs}% · 지표 {count}개)
      </span>
    </div>
  )
}

// ── 차이 원인 서술 ─────────────────────────────────
interface DiffRow {
  meta: MetricMeta
  ariaV: number
  mapV: number | null
  speedV: number | null
  mapPct: number | null
  speedPct: number | null
}

function buildRationale(diffs: DiffRow[]): string[] {
  const out: string[] = []
  const bigMap = diffs.filter(d => d.mapPct != null && Math.abs(d.mapPct) > 20)
  const bigSpeed = diffs.filter(d => d.speedPct != null && Math.abs(d.speedPct) > 20)

  if (bigMap.length === 0 && bigSpeed.length === 0) {
    if (diffs.some(d => d.mapPct != null || d.speedPct != null)) {
      out.push("큰 차이(|Δ|>20%)가 없습니다 — ARIA 모델이 외부 툴과 일관됩니다.")
    }
    return out
  }

  // Vc/fz 동시 과다 → 카탈로그 이상조건
  const mapVcBig = bigMap.find(d => d.meta.key === "Vc")
  const mapFzBig = bigMap.find(d => d.meta.key === "fz")
  if (mapVcBig && mapVcBig.mapPct! > 20) {
    out.push(
      `MAP의 Vc가 ARIA보다 +${mapVcBig.mapPct!.toFixed(0)}% 높음. ` +
      `MAP은 카탈로그 이상 조건(새 공구, 신품 스핀들, 강건 지그) 기반이라 값이 높게 나오는 경향이 있습니다. ` +
      `ARIA는 Workholding · 스틱아웃 · 편향까지 반영해 하향 보정합니다.`,
    )
  } else if (mapVcBig && mapVcBig.mapPct! < -20) {
    out.push(
      `MAP의 Vc가 ARIA보다 ${mapVcBig.mapPct!.toFixed(0)}% 낮음. ` +
      `MAP 공구가 더 난삭재 등급이거나 피니싱 기준일 수 있습니다. 공구 시리즈/코팅 매칭을 재확인하세요.`,
    )
  }
  if (mapFzBig && mapFzBig.mapPct! > 20) {
    out.push(
      `MAP의 fz가 ARIA보다 +${mapFzBig.mapPct!.toFixed(0)}% 높음. ` +
      `MAP은 chip thinning(RCTF) 자동 보정이 없는 경우가 있어 얕은 ae에서 fz를 과다하게 추천하기도 합니다.`,
    )
  }

  // SpeedLab 차이
  const spVcBig = bigSpeed.find(d => d.meta.key === "Vc")
  if (spVcBig && spVcBig.speedPct! > 20) {
    out.push(
      `SpeedLab의 Vc가 ARIA보다 +${spVcBig.speedPct!.toFixed(0)}% 높음. ` +
      `SpeedLab은 YG-1 카탈로그 기준(특정 시험조건)이라 실공정 조건과 차이가 날 수 있습니다.`,
    )
  } else if (spVcBig && spVcBig.speedPct! < -20) {
    out.push(
      `SpeedLab의 Vc가 ARIA보다 ${spVcBig.speedPct!.toFixed(0)}% 낮음. ` +
      `ARIA가 더 공격적인 조건을 제안한 것 — 이 경우 공구 수명 감소 리스크 재확인.`,
    )
  }

  // MRR 큰 차이
  const mrrMap = bigMap.find(d => d.meta.key === "MRR")
  const mrrSpeed = bigSpeed.find(d => d.meta.key === "MRR")
  if (mrrMap) {
    out.push(
      `MRR 차이(${mrrMap.mapPct!.toFixed(0)}%)는 ap·ae 가정이 서로 다르기 때문입니다. ` +
      `MAP은 슬롯/풀슬롯 디폴트일 가능성, ARIA는 현재 선택한 operation의 apRatio·aeRatio 기반.`,
    )
  }
  if (mrrSpeed && !mrrMap) {
    out.push(
      `SpeedLab의 MRR이 ${mrrSpeed.speedPct!.toFixed(0)}% 차이 — ap·ae 가정 차이가 가장 흔한 원인입니다.`,
    )
  }

  // RPM 차이 (D 가정 불일치)
  const nMap = bigMap.find(d => d.meta.key === "n")
  if (nMap) {
    out.push(
      `RPM 차이(${nMap.mapPct!.toFixed(0)}%)는 공구 직경 또는 Deff(볼/챔퍼 유효 지름) 계산이 다를 때 발생합니다. ` +
      `ARIA는 볼/챔퍼에서 Deff를 재계산합니다.`,
    )
  }

  if (out.length === 0) {
    out.push("큰 차이가 있지만 원인 유형을 자동 판별하지 못했습니다 — 공구·op·workholding 설정 재확인을 권장합니다.")
  }

  return out
}

export default CompetitorLiveCompare
