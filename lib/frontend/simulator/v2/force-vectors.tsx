// SPDX-License-Identifier: MIT
// YG-1 ARIA Simulator v2 — Force Vector Overlay (R3F)
//
// 공구 팁에 작용하는 3방향 절삭력(Fx/Fy/Fz)을 Kienzle 모델의 단순화 버전으로
// 추정하여 3D 씬 안에 화살표 + 크기 레이블로 렌더링한다.
//
// Kienzle(단순화):
//   A  = ap · fz                         (mm², 단일 치당 chip area)
//   Ft = ks · A                          (N,   주 접선력)
//   Fx ≈ 0.7 · Ft (feed 방향, +X)
//   Fy ≈ 0.3 · Ft (반경 방향, +Y)
//   Fz ≈ 0.2 · Ft (축 방향,  -Y, stock 아래로 밀어넣음)
//
// 독립 모듈 — cutting-simulator-v2.tsx 의 voxelStockSlot 에 다른 overlay
// (VoxelStock / ToolPathTrail) 와 나란히 주입된다.
"use client"

import { memo, useMemo } from "react"
import { Quaternion, Vector3 } from "three"
import { Line, Text } from "@react-three/drei"

export interface ForceVectorsProps {
  /** 월드 좌표계 공구 팁 위치 (mm). */
  toolPosition: [number, number, number]
  /** 축 방향 절삭 깊이 (mm). */
  ap: number
  /** 치당 이송량 (mm/tooth). */
  fz: number
  /** 공구 직경 (mm) — 레이블 오프셋/스케일링 참고용. */
  diameter: number
  /**
   * 비절삭력 계수 (N/mm²). Kienzle 단순화 모델의 ks.
   * default: 2000 — 일반강 ks1.1 범위의 대표값.
   */
  ks?: number
  /** false 시 렌더 안 함. default true. */
  enabled?: boolean
}

// 화살표 색상 — tailwind red-500 / emerald-500 / blue-500
const COLOR_FX = "#ef4444"
const COLOR_FY = "#10b981"
const COLOR_FZ = "#3b82f6"

// 화살촉 cone 비율 (length 대비 head length/radius).
const HEAD_LEN_RATIO = 0.22
const HEAD_RADIUS_RATIO = 0.08

/** 화살표 하나 — Line (샤프트) + cone (화살촉) + Text (크기 레이블). */
function ForceArrow({
  origin,
  direction,
  length,
  color,
  label,
  diameter,
}: {
  origin: Vector3
  direction: Vector3
  length: number
  color: string
  label: string
  diameter: number
}) {
  const dirN = useMemo(() => direction.clone().normalize(), [direction])
  const shaftEnd = useMemo(
    () => origin.clone().add(dirN.clone().multiplyScalar(length * (1 - HEAD_LEN_RATIO))),
    [origin, dirN, length],
  )
  const tip = useMemo(
    () => origin.clone().add(dirN.clone().multiplyScalar(length)),
    [origin, dirN, length],
  )
  const headHeight = length * HEAD_LEN_RATIO
  const headRadius = Math.max(0.3, length * HEAD_RADIUS_RATIO)
  // cone 의 로컬 축은 +Y. dirN 으로 정렬하기 위해 +Y → dirN quaternion 을 구한다.
  const quat = useMemo(() => {
    const up = new Vector3(0, 1, 0)
    const q = new Quaternion()
    q.setFromUnitVectors(up, dirN)
    return q
  }, [dirN])

  // 레이블은 tip 에서 한 번 더 밀어놓아 화살촉과 겹치지 않게.
  const labelPos = useMemo(
    () => tip.clone().add(dirN.clone().multiplyScalar(Math.max(1.5, diameter * 0.15))),
    [tip, dirN, diameter],
  )

  // cone 의 기준점은 중심이므로 shaftEnd 와 tip 사이 중앙에 배치.
  const coneCenter = useMemo(
    () => shaftEnd.clone().add(tip).multiplyScalar(0.5),
    [shaftEnd, tip],
  )

  return (
    <group>
      <Line
        points={[
          [origin.x, origin.y, origin.z],
          [shaftEnd.x, shaftEnd.y, shaftEnd.z],
        ]}
        color={color}
        lineWidth={2.4}
        depthWrite={false}
      />
      <mesh position={coneCenter.toArray()} quaternion={quat.toArray() as [number, number, number, number]}>
        <coneGeometry args={[headRadius, headHeight, 16]} />
        <meshBasicMaterial color={color} />
      </mesh>
      <Text
        position={labelPos.toArray()}
        fontSize={Math.max(1.2, diameter * 0.18)}
        color={color}
        anchorX="center"
        anchorY="middle"
        outlineWidth={0.08}
        outlineColor="#0f172a"
      >
        {label}
      </Text>
    </group>
  )
}

/**
 * <ForceVectors>
 *
 * Kienzle 단순화 모델로 계산한 Fx/Fy/Fz 를 3개의 화살표로 렌더.
 * memoize — toolPosition / ap / fz / diameter / ks / enabled 가 바뀔 때만 재계산.
 */
function ForceVectorsInner({
  toolPosition,
  ap,
  fz,
  diameter,
  ks = 2000,
  enabled = true,
}: ForceVectorsProps) {
  const vectors = useMemo(() => {
    const apSafe = Math.max(0, Number.isFinite(ap) ? ap : 0)
    const fzSafe = Math.max(0, Number.isFinite(fz) ? fz : 0)
    const ksSafe = Math.max(0, Number.isFinite(ks) ? ks : 0)
    const A = apSafe * fzSafe
    const Ft = ksSafe * A
    const Fx = 0.7 * Ft
    const Fy = 0.3 * Ft
    const Fz = 0.2 * Ft
    // 길이: 3 ~ 43mm 사이로 클램프. Ft/20 mm 정도 스케일.
    const len = 3 + Math.min(Ft / 20, 40)
    return { Ft, Fx, Fy, Fz, len }
  }, [ap, fz, ks])

  const origin = useMemo(
    () => new Vector3(toolPosition[0], toolPosition[1], toolPosition[2]),
    [toolPosition],
  )

  const dirX = useMemo(() => new Vector3(1, 0, 0), [])
  const dirY = useMemo(() => new Vector3(0, 1, 0), [])
  const dirZ = useMemo(() => new Vector3(0, -1, 0), []) // stock 아래로 밀어넣는 축방향

  if (!enabled) return null

  return (
    <group>
      <ForceArrow
        origin={origin}
        direction={dirX}
        length={vectors.len}
        color={COLOR_FX}
        label={`Fx ${vectors.Fx.toFixed(0)} N`}
        diameter={diameter}
      />
      <ForceArrow
        origin={origin}
        direction={dirY}
        length={vectors.len}
        color={COLOR_FY}
        label={`Fy ${vectors.Fy.toFixed(0)} N`}
        diameter={diameter}
      />
      <ForceArrow
        origin={origin}
        direction={dirZ}
        length={vectors.len}
        color={COLOR_FZ}
        label={`Fz ${vectors.Fz.toFixed(0)} N`}
        diameter={diameter}
      />
    </group>
  )
}

export const ForceVectors = memo(ForceVectorsInner)
export default ForceVectors
