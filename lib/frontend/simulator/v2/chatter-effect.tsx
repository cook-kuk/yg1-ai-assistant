// SPDX-License-Identifier: MIT
// YG-1 ARIA Simulator v2 — Chatter / Vibration Visualizer (R3F)
//
// 절삭조건(Vc·ap·diameter) 로부터 chatter intensity 를 산출하고 공구 그룹에
// 소량의 sinusoidal 위치 오프셋(shake)을 부여한다. 경고 수준이 올라가면 공구
// 주변에 red wireframe outline + "⚠ CHATTER" floating text 가 표시된다.
//
// intensity 공식 (SSOT — 요구 사양 그대로):
//   chatter = max(0, (vc * ap / (diameter * 50)) - 1.0)
//   → 0..∞, > 1 은 severe.
//
// Side effects:
//   • toolRef (React ref, 선택) 가 주어지면 매 프레임 group.position 에
//     (sin(t·ω₁)·amp, 0, cos(t·ω₂)·amp) 오프셋 누적 — origin 은 ref 가 보존.
//   • prefers-reduced-motion 사용자에게는 shake 비활성 (outline/text 는 유지).
//   • onChatterLevel?(level) — 프레임마다 최신 intensity 를 상위로 흘려
//     sound engine / chip UI 에 라우팅 가능.
//
// 독립 모듈 — cutting-simulator-v2.tsx 의 voxelStockSlot 에 주입한다.
"use client"

import { memo, useEffect, useMemo, useRef } from "react"
import type { Group } from "three"
import { useFrame } from "@react-three/fiber"
import { Text } from "@react-three/drei"
import { usePrefersReducedMotion } from "./use-prefers-reduced-motion"

// ─────────────────────────────────────────────
// Local SSOT — 하드코딩 방지용 상수 묶음
// ─────────────────────────────────────────────
/** chatter 분모 스케일. vc·ap / (diameter · CHATTER_SCALE) */
const CHATTER_SCALE = 50
/** shake 진폭 계수 (mm per chatter unit). */
const SHAKE_AMP_PER_UNIT = 0.3
/** 기본 shake 주파수 (Hz). */
const SHAKE_FREQ_BASE_HZ = 20
/** chatter 단위당 가산되는 주파수 (Hz). */
const SHAKE_FREQ_PER_UNIT_HZ = 30
/** X축 대비 Z축 진동 주파수 비 (직교 beating). */
const Z_FREQ_RATIO = 0.83
/** outline 표시 시작 chatter 값. */
const OUTLINE_THRESHOLD = 0.5
/** "⚠ CHATTER" floating text 표시 시작 chatter 값. */
const TEXT_THRESHOLD = 1.0
/** outline 크기를 diameter 대비 비율로. */
const OUTLINE_RADIUS_RATIO = 0.65
/** outline height 를 diameter 대비 비율로. */
const OUTLINE_HEIGHT_RATIO = 1.4
/** outline 최대 opacity. */
const OUTLINE_MAX_OPACITY = 0.85

export interface ChatterEffectProps {
  /** 절삭속도 (m/min). */
  vc: number
  /** 축 방향 절삭 깊이 (mm). */
  ap: number
  /** 공구 직경 (mm). */
  diameter: number
  /** 공구 그룹 ref — 주어지면 shake 를 적용. 미제공 시 outline-only. */
  toolRef?: React.RefObject<Group | null>
  /** false 시 모든 시각화/오디오 콜백 비활성. default true. */
  enabled?: boolean
  /** chatter intensity (0..∞) 를 상위로 흘리는 콜백. 변경 시에만 invoke. */
  onChatterLevel?: (level: number) => void
}

/** chatter intensity 산식 — 단일 SSOT. */
export function computeChatterIntensity(vc: number, ap: number, diameter: number): number {
  const vcSafe = Number.isFinite(vc) ? vc : 0
  const apSafe = Number.isFinite(ap) ? ap : 0
  const dSafe = Number.isFinite(diameter) && diameter > 0 ? diameter : 1
  const raw = (vcSafe * apSafe) / (dSafe * CHATTER_SCALE) - 1.0
  return raw > 0 ? raw : 0
}

