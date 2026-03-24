/**
 * Question Option Builder — Generates chips aligned to the assistant's pending question.
 *
 * Priority 1 in chip generation: if there is an active pending question,
 * chips MUST be question-aligned first, not generic-action aligned.
 *
 * Deterministic. No LLM calls.
 */

import type { PendingQuestion, QuestionShape } from "../context/pending-question-detector"
import type { SmartOption, SmartOptionFamily } from "./types"

/** 마지막 글자에 받침(종성)이 있는지 판단 — 한국어 조사 선택용 */
function hasKoreanBatchim(text: string): boolean {
  const trimmed = text.replace(/[)\]\s]+$/, "").trim()
  if (trimmed.length === 0) return false
  const lastChar = trimmed.charCodeAt(trimmed.length - 1)
  // 한글 범위: 0xAC00 ~ 0xD7A3
  if (lastChar < 0xAC00 || lastChar > 0xD7A3) return true // 영어/숫자 등 → 받침 있다고 간주
  return (lastChar - 0xAC00) % 28 !== 0
}

let questionOptionCounter = 0
function nextQuestionOptionId(shape: string): string {
  return `q_${shape}_${++questionOptionCounter}`
}

export function resetQuestionOptionCounter(): void {
  questionOptionCounter = 0
}

/**
 * Build structured options aligned to a pending question.
 * Returns SmartOption[] that should REPLACE generic chips for this turn.
 */
export function buildQuestionAlignedOptions(question: PendingQuestion): SmartOption[] {
  switch (question.shape) {
    case "binary_yes_no":
      return buildBinaryYesNo(question)
    case "binary_proceed":
      return buildBinaryProceed(question)
    case "explicit_choice":
      return buildExplicitChoice(question)
    case "constrained_options":
      return buildConstrainedOptions(question)
    case "revise_or_continue":
      return buildReviseOrContinue(question)
    case "open_ended":
    case "none":
      return []
  }
}

// ════════════════════════════════════════════════════════════════
// BINARY YES / NO
// ════════════════════════════════════════════════════════════════

function buildBinaryYesNo(question: PendingQuestion): SmartOption[] {
  const options: SmartOption[] = []
  const subject = question.extractedOptions[0] ?? ""

  options.push({
    id: nextQuestionOptionId("yes"),
    family: "action",
    label: subject ? `${subject}(으)로 진행` : "예",
    subtitle: "현재 선택 확정",
    value: subject || "yes",
    field: question.field ?? undefined,
    reason: "질문에 대한 긍정 응답",
    projectedCount: null,
    projectedDelta: null,
    preservesContext: true,
    destructive: false,
    recommended: true,
    priorityScore: 1.0,
    plan: {
      type: "apply_filter",
      patches: question.field && subject
        ? [{ op: "add", field: question.field, value: subject }]
        : [{ op: "add", field: "_action", value: "confirm" }],
    },
  })

  options.push({
    id: nextQuestionOptionId("no"),
    family: "action",
    label: "다른 조건 보기",
    subtitle: "다른 옵션 탐색",
    value: "no",
    reason: "질문에 대한 부정 응답",
    projectedCount: null,
    projectedDelta: null,
    preservesContext: true,
    destructive: false,
    recommended: false,
    priorityScore: 0.8,
    plan: {
      type: "apply_filter",
      patches: [{ op: "add", field: "_action", value: "revise" }],
    },
  })

  // Add "상관없음" as a safe third option
  options.push({
    id: nextQuestionOptionId("skip"),
    family: "action",
    label: "상관없음",
    value: "skip",
    reason: "해당 조건 건너뛰기",
    projectedCount: null,
    projectedDelta: null,
    preservesContext: true,
    destructive: false,
    recommended: false,
    priorityScore: 0.3,
    plan: {
      type: "apply_filter",
      patches: question.field
        ? [{ op: "add", field: question.field, value: "skip" }]
        : [{ op: "add", field: "_action", value: "skip" }],
    },
  })

  return options
}

// ════════════════════════════════════════════════════════════════
// BINARY PROCEED / DECLINE
// ════════════════════════════════════════════════════════════════

