/**
 * Proactive Insight Engine — KB에서 유저가 모르는 걸 찾아 알려줌.
 * semantic-search.ts의 searchKB() 사용 → 하드코딩 0.
 * KB에 데이터 추가 → 통찰 자동 증가.
 */

import { searchKB, getMaterialGuide, getCoatingProperties } from "./semantic-search"
import type { AppliedFilter } from "@/lib/types/exploration"

export interface ProactiveInsight {
  type: "root_cause" | "warning" | "expert_tip" | "cost_insight"
  source: string
  message: string
  priority: number // 1 = 높음
}

const PROBLEM_SIGNALS = /수명|마모|닳|파손|깨짐|부러|떨림|진동|채터|거칠|표면|칩.*엉|칩.*감|BUE|구성인선|버|burr/iu
const OPERATION_SIGNALS = /포켓|측면|홈|슬롯|곡면|3d|면삭|페이싱|드릴|나사|탭|챔퍼/iu

export function generateInsights(
  userMessage: string,
  filters: AppliedFilter[],
  _candidateCount: number,
  turnCount: number,
): ProactiveInsight[] {
  const insights: ProactiveInsight[] = []
  const msg = (userMessage ?? "").toString()

  // ── 1. 문제/고민 → troubleshooting KB ──
  if (PROBLEM_SIGNALS.test(msg)) {
    const results = searchKB(msg, 2, 0.08, ["troubleshooting"])
    for (const r of results) {
      const data = r.entry.data as Record<string, unknown>
      const causes = Array.isArray(data.causes) ? (data.causes as unknown[]) : []
      const solutions = Array.isArray(data.solutions) ? (data.solutions as unknown[]) : []
      const topCause = causes[0]
      const topSolution = solutions[0]
      if (topCause && topSolution) {
        const sol = typeof topSolution === "object" && topSolution !== null
          ? ((topSolution as { action?: string }).action ?? JSON.stringify(topSolution))
          : String(topSolution)
        insights.push({
          type: "root_cause",
          source: "troubleshooting",
          priority: 1,
          message: `${String(data.symptom ?? "")}의 가장 흔한 원인: ${String(topCause)}. 해결: ${sol}`,
        })
      }
    }
  }

  // ── 2. 소재 필터 → material-coating-guide ──
  const materialFilter = filters.find(f => f.field === "workPieceName" || f.field === "_workPieceName")
  if (materialFilter) {
    const materialName = String(materialFilter.rawValue ?? materialFilter.value)
    const guide = getMaterialGuide(materialName)
    if (guide) {
      const data = guide.data as Record<string, unknown>
      const tips = Array.isArray(data.machining_tips) ? (data.machining_tips as string[]) : []
      if (tips.length > 0) {
        insights.push({ type: "expert_tip", source: "material-guide", priority: 2, message: String(tips[0]) })
      }

      const coatingFilter = filters.find(f => f.field === "coating")
      if (coatingFilter) {
        const userCoating = String(coatingFilter.rawValue ?? coatingFilter.value).toLowerCase()
        const notRec = Array.isArray(data.not_recommended_coatings)
          ? (data.not_recommended_coatings as Array<{ coating?: string; reason?: string }>)
          : []
        for (const nr of notRec) {
          if (userCoating.includes(String(nr.coating ?? "").toLowerCase())) {
            insights.push({
              type: "warning",
              source: "material-guide",
              priority: 1,
              message: `${materialName}에 ${nr.coating}은 부적합: ${nr.reason ?? ""}`,
            })
          }
        }
        const rec = Array.isArray(data.recommended_coatings)
          ? (data.recommended_coatings as Array<{ coating?: string; yg1_name?: string; reason?: string }>)
          : []
        const best = rec[0]
        if (best && !userCoating.includes(String(best.coating ?? "").toLowerCase())) {
          insights.push({
            type: "expert_tip",
            source: "material-guide",
            priority: 2,
            message: `${materialName}에는 ${best.coating}${best.yg1_name ? `(${best.yg1_name})` : ""}이 최적: ${best.reason ?? ""}`,
          })
        }
      }

      const problems = Array.isArray(data.common_problems)
        ? (data.common_problems as Array<{ problem?: string; solution?: string }>)
        : []
      if (problems.length > 0 && turnCount >= 2) {
        insights.push({
          type: "warning",
          source: "material-guide",
          priority: 3,
          message: `${materialName} 가공 시 주의: ${problems[0].problem ?? ""} — ${problems[0].solution ?? ""}`,
        })
      }
    }
  }

  // ── 3. 가공 형상 → operation-guide ──
  if (OPERATION_SIGNALS.test(msg)) {
    const results = searchKB(msg, 1, 0.1, ["operation"])
    for (const r of results) {
      const data = r.entry.data as Record<string, unknown>
      const mistakes = Array.isArray(data.common_mistakes) ? (data.common_mistakes as unknown[]) : []
      if (mistakes.length > 0) {
        insights.push({
          type: "warning",
          source: "operation-guide",
          priority: 2,
          message: `${String(data.operation ?? "")} 주의: ${String(mistakes[0])}`,
        })
      }
    }
  }

  // ── 4. 코팅만 있고 소재 없음 → 코팅 특성 ──
  const coatingFilter = filters.find(f => f.field === "coating")
  if (coatingFilter && !materialFilter) {
    const prop = getCoatingProperties(String(coatingFilter.rawValue ?? coatingFilter.value))
    if (prop) {
      const data = prop.data as Record<string, unknown>
      const bestFor = Array.isArray(data.best_for) ? (data.best_for as string[]).join(", ") : ""
      const avoid = Array.isArray(data.avoid_for) ? (data.avoid_for as string[]) : []
      if (bestFor) {
        insights.push({
          type: "expert_tip",
          source: "coating-properties",
          priority: 2,
          message: `${String(data.coating ?? data.coating_name ?? "")}은 ${bestFor}에 적합.${avoid.length ? ` ${avoid.join(", ")}에는 부적합.` : ""}`,
        })
      }
    }
  }

  // ── 5. L/D비 경고 ──
  const dia = Number(filters.find(f => f.field === "diameterMm")?.rawValue) || 0
  const oal = Number(filters.find(f => f.field === "overallLengthMm")?.rawValue) || 0
  if (dia > 0 && oal > 0) {
    const ld = oal / dia
    if (ld > 8) {
      insights.push({
        type: "warning",
        source: "domain-rule",
        priority: 1,
        message: `L/D비 ${ld.toFixed(1)}배 — 극심한 떨림+파손 위험. 넥 타입+절입 축소+쿨런트 필수.`,
      })
    } else if (ld > 4) {
      insights.push({
        type: "warning",
        source: "domain-rule",
        priority: 2,
        message: `L/D비 ${ld.toFixed(1)}배 — 떨림 가능. 부등분할 또는 넥 타입 권장.`,
      })
    }
  }

  // ── 6. 아무것도 안 걸리면 일반 KB 검색 (Turn 2+) ──
  if (insights.length === 0 && turnCount >= 2) {
    const results = searchKB(msg, 1, 0.12, ["knowhow", "troubleshooting", "material-guide"])
    for (const r of results) {
      insights.push({ type: "expert_tip", source: r.entry.source, priority: 3, message: r.entry.summary })
    }
  }

  // dedupe by message
  const seen = new Set<string>()
  const unique: ProactiveInsight[] = []
  for (const i of insights) {
    if (seen.has(i.message)) continue
    seen.add(i.message)
    unique.push(i)
  }

  return unique.sort((a, b) => a.priority - b.priority).slice(0, 3)
}

export function formatInsightsForPrompt(insights: ProactiveInsight[]): string {
  if (insights.length === 0) return ""
  const lines = insights.map(i => {
    const icon = i.type === "root_cause" ? "💡" : i.type === "warning" ? "⚠️" : "🔧"
    const label =
      i.type === "root_cause" ? "진짜 원인" : i.type === "warning" ? "주의" : "전문가 팁"
    return `${icon} [${label}] ${i.message}`
  })
  return `\n═══ 능동적 통찰 (KB 기반 — 응답에 자연스럽게 녹여서 전달) ═══\n${lines.join("\n")}\n위 통찰을 전문가답게 대화에 녹이세요. 그대로 복사 금지. 유저가 안 물어도 중요하면 먼저 알려주세요.`
}
