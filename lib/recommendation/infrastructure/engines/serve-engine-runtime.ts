import {
  analyzeInquiry,
  buildDeterministicSummary,
  buildRationale,
  buildWarnings,
  carryForwardState,
  checkResolution,
  classifyHybridResults,
  getRedirectResponse,
  normalizeInput,
  prepareRequest,
  restoreOnePreviousStep,
  restoreToBeforeFilter,
  runHybridRetrieval,
} from "@/lib/recommendation/domain/recommendation-domain"
import {
  compareProducts,
  orchestrateTurn,
  orchestrateTurnWithTools,
  resolveProductReferences,
} from "@/lib/recommendation/infrastructure/agents/recommendation-agents"
import { ENABLE_TOOL_USE_ROUTING } from "@/lib/recommendation/infrastructure/config/recommendation-feature-flags"
import { getProvider } from "@/lib/recommendation/infrastructure/llm/recommendation-llm"

import type { buildRecommendationResponseDto } from "@/lib/recommendation/infrastructure/presenters/recommendation-presenter"
import type { RecommendationDisplayedProductRequestDto } from "@/lib/contracts/recommendation"
import type {
  AppliedFilter,
  AppLanguage,
  CandidateSnapshot,
  ChatMessage,
  EvidenceSummary,
  ExplorationSessionState,
  FactCheckedRecommendation,
  NarrowingStage,
  NarrowingTurn,
  ProductIntakeForm,
  RecommendationExplanation,
  RecommendationInput,
  RecommendationResult,
  ScoredProduct,
} from "@/lib/recommendation/domain/types"

type JsonRecommendationResponse = (
  params: Parameters<typeof buildRecommendationResponseDto>[0],
  init?: ResponseInit
) => Response

type QuestionReply = { text: string; chips: string[] } | null

export interface ServeEngineRuntimeDependencies {
  mapIntakeToInput: (form: ProductIntakeForm) => RecommendationInput
  applyFilterToInput: (input: RecommendationInput, filter: AppliedFilter) => RecommendationInput
  buildQuestionResponse: (
    form: ProductIntakeForm,
    candidates: ScoredProduct[],
    evidenceMap: Map<string, EvidenceSummary>,
    input: RecommendationInput,
    history: NarrowingTurn[],
    filters: AppliedFilter[],
    turnCount: number,
    messages: ChatMessage[],
    provider: ReturnType<typeof getProvider>,
    language: AppLanguage,
    overrideText?: string,
    existingStageHistory?: NarrowingStage[]
  ) => Promise<Response>
  buildRecommendationResponse: (
    form: ProductIntakeForm,
    candidates: ScoredProduct[],
    evidenceMap: Map<string, EvidenceSummary>,
    input: RecommendationInput,
    history: NarrowingTurn[],
    filters: AppliedFilter[],
    turnCount: number,
    messages: ChatMessage[],
    provider: ReturnType<typeof getProvider>,
    language: AppLanguage,
    displayedProducts?: RecommendationDisplayedProductRequestDto[] | null
  ) => Promise<Response>
  buildCandidateSnapshot: (
    candidates: ScoredProduct[],
    evidenceMap: Map<string, EvidenceSummary>
  ) => CandidateSnapshot[]
  handleDirectInventoryQuestion: (
    userMessage: string,
    prevState: ExplorationSessionState
  ) => Promise<QuestionReply>
  handleDirectCuttingConditionQuestion: (
    userMessage: string,
    currentInput: RecommendationInput,
    prevState: ExplorationSessionState
  ) => Promise<QuestionReply>
  handleContextualNarrowingQuestion: (
    provider: ReturnType<typeof getProvider>,
    userMessage: string,
    currentInput: RecommendationInput,
    candidates: ScoredProduct[],
    prevState: ExplorationSessionState
  ) => Promise<string | null>
  handleGeneralChat: (
    provider: ReturnType<typeof getProvider>,
    userMessage: string,
    currentInput: RecommendationInput,
    candidates: ScoredProduct[],
    form: ProductIntakeForm,
    displayedCandidatesContext?: CandidateSnapshot[]
  ) => Promise<{ text: string; chips: string[] }>
  jsonRecommendationResponse: JsonRecommendationResponse
  getFollowUpChips: (result: RecommendationResult) => string[]
  buildSourceSummary: (primary: { product: { rawSourceFile: string; rawSourceSheet?: string | null; sourceConfidence?: string | null } } | null) => string[]
}

