"use client"

import { useState } from "react"
import { internalCornerFeed, externalCornerFeed } from "../cutting-calculator"

interface Props {
  baseFeed: number  // mm/min
  toolDiameter: number  // mm
}

// Harvey 비선형 경로 보정 공식 기반 — 내부/외부 코너 IPM 보정
export function CornerFeedPanel({ baseFeed, toolDiameter }: Props) {
  const [mode, setMode] = useState<"internal" | "external">("internal")
  const [workpieceRadius, setWorkpieceRadius] = useState(20) // OD 또는 ID (mm)

  const OD = mode === "internal" ? workpieceRadius * 2 : 0
  const ID = mode === "external" ? workpieceRadius * 2 : 0

  const adjusted = mode === "internal"
    ? internalCornerFeed(baseFeed, OD, toolDiameter)
    : externalCornerFeed(baseFeed, ID, toolDiameter)

  const pct = baseFeed > 0 ? ((adjusted / baseFeed) * 100) : 100

  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50/50 p-3 space-y-2">
      <div className="flex items-center justify-between">
        <h5 className="text-xs font-bold text-amber-900">↪ 비선형 경로 코너 보정 (Harvey 공식)</h5>
        <div className="flex rounded overflow-hidden text-[10px]">
          <button onClick={() => setMode("internal")}
            className={`px-2 py-0.5 ${mode === "internal" ? "bg-amber-600 text-white" : "bg-white text-gray-600 border border-gray-200"}`}>
            내부 코너
          </button>
          <button onClick={() => setMode("external")}
            className={`px-2 py-0.5 ${mode === "external" ? "bg-amber-600 text-white" : "bg-white text-gray-600 border border-gray-200"}`}>
            외부 코너
          </button>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="text-[10px] text-gray-500">{mode === "internal" ? "외경 OD (mm)" : "내경 ID (mm)"}</label>
          <input type="number" value={workpieceRadius * 2}
            onChange={e => setWorkpieceRadius((parseFloat(e.target.value) || 0) / 2)}
            className="w-full rounded border border-gray-300 px-2 py-1 text-xs font-mono" />
        </div>
        <div>
          <label className="text-[10px] text-gray-500">공구 직경 TD (mm)</label>
          <input type="text" value={toolDiameter.toFixed(2)} readOnly
            className="w-full rounded border border-gray-200 bg-gray-50 px-2 py-1 text-xs font-mono" />
        </div>
      </div>
      <div className="font-mono text-[11px] bg-white rounded px-2 py-1.5 border border-amber-200">
        {mode === "internal"
          ? <>F_adj = F × (OD − TD) / OD = {baseFeed.toFixed(0)} × ({(workpieceRadius * 2).toFixed(0)} − {toolDiameter.toFixed(0)}) / {(workpieceRadius * 2).toFixed(0)}</>
          : <>F_adj = F × (ID + TD) / ID = {baseFeed.toFixed(0)} × ({(workpieceRadius * 2).toFixed(0)} + {toolDiameter.toFixed(0)}) / {(workpieceRadius * 2).toFixed(0)}</>
        }
        <br />= <b className="text-amber-700">{adjusted.toFixed(0)} mm/min</b> ({pct.toFixed(0)}% of base)
      </div>
      <div className="text-[10px] text-gray-600">
        {mode === "internal"
          ? "내부 코너 진입 시: 공구 접촉 각도 증가 → 이송 감속 필요. 작을수록 감속↑"
          : "외부 코너 이탈 시: 공구 접촉 감소 → 이송 증가 가능"}
      </div>
    </div>
  )
}
