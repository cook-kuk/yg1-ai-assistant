"use client"

import dynamic from "next/dynamic"
import { startTransition, Suspense, useEffect, useState } from "react"
import { useSearchParams } from "next/navigation"
import { Calculator, ArrowLeftRight } from "lucide-react"
import { CuttingSimulatorV2 } from "@/lib/frontend/simulator/v2/cutting-simulator-v2"
import { CompetitorTab } from "@/lib/frontend/simulator/competitor-tab"
import { EducationProvider } from "@/lib/frontend/simulator/v2/education-context"
import { EducationControl } from "@/lib/frontend/simulator/v2/education-widgets"
import { ManualDownloadButton } from "@/lib/frontend/simulator/v2/manual-download-button"
import { ModeProvider } from "@/lib/frontend/simulator/v2/mode-context"
import { ModeToggle } from "@/lib/frontend/simulator/v2/mode-toggle"
import { SimErrorBoundary } from "@/lib/frontend/simulator/v2/sim-error-boundary"

// heavy 컴포넌트 lazy-load (framer-motion / canvas)
const CinematicBackdrop = dynamic(() => import("@/lib/frontend/simulator/v2/cinematic-backdrop"), { ssr: false })
// CyberpunkHud 현재 비활성 (성능 부담). 필요 시 관리자 설정에서 활성화.
// const CyberpunkHud = dynamic(() => import("@/lib/frontend/simulator/v2/cyberpunk-hud"), { ssr: false })

function DeferredBackdropMount() {
  const [showBackdrop, setShowBackdrop] = useState(false)

  useEffect(() => {
    let timeoutId: number | null = null
    let idleId: number | null = null
    const mount = () => {
      startTransition(() => setShowBackdrop(true))
    }

    if (typeof window !== "undefined" && "requestIdleCallback" in window) {
      idleId = window.requestIdleCallback(() => mount(), { timeout: 1200 })
    } else {
      timeoutId = window.setTimeout(mount, 280)
    }

    return () => {
      if (typeof window !== "undefined" && idleId != null && "cancelIdleCallback" in window) {
        window.cancelIdleCallback(idleId)
      }
      if (timeoutId != null) {
        window.clearTimeout(timeoutId)
      }
    }
  }, [])

  if (!showBackdrop) return null
  return <CinematicBackdrop intensity="low" theme="aurora" />
}

function EducationControlMount() {
  return (
    <div className="ml-auto flex items-center gap-2">
      <ModeToggle size="sm" />
      <ManualDownloadButton />
      <EducationControl />
    </div>
  )
}

function SimulatorV2Content() {
  const searchParams = useSearchParams()
  const [tab, setTab] = useState<"simulator" | "competitor">("simulator")

  const product = searchParams.get("product") ?? undefined
  const material = searchParams.get("material") ?? undefined
  const operation = searchParams.get("operation") ?? undefined

  return (
    <div className="relative min-h-screen bg-[linear-gradient(180deg,#ffffff_0%,#f7f7f8_100%)]">
      {/* 🎬 시네마틱 배경 — low intensity로 성능 보호 */}
      <DeferredBackdropMount />
      {/* Header */}
      <div className="border-b bg-white/95">
        <div className="mx-auto max-w-6xl px-3 md:px-4 py-5">
          <div className="mb-2 h-1 w-14 rounded-full bg-red-600" />
          <div className="flex flex-wrap items-center gap-2 md:gap-3">
            <h1 className="text-xl font-semibold tracking-[-0.03em] text-gray-950">
              가공조건 시뮬레이터
            </h1>
            <span className="rounded-full bg-gradient-to-r from-amber-500 to-amber-600 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.2em] text-white">
              v3 · DIRECTOR-READY
            </span>
            <EducationControlMount />
          </div>
          <p className="mt-1 text-sm text-gray-500">
            YG-1 엔드밀 전용 · 5사 강점 통합 · 출처 투명 공개
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[10px]">
            <span className="text-gray-500">Inspired by:</span>
            <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-slate-600">🇺🇸 Harvey MAP</span>
            <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-slate-600">🇸🇪 Sandvik CoroPlus</span>
            <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-slate-600">🇩🇪 Walter GPS</span>
            <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-slate-600">🇮🇱 ISCAR ITA</span>
            <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-slate-600">🇺🇸 Kennametal NOVO</span>
            <span className="rounded-full border border-emerald-300 bg-emerald-50 px-2 py-0.5 font-semibold text-emerald-700">🇰🇷 + YG-1 Original</span>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="border-b bg-white">
        <div className="mx-auto max-w-6xl px-3 md:px-4">
          <div className="flex gap-1">
            <button
              onClick={() => setTab("simulator")}
              className={`flex items-center gap-1.5 px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
                tab === "simulator"
                  ? "border-blue-600 text-blue-700"
                  : "border-transparent text-gray-500 hover:text-gray-700"
              }`}
            >
              <Calculator className="h-4 w-4" />
              절삭조건 시뮬레이터
            </button>
            <button
              onClick={() => setTab("competitor")}
              className={`flex items-center gap-1.5 px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
                tab === "competitor"
                  ? "border-blue-600 text-blue-700"
                  : "border-transparent text-gray-500 hover:text-gray-700"
              }`}
            >
              <ArrowLeftRight className="h-4 w-4" />
              경쟁사 대체 추천
            </button>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="mx-auto max-w-6xl px-3 md:px-4 py-6">
        {tab === "simulator" ? (
          <CuttingSimulatorV2
            initialProduct={product}
            initialMaterial={material}
            initialOperation={operation}
          />
        ) : (
          <CompetitorTab />
        )}
      </div>
    </div>
  )
}

export default function SimulatorV2Page() {
  return (
    <ModeProvider>
      <EducationProvider>
        <SimErrorBoundary>
          <Suspense fallback={<div className="flex items-center justify-center h-screen text-gray-400">로딩 중...</div>}>
            <SimulatorV2Content />
          </Suspense>
        </SimErrorBoundary>
      </EducationProvider>
    </ModeProvider>
  )
}
