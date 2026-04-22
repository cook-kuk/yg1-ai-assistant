"use client";

/**
 * QuickActions: 섹션 컨텍스트 기반 미리 준비된 질문 칩.
 * 가로 스크롤 레이아웃, 작은 라운드 버튼.
 */

import * as React from "react";
import { Sparkles } from "lucide-react";

const QUICK_ACTION_MAP: Record<string, string[]> = {
  "ml-tool-life-prediction": [
    "ML 예측이 Sandvik 공식과 다른 이유는?",
    "Feature importance 어떻게 해석해요?",
    "XGBoost가 뭐예요? 쉽게 설명해주세요",
  ],
  "sensor-anomaly-detection": [
    "이상 스코어 높으면 바로 멈춰야 하나요?",
    "RUL 예측은 얼마나 정확해요?",
    "실제 센서는 뭘 써야 해요?",
  ],
  "causal-xai": [
    "인과추론과 상관관계의 차이는?",
    "SHAP 값 음수면 뭘 의미해요?",
    "Counterfactual이 뭐예요?",
  ],
  "bayesian-uncertainty": [
    "95% 신뢰구간 어떻게 해석해요?",
    "Gaussian Process와 Neural Net 차이는?",
  ],
  "factory-personalization": [
    "cold-start 문제가 뭐예요?",
    "Contextual Bandit이 뭐예요?",
  ],
  "doe-design": [
    "Taguchi L9가 뭐예요?",
    "실험 몇 번 하면 충분해요?",
  ],
  "survival-analysis": [
    "Kaplan-Meier 곡선 읽는 법?",
    "Weibull k=2 뭐가 의미 있어요?",
  ],
};

const DEFAULT_ACTIONS = [
  "SFM이 뭐예요?",
  "ARIA가 뭐예요?",
  "투어 시작해주세요",
];

interface QuickActionsProps {
  section?: string;
  onAction: (question: string) => void;
}

export function QuickActions({ section, onAction }: QuickActionsProps) {
  const actions =
    (section && QUICK_ACTION_MAP[section]) || DEFAULT_ACTIONS;

  return (
    <div className="w-full overflow-x-auto">
      <div className="flex items-center gap-1.5 py-1 px-1 min-w-max">
        {actions.map((q) => (
          <button
            key={q}
            type="button"
            onClick={() => onAction(q)}
            className={[
              "shrink-0 inline-flex items-center gap-1.5",
              "px-2.5 py-1 rounded-full",
              "text-[11px] font-medium",
              "bg-white dark:bg-slate-900",
              "border border-slate-200 dark:border-slate-700",
              "text-slate-700 dark:text-slate-200",
              "hover:border-teal-400 hover:text-teal-700 dark:hover:text-teal-300",
              "transition-colors",
            ].join(" ")}
            title={q}
          >
            <Sparkles className="w-3 h-3 text-teal-500" aria-hidden />
            <span className="whitespace-nowrap">{q}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

export default QuickActions;