export async function handleServeExploration(
  deps: ServeEngineRuntimeDependencies,
  form: ProductIntakeForm,
  messages: ChatMessage[],
  prevState: ExplorationSessionState | null,
  displayedProducts: RecommendationDisplayedProductRequestDto[] | null = null,
  language: AppLanguage = "ko"
): Promise<Response> {
  console.log(
    `[recommend] request start hasPrevState=${!!prevState} messages=${messages.length} displayedProducts=${displayedProducts?.length ?? 0}`
  )
  const provider = getProvider()
  const baseInput = deps.mapIntakeToInput(form)

  const filters: AppliedFilter[] = prevState?.appliedFilters ?? []
  const resolvedInput: RecommendationInput = prevState?.resolvedInput
    ? { ...baseInput, ...prevState.resolvedInput }
    : baseInput

  const hybridResult = await runHybridRetrieval(resolvedInput, filters)
  const candidates = hybridResult.candidates
  const evidenceMap = hybridResult.evidenceMap

  const requestPrep = prepareRequest(form, messages, prevState, resolvedInput, candidates.length)
  console.log(`[recommend] Intent: ${requestPrep.intent} (${requestPrep.intentConfidence}), Route: ${requestPrep.route.action}`)

  if (requestPrep.route.action === "reset_session") {
    return deps.jsonRecommendationResponse({
      text: "처음부터 다시 시작합니다. 새로운 조건을 입력해주세요.",
      purpose: "greeting",
      chips: ["처음부터 다시"],
      isComplete: true,
      recommendation: null,
      sessionState: null,
      evidenceSummaries: null,
      candidateSnapshot: null,
      requestPreparation: requestPrep,
    })
  }

  const narrowingHistory: NarrowingTurn[] = prevState?.narrowingHistory ?? []
  let currentInput = { ...resolvedInput }
  let turnCount = prevState?.turnCount ?? 0

  if (messages.length > 0 && prevState) {
    const lastUserMsg = [...messages].reverse().find(m => m.role === "user")
    if (lastUserMsg) {
      const turnCtx = {
        userMessage: lastUserMsg.text,
        intakeForm: form,
        sessionState: prevState,
        resolvedInput: currentInput,
        candidateCount: candidates.length,
        displayedProducts: deps.buildCandidateSnapshot(candidates, evidenceMap),
        currentCandidates: candidates,
      }

      const orchResult = ENABLE_TOOL_USE_ROUTING
        ? await orchestrateTurnWithTools(turnCtx, provider)
        : await orchestrateTurn(turnCtx, provider)
      const action = orchResult.action

      if (action.type === "reset_session") {
        return deps.jsonRecommendationResponse({
          text: "처음부터 다시 시작합니다. 새로운 조건을 입력해주세요.",
          purpose: "greeting",
          chips: ["처음부터 다시"],
          isComplete: true,
          recommendation: null,
          sessionState: null,
          evidenceSummaries: null,
          candidateSnapshot: null,
          requestPreparation: requestPrep,
        })
      }

      if (action.type === "go_back_one_step" || action.type === "go_back_to_filter") {
        const restoreResult = action.type === "go_back_to_filter"
          ? restoreToBeforeFilter(prevState, action.filterValue ?? "", action.filterField, baseInput, deps.applyFilterToInput)
          : restoreOnePreviousStep(prevState, baseInput, deps.applyFilterToInput)

        const undoResult = await runHybridRetrieval(restoreResult.rebuiltInput, restoreResult.remainingFilters.filter(f => f.op !== "skip"))

        console.log(`[session-manager:undo] Reverted "${restoreResult.removedFilterDesc}": ${prevState.candidateCount} → ${undoResult.candidates.length} candidates, filters: ${prevState.appliedFilters.length} → ${restoreResult.remainingFilters.length}`)

        return deps.buildQuestionResponse(
          form, undoResult.candidates, undoResult.evidenceMap, restoreResult.rebuiltInput,
          restoreResult.remainingHistory, restoreResult.remainingFilters, restoreResult.undoTurnCount,
          messages, provider, language, undefined, restoreResult.remainingStages
        )
      }

      if (action.type === "show_recommendation") {
        return deps.buildRecommendationResponse(
          form, candidates, evidenceMap, currentInput, narrowingHistory,
          filters, turnCount, messages, provider, language, displayedProducts
        )
      }

      if (action.type === "compare_products") {
        const snapshot = prevState.displayedCandidates?.length > 0
          ? prevState.displayedCandidates
          : deps.buildCandidateSnapshot(candidates, evidenceMap)
        const targets = resolveProductReferences(action.targets, snapshot)
        const compResult = await compareProducts(targets, evidenceMap, provider)

        const sessionState = carryForwardState(prevState, {
          candidateCount: candidates.length,
          appliedFilters: filters,
          narrowingHistory,
          resolutionStatus: prevState.resolutionStatus ?? "broad",
          resolvedInput: currentInput,
          turnCount,
          displayedCandidates: snapshot,
          displayedChips: ["추천해주세요", "다른 조건으로", "⟵ 이전 단계", "처음부터 다시"],
          displayedOptions: [],
          currentMode: "comparison",
          lastAction: "compare_products",
        })
        return deps.jsonRecommendationResponse({
          text: compResult.text,
          purpose: "comparison",
          chips: ["추천해주세요", "다른 조건으로", "⟵ 이전 단계", "처음부터 다시"],
          isComplete: false,
          recommendation: null,
          sessionState,
          evidenceSummaries: null,
          candidateSnapshot: snapshot,
          requestPreparation: null,
          primaryExplanation: null,
          primaryFactChecked: null,
          altExplanations: [],
          altFactChecked: [],
          meta: {
            orchestratorResult: { action: action.type, agents: orchResult.agentsInvoked, opus: orchResult.escalatedToOpus },
          },
        })
      }

      if (action.type === "explain_product" || action.type === "answer_general") {
        const inventoryReply = await deps.handleDirectInventoryQuestion(lastUserMsg.text, prevState)
        if (inventoryReply) {
          const sessionState = carryForwardState(prevState, {
            candidateCount: prevState.candidateCount ?? candidates.length,
            appliedFilters: filters,
            narrowingHistory,
            resolutionStatus: prevState.resolutionStatus ?? "broad",
            resolvedInput: currentInput,
            turnCount,
            displayedCandidates: prevState.displayedCandidates ?? [],
            displayedChips: inventoryReply.chips,
            displayedOptions: prevState.displayedOptions ?? [],
            currentMode: "general_chat",
            lastAction: "answer_general",
          })
          return deps.jsonRecommendationResponse({
            text: inventoryReply.text,
            purpose: "general_chat",
            chips: inventoryReply.chips,
            isComplete: false,
            recommendation: null,
            sessionState,
            evidenceSummaries: null,
            candidateSnapshot: prevState.displayedCandidates ?? null,
            requestPreparation: null,
            primaryExplanation: null,
            primaryFactChecked: null,
            altExplanations: [],
            altFactChecked: [],
            meta: {
              orchestratorResult: { action: action.type, agents: orchResult.agentsInvoked, opus: orchResult.escalatedToOpus },
            },
          })
        }

        const cuttingConditionReply = await deps.handleDirectCuttingConditionQuestion(lastUserMsg.text, currentInput, prevState)
        if (cuttingConditionReply) {
          const sessionState = carryForwardState(prevState, {
            candidateCount: prevState.candidateCount ?? candidates.length,
            appliedFilters: filters,
            narrowingHistory,
            resolutionStatus: prevState.resolutionStatus ?? "broad",
            resolvedInput: currentInput,
            turnCount,
            displayedCandidates: prevState.displayedCandidates ?? [],
            displayedChips: cuttingConditionReply.chips,
            displayedOptions: prevState.displayedOptions ?? [],
            currentMode: "general_chat",
            lastAction: "answer_general",
          })
          return deps.jsonRecommendationResponse({
            text: cuttingConditionReply.text,
            purpose: "general_chat",
            chips: cuttingConditionReply.chips,
            isComplete: false,
            recommendation: null,
            sessionState,
            evidenceSummaries: null,
            candidateSnapshot: prevState.displayedCandidates ?? null,
            requestPreparation: null,
            primaryExplanation: null,
            primaryFactChecked: null,
            altExplanations: [],
            altFactChecked: [],
            meta: {
              orchestratorResult: { action: action.type, agents: orchResult.agentsInvoked, opus: orchResult.escalatedToOpus },
            },
          })
        }

        if (action.type === "explain_product") {
          const contextReply = await deps.handleContextualNarrowingQuestion(
            provider, lastUserMsg.text, currentInput, candidates, prevState
          )
          if (contextReply) {
            if (prevState.resolutionStatus?.startsWith("resolved")) {
              const sessionState = carryForwardState(prevState, {
                candidateCount: prevState.candidateCount ?? candidates.length,
                appliedFilters: filters,
                narrowingHistory,
                resolutionStatus: prevState.resolutionStatus,
                resolvedInput: currentInput,
                turnCount,
                displayedCandidates: prevState.displayedCandidates ?? [],
                displayedChips: prevState.displayedChips ?? ["대체 후보 보기", "절삭조건 알려줘", "처음부터 다시"],
                displayedOptions: prevState.displayedOptions ?? [],
                currentMode: "general_chat",
                lastAction: "explain_product",
              })
              return deps.jsonRecommendationResponse({
                text: contextReply,
                purpose: "general_chat",
                chips: prevState.displayedChips ?? ["대체 후보 보기", "절삭조건 알려줘", "처음부터 다시"],
                isComplete: false,
                recommendation: null,
                sessionState,
                evidenceSummaries: null,
                candidateSnapshot: prevState.displayedCandidates ?? null,
                requestPreparation: null,
                primaryExplanation: null,
                primaryFactChecked: null,
                altExplanations: [],
                altFactChecked: [],
                meta: {
                  orchestratorResult: { action: action.type, agents: orchResult.agentsInvoked, opus: orchResult.escalatedToOpus },
                },
              })
            }

            return deps.buildQuestionResponse(
              form, candidates, evidenceMap, currentInput,
              narrowingHistory, filters, turnCount, messages, provider, language,
              contextReply
            )
          }
        }

        const preGenerated = action.type === "answer_general" && action.preGenerated && action.message
        const llmResponse = preGenerated
          ? { text: action.message, chips: generateFollowUpChips(lastUserMsg.text, candidates.length) }
          : await deps.handleGeneralChat(provider, lastUserMsg.text, currentInput, candidates, form, prevState.displayedCandidates)

        const sessionState = carryForwardState(prevState, {
          candidateCount: prevState.candidateCount ?? candidates.length,
          appliedFilters: filters,
          narrowingHistory,
          resolutionStatus: prevState.resolutionStatus ?? "broad",
          resolvedInput: currentInput,
          turnCount,
          displayedCandidates: prevState.displayedCandidates ?? [],
          displayedChips: llmResponse.chips,
          displayedOptions: prevState.displayedOptions ?? [],
          currentMode: "general_chat",
          lastAction: "answer_general",
        })
        return deps.jsonRecommendationResponse({
          text: llmResponse.text,
          purpose: "general_chat",
          chips: llmResponse.chips,
          isComplete: false,
          recommendation: null,
          sessionState,
          evidenceSummaries: null,
          candidateSnapshot: candidates.length > 0 ? deps.buildCandidateSnapshot(candidates, evidenceMap) : null,
          requestPreparation: null,
          primaryExplanation: null,
          primaryFactChecked: null,
          altExplanations: [],
          altFactChecked: [],
          meta: {
            orchestratorResult: { action: action.type, agents: orchResult.agentsInvoked, opus: orchResult.escalatedToOpus },
          },
        })
      }

      if (action.type === "redirect_off_topic") {
        const inquiry = analyzeInquiry(lastUserMsg.text)
        const redirect = getRedirectResponse(inquiry)
        const sessionState = carryForwardState(prevState, {
          candidateCount: prevState.candidateCount,
          appliedFilters: filters,
          narrowingHistory,
          resolutionStatus: prevState.resolutionStatus ?? "broad",
          resolvedInput: currentInput,
          turnCount,
          displayedCandidates: prevState.displayedCandidates ?? [],
          displayedChips: redirect.chips,
          displayedOptions: prevState.displayedOptions ?? [],
          currentMode: "question",
          lastAction: "redirect_off_topic",
        })
        return deps.jsonRecommendationResponse({
          text: redirect.text,
          purpose: "question",
          chips: redirect.chips,
          isComplete: false,
          recommendation: null,
          sessionState,
          evidenceSummaries: null,
          candidateSnapshot: redirect.showCandidates ? deps.buildCandidateSnapshot(candidates, evidenceMap) : null,
          requestPreparation: null,
          primaryExplanation: null,
          primaryFactChecked: null,
          altExplanations: [],
          altFactChecked: [],
        })
      }

      if (action.type === "skip_field") {
        const skipField = prevState.lastAskedField ?? "unknown"
        const skipFilter: AppliedFilter = {
          field: skipField, op: "skip", value: "상관없음", rawValue: "skip", appliedAt: turnCount,
        }
        filters.push(skipFilter)
        currentInput = deps.applyFilterToInput(currentInput, skipFilter)

        const newResult = await runHybridRetrieval(currentInput, filters.filter(f => f.op !== "skip"))
        narrowingHistory.push({
          question: "follow-up",
          answer: lastUserMsg.text,
          extractedFilters: [skipFilter],
          candidateCountBefore: candidates.length,
          candidateCountAfter: newResult.candidates.length,
        })
        turnCount++

        const statusAfterSkip = checkResolution(newResult.candidates, narrowingHistory)
        if (statusAfterSkip.startsWith("resolved")) {
          return deps.buildRecommendationResponse(form, newResult.candidates, newResult.evidenceMap, currentInput, narrowingHistory, filters, turnCount, messages, provider, language, displayedProducts)
        }
        return deps.buildQuestionResponse(form, newResult.candidates, newResult.evidenceMap, currentInput, narrowingHistory, filters, turnCount, messages, provider, language)
      }

      if (action.type === "continue_narrowing") {
        const filter = { ...action.filter, appliedAt: turnCount }
        const testInput = deps.applyFilterToInput(currentInput, filter)
        const testFilters = [...filters, filter]
        const testResult = await runHybridRetrieval(testInput, testFilters)

        if (testResult.candidates.length === 0) {
          console.log(`[orchestrator:guard] Filter ${filter.field}=${filter.value} would result in 0 candidates — BLOCKED`)
          return deps.buildQuestionResponse(
            form, candidates, evidenceMap, currentInput,
            narrowingHistory, filters, turnCount, messages, provider, language,
            `"${filter.value}" 조건을 적용하면 후보가 없습니다. 현재 ${candidates.length}개 후보에서 다른 조건을 선택해주세요.`
          )
        }

        filters.push(filter)
        currentInput = testInput
        const newCandidates = testResult.candidates
        const prevCandidateCount = candidates.length

        narrowingHistory.push({
          question: prevState.narrowingHistory?.length ? "follow-up" : "initial",
          answer: lastUserMsg.text,
          extractedFilters: [filter],
          candidateCountBefore: prevCandidateCount,
          candidateCountAfter: newCandidates.length,
        })

        const existingStages = prevState.stageHistory ?? []
        const newStage: NarrowingStage = {
          stepIndex: turnCount,
          stageName: `${filter.field}_${filter.value}`,
          filterApplied: filter,
          candidateCount: newCandidates.length,
          resolvedInputSnapshot: { ...currentInput },
          filtersSnapshot: [...filters],
        }
        const updatedStages = [...existingStages, newStage]

        console.log(`[orchestrator:filter] ${filter.field}=${filter.value} | ${prevCandidateCount}→${newCandidates.length} candidates | stages: ${updatedStages.map(s => s.stageName).join(" → ")}`)

        turnCount++

        const newStatus = checkResolution(newCandidates, narrowingHistory)
        if (newStatus.startsWith("resolved")) {
          return deps.buildRecommendationResponse(form, newCandidates, testResult.evidenceMap, currentInput, narrowingHistory, filters, turnCount, messages, provider, language, displayedProducts)
        }

        return deps.buildQuestionResponse(form, newCandidates, testResult.evidenceMap, currentInput, narrowingHistory, filters, turnCount, messages, provider, language, undefined, updatedStages)
      }
    }
  }

  const status = checkResolution(candidates, narrowingHistory)
  if (status.startsWith("resolved") && turnCount > 0) {
    return deps.buildRecommendationResponse(
      form, candidates, evidenceMap, currentInput, narrowingHistory,
      filters, turnCount, messages, provider, language, displayedProducts
    )
  }

  return deps.buildQuestionResponse(
    form, candidates, evidenceMap, currentInput, narrowingHistory,
    filters, turnCount, messages, provider, language
  )
}

