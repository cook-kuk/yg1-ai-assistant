"use client"

import { useEffect, useState } from "react"

// TODO(DB 연동): 아래 mock 값들은 추후 /api/admin/sim-v3/stats 엔드포인트로 대체
// - totalVisits → PostgreSQL visit_log 테이블 집계
// - llmCalls → MongoDB llm_request_log collection 집계
// - generatedPdfs → PostgreSQL pdf_export_log 테이블
// - errorsRecent → Sentry webhook 연동 후 표시

type KpiCardProps = {
  label: string
  value: string
  sub?: string
  accent?: string
}

function KpiCard({ label, value, sub, accent }: KpiCardProps) {
  return (
    <div className="rounded-xl border p-4 bg-white dark:bg-slate-900 dark:border-slate-800">
      <div className="text-xs text-gray-500 dark:text-slate-400">{label}</div>
      <div className={`mt-1 text-2xl font-semibold ${accent ?? "text-gray-900 dark:text-slate-100"}`}>
        {value}
      </div>
      {sub && <div className="mt-1 text-xs text-gray-400 dark:text-slate-500">{sub}</div>}
    </div>
  )
}

type TimelineEvent = {
  emoji: string
  time: string
  summary: string
}

const MOCK_TIMELINE: TimelineEvent[] = [
  { emoji: "🔍", time: "방금 전", summary: "AI 검색 · \"SKD11 엔드밀 추천\"" },
  { emoji: "💾", time: "2분 전", summary: "스냅샷 저장 · snap_7f3a" },
  { emoji: "📄", time: "5분 전", summary: "작업지시서 PDF 다운로드" },
  { emoji: "🏆", time: "11분 전", summary: "리더보드 등록 · MRR 48.2" },
  { emoji: "🔍", time: "14분 전", summary: "AI 검색 · \"고경도강 황삭\"" },
  { emoji: "⚙", time: "22분 전", summary: "프리셋 적용 · SS304 Finish" },
  { emoji: "📊", time: "31분 전", summary: "Break-even 차트 export" },
  { emoji: "🎯", time: "47분 전", summary: "Taylor curve 비교" },
  { emoji: "🔁", time: "1시간 전", summary: "Multi-tool compare · 3 tools" },
  { emoji: "💾", time: "1시간 전", summary: "스냅샷 저장 · snap_2c91" },
]

type LlmUsageRow = {
  label: string
  calls: number
  cost: string
  legacy?: boolean
}

const MOCK_LLM_USAGE: LlmUsageRow[] = [
  { label: "Sonnet 4.6", calls: 8234, cost: "$9.2" },
  { label: "Haiku 4.5", calls: 14120, cost: "$2.1" },
  { label: "Opus (구버전)", calls: 1127, cost: "$1.1", legacy: true },
]

