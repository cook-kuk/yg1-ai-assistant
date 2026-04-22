// SPDX-License-Identifier: MIT
// YG-1 ARIA Simulator v2 — Auto Sweep Driver
//
// 활성화 되면 useFrame 에서 시간 기반 공구 위치를 계산해 onPosition 콜백으로 흘린다.
// headless — 시각적 출력이 없으며 null 을 반환한다.
//
// 좌표 규약 (Cutting3DScene 월드 좌표):
//   x ∈ [-L/2, +L/2]      — stock 길이 방향
//   z ∈ [-W/2, +W/2]      — stock 폭 방향
//   y = stockH/2 - depth  — stock 윗면 아래 `depth` mm (공구 팁의 최저점 위치)
//
//   ※ onPosition 은 toolTipRef (cutting-simulator-v2.tsx) 가 소비하는 동일한 월드 좌표계로
//     [x, y, z] (mm) 를 전달한다.
"use client"

import { useEffect, useRef } from "react"
import { useFrame } from "@react-three/fiber"

export interface AutoSweepDriverProps {
  enabled: boolean
  /** [L (x), W (z), H (y)] mm */
  stockDimensions: [number, number, number]
  /** 공구 진행 속도 (mm/s). default 40. */
  speed?: number
  /** Stock 윗면에서의 깊이 (mm). default 2. */
  depth?: number
  /** 스윕 패턴 (default 'zigzag'). */
  pattern?: "zigzag" | "spiral"
  /** 매 프레임 최신 [x, y, z] (월드 좌표, mm). */
  onPosition: (pos: [number, number, number]) => void
}

// zigzag: 한 row 를 한 방향으로 훑고, row 끝에서 Z 방향으로 한 스텝 전진한다.
// row 간격 (= "stepover") 은 자재 폭의 일정 비율로 잡아 UI 파라미터를 늘리지 않는다.
const ZIGZAG_STEPOVER_RATIO = 0.12   // stock width 대비 12% 씩 이동
const ZIGZAG_EDGE_MARGIN = 2         // 가장자리 2mm 안쪽에서 머문다
const ZIGZAG_PULLBACK_FRACTION = 0.15 // row 전환부에서 감속/보정 구간 비율

// spiral: stock 중심에서 바깥 경계까지 간격 SPIRAL_TURN_GAP 으로 감았다 풀린다.
const SPIRAL_TURN_GAP = 4            // 회전 한 바퀴당 반경 증가 (mm)
const SPIRAL_EDGE_MARGIN = 2

/** clamp helper. */
function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v
}

/**
 * zigzag 좌표 계산.
 *   - traveled: 지금까지 누적 이동거리 (mm).
 *   - rowLen: 한 row 의 X 거리.
 *   - rowCount: 전체 row 수.
 *   - 한 row 의 길이 = rowLen + pullback (row 간 Z 전환 구간).
 *   - 총 길이 초과 시 마지막 row 유지 (경계 내 머무름).
 */
function zigzagPosition(
  traveled: number,
  L: number,
  W: number,
): { x: number; z: number } {
  const xMin = -L / 2 + ZIGZAG_EDGE_MARGIN
  const xMax = L / 2 - ZIGZAG_EDGE_MARGIN
  const zMin = -W / 2 + ZIGZAG_EDGE_MARGIN
  const zMax = W / 2 - ZIGZAG_EDGE_MARGIN
  const rowLen = Math.max(1, xMax - xMin)
  const stepover = Math.max(0.5, W * ZIGZAG_STEPOVER_RATIO)
  const pullback = rowLen * ZIGZAG_PULLBACK_FRACTION
  const segLen = rowLen + pullback
  const rowCount = Math.max(1, Math.ceil((zMax - zMin) / stepover) + 1)
  const totalLen = segLen * rowCount

  // 끝에 도달하면 되돌아서 재시작 (왕복) 하도록 traveled 를 2*total 에서 접는다.
  const cycle = 2 * totalLen
  let t = traveled % cycle
  if (t > totalLen) t = cycle - t

  const rowIdx = Math.min(rowCount - 1, Math.floor(t / segLen))
  const withinRow = t - rowIdx * segLen
  const dir = rowIdx % 2 === 0 ? 1 : -1

  let x: number
  if (withinRow <= rowLen) {
    // 본 row 진행
    const p = withinRow / rowLen
    x = dir > 0 ? xMin + p * rowLen : xMax - p * rowLen
  } else {
    // pullback — row 끝에서 잠시 머무르며 다음 row 로 넘어가는 구간
    x = dir > 0 ? xMax : xMin
  }

  const zProgress = rowCount === 1 ? 0 : rowIdx / (rowCount - 1)
  const z = zMin + zProgress * (zMax - zMin)

  return {
    x: clamp(x, xMin, xMax),
    z: clamp(z, zMin, zMax),
  }
}

