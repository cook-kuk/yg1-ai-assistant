"use client"

import { useMemo } from "react"
import { estimateToolLifeMin } from "../cutting-calculator"

interface TaylorCurveProps {
  currentVc: number
  VcReference: number
  coatingMult: number
  isoGroup: string
  toolMaterialE: number
  className?: string
}

// Mini Vc-vs-Life log curve with current point highlighted
export function TaylorCurve({ currentVc, VcReference, coatingMult, isoGroup, toolMaterialE, className }: TaylorCurveProps) {
  const W = 260, H = 140
  const padL = 36, padR = 8, padT = 10, padB = 22

  const samples = useMemo(() => {
    const minVc = Math.max(10, VcReference * 0.3)
    const maxVc = VcReference * 2.0
    const pts: Array<{ Vc: number; life: number }> = []
    for (let i = 0; i <= 30; i++) {
      const Vc = minVc + (maxVc - minVc) * (i / 30)
      const life = estimateToolLifeMin({ Vc, VcReference, coatingMult, isoGroup, toolMaterialE })
      pts.push({ Vc, life })
    }
    return pts
  }, [VcReference, coatingMult, isoGroup, toolMaterialE])

  if (samples.length === 0) return null

  const minVc = samples[0].Vc
  const maxVc = samples[samples.length - 1].Vc
  const minLife = Math.min(...samples.map(s => s.life))
  const maxLife = Math.max(...samples.map(s => s.life))

  const plotW = W - padL - padR
  const plotH = H - padT - padB

  const logMin = Math.log10(Math.max(0.5, minLife))
  const logMax = Math.log10(maxLife)

  const xOf = (Vc: number) => padL + ((Vc - minVc) / (maxVc - minVc)) * plotW
  const yOf = (life: number) => {
    const l = Math.log10(Math.max(0.5, life))
    return padT + plotH - ((l - logMin) / Math.max(0.001, logMax - logMin)) * plotH
  }

  const path = samples.map((s, i) => `${i === 0 ? "M" : "L"} ${xOf(s.Vc).toFixed(1)} ${yOf(s.life).toFixed(1)}`).join(" ")

  const currentLife = estimateToolLifeMin({ Vc: currentVc, VcReference, coatingMult, isoGroup, toolMaterialE })
  const cx = xOf(Math.min(maxVc, Math.max(minVc, currentVc)))
  const cy = yOf(currentLife)

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className={className}>
      {/* Axes */}
      <line x1={padL} y1={padT} x2={padL} y2={padT + plotH} stroke="#9ca3af" strokeWidth={0.5} />
      <line x1={padL} y1={padT + plotH} x2={padL + plotW} y2={padT + plotH} stroke="#9ca3af" strokeWidth={0.5} />
      {/* Reference Vc marker */}
      <line x1={xOf(VcReference)} y1={padT} x2={xOf(VcReference)} y2={padT + plotH}
        stroke="#10b981" strokeWidth={0.6} strokeDasharray="2 2" opacity={0.6} />
      {/* Curve */}
      <path d={path} fill="none" stroke="#3b82f6" strokeWidth={1.5} />
      {/* Current point */}
      <circle cx={cx} cy={cy} r={4} fill="#ef4444" stroke="white" strokeWidth={1.5} />
      {/* Labels */}
      <text x={padL - 4} y={padT + 4} textAnchor="end" fontSize={8} fill="#6b7280">{maxLife.toFixed(0)}min</text>
      <text x={padL - 4} y={padT + plotH} textAnchor="end" fontSize={8} fill="#6b7280">{minLife.toFixed(0)}</text>
      <text x={padL} y={H - 4} textAnchor="start" fontSize={8} fill="#6b7280">{minVc.toFixed(0)}</text>
      <text x={padL + plotW} y={H - 4} textAnchor="end" fontSize={8} fill="#6b7280">{maxVc.toFixed(0)} m/min</text>
      <text x={xOf(VcReference)} y={padT + 8} textAnchor="middle" fontSize={7} fill="#059669">Rec</text>
      <text x={cx} y={cy - 8} textAnchor="middle" fontSize={9} fill="#dc2626" fontWeight="bold">현재 {currentLife.toFixed(0)}m</text>
      <text x={W / 2} y={8} textAnchor="middle" fontSize={8} fill="#374151" fontWeight="bold">Taylor 수명곡선</text>
    </svg>
  )
}
