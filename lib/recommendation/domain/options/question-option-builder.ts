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
