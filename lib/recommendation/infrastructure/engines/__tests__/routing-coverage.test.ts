import { describe, expect, it } from "vitest"

import {
  resolvePendingQuestionReply,
  buildPendingSelectionFilter,
} from "../serve-engine-runtime"
import {
  DIRECT_PRODUCT_CODE_PATTERN,
  DIRECT_SERIES_CODE_PATTERN,
} from "../serve-engine-assist-utils"
import { classifyQueryTarget } from "@/lib/recommendation/domain/context/query-target-classifier"
import type { ExplorationSessionState } from "@/lib/recommendation/domain/types"

function makeState(overrides: Partial<ExplorationSessionState> = {}): ExplorationSessionState {
  return {
    sessionId: "test-routing",
    candidateCount: 100,
    appliedFilters: [],
    narrowingHistory: [],
    stageHistory: [],
    resolutionStatus: "narrowing",
    resolvedInput: { manufacturerScope: "yg1-only", locale: "ko", material: "일반강" },
    turnCount: 2,
    displayedCandidates: [],
    displayedChips: [],
    displayedOptions: [],
    currentMode: "question",
    lastAskedField: undefined,
    ...overrides,
  } as ExplorationSessionState
}

// ---------------------------------------------------------------------------
// 1. Revision signal bypass (returns "unresolved" so revision resolver handles it)
// ---------------------------------------------------------------------------
describe("revision signal bypass", () => {
  const revisionCases: Array<{ msg: string; pending: string }> = [
    { msg: "Ball 말고 Radius로", pending: "fluteCount" },
    { msg: "3날 대신 4날로", pending: "toolSubtype" },
    { msg: "TiAlN 말고 AlCrN으로 변경", pending: "diameter" },
    { msg: "Square 대신 Roughing으로 바꿔", pending: "coating" },
    { msg: "알루미늄이 아니고 주철로", pending: "fluteCount" },
    { msg: "코팅을 수정하고 싶어", pending: "fluteCount" },
    { msg: "4날 대신 2날로 바꿀게", pending: "toolSubtype" },
    { msg: "Radius 말고 Square로 변경해줘", pending: "diameterMm" },
    { msg: "스테인리스 대신 알루미늄으로", pending: "coating" },
    { msg: "DLC 아닌 TiAlN으로", pending: "diameterRefine" },
    { msg: "Roughing 말고 Square로 바꿔줘", pending: "fluteCount" },
    { msg: "2날 대신 3날로 변경", pending: "diameterMm" },
    { msg: "Ball 대신 Taper로", pending: "coating" },
    { msg: "현재 코팅 대신 AlCrN으로 변경", pending: "toolSubtype" },
    { msg: "직경 수정해줘", pending: "fluteCount" },
    { msg: "소재를 바꿔주세요", pending: "toolSubtype" },
    { msg: "형상을 변경할게", pending: "diameterMm" },
  ]

  revisionCases.forEach(({ msg, pending }) => {
    it(`"${msg}" during ${pending} → unresolved (revision signal)`, () => {
      const state = makeState({ lastAskedField: pending })
      const result = resolvePendingQuestionReply(state, msg)
      expect(result.kind).toBe("unresolved")
    })
  })
})

