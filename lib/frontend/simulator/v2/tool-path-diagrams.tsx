"use client"

export function ToolPathDiagram({ pathKey, className }: { pathKey: string; className?: string }) {
  const S = 100
  const stroke = "currentColor"
  const props = { fill: "none", stroke, strokeWidth: 1.5, strokeLinecap: "round" as const, strokeLinejoin: "round" as const }

  switch (pathKey) {
    case "conventional":
      return (
        <svg viewBox={`0 0 ${S} ${S}`} className={className}>
          <rect x={10} y={25} width={80} height={50} fill="#e5e7eb" stroke="#9ca3af" />
          <path d="M 10 50 L 90 50" {...props} stroke="#3b82f6" />
          <circle cx={90} cy={50} r={3} fill="#3b82f6" />
        </svg>
      )
    case "hem":
      return (
        <svg viewBox={`0 0 ${S} ${S}`} className={className}>
          <rect x={10} y={15} width={80} height={70} fill="#e5e7eb" stroke="#9ca3af" />
          <path d="M 15 20 L 25 20 L 25 80 L 35 80 L 35 20 L 45 20 L 45 80 L 55 80 L 55 20 L 65 20 L 65 80 L 75 80 L 75 20 L 85 20" {...props} stroke="#10b981" />
        </svg>
      )
    case "trochoidal":
      return (
        <svg viewBox={`0 0 ${S} ${S}`} className={className}>
          <rect x={10} y={30} width={80} height={40} fill="#e5e7eb" stroke="#9ca3af" />
          <path d="M 15 50 Q 20 30 25 50 Q 30 70 35 50 Q 40 30 45 50 Q 50 70 55 50 Q 60 30 65 50 Q 70 70 75 50 Q 80 30 85 50" {...props} stroke="#8b5cf6" />
        </svg>
      )
    case "adaptive":
      return (
        <svg viewBox={`0 0 ${S} ${S}`} className={className}>
          <path d="M 50 50 m -35 0 a 35 35 0 1 0 70 0 a 35 35 0 1 0 -70 0" fill="#e5e7eb" stroke="#9ca3af" />
          <path d="M 50 50 m -30 0 a 30 30 0 1 0 60 0 a 30 30 0 1 0 -60 0" {...props} stroke="#f59e0b" />
          <path d="M 50 50 m -22 0 a 22 22 0 1 0 44 0 a 22 22 0 1 0 -44 0" {...props} stroke="#f59e0b" />
          <path d="M 50 50 m -14 0 a 14 14 0 1 0 28 0 a 14 14 0 1 0 -28 0" {...props} stroke="#f59e0b" />
        </svg>
      )
    case "dynamic":
      return (
        <svg viewBox={`0 0 ${S} ${S}`} className={className}>
          <rect x={10} y={20} width={80} height={60} fill="#e5e7eb" stroke="#9ca3af" />
          <path d="M 15 50 C 25 25, 35 75, 45 50 C 55 25, 65 75, 75 50 C 85 25, 90 65, 90 50" {...props} stroke="#ec4899" />
        </svg>
      )
    case "plunge":
      return (
        <svg viewBox={`0 0 ${S} ${S}`} className={className}>
          <rect x={10} y={20} width={80} height={60} fill="#e5e7eb" stroke="#9ca3af" />
          <path d="M 30 20 L 30 70 M 50 20 L 50 70 M 70 20 L 70 70" {...props} stroke="#ef4444" strokeWidth={2} />
          <path d="M 27 67 L 30 70 L 33 67 M 47 67 L 50 70 L 53 67 M 67 67 L 70 70 L 73 67" {...props} stroke="#ef4444" strokeWidth={2} />
        </svg>
      )
    case "ramping":
      return (
        <svg viewBox={`0 0 ${S} ${S}`} className={className}>
          <rect x={10} y={20} width={80} height={60} fill="#e5e7eb" stroke="#9ca3af" />
          <path d="M 15 25 L 85 75" {...props} stroke="#14b8a6" strokeWidth={2} />
          <path d="M 82 72 L 85 75 L 82 78" {...props} stroke="#14b8a6" strokeWidth={2} />
        </svg>
      )
    case "helical":
      return (
        <svg viewBox={`0 0 ${S} ${S}`} className={className}>
          <path d="M 50 50 m -30 0 a 30 30 0 1 0 60 0 a 30 30 0 1 0 -60 0" fill="#e5e7eb" stroke="#9ca3af" />
          <path d="M 50 25 C 75 35, 75 50, 50 60 C 25 70, 25 85, 50 95" {...props} stroke="#6366f1" />
        </svg>
      )
    default:
      return (
        <svg viewBox={`0 0 ${S} ${S}`} className={className}>
          <rect x={20} y={20} width={60} height={60} fill="#e5e7eb" stroke="#9ca3af" strokeDasharray="2 2" />
          <text x={50} y={55} textAnchor="middle" fontSize={20} fill="#9ca3af">?</text>
        </svg>
      )
  }
}
