/**
 * NL Test Suite: 100 Natural Language Cases
 *
 * Tests that the V2 orchestrator handles all categories of natural language input
 * without crashing. Uses a stub LLM provider (no real API calls).
 */

import { describe, it, expect } from "vitest"
import {
  orchestrateTurnV2,
  createInitialSessionState,
} from "../turn-orchestrator"
import type {
  RecommendationSessionState,
  TurnResult,
} from "../types"

// ── NLTestCase interface ─────────────────────────────────────
interface NLTestCase {
  id: string
  category: string
  input: string
  context?: {
    journeyPhase?: string
    constraints?: Record<string, string | number>
    pendingQuestionField?: string
    hasCandidates?: boolean
  }
  expect: {
    noError: boolean
    actionType?: string
    answerContains?: string[]
    answerNotContains?: string[]
    chipsMinCount?: number
  }
  severity: "critical" | "high" | "medium" | "low"
}

// ── Stub LLM Provider (no real API calls) ────────────────────
const stubProvider = {
  available: () => false,
  complete: async () => "",
  completeWithTools: async () => ({ text: null, toolUse: null }),
}

// ── State builder from test context ──────────────────────────
function buildStateFromContext(context?: NLTestCase["context"]): RecommendationSessionState {
  const state = createInitialSessionState()
  if (!context) return state

  if (context.journeyPhase) {
    state.journeyPhase = context.journeyPhase as any
  }
  if (context.constraints) {
    state.constraints.base = { ...context.constraints }
  }
  if (context.pendingQuestionField) {
    state.pendingQuestion = {
      field: context.pendingQuestionField,
      questionText: `${context.pendingQuestionField}을(를) 선택해주세요`,
      options: [],
      turnAsked: 0,
      context: null,
    }
  }
  if (context.hasCandidates) {
    state.resultContext = {
      candidates: [
        { productCode: "GED7210030", displayCode: "GED7210030", rank: 1, score: 92, seriesName: "ALU-POWER" },
        { productCode: "E5D7210030", displayCode: "E5D7210030", rank: 2, score: 87, seriesName: "ALU-CUT" },
      ],
      totalConsidered: 32,
      searchTimestamp: Date.now(),
      constraintsUsed: state.constraints,
    }
  }
  return state
}

