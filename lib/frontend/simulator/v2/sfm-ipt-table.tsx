"use client"

import { SFM_IPT_TABLE, UNITS } from "../cutting-calculator"

interface Props {
  currentVc: number  // m/min
  currentFz: number  // mm/t
  displayUnit: "metric" | "inch" | "both"
}

// 재질별 출발값 대조표 — 현재값이 어느 재질 범위인지 하이라이트
export function SfmIptTable({ currentVc, currentFz, displayUnit }: Props) {
  const currentSFM = UNITS.mPerMinToSFM(currentVc)
  const currentIPT = UNITS.mmToIn(currentFz)

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b text-left text-gray-500">
            <th className="pb-2 pr-3">재질</th>
            <th className="pb-2 pr-3 text-right">SFM 범위</th>
            {displayUnit !== "inch" && <th className="pb-2 pr-3 text-right">Vc m/min</th>}
            <th className="pb-2 pr-3 text-right">IPT 범위 (in/t)</th>
            {displayUnit !== "inch" && <th className="pb-2 pr-3 text-right">fz mm/t</th>}
            <th className="pb-2">비고</th>
          </tr>
        </thead>
        <tbody className="font-mono">
          {SFM_IPT_TABLE.map(r => {
            const inSFM = currentSFM >= r.sfmMin && currentSFM <= r.sfmMax
            const inIPT = currentIPT >= r.iptMin && currentIPT <= r.iptMax
            const match = inSFM && inIPT
            return (
              <tr key={r.material} className={`border-b border-gray-100 ${match ? "bg-emerald-50" : ""}`}>
                <td className="py-1.5 pr-3 font-sans text-gray-900">{match && "🎯 "}{r.material}</td>
                <td className={`py-1.5 pr-3 text-right ${inSFM ? "text-emerald-700 font-bold" : "text-gray-600"}`}>{r.sfmMin}~{r.sfmMax}</td>
                {displayUnit !== "inch" && (
                  <td className="py-1.5 pr-3 text-right text-gray-500">{UNITS.sfmToMPerMin(r.sfmMin).toFixed(0)}~{UNITS.sfmToMPerMin(r.sfmMax).toFixed(0)}</td>
                )}
                <td className={`py-1.5 pr-3 text-right ${inIPT ? "text-emerald-700 font-bold" : "text-gray-600"}`}>{r.iptMin.toFixed(4)}~{r.iptMax.toFixed(4)}</td>
                {displayUnit !== "inch" && (
                  <td className="py-1.5 pr-3 text-right text-gray-500">{UNITS.inToMm(r.iptMin).toFixed(3)}~{UNITS.inToMm(r.iptMax).toFixed(3)}</td>
                )}
                <td className="py-1.5 text-[10px] font-sans text-gray-500">{r.note}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
      <div className="mt-2 text-[10px] text-gray-500">
        현재 값: <span className="font-mono text-gray-800">SFM {currentSFM.toFixed(0)} · IPT {currentIPT.toFixed(4)}</span>
        {" "}🎯 마크는 재질 권장 범위 안에 있다는 뜻.
      </div>
    </div>
  )
}
