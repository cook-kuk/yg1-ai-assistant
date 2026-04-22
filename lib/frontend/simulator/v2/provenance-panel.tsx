"use client"

// ProvenancePanel — "이 값이 어디서 왔는지" step-by-step 추적 패널.
// Harvey MAP 스타일: baseline SFM/IPT → dial% → coolant → coating → hardness → stickout → final.
// Education mode 가 켜져 있으면 기본 펼침 + 각 단계 설명 노출.

import { useMemo, useState } from "react"
import { ChevronDown, ChevronRight, BookOpen, Database, AlertTriangle, Info } from "lucide-react"
import type { SpeedsFeedsRow } from "./speeds-feeds-types"
import FeatureExplainer from "./feature-explainer"

// ── Props ──
export interface ProvenancePanelProps {
  /** 최종 표시 중인 현재값 (simulator 이미 계산 완료) */
  Vc: number // m/min
  fz: number // mm/tooth
  n: number // rpm
  Vf: number // mm/min
  kc?: number // 비절삭저항 N/mm² (선택)
  /** 공구 기하 — RPM 역산 표기용 */
  D: number // mm
  Z: number // 날수

  /** speeds-feeds API 응답의 baseline row (없으면 default 표기) */
  baseline: {
    sfm: number
    iptInch: number
    vcMetric?: number
    fzMetric?: number
    source: SpeedsFeedsRow["source"] | "default" | "none"
    confidence: number // 0~5
    sourceRef?: string
    toolIdLabel?: string // 예: "Harvey 942332"
    pdfCode?: string // 예: "SF_942300.pdf"
  } | null

  /** 각 보정계수 (곱셈 적용) */
  coolantMult: number
  coatingMult: number
  hardnessMult: number
  stickoutMult: number

  /** 유저 다이얼 (%, 정수) */
  speedPct: number
  feedPct: number

  /** 상세 레이블 (선택) */
  coolantLabel?: string
  coatingLabel?: string
  hardnessLabel?: string
  stickoutLabel?: string

  /** 교육모드 — on 이면 기본 펼침 + 각 단계 설명 노출 */
  educationOpen?: boolean

  /** 커스텀 클래스 */
  className?: string
}

// ── Helpers ──
const fmt = (v: number | null | undefined, d = 2): string => {
  if (v == null || !Number.isFinite(v)) return "—"
  if (Math.abs(v) >= 1000) return v.toFixed(0)
  if (Math.abs(v) < 0.01 && v !== 0) return v.toExponential(2)
  return v.toFixed(d)
}

const pctFmt = (p: number): string => (p >= 0 ? `+${p}%` : `${p}%`)

function starLabel(confidence: number): string {
  const n = Math.max(0, Math.min(5, Math.round(confidence)))
  return "★".repeat(n) + "☆".repeat(5 - n)
}

function sourceBadge(src: string): { label: string; bg: string; fg: string } {
  switch (src) {
    case "pdf_verified":
      return { label: "PDF 검증", bg: "bg-emerald-100", fg: "text-emerald-800" }
    case "pdf_partial":
      return { label: "PDF 부분", bg: "bg-amber-100", fg: "text-amber-800" }
    case "estimated":
      return { label: "추정", bg: "bg-slate-100 dark:bg-slate-800", fg: "text-slate-700 dark:text-slate-200" }
    case "default":
      return { label: "기본값", bg: "bg-slate-100 dark:bg-slate-800", fg: "text-slate-600 dark:text-slate-300" }
    default:
      return { label: "출처없음", bg: "bg-rose-100", fg: "text-rose-800" }
  }
}

// ── Sub-components ──
interface StepProps {
  icon?: React.ReactNode
  label: string
  formula?: string
  value: string
  unit?: string
  note?: string
  dim?: boolean
  warn?: boolean
}