// ── ALL 100 Test Cases ───────────────────────────────────────
const NL_TEST_CASES: NLTestCase[] = [
  // ═══════════════════════════════════════════════════════════
  // Category: multi_entity (10)
  // ═══════════════════════════════════════════════════════════
  {
    id: "ME-01",
    category: "multi_entity",
    input: "GMG31이랑 GMG30 차이가 뭐야?",
    expect: { noError: true },
    severity: "critical",
  },
  {
    id: "ME-02",
    category: "multi_entity",
    input: "ALU-POWER랑 ALU-CUT 중에 뭐가 좋아?",
    expect: { noError: true },
    severity: "critical",
  },
  {
    id: "ME-03",
    category: "multi_entity",
    input: "E5E83이랑 E5D72 비교해줘",
    expect: { noError: true },
    severity: "critical",
  },
  {
    id: "ME-04",
    category: "multi_entity",
    input: "I-STEEL이랑 X5070 성능 비교",
    expect: { noError: true },
    severity: "high",
  },
  {
    id: "ME-05",
    category: "multi_entity",
    input: "TiAlN 코팅이랑 YG-1 자체 코팅 뭐가 다름?",
    expect: { noError: true },
    severity: "high",
  },
  {
    id: "ME-06",
    category: "multi_entity",
    input: "엔드밀 4날 vs 6날 차이 알려줘",
    expect: { noError: true },
    severity: "medium",
  },
  {
    id: "ME-07",
    category: "multi_entity",
    input: "초경 드릴이랑 HSS 드릴 뭐가 나아?",
    expect: { noError: true },
    severity: "medium",
  },
  {
    id: "ME-08",
    category: "multi_entity",
    input: "DREAM DRILL이랑 DREAM DRILL GOLD 차이?",
    expect: { noError: true },
    severity: "critical",
  },
  {
    id: "ME-09",
    category: "multi_entity",
    input: "V7 PLUS랑 V7 PRO 뭐가 더 좋아?",
    expect: { noError: true },
    severity: "high",
  },
  {
    id: "ME-10",
    category: "multi_entity",
    input: "탭 M8이랑 M10 둘 다 보여줘",
    expect: { noError: true },
    severity: "medium",
  },

  // ═══════════════════════════════════════════════════════════
  // Category: specific_field (10)
  // ═══════════════════════════════════════════════════════════
  {
    id: "SF-01",
    category: "specific_field",
    input: "생크 타입이 뭐가 있어?",
    context: { journeyPhase: "narrowing", constraints: { toolType: "엔드밀" } },
    expect: { noError: true },
    severity: "high",
  },
  {
    id: "SF-02",
    category: "specific_field",
    input: "코팅 종류 알려줘",
    context: { journeyPhase: "narrowing", constraints: { toolType: "드릴" } },
    expect: { noError: true },
    severity: "high",
  },
  {
    id: "SF-03",
    category: "specific_field",
    input: "4날로 해줘",
    context: { journeyPhase: "narrowing", constraints: { toolType: "엔드밀", material: "steel" }, pendingQuestionField: "flute" },
    expect: { noError: true },
    severity: "critical",
  },
  {
    id: "SF-04",
    category: "specific_field",
    input: "직경 10mm 이상만",
    context: { journeyPhase: "narrowing", constraints: { toolType: "엔드밀" } },
    expect: { noError: true },
    severity: "high",
  },
  {
    id: "SF-05",
    category: "specific_field",
    input: "날 길이 30mm 짜리",
    context: { journeyPhase: "narrowing", constraints: { toolType: "엔드밀", diameter: 10 } },
    expect: { noError: true },
    severity: "medium",
  },
  {
    id: "SF-06",
    category: "specific_field",
    input: "전체 길이 100mm 이하로",
    context: { journeyPhase: "narrowing", constraints: { toolType: "드릴" } },
    expect: { noError: true },
    severity: "medium",
  },
  {
    id: "SF-07",
    category: "specific_field",
    input: "TiAlN 코팅으로",
    context: { journeyPhase: "narrowing", constraints: { toolType: "엔드밀", material: "steel" }, pendingQuestionField: "coating" },
    expect: { noError: true },
    severity: "high",
  },
  {
    id: "SF-08",
    category: "specific_field",
    input: "직경 범위 6~12mm",
    context: { journeyPhase: "intake" },
    expect: { noError: true },
    severity: "medium",
  },
  {
    id: "SF-09",
    category: "specific_field",
    input: "R0.5 볼엔드밀",
    expect: { noError: true },
    severity: "high",
  },
  {
    id: "SF-10",
    category: "specific_field",
    input: "헬리컬 타입으로 해줘",
    context: { journeyPhase: "narrowing", constraints: { toolType: "엔드밀" } },
    expect: { noError: true },
    severity: "low",
  },

  // ═══════════════════════════════════════════════════════════
  // Category: db_limit (10) — should NOT hallucinate
  // ═══════════════════════════════════════════════════════════
  {
    id: "DB-01",
    category: "db_limit",
    input: "이 제품 가격이 얼마야?",
    context: { journeyPhase: "results_displayed", hasCandidates: true },
    expect: { noError: true },
    severity: "critical",
  },
  {
    id: "DB-02",
    category: "db_limit",
    input: "무게가 얼마나 나가?",
    context: { journeyPhase: "results_displayed", hasCandidates: true },
    expect: { noError: true },
    severity: "high",
  },
  {
    id: "DB-03",
    category: "db_limit",
    input: "제조국이 어디야?",
    context: { journeyPhase: "results_displayed", hasCandidates: true },
    expect: { noError: true },
    severity: "high",
  },
  {
    id: "DB-04",
    category: "db_limit",
    input: "납기일이 얼마나 걸려?",
    expect: { noError: true },
    severity: "high",
  },
  {
    id: "DB-05",
    category: "db_limit",
    input: "이 제품 보증기간이 어떻게 돼?",
    context: { journeyPhase: "results_displayed", hasCandidates: true },
    expect: { noError: true },
    severity: "medium",
  },
  {
    id: "DB-06",
    category: "db_limit",
    input: "할인율 적용되나요?",
    expect: { noError: true },
    severity: "medium",
  },
  {
    id: "DB-07",
    category: "db_limit",
    input: "MOQ가 몇 개야?",
    expect: { noError: true },
    severity: "medium",
  },
  {
    id: "DB-08",
    category: "db_limit",
    input: "재연마 서비스 가격",
    expect: { noError: true },
    severity: "low",
  },
  {
    id: "DB-09",
    category: "db_limit",
    input: "이 제품 인증서 있어?",
    context: { journeyPhase: "results_displayed", hasCandidates: true },
    expect: { noError: true },
    severity: "low",
  },
  {
    id: "DB-10",
    category: "db_limit",
    input: "수출 규제 품목이야?",
    expect: { noError: true },
    severity: "low",
  },

  // ═══════════════════════════════════════════════════════════
  // Category: side_question (10)
  // ═══════════════════════════════════════════════════════════
  {
    id: "SQ-01",
    category: "side_question",
    input: "YG-1 사우디 지사 있어?",
    context: { journeyPhase: "narrowing", constraints: { toolType: "엔드밀" }, pendingQuestionField: "material" },
    expect: { noError: true },
    severity: "high",
  },
  {
    id: "SQ-02",
    category: "side_question",
    input: "공장이 어디에 있어?",
    expect: { noError: true },
    severity: "high",
  },
  {
    id: "SQ-03",
    category: "side_question",
    input: "CEO 이름이 뭐야?",
    expect: { noError: true },
    severity: "medium",
  },
  {
    id: "SQ-04",
    category: "side_question",
    input: "고객센터 전화번호 알려줘",
    expect: { noError: true },
    severity: "medium",
  },
  {
    id: "SQ-05",
    category: "side_question",
    input: "YG-1 주가가 얼마야?",
    expect: { noError: true },
    severity: "low",
  },
  {
    id: "SQ-06",
    category: "side_question",
    input: "YG-1이 상장 회사야?",
    expect: { noError: true },
    severity: "low",
  },
  {
    id: "SQ-07",
    category: "side_question",
    input: "직원이 몇 명이야?",
    expect: { noError: true },
    severity: "low",
  },
  {
    id: "SQ-08",
    category: "side_question",
    input: "경쟁사가 어디야?",
    expect: { noError: true },
    severity: "medium",
  },
  {
    id: "SQ-09",
    category: "side_question",
    input: "YG-1 채용 공고 있어?",
    expect: { noError: true },
    severity: "low",
  },
  {
    id: "SQ-10",
    category: "side_question",
    input: "YG-1 매출액이 얼마야?",
    expect: { noError: true },
    severity: "low",
  },

  // ═══════════════════════════════════════════════════════════
  // Category: multi_intent (10)
  // ═══════════════════════════════════════════════════════════
  {
    id: "MI-01",
    category: "multi_intent",
    input: "ALU-POWER 정보랑 재고 같이 알려줘",
    expect: { noError: true },
    severity: "critical",
  },
  {
    id: "MI-02",
    category: "multi_intent",
    input: "1번이랑 2번 비교하고 더 좋은 걸로 추천해줘",
    context: { journeyPhase: "results_displayed", hasCandidates: true },
    expect: { noError: true },
    severity: "critical",
  },
  {
    id: "MI-03",
    category: "multi_intent",
    input: "드릴 추천해주고 절삭 조건도 알려줘",
    expect: { noError: true },
    severity: "high",
  },
  {
    id: "MI-04",
    category: "multi_intent",
    input: "SUS304용 엔드밀 추천 + 코팅 비교",
    expect: { noError: true },
    severity: "high",
  },
  {
    id: "MI-05",
    category: "multi_intent",
    input: "이 제품 스펙 보여주고 대안도 추천해줘",
    context: { journeyPhase: "results_displayed", hasCandidates: true },
    expect: { noError: true },
    severity: "high",
  },
  {
    id: "MI-06",
    category: "multi_intent",
    input: "재고 있는 것만 보여주고 가격순으로 정렬",
    context: { journeyPhase: "results_displayed", hasCandidates: true },
    expect: { noError: true },
    severity: "medium",
  },
  {
    id: "MI-07",
    category: "multi_intent",
    input: "알루미늄 가공 팁이랑 공구 추천 동시에",
    expect: { noError: true },
    severity: "medium",
  },
  {
    id: "MI-08",
    category: "multi_intent",
    input: "이 드릴 수명이랑 교체 주기 알려줘",
    context: { journeyPhase: "results_displayed", hasCandidates: true },
    expect: { noError: true },
    severity: "medium",
  },
  {
    id: "MI-09",
    category: "multi_intent",
    input: "탭 M6 재고 확인하고 없으면 M8도 찾아줘",
    expect: { noError: true },
    severity: "high",
  },
  {
    id: "MI-10",
    category: "multi_intent",
    input: "3번 제품 상세 스펙이랑 절삭 조건 둘 다",
    context: { journeyPhase: "results_displayed", hasCandidates: true },
    expect: { noError: true },
    severity: "medium",
  },

  // ═══════════════════════════════════════════════════════════
  // Category: natural_language (10)
  // ═══════════════════════════════════════════════════════════
  {
    id: "NL-01",
    category: "natural_language",
    input: "걔네 뭐가 달라?",
    context: { journeyPhase: "results_displayed", hasCandidates: true },
    expect: { noError: true },
    severity: "high",
  },
  {
    id: "NL-02",
    category: "natural_language",
    input: "ㅇㅇ 그걸로",
    context: { journeyPhase: "narrowing", pendingQuestionField: "coating" },
    expect: { noError: true },
    severity: "high",
  },
  {
    id: "NL-03",
    category: "natural_language",
    input: "몰라 아무거나",
    context: { journeyPhase: "narrowing", pendingQuestionField: "flute" },
    expect: { noError: true },
    severity: "medium",
  },
  {
    id: "NL-04",
    category: "natural_language",
    input: "그거 재고 있어?",
    context: { journeyPhase: "results_displayed", hasCandidates: true },
    expect: { noError: true },
    severity: "high",
  },
  {
    id: "NL-05",
    category: "natural_language",
    input: "?",
    expect: { noError: true },
    severity: "medium",
  },
  {
    id: "NL-06",
    category: "natural_language",
    input: "ㄱㅅ",
    expect: { noError: true },
    severity: "low",
  },
  {
    id: "NL-07",
    category: "natural_language",
    input: "ㅋㅋ 좋아 그럼 추천해봐",
    expect: { noError: true },
    severity: "medium",
  },
  {
    id: "NL-08",
    category: "natural_language",
    input: "아 그니까 아까 그거",
    context: { journeyPhase: "post_result_exploration", hasCandidates: true },
    expect: { noError: true },
    severity: "high",
  },
  {
    id: "NL-09",
    category: "natural_language",
    input: "넹",
    context: { journeyPhase: "narrowing", pendingQuestionField: "material" },
    expect: { noError: true },
    severity: "medium",
  },
  {
    id: "NL-10",
    category: "natural_language",
    input: "흠 잘 모르겠는데 알아서 해줘",
    context: { journeyPhase: "narrowing", constraints: { toolType: "엔드밀" } },
    expect: { noError: true },
    severity: "medium",
  },

  // ═══════════════════════════════════════════════════════════
  // Category: post_result (10)
  // ═══════════════════════════════════════════════════════════
  {
    id: "PR-01",
    category: "post_result",
    input: "왜 이걸 추천해줬어?",
    context: { journeyPhase: "results_displayed", hasCandidates: true },
    expect: { noError: true },
    severity: "critical",
  },
  {
    id: "PR-02",
    category: "post_result",
    input: "재고 있는 것만 보여줘",
    context: { journeyPhase: "results_displayed", hasCandidates: true },
    expect: { noError: true },
    severity: "critical",
  },
  {
    id: "PR-03",
    category: "post_result",
    input: "3날로 바꿔줘",
    context: { journeyPhase: "results_displayed", hasCandidates: true },
    expect: { noError: true },
    severity: "high",
  },
  {
    id: "PR-04",
    category: "post_result",
    input: "1번 vs 2번 비교",
    context: { journeyPhase: "results_displayed", hasCandidates: true },
    expect: { noError: true },
    severity: "critical",
  },
  {
    id: "PR-05",
    category: "post_result",
    input: "더 싼 거 없어?",
    context: { journeyPhase: "results_displayed", hasCandidates: true },
    expect: { noError: true },
    severity: "high",
  },
  {
    id: "PR-06",
    category: "post_result",
    input: "다른 코팅 옵션은?",
    context: { journeyPhase: "results_displayed", hasCandidates: true },
    expect: { noError: true },
    severity: "medium",
  },
  {
    id: "PR-07",
    category: "post_result",
    input: "2번 제품 절삭 조건 알려줘",
    context: { journeyPhase: "results_displayed", hasCandidates: true },
    expect: { noError: true },
    severity: "high",
  },
  {
    id: "PR-08",
    category: "post_result",
    input: "이것보다 긴 거 있어?",
    context: { journeyPhase: "results_displayed", hasCandidates: true },
    expect: { noError: true },
    severity: "medium",
  },
  {
    id: "PR-09",
    category: "post_result",
    input: "1번으로 할게",
    context: { journeyPhase: "results_displayed", hasCandidates: true },
    expect: { noError: true },
    severity: "high",
  },
  {
    id: "PR-10",
    category: "post_result",
    input: "더 보여줘",
    context: { journeyPhase: "results_displayed", hasCandidates: true },
    expect: { noError: true },
    severity: "medium",
  },

  // ═══════════════════════════════════════════════════════════
  // Category: back_undo (5)
  // ═══════════════════════════════════════════════════════════
  {
    id: "BU-01",
    category: "back_undo",
    input: "이전으로 돌아가줘",
    context: { journeyPhase: "narrowing", constraints: { toolType: "엔드밀", material: "steel" } },
    expect: { noError: true },
    severity: "critical",
  },
  {
    id: "BU-02",
    category: "back_undo",
    input: "처음부터 다시 하자",
    context: { journeyPhase: "results_displayed", hasCandidates: true, constraints: { toolType: "드릴", diameter: 10 } },
    expect: { noError: true },
    severity: "critical",
  },
  {
    id: "BU-03",
    category: "back_undo",
    input: "코팅 빼고 다시 검색해줘",
    context: { journeyPhase: "results_displayed", hasCandidates: true, constraints: { toolType: "엔드밀", coating: "TiAlN" } },
    expect: { noError: true },
    severity: "high",
  },
  {
    id: "BU-04",
    category: "back_undo",
    input: "아까 소재 선택 다시",
    context: { journeyPhase: "narrowing", constraints: { toolType: "엔드밀", material: "aluminum" } },
    expect: { noError: true },
    severity: "high",
  },
  {
    id: "BU-05",
    category: "back_undo",
    input: "취소",
    context: { journeyPhase: "narrowing", constraints: { toolType: "엔드밀" }, pendingQuestionField: "material" },
    expect: { noError: true },
    severity: "medium",
  },
  {
    id: "BU-06",
    category: "back_undo",
    input: "방금 거 취소하고 다시",
    context: { journeyPhase: "results_displayed", hasCandidates: true, constraints: { toolType: "엔드밀", material: "steel" } },
    expect: { noError: true },
    severity: "high",
  },
  {
    id: "BU-07",
    category: "back_undo",
    input: "소재 다시 선택할게",
    context: { journeyPhase: "narrowing", constraints: { toolType: "드릴", material: "stainless" } },
    expect: { noError: true },
    severity: "high",
  },
  {
    id: "BU-08",
    category: "back_undo",
    input: "직경 변경해줘 6mm로",
    context: { journeyPhase: "narrowing", constraints: { toolType: "엔드밀", diameter: 10 } },
    expect: { noError: true },
    severity: "medium",
  },
  {
    id: "BU-09",
    category: "back_undo",
    input: "아까 드릴 말고 엔드밀로",
    context: { journeyPhase: "narrowing", constraints: { toolType: "드릴" } },
    expect: { noError: true },
    severity: "high",
  },
  {
    id: "BU-10",
    category: "back_undo",
    input: "리셋",
    context: { journeyPhase: "results_displayed", hasCandidates: true, constraints: { toolType: "엔드밀", material: "aluminum", diameter: 8 } },
    expect: { noError: true },
    severity: "critical",
  },

  // ═══════════════════════════════════════════════════════════
  // Category: edge_case (15)
  // ═══════════════════════════════════════════════════════════
  {
    id: "EC-01",
    category: "edge_case",
    input: "",
    expect: { noError: true },
    severity: "critical",
  },
  {
    id: "EC-02",
    category: "edge_case",
    input: "asdfghjkl",
    expect: { noError: true },
    severity: "high",
  },
  {
    id: "EC-03",
    category: "edge_case",
    input: "🔨🔧⚙️",
    expect: { noError: true },
    severity: "medium",
  },
  {
    id: "EC-04",
    category: "edge_case",
    input: "SUPER-MEGA-DRILL-9000X 시리즈 추천해줘",
    expect: { noError: true },
    severity: "high",
  },
  {
    id: "EC-05",
    category: "edge_case",
    input: "이 제품 가격 5만원 이하로 알려줘",
    expect: { noError: true },
    severity: "high",
  },
  {
    id: "EC-06",
    category: "edge_case",
    input: "이걸로 할게",
    context: { journeyPhase: "intake" },
    expect: { noError: true },
    severity: "high",
  },
  {
    id: "EC-07",
    category: "edge_case",
    input: "     ",
    expect: { noError: true },
    severity: "medium",
  },
  {
    id: "EC-08",
    category: "edge_case",
    input: "SELECT * FROM products WHERE 1=1; DROP TABLE products;",
    expect: { noError: true },
    severity: "critical",
  },
  {
    id: "EC-09",
    category: "edge_case",
    input: "<script>alert('xss')</script>",
    expect: { noError: true },
    severity: "critical",
  },
  {
    id: "EC-10",
    category: "edge_case",
    input: "a".repeat(5000),
    expect: { noError: true },
    severity: "medium",
  },
  {
    id: "EC-11",
    category: "edge_case",
    input: "엔드밀 추천해줘\n\n\n\n드릴도 추천해줘",
    expect: { noError: true },
    severity: "medium",
  },
  {
    id: "EC-12",
    category: "edge_case",
    input: "제품코드 GED7210030",
    expect: { noError: true },
    severity: "high",
  },
  {
    id: "EC-13",
    category: "edge_case",
    input: "직경 -5mm",
    expect: { noError: true },
    severity: "medium",
  },
  {
    id: "EC-14",
    category: "edge_case",
    input: "직경 999999mm 엔드밀",
    expect: { noError: true },
    severity: "medium",
  },
  {
    id: "EC-15",
    category: "edge_case",
    input: "안녕 반가워 오늘 날씨 좋다 근데 엔드밀 하나만",
    expect: { noError: true },
    severity: "low",
  },
  {
    id: "EC-16",
    category: "edge_case",
    input: "null",
    expect: { noError: true },
    severity: "medium",
  },
  {
    id: "EC-17",
    category: "edge_case",
    input: "undefined",
    expect: { noError: true },
    severity: "medium",
  },
  {
    id: "EC-18",
    category: "edge_case",
    input: "0",
    expect: { noError: true },
    severity: "low",
  },
  {
    id: "EC-19",
    category: "edge_case",
    input: "{}",
    expect: { noError: true },
    severity: "low",
  },
  {
    id: "EC-20",
    category: "edge_case",
    input: "엔드밀 엔드밀 엔드밀 엔드밀 엔드밀 엔드밀 엔드밀 엔드밀",
    expect: { noError: true },
    severity: "low",
  },
]

