/**
 * Query Target Classifier — Regression tests
 *
 * Tests:
 * 1. Active filter does NOT override explicit series comparison target
 * 2. Explicit entity comparison routes to targeted comparison
 * 3. Series question does NOT drift into coating answer
 * 4. Coating explanation only when coating is explicitly asked about
 * 5. Active filter acts as scope constraint only
 * 6. Wrong-topic answer guard
 */

import { describe, it, expect } from "vitest"
import { classifyQueryTarget, isWrongTopicAnswer } from "../query-target-classifier"

// ════════════════════════════════════════════════════════════════
// TEST 1: Active filter does NOT override series comparison
// ════════════════════════════════════════════════════════════════

describe("query-target: active filter vs explicit target", () => {
  it("ALU-CUT vs ALU-CUT POWER → series_comparison, overrides coating filter", () => {
    const result = classifyQueryTarget(
      "ALU-CUT과 ALU-CUT POWER의 차이를 알려주세요",
      "coating", // active filter field
      "coating"  // pending field
    )

    expect(result.type).toBe("series_comparison")
    expect(result.overridesActiveFilter).toBe(true)
    expect(result.entities).toContain("ALU-CUT")
    expect(result.searchScopeOnly).toBe(true)
  })

  it("TANK-POWER vs X-POWER → series_comparison", () => {
    const result = classifyQueryTarget(
      "TANK-POWER와 X-POWER 뭐가 달라요?",
      "fluteCount"
    )

    expect(result.type).toBe("series_comparison")
    expect(result.overridesActiveFilter).toBe(true)
    expect(result.entities.length).toBeGreaterThanOrEqual(2)
  })

  it("DLC가 뭐야? → active_field_query (NOT override)", () => {
    const result = classifyQueryTarget(
      "DLC가 뭐야?",
      "coating",
      "coating"
    )

    expect(result.type).toBe("active_field_query")
    expect(result.overridesActiveFilter).toBe(false)
  })
})

// ════════════════════════════════════════════════════════════════
// TEST 2: Explicit entity comparison
// ════════════════════════════════════════════════════════════════

describe("query-target: entity comparison detection", () => {
  it("detects 과/와 comparison pattern with entities", () => {
    const result = classifyQueryTarget(
      "E5D70과 ALM90 차이가 뭐야?",
      "coating"
    )

    expect(result.type).toBe("series_comparison")
    expect(result.entities.length).toBeGreaterThanOrEqual(2)
    expect(result.overridesActiveFilter).toBe(true)
  })

  it("detects product code comparison", () => {
    const result = classifyQueryTarget(
      "GAA29040이랑 GEE8304030 비교해줘",
      "fluteCount"
    )

    expect(result.type).toBe("product_comparison")
    expect(result.overridesActiveFilter).toBe(true)
  })

  it("detects product comparison with explicit explanation wording", () => {
    const result = classifyQueryTarget(
      "E5E84200B 와 E5E84200 비교 설명",
      "coating"
    )

    expect(result.type).toBe("series_comparison")
    expect(result.entities).toContain("E5E84200B")
    expect(result.entities).toContain("E5E84200")
  })

  it("detects brand comparison entities", () => {
    const result = classifyQueryTarget(
      "E·FORCE 와 4G MILLS 브랜드 차이 설명해줘",
      "coating"
    )

    expect(result.type).toBe("brand_comparison")
    expect(result.overridesActiveFilter).toBe(true)
    expect(result.entities).toContain("E·FORCE")
    expect(result.entities).toContain("4G MILLS")
  })
})

// ════════════════════════════════════════════════════════════════
// TEST 3: Series question doesn't drift
// ════════════════════════════════════════════════════════════════