/**
 * spiral (concentric) 좌표 계산.
 *   - stock 중심 (0, 0) 을 기준으로 반경이 시간과 함께 증가하는 아르키메데스 나선.
 *   - 바깥 경계에 도달하면 역방향으로 감기 시작 (왕복) → 패턴을 끊김 없이 유지.
 */
function spiralPosition(
  traveled: number,
  L: number,
  W: number,
): { x: number; z: number } {
  const maxR = Math.max(
    1,
    Math.min(L / 2 - SPIRAL_EDGE_MARGIN, W / 2 - SPIRAL_EDGE_MARGIN),
  )
  // r(θ) = a * θ, θ 한 바퀴 당 r 증가 = 2π*a = SPIRAL_TURN_GAP → a = gap/(2π)
  const a = SPIRAL_TURN_GAP / (2 * Math.PI)
  // 호 길이 근사: 나선의 실제 호 길이는 ∫√(a² + (aθ)²)dθ 이나, 시각적 sweep 용도로는
  // r 을 선형-in-traveled 로 늘리고 θ 를 r/a 에서 역산해 "등속 접선" 에 가깝게 잡는다.
  const fullSpanLen = maxR * 4 // 경험적 — 중심→외곽 편도 시간을 대략 (maxR*4)/speed 초로 둔다
  const cycle = fullSpanLen * 2
  let t = traveled % cycle
  const inward = t > fullSpanLen
  if (inward) t = cycle - t
  const r = (t / fullSpanLen) * maxR
  const theta = r / Math.max(a, 1e-6)
  const x = clamp(r * Math.cos(theta), -maxR, maxR)
  const z = clamp(r * Math.sin(theta), -maxR, maxR)
  return { x, z }
}

/**
 * <AutoSweepDriver>
 *
 *   enabled=true 면 매 프레임 시간 기반 [x, y, z] 를 계산해 onPosition 콜백으로 전달한다.
 *   headless — 자체 렌더 없음.
 */
export function AutoSweepDriver({
  enabled,
  stockDimensions,
  speed = 40,
  depth = 2,
  pattern = "zigzag",
  onPosition,
}: AutoSweepDriverProps) {
  const startedAtRef = useRef<number | null>(null)
  const onPositionRef = useRef(onPosition)

  useEffect(() => {
    onPositionRef.current = onPosition
  }, [onPosition])

  // enabled 토글 시 t=0 부터 재시작.
  useEffect(() => {
    startedAtRef.current = null
  }, [enabled, pattern, speed, depth, stockDimensions[0], stockDimensions[1], stockDimensions[2]])

  useFrame((state) => {
    if (!enabled) return
    const nowSec = state.clock.getElapsedTime()
    if (startedAtRef.current === null) startedAtRef.current = nowSec
    const elapsed = nowSec - startedAtRef.current
    const traveled = Math.max(0, elapsed * speed) // mm
    const [L, W, H] = stockDimensions

    let xz: { x: number; z: number }
    if (pattern === "spiral") {
      xz = spiralPosition(traveled, L, W)
    } else {
      xz = zigzagPosition(traveled, L, W)
    }
    // 공구 팁은 stock 윗면 아래 `depth` mm — stock 윗면은 y = H/2 (월드).
    const y = H / 2 - Math.max(0, depth)

    onPositionRef.current([xz.x, y, xz.z])
  })

  return null
}

export default AutoSweepDriver