export async function handleServeSimpleChat(
  deps: Pick<ServeEngineRuntimeDependencies, "jsonRecommendationResponse" | "getFollowUpChips" | "buildSourceSummary">,
  messages: ChatMessage[],
  mode: string
): Promise<Response> {
  if (!messages.length) {
    return deps.jsonRecommendationResponse({
      error: "bad_request",
      detail: "messages required",
      text: "메시지가 필요합니다.",
      purpose: "question",
      chips: [],
      isComplete: false,
      recommendation: null,
      sessionState: null,
      evidenceSummaries: null,
      candidateSnapshot: null,
    }, { status: 400 })
  }

  const latestUserMsg = [...messages].reverse().find(m => m.role === "user")?.text ?? ""
  const baseInput = normalizeInput(latestUserMsg)
  const hasEnough = !!(baseInput.diameterMm || (baseInput.material && baseInput.operationType))

  if (hasEnough) {
    const result = await runHybridRetrieval(baseInput, [], 5)
    const { primary, alternatives, status } = classifyHybridResults(result)
    const warnings = primary ? buildWarnings(primary, baseInput) : []
    const rationale = primary ? buildRationale(primary, baseInput) : []

    const deterministicSummary = buildDeterministicSummary({
      status,
      query: baseInput,
      primaryProduct: primary,
      alternatives,
      warnings,
      rationale,
      sourceSummary: [],
      deterministicSummary: "",
      llmSummary: null,
      totalCandidatesConsidered: result.totalConsidered,
    })

    const recommendation: RecommendationResult = {
      status,
      query: baseInput,
      primaryProduct: primary,
      alternatives,
      warnings,
      rationale,
      sourceSummary: primary ? deps.buildSourceSummary(primary) : [],
      deterministicSummary,
      llmSummary: null,
      totalCandidatesConsidered: result.totalConsidered,
    }

    let quickText = deterministicSummary
    if (primary && primary.product.brand) {
      const brandName = primary.product.brand
      const hasBrand = quickText.includes(brandName) || /브랜드명/.test(quickText)
      if (!hasBrand) {
        quickText = `**브랜드명:** ${brandName} | **제품코드:** ${primary.product.displayCode}\n\n${quickText}`
      }
    }

    return deps.jsonRecommendationResponse({
      text: quickText,
      purpose: "recommendation",
      chips: deps.getFollowUpChips(recommendation),
      isComplete: true,
      recommendation,
      sessionState: null,
      evidenceSummaries: null,
      candidateSnapshot: null,
    })
  }

  return deps.jsonRecommendationResponse({
    text: getNextQuestion(baseInput),
    purpose: "question",
    chips: getDefaultChips(baseInput),
    isComplete: false,
    recommendation: null,
    sessionState: null,
    evidenceSummaries: null,
    candidateSnapshot: null,
  })
}

