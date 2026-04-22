"use client"

// 칩 색깔 / 소리·진동 / 자주 하는 실수 TOP 10 — 정적 도움말 패널들

export function ChipColorDiagnostic() {
  const rows = [
    { color: "#E8E8E8", label: "은색 ~ 연한 짚색", temp: "~200°C", judgment: "이상적. SFM 적정. 변경 불필요", level: "good" },
    { color: "#D4A848", label: "황금색", temp: "~250°C", judgment: "약간 높지만 허용. 코팅 공구는 OK", level: "ok" },
    { color: "#8B6D3F", label: "갈색", temp: "~300°C", judgment: "과열 시작. SFM 5~10% 감소 권장", level: "warn" },
    { color: "#6B4A9E", label: "보라 / 파랑", temp: "~350°C+", judgment: "과열. SFM 15%+ 즉시 감소. 절삭유 점검", level: "bad" },
    { color: "#1A1A1A", label: "검정", temp: "> 400°C", judgment: "심각. 즉시 정지. 공구 파손 직전", level: "fatal" },
  ]
  const levelClass = {
    good: "border-emerald-300 bg-emerald-50",
    ok: "border-amber-200 bg-amber-50",
    warn: "border-orange-300 bg-orange-50",
    bad: "border-rose-300 bg-rose-50",
    fatal: "border-red-500 bg-red-100",
  } as const
  return (
    <div className="space-y-1.5">
      {rows.map(r => (
        <div key={r.label} className={`flex items-center gap-3 rounded-lg border px-2.5 py-1.5 ${levelClass[r.level as keyof typeof levelClass]}`}>
          <div className="w-6 h-6 rounded-full border border-gray-400 flex-shrink-0" style={{ backgroundColor: r.color }} />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 min-w-0">
              <span className="truncate text-xs font-semibold text-gray-900">{r.label}</span>
              <span className="flex-shrink-0 whitespace-nowrap text-[10px] font-mono text-gray-500">{r.temp}</span>
            </div>
            <div className="text-[10px] text-gray-700 mt-0.5 break-words">{r.judgment}</div>
          </div>
        </div>
      ))}
    </div>
  )
}

export function SymptomMatrix() {
  const rows = [
    { symptom: "고음의 '끽' 소리 + 표면 결", cause: "채터 (공진)", action: "RPM ±10% 변경, ADOC 감소, Stick Out 줄임" },
    { symptom: "규칙적 '드드드' 저음", cause: "절입 과다", action: "ADOC/RDOC 감소, 칩로드 감소" },
    { symptom: "가장자리 버(burr) 큼", cause: "공구 마모 또는 IPT 과다", action: "공구 교체 또는 IPT 10% 감소" },
    { symptom: "표면 광택 (smearing)", cause: "긁힘 — IPT 너무 작음", action: "Feed 다이얼 +10~20%" },
    { symptom: "공구가 빨갛게 달궈짐", cause: "절삭유 부족 / SFM 과다", action: "즉시 정지 · 쿨런트 점검 · SFM -15%" },
    { symptom: "칩이 공구에 끼임", cause: "칩 배출 불량", action: "Trochoidal/HEM 경로로 · 쿨런트 압력↑" },
    { symptom: "공구 끝단만 마모", cause: "ADOC 낮아 특정 부위 집중", action: "HEM으로 ADOC↑·RDOC↓ 분산" },
    { symptom: "가공 중 흔들림", cause: "Stick Out / Workholding 부족", action: "돌출 단축 · 강성 고정구" },
  ]
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b text-left text-gray-500">
            <th className="pb-2 pr-3">증상</th>
            <th className="pb-2 pr-3">원인</th>
            <th className="pb-2">조치</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-b border-gray-100 last:border-0 align-top">
              <td className="py-1.5 pr-3 font-semibold text-rose-700 break-words">{r.symptom}</td>
              <td className="py-1.5 pr-3 text-gray-600 break-words">{r.cause}</td>
              <td className="py-1.5 text-emerald-700 break-words">{r.action}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function CommonMistakes() {
  const mistakes = [
    { no: 1, title: "Condition 안 고름", why: "MAP이 가장 보수적 값으로 → RPM/IPM 저하 · 생산성 손실", fix: "도면·시방서에서 정확한 grade/condition 확인" },
    { no: 2, title: "Fixture Rigidity 무조건 Rigid", why: "실제 셋업이 부족한데 공격적 추천 → 공구 파손", fix: "정직하게 셋업 강성 평가 (본 가이드 체크리스트)" },
    { no: 3, title: "Max RPM/IPM 빈칸", why: "머신 한계 초과 추천값이 나옴", fix: "스펙시트 반드시 입력" },
    { no: 4, title: "Stick Out 입력 안 함", why: "공구 변형 보정 안 됨 → 채터 · 파손", fix: "실측값 입력 (L = 홀더 끝 ~ 공구 끝)" },
    { no: 5, title: "타사 공구 EDP 입력", why: "외경 같아도 내부 치수 달라 파국적 파손 가능", fix: "MAP은 자사(Harvey)만. 우리 v2는 YG-1 전용" },
    { no: 6, title: "Climb 대신 Conventional 사용", why: "공구 마모↑ · 표면 거칠기↑", fix: "CAM에서 Climb 기본 설정" },
    { no: 7, title: "RDOC < 50% + 칩 시닝 무시", why: "실 chip 두께 감소 → 긁힘 → 마모↑", fix: "우리 v2는 RCTF 자동보정. Harvey도 자동" },
    { no: 8, title: "코너에서 직선 IPM 그대로", why: "공구 접촉각 급증 → 파손", fix: "HEM 시 Inside Corner 보정 활성화" },
    { no: 9, title: "다이얼 +로 두 개 동시 조정", why: "원인 분리 어려움 · 트러블슈팅 방해", fix: "한 번에 하나씩 ±10%씩" },
    { no: 10, title: "추천값을 절대값으로 신뢰", why: "실기계·실공구·실재료 차이로 ±15% 편차 상시", fix: "첫 가공은 Speed -10% / Feed -10%로 보수" },
  ]
  return (
    <div className="space-y-1.5">
      {mistakes.map(m => (
        <div key={m.no} className="rounded-lg border border-gray-200 bg-white p-2.5">
          <div className="flex items-start gap-2">
            <span className="flex-shrink-0 inline-flex items-center justify-center w-6 h-6 rounded-full bg-red-100 text-red-700 text-[10px] font-bold">
              #{m.no}
            </span>
            <div className="flex-1 min-w-0">
              <div className="text-xs font-bold text-gray-900 break-words">{m.title}</div>
              <div className="text-[10px] text-gray-500 mt-0.5 break-words"><span className="font-semibold text-rose-600">왜:</span> {m.why}</div>
              <div className="text-[10px] text-emerald-700 mt-0.5 break-words"><span className="font-semibold">조치:</span> {m.fix}</div>
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}
