import { Suspense } from "react"
import Link from "next/link"
import { ChevronLeft } from "lucide-react"
import { SimAdminDashboard } from "@/lib/frontend/simulator/v2/admin/sim-admin-dashboard"

export default function SimAdminPage() {
  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950">
      <div className="border-b bg-white/95 dark:bg-slate-900/95">
        <div className="mx-auto max-w-6xl px-4 py-5">
          <Link
            href="/simulator_v2"
            className="text-xs text-gray-500 hover:text-gray-900 inline-flex items-center gap-1"
          >
            <ChevronLeft className="h-3 w-3" /> 시뮬레이터로
          </Link>
          <h1 className="mt-2 text-xl font-semibold">⚙ Simulator v3 Admin</h1>
          <p className="mt-1 text-sm text-gray-500">
            관리자 전용 · 사용 통계 · LLM 비용 · 카탈로그 상태
          </p>
        </div>
      </div>
      <div className="mx-auto max-w-6xl px-4 py-6">
        <Suspense fallback={<div className="text-slate-400">로딩...</div>}>
          <SimAdminDashboard />
        </Suspense>
      </div>
    </div>
  )
}