function buildBinaryProceed(question: PendingQuestion): SmartOption[] {
  const options: SmartOption[] = []

  if (question.extractedOptions.length >= 2) {
    // "A? 아니면 B?" → two explicit options
    for (let i = 0; i < question.extractedOptions.length; i++) {
      const opt = question.extractedOptions[i]
      options.push({
        id: nextQuestionOptionId(`choice_${i}`),
        family: "action",
        label: opt,
        value: opt,
        field: question.field ?? undefined,
        reason: `선택지 ${i + 1}`,
        projectedCount: null,
        projectedDelta: null,
        preservesContext: true,
        destructive: false,
        recommended: i === 0,
        priorityScore: 1.0 - i * 0.2,
        plan: {
          type: "apply_filter",
          patches: question.field
            ? [{ op: "add", field: question.field, value: opt }]
            : [{ op: "add", field: "_action", value: opt }],
        },
      })
    }
  } else {
    // Single subject proceed question
    const subject = question.extractedOptions[0] ?? ""
    options.push({
      id: nextQuestionOptionId("proceed"),
      family: "action",
      label: subject ? `${subject}(으)로 진행` : "진행",
      value: subject || "proceed",
      field: question.field ?? undefined,
      reason: "진행 확인",
      projectedCount: null,
      projectedDelta: null,
      preservesContext: true,
      destructive: false,
      recommended: true,
      priorityScore: 1.0,
      plan: {
        type: "apply_filter",
        patches: question.field && subject
          ? [{ op: "add", field: question.field, value: subject }]
          : [{ op: "add", field: "_action", value: "proceed" }],
      },
    })

    options.push({
      id: nextQuestionOptionId("decline"),
      family: "action",
      label: "다른 조건으로 다시 보기",
      value: "decline",
      reason: "조건 변경",
      projectedCount: null,
      projectedDelta: null,
      preservesContext: true,
      destructive: false,
      recommended: false,
      priorityScore: 0.7,
      plan: {
        type: "apply_filter",
        patches: [{ op: "add", field: "_action", value: "revise" }],
      },
    })
  }

  return options
}

// ════════════════════════════════════════════════════════════════
// EXPLICIT CHOICE (A vs B)
// ════════════════════════════════════════════════════════════════

function buildExplicitChoice(question: PendingQuestion): SmartOption[] {
  const options: SmartOption[] = []

  for (let i = 0; i < question.extractedOptions.length; i++) {
    const opt = question.extractedOptions[i]
    options.push({
      id: nextQuestionOptionId(`choice_${i}`),
      family: "action",
      label: opt,
      value: opt,
      field: question.field ?? undefined,
      reason: `선택지 ${i + 1}`,
      projectedCount: null,
      projectedDelta: null,
      preservesContext: true,
      destructive: false,
      recommended: i === 0,
      priorityScore: 1.0 - i * 0.15,
      plan: {
        type: "apply_filter",
        patches: question.field
          ? [{ op: "add", field: question.field, value: opt }]
          : [{ op: "add", field: "_action", value: opt }],
      },
    })
  }

  // Add "상관없음"
  options.push({
    id: nextQuestionOptionId("skip"),
    family: "action",
    label: "상관없음",
    value: "skip",
    projectedCount: null,
    projectedDelta: null,
    preservesContext: true,
    destructive: false,
    recommended: false,
    priorityScore: 0.3,
    plan: {
      type: "apply_filter",
      patches: question.field
        ? [{ op: "add", field: question.field, value: "skip" }]
        : [{ op: "add", field: "_action", value: "skip" }],
    },
  })

  return options
}

// ════════════════════════════════════════════════════════════════
// CONSTRAINED OPTIONS (specific values like 2날, 4날)
// ════════════════════════════════════════════════════════════════

function buildConstrainedOptions(question: PendingQuestion): SmartOption[] {
  const options: SmartOption[] = []

  for (let i = 0; i < question.extractedOptions.length; i++) {
    const opt = question.extractedOptions[i]
    options.push({
      id: nextQuestionOptionId(`opt_${i}`),
      family: "narrowing",
      label: opt,
      value: opt,
      field: question.field ?? undefined,
      reason: `사용 가능한 옵션 ${i + 1}`,
      projectedCount: null,
      projectedDelta: null,
      preservesContext: true,
      destructive: false,
      recommended: i === 0,
      priorityScore: 0.9 - i * 0.1,
      plan: {
        type: "apply_filter",
        patches: question.field
          ? [{ op: "add", field: question.field, value: opt }]
          : [{ op: "add", field: "_action", value: opt }],
      },
    })
  }

  // Add "상관없음"
  options.push({
    id: nextQuestionOptionId("skip"),
    family: "narrowing",
    label: "상관없음",
    value: "skip",
    projectedCount: null,
    projectedDelta: null,
    preservesContext: true,
    destructive: false,
    recommended: false,
    priorityScore: 0.2,
    plan: {
      type: "apply_filter",
      patches: question.field
        ? [{ op: "add", field: question.field, value: "skip" }]
        : [{ op: "add", field: "_action", value: "skip" }],
    },
  })

  return options
}

// ════════════════════════════════════════════════════════════════
// REVISE OR CONTINUE
// ════════════════════════════════════════════════════════════════

