// SPDX-License-Identifier: MIT
/**
 * YG-1 ARIA Simulator v3 — STEP 6-5
 * 다중 공구 비교 모드 (최대 4개 슬롯, YG-1 vs 경쟁사 벤치마크 병렬 비교)
 *
 * 목적:
 *  B2B 영업 미팅에서 "왜 YG-1 공구인가"를 단일 화면으로 설득.
 *  같은 재질·operation 기준으로 Harvey / Sandvik / Walter의 공개 카탈로그 값과 YG-1 공구를 나란히 두고
 *  MRR · Tool Life · Pc · Fc · 공구 단가 · Ra 을 비교한다.
 *
 * 주의:
 *  - 경쟁사 벤치마크는 하드코딩된 "공개 카탈로그 추정값" (영업 자료용, 실기계 값 아님)
 *  - cutting-simulator-v2.tsx 수정 없음. 이 파일 단독으로 쓰인다.
 *  - 교육 모드(useEducation) on 이면 "왜 YG-1" 논리 서술 확장
 */

"use client"

import { useMemo, useState } from "react"
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, Cell,
} from "recharts"
import { Plus, X, Trophy, TrendingDown, Award, Info } from "lucide-react"

import {
  calculateCutting,
  estimateToolLifeMin,
  estimateRaUm,
  computeAdvanced,
  ISO_LABELS,
} from "../cutting-calculator"
import { useEducation } from "./education-context"
import FeatureExplainer from "./feature-explainer"

// ── 공통 타입 ─────────────────────────────────────────
export interface MultiToolCompareProps {
  isoGroup: string
  ap: number
  ae: number
  operation: string
  educationMode?: boolean
  onSelectTool?: (series: string, D: number) => void
}

export interface YG1ToolOption {
  kind: "yg1"
  id: string
  brand: string
  series: string
  label: string
  iso: string
  D: number
  Z: number
  LOC: number
  shape: "square" | "ball" | "radius" | "chamfer"
  priceKrw: number
  Vc: number
  fz: number
  coatingMult: number
  cornerR?: number
}

export interface CompetitorToolOption {
  kind: "competitor"
  id: string
  brand: "Harvey" | "Sandvik" | "Walter" | "Kennametal"
  series: string
  label: string
  iso: string
  D: number
  Z: number
  LOC: number
  shape: "square" | "ball" | "radius" | "chamfer"
  priceKrw: number
  Vc: number
  fz: number
  coatingMult: number
  cornerR?: number
}

export type ToolOption = YG1ToolOption | CompetitorToolOption

export interface HarveyReplacementPreset {
  id: string
  title: string
  subtitle: string
  harveyId: string
  sandvikId: string
  yg1Id: string
}