function Step({ icon, label, formula, value, unit, note, dim = false, warn = false }: StepProps) {
  return (
    <div
      className={[
        "flex items-start gap-2 py-1.5 px-2 rounded border-l-2",
        warn ? "border-amber-400 bg-amber-50/40" : dim ? "border-slate-200 dark:border-slate-700" : "border-sky-400 bg-sky-50/40",
      ].join(" ")}
    >
      <div className="pt-0.5 text-slate-500 dark:text-slate-400">{icon ?? <ChevronRight className="w-3.5 h-3.5" />}</div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[12px] font-medium text-slate-800 dark:text-slate-100">{label}</span>
          {formula && <span className="text-[11px] font-mono text-slate-500 dark:text-slate-400">{formula}</span>}
        </div>
        {note && <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">{note}</div>}
      </div>
      <div className="text-[12px] font-mono font-semibold text-slate-900 dark:text-slate-100 whitespace-nowrap">
        {value}
        {unit && <span className="text-[10px] text-slate-500 dark:text-slate-400 ml-0.5">{unit}</span>}
      </div>
    </div>
  )
}

interface ChainProps {
  title: string
  final: string
  unit: string
  confidence: number
  steps: StepProps[]
  educationOpen: boolean
}

function Chain({ title, final, unit, confidence, steps, educationOpen }: ChainProps) {
  const [open, setOpen] = useState<boolean>(educationOpen)
  return (
    <div className="border border-slate-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-900">
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center justify-between px-3 py-2 text-left hover:bg-slate-50 dark:hover:bg-slate-800"
      >
        <div className="flex items-center gap-2">
          {open ? <ChevronDown className="w-4 h-4 text-slate-500 dark:text-slate-400" /> : <ChevronRight className="w-4 h-4 text-slate-500 dark:text-slate-400" />}
          <span className="text-[13px] font-semibold text-slate-800 dark:text-slate-100">{title}</span>
          {confidence > 0 && (
            <span className="text-[10px] font-mono text-amber-600">{starLabel(confidence)}</span>
          )}
        </div>
        <div className="text-[13px] font-mono font-bold text-sky-700 dark:text-sky-400">
          {final}
          <span className="text-[10px] text-slate-500 dark:text-slate-400 ml-0.5">{unit}</span>
        </div>
      </button>
      {open && (
        <div className="border-t border-slate-100 dark:border-slate-800 p-2 space-y-1.5">
          {steps.map((s, i) => (
            <Step key={i} {...s} />
          ))}
        </div>
      )}
    </div>
  )
}

// ── Main component ──
export function ProvenancePanel(p: ProvenancePanelProps) {
  const {
    Vc, fz, n, Vf, kc, D, Z,
    baseline,
    coolantMult, coatingMult, hardnessMult, stickoutMult,
    speedPct, feedPct,
    coolantLabel, coatingLabel, hardnessLabel, stickoutLabel,
    educationOpen = false,
    className,
  } = p

  // Baseline 표기 (없으면 default 표기)
  const hasBaseline = !!baseline
  const bSfm = baseline?.sfm ?? 0
  const bIpt = baseline?.iptInch ?? 0
  const bSrc = baseline?.source ?? "none"
  const bConf = baseline?.confidence ?? 0
  const bRef = baseline?.sourceRef ?? ""
  const bTool = baseline?.toolIdLabel ?? "—"
  const bPdf = baseline?.pdfCode

  const srcStyle = sourceBadge(bSrc)

  // ── SFM chain 계산 (표시용) ──
  // baseline SFM → × (1+speedPct/100) → × coolantMult → × coatingMult → × hardnessMult → × stickoutMult
  const sfmChain = useMemo(() => {
    const s0 = bSfm
    const s1 = s0 * (1 + speedPct / 100)
    const s2 = s1 * coolantMult
    const s3 = s2 * coatingMult
    const s4 = s3 * hardnessMult
    const s5 = s4 * stickoutMult
    return { s0, s1, s2, s3, s4, s5 }
  }, [bSfm, speedPct, coolantMult, coatingMult, hardnessMult, stickoutMult])

  // ── IPT chain 계산 ──
  // baseline IPT → × (1+feedPct/100) → (coolant/coating 은 IPT에는 거의 중립) → × hardnessMult
  const iptChain = useMemo(() => {
    const i0 = bIpt
    const i1 = i0 * (1 + feedPct / 100)
    const i2 = i1 * hardnessMult // conservative: hardnessMult 도 fz에 같이 derate
    return { i0, i1, i2 }
  }, [bIpt, feedPct, hardnessMult])

  // ── SFM steps ──
  const sfmSteps: StepProps[] = hasBaseline
    ? [
        {
          icon: <Database className="w-3.5 h-3.5 text-sky-600" />,
          label: `baseline SFM ← ${bTool}${bPdf ? ` · ${bPdf}` : ""}`,
          formula: bSrc === "estimated" ? "[estimated]" : "[verified]",
          value: fmt(sfmChain.s0, 0),
          unit: "sfm",
          note: educationOpen ? "공구·재질·operation 조합에 대한 카탈로그 baseline." : undefined,
          warn: bSrc === "estimated",
        },
        {
          label: `Speed dial ${pctFmt(speedPct)}`,
          formula: `× (1 ${pctFmt(speedPct)})`,
          value: fmt(sfmChain.s1, 0),
          unit: "sfm",
          note: educationOpen ? "사용자 다이얼 — 단위 SFM 에 직접 %만큼 가감." : undefined,
          dim: speedPct === 0,
        },
        {
          label: `쿨런트 ${coolantLabel ?? ""}`.trim(),
          formula: `× ${fmt(coolantMult, 2)}`,
          value: fmt(sfmChain.s2, 0),
          unit: "sfm",
          note: educationOpen
            ? "Flood=1.0 / MQL≈0.92 / Dry≈0.7 / Through-Spindle≈1.15 — 열 제거 능력 기반 Vc 보정."
            : undefined,
          dim: coolantMult === 1,
        },
        {
          label: `코팅 ${coatingLabel ?? ""}`.trim(),
          formula: `× ${fmt(coatingMult, 2)}`,
          value: fmt(sfmChain.s3, 0),
          unit: "sfm",
          note: educationOpen
            ? "Uncoated=1.0 / TiN≈1.15 / AlTiN≈1.35 / DLC(Al)≈1.3 — 내열·저마찰 계수."
            : undefined,
          dim: coatingMult === 1,
        },
        {
          label: `Hardness derate ${hardnessLabel ?? ""}`.trim(),
          formula: `× ${fmt(hardnessMult, 2)}`,
          value: fmt(sfmChain.s4, 0),
          unit: "sfm",
          note: educationOpen
            ? "HRC 50+ 재질은 Vc 감속 (baseline 은 표준 경도 기준)."
            : undefined,
          dim: hardnessMult === 1,
        },
        {
          label: `L/D derate ${stickoutLabel ?? ""}`.trim(),
          formula: `× ${fmt(stickoutMult, 2)}`,
          value: fmt(sfmChain.s5, 0),
          unit: "sfm",
          note: educationOpen
            ? "stickout/D 비율이 클수록 chatter 우려 — Vc 감속."
            : undefined,
          dim: stickoutMult === 1,
        },
        {
          label: "최종 Vc (metric)",
          formula: "Vc = SFM × 0.3048",
          value: fmt(Vc, 0),
          unit: "m/min",
          note: educationOpen
            ? `= ${fmt(sfmChain.s5, 0)} × 0.3048 = ${fmt(sfmChain.s5 * 0.3048, 0)} m/min`
            : undefined,
        },
      ]
    : [
        {
          icon: <AlertTriangle className="w-3.5 h-3.5 text-amber-500" />,
          label: "baseline 없음 — 기본값 사용",
          value: fmt(Vc, 0),
          unit: "m/min",
          note: "Tool # 매칭 실패. /api/simulator/speeds-feeds 응답을 확인하세요.",
          warn: true,
        },
      ]

  // ── IPT steps ──
  const iptSteps: StepProps[] = hasBaseline
    ? [
        {
          icon: <Database className="w-3.5 h-3.5 text-sky-600" />,
          label: `baseline IPT ← ${bTool}`,
          value: fmt(iptChain.i0, 5),
          unit: "in/tooth",
          note: educationOpen ? `= ${fmt(iptChain.i0 * 25.4, 3)} mm/tooth` : undefined,
          warn: bSrc === "estimated",
        },
        {
          label: `Feed dial ${pctFmt(feedPct)}`,
          formula: `× (1 ${pctFmt(feedPct)})`,
          value: fmt(iptChain.i1, 5),
          unit: "in/tooth",
          dim: feedPct === 0,
        },
        {
          label: `Hardness derate ${hardnessLabel ?? ""}`.trim(),
          formula: `× ${fmt(hardnessMult, 2)}`,
          value: fmt(iptChain.i2, 5),
          unit: "in/tooth",
          note: educationOpen
            ? "경도가 높을수록 fz 도 함께 감속 (baseline 대비 보수적)."
            : undefined,
          dim: hardnessMult === 1,
        },
        {
          label: "최종 fz (metric)",
          formula: "fz = IPT × 25.4",
          value: fmt(fz, 3),
          unit: "mm/tooth",
          note: educationOpen
            ? `= ${fmt(iptChain.i2, 5)} × 25.4 = ${fmt(iptChain.i2 * 25.4, 3)} mm/tooth`
            : undefined,
        },
      ]
    : [
        {
          icon: <AlertTriangle className="w-3.5 h-3.5 text-amber-500" />,
          label: "baseline 없음",
          value: fmt(fz, 3),
          unit: "mm/tooth",
          note: "현재값은 simulator default.",
          warn: true,
        },
      ]

  // ── RPM chain ──
  const rpmFromSfm = D > 0 ? (3.82 * sfmChain.s5) / (D / 25.4) : 0
  const rpmSteps: StepProps[] = [
    {
      icon: <Database className="w-3.5 h-3.5 text-sky-600" />,
      label: "최종 SFM (위 체인 결과)",
      value: fmt(sfmChain.s5, 0),
      unit: "sfm",
      dim: true,
    },
    {
      label: "공구경 D",
      value: fmt(D, 2),
      unit: "mm",
      note: educationOpen ? `= ${fmt(D / 25.4, 4)} inch` : undefined,
      dim: true,
    },
    {
      label: "RPM 공식",
      formula: "n = 3.82 × SFM / D(inch)",
      value: fmt(rpmFromSfm, 0),
      unit: "rpm",
      note: educationOpen
        ? `= 3.82 × ${fmt(sfmChain.s5, 0)} / ${fmt(D / 25.4, 4)} = ${fmt(rpmFromSfm, 0)} rpm (공식 근사)`
        : undefined,
    },
    {
      label: "최종 n (simulator 계산)",
      formula: "n = 1000·Vc / (π·D)",
      value: fmt(n, 0),
      unit: "rpm",
      note: educationOpen
        ? `metric 식 = 1000·${fmt(Vc, 0)} / (π·${fmt(D, 2)}) = ${fmt(n, 0)} rpm`
        : undefined,
    },
  ]

  // ── IPM chain (table feed) ──
  const ipmSteps: StepProps[] = [
    {
      label: "fz × Z × n",
      formula: "Vf = fz · Z · n",
      value: fmt(Vf, 0),
      unit: "mm/min",
      note: educationOpen
        ? `= ${fmt(fz, 3)} · ${Z} · ${fmt(n, 0)} = ${fmt(Vf, 0)} mm/min`
        : undefined,
    },
    {
      label: "IPM 환산",
      formula: "IPM = Vf / 25.4",
      value: fmt(Vf / 25.4, 1),
      unit: "in/min",
      dim: true,
    },
  ]

  return (
    <div className={["space-y-3", className ?? ""].join(" ")}>
      {/* 헤더 */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <BookOpen className="w-4 h-4 text-sky-600 dark:text-sky-400" />
          <h3 className="text-[14px] font-bold text-slate-800 dark:text-slate-100">값의 출처 (Provenance)</h3>
          <FeatureExplainer featureId="provenance" inline />
        </div>
        <div className="flex items-center gap-2">
          <span className={["text-[11px] px-1.5 py-0.5 rounded", srcStyle.bg, srcStyle.fg].join(" ")}>
            {srcStyle.label}
          </span>
          {bConf > 0 && (
            <span className="text-[11px] font-mono text-amber-600">{starLabel(bConf)}</span>
          )}
        </div>
      </div>

      {/* baseline source 링크/경고 */}
      {hasBaseline && bRef && (
        <div className="text-[11px] text-slate-600 dark:text-slate-300 px-2 py-1.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded flex items-start gap-1.5">
          <Info className="w-3.5 h-3.5 mt-0.5 text-slate-400 dark:text-slate-500 flex-shrink-0" />
          <div className="min-w-0 break-all">
            {bRef.startsWith("http") ? (
              <a
                href={bRef}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sky-700 underline hover:text-sky-900"
              >
                {bRef}
              </a>
            ) : (
              <span className={bRef.includes("⚠") ? "text-amber-700" : ""}>{bRef}</span>
            )}
          </div>
        </div>
      )}

      {/* SFM chain */}
      <Chain
        title="SFM / Vc 체인"
        final={fmt(Vc, 0)}
        unit="m/min"
        confidence={bConf}
        steps={sfmSteps}
        educationOpen={educationOpen}
      />

      {/* IPT chain */}
      <Chain
        title="IPT / fz 체인"
        final={fmt(fz, 3)}
        unit="mm/tooth"
        confidence={bConf}
        steps={iptSteps}
        educationOpen={educationOpen}
      />

      {/* RPM chain */}
      <Chain
        title="RPM (n) 유도"
        final={fmt(n, 0)}
        unit="rpm"
        confidence={0}
        steps={rpmSteps}
        educationOpen={educationOpen}
      />

      {/* IPM chain */}
      <Chain
        title="IPM / Vf 유도"
        final={fmt(Vf, 0)}
        unit="mm/min"
        confidence={0}
        steps={ipmSteps}
        educationOpen={educationOpen}
      />

      {/* 교육 모드 안내 */}
      {educationOpen && (
        <div className="text-[11px] text-slate-600 dark:text-slate-300 px-3 py-2 bg-sky-50 border border-sky-200 rounded leading-relaxed">
          <strong className="text-sky-800">교육 모드 </strong>
          각 체인의 단계별 수식을 펼쳐 확인하세요. baseline 은 카탈로그 PDF 값, 각 단계 배수는
          쿨런트/코팅/경도/L-D ratio 보정을 누적 적용합니다. <code>★★★★★</code> 는 PDF 검증,
          <code>★★☆☆☆</code> 이하는 추정값입니다.
          {typeof kc === "number" && (
            <div className="mt-1 font-mono text-slate-500 dark:text-slate-400">
              참고: kc = {fmt(kc, 0)} N/mm² (재질별 비절삭저항)
            </div>
          )}
        </div>
      )}

      {/* baseline 없음 경고 */}
      {!hasBaseline && (
        <div className="text-[12px] text-amber-800 px-3 py-2 bg-amber-50 border border-amber-300 rounded">
          <strong>⚠ baseline 미매칭.</strong> Tool # 을 입력하거나 /api/simulator/speeds-feeds 응답을
          확인하세요. 현재 표시 값은 cutting-calculator 기본값입니다.
        </div>
      )}
    </div>
  )
}