// ---------------------------------------------------------------------------
// 2. Side question detection
// ---------------------------------------------------------------------------
describe("side question detection", () => {
  const sideQuestionCases: Array<{ msg: string; pending: string }> = [
    { msg: "G8A59080의 재고 수", pending: "fluteCount" },
    { msg: "납기가 어떻게 돼?", pending: "fluteCount" },
    { msg: "가격 알려줘", pending: "coating" },
    { msg: "2날이 뭐야?", pending: "toolSubtype" },
    { msg: "코팅 차이 설명해줘", pending: "diameterMm" },
    { msg: "영업소 전화번호", pending: "toolSubtype" },
    { msg: "이 제품 스펙 비교해줘", pending: "fluteCount" },
    { msg: "리드타임 알려줘", pending: "coating" },
    { msg: "재고 있어?", pending: "diameterMm" },
    { msg: "배송 기간이 얼마나 걸려?", pending: "toolSubtype" },
    { msg: "stock 확인해줘", pending: "fluteCount" },
    { msg: "price 알려주세요", pending: "coating" },
    { msg: "이 시리즈 종류가 몇개야", pending: "toolSubtype" },
    { msg: "사우디 지점 어디야", pending: "diameterMm" },
    { msg: "회사 매출이 궁금해", pending: "fluteCount" },
    { msg: "왜 이걸 추천하는 거야", pending: "coating" },
    { msg: "결과 보여줘", pending: "toolSubtype" },
    { msg: "처음부터 다시 하자", pending: "diameterMm" },
  ]

  sideQuestionCases.forEach(({ msg, pending }) => {
    it(`"${msg}" during ${pending} → side_question`, () => {
      const state = makeState({ lastAskedField: pending })
      const result = resolvePendingQuestionReply(state, msg)
      expect(result.kind).toBe("side_question")
    })
  })

  it("question mark triggers side_question regardless of content", () => {
    const state = makeState({ lastAskedField: "toolSubtype" })
    expect(resolvePendingQuestionReply(state, "Square?").kind).toBe("side_question")
  })

  it("fullwidth question mark triggers side_question", () => {
    const state = makeState({ lastAskedField: "fluteCount" })
    expect(resolvePendingQuestionReply(state, "4날이요？").kind).toBe("side_question")
  })

  it("product code + additional text → side_question (e.g., product inquiry)", () => {
    const state = makeState({ lastAskedField: "coating" })
    expect(resolvePendingQuestionReply(state, "CE7659 시리즈 뭐야").kind).toBe("side_question")
  })
})