// ── YG-1 공구 (ENDMILL_EXAMPLES 축약형, 가격 + coating multiplier 추가) ─────────
export const YG1_TOOLS: YG1ToolOption[] = [
  { kind: "yg1", id: "yg1-ehd84-10", brand: "YG-1", series: "EHD84", label: "EHD84 ⌀10 · SUS304 측면", iso: "M", D: 10, Z: 4, LOC: 25, shape: "square", priceKrw: 58000, Vc: 135, fz: 0.055, coatingMult: 1.10 },
  { kind: "yg1", id: "yg1-ga931-8", brand: "YG-1", series: "GA931", label: "GA931 ⌀8 · 스테인리스 4날", iso: "M", D: 8, Z: 4, LOC: 20, shape: "square", priceKrw: 46000, Vc: 140, fz: 0.045, coatingMult: 1.08 },
  { kind: "yg1", id: "yg1-v7plus-gmg87-8", brand: "YG-1", series: "V7 PLUS GMG87", label: "V7 PLUS ⌀8 · 주철 헤비", iso: "K", D: 8, Z: 4, LOC: 20, shape: "square", priceKrw: 52000, Vc: 210, fz: 0.09, coatingMult: 1.15 },
  { kind: "yg1", id: "yg1-sem813-8", brand: "YG-1", series: "SEM813", label: "SEM813 ⌀8 · S45C 고속", iso: "P", D: 8, Z: 4, LOC: 20, shape: "square", priceKrw: 48000, Vc: 200, fz: 0.07, coatingMult: 1.12 },
  { kind: "yg1", id: "yg1-sg8a01-6", brand: "YG-1", series: "SG8", label: "SG8 ⌀6 · 프리하든강", iso: "H", D: 6, Z: 4, LOC: 14, shape: "square", priceKrw: 62000, Vc: 120, fz: 0.04, coatingMult: 1.20 },
  { kind: "yg1", id: "yg1-gnx35-5", brand: "YG-1", series: "GNX35", label: "GNX35 ⌀5 · 고경도 (50~60HRC)", iso: "H", D: 5, Z: 4, LOC: 12, shape: "square", priceKrw: 78000, Vc: 90, fz: 0.028, coatingMult: 1.25 },
  { kind: "yg1", id: "yg1-4g-sem846-6", brand: "YG-1", series: "4G SEM846", label: "4G SEM846 ⌀6 볼 · 55~65HRC", iso: "H", D: 6, Z: 2, LOC: 12, shape: "ball", priceKrw: 85000, Vc: 70, fz: 0.022, coatingMult: 1.22 },
  { kind: "yg1", id: "yg1-gmh61-8", brand: "YG-1", series: "GMH61", label: "GMH61 ⌀8 · Inconel718", iso: "S", D: 8, Z: 4, LOC: 16, shape: "ball", priceKrw: 94000, Vc: 50, fz: 0.028, coatingMult: 1.18 },
  { kind: "yg1", id: "yg1-eq480-10", brand: "YG-1", series: "EQ480", label: "EQ480 ⌀10 볼 · 알루미늄", iso: "N", D: 10, Z: 2, LOC: 20, shape: "ball", priceKrw: 38000, Vc: 550, fz: 0.065, coatingMult: 1.05 },
  { kind: "yg1", id: "yg1-x5070-10-r05", brand: "YG-1", series: "X5070", label: "X5070 ⌀10 R0.5 · S50C", iso: "P", D: 10, Z: 4, LOC: 25, shape: "radius", priceKrw: 64000, Vc: 180, fz: 0.065, coatingMult: 1.12, cornerR: 0.5 },
  { kind: "yg1", id: "yg1-seme61-8-r10", brand: "YG-1", series: "SEME61", label: "SEME61 ⌀8 R1.0 · 경화강", iso: "H", D: 8, Z: 4, LOC: 18, shape: "radius", priceKrw: 72000, Vc: 105, fz: 0.033, coatingMult: 1.20, cornerR: 1.0 },
]

// ── 경쟁사 벤치마크 (공개 카탈로그 기반 추정 — 영업자료 전용) ────────────────
export const COMPETITOR_BENCHMARKS: CompetitorToolOption[] = [
  { kind: "competitor", id: "harvey-emb30c-10", brand: "Harvey", series: "EMB30C", label: "Harvey EMB30C ⌀10 · 3F AlTiN", iso: "P", D: 10, Z: 3, LOC: 22, shape: "square", priceKrw: 85000, Vc: 220, fz: 0.08, coatingMult: 1.00 },
  { kind: "competitor", id: "harvey-emb50m-8", brand: "Harvey", series: "EMB50M", label: "Harvey EMB50M ⌀8 · SS 5F", iso: "M", D: 8, Z: 5, LOC: 19, shape: "square", priceKrw: 92000, Vc: 150, fz: 0.05, coatingMult: 1.00 },
  { kind: "competitor", id: "sandvik-cm390-10", brand: "Sandvik", series: "CoroMill 390", label: "Sandvik CoroMill 390 ⌀10", iso: "P", D: 10, Z: 4, LOC: 20, shape: "square", priceKrw: 120000, Vc: 200, fz: 0.10, coatingMult: 1.00 },
  { kind: "competitor", id: "sandvik-cm316-8", brand: "Sandvik", series: "CoroMill 316", label: "Sandvik CoroMill 316 ⌀8 · M", iso: "M", D: 8, Z: 4, LOC: 18, shape: "square", priceKrw: 140000, Vc: 160, fz: 0.06, coatingMult: 1.00 },
  { kind: "competitor", id: "sandvik-cm plura-6", brand: "Sandvik", series: "Plura H10F", label: "Sandvik Plura H10F ⌀6 볼", iso: "H", D: 6, Z: 2, LOC: 12, shape: "ball", priceKrw: 135000, Vc: 75, fz: 0.020, coatingMult: 1.00 },
  { kind: "competitor", id: "walter-protomax-10", brand: "Walter", series: "Proto-max ULTRA", label: "Walter Proto-max ULTRA ⌀10", iso: "P", D: 10, Z: 4, LOC: 22, shape: "square", priceKrw: 95000, Vc: 210, fz: 0.09, coatingMult: 1.00 },
  { kind: "competitor", id: "walter-mc232-8", brand: "Walter", series: "MC232 Advance", label: "Walter MC232 Advance ⌀8 · M", iso: "M", D: 8, Z: 4, LOC: 20, shape: "square", priceKrw: 110000, Vc: 155, fz: 0.055, coatingMult: 1.00 },
  { kind: "competitor", id: "kennametal-hharvi-10", brand: "Kennametal", series: "HARVI III", label: "Kennametal HARVI III ⌀10", iso: "P", D: 10, Z: 5, LOC: 22, shape: "square", priceKrw: 105000, Vc: 215, fz: 0.09, coatingMult: 1.00 },
  { kind: "competitor", id: "kennametal-ksem-8", brand: "Kennametal", series: "KSEM", label: "Kennametal KSEM ⌀8 · S계", iso: "S", D: 8, Z: 4, LOC: 16, shape: "ball", priceKrw: 155000, Vc: 55, fz: 0.030, coatingMult: 1.00 },
  { kind: "competitor", id: "harvey-emb60h-6", brand: "Harvey", series: "EMB60H", label: "Harvey EMB60H ⌀6 · 60HRC용", iso: "H", D: 6, Z: 6, LOC: 14, shape: "square", priceKrw: 115000, Vc: 95, fz: 0.025, coatingMult: 1.00 },
]