export function SimAdminDashboard() {
  const [leaderboardCount, setLeaderboardCount] = useState<number>(0)

  useEffect(() => {
    try {
      const raw = typeof window !== "undefined"
        ? window.localStorage.getItem("cookforge.simv2.leaderboard")
        : null
      if (raw) {
        const parsed = JSON.parse(raw)
        if (Array.isArray(parsed)) {
          setLeaderboardCount(parsed.length)
        }
      }
    } catch {
      // localStorage 파싱 실패 시 0 유지
    }
  }, [])

  const handleExportJson = () => {
    const payload = {
      exportedAt: new Date().toISOString(),
      kpi: {
        totalVisits: 1247,
        llmCalls: 23481,
        llmCostUsd: 12.4,
        generatedPdfs: 89,
        leaderboardCount,
      },
      llmUsage: MOCK_LLM_USAGE,
      timeline: MOCK_TIMELINE,
    }
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: "application/json",
    })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `sim-v3-admin-dump-${Date.now()}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="space-y-6">
      {/* 1. KPI 카드 */}
      <section className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiCard
          label="총 방문 수"
          value="1,247"
          sub="최근 7일 (mock)"
        />
        <KpiCard
          label="LLM API 호출 수"
          value="23,481"
          sub="예상 비용 $12.4 (mock)"
        />
        <KpiCard
          label="생성된 PDF 지시서"
          value="89건"
          sub="누적 (mock)"
        />
        <KpiCard
          label="리더보드 등록 조건"
          value={`${leaderboardCount}건`}
          sub="localStorage 기준"
          accent="text-emerald-600 dark:text-emerald-400"
        />
      </section>

      {/* 2 & 3 나란히 */}
      <section className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        {/* 2. 사용자 활동 타임라인 */}
        <div className="rounded-xl border p-4 bg-white dark:bg-slate-900 dark:border-slate-800">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-gray-900 dark:text-slate-100">
              사용자 활동 타임라인
            </h2>
            <span className="text-xs text-gray-400">mock · 최근 10건</span>
          </div>
          <ul className="mt-3 space-y-2">
            {MOCK_TIMELINE.map((ev, i) => (
              <li
                key={i}
                className="flex items-start gap-2 text-xs text-gray-700 dark:text-slate-300 border-b last:border-0 dark:border-slate-800 pb-1.5"
              >
                <span className="text-base leading-none">{ev.emoji}</span>
                <span className="w-16 text-gray-400 dark:text-slate-500 shrink-0">{ev.time}</span>
                <span className="flex-1">{ev.summary}</span>
              </li>
            ))}
          </ul>
        </div>

        {/* 3. LLM 모델별 사용량 */}
        <div className="rounded-xl border p-4 bg-white dark:bg-slate-900 dark:border-slate-800">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-gray-900 dark:text-slate-100">
              LLM 모델별 사용량
            </h2>
            <span className="text-xs text-gray-400">mock · 누적</span>
          </div>
          <div className="mt-3 space-y-2">
            {MOCK_LLM_USAGE.map((row) => (
              <div
                key={row.label}
                className="flex items-center justify-between rounded-lg border border-slate-100 dark:border-slate-800 p-2.5"
              >
                <div className="flex items-center gap-2">
                  <span className="text-sm text-gray-800 dark:text-slate-200">{row.label}</span>
                  {row.legacy && (
                    <span className="rounded bg-amber-100 dark:bg-amber-900/40 text-amber-800 dark:text-amber-300 px-1.5 py-0.5 text-[10px] font-medium">
                      legacy
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-4 text-xs">
                  <span className="text-gray-500 dark:text-slate-400">
                    {row.calls.toLocaleString()}회
                  </span>
                  <span className="font-medium text-gray-900 dark:text-slate-100">{row.cost}</span>
                </div>
              </div>
            ))}
          </div>
          <p className="mt-3 text-[10px] text-gray-400 dark:text-slate-500">
            * 실제 provider: OpenAI GPT-5.4 (provider.ts tier 네이밍 legacy 유지)
          </p>
        </div>
      </section>

      {/* 4. Catalog 상태 */}
      <section className="rounded-xl border p-4 bg-white dark:bg-slate-900 dark:border-slate-800">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-gray-900 dark:text-slate-100">
            Catalog 상태
          </h2>
          <span className="text-xs text-gray-400">YG-1 + Harvey</span>
        </div>
        <div className="mt-3 grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
          <div className="rounded-lg border border-slate-100 dark:border-slate-800 p-3">
            <div className="text-gray-500 dark:text-slate-400">YG-1 공구 DB</div>
            <div className="mt-1 font-medium text-gray-900 dark:text-slate-100">
              15 confidence:2 · 0 confidence:3+
            </div>
          </div>
          <div className="rounded-lg border border-slate-100 dark:border-slate-800 p-3">
            <div className="text-gray-500 dark:text-slate-400">Harvey benchmark</div>
            <div className="mt-1 font-medium text-gray-900 dark:text-slate-100">
              8 entries verified
            </div>
          </div>
          <div className="rounded-lg border border-slate-100 dark:border-slate-800 p-3 flex items-center justify-between">
            <div>
              <div className="text-gray-500 dark:text-slate-400">카탈로그 갱신</div>
              <div className="mt-1 text-[10px] text-gray-400">추후 연동</div>
            </div>
            <button
              type="button"
              disabled
              className="rounded-md bg-gray-100 dark:bg-slate-800 text-gray-400 dark:text-slate-500 px-3 py-1.5 text-xs cursor-not-allowed"
            >
              카탈로그 업데이트
            </button>
          </div>
        </div>
      </section>

      {/* 5. 최근 에러 */}
      <section className="rounded-xl border p-4 bg-white dark:bg-slate-900 dark:border-slate-800">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-gray-900 dark:text-slate-100">최근 에러</h2>
          <span className="text-xs text-gray-400">Sentry 연동 전</span>
        </div>
        <div className="mt-3 text-sm text-emerald-600 dark:text-emerald-400">
          최근 에러 0건 ✓
        </div>
      </section>

      {/* 6. Export */}
      <section className="rounded-xl border p-4 bg-white dark:bg-slate-900 dark:border-slate-800">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-gray-900 dark:text-slate-100">Export</h2>
          <span className="text-xs text-gray-400">관리자 다운로드</span>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            disabled
            className="rounded-md border border-slate-200 dark:border-slate-700 bg-gray-50 dark:bg-slate-800 text-gray-400 dark:text-slate-500 px-3 py-1.5 text-xs cursor-not-allowed"
            title="추후 연동"
          >
            📊 주간 리포트 PDF
          </button>
          <button
            type="button"
            onClick={handleExportJson}
            className="rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800 text-gray-700 dark:text-slate-200 px-3 py-1.5 text-xs"
          >
            📁 JSON 덤프 다운로드
          </button>
        </div>
      </section>

      <p className="text-[10px] text-gray-400 dark:text-slate-500">
        * 본 페이지는 스켈레톤입니다. mock 데이터는 추후 실제 stats API로 교체 예정 ·
        auth 가드 별도 작업
      </p>
    </div>
  )
}
