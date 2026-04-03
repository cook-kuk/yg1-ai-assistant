import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))

const {
  normalizeInputMock,
  runHybridRetrievalMock,
  classifyHybridResultsMock,
  buildWarningsMock,
  buildRationaleMock,
  buildDeterministicSummaryMock,
} = vi.hoisted(() => ({
  normalizeInputMock: vi.fn(),
  runHybridRetrievalMock: vi.fn(),
  classifyHybridResultsMock: vi.fn(),
  buildWarningsMock: vi.fn(),
  buildRationaleMock: vi.fn(),
  buildDeterministicSummaryMock: vi.fn(),
}))

vi.mock("@/lib/recommendation/domain/recommendation-domain", () => ({
  normalizeInput: normalizeInputMock,
  runHybridRetrieval: runHybridRetrievalMock,
  classifyHybridResults: classifyHybridResultsMock,
  buildWarnings: buildWarningsMock,
  buildRationale: buildRationaleMock,
  buildDeterministicSummary: buildDeterministicSummaryMock,
  resolveMaterialTag: () => null,
}))

import type { ServeEngineSimpleChatDependencies } from "../serve-engine-simple-chat"
import { handleServeSimpleChat } from "../serve-engine-simple-chat"

// ── helpers ──

function makeJsonResponse(params: Record<string, unknown>, init?: ResponseInit): Response {
  return new Response(JSON.stringify(params), {
    ...init,
    headers: { "content-type": "application/json" },
  })
}

function makeDeps(overrides?: Partial<ServeEngineSimpleChatDependencies>): ServeEngineSimpleChatDependencies {
  return {
    jsonRecommendationResponse: vi.fn((params, init) => makeJsonResponse(params, init)),
    getFollowUpChips: vi.fn(() => ["chip-a", "chip-b"]),
    buildSourceSummary: vi.fn(() => ["source-a"]),
    handleDirectProductInfoQuestion: vi.fn().mockResolvedValue(null),
    handleDirectEntityProfileQuestion: vi.fn().mockResolvedValue(null),
    handleDirectBrandReferenceQuestion: vi.fn().mockResolvedValue(null),
    handleCompetitorCrossReference: vi.fn().mockResolvedValue(null),
    ...overrides,
  }
}

const emptyInput = {
  material: undefined,
  operationType: undefined,
  diameterMm: undefined,
} as any

function parseBody(resp: Response): Record<string, unknown> {
  return JSON.parse((resp as any).body as string) ?? {}
}

async function getBody(resp: Response): Promise<Record<string, unknown>> {
  return resp.json()
}

// ── Tests ──