export const ALL_TOOLS: ToolOption[] = [...YG1_TOOLS, ...COMPETITOR_BENCHMARKS]

export const HARVEY_REPLACEMENT_PRESETS: HarveyReplacementPreset[] = [
  {
    id: "harvey-p-10",
    title: "Harvey EMB30C 대체",
    subtitle: "탄소강/합금강 10mm 구간",
    harveyId: "harvey-emb30c-10",
    sandvikId: "sandvik-cm390-10",
    yg1Id: "yg1-x5070-10-r05",
  },
  {
    id: "harvey-m-8",
    title: "Harvey EMB50M 대체",
    subtitle: "스테인리스 8mm 구간",
    harveyId: "harvey-emb50m-8",
    sandvikId: "sandvik-cm316-8",
    yg1Id: "yg1-ga931-8",
  },
  {
    id: "harvey-h-6",
    title: "Harvey EMB60H 대체",
    subtitle: "고경도강 6mm 구간",
    harveyId: "harvey-emb60h-6",
    sandvikId: "sandvik-cm plura-6",
    yg1Id: "yg1-4g-sem846-6",
  },
]

export function getToolOptionById(id: string): ToolOption | undefined {
  return ALL_TOOLS.find((tool) => tool.id === id)
}

// ── 계산 결과 타입 ───────────────────────────────────
interface SlotMetrics {
  tool: ToolOption
  n: number
  Vf: number
  MRR: number
  Pc: number
  Fc: number
  toolLifeMin: number
  raUm: number
  priceKrw: number
  costPerHourKrw: number // 공구 소모 비용 / 시간 (priceKrw / toolLifeHr)
}

// 지표 메타 (높을수록 좋음 / 낮을수록 좋음)
type MetricKey = "MRR" | "toolLifeMin" | "Pc" | "Fc" | "priceKrw" | "raUm" | "costPerHourKrw"
const METRIC_META: Record<MetricKey, { label: string; unit: string; higherBetter: boolean; digits: number }> = {
  MRR: { label: "MRR (금속제거율)", unit: "cm³/min", higherBetter: true, digits: 2 },
  toolLifeMin: { label: "예상 공구수명", unit: "min", higherBetter: true, digits: 0 },
  Pc: { label: "소요동력 Pc", unit: "kW", higherBetter: false, digits: 2 },
  Fc: { label: "절삭력 Fc", unit: "N", higherBetter: false, digits: 0 },
  priceKrw: { label: "공구 단가", unit: "₩", higherBetter: false, digits: 0 },
  raUm: { label: "표면조도 Ra", unit: "μm", higherBetter: false, digits: 2 },
  costPerHourKrw: { label: "공구 비용/시간", unit: "₩/hr", higherBetter: false, digits: 0 },
}

const MAX_SLOTS = 4

