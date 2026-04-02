"use client"

const COMPETITORS = [
  "GUHRING", "KENNAMETAL (WIDIA)", "SECO", "EMUGE-FRANKEN", "FRAISA",
  "MOLDINO", "OSG", "UNION", "NS", "MITSUBISHI",
  "HELICAL SOLUTION", "NIAGARA",
]

export function CompetitorTab() {
  return (
    <div className="flex flex-col items-center justify-center py-16 px-6 text-center">
      <div className="text-4xl mb-4">🔄</div>
      <h3 className="text-lg font-bold text-gray-900 mb-2">경쟁사 대체 추천</h3>
      <p className="text-sm text-gray-500 mb-6">
        경쟁사 DB 구축 중입니다. 완성되면 경쟁사 제품 코드를 입력하면<br />
        YG-1 대체품을 자동 매칭합니다.
      </p>

      <div className="w-full max-w-md space-y-3 mb-6">
        <select className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm text-gray-400" disabled>
          <option>경쟁사 선택...</option>
          {COMPETITORS.map(c => <option key={c}>{c}</option>)}
        </select>
        <input
          className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm text-gray-400"
          placeholder="경쟁사 제품코드 입력..."
          disabled
        />
        <button
          className="w-full rounded-lg bg-gray-200 px-4 py-2.5 text-sm font-medium text-gray-400 cursor-not-allowed"
          disabled
        >
          대체품 검색 (준비 중)
        </button>
      </div>

      <div className="w-full max-w-md">
        <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-400 mb-2">
          지원 예정 경쟁사
        </p>
        <div className="flex flex-wrap gap-1.5 justify-center">
          {COMPETITORS.map(c => (
            <span key={c} className="rounded-full border border-gray-200 bg-gray-50 px-2.5 py-1 text-[10px] text-gray-500">
              {c}
            </span>
          ))}
        </div>
      </div>
    </div>
  )
}
