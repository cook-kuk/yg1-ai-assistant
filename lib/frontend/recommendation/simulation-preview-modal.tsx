// SPDX-License-Identifier: MIT
// Cook-Forge — Simulation Preview + Alternatives A/B Modal
//
// /products 제품 카드에서 "🎬 절삭조건 시뮬레이션" 버튼으로 여는 경량 모달.
// 좌: 현재 제품의 카탈로그 조건으로 핵심 지표(RPM/Vf/MRR/Pc) + 축소 LiveCuttingScene
// 우: 대체품 찾기 → A/B 비교 (지표 diff + slide-in 애니메이션)
//
// 규칙:
//  - 기존 recommendation-display.tsx / cutting-simulator-v2.tsx 건드리지 않는다.
//  - 하드코딩 금지: 매직넘버는 파일 상단 SIM_PREVIEW 상수로 집약.
//  - LiveCuttingScene은 dynamic(ssr:false) 로드.
"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import dynamic from "next/dynamic"
import { AnimatePresence, motion } from "framer-motion"
import { toast } from "sonner"
import { X, Sparkles, Loader2, ArrowRight, ExternalLink, RotateCcw, CheckCircle2, Film, Map as MapIcon, LayoutGrid } from "lucide-react"

// ─────────────────────────────────────────────────────────────
// 로컬 SSOT (매직넘버 집약)
// ─────────────────────────────────────────────────────────────
const SIM_PREVIEW = {
  // kc (단위 절삭저항, N/mm²) — ISO 재질별 개략치
  KC_BY_GROUP: {
    P: 2000,
    M: 2200,
    K: 1200,
    N: 800,
    S: 2500,
    H: 3500,
  } as Record<string, number>,
  KC_DEFAULT: 2000,

  // Pc 계산식: MRR·kc / (60·10³·η)
  POWER_ETA: 0.8,
  POWER_DIVISOR: 60_000,

  // live scene 축소판 크기
  SCENE_W: 440,
  SCENE_H: 240,

  // tool-path scene 기본 stock 치수 (시연용)
  TOOLPATH_STOCK_W: 60,
  TOOLPATH_STOCK_L: 80,
  TOOLPATH_DEFAULT_AE: 2,
  TOOLPATH_DEFAULT_DIAM: 10,
  TOOLPATH_W: 440,
  TOOLPATH_H: 240,

  // "둘 다" 모드에서 씬 축소 비율
  BOTH_SCENE_W: 320,
  BOTH_SCENE_H: 180,

  // KPI pulse 주기 (ms)
  KPI_PULSE_MS: 1400,

  // stickout 기본값 (데이터에 없을 때)
  DEFAULT_STICKOUT_MM: 25,

  // 대체품 후보 최대 개수
  MAX_ALT: 3,

  // 대체품 mock 요청 지연 (ms) — 실제 endpoint 없을 때 UX용
  MOCK_ALT_DELAY_MS: 520,

  // z-index
  Z_OVERLAY: 80,
} as const

// dynamic import — ssr:false, 클라이언트에서만 로드
import type { LiveCuttingSceneProps } from "@/lib/frontend/simulator/v2/live-cutting-scene"
const LiveCuttingScene = dynamic<LiveCuttingSceneProps>(
  () =>
    import("@/lib/frontend/simulator/v2/live-cutting-scene").then(
      (m) => m.LiveCuttingScene,
    ),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-[240px] w-full items-center justify-center rounded-lg bg-slate-100 text-xs text-slate-500 dark:bg-slate-800 dark:text-slate-400">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" /> 씬 로딩 중…
      </div>
    ),
  },
)

import type { ToolPathSceneProps } from "@/lib/frontend/simulator/v2/tool-path-scene"
const ToolPathScene = dynamic<ToolPathSceneProps>(
  () => import("@/lib/frontend/simulator/v2/tool-path-scene"),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-[220px] w-full items-center justify-center rounded-lg bg-slate-100 text-xs text-slate-400 dark:bg-slate-800 dark:text-slate-400">
        <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> 🗺 경로 로딩...
      </div>
    ),
  },
)

type PathStrategy = "zigzag" | "spiral" | "trochoidal" | "adaptive"
type VisualMode = "chips" | "path" | "both"

const STRATEGY_OPTIONS: { key: PathStrategy; label: string }[] = [
  { key: "zigzag", label: "Zigzag" },
  { key: "spiral", label: "Spiral" },
  { key: "trochoidal", label: "Trochoidal" },
  { key: "adaptive", label: "Adaptive" },
]

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────
type ShapeKey = "square" | "ball" | "radius" | "chamfer"

export interface SimulationPreviewProduct {
  edpNo: string
  seriesName: string
  brandName?: string
  diameter?: number
  fluteCount?: number
  shape?: ShapeKey
  coating?: string
  material?: string // ISO P/M/K/N/S/H
}

export interface SimulationPreviewConditions {
  Vc?: number
  fz?: number
  ap?: number
  ae?: number
  operationType?: string
}

