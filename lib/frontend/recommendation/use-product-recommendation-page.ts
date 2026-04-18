"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"

import type {
  RecommendationCapabilityDto,
  RecommendationCandidateDto,
  RecommendationPaginationDto,
  RecommendationPublicSessionDto,
  RecommendationReasoningVisibility,
} from "@/lib/contracts/recommendation"
import type { ExplorationSessionState } from "@/lib/recommendation/domain/types"
import {
  buildRecommendationSessionEnvelope,
  createCandidatePaginationRequest,
  createFollowUpRecommendationRequest,
  createInitialRecommendationRequest,
  parseRecommendationResponse,
} from "@/lib/frontend/recommendation/recommendation-client"
import {
  getPythonSessionId,
  streamRecommendationViaPython,
} from "@/lib/frontend/recommendation/recommendation-python-bridge"
import {
  adaptProductsPage,
  fetchProductsPage,
} from "@/lib/frontend/recommendation/products-api-client"
import type { ChatMsg, TurnFeedback } from "@/lib/frontend/recommendation/exploration-types"
import { buildIntakePromptText } from "@/lib/frontend/recommendation/intake-flow"
import type { AnswerState, ProductIntakeForm } from "@/lib/frontend/recommendation/intake-types"
import { INITIAL_INTAKE_FORM } from "@/lib/frontend/recommendation/intake-types"
import {
  DEFAULT_RECOMMENDATION_CAPABILITIES,
  resolveRecommendationCapabilities,
} from "@/lib/frontend/recommendation/recommendation-view-model"
import { createClientEventId } from "@/lib/frontend/recommendation/client-event-id"

// 스트리밍 중 누적된 실시간 CoT 전문이 턴 종료 시점에 백엔드의 짧은 요약으로 덮이는 것을
// 막기 위한 헬퍼. 둘 중 더 긴 쪽 (= 정보가 더 많은 쪽) 을 유지.
function pickLongerThinking(
  a: string | null | undefined,
  b: string | null | undefined,
): string | null {
  const sa = typeof a === "string" ? a : ""
  const sb = typeof b === "string" ? b : ""
  if (!sa && !sb) return null
  return sa.length >= sb.length ? sa : sb
}

function resolveReasoningVisibility(
  explicit: RecommendationReasoningVisibility | null | undefined,
  thinkingProcess: string | null | undefined,
  thinkingDeep: string | null | undefined,
): RecommendationReasoningVisibility {
  if (explicit === "hidden" || explicit === "simple" || explicit === "full") return explicit
  if (thinkingDeep) return "full"
  if (thinkingProcess) return "simple"
  return "hidden"
}

export type Phase = "intake" | "summary" | "loading" | "explore"
// 사용자 피드백(2026-04-19): 채팅창에 한 번에 10개씩 카드로 보여주고,
// 나머지 제품은 yg1-ai-cutting-tool-master 스타일의 간단한 페이지네이션
// (first/prev/next/last, 페이지당 10개)으로 넘기도록 맞춤.
const DEFAULT_PAGE_SIZE = 10
const RESTORE_RECOMMENDATION_ALTERNATIVES_LIMIT = 10

