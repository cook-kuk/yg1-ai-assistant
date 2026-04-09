"use client"

import { useCallback, useEffect, useMemo, useState } from "react"

import type {
  RecommendationCapabilityDto,
  RecommendationCandidateDto,
  RecommendationPaginationDto,
  RecommendationPublicSessionDto,
} from "@/lib/contracts/recommendation"
import type { ExplorationSessionState } from "@/lib/recommendation/domain/types"
import {
  buildRecommendationSessionEnvelope,
  createCandidatePaginationRequest,
  createFollowUpRecommendationRequest,
  createInitialRecommendationRequest,
  parseRecommendationResponse,
} from "@/lib/frontend/recommendation/recommendation-client"
import { streamRecommendation } from "@/lib/frontend/recommendation/recommendation-stream-client"
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

export type Phase = "intake" | "summary" | "loading" | "explore"
// 설일석 피드백(2026-04-07): "추천 제품 종류가 너무 많아 고객이 혼란".
// 50→20으로 축소. 더 보고 싶을 때 페이지네이션으로 추가 로드 가능.
const DEFAULT_PAGE_SIZE = 20

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

export function useProductRecommendationPage({
  language,
  country,
  resetKey,
}: {
  language: "ko" | "en"
  country: string
  resetKey: string | null
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
        },
      ])
      setPhase("explore")

      const data = await streamRecommendation(requestPayload, {
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
        updated[lastIndex] = {
          role: "ai",
          text: data.text ?? "",
          chips: data.chips ?? [],
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
          thinkingProcess: pickLongerThinking(updated[lastIndex].thinkingProcess, data.thinkingProcess) || null,
          thinkingDeep: pickLongerThinking((updated[lastIndex] as any).thinkingDeep, (data as any).thinkingDeep) || null,
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

      const data = await streamRecommendation(requestPayload, {
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
        updated[lastIndex] = {
          role: "ai",
          text: data.text ?? "",
          chips: data.chips ?? [],
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
          thinkingProcess: pickLongerThinking(updated[lastIndex].thinkingProcess, data.thinkingProcess) || null,
          thinkingDeep: pickLongerThinking((updated[lastIndex] as any).thinkingDeep, (data as any).thinkingDeep) || null,
        } as ChatMsg
        return updated
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : "알 수 없는 오류")
      setPhase("intake")
    }
  }

  const handleChatSend = async (text: string) => {
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
      const requestPayload = createFollowUpRecommendationRequest({
        form: formWithCountry,
        messages: history,
        session: sessionEnvelope,
        candidates: candidateSnapshot,
        language,
        pagination: { page: 0, pageSize: DEFAULT_PAGE_SIZE },
      })

      // Progressive cards (TODO-B): SSE flushes a partial DTO before the LLM
      // narrative arrives so cards render immediately. onCards updates the
      // pending AI message in place; the awaited result is still the final DTO.
      const data = await streamRecommendation(requestPayload, {
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
        const nextMessage: ChatMsg = {
          role: "ai",
          text: data.text ?? "",
          recommendation: data.recommendation ?? null,
          chips: data.chips ?? [],
          chipGroups: data.chipGroups ?? undefined,
          evidenceSummaries: data.evidenceSummaries ?? null,
          requestPreparation: data.requestPreparation ?? null,
          primaryExplanation: data.primaryExplanation ?? null,
          primaryFactChecked: data.primaryFactChecked ?? null,
          altExplanations: data.altExplanations ?? [],
          isLoading: false,
          requestPayload,
          responsePayload: data,
          createdAt: prev[updated.length - 1]?.createdAt ?? new Date().toISOString(),
          feedbackGroupId: prev[updated.length - 1]?.feedbackGroupId ?? createClientEventId(),
          debugTrace: (data as any).meta?.debugTrace ?? null,
          thinkingProcess: pickLongerThinking(prev[updated.length - 1]?.thinkingProcess, data.thinkingProcess) || null,
          thinkingDeep: pickLongerThinking((prev[updated.length - 1] as any)?.thinkingDeep, (data as any).thinkingDeep) || null,
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
  }

  const loadCandidatePage = useCallback(async (page: number) => {
    if (isCandidatePageLoading) return

    const currentPagination = candidatePagination ?? {
      page: 0,
      pageSize: DEFAULT_PAGE_SIZE,
      totalItems: sessionState?.candidateCount ?? 0,
      totalPages: sessionState?.candidateCount ? Math.ceil(sessionState.candidateCount / DEFAULT_PAGE_SIZE) : 0,
    }

    setIsCandidatePageLoading(true)
    setError(null)

    try {
      const formWithCountry: ProductIntakeForm = {
        ...form,
        country: country && country !== "ALL"
          ? { status: "known" as const, value: country }
          : { status: "known" as const, value: "ALL" },
      }

      const requestPayload = createCandidatePaginationRequest({
        form: formWithCountry,
        session: sessionEnvelope,
        language,
        pagination: { page, pageSize: currentPagination.pageSize },
      })

      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 55000) // 55s timeout (server maxDuration=60s)
      const res = await fetch("/api/recommend", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestPayload),
        signal: controller.signal,
      }).finally(() => clearTimeout(timeout))
      if (!res.ok) throw new Error(`서버 오류 (${res.status})`)
      const data = parseRecommendationResponse(await res.json())
      if (data.error) throw new Error(data.detail ?? data.error)

      setSessionState(data.session.publicState ?? null)
      setEngineSessionState((data.session.engineState as ExplorationSessionState | null) ?? null)
      setCapabilities(resolveRecommendationCapabilities(data))
      setCandidateSnapshot(data.candidates ?? null)
      if (data.pagination) setCandidatePagination(data.pagination)
    } catch (err) {
      setError(err instanceof Error ? err.message : "알 수 없는 오류")
    } finally {
      setIsCandidatePageLoading(false)
    }
  }, [candidatePagination, country, form, isCandidatePageLoading, language, sessionEnvelope, sessionState?.candidateCount, setError])

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