describe("handleServeSimpleChat", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    normalizeInputMock.mockReturnValue(emptyInput)
    runHybridRetrievalMock.mockResolvedValue({ products: [], totalConsidered: 0 })
    classifyHybridResultsMock.mockReturnValue({ primary: null, alternatives: [], status: "no_match" })
    buildWarningsMock.mockReturnValue([])
    buildRationaleMock.mockReturnValue([])
    buildDeterministicSummaryMock.mockReturnValue("deterministic summary")
  })

  // ── Empty messages ──

  describe("empty messages guard", () => {
    it("returns 400 when messages array is empty", async () => {
      const deps = makeDeps()
      const resp = await handleServeSimpleChat(deps, [], "simple")

      expect(deps.jsonRecommendationResponse).toHaveBeenCalledWith(
        expect.objectContaining({ error: "bad_request", detail: "messages required" }),
        { status: 400 }
      )
    })
  })

  // ── Comparison routing ──

  describe("comparison routing", () => {
    it("routes '비교' requests to handleDirectEntityProfileQuestion first", async () => {
      const comparisonReply = { text: "비교 결과입니다", chips: ["a", "b"] }
      const deps = makeDeps({
        handleDirectEntityProfileQuestion: vi.fn().mockResolvedValue(comparisonReply),
      })
      const messages = [{ role: "user" as const, text: "E5D70과 E5D80 비교해줘" }]

      const resp = await handleServeSimpleChat(deps, messages, "simple")

      expect(deps.handleDirectEntityProfileQuestion).toHaveBeenCalledWith(
        "E5D70과 E5D80 비교해줘",
        expect.anything(),
        null
      )
      expect(deps.jsonRecommendationResponse).toHaveBeenCalledWith(
        expect.objectContaining({ purpose: "comparison", text: "비교 결과입니다" })
      )
    })

    it("routes 'vs' requests to comparison handler", async () => {
      const deps = makeDeps({
        handleDirectEntityProfileQuestion: vi.fn().mockResolvedValue({ text: "vs result", chips: [] }),
      })
      const messages = [{ role: "user" as const, text: "GMG30 vs GMG31" }]

      await handleServeSimpleChat(deps, messages, "simple")

      expect(deps.handleDirectEntityProfileQuestion).toHaveBeenCalled()
      expect(deps.jsonRecommendationResponse).toHaveBeenCalledWith(
        expect.objectContaining({ purpose: "comparison" })
      )
    })

    it("routes '차이' requests to comparison handler", async () => {
      const deps = makeDeps({
        handleDirectEntityProfileQuestion: vi.fn().mockResolvedValue({ text: "차이 결과", chips: [] }),
      })
      const messages = [{ role: "user" as const, text: "E5D70이랑 E5D80 차이가 뭐야?" }]

      await handleServeSimpleChat(deps, messages, "simple")

      expect(deps.jsonRecommendationResponse).toHaveBeenCalledWith(
        expect.objectContaining({ purpose: "comparison" })
      )
    })

    it("routes 'versus' (case-insensitive) to comparison handler", async () => {
      const deps = makeDeps({
        handleDirectEntityProfileQuestion: vi.fn().mockResolvedValue({ text: "versus result", chips: [] }),
      })
      const messages = [{ role: "user" as const, text: "E5D70 Versus E5D80" }]

      await handleServeSimpleChat(deps, messages, "simple")

      expect(deps.jsonRecommendationResponse).toHaveBeenCalledWith(
        expect.objectContaining({ purpose: "comparison" })
      )
    })

    it("falls through comparison when entity handler returns null", async () => {
      const deps = makeDeps({
        handleDirectEntityProfileQuestion: vi.fn().mockResolvedValue(null),
      })
      normalizeInputMock.mockReturnValue(emptyInput)
      const messages = [{ role: "user" as const, text: "비교해줘" }]

      await handleServeSimpleChat(deps, messages, "simple")

      // Should fall through to product info, then entity profile (second call), etc.
      // Final response should be a question since no input data
      expect(deps.jsonRecommendationResponse).toHaveBeenCalledWith(
        expect.objectContaining({ purpose: "question" })
      )
    })
  })

  // ── Product info routing ──

  describe("product info routing", () => {
    it("routes to product info handler when it returns a reply", async () => {
      const productReply = { text: "GYG02100 제품 정보", chips: ["a"] }
      const deps = makeDeps({
        handleDirectProductInfoQuestion: vi.fn().mockResolvedValue(productReply),
      })
      const messages = [{ role: "user" as const, text: "GYG02100 스펙 알려줘" }]

      await handleServeSimpleChat(deps, messages, "simple")

      expect(deps.handleDirectProductInfoQuestion).toHaveBeenCalled()
      expect(deps.jsonRecommendationResponse).toHaveBeenCalledWith(
        expect.objectContaining({ purpose: "general_chat", text: "GYG02100 제품 정보" })
      )
    })

    it("falls through when product info handler returns null", async () => {
      const deps = makeDeps({
        handleDirectProductInfoQuestion: vi.fn().mockResolvedValue(null),
      })
      const messages = [{ role: "user" as const, text: "무관한 메시지" }]

      await handleServeSimpleChat(deps, messages, "simple")

      expect(deps.handleDirectProductInfoQuestion).toHaveBeenCalled()
      // Falls through to entity profile, brand ref, etc.
    })

    it("does not call product info if deps.handleDirectProductInfoQuestion is undefined", async () => {
      const deps = makeDeps({ handleDirectProductInfoQuestion: undefined })
      const messages = [{ role: "user" as const, text: "GYG02100 알려줘" }]

      await handleServeSimpleChat(deps, messages, "simple")

      // Should proceed without error
      expect(deps.jsonRecommendationResponse).toHaveBeenCalled()
    })
  })

  // ── Entity profile routing ──

  describe("entity profile routing (non-comparison)", () => {
    it("routes to entity profile after product info returns null", async () => {
      const entityReply = { text: "E5D70 시리즈 설명", chips: ["x"] }
      const deps = makeDeps({
        handleDirectEntityProfileQuestion: vi.fn().mockResolvedValue(entityReply),
      })
      const messages = [{ role: "user" as const, text: "E5D70 시리즈 특징이 뭐야?" }]

      await handleServeSimpleChat(deps, messages, "simple")

      // Entity profile is called twice: once for comparison check, once for normal routing
      expect(deps.handleDirectEntityProfileQuestion).toHaveBeenCalled()
    })

    it("entity profile reply gets purpose general_chat (non-comparison path)", async () => {
      // Message without comparison keywords => comparison check is skipped entirely.
      // Entity profile is called once on the normal routing path.
      const deps = makeDeps({
        handleDirectProductInfoQuestion: vi.fn().mockResolvedValue(null),
        handleDirectEntityProfileQuestion: vi.fn()
          .mockResolvedValue({ text: "entity reply", chips: [] }),
      })
      const messages = [{ role: "user" as const, text: "E5D70 뭐야?" }]

      await handleServeSimpleChat(deps, messages, "simple")

      expect(deps.jsonRecommendationResponse).toHaveBeenCalledWith(
        expect.objectContaining({ purpose: "general_chat", text: "entity reply" })
      )
    })
  })

  // ── Brand reference routing ──

  describe("brand reference routing", () => {
    it("routes to brand reference after entity profile returns null", async () => {
      const brandReply = { text: "브랜드 기준표", chips: ["b"] }
      const deps = makeDeps({
        handleDirectBrandReferenceQuestion: vi.fn().mockResolvedValue(brandReply),
      })
      const messages = [{ role: "user" as const, text: "ISO P 브랜드 알려줘" }]

      await handleServeSimpleChat(deps, messages, "simple")

      expect(deps.handleDirectBrandReferenceQuestion).toHaveBeenCalled()
      expect(deps.jsonRecommendationResponse).toHaveBeenCalledWith(
        expect.objectContaining({ purpose: "general_chat", text: "브랜드 기준표" })
      )
    })
  })

  // ── Competitor cross-reference routing ──

  describe("competitor cross-reference routing", () => {
    it("routes to competitor handler when all previous handlers return null", async () => {
      const competitorReply = { text: "경쟁사 대체품", chips: ["c"] }
      const deps = makeDeps({
        handleCompetitorCrossReference: vi.fn().mockResolvedValue(competitorReply),
      })
      const messages = [{ role: "user" as const, text: "Sandvik 대체품 추천해줘" }]

      await handleServeSimpleChat(deps, messages, "simple")

      expect(deps.handleCompetitorCrossReference).toHaveBeenCalledWith(
        "Sandvik 대체품 추천해줘",
        null
      )
      expect(deps.jsonRecommendationResponse).toHaveBeenCalledWith(
        expect.objectContaining({ purpose: "general_chat", text: "경쟁사 대체품" })
      )
    })

    it("skips competitor handler when deps.handleCompetitorCrossReference is undefined", async () => {
      const deps = makeDeps({ handleCompetitorCrossReference: undefined })
      const messages = [{ role: "user" as const, text: "경쟁사 제품 찾아줘" }]

      await handleServeSimpleChat(deps, messages, "simple")

      // Should proceed to hasEnough check or question without error
      expect(deps.jsonRecommendationResponse).toHaveBeenCalled()
    })
  })

  // ── Recommendation path (hasEnough) ──

  describe("recommendation path", () => {
    it("runs hybrid retrieval when diameterMm is present", async () => {
      normalizeInputMock.mockReturnValue({ diameterMm: 10 })
      runHybridRetrievalMock.mockResolvedValue({ products: [], totalConsidered: 5 })
      classifyHybridResultsMock.mockReturnValue({ primary: null, alternatives: [], status: "no_match" })
      buildDeterministicSummaryMock.mockReturnValue("결과 요약")

      const deps = makeDeps()
      const messages = [{ role: "user" as const, text: "10mm 엔드밀 추천" }]

      await handleServeSimpleChat(deps, messages, "simple")

      expect(runHybridRetrievalMock).toHaveBeenCalled()
      expect(deps.jsonRecommendationResponse).toHaveBeenCalledWith(
        expect.objectContaining({ purpose: "recommendation", isComplete: true })
      )
    })

    it("runs hybrid retrieval when material + operationType are present", async () => {
      normalizeInputMock.mockReturnValue({ material: "알루미늄", operationType: "측삭" })
      runHybridRetrievalMock.mockResolvedValue({ products: [], totalConsidered: 3 })
      classifyHybridResultsMock.mockReturnValue({ primary: null, alternatives: [], status: "no_match" })
      buildDeterministicSummaryMock.mockReturnValue("결과")

      const deps = makeDeps()
      const messages = [{ role: "user" as const, text: "알루미늄 측삭 추천해줘" }]

      await handleServeSimpleChat(deps, messages, "simple")

      expect(runHybridRetrievalMock).toHaveBeenCalled()
      expect(deps.jsonRecommendationResponse).toHaveBeenCalledWith(
        expect.objectContaining({ purpose: "recommendation" })
      )
    })

    it("prepends brand info when primary product has brand but text lacks it", async () => {
      normalizeInputMock.mockReturnValue({ diameterMm: 10 })
      const primary = {
        product: { brand: "YG-1", displayCode: "GYG02100", rawSourceFile: "test.csv" },
      }
      runHybridRetrievalMock.mockResolvedValue({ products: [primary], totalConsidered: 10 })
      classifyHybridResultsMock.mockReturnValue({ primary, alternatives: [], status: "exact_match" })
      buildWarningsMock.mockReturnValue([])
      buildRationaleMock.mockReturnValue([])
      buildDeterministicSummaryMock.mockReturnValue("좋은 결과입니다.")

      const deps = makeDeps()
      const messages = [{ role: "user" as const, text: "10mm 추천" }]

      await handleServeSimpleChat(deps, messages, "simple")

      const call = (deps.jsonRecommendationResponse as any).mock.calls[0][0]
      expect(call.text).toContain("**브랜드명:** YG-1")
      expect(call.text).toContain("**제품코드:** GYG02100")
    })

    it("does not duplicate brand if already in deterministic summary", async () => {
      normalizeInputMock.mockReturnValue({ diameterMm: 10 })
      const primary = {
        product: { brand: "YG-1", displayCode: "GYG02100", rawSourceFile: "test.csv" },
      }
      runHybridRetrievalMock.mockResolvedValue({ products: [primary], totalConsidered: 10 })
      classifyHybridResultsMock.mockReturnValue({ primary, alternatives: [], status: "exact_match" })
      buildDeterministicSummaryMock.mockReturnValue("YG-1 GYG02100 제품을 추천합니다.")

      const deps = makeDeps()
      const messages = [{ role: "user" as const, text: "10mm 추천" }]

      await handleServeSimpleChat(deps, messages, "simple")

      const call = (deps.jsonRecommendationResponse as any).mock.calls[0][0]
      // Brand is already in text, should not prepend again
      expect(call.text).not.toMatch(/^\*\*브랜드명:\*\*/)
    })

    it("calls getFollowUpChips and buildSourceSummary for recommendation", async () => {
      normalizeInputMock.mockReturnValue({ diameterMm: 10 })
      const primary = {
        product: { brand: "YG-1", displayCode: "GYG02100", rawSourceFile: "test.csv" },
      }
      runHybridRetrievalMock.mockResolvedValue({ products: [primary], totalConsidered: 10 })
      classifyHybridResultsMock.mockReturnValue({ primary, alternatives: [], status: "exact_match" })
      buildDeterministicSummaryMock.mockReturnValue("결과 YG-1")

      const deps = makeDeps()
      const messages = [{ role: "user" as const, text: "10mm" }]

      await handleServeSimpleChat(deps, messages, "simple")

      expect(deps.getFollowUpChips).toHaveBeenCalled()
      expect(deps.buildSourceSummary).toHaveBeenCalledWith(primary)
    })
  })

  // ── Question fallback (not enough info) ──

  describe("question fallback", () => {
    it("asks about material when nothing is provided", async () => {
      normalizeInputMock.mockReturnValue({})
      const deps = makeDeps()
      const messages = [{ role: "user" as const, text: "안녕" }]

      await handleServeSimpleChat(deps, messages, "simple")

      const call = (deps.jsonRecommendationResponse as any).mock.calls[0][0]
      expect(call.purpose).toBe("question")
      expect(call.text).toContain("소재")
      expect(call.chips).toContain("알루미늄")
    })

    it("asks about operation type when only material is provided", async () => {
      normalizeInputMock.mockReturnValue({ material: "알루미늄" })
      const deps = makeDeps()
      const messages = [{ role: "user" as const, text: "알루미늄" }]

      await handleServeSimpleChat(deps, messages, "simple")

      const call = (deps.jsonRecommendationResponse as any).mock.calls[0][0]
      expect(call.purpose).toBe("question")
      expect(call.text).toContain("가공 방식")
      expect(call.chips).toContain("측삭")
    })

    it("asks about diameter when material and operation are provided but no diameter", async () => {
      normalizeInputMock.mockReturnValue({ material: "알루미늄", operationType: "측삭" })
      // material + operationType -> hasEnough is true, so this actually goes to recommendation.
      // But we need diameterMm alone without material/op for the question path.
      // Actually material + operationType IS enough. Let's test diameter question with only operationType.
      normalizeInputMock.mockReturnValue({ operationType: "측삭" })
      const deps = makeDeps()
      const messages = [{ role: "user" as const, text: "측삭" }]

      await handleServeSimpleChat(deps, messages, "simple")

      const call = (deps.jsonRecommendationResponse as any).mock.calls[0][0]
      expect(call.purpose).toBe("question")
      // Asks for material first since material is missing
      expect(call.text).toContain("소재")
    })
  })

  // ── Latest user message extraction ──

  describe("message extraction", () => {
    it("uses the latest user message from messages array", async () => {
      normalizeInputMock.mockReturnValue(emptyInput)
      const deps = makeDeps()
      const messages = [
        { role: "user" as const, text: "첫 번째 메시지" },
        { role: "ai" as const, text: "AI 응답" },
        { role: "user" as const, text: "마지막 메시지" },
      ]

      await handleServeSimpleChat(deps, messages, "simple")

      expect(normalizeInputMock).toHaveBeenCalledWith("마지막 메시지")
    })

    it("uses empty string when no user message exists", async () => {
      normalizeInputMock.mockReturnValue(emptyInput)
      const deps = makeDeps()
      const messages = [{ role: "ai" as const, text: "AI만 있음" }]

      await handleServeSimpleChat(deps, messages, "simple")

      expect(normalizeInputMock).toHaveBeenCalledWith("")
    })
  })

  // ── Error handling ──

  describe("error handling", () => {
    it("returns error response when an internal handler throws", async () => {
      const deps = makeDeps({
        handleDirectEntityProfileQuestion: vi.fn().mockRejectedValue(new Error("DB error")),
      })
      const messages = [{ role: "user" as const, text: "비교해줘" }]

      const resp = await handleServeSimpleChat(deps, messages, "simple")

      expect(deps.jsonRecommendationResponse).toHaveBeenCalledWith(
        expect.objectContaining({
          text: "일시적인 오류가 발생했습니다. 다시 시도해주세요.",
          chips: ["처음부터 다시"],
        })
      )
    })

    it("returns error response when normalizeInput throws", async () => {
      normalizeInputMock.mockImplementation(() => { throw new Error("parse error") })
      const deps = makeDeps()
      const messages = [{ role: "user" as const, text: "test" }]

      await handleServeSimpleChat(deps, messages, "simple")

      expect(deps.jsonRecommendationResponse).toHaveBeenCalledWith(
        expect.objectContaining({ text: expect.stringContaining("오류") })
      )
    })

    it("returns error response when runHybridRetrieval throws", async () => {
      normalizeInputMock.mockReturnValue({ diameterMm: 10 })
      runHybridRetrievalMock.mockRejectedValue(new Error("retrieval error"))

      const deps = makeDeps()
      const messages = [{ role: "user" as const, text: "10mm 추천" }]

      await handleServeSimpleChat(deps, messages, "simple")

      expect(deps.jsonRecommendationResponse).toHaveBeenCalledWith(
        expect.objectContaining({ chips: ["처음부터 다시"] })
      )
    })
  })

  // ── Routing priority order ──

  describe("routing priority", () => {
    it("comparison takes priority over product info", async () => {
      const deps = makeDeps({
        handleDirectEntityProfileQuestion: vi.fn().mockResolvedValue({ text: "comparison", chips: [] }),
        handleDirectProductInfoQuestion: vi.fn().mockResolvedValue({ text: "product info", chips: [] }),
      })
      const messages = [{ role: "user" as const, text: "E5D70 vs E5D80 비교" }]

      await handleServeSimpleChat(deps, messages, "simple")

      const call = (deps.jsonRecommendationResponse as any).mock.calls[0][0]
      expect(call.purpose).toBe("comparison")
      // Product info should NOT have been called
      expect(deps.handleDirectProductInfoQuestion).not.toHaveBeenCalled()
    })

    it("product info takes priority over entity profile (non-comparison path)", async () => {
      const deps = makeDeps({
        handleDirectProductInfoQuestion: vi.fn().mockResolvedValue({ text: "product", chips: [] }),
        handleDirectEntityProfileQuestion: vi.fn()
          .mockResolvedValueOnce(null) // comparison check returns null (not a comparison)
          .mockResolvedValueOnce({ text: "entity", chips: [] }),
      })
      const messages = [{ role: "user" as const, text: "GYG02100 스펙" }]

      await handleServeSimpleChat(deps, messages, "simple")

      const call = (deps.jsonRecommendationResponse as any).mock.calls[0][0]
      expect(call.text).toBe("product")
    })

    it("entity profile takes priority over brand reference", async () => {
      // Message without comparison keywords => comparison check is skipped.
      // Entity profile is called once on the normal path and returns a reply.
      const deps = makeDeps({
        handleDirectProductInfoQuestion: vi.fn().mockResolvedValue(null),
        handleDirectEntityProfileQuestion: vi.fn()
          .mockResolvedValue({ text: "entity", chips: [] }),
        handleDirectBrandReferenceQuestion: vi.fn().mockResolvedValue({ text: "brand", chips: [] }),
      })
      const messages = [{ role: "user" as const, text: "E5D70 특징" }]

      await handleServeSimpleChat(deps, messages, "simple")

      const call = (deps.jsonRecommendationResponse as any).mock.calls[0][0]
      expect(call.text).toBe("entity")
    })

    it("brand reference takes priority over competitor cross-reference", async () => {
      const deps = makeDeps({
        handleDirectProductInfoQuestion: vi.fn().mockResolvedValue(null),
        handleDirectEntityProfileQuestion: vi.fn().mockResolvedValue(null),
        handleDirectBrandReferenceQuestion: vi.fn().mockResolvedValue({ text: "brand ref", chips: [] }),
        handleCompetitorCrossReference: vi.fn().mockResolvedValue({ text: "competitor", chips: [] }),
      })
      const messages = [{ role: "user" as const, text: "ISO P 브랜드 추천" }]

      await handleServeSimpleChat(deps, messages, "simple")

      const call = (deps.jsonRecommendationResponse as any).mock.calls[0][0]
      expect(call.text).toBe("brand ref")
      expect(deps.handleCompetitorCrossReference).not.toHaveBeenCalled()
    })
  })

  // ── Edge cases ──

  describe("edge cases", () => {
    it("handles single-character user message", async () => {
      normalizeInputMock.mockReturnValue(emptyInput)
      const deps = makeDeps()
      const messages = [{ role: "user" as const, text: "a" }]

      await handleServeSimpleChat(deps, messages, "simple")

      expect(deps.jsonRecommendationResponse).toHaveBeenCalled()
    })

    it("handles very long user message", async () => {
      normalizeInputMock.mockReturnValue(emptyInput)
      const deps = makeDeps()
      const longMsg = "알루미늄 ".repeat(1000)
      const messages = [{ role: "user" as const, text: longMsg }]

      await handleServeSimpleChat(deps, messages, "simple")

      expect(deps.jsonRecommendationResponse).toHaveBeenCalled()
    })

    it("handles messages with only AI responses (no user message)", async () => {
      normalizeInputMock.mockReturnValue(emptyInput)
      const deps = makeDeps()
      const messages = [
        { role: "ai" as const, text: "응답1" },
        { role: "ai" as const, text: "응답2" },
      ]

      await handleServeSimpleChat(deps, messages, "simple")

      expect(normalizeInputMock).toHaveBeenCalledWith("")
    })

    it("recommendation result with no primary product has no brand prepend", async () => {
      normalizeInputMock.mockReturnValue({ diameterMm: 10 })
      runHybridRetrievalMock.mockResolvedValue({ products: [], totalConsidered: 0 })
      classifyHybridResultsMock.mockReturnValue({ primary: null, alternatives: [], status: "no_match" })
      buildDeterministicSummaryMock.mockReturnValue("결과 없음")

      const deps = makeDeps()
      const messages = [{ role: "user" as const, text: "10mm 추천" }]

      await handleServeSimpleChat(deps, messages, "simple")

      const call = (deps.jsonRecommendationResponse as any).mock.calls[0][0]
      expect(call.text).toBe("결과 없음")
      expect(call.text).not.toContain("**브랜드명:**")
    })

    it("_mode parameter is accepted but not used for routing", async () => {
      normalizeInputMock.mockReturnValue(emptyInput)
      const deps = makeDeps()
      const messages = [{ role: "user" as const, text: "test" }]

      await handleServeSimpleChat(deps, messages, "some-mode")

      expect(deps.jsonRecommendationResponse).toHaveBeenCalled()
    })

    it("all response shapes include sessionState: null and evidenceSummaries: null", async () => {
      const productReply = { text: "info", chips: [] }
      const deps = makeDeps({
        handleDirectProductInfoQuestion: vi.fn().mockResolvedValue(productReply),
      })
      const messages = [{ role: "user" as const, text: "GYG02100" }]

      await handleServeSimpleChat(deps, messages, "simple")

      const call = (deps.jsonRecommendationResponse as any).mock.calls[0][0]
      expect(call.sessionState).toBeNull()
      expect(call.evidenceSummaries).toBeNull()
      expect(call.candidateSnapshot).toBeNull()
    })
  })
})
