// SPDX-License-Identifier: MIT
// YG-1 ARIA AI Research Lab — Tour Scenarios (SSOT)
// - 모든 투어 스크립트는 이 파일에서만 관리 (하드코딩 금지 원칙)
// - data-tour="..." 셀렉터는 각 UI 섹션이 노출해야 함
// - 새 시나리오 추가 시 TOUR_SCENARIOS 배열과 id 리터럴 유니온을 함께 갱신

"use client"

// ── Types ─────────────────────────────────────────────────────────────
export type TourPlacement = "top" | "bottom" | "left" | "right" | "center"

/** 투어 개별 스텝 */
export interface TourStep {
  /** 고유 id (scenario 내부에서 유일) */
  id: string
  /** 하이라이트할 대상 CSS 셀렉터 (예: `[data-tour="demo-banner"]`) */
  target: string
  /** 스텝 제목 */
  title: string
  /** 스텝 본문 (Markdown 허용) */
  content: string
  /** 툴팁 배치 힌트 (tooltip 컴포넌트가 참고) */
  placement?: TourPlacement
  /** 스텝 진입 시 선택적 액션 id (페이지 측에서 hook 가능) */
  action?: string
  /** 자동 진행 시간(ms). 지정되지 않으면 수동 진행 */
  duration?: number
}

/** 투어 시나리오 */
export interface TourScenario {
  id: string
  name: string
  description: string
  estimatedMin: number
  steps: TourStep[]
}

// ── Scenarios ─────────────────────────────────────────────────────────
const FIRST_VISIT: TourScenario = {
  id: "first-visit",
  name: "ARIA 첫 방문 투어",
  description: "3분 안에 주요 화면을 한 번 훑어봅니다.",
  estimatedMin: 3,
  steps: [
    {
      id: "welcome",
      target: "[data-tour=\"lab-header\"]",
      title: "ARIA에 오신 걸 환영합니다",
      content:
        "**YG-1 ARIA AI Research Lab**에 오신 것을 환영합니다.\n\n이 투어는 약 **3분** 동안 주요 기능을 소개해 드려요. 언제든 `ESC` 키로 종료할 수 있습니다.",
      placement: "center",
    },
    {
      id: "demo-banner",
      target: "[data-tour=\"demo-banner\"]",
      title: "데모 모드 안내",
      content:
        "현재 화면은 **데모 데이터**로 동작합니다. 실제 라이브 센서/MES 연동은 상단 배너의 상태 아이콘에서 확인하세요.",
      placement: "bottom",
    },
    {
      id: "locked-context",
      target: "[data-tour=\"locked-context\"]",
      title: "잠금 가공 조건",
      content:
        "현재 시뮬레이션은 특정 **공구·소재·가공 조건**이 잠긴 상태에서 진행됩니다. 조건을 바꾸려면 조건 카드의 자물쇠 아이콘을 누르세요.",
      placement: "right",
    },
    {
      id: "ml-prediction",
      target: "[data-tour=\"ml-tool-life-prediction\"]",
      title: "ML 공구 수명 예측",
      content:
        "머신러닝 모델이 현재 조건에서의 **공구 수명**을 실시간으로 예측합니다. 값 옆의 작은 마크는 신뢰구간이에요.",
      placement: "left",
    },
    {
      id: "sensor-anomaly",
      target: "[data-tour=\"sensor-anomaly\"]",
      title: "센서 이상 탐지",
      content:
        "진동·전류·음향 센서를 통합 분석해 **이상 징후**가 감지되면 즉시 경고합니다. 초록 파형 = 정상.",
      placement: "top",
    },
    {
      id: "causal-xai",
      target: "[data-tour=\"causal-xai\"]",
      title: "인과 XAI 패널",
      content:
        "단순 상관이 아닌 **인과 관계**를 기반으로 원인을 추정합니다. 각 노드를 클릭해 상세 근거를 볼 수 있어요.",
      placement: "top",
    },
    {
      id: "copilot",
      target: "[data-tour=\"ai-copilot\"]",
      title: "ARIA Copilot",
      content:
        "자연어로 질문하세요. 예: *\"현재 Vc를 10% 올리면 수명이 어떻게 바뀌지?\"*\n\n현재 컨텍스트를 이해하고 근거와 함께 답합니다.",
      placement: "left",
    },
    {
      id: "info-toggle",
      target: "[data-tour=\"info-toggle\"]",
      title: "정보 수준 토글",
      content:
        "화면에 표시되는 정보량을 **Basic / Pro / Expert**로 전환할 수 있습니다. 처음이라면 Basic을 추천해요.",
      placement: "bottom",
    },
    {
      id: "shortcuts",
      target: "[data-tour=\"lab-header\"]",
      title: "단축키 & 도움말",
      content:
        "언제든 `?` 키로 전체 단축키를 볼 수 있고, 우측 상단 **도움말** 버튼에서 이 투어를 다시 시작할 수 있어요.",
      placement: "bottom",
    },
    {
      id: "end",
      target: "[data-tour=\"lab-header\"]",
      title: "준비 완료",
      content:
        "이제 ARIA를 자유롭게 탐험해 보세요. 더 깊이 알고 싶으시면 **ML Deep Dive** 투어도 준비되어 있어요.",
      placement: "center",
    },
  ],
}

