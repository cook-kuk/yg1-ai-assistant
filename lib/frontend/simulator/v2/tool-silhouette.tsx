"use client"

interface ToolSilhouetteProps {
  shape: "square" | "ball" | "radius" | "chamfer"
  D: number      // cutting diameter mm
  LOC: number    // length of cut mm
  OAL: number    // overall length mm
  shank: number  // shank dia mm
  CR?: number    // corner radius (for radius type)
  className?: string
}

// SVG silhouette of an endmill — vertical orientation, shank at top, cutting edge at bottom
export function ToolSilhouette({ shape, D, LOC, OAL, shank, CR, className }: ToolSilhouetteProps) {
  const W = 160
  const H = 220
  const marginY = 15
  const drawHeight = H - marginY * 2

  const maxDim = Math.max(D, shank, 1)
  const scale = 60 / maxDim // 60px for widest dim
  const dPx = D * scale
  const shankPx = shank * scale

  const totalMm = Math.max(OAL, 1)
  const locPx = (LOC / totalMm) * drawHeight
  const shankLenPx = drawHeight - locPx

  const cx = W / 2
  const topY = marginY
  const locTopY = topY + shankLenPx
  const bottomY = topY + drawHeight

  // Shank rect
  const shankLeft = cx - shankPx / 2
  const shankRight = cx + shankPx / 2
  // LOC rect
  const locLeft = cx - dPx / 2
  const locRight = cx + dPx / 2

  // Tip path based on shape
  const tipHeight = Math.min(dPx / 2, 18)
  let tipPath = ""
  if (shape === "ball") {
    tipPath = `M ${locLeft} ${bottomY} A ${dPx / 2} ${dPx / 2} 0 0 0 ${locRight} ${bottomY}`
  } else if (shape === "radius") {
    const r = Math.min(Math.max(CR ?? 0.5, 0.1), D / 2) * scale
    tipPath = `M ${locLeft} ${bottomY - r} Q ${locLeft} ${bottomY} ${locLeft + r} ${bottomY} L ${locRight - r} ${bottomY} Q ${locRight} ${bottomY} ${locRight} ${bottomY - r}`
  } else if (shape === "chamfer") {
    tipPath = `M ${locLeft} ${bottomY - tipHeight} L ${cx} ${bottomY} L ${locRight} ${bottomY - tipHeight}`
  } else {
    tipPath = `M ${locLeft} ${bottomY} L ${locRight} ${bottomY}`
  }

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className={className} role="img" aria-label={`${shape} endmill silhouette`}>
      {/* Shank */}
      <rect x={shankLeft} y={topY} width={shankPx} height={shankLenPx} fill="#9ca3af" stroke="#4b5563" strokeWidth={0.5} />
      {/* LOC body */}
      <rect x={locLeft} y={locTopY} width={dPx} height={locPx - (shape === "ball" || shape === "chamfer" ? tipHeight : 0)} fill="#e5e7eb" stroke="#374151" strokeWidth={0.5} />
      {/* Flute lines */}
      {[0.25, 0.5, 0.75].map((p, i) => (
        <line key={i} x1={locLeft + dPx * p} y1={locTopY + 2} x2={locLeft + dPx * p - 4} y2={bottomY - 4} stroke="#6b7280" strokeWidth={0.3} opacity={0.6} />
      ))}
      {/* Tip */}
      <path d={tipPath} fill={shape === "square" ? "none" : "#d1d5db"} stroke="#374151" strokeWidth={0.6} />

      {/* Dimension labels */}
      <text x={cx} y={topY - 4} textAnchor="middle" fontSize={8} fill="#4b5563">⌀{shank.toFixed(1)}</text>
      <text x={cx} y={bottomY + 10} textAnchor="middle" fontSize={8} fill="#111827" fontWeight="bold">⌀{D.toFixed(1)}mm</text>
      <text x={W - 4} y={locTopY - 2} textAnchor="end" fontSize={7} fill="#6b7280">LOC {LOC.toFixed(0)}</text>
      <text x={W - 4} y={topY + 8} textAnchor="end" fontSize={7} fill="#6b7280">OAL {OAL.toFixed(0)}</text>
    </svg>
  )
}