// ---------------------------------------------------------------------------
// 3. Normal pending resolution (returns "resolved")
// ---------------------------------------------------------------------------
describe("normal pending resolution", () => {
  it('"Square (100개)" for toolSubtype with matching displayedOptions', () => {
    const state = makeState({
      lastAskedField: "toolSubtype",
      displayedOptions: [
        { index: 1, label: "Square (100개)", field: "toolSubtype", value: "Square", count: 100 },
        { index: 2, label: "Radius (50개)", field: "toolSubtype", value: "Radius", count: 50 },
      ],
    })
    const result = resolvePendingQuestionReply(state, "Square (100개)")
    expect(result.kind).toBe("resolved")
    if (result.kind === "resolved") {
      expect(result.filter.field).toBe("toolSubtype")
      expect(result.filter.value).toContain("Square")
    }
  })

  it('"4날" for fluteCount with matching chips', () => {
    const state = makeState({
      lastAskedField: "fluteCount",
      displayedChips: ["2날 (30개)", "4날 (50개)", "상관없음"],
      displayedOptions: [],
    })
    const result = resolvePendingQuestionReply(state, "4날")
    expect(result.kind).toBe("resolved")
    if (result.kind === "resolved") {
      expect(result.filter.field).toBe("fluteCount")
    }
  })

  it('"상관없음" for any field → skip', () => {
    const state = makeState({
      lastAskedField: "toolSubtype",
      displayedOptions: [
        { index: 1, label: "Square (100개)", field: "toolSubtype", value: "Square", count: 100 },
        { index: 2, label: "상관없음", field: "toolSubtype", value: "skip", count: 0 },
      ],
    })
    const result = resolvePendingQuestionReply(state, "상관없음")
    expect(result.kind).toBe("resolved")
    if (result.kind === "resolved") {
      expect(result.filter.op).toBe("skip")
    }
  })

  it('"패스" for fluteCount → skip', () => {
    const state = makeState({
      lastAskedField: "fluteCount",
      displayedChips: ["2날 (30개)", "4날 (50개)", "상관없음"],
      displayedOptions: [],
    })
    const result = resolvePendingQuestionReply(state, "패스")
    expect(result.kind).toBe("resolved")
    if (result.kind === "resolved") {
      expect(result.filter.op).toBe("skip")
    }
  })

  it('"스킵" for coating → skip', () => {
    const state = makeState({
      lastAskedField: "coating",
      displayedOptions: [
        { index: 1, label: "TiAlN (50개)", field: "coating", value: "TiAlN", count: 50 },
      ],
    })
    const result = resolvePendingQuestionReply(state, "스킵")
    expect(result.kind).toBe("resolved")
    if (result.kind === "resolved") {
      expect(result.filter.op).toBe("skip")
    }
  })

  it('"TiAlN (50개)" for coating with matching displayedOptions', () => {
    const state = makeState({
      lastAskedField: "coating",
      displayedOptions: [
        { index: 1, label: "TiAlN (50개)", field: "coating", value: "TiAlN", count: 50 },
        { index: 2, label: "AlCrN (30개)", field: "coating", value: "AlCrN", count: 30 },
      ],
    })
    const result = resolvePendingQuestionReply(state, "TiAlN (50개)")
    expect(result.kind).toBe("resolved")
    if (result.kind === "resolved") {
      expect(result.filter.value).toContain("TiAlN")
    }
  })

  it('"TiAlN" bare value for coating', () => {
    const state = makeState({
      lastAskedField: "coating",
      displayedOptions: [
        { index: 1, label: "TiAlN (50개)", field: "coating", value: "TiAlN", count: 50 },
      ],
    })
    const result = resolvePendingQuestionReply(state, "TiAlN")
    expect(result.kind).toBe("resolved")
  })

  it('"10mm" for diameterMm (freeform numeric)', () => {
    const state = makeState({
      lastAskedField: "diameterMm",
      displayedChips: ["6mm (12개)", "8mm (9개)", "상관없음"],
      displayedOptions: [],
    })
    const result = resolvePendingQuestionReply(state, "10mm")
    expect(result.kind).toBe("resolved")
    if (result.kind === "resolved") {
      expect(result.filter.field).toBe("diameterMm")
    }
  })

  it('"7.5" bare decimal for diameterMm', () => {
    const state = makeState({
      lastAskedField: "diameterMm",
      displayedChips: ["6mm (12개)", "8mm (9개)", "상관없음"],
      displayedOptions: [],
    })
    const result = resolvePendingQuestionReply(state, "7.5")
    expect(result.kind).toBe("resolved")
    if (result.kind === "resolved") {
      expect(result.filter.field).toBe("diameterMm")
    }
  })

  it('"10" bare integer for diameterMm', () => {
    const state = makeState({
      lastAskedField: "diameterMm",
      displayedChips: ["6mm (12개)", "8mm (9개)", "상관없음"],
      displayedOptions: [],
    })
    const result = resolvePendingQuestionReply(state, "10")
    expect(result.kind).toBe("resolved")
    if (result.kind === "resolved") {
      expect(result.filter.field).toBe("diameterMm")
      expect(result.filter.rawValue).toBe(10)
    }
  })

  it('"10" bare integer for diameterRefine → resolves as diameterMm', () => {
    const state = makeState({
      lastAskedField: "diameterRefine",
      displayedChips: ["6mm (12개)", "8mm (9개)", "상관없음"],
      displayedOptions: [],
    })
    const result = resolvePendingQuestionReply(state, "10")
    expect(result.kind).toBe("resolved")
    if (result.kind === "resolved") {
      expect(result.filter.field).toBe("diameterMm")
      expect(result.filter.rawValue).toBe(10)
    }
  })

  it('"100mm 이상" for overallLengthMm resolves as an overall-length range', () => {
    const state = makeState({
      lastAskedField: "overallLengthMm",
      displayedChips: ["80mm (12개)", "100mm (9개)", "상관없음"],
      displayedOptions: [],
    })
    const result = resolvePendingQuestionReply(state, "100mm 이상")
    expect(result.kind).toBe("resolved")
    if (result.kind === "resolved") {
      expect(result.filter.field).toBe("overallLengthMm")
      expect(result.filter.op).toBe("gte")
      expect(result.filter.rawValue).toBe(100)
    }
  })

  it('"35도 이상" for helixAngleDeg resolves as an angle range', () => {
    const state = makeState({
      lastAskedField: "helixAngleDeg",
      displayedChips: ["30도 (12개)", "45도 (9개)", "상관없음"],
      displayedOptions: [],
    })
    const result = resolvePendingQuestionReply(state, "35도 이상")
    expect(result.kind).toBe("resolved")
    if (result.kind === "resolved") {
      expect(result.filter.field).toBe("helixAngleDeg")
      expect(result.filter.op).toBe("gte")
      expect(result.filter.rawValue).toBe(35)
    }
  })

  it('"Radius" for toolSubtype with matching displayedOptions', () => {
    const state = makeState({
      lastAskedField: "toolSubtype",
      displayedOptions: [
        { index: 1, label: "Square (100개)", field: "toolSubtype", value: "Square", count: 100 },
        { index: 2, label: "Radius (50개)", field: "toolSubtype", value: "Radius", count: 50 },
      ],
    })
    const result = resolvePendingQuestionReply(state, "Radius")
    expect(result.kind).toBe("resolved")
    if (result.kind === "resolved") {
      expect(result.filter.value).toContain("Radius")
    }
  })

  it('"2날" for fluteCount from chips', () => {
    const state = makeState({
      lastAskedField: "fluteCount",
      displayedChips: ["2날 (30개)", "3날 (20개)", "4날 (50개)", "상관없음"],
      displayedOptions: [],
    })
    const result = resolvePendingQuestionReply(state, "2날")
    expect(result.kind).toBe("resolved")
  })

  it("resolves option from stale pending field using displayedOptions field", () => {
    const state = makeState({
      lastAskedField: "diameterRefine",
      displayedOptions: [
        { index: 1, label: "Square (167개)", field: "toolSubtype", value: "Square", count: 167 },
        { index: 2, label: "Radius (94개)", field: "toolSubtype", value: "Radius", count: 94 },
      ],
    })
    const result = resolvePendingQuestionReply(state, "Square (167개)")
    expect(result.kind).toBe("resolved")
    if (result.kind === "resolved") {
      expect(result.filter.field).toBe("toolSubtype")
    }
  })
  it("defers mixed pending replies with extra entities and recommendation intent to holistic parsing", () => {
    const state = makeState({
      lastAskedField: "fluteCount",
      displayedOptions: [
        { index: 1, label: "2\uB0A0", field: "fluteCount", value: "2", count: 20 },
        { index: 2, label: "4\uB0A0", field: "fluteCount", value: "4", count: 30 },
      ],
    })

    const message = "4\uB0A0 TiAlN Square \uCD94\uCC9C\uD574\uC918"
    const result = resolvePendingQuestionReply(state, message)

    expect(result.kind).toBe("defer_holistic")
    expect(buildPendingSelectionFilter(state, message)).toBeNull()
    if (result.kind === "defer_holistic") {
      expect(result.reasons).toEqual(expect.arrayContaining([
        "result_intent",
        "compound_utterance",
      ]))
      expect(result.reasons.some(reason => reason.startsWith("extra_entities:"))).toBe(true)
    }
  })

  it("keeps pure pending answers resolvable when there is no extra semantic load", () => {
    const state = makeState({
      lastAskedField: "fluteCount",
      displayedOptions: [
        { index: 1, label: "2\uB0A0", field: "fluteCount", value: "2", count: 20 },
        { index: 2, label: "4\uB0A0", field: "fluteCount", value: "4", count: 30 },
      ],
    })

    const result = resolvePendingQuestionReply(state, "2\uB0A0\uB85C \uD574\uC918")

    expect(result.kind).toBe("resolved")
    if (result.kind === "resolved") {
      expect(result.filter.field).toBe("fluteCount")
      expect(result.filter.rawValue).toBe(2)
    }
  })

  it("defers pending early resolution when an existing filter override is implied", () => {
    const state = makeState({
      lastAskedField: "fluteCount",
      appliedFilters: [
        { field: "brand", op: "eq", value: "4G MILL", rawValue: "4G MILL", appliedAt: 1 },
      ],
      displayedOptions: [
        { index: 1, label: "2\uB0A0", field: "fluteCount", value: "2", count: 20 },
        { index: 2, label: "4\uB0A0", field: "fluteCount", value: "4", count: 30 },
      ],
    })

    const message = "4G MILL 4\uB0A0 \uCD94\uCC9C\uD574\uC918"
    const result = resolvePendingQuestionReply(state, message)

    expect(result.kind).toBe("defer_holistic")
    expect(buildPendingSelectionFilter(state, message)).toBeNull()
    if (result.kind === "defer_holistic") {
      expect(result.reasons.some(reason => reason.startsWith("override_risk:"))).toBe(true)
    }
  })
})

