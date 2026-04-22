// SPDX-License-Identifier: MIT
// YG-1 ARIA Simulator v3 — STEP 5-4 Workholding Security Slider
// 기존 단순 슬라이더 → 그라데이션 배경 + 한계 배지 + 초과 시 붉은 펄스 애니메이션.
"use client"

import { useMemo } from "react"
import { Shield, AlertTriangle, Info } from "lucide-react"
import { workholdingCap } from "../cutting-calculator"
import { useEducation } from "./education-context"

interface Props {
  value: number
  onChange: (v: number) => void
  D: number
  currentAp: number
  currentAe: number
  educationMode?: boolean
}

// 등급 레이블 (고정값 임계치로 분류)
function classify(v: number): { label: string; tone: string; emoji: string } {
  if (v < 25) return { label: "LOOSE (느슨)", tone: "text-red-700 dark:text-red-400", emoji: "⚠" }
  if (v < 50) return { label: "LIGHT (경)", tone: "text-orange-700 dark:text-orange-400", emoji: "○" }
  if (v < 75) return { label: "FIRM (보통)", tone: "text-yellow-700 dark:text-yellow-400", emoji: "◐" }
  if (v < 90) return { label: "SOLID (견고)", tone: "text-emerald-700 dark:text-emerald-400", emoji: "●" }
  return { label: "RIGID (강체)", tone: "text-emerald-800 dark:text-emerald-300", emoji: "✦" }
}

export function WorkholdingSlider(props: Props) {
  const { value, onChange, D, currentAp, currentAe, educationMode } = props
  const eduCtx = useEducation()
  const eduOn = educationMode ?? eduCtx.enabled

  // ── 한계 계산 ──────────────────────────────────────────────
  const cap = useMemo(() => workholdingCap(value, D), [value, D])

  const apOver = currentAp > cap.apMax
  const aeOver = currentAe > cap.aeMax
  const anyOver = apOver || aeOver

  const info = classify(value)

  return (
    <div className="space-y-2">
      {/* ── 헤더 ────────────────────────────────────────────── */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-1.5">
          <Shield className={`h-3.5 w-3.5 ${anyOver ? "text-red-600" : "text-blue-600"}`} />
          <label className="text-[11px] font-semibold text-gray-700 dark:text-gray-200">
            Workholding 강성
          </label>
        </div>
        <div className="flex items-center gap-1.5">
          <span className={`text-[10px] font-bold ${info.tone}`}>
            {info.emoji} {info.label}
          </span>
          <span className="font-mono text-xs font-bold text-blue-700 dark:text-blue-300">
            {value}%
          </span>
        </div>
      </div>

      {/* ── 그라데이션 슬라이더 ─────────────────────────────── */}
      <div className={`relative rounded-md p-1.5 ${anyOver ? "wh-pulse" : ""}`}>
        {/* 배경 그라데이션 */}
        <div
          className="absolute inset-0 rounded-md pointer-events-none"
          style={{
            background:
              "linear-gradient(to right, #fecaca 0%, #fca5a5 15%, #fef08a 45%, #bef264 65%, #86efac 85%, #22c55e 100%)",
            opacity: anyOver ? 0.55 : 0.35,
          }}
        />
        {/* 눈금 레이블 */}
        <div className="relative flex justify-between text-[8px] font-semibold text-gray-600 dark:text-gray-300 px-1">
          <span>LOOSE 0</span>
          <span>50</span>
          <span>RIGID 100</span>
        </div>
        {/* 실제 range input */}
        <input
          type="range"
          min={0}
          max={100}
          step={5}
          value={value}
          onChange={(e) => onChange(parseInt(e.target.value))}
          aria-label="Workholding 강성"
          className="relative w-full mt-0.5 accent-blue-700 cursor-pointer"
        />
      </div>

      {/* ── 한계 배지 ───────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-2">
        <div
          className={`rounded px-2 py-1 text-[10px] font-mono border ${
            apOver
              ? "border-red-400 bg-red-50 text-red-900 dark:bg-red-900/30 dark:text-red-200 dark:border-red-700"
              : "border-gray-200 bg-gray-50 text-gray-700 dark:bg-gray-800 dark:text-gray-200 dark:border-gray-700"
          }`}
        >
          <div className="text-[9px] uppercase tracking-wide opacity-70">ap 한계</div>
          <div className="font-bold">
            {currentAp.toFixed(2)} / ≤ {cap.apMax.toFixed(2)} mm
          </div>
          <div className="text-[9px] opacity-80">
            {apOver ? "✗ 초과" : "✓ OK"} ({(cap.apMax / D).toFixed(2)}·D)
          </div>
        </div>
        <div
          className={`rounded px-2 py-1 text-[10px] font-mono border ${
            aeOver
              ? "border-red-400 bg-red-50 text-red-900 dark:bg-red-900/30 dark:text-red-200 dark:border-red-700"
              : "border-gray-200 bg-gray-50 text-gray-700 dark:bg-gray-800 dark:text-gray-200 dark:border-gray-700"
          }`}
        >
          <div className="text-[9px] uppercase tracking-wide opacity-70">ae 한계</div>
          <div className="font-bold">
            {currentAe.toFixed(2)} / ≤ {cap.aeMax.toFixed(2)} mm
          </div>
          <div className="text-[9px] opacity-80">
            {aeOver ? "✗ 초과" : "✓ OK"} ({(cap.aeMax / D).toFixed(2)}·D)
          </div>
        </div>
      </div>

      {/* ── 경고 ───────────────────────────────────────────── */}
      {anyOver && (
        <div className="rounded-md border border-red-300 dark:border-red-700 bg-red-50 dark:bg-red-900/30 px-2 py-1.5 text-[10px] text-red-900 dark:text-red-200 flex items-start gap-1.5">
          <AlertTriangle className="h-3 w-3 mt-0.5 flex-shrink-0" />
          <div>
            <b>현재 조건이 Workholding 한계 초과</b>
            {apOver && (
              <div>
                · ap {currentAp.toFixed(2)}mm &gt; 허용 {cap.apMax.toFixed(2)}mm — 고정 강성을 올리거나 ap를 줄이세요.
              </div>
            )}
            {aeOver && (
              <div>
                · ae {currentAe.toFixed(2)}mm &gt; 허용 {cap.aeMax.toFixed(2)}mm — 고정 강성을 올리거나 ae를 줄이세요.
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── 교육 모드 해설 ─────────────────────────────────── */}
      {eduOn && (
        <div className="rounded-md border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-900/20 px-2 py-1.5 text-[10px] text-blue-900 dark:text-blue-200 flex items-start gap-1.5">
          <Info className="h-3 w-3 mt-0.5 flex-shrink-0" />
          <div>
            <b>Workholding Security</b> — 가공물의 고정 견고성을 0~100%로 정량화.
            Harvey MAP 기준 LOOSE(0): ap≤0.5·D · ae≤0.3·D / RIGID(100): ap≤2.0·D · ae≤1.0·D.
            고정이 약하면 ap·ae를 강제로 제한해 편향·채터를 방지합니다.
          </div>
        </div>
      )}

      {/* ── 펄스 애니메이션 keyframes (styled-jsx) ───────── */}
      <style jsx>{`
        .wh-pulse {
          animation: wh-red-pulse 1.6s ease-in-out infinite;
        }
        @keyframes wh-red-pulse {
          0%, 100% {
            box-shadow: 0 0 0 0 rgba(239, 68, 68, 0);
          }
          50% {
            box-shadow: 0 0 0 4px rgba(239, 68, 68, 0.35);
          }
        }
      `}</style>
    </div>
  )
}

export default WorkholdingSlider
