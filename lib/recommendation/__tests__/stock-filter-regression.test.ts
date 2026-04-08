/**
 * 재고 필터 3중 버그 회귀 테스트.
 *
 * 2026-04-08 :2999 배포본 (commit 1259e8b, AM 05:40 build) 에서 관측된
 * "재고 필터 안 걸림" 증상의 세 가지 원인을 각각 고정한다.
 *
 *   Bug A — NL→filter 추출 단계에서 "재고 있는 거만" → stockStatus=instock 대신
 *           sql-agent 가 엉뚱하게 totalStock eq 1 을 만들어냄.
 *           Fix: 7576026 (SCR prompt + deterministic-scr 재고 패턴).
 *
 *   Bug B — KG orchestrator 가 "재고 있는 거만" 을 filter_by_stock 액션으로
 *           분류하면 retrieval SKIP 후 prevState.displayedCandidates 에
 *           post-filter 하는데, 첫 턴엔 비어 있어서 0건 응답.
 *           Fix: 564c7cd (serve-engine-runtime 에서 첫 턴이면 stockStatus=instock
 *           주입 후 정상 retrieval 수행).
 *
 *   Bug C — hasStockFilter 경로에서 SQL builder 가 이미 inventory_summary_mv 와
 *           EXISTS join 으로 필터링했는데 post-filter 가 `stringMatch(stockStatus)` 를
 *           또 걸어서 candidate 객체의 빈 stockStatus 필드 때문에 SQL 통과한
 *           547개가 전부 reject 됨.
 *           Fix: 1a0c102 (totalStock numeric 체크로 전환).
 *
 * 세 버그 모두 :2999 에서 관측한 실제 증상 ("totalStock eq 1개" / "0건 응답" /
 * "모두 reject") 을 그대로 재현하는 어설션을 포함한다.
 */

import { describe, expect, it } from "vitest"

import { parseDeterministic } from "@/lib/recommendation/core/deterministic-scr"
import { selectStockSurvivors } from "@/lib/recommendation/domain/hybrid-retrieval"
import { computeFirstTurnStockFilterDecision } from "@/lib/recommendation/infrastructure/engines/serve-engine-runtime"

// ─────────────────────────────────────────────────────────────
// Bug A — NL→filter 추출
// ─────────────────────────────────────────────────────────────
describe("[stock regression] Bug A — NL parser: 재고 → stockStatus=instock", () => {
  // :2999 에서 실제 관측된 4개 케이스 메시지
  const stockCases: Array<{ id: string; msg: string }> = [
    { id: "#10", msg: "재고 있는 거만 보여줘" },
    { id: "#11", msg: "재고 있고 빠른 납기 가능한 거" },
    { id: "#15", msg: "직경 8~12mm, 전장 80 이상, 4날, TiAlN 코팅, 재고 있는 거" },
    { id: "#25", msg: "한국 재고로 4날 TiAlN 전장 100 이상" },
  ]

  for (const c of stockCases) {
    it(`${c.id} "${c.msg}" → stockStatus=instock (NOT totalStock eq 1)`, () => {
      const actions = parseDeterministic(c.msg)

      const stockAction = actions.find(a => a.field === "stockStatus")
      expect(stockAction, "stockStatus 액션이 추출되어야 함").toBeDefined()
      expect(stockAction).toMatchObject({
        type: "apply_filter",
        field: "stockStatus",
        value: "instock",
        op: "eq",
      })

      // :2999 에서 관측된 잘못된 shape: {field:"totalStock", op:"eq", value:1,...}
      // 재고 의도는 stockStatus 필드로만 표현되어야 하고 totalStock 숫자 필드로
      // 누출되면 안 된다.
      const totalStockActions = actions.filter(a => a.field === "totalStock")
      expect(totalStockActions).toHaveLength(0)

      // 또한 "재고 있는" 표현이 eq/1 같은 숫자 리터럴로 오해석되면 안 됨
      const suspicious = actions.filter(
        a => a.field === "stockStatus" && (a.value === 1 || a.value === "1")
      )
      expect(suspicious).toHaveLength(0)
    })
  }

  it("#15 multi-filter: 재고 + 직경 + OAL + flute + coating 동시 추출", () => {
    const actions = parseDeterministic(stockCases[2].msg)
    const fields = new Set(actions.map(a => a.field))
    expect(fields.has("stockStatus")).toBe(true)
    expect(fields.has("diameterMm")).toBe(true)
    expect(fields.has("overallLengthMm")).toBe(true)
    expect(fields.has("fluteCount")).toBe(true)
    expect(fields.has("coating")).toBe(true)
  })

  it("#25 multi-filter: 재고 + 한국 + 4날 + TiAlN + OAL", () => {
    const actions = parseDeterministic(stockCases[3].msg)
    const fields = new Set(actions.map(a => a.field))
    expect(fields.has("stockStatus")).toBe(true)
    expect(fields.has("country")).toBe(true)
    expect(fields.has("fluteCount")).toBe(true)
    expect(fields.has("coating")).toBe(true)
    expect(fields.has("overallLengthMm")).toBe(true)
  })

  it("'재고 없는' 같은 부정 표현은 eq instock 을 만들어선 안 됨 (regression guard)", () => {
    // 현재 deterministic parser 는 긍정만 지원하지만, 향후 부정 추가 시에도
    // "재고 없는" 에 stockStatus=instock 이 생기면 안 됨.
    const actions = parseDeterministic("재고 없는 거")
    const positive = actions.find(
      a => a.field === "stockStatus" && a.op === "eq" && a.value === "instock"
    )
    expect(positive).toBeUndefined()
  })
})

