// Machine Impact Lab — rule-based insight generator.
//
// Reads a ComputeResult + BASELINE reference and emits short Korean
// narrative nudges that take the user from "what's happening" (KPIs /
// warnings) to "why does this matter" (operational framing). Pure
// function, zero LLM calls — same inputs always produce the same
// bullets, which keeps demos reproducible.
//
// Heuristics are intentionally conservative: they only fire when the
// signal is unambiguous. Silent > noisy. If the engine produces a mild
// middle-of-the-road result, we return an empty array and let the KPI
// strip do the talking.
import type { ComputeResult } from "./impact-calc-engine"

export interface Insight {
  icon: "🏆" | "⚡" | "🛡️" | "⚠️" | "🌙" | "💡" | "📈" | "📉"
  tone: "positive" | "neutral" | "caution"
  text: string
}

// Threshold tuning notes — picked after the scenario smoke showed:
//   baseline  1.00 MRR, 53 life
//   premium   1.15 MRR, 31 life
//   highspeed 1.14 MRR, 32 life
//   standard  0.85 MRR, 60 life
//   budget    0.42 MRR, 329 life  ← life-first tradeoff
//   disaster  0.28 MRR, 500 life
// So life-first mode becomes interesting when lifeRatio > 2 AND mrrRatio < 0.7.
const MRR_BEAT_THRESHOLD = 1.1
const MRR_BAD_THRESHOLD = 0.6
const LIFE_BEAT_THRESHOLD = 1.5
const LIFE_CRITICAL_MIN = 15
const LIFE_FIRST_LIFE_RATIO = 2
const LIFE_FIRST_MRR_MAX = 0.7
const POWER_HEADROOM_CEILING = 0.8

export function generateInsights(result: ComputeResult, baseline: ComputeResult): Insight[] {
  const out: Insight[] = []
  const mrrRatio = baseline.MRR_inch3_min > 0 ? result.MRR_inch3_min / baseline.MRR_inch3_min : 1
  const lifeRatio = baseline.toolLife_min > 0 ? result.toolLife_min / baseline.toolLife_min : 1

  // 1) Productivity win — premium / highspeed scenarios.
  if (mrrRatio >= MRR_BEAT_THRESHOLD && result.chatterLevel !== "HIGH") {
    out.push({
      icon: "🏆",
      tone: "positive",
      text: `BASELINE 대비 +${Math.round((mrrRatio - 1) * 100)}% MRR — 생산성 최상위 구간. 고부가 라인에 추천.`,
    })
  }

  // 2) Life-first tradeoff — budget 시나리오처럼 life ↑, MRR ↓ 인 케이스.
  if (
    lifeRatio >= LIFE_FIRST_LIFE_RATIO &&
    mrrRatio <= LIFE_FIRST_MRR_MAX &&
    result.chatterLevel !== "HIGH"
  ) {
    out.push({
      icon: "🌙",
      tone: "neutral",
      text: `공구 수명 ${Math.round(lifeRatio * 100)}% (BASE 대비) — 중량/야간 무인가공 유리, 사이클 타임은 여유가 있어야 함.`,
    })
  }

  // 3) MRR starvation — disaster 급. 경영진 설득용 한 줄.
  if (mrrRatio < MRR_BAD_THRESHOLD) {
    const hoursLost = Math.max(0, result.cycleTime100_min - baseline.cycleTime100_min) / 60
    if (Number.isFinite(hoursLost) && hoursLost > 0.5) {
      out.push({
        icon: "📉",
        tone: "caution",
        text: `100개 기준 BASELINE 대비 +${hoursLost.toFixed(1)}시간 소요 — 머신 설정만으로 발생하는 순손실.`,
      })
    } else {
      out.push({
        icon: "📉",
        tone: "caution",
        text: `MRR 이 BASELINE 의 ${Math.round(mrrRatio * 100)}% — 공구 교체보다 머신 조정이 먼저.`,
      })
    }
  }

  // 4) Chatter critical — 안전 우선.
  if (result.chatterLevel === "HIGH") {
    out.push({
      icon: "⚠️",
      tone: "caution",
      text: `채터 위험 HIGH — Stickout 을 줄이거나 Shrink-Fit 홀더로 교체하면 바로 완화됨.`,
    })
  }

  // 5) Tool life critical — 실무 경고.
  if (result.toolLife_min < LIFE_CRITICAL_MIN) {
    out.push({
      icon: "⚡",
      tone: "caution",
      text: `공구 수명 ${Math.round(result.toolLife_min)}분 — 교체 빈도가 가공 시간을 지배. Coolant 강화 또는 Vc 하향 고려.`,
    })
  }

  // 6) Power headroom — 설비 선택 가이드.
  if (result.pwrPct > POWER_HEADROOM_CEILING) {
    out.push({
      icon: "📈",
      tone: "caution",
      text: `스핀들 부하 ${Math.round(result.pwrPct * 100)}% — 같은 조건이면 상위 kW 스핀들이 수명·안정성 모두 유리.`,
    })
  }

  // 7) RPM saturation — HSM 업그레이드 힌트.
  if (result.rpmCappedPct >= 0.95 && result.rpmCapped < result.calcRPM) {
    const lost = result.calcRPM - result.rpmCapped
    out.push({
      icon: "💡",
      tone: "neutral",
      text: `스핀들 RPM 한계에 ${Math.round(result.rpmCappedPct * 100)}% 도달 (손실 ${Math.round(lost).toLocaleString()} RPM) — HSM/고속 스핀들로 바꾸면 곧장 MRR 증가.`,
    })
  }

  // 8) Baseline-like safety — 크리티컬 없음 + LOW 채터 + 생산성 양호 →
  // 안심 문구. BASELINE 자체는 RPM 95% 구간이라 "warn" 급 rpm-cap 는
  // 허용 (critical 만 걸러냄).
  const hasCritical = result.warnings.some((w) => w.level === "critical")
  if (out.length === 0 && !hasCritical && result.chatterLevel === "LOW" && mrrRatio >= 0.9) {
    out.push({
      icon: "🛡️",
      tone: "positive",
      text: "균형 잡힌 설정 — 채터 LOW, 생산성·수명 모두 BASELINE 근처. 일상 가공에 적합.",
    })
  }

  return out
}
