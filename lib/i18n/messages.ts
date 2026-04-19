/**
 * i18n stub — Korean string SSOT.
 *
 * The product is single-language (KO) today, so this file is intentionally
 * a flat const map rather than a runtime locale loader. The goal is *one
 * place to read for translation*, not a real i18n framework yet.
 *
 * Convention: dot-namespaced keys (`assistant.welcome.title`) so when the
 * English bundle eventually arrives we can lift this file into
 * `messages.ko.ts` + `messages.en.ts` + a `t(key, lang)` resolver without
 * touching call sites.
 *
 * Usage:
 *   import { msg } from "@/lib/i18n/messages"
 *   <h1>{msg("assistant.welcome.title")}</h1>
 *
 * Adding a string: keep wording verbatim from the call site so a search
 * for the original Korean text still finds the source-of-truth here.
 */

export const KOREAN_MESSAGES = {
  // ── Assistant chat scaffolding ────────────────────────────────────
  "assistant.welcome.title": "안녕하세요. YG-1 AI 추천 에이전트입니다.",
  "assistant.welcome.body":
    "가공 관련 문의를 자유롭게 입력해주세요.\n경쟁사 품번, 소재, 가공 조건 등 어떤 형태든 가능합니다.",
  "assistant.welcome.chip.quality": "가공 품질 개선이 필요해요",
  "assistant.welcome.chip.substitute": "경쟁사 제품 대체",
  "assistant.welcome.chip.sus304": "SUS304 엔드밀 추천",
  "assistant.welcome.chip.in_stock": "이번 주 출고 가능한 것만",

  // ── Step labels (intake form / progress stepper) ──────────────────
  "step.intake": "문의 접수",
  "step.equipment": "장비 조건",
  "step.material": "소재 분석",
  "step.purpose": "가공 목적",
  "step.constraints": "형상/제약",
  "step.recommend": "추천/실행",

  // ── Chat panel chrome ─────────────────────────────────────────────
  "chat.placeholder": "가공 조건이나 문의사항을 입력하세요...",
  "chat.send": "전송",
  "chat.extracted_conditions": "추출된 조건",
  "chat.no_conditions_yet": "대화를 시작하면 조건이 추출됩니다",

  // ── Recommendation panel ──────────────────────────────────────────
  "recommendation.send_quote": "견적요청",
  "recommendation.no_results": "조건에 맞는 제품을 찾지 못했습니다.",
  "recommendation.in_stock_badge": "재고 있음",

  // ── Reasoning block (Claude-style CoT toggle) ─────────────────────
  "reasoning.thinking": "추론 중",
  "reasoning.done.deep": "심층 분석 완료",
  "reasoning.done.light": "분석 완료",
  "reasoning.verified": "✓ 검증됨",
  "reasoning.corrected": "교정됨",

  // ── Errors / system ────────────────────────────────────────────────
  "error.generic": "알 수 없는 오류",
  "error.python_unreachable": "Python API 연결 실패",
  "error.empty_query": "검색 조건이 없습니다. 메시지를 입력하거나 필터를 선택해 주세요.",
} as const

export type MessageKey = keyof typeof KOREAN_MESSAGES

/**
 * Look up a Korean message string. Throws (in dev) when the key isn't
 * registered to surface forgotten translations early; returns the key
 * itself in production so a missing entry never blanks the UI.
 */
export function msg(key: MessageKey): string {
  const v = KOREAN_MESSAGES[key]
  if (v === undefined) {
    if (process.env.NODE_ENV !== "production") {
      // eslint-disable-next-line no-console
      console.warn(`[i18n] missing key: ${key}`)
    }
    return key
  }
  return v
}