export interface SimulationPreviewAlternative {
  edpNo: string
  seriesName: string
  diameter?: number
  fluteCount?: number
  shape?: string
  coating?: string
  Vc?: number
  fz?: number
  ap?: number
  ae?: number
}

export interface SimulationPreviewModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  product: SimulationPreviewProduct
  conditions?: SimulationPreviewConditions
  alternatives?: SimulationPreviewAlternative[]
  darkMode?: boolean
}

interface DerivedMetrics {
  ok: boolean
  rpm: number
  vf: number
  mrr: number
  pc: number
  kc: number
}

// ─────────────────────────────────────────────────────────────
// 계산 유틸
// ─────────────────────────────────────────────────────────────
function kcForMaterial(material?: string): number {
  const key = (material ?? "").trim().toUpperCase().charAt(0)
  return SIM_PREVIEW.KC_BY_GROUP[key] ?? SIM_PREVIEW.KC_DEFAULT
}

function computeMetrics(
  diameter: number | undefined,
  flutes: number | undefined,
  material: string | undefined,
  c: SimulationPreviewConditions | undefined,
): DerivedMetrics {
  const D = Number(diameter)
  const Z = Number(flutes)
  const Vc = Number(c?.Vc)
  const fz = Number(c?.fz)
  const ap = Number(c?.ap)
  const ae = Number(c?.ae)
  const kc = kcForMaterial(material)
  const ok =
    Number.isFinite(D) && D > 0 &&
    Number.isFinite(Z) && Z > 0 &&
    Number.isFinite(Vc) && Vc > 0 &&
    Number.isFinite(fz) && fz > 0
  if (!ok) {
    return { ok: false, rpm: 0, vf: 0, mrr: 0, pc: 0, kc }
  }
  const rpm = (1000 * Vc) / (Math.PI * D)
  const vf = fz * Z * rpm
  const apOk = Number.isFinite(ap) && ap > 0
  const aeOk = Number.isFinite(ae) && ae > 0
  const mrr = apOk && aeOk ? (ap * ae * vf) / 1000 : 0
  const pc = mrr > 0 ? (mrr * kc) / (SIM_PREVIEW.POWER_DIVISOR * SIM_PREVIEW.POWER_ETA) : 0
  return { ok: true, rpm, vf, mrr, pc, kc }
}

function fmt(n: number, digits = 1): string {
  if (!Number.isFinite(n)) return "—"
  if (n === 0) return "0"
  if (Math.abs(n) >= 1000) return n.toFixed(0)
  return n.toFixed(digits)
}

function pctDiff(a: number, b: number): number {
  if (!Number.isFinite(a) || !Number.isFinite(b) || a === 0) return 0
  return ((b - a) / a) * 100
}

function diffLabel(p: number): { text: string; cls: string } {
  if (!Number.isFinite(p) || Math.abs(p) < 0.1) return { text: "≈", cls: "text-slate-400" }
  if (p > 0) return { text: `▲ ${p.toFixed(1)}%`, cls: "text-emerald-500" }
  return { text: `▼ ${Math.abs(p).toFixed(1)}%`, cls: "text-rose-500" }
}

function normalizeShape(s?: string): ShapeKey {
  const k = (s ?? "").toLowerCase()
  if (k === "ball" || k === "radius" || k === "chamfer") return k
  return "square"
}

function simulatorUrl(
  product: SimulationPreviewProduct,
  c?: SimulationPreviewConditions,
): string {
  const sp = new URLSearchParams()
  sp.set("product", product.edpNo)
  if (product.material) sp.set("material", product.material)
  if (c?.operationType) sp.set("operation", c.operationType)
  if (c?.Vc != null) sp.set("vc", String(c.Vc))
  if (c?.fz != null) sp.set("fz", String(c.fz))
  if (c?.ap != null) sp.set("ap", String(c.ap))
  if (c?.ae != null) sp.set("ae", String(c.ae))
  return `/simulator_v2?${sp.toString()}`
}

// chatter risk/chip morph 휴리스틱 (LiveCuttingScene 필수 props 충족용)
function quickChatterRisk(ap: number | undefined, D: number | undefined): "low" | "med" | "high" {
  if (!Number.isFinite(ap) || !Number.isFinite(D) || !D) return "low"
  const ratio = (ap as number) / (D as number)
  if (ratio > 1.5) return "high"
  if (ratio > 0.8) return "med"
  return "low"
}