// ---------------------------------------------------------------------------
// 4. Product code pattern recognition (regex tests)
// ---------------------------------------------------------------------------
describe("product code pattern recognition", () => {
  describe("DIRECT_PRODUCT_CODE_PATTERN matches product codes", () => {
    const productCodes = [
      "G8A59080",
      "E5E84200B",
      "CE7659",
      "GAA31080",
      "E5H22100",
      "JAH31060",
      "ALM31080",
      "CE76591020",
    ]

    productCodes.forEach(code => {
      it(`matches "${code}" as product code`, () => {
        // Reset lastIndex before test in case of /i flag stickiness
        DIRECT_PRODUCT_CODE_PATTERN.lastIndex = 0
        expect(DIRECT_PRODUCT_CODE_PATTERN.test(code)).toBe(true)
      })
    })
  })

  describe("DIRECT_SERIES_CODE_PATTERN matches series codes", () => {
    // Pattern: /[A-Z]\d[A-Z]\d{2,3}[A-Z]?/ — letter-digit-letter-2to3digits
    const seriesCodes = [
      "G8A59",
      "E5E84",
      "E5H22",
      "E5E39",
      "G8A51",
    ]

    seriesCodes.forEach(code => {
      it(`matches "${code}" as series code`, () => {
        DIRECT_SERIES_CODE_PATTERN.lastIndex = 0
        expect(DIRECT_SERIES_CODE_PATTERN.test(code)).toBe(true)
      })
    })
  })

  describe("DIRECT_PRODUCT_CODE_PATTERN does NOT match plain words", () => {
    const nonCodes = [
      "Square",
      "Radius",
      "Ball",
      "Taper",
      "TiAlN",
      "AlCrN",
      "mm",
      "HRC",
    ]

    nonCodes.forEach(text => {
      it(`does NOT match "${text}"`, () => {
        DIRECT_PRODUCT_CODE_PATTERN.lastIndex = 0
        expect(DIRECT_PRODUCT_CODE_PATTERN.test(text)).toBe(false)
      })
    })
  })

  describe("DIRECT_SERIES_CODE_PATTERN does NOT match short/invalid codes", () => {
    const nonSeries = [
      "AB",
      "A1",
      "12345",
      "ABCDEF",
    ]

    nonSeries.forEach(text => {
      it(`does NOT match "${text}"`, () => {
        DIRECT_SERIES_CODE_PATTERN.lastIndex = 0
        expect(DIRECT_SERIES_CODE_PATTERN.test(text)).toBe(false)
      })
    })
  })

  it("GMG31 does NOT match series code pattern (letter-letter-letter-digits)", () => {
    DIRECT_SERIES_CODE_PATTERN.lastIndex = 0
    // Series pattern is /[A-Z]\d[A-Z]\d{2,3}/ — GMG31 has no digit in position 2
    expect(DIRECT_SERIES_CODE_PATTERN.test("GMG31")).toBe(false)
  })

  it("G8A51 matches series code pattern (letter-digit-letter-digits)", () => {
    DIRECT_SERIES_CODE_PATTERN.lastIndex = 0
    expect(DIRECT_SERIES_CODE_PATTERN.test("G8A51")).toBe(true)
  })

  it("SG9E76 does NOT match series code pattern (starts with 2 letters)", () => {
    DIRECT_SERIES_CODE_PATTERN.lastIndex = 0
    // Pattern requires letter-digit-letter; SG starts with two letters
    expect(DIRECT_SERIES_CODE_PATTERN.test("SG9E76")).toBe(false)
  })

  it("SG9E7610015 does NOT match product code pattern (mixed letter-digit-letter prefix)", () => {
    DIRECT_PRODUCT_CODE_PATTERN.lastIndex = 0
    // Neither [A-Z]{2,5}\d{3,} nor [A-Z]\d[A-Z]\d{4,} matches SG9E7610015
    expect(DIRECT_PRODUCT_CODE_PATTERN.test("SG9E7610015")).toBe(false)
  })

  it("EI31080 matches product code pattern (2-letter prefix + digits)", () => {
    DIRECT_PRODUCT_CODE_PATTERN.lastIndex = 0
    expect(DIRECT_PRODUCT_CODE_PATTERN.test("EI31080")).toBe(true)
  })

  it("X5070 does NOT match product code pattern (single letter prefix too short)", () => {
    DIRECT_PRODUCT_CODE_PATTERN.lastIndex = 0
    // Product pattern needs 2-5 letters + 3+ digits OR letter-digit-letter-4+digits
    expect(DIRECT_PRODUCT_CODE_PATTERN.test("X5070")).toBe(false)
  })

  it("X5070S does NOT match product code as standalone", () => {
    DIRECT_PRODUCT_CODE_PATTERN.lastIndex = 0
    expect(DIRECT_PRODUCT_CODE_PATTERN.test("X5070S")).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// 5. Edge cases
// ---------------------------------------------------------------------------
describe("edge cases", () => {
  it("null session → none", () => {
    const result = resolvePendingQuestionReply(null, "Square")
    expect(result.kind).toBe("none")
  })

  it("null message → none", () => {
    const state = makeState({ lastAskedField: "toolSubtype" })
    const result = resolvePendingQuestionReply(state, null)
    expect(result.kind).toBe("none")
  })

  it("empty string → none", () => {
    const state = makeState({ lastAskedField: "toolSubtype" })
    const result = resolvePendingQuestionReply(state, "")
    expect(result.kind).toBe("none")
  })

  it("whitespace only → none", () => {
    const state = makeState({ lastAskedField: "toolSubtype" })
    const result = resolvePendingQuestionReply(state, "   ")
    expect(result.kind).toBe("none")
  })

  it("resolved status → none", () => {
    const state = makeState({
      lastAskedField: "toolSubtype",
      resolutionStatus: "resolved",
    })
    const result = resolvePendingQuestionReply(state, "Square")
    expect(result.kind).toBe("none")
  })

  it("resolved_recommended status → none", () => {
    const state = makeState({
      lastAskedField: "toolSubtype",
      resolutionStatus: "resolved_recommended",
    })
    const result = resolvePendingQuestionReply(state, "Square")
    expect(result.kind).toBe("none")
  })

  it("no lastAskedField → none", () => {
    const state = makeState({ lastAskedField: undefined })
    const result = resolvePendingQuestionReply(state, "Square")
    expect(result.kind).toBe("none")
  })

  it("very long message (>80 chars) → unresolved", () => {
    const state = makeState({ lastAskedField: "toolSubtype" })
    const longMsg = "이것은 매우 긴 메시지입니다. 이렇게 긴 메시지는 pending question의 답으로 처리될 수 없기 때문에 unresolved가 되어야 합니다. 정말 매우 긴 메시지입니다."
    expect(longMsg.length).toBeGreaterThan(80)
    const result = resolvePendingQuestionReply(state, longMsg)
    expect(result.kind).toBe("unresolved")
  })

  it("message exactly 80 chars is NOT rejected by length guard", () => {
    const state = makeState({
      lastAskedField: "toolSubtype",
      displayedOptions: [
        { index: 1, label: "Square", field: "toolSubtype", value: "Square", count: 100 },
      ],
    })
    // Construct a message that is exactly 80 chars and starts with a valid option
    const padded = "Square" + " ".repeat(74)
    expect(padded.length).toBe(80)
    const result = resolvePendingQuestionReply(state, padded)
    // Should not be blocked by length — actual resolution depends on matching
    expect(result.kind).not.toBe("none")
  })

  it("numbers only '10' during diameterMm → resolved as diameter", () => {
    const state = makeState({
      lastAskedField: "diameterMm",
      displayedChips: ["6mm (12개)", "8mm (9개)", "상관없음"],
      displayedOptions: [],
    })
    const result = resolvePendingQuestionReply(state, "10")
    expect(result.kind).toBe("resolved")
    if (result.kind === "resolved") {
      expect(result.filter.field).toBe("diameterMm")
    }
  })

  it("numbers only '10' during diameterRefine → resolved as diameter", () => {
    const state = makeState({
      lastAskedField: "diameterRefine",
      displayedChips: ["6mm (12개)", "8mm (9개)", "상관없음"],
      displayedOptions: [],
    })
    const result = resolvePendingQuestionReply(state, "10")
    expect(result.kind).toBe("resolved")
    if (result.kind === "resolved") {
      expect(result.filter.field).toBe("diameterMm")
    }
  })

  it("buildPendingSelectionFilter returns null when kind is not resolved", () => {
    const state = makeState({ lastAskedField: undefined })
    expect(buildPendingSelectionFilter(state, "Square")).toBeNull()
  })

  it("buildPendingSelectionFilter returns filter when kind is resolved", () => {
    const state = makeState({
      lastAskedField: "toolSubtype",
      displayedOptions: [
        { index: 1, label: "Square (100개)", field: "toolSubtype", value: "Square", count: 100 },
      ],
    })
    const filter = buildPendingSelectionFilter(state, "Square")
    expect(filter).not.toBeNull()
    expect(filter!.field).toBe("toolSubtype")
  })

  it("buildPendingSelectionFilter returns null for null session", () => {
    expect(buildPendingSelectionFilter(null, "Square")).toBeNull()
  })

  it("buildPendingSelectionFilter returns null for null message", () => {
    const state = makeState({ lastAskedField: "toolSubtype" })
    expect(buildPendingSelectionFilter(state, null)).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// 6. classifyQueryTarget — pure function, no LLM
// ---------------------------------------------------------------------------
describe("classifyQueryTarget", () => {
  it("classifies series comparison correctly", () => {
    const result = classifyQueryTarget("SG9E76과 E5E84 차이점", null, null)
    expect(result.type).toMatch(/comparison|series/)
  })

  it("classifies company info question", () => {
    const result = classifyQueryTarget("영업소 전화번호 알려줘", null, null)
    expect(result.type).toBe("company_info")
  })

  it("classifies product code query", () => {
    const result = classifyQueryTarget("G8A59080 스펙 알려줘", null, null)
    expect(result.type).toMatch(/product_info|general_question/)
    expect(result.requiresSearch).toBe(true)
  })

  it("classifies field explanation question with active filter context", () => {
    const result = classifyQueryTarget("코팅이 뭐야?", "coating", null)
    expect(result.type).toMatch(/active_field_query|field_explanation|general_question/)
  })

  it("classifies Korean term comparison as series_comparison", () => {
    // "황삭과 정삭" contains comparison pattern (과) and series-like terms
    const result = classifyQueryTarget("황삭과 정삭의 차이점", null, null)
    expect(result.type).toMatch(/series_comparison|general_question|field_explanation/)
  })

  it("returns unknown for minimal input", () => {
    const result = classifyQueryTarget("네", null, null)
    expect(result.type).toBe("unknown")
  })

  it("detects brand comparison pattern", () => {
    const result = classifyQueryTarget("ALU-POWER HPC vs TANK-POWER 차이", null, null)
    expect(["brand_comparison", "series_comparison"]).toContain(result.type)
  })

  it("detects series info request", () => {
    const result = classifyQueryTarget("SG9E76 시리즈 특징 알려줘", null, null)
    expect(result.type).toMatch(/series_info|general_question/)
  })
})

// ---------------------------------------------------------------------------
// 7. Cross-field pending resolution: Korean suffixes and normalization
// ---------------------------------------------------------------------------
describe("Korean suffix normalization in pending resolution", () => {
  it('"Square로" (Korean suffix) resolves to Square', () => {
    const state = makeState({
      lastAskedField: "toolSubtype",
      displayedOptions: [
        { index: 1, label: "Square (100개)", field: "toolSubtype", value: "Square", count: 100 },
        { index: 2, label: "Radius (50개)", field: "toolSubtype", value: "Radius", count: 50 },
      ],
    })
    const result = resolvePendingQuestionReply(state, "Square로")
    expect(result.kind).toBe("resolved")
  })

  it('"TiAlN으로" (Korean suffix) resolves to TiAlN', () => {
    const state = makeState({
      lastAskedField: "coating",
      displayedOptions: [
        { index: 1, label: "TiAlN (50개)", field: "coating", value: "TiAlN", count: 50 },
      ],
    })
    const result = resolvePendingQuestionReply(state, "TiAlN으로")
    expect(result.kind).toBe("resolved")
  })

  it('"Square이에요" (polite Korean) resolves', () => {
    const state = makeState({
      lastAskedField: "toolSubtype",
      displayedOptions: [
        { index: 1, label: "Square (100개)", field: "toolSubtype", value: "Square", count: 100 },
      ],
    })
    const result = resolvePendingQuestionReply(state, "Square이에요")
    expect(result.kind).toBe("resolved")
  })

  it('"Radius요" (Korean suffix) resolves', () => {
    const state = makeState({
      lastAskedField: "toolSubtype",
      displayedOptions: [
        { index: 1, label: "Radius (50개)", field: "toolSubtype", value: "Radius", count: 50 },
      ],
    })
    const result = resolvePendingQuestionReply(state, "Radius요")
    expect(result.kind).toBe("resolved")
  })
})
