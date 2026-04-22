// SPDX-License-Identifier: MIT
// YG-1 ARIA Simulator v2 — Tool Path Ghost Trail
//
// 최근 공구 팁 위치 히스토리를 페이드 아웃되는 선분으로 그려주는 R3F 컴포넌트.
//   - drei <Line> (Line2 기반) 사용 → per-vertex RGBA 로 오래된 segment 일수록 투명해짐
//   - positions 배열이 바뀔 때마다 memoized point/color 배열을 재생성
//   - bufferGeometry 는 drei 가 내부에서 LineGeometry 로 관리 (동적 업데이트)
//
// 독립 모듈 — cutting-simulator-v2.tsx 에서 <ToolPathTrail /> 으로 주입된다.
"use client"

import { memo, useMemo } from "react"
import { Color } from "three"
import { Line } from "@react-three/drei"

export interface ToolPathTrailProps {
  /** 공구 팁 위치 히스토리. index 0 이 가장 오래된 것, 마지막이 최신. */
  positions: Array<[number, number, number]>
  /** 렌더 할 최대 세그먼트 수 (default 200). */
  maxSegments?: number
  /** trail 색상 (default indigo-500). */
  color?: string
}

const MIN_OPACITY = 0.1
const MAX_OPACITY = 1.0

/**
 * <ToolPathTrail>
 *
 *   positions 배열의 latest 끝에서 maxSegments+1 개 point 를 잘라 <Line> 으로 렌더한다.
 *   각 vertex 에 RGBA 를 주어, 가장 오래된 vertex 는 alpha=0.1, 가장 최신은 alpha=1.0
 *   으로 선형 보간. drei <Line> 은 itemSize=4 일 때 자동으로 transparent=true 를 설정한다.
 */
function ToolPathTrailInner({
  positions,
  maxSegments = 200,
  color = "#6366f1",
}: ToolPathTrailProps) {
  const { points, vertexColors } = useMemo(() => {
    // Line2 는 최소 2 point 필요. 없으면 dummy 2-point zero-length 선을 반환하고
    // 아래 렌더 단에서 null 로 걸러낸다.
    if (!positions || positions.length < 2) {
      return { points: null, vertexColors: null }
    }
    const total = Math.min(positions.length, maxSegments + 1)
    const start = positions.length - total
    const slice = positions.slice(start)

    const base = new Color(color)
    const r = base.r
    const g = base.g
    const b = base.b

    const pts: Array<[number, number, number]> = new Array(total)
    const cols: Array<[number, number, number, number]> = new Array(total)
    for (let i = 0; i < total; i++) {
      const p = slice[i]
      pts[i] = [p[0], p[1], p[2]]
      // i=0 → oldest → MIN_OPACITY, i=total-1 → newest → MAX_OPACITY
      const t = total === 1 ? 1 : i / (total - 1)
      const alpha = MIN_OPACITY + (MAX_OPACITY - MIN_OPACITY) * t
      cols[i] = [r, g, b, alpha]
    }
    return { points: pts, vertexColors: cols }
  }, [positions, maxSegments, color])

  if (!points || !vertexColors) return null

  return (
    <Line
      points={points}
      vertexColors={vertexColors}
      lineWidth={1.6}
      // drei 는 vertexColors itemSize=4 일 때 자동으로 transparent=true 를 세팅한다.
      // depthWrite 는 끔 — trail 이 뒤쪽 지오메트리를 가리지 않도록.
      depthWrite={false}
    />
  )
}

export const ToolPathTrail = memo(ToolPathTrailInner)
export default ToolPathTrail