const ML_DEEP_DIVE: TourScenario = {
  id: "ml-deep-dive",
  name: "ML Deep Dive",
  description: "ML 섹션을 5분간 깊이 있게 살펴봅니다.",
  estimatedMin: 5,
  steps: [
    {
      id: "ml-tool-life-prediction",
      target: "[data-tour=\"ml-tool-life-prediction\"]",
      title: "공구 수명 예측 모델",
      content:
        "Gradient-boosted 회귀 + 생존분석 하이브리드 모델이 **남은 유효 수명**을 분 단위로 예측합니다.",
      placement: "left",
    },
    {
      id: "feature-importance",
      target: "[data-tour=\"feature-importance\"]",
      title: "Feature Importance",
      content:
        "어떤 입력 변수가 예측에 **가장 큰 영향**을 주는지 보여줍니다. 순열 중요도 기반이라 해석이 안정적이에요.",
      placement: "top",
    },
    {
      id: "uncertainty-analysis",
      target: "[data-tour=\"uncertainty-analysis\"]",
      title: "불확실성 분석",
      content:
        "점 추정치뿐 아니라 **신뢰구간**을 함께 제공합니다. 구간이 넓다면 추가 데이터가 필요하다는 신호예요.",
      placement: "top",
    },
    {
      id: "shap-values",
      target: "[data-tour=\"shap-values\"]",
      title: "SHAP 기여도",
      content:
        "개별 예측값에 각 피처가 **얼마나 기여**했는지 분해해 보여줍니다. 양/음 부호로 방향도 확인하세요.",
      placement: "top",
    },
    {
      id: "survival-curve",
      target: "[data-tour=\"survival-curve\"]",
      title: "생존 곡선",
      content:
        "시간에 따른 **잔존 확률**을 그립니다. 곡선이 급하강하는 구간이 고장 위험이 급증하는 구간이에요.",
      placement: "left",
    },
  ],
}

// ── Export ────────────────────────────────────────────────────────────
export const TOUR_SCENARIOS: TourScenario[] = [FIRST_VISIT, ML_DEEP_DIVE]

// ── Helpers ───────────────────────────────────────────────────────────
export function getScenario(id: string): TourScenario | undefined {
  return TOUR_SCENARIOS.find((s) => s.id === id)
}

export function getStepByIndex(
  scenarioId: string,
  idx: number,
): TourStep | undefined {
  const scenario = getScenario(scenarioId)
  if (!scenario) return undefined
  if (idx < 0 || idx >= scenario.steps.length) return undefined
  return scenario.steps[idx]
}
