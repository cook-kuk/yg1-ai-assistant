// SPDX-License-Identifier: MIT
// YG-1 ARIA Simulator v3 — CNC 용어 사전 페이지
// 112 entry (Sandvik / Harvey / Trent / ASM 출처) 3단계 난이도 설명 브라우저

import { Suspense } from "react"
import Link from "next/link"
import { ChevronLeft } from "lucide-react"
import { GlossaryBrowser } from "@/lib/frontend/simulator/v2/glossary-browser"

export default function GlossaryPage() {
  return (
    <div className="min-h-screen bg-[linear-gradient(180deg,#ffffff_0%,#f7f7f8_100%)] dark:bg-slate-950 dark:bg-none">
      <div className="border-b bg-white/95 dark:border-slate-800 dark:bg-slate-900/95">
        <div className="mx-auto max-w-6xl px-4 py-5">
          <Link
            href="/simulator_v2"
            className="inline-flex items-center gap-1 text-xs text-gray-500 hover:text-gray-900 dark:text-slate-400 dark:hover:text-slate-100"
          >
            <ChevronLeft className="h-3 w-3" /> 시뮬레이터로
          </Link>
          <h1 className="mt-2 text-xl font-semibold dark:text-slate-50">
            📚 CNC 용어 사전
          </h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-slate-400">
            112 entry · Sandvik / Harvey / Trent / ASM 출처 · 3단계 난이도 설명
          </p>
        </div>
      </div>
      <div className="mx-auto max-w-6xl px-4 py-6">
        <Suspense
          fallback={
            <div className="py-10 text-center text-sm text-gray-500 dark:text-slate-400">
              로딩 중...
            </div>
          }
        >
          <GlossaryBrowser />
        </Suspense>
      </div>
    </div>
  )
}