// ── Verify we have exactly 100 cases ─────────────────────────
const EXPECTED_TOTAL = 100
const categories = [...new Set(NL_TEST_CASES.map((tc) => tc.category))]

// ── Test Suite ───────────────────────────────────────────────
describe("NL Test Suite: 100 Natural Language Cases", () => {
  // Group by category
  for (const category of categories) {
    describe(`Category: ${category}`, () => {
      const cases = NL_TEST_CASES.filter((tc) => tc.category === category)

      for (const tc of cases) {
        it(`[${tc.severity}] ${tc.id}: ${tc.input.slice(0, 40)}${tc.input.length > 40 ? "..." : ""}`, async () => {
          const state = buildStateFromContext(tc.context)

          // Should not throw
          const result: TurnResult = await orchestrateTurnV2(
            tc.input,
            state,
            stubProvider as any
          )

          // Basic assertions that always apply
          expect(result).toBeDefined()
          expect(result.answer).toBeDefined()
          expect(result.sessionState.turnCount).toBe(state.turnCount + 1)

          // noError check
          if (tc.expect.noError) {
            expect(result.trace).toBeDefined()
          }

          // chipsMinCount
          if (tc.expect.chipsMinCount != null) {
            expect(result.chips.length).toBeGreaterThanOrEqual(
              tc.expect.chipsMinCount
            )
          }
        })
      }
    })
  }

  // Summary test
  it("prints test summary report", () => {
    const cats = [...new Set(NL_TEST_CASES.map((tc) => tc.category))]
    const report = cats.map((cat) => {
      const cases = NL_TEST_CASES.filter((tc) => tc.category === cat)
      return `  ${cat}: ${cases.length} cases`
    })
    console.log(
      `\n═══ NL Test Suite Summary ═══\nTotal: ${NL_TEST_CASES.length} cases\n${report.join("\n")}`
    )
    expect(NL_TEST_CASES.length).toBe(EXPECTED_TOTAL)
  })
})