// ── 메인 컴포넌트 ─────────────────────────────────────
export function MultiToolCompare({
  isoGroup,
  ap,
  ae,
  operation,
  educationMode,
  onSelectTool,
}: MultiToolCompareProps) {
  const edu = useEducation()
  const eduOn = educationMode ?? edu.enabled

  // 디폴트: YG-1 2개 + Harvey 1개 (iso 매칭 우선)
  const initialSlots = useMemo<(string | null)[]>(() => {
    const matchedYg1 = YG1_TOOLS.filter(t => t.iso === isoGroup).slice(0, 2).map(t => t.id)
    const matchedComp = COMPETITOR_BENCHMARKS.filter(c => c.iso === isoGroup).slice(0, 1).map(t => t.id)
    const slots: (string | null)[] = [...matchedYg1, ...matchedComp]
    while (slots.length < 3 && slots.length < MAX_SLOTS) slots.push(null)
    return slots.slice(0, MAX_SLOTS)
  }, [isoGroup])

  const [slots, setSlots] = useState<(string | null)[]>(initialSlots)

  const addSlot = () => {
    if (slots.length >= MAX_SLOTS) return
    setSlots(s => [...s, null])
  }
  const removeSlot = (idx: number) => {
    setSlots(s => s.filter((_, i) => i !== idx))
  }
  const setSlot = (idx: number, toolId: string | null) => {
    setSlots(s => s.map((v, i) => (i === idx ? toolId : v)))
  }

  // 각 슬롯 지표 계산
  const slotMetrics = useMemo<(SlotMetrics | null)[]>(() => {
    return slots.map(id => {
      if (!id) return null
      const tool = ALL_TOOLS.find(t => t.id === id)
      if (!tool) return null
      const safeAp = Math.min(ap, tool.LOC)
      const safeAe = Math.min(ae, tool.D)
      const base = calculateCutting({
        Vc: tool.Vc, fz: tool.fz, ap: safeAp, ae: safeAe,
        D: tool.D, Z: tool.Z, isoGroup,
      })
      const adv = computeAdvanced({
        Pc: base.Pc, n: base.n, D: tool.D,
        shaft: { stickoutMm: tool.D * 3, youngModulusGPa: 600 },
      })
      const toolLifeMin = estimateToolLifeMin({
        Vc: tool.Vc,
        VcReference: tool.Vc, // 우리는 카탈로그 Vc로 실행한다고 가정
        coatingMult: tool.coatingMult,
        isoGroup,
        toolMaterialE: 600,
      })
      const raUm = estimateRaUm({
        fz: tool.fz, D: tool.D, shape: tool.shape, cornerR: tool.cornerR, ae: safeAe,
      })
      const lifeHr = toolLifeMin > 0 ? toolLifeMin / 60 : 0
      const costPerHourKrw = lifeHr > 0 ? tool.priceKrw / lifeHr : tool.priceKrw
      return {
        tool,
        n: base.n,
        Vf: base.Vf,
        MRR: base.MRR,
        Pc: base.Pc,
        Fc: adv.Fc,
        toolLifeMin: parseFloat(toolLifeMin.toFixed(1)),
        raUm,
        priceKrw: tool.priceKrw,
        costPerHourKrw: Math.round(costPerHourKrw),
      }
    })
  }, [slots, isoGroup, ap, ae])

  const active = slotMetrics.filter((m): m is SlotMetrics => m !== null)

  // 지표별 best / worst index (active 배열 기준)
  const bestWorst = useMemo(() => {
    const out: Record<MetricKey, { bestIdx: number; worstIdx: number }> = {} as never
    ;(Object.keys(METRIC_META) as MetricKey[]).forEach(k => {
      const meta = METRIC_META[k]
      if (active.length === 0) {
        out[k] = { bestIdx: -1, worstIdx: -1 }
        return
      }
      const vals = active.map(m => m[k])
      const sorted = vals.map((v, i) => ({ v, i })).sort((a, b) => a.v - b.v)
      const minIdx = sorted[0].i
      const maxIdx = sorted[sorted.length - 1].i
      out[k] = meta.higherBetter
        ? { bestIdx: maxIdx, worstIdx: minIdx }
        : { bestIdx: minIdx, worstIdx: maxIdx }
    })
    return out
  }, [active])

  // YG-1 우위 논리 생성
  const yg1Story = useMemo(() => buildYg1Story(active, eduOn), [active, eduOn])

  return (
    <div className="space-y-6">
      {/* 헤더 */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <Trophy className="h-5 w-5 text-amber-500" />
            다중 공구 비교 — {ISO_LABELS[isoGroup] ?? isoGroup} · {operation}
            <FeatureExplainer featureId="multi-tool-compare" inline />
          </h2>
          <p className="text-xs text-muted-foreground mt-1">
            같은 재질·op 조건에서 최대 {MAX_SLOTS}개 공구의 MRR / 수명 / 동력 / 단가 / Ra 를 나란히 비교합니다.
            경쟁사 값은 공개 카탈로그 기반 추정치입니다.
          </p>
        </div>
        {slots.length < MAX_SLOTS && (
          <button
            type="button"
            onClick={addSlot}
            className="inline-flex items-center gap-1 rounded-md border border-dashed border-zinc-300 dark:border-zinc-700 px-3 py-1.5 text-sm hover:bg-zinc-100 dark:hover:bg-zinc-800"
          >
            <Plus className="h-4 w-4" /> 슬롯 추가
          </button>
        )}
      </div>

      {/* 슬롯 그리드 */}
      <div className={`grid gap-3 items-stretch ${slots.length >= 4 ? "grid-cols-1 md:grid-cols-2 xl:grid-cols-4"
        : slots.length === 3 ? "grid-cols-1 md:grid-cols-3"
        : slots.length === 2 ? "grid-cols-1 md:grid-cols-2"
        : "grid-cols-1"}`}>
        {slots.map((id, idx) => (
          <ToolSlotCard
            key={`slot-${idx}`}
            index={idx}
            toolId={id}
            metrics={slotMetrics[idx]}
            canRemove={slots.length > 1}
            onSelect={(tid) => setSlot(idx, tid)}
            onRemove={() => removeSlot(idx)}
            onApply={onSelectTool}
            bestWorst={bestWorst}
            activeOnly={active}
          />
        ))}
      </div>

      {/* 비교표 + 차트 */}
      {active.length >= 2 && (
        <>
          <CompareTable metrics={active} bestWorst={bestWorst} />
          <CompareBarChart metrics={active} />
          <Yg1StoryCard story={yg1Story} educationMode={eduOn} />
        </>
      )}

      {active.length < 2 && (
        <div className="rounded-md border border-dashed border-zinc-300 dark:border-zinc-700 p-6 text-center text-sm text-muted-foreground">
          슬롯에 공구를 2개 이상 선택하면 비교 표와 차트가 나타납니다.
        </div>
      )}
    </div>
  )
}

// ── 슬롯 카드 ─────────────────────────────────────────
function ToolSlotCard(props: {
  index: number
  toolId: string | null
  metrics: SlotMetrics | null
  canRemove: boolean
  onSelect: (id: string | null) => void
  onRemove: () => void
  onApply?: (series: string, D: number) => void
  bestWorst: Record<MetricKey, { bestIdx: number; worstIdx: number }>
  activeOnly: SlotMetrics[]
}) {
  const { index, toolId, metrics, canRemove, onSelect, onRemove, onApply, bestWorst, activeOnly } = props
  const tool = metrics?.tool
  const isYg1 = tool?.kind === "yg1"

  // activeOnly 기준 현재 슬롯의 인덱스 (null 슬롯은 제외됨)
  const activeIdx = metrics ? activeOnly.indexOf(metrics) : -1

  const renderMetric = (k: MetricKey) => {
    if (!metrics) return null
    const meta = METRIC_META[k]
    const val = metrics[k]
    const bw = bestWorst[k]
    const isBest = activeIdx === bw.bestIdx && activeOnly.length >= 2
    const isWorst = activeIdx === bw.worstIdx && activeOnly.length >= 2 && bw.bestIdx !== bw.worstIdx
    return (
      <div key={k} className="flex items-center justify-between gap-2 py-0.5 text-xs min-w-0">
        <span className="truncate min-w-0 text-muted-foreground">{meta.label}</span>
        <span className={`flex-shrink-0 whitespace-nowrap font-mono tabular-nums font-medium ${isBest ? "text-emerald-600 dark:text-emerald-400" : isWorst ? "text-rose-600 dark:text-rose-400" : ""}`}>
          {isBest && <span className="mr-1">🏆</span>}
          {isWorst && <span className="mr-1">🔻</span>}
          {formatNumber(val, meta.digits)} <span className="text-muted-foreground font-normal">{meta.unit}</span>
        </span>
      </div>
    )
  }

  return (
    <div className={`rounded-lg border p-3 flex h-full min-w-0 flex-col gap-3 ${
      isYg1
        ? "border-amber-300 dark:border-amber-700 bg-amber-50/40 dark:bg-amber-950/10"
        : "border-zinc-200 dark:border-zinc-800"
    }`}>
      {/* 슬롯 헤더 */}
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-muted-foreground">슬롯 {index + 1}</span>
        {canRemove && (
          <button
            type="button"
            onClick={onRemove}
            className="text-muted-foreground hover:text-rose-500"
            aria-label="슬롯 제거"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {/* 공구 선택 */}
      <select
        value={toolId ?? ""}
        onChange={(e) => onSelect(e.target.value || null)}
        className="w-full text-sm rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-2 py-1.5"
      >
        <option value="">— 공구 선택 —</option>
        <optgroup label="YG-1">
          {YG1_TOOLS.map(t => (
            <option key={t.id} value={t.id}>{t.label}</option>
          ))}
        </optgroup>
        <optgroup label="경쟁사 벤치마크 (가상)">
          {COMPETITOR_BENCHMARKS.map(t => (
            <option key={t.id} value={t.id}>{t.label}</option>
          ))}
        </optgroup>
      </select>

      {/* 공구 요약 */}
      {tool && (
        <div className="min-w-0 text-xs text-muted-foreground">
          <div className="flex items-center gap-1 min-w-0">
            {isYg1 && <Award className="h-3.5 w-3.5 flex-shrink-0 text-amber-500" />}
            <span className={`truncate ${isYg1 ? "font-semibold text-foreground" : "font-medium text-foreground"}`}>
              {tool.brand}
            </span>
            <span className="truncate">· {tool.series}</span>
          </div>
          <div className="mt-0.5 truncate" title={`⌀${tool.D} · ${tool.Z}F · LOC ${tool.LOC}mm · ${tool.shape}`}>
            ⌀{tool.D} · {tool.Z}F · LOC {tool.LOC}mm · {tool.shape}
          </div>
        </div>
      )}

      {/* 지표 */}
      {metrics && (
        <div className="border-t border-dashed border-zinc-200 dark:border-zinc-800 pt-2 min-w-0">
          {(Object.keys(METRIC_META) as MetricKey[]).map(k => renderMetric(k))}
          <div className="mt-2 pt-2 border-t border-dashed border-zinc-200 dark:border-zinc-800 text-[11px] text-muted-foreground space-y-0.5 min-w-0">
            <div className="truncate" title={`n = ${metrics.n.toLocaleString()} rpm · Vf = ${metrics.Vf.toLocaleString()} mm/min`}>
              n = {metrics.n.toLocaleString()} rpm · Vf = {metrics.Vf.toLocaleString()} mm/min
            </div>
            <div className="truncate" title={`사용 Vc ${tool!.Vc} m/min · fz ${tool!.fz} mm/t`}>
              사용 Vc {tool!.Vc} m/min · fz {tool!.fz} mm/t
            </div>
          </div>
        </div>
      )}

      {/* YG-1 공구 선택 → 시뮬레이터에 반영 */}
      {tool && isYg1 && onApply && (
        <button
          type="button"
          onClick={() => onApply(tool.series, tool.D)}
          className="text-xs rounded-md bg-amber-600 hover:bg-amber-700 text-white px-2 py-1"
        >
          이 YG-1 공구로 시뮬레이터 세팅
        </button>
      )}
    </div>
  )
}

// ── 비교 표 ───────────────────────────────────────────
function CompareTable({ metrics, bestWorst }: {
  metrics: SlotMetrics[]
  bestWorst: Record<MetricKey, { bestIdx: number; worstIdx: number }>
}) {
  const keys = Object.keys(METRIC_META) as MetricKey[]
  return (
    <div className="overflow-x-auto rounded-md border border-zinc-200 dark:border-zinc-800">
      <table className="w-full text-xs">
        <thead className="bg-zinc-50 dark:bg-zinc-900/50">
          <tr>
            <th className="text-left p-2 font-medium">지표</th>
            {metrics.map((m, i) => (
              <th key={i} className="text-right p-2 font-medium">
                <div className="flex items-center justify-end gap-1">
                  {m.tool.kind === "yg1" && <Award className="h-3.5 w-3.5 text-amber-500" />}
                  <span>{m.tool.brand}</span>
                </div>
                <div className="text-[10px] text-muted-foreground font-normal">{m.tool.series}</div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {keys.map(k => {
            const meta = METRIC_META[k]
            const bw = bestWorst[k]
            return (
              <tr key={k} className="border-t border-zinc-100 dark:border-zinc-800">
                <td className="p-2 text-muted-foreground">
                  {meta.label} <span className="text-[10px]">({meta.unit})</span>
                </td>
                {metrics.map((m, i) => {
                  const isBest = i === bw.bestIdx && metrics.length >= 2
                  const isWorst = i === bw.worstIdx && metrics.length >= 2 && bw.bestIdx !== bw.worstIdx
                  return (
                    <td key={i} className={`p-2 text-right font-mono tabular-nums ${
                      isBest ? "text-emerald-600 dark:text-emerald-400 font-semibold"
                        : isWorst ? "text-rose-600 dark:text-rose-400" : ""
                    }`}>
                      {isBest && "🏆 "}
                      {isWorst && "🔻 "}
                      {formatNumber(m[k], meta.digits)}
                    </td>
                  )
                })}
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

// ── 비교 차트 (MRR · Tool Life · Pc normalized) ─────
function CompareBarChart({ metrics }: { metrics: SlotMetrics[] }) {
  // 정규화 (각 지표 max=100)
  const chartData = useMemo(() => {
    const maxMRR = Math.max(...metrics.map(m => m.MRR), 0.001)
    const maxLife = Math.max(...metrics.map(m => m.toolLifeMin), 0.001)
    const maxPc = Math.max(...metrics.map(m => m.Pc), 0.001)
    return metrics.map(m => ({
      name: `${m.tool.brand}\n${m.tool.series}`,
      MRR: parseFloat(((m.MRR / maxMRR) * 100).toFixed(1)),
      "Tool Life": parseFloat(((m.toolLifeMin / maxLife) * 100).toFixed(1)),
      "Pc (낮을수록 ↓)": parseFloat(((m.Pc / maxPc) * 100).toFixed(1)),
      isYg1: m.tool.kind === "yg1",
    }))
  }, [metrics])

  return (
    <div className="rounded-md border border-zinc-200 dark:border-zinc-800 p-3">
      <div className="text-xs font-medium mb-2 flex items-center gap-1">
        <Info className="h-3.5 w-3.5 text-muted-foreground" />
        정규화 비교 (각 지표의 최댓값 = 100)
      </div>
      <div className="h-64">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 30 }}>
            <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
            <XAxis dataKey="name" tick={{ fontSize: 11 }} interval={0} />
            <YAxis tick={{ fontSize: 11 }} domain={[0, 100]} />
            <Tooltip
              contentStyle={{ fontSize: 11 }}
              formatter={(v: unknown) => `${v}/100`}
            />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Bar dataKey="MRR" fill="#10b981">
              {chartData.map((d, i) => (
                <Cell key={i} fill={d.isYg1 ? "#059669" : "#34d399"} />
              ))}
            </Bar>
            <Bar dataKey="Tool Life" fill="#3b82f6">
              {chartData.map((d, i) => (
                <Cell key={i} fill={d.isYg1 ? "#2563eb" : "#60a5fa"} />
              ))}
            </Bar>
            <Bar dataKey="Pc (낮을수록 ↓)" fill="#f97316">
              {chartData.map((d, i) => (
                <Cell key={i} fill={d.isYg1 ? "#ea580c" : "#fdba74"} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}

// ── "왜 YG-1" 서술 ───────────────────────────────────
interface Yg1Story {
  headline: string
  wins: string[]
  caveats: string[]
}

function buildYg1Story(metrics: SlotMetrics[], educationMode: boolean): Yg1Story {
  const yg1 = metrics.filter(m => m.tool.kind === "yg1")
  const comp = metrics.filter(m => m.tool.kind === "competitor")
  if (yg1.length === 0 || comp.length === 0) {
    return {
      headline: "YG-1 vs 경쟁사 비교를 위해 슬롯에 각각 하나씩 선택해 주세요.",
      wins: [],
      caveats: [],
    }
  }

  const wins: string[] = []
  const caveats: string[] = []

  // 대표 YG-1 (최고 MRR × life 조합)
  const bestYg1 = yg1.reduce((best, cur) => {
    const score = cur.MRR * Math.max(1, cur.toolLifeMin)
    const bestScore = best.MRR * Math.max(1, best.toolLifeMin)
    return score > bestScore ? cur : best
  })
  // 대표 경쟁사 (최고 MRR)
  const topComp = comp.reduce((best, cur) => (cur.MRR > best.MRR ? cur : best))

  // 1. 가격 장점
  const priceDiff = ((topComp.priceKrw - bestYg1.priceKrw) / topComp.priceKrw) * 100
  if (priceDiff > 5) {
    wins.push(`공구 단가: ${bestYg1.tool.brand} ${bestYg1.tool.series} ₩${bestYg1.priceKrw.toLocaleString()} vs ${topComp.tool.brand} ${topComp.tool.series} ₩${topComp.priceKrw.toLocaleString()} — ${priceDiff.toFixed(0)}% 저렴`)
  } else if (priceDiff < -5) {
    caveats.push(`YG-1 공구 단가가 ${(-priceDiff).toFixed(0)}% 높음 — 단, 수명·코팅에서 회수 가능`)
  }

  // 2. 공구수명
  const lifeDiff = ((bestYg1.toolLifeMin - topComp.toolLifeMin) / Math.max(1, topComp.toolLifeMin)) * 100
  if (lifeDiff > 5) {
    wins.push(`공구수명: +${lifeDiff.toFixed(0)}% (${bestYg1.toolLifeMin.toFixed(0)}분 vs ${topComp.toolLifeMin.toFixed(0)}분) — YG-1 자체 코팅 기술 (coating mult ${bestYg1.tool.coatingMult.toFixed(2)})`)
  } else if (lifeDiff < -5) {
    caveats.push(`공구수명에서는 ${topComp.tool.brand}가 +${(-lifeDiff).toFixed(0)}% 앞섬 — 상위 공정에 한정 적용 검토`)
  }

  // 3. 공구 비용 / 시간
  const costDiff = ((topComp.costPerHourKrw - bestYg1.costPerHourKrw) / Math.max(1, topComp.costPerHourKrw)) * 100
  if (costDiff > 5) {
    wins.push(`시간당 공구비: −${costDiff.toFixed(0)}% (₩${bestYg1.costPerHourKrw.toLocaleString()}/hr vs ₩${topComp.costPerHourKrw.toLocaleString()}/hr)`)
  }

  // 4. MRR
  const mrrDiff = ((bestYg1.MRR - topComp.MRR) / Math.max(0.001, topComp.MRR)) * 100
  if (mrrDiff > 3) {
    wins.push(`생산성(MRR): +${mrrDiff.toFixed(0)}% (${bestYg1.MRR} vs ${topComp.MRR} cm³/min)`)
  } else if (mrrDiff < -5) {
    caveats.push(`MRR은 ${topComp.tool.brand}가 +${(-mrrDiff).toFixed(0)}% — 대신 YG-1은 수명/동력에서 우위`)
  }

  // 5. 동력
  const pcDiff = ((topComp.Pc - bestYg1.Pc) / Math.max(0.001, topComp.Pc)) * 100
  if (pcDiff > 5) {
    wins.push(`소요동력: ${pcDiff.toFixed(0)}% 낮음 (${bestYg1.Pc}kW vs ${topComp.Pc}kW) — 스핀들 부담 경감`)
  }

  // 6. 표면조도
  const raDiff = ((topComp.raUm - bestYg1.raUm) / Math.max(0.001, topComp.raUm)) * 100
  if (raDiff > 3) {
    wins.push(`표면조도 Ra: ${raDiff.toFixed(0)}% 좋음 (${bestYg1.raUm} vs ${topComp.raUm} μm)`)
  }

  // 교육 모드면 설명 추가
  if (educationMode) {
    if (wins.length === 0) {
      caveats.push("현재 선택된 공구 조합에서는 경쟁사 우위가 보입니다. 다른 YG-1 시리즈(같은 ISO 그룹)를 슬롯에 추가해 비교해 보세요.")
    } else {
      wins.push("※ 교육 모드: 이 결과는 Taylor tool life · chip load 모델 기반 계산이며, 실제 공장 데이터로 보정 필요")
    }
  }

  const headline = wins.length >= 2
    ? `YG-1 ${bestYg1.tool.series}가 ${wins.length}개 지표에서 우위`
    : wins.length === 1
      ? `YG-1 ${bestYg1.tool.series}가 특정 지표에서 우위`
      : "현재 비교 조건에서는 경쟁사가 유리 — 공정 재설계 권장"

  return { headline, wins, caveats }
}

function Yg1StoryCard({ story, educationMode }: { story: Yg1Story; educationMode: boolean }) {
  return (
    <div className="rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50/60 dark:bg-amber-950/20 p-4">
      <div className="flex items-center gap-2 mb-2">
        <Award className="h-5 w-5 text-amber-600 dark:text-amber-400" />
        <h3 className="font-semibold">{story.headline}</h3>
      </div>
      {story.wins.length > 0 && (
        <ul className="text-sm space-y-1 mb-2">
          {story.wins.map((w, i) => (
            <li key={i} className="flex gap-2 min-w-0">
              <span className="flex-shrink-0 text-emerald-600 dark:text-emerald-400">✓</span>
              <span className="min-w-0 break-words">{w}</span>
            </li>
          ))}
        </ul>
      )}
      {story.caveats.length > 0 && (
        <ul className="text-xs text-muted-foreground space-y-1 border-t border-amber-200 dark:border-amber-800 pt-2">
          {story.caveats.map((c, i) => (
            <li key={i} className="flex gap-2 min-w-0">
              <span className="flex-shrink-0 text-amber-600 dark:text-amber-500">!</span>
              <span className="min-w-0 break-words">{c}</span>
            </li>
          ))}
        </ul>
      )}
      {educationMode && (
        <div className="mt-2 text-[11px] text-muted-foreground flex items-start gap-1">
          <TrendingDown className="h-3 w-3 mt-0.5 flex-shrink-0" />
          <span>YG-1 coating multiplier = 공구 수명 기여분. 1.00 이상일수록 표준 대비 수명 가산.</span>
        </div>
      )}
    </div>
  )
}

// ── util ───────────────────────────────────────────
function formatNumber(v: number, digits: number): string {
  if (!Number.isFinite(v)) return "—"
  if (digits === 0) return Math.round(v).toLocaleString()
  return v.toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits })
}

export default MultiToolCompare