describe("query-target: series info", () => {
  it("ALU-CUT 시리즈 특징 → series_info, overrides filter", () => {
    const result = classifyQueryTarget(
      "ALU-CUT 시리즈 특징이 뭐야?",
      "coating"
    )

    expect(result.type).toBe("series_info")
    expect(result.overridesActiveFilter).toBe(true)
    expect(result.entities).toContain("ALU-CUT")
  })

  it("single series mention → series_info", () => {
    const result = classifyQueryTarget(
      "TANK-POWER는 어떤 제품이야?",
      "fluteCount"
    )

    expect(result.type).toBe("series_info")
    expect(result.overridesActiveFilter).toBe(true)
  })

  it("GNX45 series question → series_info", () => {
    const result = classifyQueryTarget(
      "GNX45의 날 수는 몇 개야?",
      "coating"
    )

    expect(result.type).toBe("series_info")
    expect(result.overridesActiveFilter).toBe(true)
    expect(result.entities).toContain("GNX45")
  })

  it("E·FORCE brand question → brand_info", () => {
    const result = classifyQueryTarget(
      "E·FORCE 브랜드 특징이 뭐야?",
      "coating"
    )

    expect(result.type).toBe("brand_info")
    expect(result.overridesActiveFilter).toBe(true)
    expect(result.entities).toContain("E·FORCE")
  })
})

// ════════════════════════════════════════════════════════════════
// TEST 4: Coating explanation only when explicitly asked
// ════════════════════════════════════════════════════════════════

describe("query-target: field-specific queries", () => {
  it("코팅 차이 설명해줘 → active_field_query", () => {
    const result = classifyQueryTarget(
      "코팅 차이 설명해줘",
      "coating",
      "coating"
    )

    expect(result.type).toBe("active_field_query")
    expect(result.overridesActiveFilter).toBe(false)
  })

  it("날수 뭐가 좋아? with pending=fluteCount → active_field_query", () => {
    const result = classifyQueryTarget(
      "날수 뭐가 좋아?",
      null,
      "fluteCount"
    )

    expect(result.type).toBe("active_field_query")
    expect(result.overridesActiveFilter).toBe(false)
  })

  it("general question without entities → NOT override", () => {
    const result = classifyQueryTarget(
      "어떤 게 좋아요?",
      "coating"
    )

    expect(result.overridesActiveFilter).toBe(false)
  })
})

// ════════════════════════════════════════════════════════════════
// TEST 5: Active filter as scope constraint only
// ════════════════════════════════════════════════════════════════

describe("query-target: scope constraint", () => {
  it("series comparison with coating filter → searchScopeOnly=true", () => {
    const result = classifyQueryTarget(
      "ALU-CUT과 TANK-POWER 비교",
      "coating"
    )

    expect(result.searchScopeOnly).toBe(true)
    expect(result.answerTopic).toContain("비교")
    // The answer topic is about the series, NOT about coating
    expect(result.answerTopic).not.toContain("코팅")
  })
})

// ════════════════════════════════════════════════════════════════
// TEST 6: Wrong-topic answer guard
// ════════════════════════════════════════════════════════════════

describe("query-target: wrong-topic guard", () => {
  it("detects wrong topic when answer is about coating but query is about series", () => {
    const queryTarget = classifyQueryTarget(
      "ALU-CUT과 ALU-CUT POWER 차이",
      "coating"
    )

    const wrongAnswer = "DLC 코팅은 Diamond-Like Carbon의 약자로, 높은 경도와 내마모성이 특징입니다. DLC 코팅은 알루미늄 가공에서 우수한 성능을 보여줍니다. 코팅 두께는 일반적으로 1-3μm입니다. DLC는 낮은 마찰계수로 인해..."

    const isWrong = isWrongTopicAnswer(wrongAnswer, queryTarget, "coating")
    expect(isWrong).toBe(true)
  })

  it("correct topic answer passes guard", () => {
    const queryTarget = classifyQueryTarget(
      "ALU-CUT과 ALU-CUT POWER 차이",
      "coating"
    )

    const correctAnswer = "ALU-CUT과 ALU-CUT POWER는 YG-1의 알루미늄 가공용 시리즈입니다. ALU-CUT은 범용, ALU-CUT POWER는 고성능 버전입니다."

    const isWrong = isWrongTopicAnswer(correctAnswer, queryTarget, "coating")
    expect(isWrong).toBe(false)
  })

  it("no guard when query does not override filter", () => {
    const queryTarget = classifyQueryTarget(
      "DLC가 뭐야?",
      "coating"
    )

    const answer = "DLC는 Diamond-Like Carbon 코팅입니다."
    const isWrong = isWrongTopicAnswer(answer, queryTarget, "coating")
    expect(isWrong).toBe(false)
  })
})