function ChatterEffectInner({
  vc,
  ap,
  diameter,
  toolRef,
  enabled = true,
  onChatterLevel,
}: ChatterEffectProps) {
  const chatter = useMemo(() => computeChatterIntensity(vc, ap, diameter), [vc, ap, diameter])
  const reducedMotion = usePrefersReducedMotion()

  // tool group 의 "원점" 저장 — shake 오프셋을 덧붙이기 전 baseline 을 기억해 둔다.
  // toolRef 가 바뀌거나 chatter 가 0 으로 떨어졌을 때 이 값으로 복구.
  const baselineRef = useRef<{ x: number; y: number; z: number } | null>(null)
  const lastReportedRef = useRef<number>(-1)

  // chatter 가 0 으로 떨어지거나 비활성화되면 tool group 을 원위치로 복구.
  useEffect(() => {
    if (!enabled || chatter <= 0) {
      const g = toolRef?.current
      const base = baselineRef.current
      if (g && base) {
        g.position.set(base.x, base.y, base.z)
      }
      baselineRef.current = null
    }
  }, [enabled, chatter, toolRef])

  useFrame(({ clock }) => {
    // 콜백 throttling — 0.01 단위 이상 변동 시에만 상위로 흘림.
    if (enabled && onChatterLevel) {
      const rounded = Math.round(chatter * 100) / 100
      if (rounded !== lastReportedRef.current) {
        lastReportedRef.current = rounded
        onChatterLevel(chatter)
      }
    }

    if (!enabled || chatter <= 0 || reducedMotion) return
    const g = toolRef?.current
    if (!g) return

    // baseline 캡처 — shake 시작 시점의 origin.
    if (!baselineRef.current) {
      baselineRef.current = { x: g.position.x, y: g.position.y, z: g.position.z }
    }
    const base = baselineRef.current
    const t = clock.getElapsedTime()
    const amp = chatter * SHAKE_AMP_PER_UNIT
    const freq = SHAKE_FREQ_BASE_HZ + chatter * SHAKE_FREQ_PER_UNIT_HZ
    const omega1 = 2 * Math.PI * freq
    const omega2 = 2 * Math.PI * freq * Z_FREQ_RATIO
    g.position.set(
      base.x + Math.sin(t * omega1) * amp,
      base.y,
      base.z + Math.cos(t * omega2) * amp,
    )
  })

  if (!enabled || chatter <= OUTLINE_THRESHOLD) return null

  // outline 의 opacity: chatter 0.5→0, 2.0→max.
  const outlineOpacity = Math.min(
    OUTLINE_MAX_OPACITY,
    ((chatter - OUTLINE_THRESHOLD) / 1.5) * OUTLINE_MAX_OPACITY,
  )
  const outlineR = Math.max(0.5, diameter * OUTLINE_RADIUS_RATIO)
  const outlineH = Math.max(1, diameter * OUTLINE_HEIGHT_RATIO)
  const showText = chatter > TEXT_THRESHOLD
  const textFontSize = Math.max(1.2, diameter * 0.24)
  const textYOffset = outlineH * 0.7 + textFontSize * 1.2

  return (
    <group>
      <mesh>
        <cylinderGeometry args={[outlineR, outlineR, outlineH, 20, 1, true]} />
        <meshBasicMaterial
          color="#ef4444"
          wireframe
          transparent
          opacity={outlineOpacity}
          depthWrite={false}
        />
      </mesh>
      {showText && (
        <Text
          position={[0, textYOffset, 0]}
          fontSize={textFontSize}
          color="#ef4444"
          anchorX="center"
          anchorY="middle"
          outlineWidth={0.1}
          outlineColor="#0f172a"
        >
          {`⚠ CHATTER ${chatter.toFixed(1)}`}
        </Text>
      )}
    </group>
  )
}

export const ChatterEffect = memo(ChatterEffectInner)
export default ChatterEffect
