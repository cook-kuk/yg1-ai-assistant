"use client"

// Harvey 스타일: 공구가 일감(블록) 안에서 절삭 중인 모습 SVG
// engagement 영역을 녹색으로 하이라이트

interface CuttingActionProps {
  shape: "square" | "ball" | "radius" | "chamfer"
  D: number
  LOC: number
  ap: number
  ae: number
  toolPath: string  // full-slotting, side-milling, etc.
  className?: string
}

export function CuttingAction({ shape, D, LOC, ap, ae, toolPath, className }: CuttingActionProps) {
  const W = 200
  const H = 260
  const scale = 40 / Math.max(D, 1)
  const dPx = D * scale
  const locPx = Math.min(LOC * scale, H * 0.5)
  const apPx = Math.min(ap * scale, locPx)
  const aePx = Math.min(ae * scale, dPx)

  const blockW = 120
  const blockH = 100
  const blockX = (W - blockW) / 2
  const blockY = H - blockH - 30

  const toolCx = W / 2
  const toolTop = 20
  const toolBottom = blockY + apPx
  const shankW = dPx * 0.6

  // engagement shown as green overlay where tool meets block
  const isSlotting = toolPath === "full-slotting" || toolPath === "slotting"
  const engagementX = toolCx - (isSlotting ? dPx / 2 : aePx / 2 - dPx / 2)
  const engagementW = isSlotting ? dPx : aePx

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className={className} role="img" aria-label="cutting action">
      {/* 일감 (워크피스) */}
      <rect x={blockX} y={blockY} width={blockW} height={blockH}
        fill="#e5e7eb" stroke="#6b7280" strokeWidth={1} />
      {/* 일감 해칭 */}
      {[0, 1, 2, 3, 4, 5, 6, 7].map(i => (
        <line key={i} x1={blockX + i * 15} y1={blockY + blockH}
          x2={blockX + i * 15 - 10} y2={blockY + blockH + 8}
          stroke="#9ca3af" strokeWidth={0.5} />
      ))}

      {/* 공구 홀더/척 */}
      <rect x={toolCx - dPx} y={toolTop - 5} width={dPx * 2} height={15}
        fill="#64748b" stroke="#334155" strokeWidth={0.5} />

      {/* 공구 섕크 */}
      <rect x={toolCx - shankW / 2} y={toolTop + 10}
        width={shankW} height={toolBottom - toolTop - 10 - locPx + 2}
        fill="#9ca3af" stroke="#4b5563" strokeWidth={0.5} />

      {/* 공구 절삭부 (LOC) */}
      <rect x={toolCx - dPx / 2} y={toolBottom - locPx}
        width={dPx} height={locPx}
        fill="#cbd5e1" stroke="#334155" strokeWidth={0.7} />

      {/* Flute 나선 */}
      {[0, 1, 2, 3].map(i => (
        <path key={i} d={`M ${toolCx - dPx / 2 + i * dPx / 4} ${toolBottom - locPx + 2}
          L ${toolCx - dPx / 2 + i * dPx / 4 - 4} ${toolBottom - 2}`}
          stroke="#475569" strokeWidth={0.4} fill="none" opacity={0.7} />
      ))}

      {/* 공구 팁 형상 */}
      {shape === "ball" && (
        <path d={`M ${toolCx - dPx / 2} ${toolBottom}
          A ${dPx / 2} ${dPx / 2} 0 0 0 ${toolCx + dPx / 2} ${toolBottom}`}
          fill="#cbd5e1" stroke="#334155" strokeWidth={0.7} />
      )}
      {shape === "chamfer" && (
        <path d={`M ${toolCx - dPx / 2} ${toolBottom - 8}
          L ${toolCx} ${toolBottom} L ${toolCx + dPx / 2} ${toolBottom - 8}`}
          fill="#cbd5e1" stroke="#334155" strokeWidth={0.7} />
      )}

      {/* Engagement 녹색 영역 (절삭 중인 부분) */}
      <rect x={engagementX} y={blockY}
        width={engagementW} height={apPx}
        fill="#10b981" fillOpacity={0.35}
        stroke="#059669" strokeWidth={1} strokeDasharray="2 2" />

      {/* 절삭 칩 표현 (3개 작은 스파이럴) */}
      {[-1, 0, 1].map(i => (
        <path key={i}
          d={`M ${toolCx + i * 8} ${blockY - 4}
              q -2 -4, -4 -6 q 4 -2, 2 -6`}
          stroke="#eab308" strokeWidth={1.5} fill="none" />
      ))}

      {/* 치수 라벨 */}
      <text x={blockX - 4} y={blockY + apPx / 2} textAnchor="end" fontSize={9} fill="#dc2626" fontWeight="bold">ap={ap.toFixed(1)}</text>
      <text x={toolCx} y={blockY + blockH + 18} textAnchor="middle" fontSize={9} fill="#dc2626" fontWeight="bold">ae={ae.toFixed(1)}mm</text>
      <text x={W - 4} y={toolBottom - locPx / 2} textAnchor="end" fontSize={8} fill="#6b7280">⌀{D.toFixed(1)}</text>

      {/* Feed 방향 화살표 */}
      <line x1={blockX + blockW + 5} y1={blockY + apPx / 2}
        x2={blockX + blockW + 25} y2={blockY + apPx / 2}
        stroke="#2563eb" strokeWidth={1.5} markerEnd="url(#arrow)" />
      <defs>
        <marker id="arrow" viewBox="0 0 10 10" refX="10" refY="5" markerWidth="6" markerHeight="6" orient="auto">
          <path d="M 0 0 L 10 5 L 0 10 Z" fill="#2563eb" />
        </marker>
      </defs>
      <text x={blockX + blockW + 30} y={blockY + apPx / 2 + 3} fontSize={8} fill="#2563eb">Feed</text>

      {/* 스핀들 회전 방향 */}
      <text x={toolCx} y={toolTop - 10} textAnchor="middle" fontSize={10} fill="#2563eb">↻ n</text>
    </svg>
  )
}