function getNextQuestion(input: RecommendationInput): string {
  if (!input.material) return "어떤 소재를 가공하실 예정인가요?"
  if (!input.operationType) return "어떤 가공 방식이 필요하신가요? (황삭/정삭/고이송 등)"
  if (!input.diameterMm) return "공구 직경은 몇 mm가 필요하신가요?"
  if (!input.flutePreference) return "날 수(flute) 선호도가 있으신가요?"
  return "추가로 확인이 필요한 조건이 있으신가요?"
}

function getDefaultChips(input: RecommendationInput): string[] {
  if (!input.material) return ["알루미늄", "스테인리스", "탄소강", "주철", "티타늄", "고경도강"]
  if (!input.operationType) return ["황삭", "정삭", "고이송", "슬롯가공", "측면가공"]
  if (!input.diameterMm) return ["2mm", "4mm", "6mm", "8mm", "10mm", "12mm"]
  if (!input.flutePreference) return ["2날", "3날", "4날", "6날", "상관없음"]
  return ["추천 받기", "다른 조건으로", "경쟁사 비교"]
}

function generateFollowUpChips(userMessage: string, candidateCount: number): string[] {
  const lower = userMessage.toLowerCase()

  if (/코팅|tialn|alcrn|dlc/i.test(lower)) {
    return ["코팅별 적합 소재", "무코팅 vs DLC", "소재별 추천 코팅", "제품 추천"]
  }
  if (/소재|알루|스테인|주철|티타늄|가공/i.test(lower)) {
    return ["절삭조건 알려줘", "추천 코팅은?", "주의사항 더 알려줘", "제품 추천"]
  }
  if (/시스템|점수|매칭|어떻게/i.test(lower)) {
    return ["점수 기준 설명", "소재 태그 뜻", "팩트 체크란?", "제품 추천"]
  }
  if (candidateCount > 0) {
    return ["후보 제품 보기", "절삭조건 문의", "코팅 비교", "처음부터 다시"]
  }
  return ["제품 추천", "절삭조건 문의", "코팅 비교", "시리즈 검색"]
}
