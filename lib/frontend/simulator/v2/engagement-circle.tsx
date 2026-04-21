"use client"

interface EngagementCircleProps {
  ae: number
  D: number
  className?: string
}

// Circular tool cross-section with engaged arc shaded
export function EngagementCircle({ ae, D, className }: EngagementCircleProps) {
  const size = 120
  const cx = size / 2
  const cy = size / 2
  const r = size / 2 - 8

  const ratio = Math.min(Math.max(ae / D, 0), 1)
  const angleRad = Math.acos(1 - 2 * ratio)
  const angleDeg = (angleRad * 180) / Math.PI
  const pct = (ratio * 100).toFixed(0)

  // Arc from left side, spanning angleDeg
  const startAngle = Math.PI - angleRad
  const endAngle = Math.PI + angleRad
  const x1 = cx + r * Math.cos(startAngle)
  const y1 = cy + r * Math.sin(startAngle)
  const x2 = cx + r * Math.cos(endAngle)
  const y2 = cy + r * Math.sin(endAngle)
  const largeArc = angleDeg > 180 ? 1 : 0
  const arcPath = `M ${cx} ${cy} L ${x1} ${y1} A ${r} ${r} 0 ${largeArc} 0 ${x2} ${y2} Z`

  return (
    <svg viewBox={`0 0 ${size} ${size}`} className={className} role="img" aria-label="engagement angle">
      <circle cx={cx} cy={cy} r={r} fill="#f3f4f6" stroke="#9ca3af" strokeWidth={1} />
      {ratio > 0 && <path d={arcPath} fill="#3b82f6" opacity={0.7} />}
      <circle cx={cx} cy={cy} r={2} fill="#111827" />
      <text x={cx} y={cy - 2} textAnchor="middle" fontSize={14} fontWeight="bold" fill="#111827">{angleDeg.toFixed(0)}°</text>
      <text x={cx} y={cy + 12} textAnchor="middle" fontSize={9} fill="#6b7280">ae/D {pct}%</text>
    </svg>
  )
}