function trimRecommendationForPersistence(
  recommendation: ChatMsg["recommendation"] | null | undefined,
) {
  if (!recommendation) return null
  if (!Array.isArray(recommendation.alternatives)) return recommendation
  if (recommendation.alternatives.length <= RESTORE_RECOMMENDATION_ALTERNATIVES_LIMIT) return recommendation
  return {
    ...recommendation,
    alternatives: recommendation.alternatives.slice(0, RESTORE_RECOMMENDATION_ALTERNATIVES_LIMIT),
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function normalizeNullableString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null
}

function normalizeNullableNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value
  if (typeof value === "string") {
    const parsed = Number.parseFloat(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

function normalizeMatchStatus(value: unknown): RecommendationCandidateDto["matchStatus"] {
  return value === "exact" || value === "approximate" || value === "none" ? value : "none"
}

function normalizeCandidateFromSnapshot(raw: unknown): RecommendationCandidateDto | null {
  if (!isRecord(raw)) return null

  const productCode = normalizeNullableString(raw.productCode) ?? normalizeNullableString(raw.code)
  const displayCode = normalizeNullableString(raw.displayCode) ?? productCode
  if (!productCode || !displayCode) return null

  const scoreBreakdown = (raw.scoreBreakdown as RecommendationCandidateDto["scoreBreakdown"]) ?? null
  const bestCondition = (raw.bestCondition as RecommendationCandidateDto["bestCondition"]) ?? null
  const inventoryLocations = Array.isArray(raw.inventoryLocations)
    ? (raw.inventoryLocations as RecommendationCandidateDto["inventoryLocations"])
    : []
  const materialTags = Array.isArray(raw.materialTags)
    ? (raw.materialTags.filter(tag => typeof tag === "string") as string[])
    : []

  return {
    rank: typeof raw.rank === "number" ? raw.rank : 0,
    productCode,
    displayCode,
    displayLabel: normalizeNullableString(raw.displayLabel),
    brand: normalizeNullableString(raw.brand),
    seriesName: normalizeNullableString(raw.seriesName) ?? normalizeNullableString(raw.series),
    seriesIconUrl: normalizeNullableString(raw.seriesIconUrl),
    diameterMm: normalizeNullableNumber(raw.diameterMm ?? raw.diameter),
    fluteCount: normalizeNullableNumber(raw.fluteCount ?? raw.flute),
    coating: normalizeNullableString(raw.coating),
    toolSubtype: normalizeNullableString(raw.toolSubtype),
    toolMaterial: normalizeNullableString(raw.toolMaterial),
    shankDiameterMm: normalizeNullableNumber(raw.shankDiameterMm),
    shankType: normalizeNullableString(raw.shankType),
    lengthOfCutMm: normalizeNullableNumber(raw.lengthOfCutMm),
    overallLengthMm: normalizeNullableNumber(raw.overallLengthMm),
    helixAngleDeg: normalizeNullableNumber(raw.helixAngleDeg),
    coolantHole: raw.coolantHole === true || raw.coolantHole === false ? raw.coolantHole : null,
    ballRadiusMm: normalizeNullableNumber(raw.ballRadiusMm),
    taperAngleDeg: normalizeNullableNumber(raw.taperAngleDeg),
    pointAngleDeg: normalizeNullableNumber(raw.pointAngleDeg),
    threadPitchMm: normalizeNullableNumber(raw.threadPitchMm),
    description: normalizeNullableString(raw.description),
    featureText: normalizeNullableString(raw.featureText),
    materialTags,
    score: typeof raw.score === "number" && Number.isFinite(raw.score) ? raw.score : 0,
    scoreBreakdown,
    matchStatus: normalizeMatchStatus(raw.matchStatus),
    stockStatus: normalizeNullableString(raw.stockStatus) ?? "unknown",
    totalStock: normalizeNullableNumber(raw.totalStock),
    inventorySnapshotDate: normalizeNullableString(raw.inventorySnapshotDate),
    inventoryLocations,
    hasEvidence: raw.hasEvidence === true,
    bestCondition,
  }
}

function normalizeCandidateSnapshot(raw: unknown): RecommendationCandidateDto[] | null {
  if (!Array.isArray(raw)) return null
  const candidates = raw
    .map(item => normalizeCandidateFromSnapshot(item))
    .filter((item): item is RecommendationCandidateDto => item !== null)

  return candidates.length > 0 ? candidates : null
}

function buildCandidateSnapshotForRestore(
  restoredMessages: ChatMsg[],
  restoredSessionState: Record<string, unknown> | null,
): RecommendationCandidateDto[] | null {
  const fromSessionCandidates = normalizeCandidateSnapshot(restoredSessionState?.displayedCandidates)
    ?? normalizeCandidateSnapshot(restoredSessionState?.displayedProducts)
    ?? normalizeCandidateSnapshot(restoredSessionState?.lastRecommendationArtifact)

  if (fromSessionCandidates?.length) return fromSessionCandidates

  const lastRecommendationMessage = [...restoredMessages].slice().reverse().find(message => message.role === "ai" && message.recommendation)
  const candidatesFromMessage = lastRecommendationMessage ? buildRecommendedProducts(lastRecommendationMessage) : null
  return candidatesFromMessage ? normalizeCandidateSnapshot(candidatesFromMessage) : null
}

function buildCandidatePaginationForRestore(
  candidateSnapshot: RecommendationCandidateDto[] | null,
  candidateCountHint: number | undefined | null,
) {
  if (!candidateSnapshot || candidateSnapshot.length === 0) return null
  const totalItems = candidateCountHint && candidateCountHint > 0 ? candidateCountHint : candidateSnapshot.length
  return {
    page: 0,
    pageSize: DEFAULT_PAGE_SIZE,
    totalItems,
    totalPages: Math.max(Math.ceil(totalItems / DEFAULT_PAGE_SIZE), 1),
  }
}

function buildCandidateHighlights(candidates: RecommendationCandidateDto[] | null) {
  return (candidates ?? []).map(candidate => ({
    rank: candidate.rank,
    productCode: candidate.productCode,
    displayCode: candidate.displayCode,
    score: candidate.score,
  }))
}

function buildRecommendedProducts(message: ChatMsg | null | undefined) {
  const recommendation = message?.recommendation
  if (!recommendation) return null

  const items = [
    recommendation.primaryProduct ? { rank: 1, scored: recommendation.primaryProduct } : null,
    ...recommendation.alternatives.map((scored, index) => ({ rank: index + 2, scored })),
  ]
    .filter((item): item is { rank: number; scored: NonNullable<typeof recommendation.primaryProduct> } => Boolean(item))
    .map(({ rank, scored }) => ({
      rank,
      productCode: scored.product.normalizedCode,
      displayCode: scored.product.displayCode,
      brand: scored.product.brand ?? null,
      seriesName: scored.product.seriesName ?? null,
      diameterMm: scored.product.diameterMm ?? null,
      fluteCount: scored.product.fluteCount ?? null,
      coating: scored.product.coating ?? null,
      toolSubtype: scored.product.toolSubtype ?? null,
      toolMaterial: scored.product.toolMaterial ?? null,
      score: scored.score,
      matchStatus: scored.matchStatus,
    }))

  return items.length > 0 ? items : null
}

function buildConversationRecommendations(messages: ChatMsg[]) {
  const recommendations = messages.reduce<Array<{
    messageIndex: number
    anchorText: string | null
    products: NonNullable<ReturnType<typeof buildRecommendedProducts>>
  }>>((acc, message, index) => {
    const products = buildRecommendedProducts(message)
    if (message.role !== "ai" || !products) return acc

    acc.push({
      messageIndex: index,
      anchorText: message.text ?? null,
      products,
    })
    return acc
  }, [])

  return recommendations.length > 0 ? recommendations : null
}

function newConversationId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `conv_${crypto.randomUUID()}`
  }
  return `conv_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`
}

function toPersistedMessages(messages: ChatMsg[]) {
  return messages
    .filter(m => !m.isLoading)
    .map(m => ({
      role: m.role,
      text: m.text ?? "",
      createdAt: m.createdAt ?? new Date().toISOString(),
      hasRecommendation: Boolean(m.recommendation),
      thinkingProcess: m.thinkingProcess ?? null,
      thinkingDeep: m.thinkingDeep ?? null,
      reasoningVisibility: m.reasoningVisibility ?? "hidden",
      recommendation: trimRecommendationForPersistence(m.recommendation),
      chipGroups: m.chipGroups ?? [],
      evidenceSummaries: m.evidenceSummaries ?? null,
      primaryExplanation: m.primaryExplanation ?? null,
      feedback: m.feedback ?? null,
      chips: m.chips ?? [],
    }))
}

export function useProductRecommendationPage({
  language,
  country,
  resetKey,
  conversationId: externalConversationId,
  userId = "default",
}: {
  language: "ko" | "en"
  country: string
  resetKey: string | null
  conversationId?: string | null
  userId?: string
}) {
  const [phase, setPhase] = useState<Phase>("intake")
  const [form, setForm] = useState<ProductIntakeForm>(INITIAL_INTAKE_FORM)
  const [chatMessages, setChatMessages] = useState<ChatMsg[]>([])
  const [isChatSending, setIsChatSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sessionState, setSessionState] = useState<RecommendationPublicSessionDto | null>(null)
  const [engineSessionState, setEngineSessionState] = useState<ExplorationSessionState | null>(null)
  const [candidateSnapshot, setCandidateSnapshot] = useState<RecommendationCandidateDto[] | null>(null)
  const [candidatePagination, setCandidatePagination] = useState<RecommendationPaginationDto | null>(null)
  const [isCandidatePageLoading, setIsCandidatePageLoading] = useState(false)
  const [capabilities, setCapabilities] = useState<RecommendationCapabilityDto>(DEFAULT_RECOMMENDATION_CAPABILITIES)

  const sessionEnvelope = useMemo(
    () => buildRecommendationSessionEnvelope(sessionState, engineSessionState),
    [engineSessionState, sessionState]
  )

  const [activeConversationId, setActiveConversationId] = useState<string>(() =>
    externalConversationId ?? newConversationId()
  )
  const restoredRef = useRef<string | null>(null)
  const suppressSaveRef = useRef(false)

  // 대화 복원: URL ?convId= 로 들어왔거나 사이드바에서 선택한 경우
  useEffect(() => {
    if (!externalConversationId) return
    if (externalConversationId === restoredRef.current) return
    if (externalConversationId === activeConversationId && restoredRef.current === activeConversationId) return

    let cancelled = false
    suppressSaveRef.current = true
    ;(async () => {
      try {
        const res = await fetch(`/api/conversations/${encodeURIComponent(externalConversationId)}`, { cache: "no-store" })
        if (!res.ok) {
          if (!cancelled) {
            setActiveConversationId(externalConversationId)
            restoredRef.current = externalConversationId
          }
          return
        }
        const data = await res.json()
        if (cancelled) return

        const restoredMessages: ChatMsg[] = Array.isArray(data.messages)
          ? data.messages.map((m: { role?: string; text?: string; createdAt?: string; chips?: string[]; feedback?: TurnFeedback }) => ({
              role: (m.role === "user" ? "user" : "ai") as "user" | "ai",
              text: m.text ?? "",
              createdAt: m.createdAt,
              thinkingProcess: (m as { thinkingProcess?: string | null }).thinkingProcess ?? null,
              thinkingDeep: (m as { thinkingDeep?: string | null }).thinkingDeep ?? null,
              reasoningVisibility: (m as { reasoningVisibility?: string | null }).reasoningVisibility ?? "hidden",
              recommendation: (m as { recommendation?: unknown }).recommendation as ChatMsg["recommendation"] ?? null,
              chipGroups: (m as { chipGroups?: Array<{ label: string; chips: string[] }> }).chipGroups ?? [],
              evidenceSummaries: (m as { evidenceSummaries?: unknown }).evidenceSummaries as ChatMsg["evidenceSummaries"] ?? null,
              primaryExplanation: (m as { primaryExplanation?: unknown }).primaryExplanation as ChatMsg["primaryExplanation"] ?? null,
              chips: m.chips ?? [],
              feedback: m.feedback ?? null,
            }))
          : []

        const restoredSessionState = (data.sessionState as (RecommendationPublicSessionDto & Record<string, unknown>) | null) ?? null
        const restoredCandidateSnapshot = buildCandidateSnapshotForRestore(restoredMessages, restoredSessionState)

        setActiveConversationId(externalConversationId)
        restoredRef.current = externalConversationId
        setChatMessages(restoredMessages)
        setSessionState(restoredSessionState)
        setCandidateSnapshot(restoredCandidateSnapshot)
        setCandidatePagination(buildCandidatePaginationForRestore(
          restoredCandidateSnapshot,
          typeof restoredSessionState?.candidateCount === "number" ? restoredSessionState.candidateCount : null,
        ))
        if (data.intakeForm && typeof data.intakeForm === "object") {
          setForm({ ...INITIAL_INTAKE_FORM, ...(data.intakeForm as ProductIntakeForm) })
        }
        setPhase(restoredMessages.length > 0 ? "explore" : "intake")
      } catch (e) {
        console.warn("[conversation-restore] failed:", e)
      } finally {
        // Re-enable save after a tick so state has settled
        setTimeout(() => { suppressSaveRef.current = false }, 100)
      }
    })()

    return () => { cancelled = true }
  }, [externalConversationId, activeConversationId])

  // 자동 저장: 대화가 진행 중일 때만 (explore phase + 메시지 있음)
  useEffect(() => {
    if (suppressSaveRef.current) return
    if (phase !== "explore") return
    if (chatMessages.length === 0) return
    if (chatMessages.every(m => m.isLoading)) return
    if (isChatSending) return  // Wait until turn finishes

    const timer = setTimeout(() => {
      const persistedMessages = toPersistedMessages(chatMessages)
      if (persistedMessages.length === 0) return
      void fetch("/api/conversations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conversationId: activeConversationId,
          userId,
          messages: persistedMessages,
          sessionState: sessionState ?? null,
          intakeForm: form ?? null,
        }),
      }).catch(() => {})
    }, 800)

    return () => clearTimeout(timer)
  }, [activeConversationId, chatMessages, form, isChatSending, phase, sessionState, userId])

  // 사이드바 국가 선택 → form.country 자동 동기화
  useEffect(() => {
    if (!country || country === "ALL") return
    setForm(prev => ({
      ...prev,
      country: { status: "known" as const, value: country },
    }))
  }, [country])

  useEffect(() => {
    if (!resetKey) return
    setForm(INITIAL_INTAKE_FORM)
    setChatMessages([])
    setIsChatSending(false)
    setError(null)
    setSessionState(null)
    setEngineSessionState(null)
    setCandidateSnapshot(null)
    setCandidatePagination(null)
    setIsCandidatePageLoading(false)
    setCapabilities(DEFAULT_RECOMMENDATION_CAPABILITIES)
    setPhase("intake")
    // Reset 시 새 대화로 간주
    const freshId = newConversationId()
    setActiveConversationId(freshId)
    restoredRef.current = null
  }, [resetKey])

  const handleFieldChange = (key: keyof ProductIntakeForm, value: AnswerState<string>) => {
    setForm(prev => ({ ...prev, [key]: value }))
  }

  const buildConversationSnapshot = useCallback((messages: ChatMsg[]) => (
    messages.map((message, index) => ({
      index,
      role: message.role,
      text: message.text,
      isLoading: Boolean(message.isLoading),
      chips: message.chips ?? null,
      feedback: message.feedback ?? null,
      chipFeedback: message.chipFeedback ?? null,
      createdAt: message.createdAt ?? null,
    }))
  ), [])

  const buildFeedbackPayload = useCallback((
    updatedMessages: ChatMsg[],
    messageIndex: number,
    latestFeedbackTarget: "response" | "chips" | "recommendation" = "response",
  ) => {
    const aiMessage = updatedMessages[messageIndex]
    const userMessage = messageIndex > 0 ? updatedMessages[messageIndex - 1] : null
    const turnNumber = Math.floor(messageIndex / 2) + 1
    const responseFeedback = aiMessage?.feedback ?? null
    const chipFeedback = aiMessage?.chipFeedback ?? null
    const responseFeedbackEmoji = responseFeedback === "good" ? "👍" : responseFeedback === "bad" ? "👎" : responseFeedback === "neutral" ? "😐" : null
    const chipFeedbackEmoji = chipFeedback === "good" ? "👍" : chipFeedback === "bad" ? "👎" : chipFeedback === "neutral" ? "😐" : null

    return {
      type: "turn_feedback",
      clientEventId: aiMessage?.feedbackGroupId ?? createClientEventId(),
      clientCapturedAt: new Date().toISOString(),
      feedbackGroupId: aiMessage?.feedbackGroupId ?? null,
      turnNumber,
      feedbackTarget: latestFeedbackTarget,
      responseFeedback,
      responseFeedbackEmoji,
      chipFeedback,
      chipFeedbackEmoji,
      userMessage: userMessage?.text ?? "(intake)",
      aiResponse: aiMessage?.text ?? "",
      chips: aiMessage?.chips ?? [],
      sessionId: sessionState?.sessionId ?? null,
      candidateCount: sessionState?.candidateCount ?? null,
      appliedFilters: sessionState?.appliedFilters?.filter(filter => filter.op !== "skip").map(filter => `${filter.field}=${filter.value}`) ?? [],
      conversationLength: updatedMessages.length,
      language,
      formSnapshot: form,
      sessionStateSnapshot: sessionState,
      candidateHighlights: buildCandidateHighlights(candidateSnapshot),
      recommendedProducts: buildRecommendedProducts(aiMessage),
      conversationRecommendations: buildConversationRecommendations(updatedMessages),
      conversationSnapshot: buildConversationSnapshot(updatedMessages),
    }
  }, [buildConversationSnapshot, candidateSnapshot, form, language, sessionState])

  const runRecommendation = async () => {
    setPhase("loading")
    setError(null)
    try {
      const formWithCountry: ProductIntakeForm = {
        ...form,
        country: country && country !== "ALL"
          ? { status: "known" as const, value: country }
          : { status: "known" as const, value: "ALL" },
      }
      const intakeText = buildIntakePromptText(formWithCountry, language)
      const requestPayload = createInitialRecommendationRequest({
        form: formWithCountry,
        language,
        pagination: { page: 0, pageSize: DEFAULT_PAGE_SIZE },
      })

      // Progressive cards (TODO-B): seed placeholder messages immediately, flip
      // to "explore" phase, then let onCards/final progressively fill the AI
      // message. The user sees product cards before the LLM narrative arrives.
      const aiPlaceholderId = createClientEventId()
      setChatMessages([
        { role: "user", text: intakeText, createdAt: new Date().toISOString() },
        {
          role: "ai",
          text: "",
          isLoading: true,
          createdAt: new Date().toISOString(),
          feedbackGroupId: aiPlaceholderId,
          reasoningVisibility: "hidden",
        },
      ])
      setPhase("explore")

      const data = await streamRecommendationViaPython(requestPayload, {
        onThinking: (text, opts) => {
          setChatMessages(prev => {
            const updated = [...prev]
            const lastIndex = updated.length - 1
            const last = updated[lastIndex]
            if (!last || last.role !== "ai") return prev
            // Three channels:
            //   kind="deep"  → full LLM CoT → thinkingDeep (남색 토글 본문)
            //   kind="agent" → 구조화된 판단 트레이스 → thinkingAgent (초록 토글 본문)
            //   kind="stage" or undefined → heartbeat trail → thinkingProcess
            const isDeep = opts?.kind === "deep"
            const isAgent = opts?.kind === "agent"
            if (isDeep) {
              const prevDeep = (last as any).thinkingDeep ?? ""
              const nextDeep = opts?.delta
                ? prevDeep + text
                : prevDeep
                  ? prevDeep.trimEnd() + "\n\n" + text
                  : text
              updated[lastIndex] = { ...last, thinkingDeep: nextDeep, reasoningVisibility: "full" } as any
            } else if (isAgent) {
              const prevAgent = (last as any).thinkingAgent ?? ""
              const nextAgent = opts?.delta
                ? prevAgent + text
                : prevAgent
                  ? prevAgent.trimEnd() + "\n" + text
                  : text
              updated[lastIndex] = { ...last, thinkingAgent: nextAgent, reasoningVisibility: last.reasoningVisibility ?? "simple" } as any
            } else {
              const prevThinking = last.thinkingProcess ?? ""
              const nextText = opts?.delta
                ? prevThinking + text
                : prevThinking
                  ? prevThinking.trimEnd() + "\n\n" + text
                  : text
              updated[lastIndex] = { ...last, thinkingProcess: nextText, reasoningVisibility: "simple" }
            }
            return updated
          })
        },
        onCards: partial => {
          // Populate the right-side "추천 후보" panel as soon as the cards
          // arrive — without this it only updates after the LLM narrative
          // (and the awaited final DTO) finishes.
          if (partial.candidates) setCandidateSnapshot(partial.candidates)
          if (partial.pagination) setCandidatePagination(partial.pagination)
          setChatMessages(prev => {
            const updated = [...prev]
            const lastIndex = updated.length - 1
            const last = updated[lastIndex]
            if (!last || last.role !== "ai") return prev
            updated[lastIndex] = {
              ...last,
              recommendation: partial.recommendation ?? null,
              evidenceSummaries: partial.evidenceSummaries ?? null,
              primaryExplanation: partial.primaryExplanation ?? null,
              primaryFactChecked: partial.primaryFactChecked ?? null,
              altExplanations: partial.altExplanations ?? [],
            }
            return updated
          })
        },
      })
      if (data.error) throw new Error(data.detail ?? data.error)

      setSessionState(data.session.publicState ?? null)
      setEngineSessionState((data.session.engineState as ExplorationSessionState | null) ?? null)
      setCandidateSnapshot(data.candidates ?? null)
      setCandidatePagination(data.pagination ?? null)
      setCapabilities(resolveRecommendationCapabilities(data))

      setChatMessages(prev => {
        const updated = [...prev]
        const lastIndex = updated.length - 1
        if (lastIndex < 0 || updated[lastIndex].role !== "ai") return prev
        const mergedThinkingProcess = pickLongerThinking(updated[lastIndex].thinkingProcess, data.thinkingProcess) || null
        const mergedThinkingDeep = pickLongerThinking((updated[lastIndex] as any).thinkingDeep, (data as any).thinkingDeep) || null
        updated[lastIndex] = {
          role: "ai",
          text: data.text ?? "",
          chips: data.chips ?? [],
          structuredChips: data.structuredChips ?? undefined,
          chipGroups: data.chipGroups ?? undefined,
          recommendation: data.recommendation ?? null,
          evidenceSummaries: data.evidenceSummaries ?? null,
          requestPreparation: data.requestPreparation ?? null,
          primaryExplanation: data.primaryExplanation ?? null,
          primaryFactChecked: data.primaryFactChecked ?? null,
          altExplanations: data.altExplanations ?? [],
          isLoading: false,
          requestPayload,
          responsePayload: data,
          createdAt: updated[lastIndex].createdAt ?? new Date().toISOString(),
          feedbackGroupId: aiPlaceholderId,
          debugTrace: (data as any).meta?.debugTrace ?? null,
          // 스트리밍 중 누적된 실시간 CoT 전문을 최종 요약이 덮어쓰지 않도록 더 긴 쪽을 유지.
          // 백엔드의 최종 thinkingProcess 는 대개 짧은 요약이고, 실시간 누적본이 full trail.
          thinkingProcess: mergedThinkingProcess,
          thinkingDeep: mergedThinkingDeep,
          reasoningVisibility: resolveReasoningVisibility(data.reasoningVisibility, mergedThinkingProcess, mergedThinkingDeep),
        } as ChatMsg
        return updated
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : "알 수 없는 오류")
      setPhase("summary")
    }
  }

  const runRecommendationWithForm = async (overrideForm: ProductIntakeForm) => {
    setForm(overrideForm)
    setPhase("loading")
    setError(null)
    try {
      const formWithCountry: ProductIntakeForm = {
        ...overrideForm,
        country: country && country !== "ALL"
          ? { status: "known" as const, value: country }
          : { status: "known" as const, value: "ALL" },
      }
      const intakeText = buildIntakePromptText(formWithCountry, language)
      const requestPayload = createInitialRecommendationRequest({
        form: formWithCountry,
        language,
        pagination: { page: 0, pageSize: DEFAULT_PAGE_SIZE },
      })

      const aiPlaceholderId = createClientEventId()
      setChatMessages([
        { role: "user", text: intakeText, createdAt: new Date().toISOString() },
        {
          role: "ai",
          text: "",
          isLoading: true,
          createdAt: new Date().toISOString(),
          feedbackGroupId: aiPlaceholderId,
        },
      ])
      setPhase("explore")

      const data = await streamRecommendationViaPython(requestPayload, {
        onThinking: (text, opts) => {
          setChatMessages(prev => {
            const updated = [...prev]
            const lastIndex = updated.length - 1
            const last = updated[lastIndex]
            if (!last || last.role !== "ai") return prev
            // Two channels:
            //   kind="deep" → full LLM CoT, lives in thinkingDeep (toggle body)
            //   kind="stage" or undefined → high-level heartbeat, lives in thinkingProcess
            const isDeep = opts?.kind === "deep"
            if (isDeep) {
              const prevDeep = (last as any).thinkingDeep ?? ""
              const nextDeep = opts?.delta
                ? prevDeep + text
                : prevDeep
                  ? prevDeep.trimEnd() + "\n\n" + text
                  : text
              updated[lastIndex] = { ...last, thinkingDeep: nextDeep } as any
            } else {
              const prevThinking = last.thinkingProcess ?? ""
              const nextText = opts?.delta
                ? prevThinking + text
                : prevThinking
                  ? prevThinking.trimEnd() + "\n\n" + text
                  : text
              updated[lastIndex] = { ...last, thinkingProcess: nextText }
            }
            return updated
          })
        },
        onCards: partial => {
          // Populate the right-side "추천 후보" panel as soon as the cards
          // arrive — without this it only updates after the LLM narrative
          // (and the awaited final DTO) finishes.
          if (partial.candidates) setCandidateSnapshot(partial.candidates)
          if (partial.pagination) setCandidatePagination(partial.pagination)
          setChatMessages(prev => {
            const updated = [...prev]
            const lastIndex = updated.length - 1
            const last = updated[lastIndex]
            if (!last || last.role !== "ai") return prev
            updated[lastIndex] = {
              ...last,
              recommendation: partial.recommendation ?? null,
              evidenceSummaries: partial.evidenceSummaries ?? null,
              primaryExplanation: partial.primaryExplanation ?? null,
              primaryFactChecked: partial.primaryFactChecked ?? null,
              altExplanations: partial.altExplanations ?? [],
            }
            return updated
          })
        },
      })
      if (data.error) throw new Error(data.detail ?? data.error)

      setSessionState(data.session.publicState ?? null)
      setEngineSessionState((data.session.engineState as ExplorationSessionState | null) ?? null)
      setCandidateSnapshot(data.candidates ?? null)
      setCandidatePagination(data.pagination ?? null)
      setCapabilities(resolveRecommendationCapabilities(data))

      setChatMessages(prev => {
        const updated = [...prev]
        const lastIndex = updated.length - 1
        if (lastIndex < 0 || updated[lastIndex].role !== "ai") return prev
        const mergedThinkingProcess = pickLongerThinking(updated[lastIndex].thinkingProcess, data.thinkingProcess) || null
        const mergedThinkingDeep = pickLongerThinking((updated[lastIndex] as any).thinkingDeep, (data as any).thinkingDeep) || null
        updated[lastIndex] = {
          role: "ai",
          text: data.text ?? "",
          chips: data.chips ?? [],
          structuredChips: data.structuredChips ?? undefined,
          chipGroups: data.chipGroups ?? undefined,
          recommendation: data.recommendation ?? null,
          evidenceSummaries: data.evidenceSummaries ?? null,
          requestPreparation: data.requestPreparation ?? null,
          primaryExplanation: data.primaryExplanation ?? null,
          primaryFactChecked: data.primaryFactChecked ?? null,
          altExplanations: data.altExplanations ?? [],
          isLoading: false,
          requestPayload,
          responsePayload: data,
          createdAt: updated[lastIndex].createdAt ?? new Date().toISOString(),
          feedbackGroupId: aiPlaceholderId,
          debugTrace: (data as any).meta?.debugTrace ?? null,
          // 스트리밍 중 누적된 실시간 CoT 전문을 최종 요약이 덮어쓰지 않도록 더 긴 쪽을 유지.
          // 백엔드의 최종 thinkingProcess 는 대개 짧은 요약이고, 실시간 누적본이 full trail.
          thinkingProcess: mergedThinkingProcess,
          thinkingDeep: mergedThinkingDeep,
          reasoningVisibility: resolveReasoningVisibility(data.reasoningVisibility, mergedThinkingProcess, mergedThinkingDeep),
        } as ChatMsg
        return updated
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : "알 수 없는 오류")
      setPhase("intake")
    }
  }

  const handleChatSend = async (
    text: string,
    chipAction?: import("@/lib/contracts/recommendation").StructuredChipDto | null,
  ) => {
    if (isChatSending) return

    const userMessage: ChatMsg = {
      role: "user",
      text,
      createdAt: new Date().toISOString(),
    }
    const loadingMessage: ChatMsg = {
      role: "ai",
      text: "",
      isLoading: true,
      createdAt: new Date().toISOString(),
      feedbackGroupId: createClientEventId(),
      reasoningVisibility: "hidden",
    }

    setChatMessages(prev => [...prev, userMessage, loadingMessage])
    setIsChatSending(true)

    try {
      const history = chatMessages.map(message => ({ role: message.role, text: message.text }))
      history.push({ role: "user", text })

      const formWithCountry: ProductIntakeForm = {
        ...form,
        country: country && country !== "ALL"
          ? { status: "known" as const, value: country }
          : { status: "known" as const, value: "ALL" },
      }
      const baseRequestPayload = createFollowUpRecommendationRequest({
        form: formWithCountry,
        messages: history,
        session: sessionEnvelope,
        candidates: candidateSnapshot,
        language,
        pagination: { page: 0, pageSize: DEFAULT_PAGE_SIZE },
      })
      const requestPayload = chipAction
        ? { ...baseRequestPayload, chipAction }
        : baseRequestPayload

      // Progressive cards (TODO-B): SSE flushes a partial DTO before the LLM
      // narrative arrives so cards render immediately. onCards updates the
      // pending AI message in place; the awaited result is still the final DTO.
      const data = await streamRecommendationViaPython(requestPayload, {
        onThinking: (text, opts) => {
          setChatMessages(prev => {
            const updated = [...prev]
            const lastIndex = updated.length - 1
            const last = updated[lastIndex]
            if (!last || last.role !== "ai") return prev
            // Three channels:
            //   kind="deep"  → full LLM CoT → thinkingDeep (남색 토글 본문)
            //   kind="agent" → 구조화된 판단 트레이스 → thinkingAgent (초록 토글 본문)
            //   kind="stage" or undefined → heartbeat trail → thinkingProcess
            const isDeep = opts?.kind === "deep"
            const isAgent = opts?.kind === "agent"
            if (isDeep) {
              const prevDeep = (last as any).thinkingDeep ?? ""
              const nextDeep = opts?.delta
                ? prevDeep + text
                : prevDeep
                  ? prevDeep.trimEnd() + "\n\n" + text
                  : text
              updated[lastIndex] = { ...last, thinkingDeep: nextDeep, reasoningVisibility: "full" } as any
            } else if (isAgent) {
              const prevAgent = (last as any).thinkingAgent ?? ""
              const nextAgent = opts?.delta
                ? prevAgent + text
                : prevAgent
                  ? prevAgent.trimEnd() + "\n" + text
                  : text
              updated[lastIndex] = { ...last, thinkingAgent: nextAgent, reasoningVisibility: last.reasoningVisibility ?? "simple" } as any
            } else {
              const prevThinking = last.thinkingProcess ?? ""
              const nextText = opts?.delta
                ? prevThinking + text
                : prevThinking
                  ? prevThinking.trimEnd() + "\n\n" + text
                  : text
              updated[lastIndex] = { ...last, thinkingProcess: nextText, reasoningVisibility: "simple" }
            }
            return updated
          })
        },
        onCards: partial => {
          // Populate the right-side "추천 후보" panel as soon as the cards
          // arrive — without this it only updates after the LLM narrative
          // (and the awaited final DTO) finishes.
          if (partial.candidates) setCandidateSnapshot(partial.candidates)
          if (partial.pagination) setCandidatePagination(partial.pagination)
          setChatMessages(prev => {
            const updated = [...prev]
            const lastIndex = updated.length - 1
            const last = updated[lastIndex]
            if (!last || last.role !== "ai") return prev
            updated[lastIndex] = {
              ...last,
              recommendation: partial.recommendation ?? null,
              evidenceSummaries: partial.evidenceSummaries ?? null,
              primaryExplanation: partial.primaryExplanation ?? null,
              primaryFactChecked: partial.primaryFactChecked ?? null,
              altExplanations: partial.altExplanations ?? [],
              // Inline cards render in the chat flow as soon as the stream
              // flushes them — no waiting for the LLM narrative or a CTA click.
              candidateCards: partial.candidates ?? last.candidateCards ?? null,
              candidatePagination: partial.pagination ?? last.candidatePagination ?? null,
              // keep isLoading=true so the typewriter still shows once text arrives
            }
            return updated
          })
        },
      })
      if (data.error) throw new Error(data.detail ?? data.error)
      console.log("[chip-groups:client:response]", {
        purpose: data.purpose,
        chipCount: data.chips?.length ?? 0,
        chipPreview: (data.chips ?? []).slice(0, 6),
        chipGroupCount: data.chipGroups?.length ?? 0,
        chipGroups: (data.chipGroups ?? []).map(group => ({
          label: group.label,
          count: group.chips.length,
          preview: group.chips.slice(0, 4),
        })),
        sessionLastAskedField: data.session.publicState?.lastAskedField ?? null,
        sessionMode: data.session.publicState?.currentMode ?? null,
      })

      if (data.session.publicState !== null || data.session.engineState !== null) {
        setSessionState(data.session.publicState ?? null)
        setEngineSessionState((data.session.engineState as ExplorationSessionState | null) ?? null)
        setCapabilities(resolveRecommendationCapabilities(data))
      } else if (data.purpose === "greeting") {
        setSessionState(null)
        setEngineSessionState(null)
        setCandidateSnapshot(null)
        setCapabilities(DEFAULT_RECOMMENDATION_CAPABILITIES)
      } else {
        setCapabilities(resolveRecommendationCapabilities(data))
      }

      if (data.candidates) setCandidateSnapshot(data.candidates)
      if (data.pagination) setCandidatePagination(data.pagination)

      setChatMessages(prev => {
        const updated = [...prev]
        const mergedThinkingProcess = pickLongerThinking(prev[updated.length - 1]?.thinkingProcess, data.thinkingProcess) || null
        const mergedThinkingDeep = pickLongerThinking((prev[updated.length - 1] as any)?.thinkingDeep, (data as any).thinkingDeep) || null
        const prevMsg = prev[updated.length - 1]
        // Candidates from the final DTO may be null (e.g. a greeting turn with
        // no search). Fall back to whatever the partial stream already put on
        // the message so we don't clobber cards the user is already seeing.
        const finalCards = data.candidates ?? prevMsg?.candidateCards ?? null
        const finalPagination = data.pagination ?? prevMsg?.candidatePagination ?? null
        const nextMessage: ChatMsg = {
          role: "ai",
          text: data.text ?? "",
          recommendation: data.recommendation ?? null,
          chips: data.chips ?? [],
          structuredChips: data.structuredChips ?? undefined,
          chipGroups: data.chipGroups ?? undefined,
          evidenceSummaries: data.evidenceSummaries ?? null,
          requestPreparation: data.requestPreparation ?? null,
          primaryExplanation: data.primaryExplanation ?? null,
          primaryFactChecked: data.primaryFactChecked ?? null,
          altExplanations: data.altExplanations ?? [],
          candidateCards: finalCards,
          candidatePagination: finalPagination,
          isLoading: false,
          requestPayload,
          responsePayload: data,
          createdAt: prev[updated.length - 1]?.createdAt ?? new Date().toISOString(),
          feedbackGroupId: prev[updated.length - 1]?.feedbackGroupId ?? createClientEventId(),
          debugTrace: (data as any).meta?.debugTrace ?? null,
          thinkingProcess: mergedThinkingProcess,
          thinkingDeep: mergedThinkingDeep,
          reasoningVisibility: resolveReasoningVisibility(data.reasoningVisibility, mergedThinkingProcess, mergedThinkingDeep),
        } as ChatMsg
        console.log("[chip-groups:client:store]", {
          messageIndex: updated.length - 1,
          chipCount: nextMessage.chips?.length ?? 0,
          chipPreview: (nextMessage.chips ?? []).slice(0, 6),
          chipGroupCount: nextMessage.chipGroups?.length ?? 0,
          chipGroups: (nextMessage.chipGroups ?? []).map(group => ({
            label: group.label,
            count: group.chips.length,
            preview: group.chips.slice(0, 4),
          })),
        })
        updated[updated.length - 1] = nextMessage
        return updated
      })
    } catch (err) {
      const detail = err instanceof Error ? err.message : ""
      console.error("[chat] error:", err)
      setChatMessages(prev => {
        const updated = [...prev]
        const last = updated[updated.length - 1]
        // Preserve any in-progress thinking trace + surface backend detail so the
        // root cause is visible instead of swallowed by a generic error string.
        updated[updated.length - 1] = {
          ...(last ?? {}),
          role: "ai",
          text: detail
            ? `오류가 발생했습니다: ${detail}`
            : "오류가 발생했습니다. 다시 시도해주세요.",
          isLoading: false,
          thinkingProcess: last?.thinkingProcess ?? null,
          thinkingDeep: (last as any)?.thinkingDeep ?? null,
          reasoningVisibility: resolveReasoningVisibility(
            (last as ChatMsg | undefined)?.reasoningVisibility ?? null,
            last?.thinkingProcess ?? null,
            (last as any)?.thinkingDeep ?? null,
          ),
        } as ChatMsg
        return updated
      })
    } finally {
      setIsChatSending(false)
    }
  }

  /**
   * "📋 지금 바로 제품 보기" CTA — instead of opening the right-side panel,
   * pour the current candidate snapshot into the chat as a new AI message so
   * the cards live inside the conversation flow.
   */
  const handleShowProductCards = () => {
    if (!candidateSnapshot || candidateSnapshot.length === 0) return
    const cards = candidateSnapshot
    const totalCount = candidatePagination?.totalItems ?? cards.length
    setChatMessages(prev => [
      ...prev,
      {
        role: "ai",
        text: language === "ko"
          ? `현재 후보 ${cards.length}개${totalCount > cards.length ? ` (전체 ${totalCount}개 중)` : ""}입니다.`
          : `Showing ${cards.length} candidate${cards.length === 1 ? "" : "s"}${totalCount > cards.length ? ` (out of ${totalCount})` : ""}.`,
        candidateCards: cards,
        createdAt: new Date().toISOString(),
        feedbackGroupId: createClientEventId(),
      },
    ])
  }

  const handleReset = () => {
    setForm(INITIAL_INTAKE_FORM)
    setChatMessages([])
    setIsChatSending(false)
    setError(null)
    setSessionState(null)
    setEngineSessionState(null)
    setCandidateSnapshot(null)
    setCandidatePagination(null)
    setIsCandidatePageLoading(false)
    setCapabilities(DEFAULT_RECOMMENDATION_CAPABILITIES)
    setPhase("intake")
    setActiveConversationId(newConversationId())
    restoredRef.current = null
  }

  const loadCandidatePage = useCallback(async (page: number) => {
    if (isCandidatePageLoading) return

    const sessionId = getPythonSessionId()
    if (!sessionId) {
      // No Python session yet — the user hasn't kicked off a recommendation,
      // so there's nothing to paginate through. Silent no-op rather than a
      // confusing error toast on an idle panel.
      return
    }

    const currentPagination = candidatePagination ?? {
      page: 0,
      pageSize: DEFAULT_PAGE_SIZE,
      totalItems: sessionState?.candidateCount ?? 0,
      totalPages: sessionState?.candidateCount ? Math.ceil(sessionState.candidateCount / DEFAULT_PAGE_SIZE) : 0,
    }

    setIsCandidatePageLoading(true)
    setError(null)

    try {
      const resp = await fetchProductsPage(sessionId, page, currentPagination.pageSize)
      const adapted = adaptProductsPage(resp)
      const nextCards = adapted.candidates.length > 0 ? adapted.candidates : null
      setCandidateSnapshot(nextCards)
      setCandidatePagination(adapted.pagination)
      setSessionState(prev => prev ? { ...prev, candidateCount: adapted.pagination.totalItems } : prev)
      // Keep the inline chat cards in sync with the paged fetch: update the
      // latest AI message (which the pagination UI is attached to) so the
      // user sees the new page right where they clicked.
      setChatMessages(prev => {
        if (prev.length === 0) return prev
        const lastIndex = prev.length - 1
        const last = prev[lastIndex]
        if (!last || last.role !== "ai") return prev
        const updated = [...prev]
        updated[lastIndex] = {
          ...last,
          candidateCards: nextCards,
          candidatePagination: adapted.pagination,
        }
        return updated
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : "알 수 없는 오류")
    } finally {
      setIsCandidatePageLoading(false)
    }
  }, [candidatePagination, isCandidatePageLoading, sessionState?.candidateCount, setError])

  const handleFeedback = (messageIndex: number, feedback: TurnFeedback) => {
    if (!feedback) return
    setChatMessages(prev => {
      const updated = [...prev]
      if (updated[messageIndex]) updated[messageIndex] = { ...updated[messageIndex], feedback }

      fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildFeedbackPayload(updated, messageIndex, "response")),
      }).catch(() => {})

      return updated
    })
  }

  const handleChipFeedback = (messageIndex: number, feedback: TurnFeedback) => {
    if (!feedback) return
    setChatMessages(prev => {
      const updated = [...prev]
      if (updated[messageIndex]) updated[messageIndex] = { ...updated[messageIndex], chipFeedback: feedback }

      fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...buildFeedbackPayload(updated, messageIndex, "chips"),
          userMessage: "(선택지 평가)",
          aiResponse: `칩: ${(updated[messageIndex]?.chips ?? []).join(", ")}`,
        }),
      }).catch(() => {})

      return updated
    })
  }

  const handleRecommendationFeedback = (messageIndex: number, feedback: TurnFeedback) => {
    if (!feedback) return
    setChatMessages(prev => {
      const updated = [...prev]
      if (updated[messageIndex]) updated[messageIndex] = { ...updated[messageIndex], recommendationFeedback: feedback }

      fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...buildFeedbackPayload(updated, messageIndex, "recommendation"),
          userMessage: "(추천 결과 평가)",
          aiResponse: `추천: ${updated[messageIndex]?.recommendation?.primaryProduct?.product?.displayCode ?? "N/A"}`,
        }),
      }).catch(() => {})

      return updated
    })
  }

  const handleSuccessCapture = (comment: string) => {
    const currentSession = sessionState
    const lastAiMsg = [...chatMessages].reverse().find(message => message.role === "ai" && !message.isLoading)
    const lastUserMsg = [...chatMessages].reverse().find(message => message.role === "user")
    const filters = currentSession?.appliedFilters?.filter(filter => filter.op !== "skip") ?? []
    const conditions = filters.map(filter => `${filter.field}=${filter.value}`).join(" / ") || "(없음)"
    const counts = `total=${currentSession?.candidateCount ?? "?"}`
    const narrowingPath = filters.map(filter => `${filter.field}=${filter.value}`).join(" → ") || "(없음)"

    fetch("/api/feedback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "success_case",
        clientEventId: createClientEventId(),
        clientCapturedAt: new Date().toISOString(),
        sessionId: currentSession?.sessionId ?? null,
        userComment: comment,
        mode: currentSession?.lastAction ?? null,
        lastAction: currentSession?.lastAction ?? null,
        lastUserMessage: lastUserMsg?.text ?? "",
        lastAiResponse: lastAiMsg?.text ?? "",
        conditions,
        narrowingPath,
        candidateCounts: counts,
        conversationLength: chatMessages.length,
        language,
        formSnapshot: form,
        sessionStateSnapshot: currentSession,
        candidateHighlights: buildCandidateHighlights(candidateSnapshot),
        recommendedProducts: buildRecommendedProducts(lastAiMsg),
        conversationRecommendations: buildConversationRecommendations(chatMessages),
        appliedFilters: filters.map(filter => `${filter.field}=${filter.value}`),
        chatHistory: chatMessages.map(message => ({ role: message.role, text: message.text })),
        conversationSnapshot: buildConversationSnapshot(chatMessages),
      }),
    }).catch(() => {})
  }

  return {
    conversationId: activeConversationId,
    phase,
    setPhase,
    form,
    chatMessages,
    isChatSending,
    error,
    setError,
    sessionState,
    engineSessionState,
    candidateSnapshot,
    candidatePagination,
    isCandidatePageLoading,
    capabilities,
    handleFieldChange,
    runRecommendation,
    runRecommendationWithForm,
    handleChatSend,
    handleShowProductCards,
    loadCandidatePage,
    handleReset,
    handleFeedback,
    handleChipFeedback,
    handleRecommendationFeedback,
    handleSuccessCapture,
  }
}