// ─────────────────────────────────────────────────────────────
// Mock alternatives (실제 endpoint 없을 때 fallback)
// ─────────────────────────────────────────────────────────────
async function fetchAlternatives(
  product: SimulationPreviewProduct,
  conditions: SimulationPreviewConditions | undefined,
  signal: AbortSignal,
): Promise<SimulationPreviewAlternative[]> {
  // 1) 실제 endpoint가 있으면 우선 시도
  try {
    const res = await fetch("/api/recommend?mode=alternatives", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        edpNo: product.edpNo,
        material: product.material,
        diameter: product.diameter,
        fluteCount: product.fluteCount,
        shape: product.shape,
        conditions,
      }),
      signal,
    })
    if (res.ok) {
      const data = (await res.json()) as { items?: SimulationPreviewAlternative[] }
      if (Array.isArray(data.items) && data.items.length > 0) {
        return data.items.slice(0, SIM_PREVIEW.MAX_ALT)
      }
    }
  } catch {
    // 실패 시 mock 으로 fallback
  }

  // 2) 결정론적 mock — 직경/날수/Vc/fz 를 약간씩 변주
  await new Promise<void>((r) => setTimeout(r, SIM_PREVIEW.MOCK_ALT_DELAY_MS))
  const baseD = product.diameter ?? 10
  const baseZ = product.fluteCount ?? 4
  const baseVc = conditions?.Vc ?? 120
  const basefz = conditions?.fz ?? 0.04
  const baseAp = conditions?.ap ?? baseD * 0.5
  const baseAe = conditions?.ae ?? baseD * 0.25
  const shape = product.shape ?? "square"
  return [
    {
      edpNo: `${product.edpNo}-ALT1`,
      seriesName: `${product.seriesName} Plus`,
      diameter: baseD,
      fluteCount: baseZ,
      shape,
      coating: product.coating ?? "AlTiN",
      Vc: +(baseVc * 1.1).toFixed(1),
      fz: +(basefz * 1.05).toFixed(4),
      ap: baseAp,
      ae: baseAe,
    },
    {
      edpNo: `${product.edpNo}-ALT2`,
      seriesName: `${product.seriesName} Eco`,
      diameter: baseD,
      fluteCount: Math.max(2, baseZ - 1),
      shape,
      coating: product.coating ?? "TiAlN",
      Vc: +(baseVc * 0.95).toFixed(1),
      fz: +(basefz * 0.95).toFixed(4),
      ap: baseAp,
      ae: baseAe,
    },
    {
      edpNo: `${product.edpNo}-ALT3`,
      seriesName: `${product.seriesName} HP`,
      diameter: baseD,
      fluteCount: baseZ + 1,
      shape,
      coating: "nACo",
      Vc: +(baseVc * 1.18).toFixed(1),
      fz: +(basefz * 0.98).toFixed(4),
      ap: baseAp * 0.9,
      ae: baseAe * 1.1,
    },
  ].slice(0, SIM_PREVIEW.MAX_ALT)
}