function buildReviseOrContinue(question: PendingQuestion): SmartOption[] {
  return [
    {
      id: nextQuestionOptionId("continue"),
      family: "action",
      label: "현재 조건 유지",
      value: "continue",
      reason: "현재 조건으로 진행",
      projectedCount: null,
      projectedDelta: null,
      preservesContext: true,
      destructive: false,
      recommended: true,
      priorityScore: 1.0,
      plan: {
        type: "apply_filter",
        patches: [{ op: "add", field: "_action", value: "continue" }],
      },
    },
    {
      id: nextQuestionOptionId("revise"),
      family: "action",
      label: "다른 조건으로 다시 보기",
      value: "revise",
      reason: "조건 변경 후 재검색",
      projectedCount: null,
      projectedDelta: null,
      preservesContext: true,
      destructive: false,
      recommended: false,
      priorityScore: 0.8,
      plan: {
        type: "apply_filter",
        patches: [{ op: "add", field: "_action", value: "revise" }],
      },
    },
    {
      id: nextQuestionOptionId("undo"),
      family: "action",
      label: "⟵ 이전 단계로",
      value: "undo",
      reason: "이전 단계 복귀",
      projectedCount: null,
      projectedDelta: null,
      preservesContext: true,
      destructive: false,
      recommended: false,
      priorityScore: 0.5,
      plan: {
        type: "apply_filter",
        patches: [{ op: "add", field: "_action", value: "undo" }],
      },
    },
  ]
}

// ════════════════════════════════════════════════════════════════
// CONFUSION-AWARE HELPER CHIPS
// ════════════════════════════════════════════════════════════════

/**
 * Build helper chips for confused/uncertain users.
 * These should be MERGED with question-aligned chips, not replace them.
 */
export function buildConfusionHelperOptions(
  question: PendingQuestion | null,
  confusedAbout: string | null
): SmartOption[] {
  const options: SmartOption[] = []

  // "쉽게 설명해줘"
  options.push({
    id: nextQuestionOptionId("explain_simple"),
    family: "explore",
    label: "쉽게 설명해줘",
    subtitle: "옵션들의 차이점 설명",
    value: "explain",
    reason: "사용자가 혼란스러워함",
    projectedCount: null,
    projectedDelta: null,
    preservesContext: true,
    destructive: false,
    recommended: true,
    priorityScore: 1.0,
    plan: {
      type: "apply_filter",
      patches: [{ op: "add", field: "_action", value: "explain_options" }],
    },
  })

  // "추천으로 골라줘"
  options.push({
    id: nextQuestionOptionId("delegate"),
    family: "action",
    label: "추천으로 골라줘",
    subtitle: "시스템이 최적 옵션 선택",
    value: "delegate",
    reason: "사용자가 위임을 원함",
    projectedCount: null,
    projectedDelta: null,
    preservesContext: true,
    destructive: false,
    recommended: false,
    priorityScore: 0.95,
    plan: {
      type: "apply_filter",
      patches: [{ op: "add", field: "_action", value: "delegate_choice" }],
    },
  })

  // "상관없음"
  options.push({
    id: nextQuestionOptionId("skip_confused"),
    family: "action",
    label: "상관없음",
    value: "skip",
    reason: "건너뛰기",
    projectedCount: null,
    projectedDelta: null,
    preservesContext: true,
    destructive: false,
    recommended: false,
    priorityScore: 0.8,
    plan: {
      type: "apply_filter",
      patches: question?.field
        ? [{ op: "add", field: question.field, value: "skip" }]
        : [{ op: "add", field: "_action", value: "skip" }],
    },
  })

  // Per-option explanation chips (e.g. "Square란?")
  if (question?.extractedOptions) {
    const EXCLUDED_FROM_EXPLAIN = new Set(["undo", "skip", "reset", "상관없음", "건너뛰기", "이전", "취소"])
    for (const opt of question.extractedOptions.slice(0, 3)) {
      if (EXCLUDED_FROM_EXPLAIN.has(opt.toLowerCase())) continue
      options.push({
        id: nextQuestionOptionId(`explain_${opt}`),
        family: "explore",
        label: `${opt}${hasKoreanBatchim(opt) ? "이" : ""}란?`,
        subtitle: `${opt} 설명`,
        value: opt,
        field: question.field ?? undefined,
        reason: `${opt}에 대한 설명 요청`,
        projectedCount: null,
        projectedDelta: null,
        preservesContext: true,
        destructive: false,
        recommended: false,
        priorityScore: 0.7,
        plan: {
          type: "apply_filter",
          patches: [{ op: "add", field: "_action", value: `explain_${opt}` }],
        },
      })
    }
  }

  // If confused about a specific thing
  if (confusedAbout && (!question?.extractedOptions?.includes(confusedAbout))) {
    options.push({
      id: nextQuestionOptionId("explain_specific"),
      family: "explore",
      label: `${confusedAbout} 설명해줘`,
      value: confusedAbout,
      reason: `${confusedAbout}에 대한 설명`,
      projectedCount: null,
      projectedDelta: null,
      preservesContext: true,
      destructive: false,
      recommended: false,
      priorityScore: 0.75,
      plan: {
        type: "apply_filter",
        patches: [{ op: "add", field: "_action", value: `explain_${confusedAbout}` }],
      },
    })
  }

  return options
}