// ─────────────────────────────────────────────────────────────
// Bug B — 첫 턴 filter_by_stock 액션 처리
// ─────────────────────────────────────────────────────────────
describe("[stock regression] Bug B — first-turn filter_by_stock injects stockStatus filter", () => {
  it("filter_by_stock + 첫 턴 (displayed=0) + filter 없음 → injectAndClear", () => {
    const decision = computeFirstTurnStockFilterDecision({
      earlyAction: "filter_by_stock",
      prevDisplayedCount: 0,
      hasStockStatusFilter: false,
    })
    expect(decision).toBe("injectAndClear")
  })

  it("filter_by_stock + 첫 턴 + stockStatus 이미 존재 → clearEarlyAction (주입 안 함)", () => {
    const decision = computeFirstTurnStockFilterDecision({
      earlyAction: "filter_by_stock",
      prevDisplayedCount: 0,
      hasStockStatusFilter: true,
    })
    expect(decision).toBe("clearEarlyAction")
  })

  it("filter_by_stock + prev 있음 (displayed>0) → noop (post-filter 정상 경로)", () => {
    const decision = computeFirstTurnStockFilterDecision({
      earlyAction: "filter_by_stock",
      prevDisplayedCount: 12,
      hasStockStatusFilter: false,
    })
    expect(decision).toBe("noop")
  })

  it("다른 액션 (show_recommendation) 은 noop", () => {
    const decision = computeFirstTurnStockFilterDecision({
      earlyAction: "show_recommendation",
      prevDisplayedCount: 0,
      hasStockStatusFilter: false,
    })
    expect(decision).toBe("noop")
  })

  it("earlyAction 이 null/undefined 여도 noop", () => {
    expect(
      computeFirstTurnStockFilterDecision({
        earlyAction: null,
        prevDisplayedCount: 0,
        hasStockStatusFilter: false,
      })
    ).toBe("noop")
    expect(
      computeFirstTurnStockFilterDecision({
        earlyAction: undefined,
        prevDisplayedCount: 0,
        hasStockStatusFilter: false,
      })
    ).toBe("noop")
  })

  it(":2999 증상 재현: filter_by_stock + 첫 턴 + no filter 에서 noop 을 반환하면 0건 버그", () => {
    // 이 테스트가 실패하면 (즉 decision === "noop") :2999 처럼 retrieval 이
    // SKIP 되고 prevState.displayedCandidates 빈 배열에 post-filter 가 적용되어
    // 0건 응답이 나오는 버그가 재발한 것.
    const decision = computeFirstTurnStockFilterDecision({
      earlyAction: "filter_by_stock",
      prevDisplayedCount: 0,
      hasStockStatusFilter: false,
    })
    expect(decision).not.toBe("noop")
  })
})

// ─────────────────────────────────────────────────────────────
// Bug C — hybrid-retrieval post-filter 숫자 체크
// ─────────────────────────────────────────────────────────────
describe("[stock regression] Bug C — selectStockSurvivors uses totalStock numeric, not stockStatus string", () => {
  type TestCandidate = {
    code: string
    totalStock?: number | null
    // stockStatus 필드는 의도적으로 undefined/null — :2999 에서 enrichment 후에도
    // stockStatus 문자열이 제대로 안 채워져서 stringMatch 가 전부 reject 했던 상황.
    stockStatus?: string | null
  }

  const pool: TestCandidate[] = [
    { code: "HAS_50", totalStock: 50, stockStatus: null },
    { code: "HAS_1", totalStock: 1, stockStatus: undefined },
    { code: "ZERO", totalStock: 0, stockStatus: null },
    { code: "NULL_STOCK", totalStock: null, stockStatus: null },
    { code: "UNDEF_STOCK", totalStock: undefined, stockStatus: null },
    { code: "HAS_547", totalStock: 547, stockStatus: null }, // :2999 가 전부 reject 한 바로 그 547
  ]

  it("positive (instock): totalStock > 0 인 후보만 survive", () => {
    const survivors = selectStockSurvivors(pool, false)
    const codes = survivors.map(c => c.code).sort()
    expect(codes).toEqual(["HAS_1", "HAS_50", "HAS_547"])
  })

  it("negation (outofstock): totalStock === 0 또는 null/undefined 만 survive", () => {
    const survivors = selectStockSurvivors(pool, true)
    const codes = survivors.map(c => c.code).sort()
    expect(codes).toEqual(["NULL_STOCK", "UNDEF_STOCK", "ZERO"])
  })

  it(":2999 증상 재현: stockStatus 문자열 필드가 null 이어도 totalStock>0 이면 positive 필터 통과해야 함", () => {
    // 이전 버그: post-filter 가 stringMatch(stockStatus, "instock") 을 실행해서
    // stockStatus === null 인 547개가 전부 reject 됨. 이 테스트는 숫자 경로 강제.
    const onlyNullStockStatus = pool.filter(c => c.stockStatus == null && (c.totalStock ?? 0) > 0)
    const survivors = selectStockSurvivors(onlyNullStockStatus, false)
    expect(survivors.length).toBe(onlyNullStockStatus.length)
    expect(survivors.length).toBeGreaterThan(0)
  })

  it("빈 배열 입력", () => {
    expect(selectStockSurvivors([], false)).toEqual([])
    expect(selectStockSurvivors([], true)).toEqual([])
  })

  it("모두 재고 0 → positive 필터에서 전부 제거, negation 에서 전부 survive", () => {
    const allZero: TestCandidate[] = [
      { code: "A", totalStock: 0 },
      { code: "B", totalStock: null },
      { code: "C", totalStock: undefined },
    ]
    expect(selectStockSurvivors(allZero, false)).toEqual([])
    expect(selectStockSurvivors(allZero, true)).toHaveLength(3)
  })
})