// ─────────────────────────────────────────────────────────────
// Sub: KPI card
// ─────────────────────────────────────────────────────────────
function KpiCard({
  label,
  value,
  unit,
  diffPct,
  dark,
}: {
  label: string
  value: string
  unit: string
  diffPct?: number
  dark: boolean
}) {
  const d = diffPct != null ? diffLabel(diffPct) : null
  return (
    <div
      className={[
        "rounded-lg border px-3 py-2",
        dark
          ? "border-slate-700 bg-slate-800/60"
          : "border-slate-200 bg-white",
      ].join(" ")}
    >
      <div className={dark ? "text-[10px] uppercase tracking-wider text-slate-400" : "text-[10px] uppercase tracking-wider text-slate-500"}>
        {label}
      </div>
      <div className="mt-0.5 flex items-baseline gap-1">
        <span className={dark ? "text-lg font-semibold text-slate-100" : "text-lg font-semibold text-slate-900"}>
          {value}
        </span>
        <span className={dark ? "text-xs text-slate-400" : "text-xs text-slate-500"}>{unit}</span>
      </div>
      {d && <div className={`mt-0.5 text-[11px] font-medium ${d.cls}`}>{d.text}</div>}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────
// Sub: Alternative list item
// ─────────────────────────────────────────────────────────────
function AltListItem({
  alt,
  selected,
  onPick,
  dark,
}: {
  alt: SimulationPreviewAlternative
  selected: boolean
  onPick: () => void
  dark: boolean
}) {
  return (
    <button
      type="button"
      onClick={onPick}
      className={[
        "w-full rounded-lg border px-3 py-2 text-left transition",
        selected
          ? dark
            ? "border-amber-400 bg-amber-500/10"
            : "border-amber-500 bg-amber-50"
          : dark
            ? "border-slate-700 bg-slate-800/40 hover:border-slate-500"
            : "border-slate-200 bg-white hover:border-slate-400",
      ].join(" ")}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className={dark ? "truncate text-sm font-semibold text-slate-100" : "truncate text-sm font-semibold text-slate-900"}>
            {alt.seriesName}
          </div>
          <div className={dark ? "text-[11px] text-slate-400" : "text-[11px] text-slate-500"}>
            EDP {alt.edpNo} · ⌀{alt.diameter ?? "—"}mm · Z{alt.fluteCount ?? "—"}
            {alt.coating ? ` · ${alt.coating}` : ""}
          </div>
        </div>
        <span className={dark ? "text-[11px] text-amber-300" : "text-[11px] text-amber-600"}>
          {selected ? "선택됨" : "비교"}
        </span>
      </div>
      <div className={dark ? "mt-1 grid grid-cols-4 gap-1 text-[10px] text-slate-400" : "mt-1 grid grid-cols-4 gap-1 text-[10px] text-slate-500"}>
        <span>Vc {fmt(alt.Vc ?? NaN, 0)}</span>
        <span>fz {fmt(alt.fz ?? NaN, 3)}</span>
        <span>ap {fmt(alt.ap ?? NaN, 2)}</span>
        <span>ae {fmt(alt.ae ?? NaN, 2)}</span>
      </div>
    </button>
  )
}

// ─────────────────────────────────────────────────────────────
// Main modal
// ─────────────────────────────────────────────────────────────
export default function SimulationPreviewModal(props: SimulationPreviewModalProps) {
  const { open, onOpenChange, product, conditions, alternatives, darkMode = false } = props

  const overlayRef = useRef<HTMLDivElement>(null)
  const cardRef = useRef<HTMLDivElement>(null)
  const headingId = useMemo(() => `sim-preview-h-${product.edpNo}`, [product.edpNo])

  const [alts, setAlts] = useState<SimulationPreviewAlternative[]>(alternatives ?? [])
  const [altLoading, setAltLoading] = useState(false)
  const [selectedAltId, setSelectedAltId] = useState<string | null>(null)
  const [applied, setApplied] = useState(false)
  const [visualMode, setVisualMode] = useState<VisualMode>("path")
  const [pathStrategy, setPathStrategy] = useState<PathStrategy>("zigzag")
  const abortRef = useRef<AbortController | null>(null)

  // ESC + focus management
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation()
        onOpenChange(false)
      }
    }
    document.addEventListener("keydown", onKey)
    // focus trap (light): focus card
    const t = setTimeout(() => cardRef.current?.focus(), 20)
    // lock body scroll
    const prev = document.body.style.overflow
    document.body.style.overflow = "hidden"
    return () => {
      document.removeEventListener("keydown", onKey)
      clearTimeout(t)
      document.body.style.overflow = prev
    }
  }, [open, onOpenChange])

  // reset state on close/product change
  useEffect(() => {
    if (!open) {
      setSelectedAltId(null)
      setApplied(false)
      abortRef.current?.abort()
      abortRef.current = null
      return
    }
    setAlts(alternatives ?? [])
  }, [open, alternatives, product.edpNo])

  // metrics
  const baseMetrics = useMemo(
    () => computeMetrics(product.diameter, product.fluteCount, product.material, conditions),
    [product.diameter, product.fluteCount, product.material, conditions],
  )

  const selectedAlt = useMemo(
    () => alts.find((a) => a.edpNo === selectedAltId) ?? null,
    [alts, selectedAltId],
  )

  const altMetrics = useMemo(() => {
    if (!selectedAlt) return null
    return computeMetrics(
      selectedAlt.diameter,
      selectedAlt.fluteCount,
      product.material,
      { Vc: selectedAlt.Vc, fz: selectedAlt.fz, ap: selectedAlt.ap, ae: selectedAlt.ae },
    )
  }, [selectedAlt, product.material])

  // 추천도 휴리스틱: MRR↑, Pc↓, fz 적정 (간단)
  const recommendationScore = useMemo(() => {
    if (!altMetrics || !baseMetrics.ok || !altMetrics.ok) return null
    const mrrGain = pctDiff(baseMetrics.mrr || 1, altMetrics.mrr || 1)
    const pcPenalty = pctDiff(baseMetrics.pc || 1, altMetrics.pc || 1)
    const lifeProxy = -pcPenalty * 0.4 // 전력↑ → 공구수명↓ 가정
    const score = Math.max(0, Math.min(100, 60 + mrrGain * 0.6 + lifeProxy))
    return { score: Math.round(score), mrrGain, pcPenalty }
  }, [altMetrics, baseMetrics])

  const handleFindAlternatives = useCallback(async () => {
    if (altLoading) return
    setAltLoading(true)
    abortRef.current?.abort()
    const ac = new AbortController()
    abortRef.current = ac
    try {
      const items = await fetchAlternatives(product, conditions, ac.signal)
      if (ac.signal.aborted) return
      setAlts(items)
      if (items.length === 0) {
        toast.error("대체품 후보를 찾지 못했습니다.")
      }
    } catch (err) {
      if (!ac.signal.aborted) {
        toast.error("대체품 조회에 실패했습니다.")
      }
    } finally {
      if (!ac.signal.aborted) setAltLoading(false)
    }
  }, [altLoading, product, conditions])

  const handleApply = useCallback(() => {
    if (!selectedAlt) return
    setApplied(true)
    toast.success(`대체품 적용: ${selectedAlt.seriesName}`)
  }, [selectedAlt])

  if (!open) return null

  const dark = darkMode
  const overlayBg = "bg-slate-950/70 backdrop-blur-sm"
  const cardBg = dark
    ? "bg-slate-900 text-slate-100 border border-slate-700"
    : "bg-white text-slate-900 border border-slate-200"

  // LiveCuttingScene 에 전달할 파라미터
  const sceneDiameter = product.diameter ?? 10
  const sceneFlutes = product.fluteCount ?? 4
  const sceneShape: ShapeKey = normalizeShape(product.shape)
  const chatter = quickChatterRisk(conditions?.ap, sceneDiameter)

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          ref={overlayRef}
          key="sim-preview-overlay"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          className={`fixed inset-0 z-[${SIM_PREVIEW.Z_OVERLAY}] flex items-start justify-center overflow-y-auto p-4 ${overlayBg}`}
          style={{ zIndex: SIM_PREVIEW.Z_OVERLAY }}
          onClick={(e) => {
            if (e.target === overlayRef.current) onOpenChange(false)
          }}
          role="presentation"
        >
          <motion.div
            ref={cardRef}
            tabIndex={-1}
            role="dialog"
            aria-modal="true"
            aria-labelledby={headingId}
            initial={{ opacity: 0, y: 16, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 16, scale: 0.98 }}
            transition={{ duration: 0.18, ease: "easeOut" }}
            className={`relative my-8 w-full max-w-5xl rounded-2xl shadow-2xl outline-none ${cardBg} max-h-[92vh] overflow-y-auto`}
          >
            {/* Header */}
            <div
              className={
                dark
                  ? "flex items-start justify-between gap-3 border-b border-slate-700 px-5 py-4"
                  : "flex items-start justify-between gap-3 border-b border-slate-200 px-5 py-4"
              }
            >
              <div className="min-w-0">
                <h2
                  id={headingId}
                  className="flex items-center gap-2 text-base font-semibold tracking-tight"
                >
                  <Sparkles className="h-4 w-4 text-amber-500" />
                  절삭조건 시뮬레이션 미리보기
                </h2>
                <p className={dark ? "mt-0.5 text-xs text-slate-400" : "mt-0.5 text-xs text-slate-500"}>
                  EDP <span className="font-mono">{product.edpNo}</span> · {product.seriesName}
                  {product.brandName ? ` · ${product.brandName}` : ""}
                  {product.material ? ` · ISO ${product.material.charAt(0).toUpperCase()}` : ""}
                  {product.diameter != null ? ` · ⌀${product.diameter}mm` : ""}
                  {product.coating ? ` · ${product.coating}` : ""}
                </p>
              </div>
              <button
                type="button"
                aria-label="닫기"
                onClick={() => onOpenChange(false)}
                className={
                  dark
                    ? "rounded-md p-1.5 text-slate-400 hover:bg-slate-800 hover:text-slate-100"
                    : "rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-900"
                }
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Body */}
            <div className="grid gap-4 px-5 py-4 md:grid-cols-[1fr_1fr]">
              {/* ── LEFT : current product simulation ── */}
              <section
                className="relative overflow-hidden rounded-xl border border-violet-500/30 bg-gradient-to-br from-slate-950 via-slate-900 to-violet-950 p-3 text-slate-100"
                style={{
                  boxShadow:
                    "0 0 0 1px rgba(167,139,250,0.15), 0 10px 35px -10px rgba(124,58,237,0.45), inset 0 1px 0 rgba(255,255,255,0.04)",
                }}
                aria-label="현재 제품 시뮬레이션"
              >
                {/* 스캔라인 오버레이 */}
                <div
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-0 opacity-[0.08]"
                  style={{
                    backgroundImage:
                      "repeating-linear-gradient(0deg, rgba(255,255,255,0.6) 0px, rgba(255,255,255,0.6) 1px, transparent 1px, transparent 3px)",
                  }}
                />
                <div className="relative">
                  <div className="mb-2 flex items-center justify-between">
                    <h3 className="text-sm font-semibold tracking-tight text-slate-100">
                      🎯 현재 제품
                    </h3>
                    <span className="text-[10px] text-slate-400">카탈로그 절삭조건</span>
                  </div>

                  {/* 비주얼 모드 토글 */}
                  <div className="mb-2 flex items-center gap-1.5 rounded-md bg-slate-900/60 p-0.5 ring-1 ring-white/5">
                    {([
                      { key: "chips", label: "칩", icon: Film },
                      { key: "path", label: "툴패스", icon: MapIcon },
                      { key: "both", label: "둘 다", icon: LayoutGrid },
                    ] as { key: VisualMode; label: string; icon: typeof Film }[]).map(
                      (opt) => {
                        const active = visualMode === opt.key
                        const Icon = opt.icon
                        return (
                          <button
                            key={opt.key}
                            type="button"
                            onClick={() => setVisualMode(opt.key)}
                            className={[
                              "inline-flex flex-1 items-center justify-center gap-1 rounded px-2 py-1 text-[11px] font-medium transition",
                              active
                                ? "bg-gradient-to-r from-violet-500/80 to-amber-500/80 text-slate-950 shadow"
                                : "text-slate-300 hover:bg-white/5 hover:text-slate-100",
                            ].join(" ")}
                            aria-pressed={active}
                          >
                            <Icon className="h-3 w-3" />
                            {opt.label}
                          </button>
                        )
                      },
                    )}
                  </div>

                  {/* 전략 드롭다운 (path/both 일 때만) */}
                  {(visualMode === "path" || visualMode === "both") && (
                    <div className="mb-2 flex items-center gap-2">
                      <label className="text-[10px] uppercase tracking-wider text-slate-400">
                        전략
                      </label>
                      <select
                        value={pathStrategy}
                        onChange={(e) => setPathStrategy(e.target.value as PathStrategy)}
                        className="flex-1 rounded-md border border-slate-700 bg-slate-900/80 px-2 py-1 text-[11px] font-medium text-slate-100 outline-none focus:border-amber-400"
                      >
                        {STRATEGY_OPTIONS.map((s) => (
                          <option key={s.key} value={s.key}>
                            {s.label}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}

                  {baseMetrics.ok ? (
                    <motion.div
                      className="grid grid-cols-2 gap-2"
                      animate={{ opacity: [0.85, 1, 0.85] }}
                      transition={{
                        duration: SIM_PREVIEW.KPI_PULSE_MS / 1000,
                        repeat: Infinity,
                        ease: "easeInOut",
                      }}
                    >
                      <KpiCard label="RPM" value={fmt(baseMetrics.rpm, 0)} unit="rpm" dark />
                      <KpiCard label="Vf" value={fmt(baseMetrics.vf, 0)} unit="mm/min" dark />
                      <KpiCard label="MRR" value={fmt(baseMetrics.mrr, 1)} unit="cm³/min" dark />
                      <KpiCard label="Pc" value={fmt(baseMetrics.pc, 2)} unit="kW" dark />
                    </motion.div>
                  ) : (
                    <div className="rounded-md border border-dashed border-slate-600 bg-slate-900/40 px-3 py-4 text-center text-xs text-slate-400">
                      ⚠ 데이터 부족 (Vc·fz·직경 필수) — 우측에서 대체품만 확인할 수 있습니다.
                    </div>
                  )}

                  {/* 비주얼 영역 */}
                  <div className="mt-3 overflow-hidden rounded-lg ring-1 ring-violet-500/20">
                    {baseMetrics.ok ? (
                      visualMode === "both" ? (
                        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                          <LiveCuttingScene
                            shape={sceneShape}
                            diameter={sceneDiameter}
                            flutes={sceneFlutes}
                            Vc={conditions?.Vc ?? 120}
                            Vf={baseMetrics.vf}
                            rpm={baseMetrics.rpm}
                            ap={conditions?.ap ?? sceneDiameter * 0.3}
                            ae={conditions?.ae ?? sceneDiameter * 0.25}
                            stickoutMm={SIM_PREVIEW.DEFAULT_STICKOUT_MM}
                            materialGroup={product.material ?? "P"}
                            chatterRisk={chatter}
                            darkMode
                            width={SIM_PREVIEW.BOTH_SCENE_W}
                            height={SIM_PREVIEW.BOTH_SCENE_H}
                          />
                          <ToolPathScene
                            strategy={pathStrategy}
                            stockWidth={SIM_PREVIEW.TOOLPATH_STOCK_W}
                            stockLength={SIM_PREVIEW.TOOLPATH_STOCK_L}
                            diameter={product.diameter ?? SIM_PREVIEW.TOOLPATH_DEFAULT_DIAM}
                            ae={conditions?.ae ?? SIM_PREVIEW.TOOLPATH_DEFAULT_AE}
                            Vf={baseMetrics.vf}
                            shape={sceneShape}
                            darkMode
                            autoReplay
                            width={SIM_PREVIEW.BOTH_SCENE_W}
                            height={SIM_PREVIEW.BOTH_SCENE_H}
                          />
                        </div>
                      ) : visualMode === "path" ? (
                        <ToolPathScene
                          strategy={pathStrategy}
                          stockWidth={SIM_PREVIEW.TOOLPATH_STOCK_W}
                          stockLength={SIM_PREVIEW.TOOLPATH_STOCK_L}
                          diameter={product.diameter ?? SIM_PREVIEW.TOOLPATH_DEFAULT_DIAM}
                          ae={conditions?.ae ?? SIM_PREVIEW.TOOLPATH_DEFAULT_AE}
                          Vf={baseMetrics.vf}
                          shape={sceneShape}
                          darkMode
                          autoReplay
                          width={SIM_PREVIEW.TOOLPATH_W}
                          height={SIM_PREVIEW.TOOLPATH_H}
                        />
                      ) : (
                        <LiveCuttingScene
                          shape={sceneShape}
                          diameter={sceneDiameter}
                          flutes={sceneFlutes}
                          Vc={conditions?.Vc ?? 120}
                          Vf={baseMetrics.vf}
                          rpm={baseMetrics.rpm}
                          ap={conditions?.ap ?? sceneDiameter * 0.3}
                          ae={conditions?.ae ?? sceneDiameter * 0.25}
                          stickoutMm={SIM_PREVIEW.DEFAULT_STICKOUT_MM}
                          materialGroup={product.material ?? "P"}
                          chatterRisk={chatter}
                          darkMode
                          width={SIM_PREVIEW.SCENE_W}
                          height={SIM_PREVIEW.SCENE_H}
                        />
                      )
                    ) : (
                      <div className="flex h-[200px] items-center justify-center rounded-md border border-dashed border-slate-600 bg-slate-900/40 text-xs text-slate-500">
                        씬 렌더 불가 (조건 부족)
                      </div>
                    )}
                  </div>

                  <a
                    href={simulatorUrl(product, conditions)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-3 inline-flex items-center gap-1.5 text-xs font-medium text-amber-300 hover:text-amber-200"
                  >
                    전체 시뮬레이터로 열기
                    <ExternalLink className="h-3.5 w-3.5" />
                  </a>
                </div>
              </section>

              {/* ── RIGHT : alternatives A/B ── */}
              <section
                className={
                  dark
                    ? "rounded-xl border border-slate-700 bg-slate-800/30 p-3"
                    : "rounded-xl border border-slate-200 bg-slate-50/50 p-3"
                }
                aria-label="대체품 비교"
              >
                <div className="mb-2 flex items-center justify-between gap-2">
                  <h3 className="text-sm font-semibold">🔄 대체품 비교</h3>
                  <button
                    type="button"
                    onClick={handleFindAlternatives}
                    disabled={altLoading}
                    className={[
                      "inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-[11px] font-medium transition",
                      altLoading ? "cursor-not-allowed opacity-60" : "",
                      dark
                        ? "bg-amber-500/20 text-amber-200 hover:bg-amber-500/30"
                        : "bg-amber-500 text-white hover:bg-amber-600",
                    ].join(" ")}
                  >
                    {altLoading ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <RotateCcw className="h-3.5 w-3.5" />
                    )}
                    {alts.length > 0 ? "다시 찾기" : "대체품 찾기"}
                  </button>
                </div>

                {/* list */}
                {alts.length === 0 && !altLoading && (
                  <div
                    className={
                      dark
                        ? "rounded-md border border-dashed border-slate-600 bg-slate-900/40 px-3 py-6 text-center text-xs text-slate-400"
                        : "rounded-md border border-dashed border-slate-300 bg-white px-3 py-6 text-center text-xs text-slate-500"
                    }
                  >
                    "대체품 찾기" 를 눌러 후보를 불러오세요.
                  </div>
                )}
                {altLoading && (
                  <div className={dark ? "flex items-center gap-2 rounded-md bg-slate-900/40 px-3 py-6 text-xs text-slate-400" : "flex items-center gap-2 rounded-md bg-white px-3 py-6 text-xs text-slate-500"}>
                    <Loader2 className="h-4 w-4 animate-spin" /> 후보 조회 중…
                  </div>
                )}

                {alts.length > 0 && (
                  <div className="space-y-2">
                    {alts.map((alt) => (
                      <AltListItem
                        key={alt.edpNo}
                        alt={alt}
                        selected={selectedAltId === alt.edpNo}
                        onPick={() => {
                          setSelectedAltId(alt.edpNo)
                          setApplied(false)
                        }}
                        dark={dark}
                      />
                    ))}
                  </div>
                )}

                {/* A/B compare panel */}
                <AnimatePresence mode="wait">
                  {selectedAlt && altMetrics && (
                    <motion.div
                      key={selectedAlt.edpNo}
                      initial={{ opacity: 0, x: 20 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0, x: 20 }}
                      transition={{ duration: 0.2 }}
                      className={
                        dark
                          ? "mt-3 rounded-lg border border-slate-700 bg-slate-900/60 p-3"
                          : "mt-3 rounded-lg border border-slate-200 bg-white p-3"
                      }
                    >
                      <div className="mb-2 flex items-center justify-between">
                        <div className="text-xs font-semibold">A/B 비교</div>
                        {recommendationScore && (
                          <div className={dark ? "text-[10px] text-slate-300" : "text-[10px] text-slate-600"}>
                            추천도 <span className="font-bold text-amber-500">{recommendationScore.score}</span>/100
                          </div>
                        )}
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        {/* A: original */}
                        <div className={dark ? "rounded-md border border-slate-700 p-2" : "rounded-md border border-slate-200 p-2"}>
                          <div className={dark ? "mb-1 text-[10px] font-semibold uppercase tracking-wider text-sky-300" : "mb-1 text-[10px] font-semibold uppercase tracking-wider text-sky-600"}>
                            A · 원본
                          </div>
                          <div className="space-y-1 text-[11px]">
                            <div>RPM <span className="float-right font-mono">{fmt(baseMetrics.rpm, 0)}</span></div>
                            <div>Vf <span className="float-right font-mono">{fmt(baseMetrics.vf, 0)}</span></div>
                            <div>MRR <span className="float-right font-mono">{fmt(baseMetrics.mrr, 1)}</span></div>
                            <div>Pc <span className="float-right font-mono">{fmt(baseMetrics.pc, 2)}</span></div>
                          </div>
                        </div>
                        {/* B: alternative */}
                        <div className={dark ? "rounded-md border border-amber-500/40 bg-amber-500/5 p-2" : "rounded-md border border-amber-500 bg-amber-50 p-2"}>
                          <div className={dark ? "mb-1 text-[10px] font-semibold uppercase tracking-wider text-amber-300" : "mb-1 text-[10px] font-semibold uppercase tracking-wider text-amber-600"}>
                            B · {selectedAlt.seriesName}
                          </div>
                          <div className="space-y-1 text-[11px]">
                            <div>
                              RPM <span className="float-right font-mono">{fmt(altMetrics.rpm, 0)}</span>
                              <div className={`text-right text-[10px] ${diffLabel(pctDiff(baseMetrics.rpm, altMetrics.rpm)).cls}`}>
                                {diffLabel(pctDiff(baseMetrics.rpm, altMetrics.rpm)).text}
                              </div>
                            </div>
                            <div>
                              Vf <span className="float-right font-mono">{fmt(altMetrics.vf, 0)}</span>
                              <div className={`text-right text-[10px] ${diffLabel(pctDiff(baseMetrics.vf, altMetrics.vf)).cls}`}>
                                {diffLabel(pctDiff(baseMetrics.vf, altMetrics.vf)).text}
                              </div>
                            </div>
                            <div>
                              MRR <span className="float-right font-mono">{fmt(altMetrics.mrr, 1)}</span>
                              <div className={`text-right text-[10px] ${diffLabel(pctDiff(baseMetrics.mrr, altMetrics.mrr)).cls}`}>
                                {diffLabel(pctDiff(baseMetrics.mrr, altMetrics.mrr)).text}
                              </div>
                            </div>
                            <div>
                              Pc <span className="float-right font-mono">{fmt(altMetrics.pc, 2)}</span>
                              <div className={`text-right text-[10px] ${diffLabel(pctDiff(baseMetrics.pc, altMetrics.pc)).cls}`}>
                                {diffLabel(pctDiff(baseMetrics.pc, altMetrics.pc)).text}
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>

                      {recommendationScore && (
                        <div className={dark ? "mt-2 rounded border border-slate-700 bg-slate-900/60 px-2 py-1.5 text-[11px] text-slate-300" : "mt-2 rounded border border-slate-200 bg-slate-50 px-2 py-1.5 text-[11px] text-slate-600"}>
                          MRR {recommendationScore.mrrGain >= 0 ? "+" : ""}{recommendationScore.mrrGain.toFixed(1)}% ·
                          Pc {recommendationScore.pcPenalty >= 0 ? "+" : ""}{recommendationScore.pcPenalty.toFixed(1)}% ·
                          공구수명 {recommendationScore.pcPenalty > 0 ? "감소" : "증가"} 예상 · 원가 영향 보통
                        </div>
                      )}
                    </motion.div>
                  )}
                </AnimatePresence>
              </section>
            </div>

            {/* Footer */}
            <div
              className={
                dark
                  ? "flex items-center justify-between gap-2 border-t border-slate-700 px-5 py-3"
                  : "flex items-center justify-between gap-2 border-t border-slate-200 px-5 py-3"
              }
            >
              <div className={dark ? "text-[11px] text-slate-400" : "text-[11px] text-slate-500"}>
                {applied
                  ? "✓ 적용 완료 — 전체 시뮬레이터에서 추가 조정 가능"
                  : "대체품 선택 시 A/B 차이가 실시간 표시됩니다."}
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => onOpenChange(false)}
                  className={
                    dark
                      ? "inline-flex items-center gap-1 rounded-md border border-slate-600 px-3 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-800"
                      : "inline-flex items-center gap-1 rounded-md border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100"
                  }
                >
                  <X className="h-3.5 w-3.5" /> 닫기
                </button>
                <button
                  type="button"
                  disabled={!selectedAlt}
                  onClick={handleApply}
                  className={[
                    "inline-flex items-center gap-1 rounded-md px-3 py-1.5 text-xs font-semibold transition",
                    !selectedAlt
                      ? "cursor-not-allowed bg-slate-300 text-slate-500 dark:bg-slate-700 dark:text-slate-500"
                      : dark
                        ? "bg-emerald-500 text-slate-950 hover:bg-emerald-400"
                        : "bg-emerald-600 text-white hover:bg-emerald-700",
                  ].join(" ")}
                >
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  이 대체품 적용
                  <ArrowRight className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
