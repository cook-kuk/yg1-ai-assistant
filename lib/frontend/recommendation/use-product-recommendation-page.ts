"use client"

import { useCallback, useEffect, useMemo, useState } from "react"

import type {
  RecommendationCapabilityDto,
  RecommendationCandidateDto,
  RecommendationPublicSessionDto,
} from "@/lib/contracts/recommendation"
import {
  buildRecommendationSessionEnvelope,
  createFollowUpRecommendationRequest,
  createInitialRecommendationRequest,
  parseRecommendationResponse,
} from "@/lib/frontend/recommendation/recommendation-client"
import type { ChatMsg, TurnFeedback } from "@/lib/frontend/recommendation/exploration-types"
import { buildIntakePromptText } from "@/lib/frontend/recommendation/intake-flow"
import type { AnswerState, ProductIntakeForm } from "@/lib/frontend/recommendation/intake-types"
import { INITIAL_INTAKE_FORM } from "@/lib/frontend/recommendation/intake-types"
import {
  DEFAULT_RECOMMENDATION_CAPABILITIES,
  resolveRecommendationCapabilities,
} from "@/lib/frontend/recommendation/recommendation-view-model"
import { createClientEventId } from "@/lib/frontend/recommendation/client-event-id"

export type Phase = "intake" | "summary" | "loading" | "explore"

function buildCandidateHighlights(candidates: RecommendationCandidateDto[] | null) {
  return (candidates ?? []).map(candidate => ({
    rank: candidate.rank,
    productCode: candidate.productCode,
    displayCode: candidate.displayCode,
    score: candidate.score,
  }))
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
  const [engineSessionState, setEngineSessionState] = useState<unknown | null>(null)
  const [candidateSnapshot, setCandidateSnapshot] = useState<RecommendationCandidateDto[] | null>(null)
  const [capabilities, setCapabilities] = useState<RecommendationCapabilityDto>(DEFAULT_RECOMMENDATION_CAPABILITIES)

  const sessionEnvelope = useMemo(
    () => buildRecommendationSessionEnvelope(sessionState, engineSessionState),
    [engineSessionState, sessionState]
  )

  useEffect(() => {
    if (!resetKey) return
    setForm(INITIAL_INTAKE_FORM)
    setChatMessages([])
    setIsChatSending(false)
    setError(null)
    setSessionState(null)
    setEngineSessionState(null)
    setCandidateSnapshot(null)
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
    latestFeedbackTarget: "response" | "chips" = "response",
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
      })

      const res = await fetch("/api/recommend", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestPayload),
      })
      const data = parseRecommendationResponse(await res.json())
      if (data.error) throw new Error(data.detail ?? data.error)

      setSessionState(data.session.publicState ?? null)
      setEngineSessionState(data.session.engineState ?? null)
      setCandidateSnapshot(data.candidates ?? null)
      setCapabilities(resolveRecommendationCapabilities(data))

      setChatMessages([
        { role: "user", text: intakeText, createdAt: new Date().toISOString() },
        {
          role: "ai",
          text: data.text ?? "",
          chips: data.chips ?? [],
          recommendation: data.recommendation ?? null,
          evidenceSummaries: data.evidenceSummaries ?? null,
          requestPreparation: data.requestPreparation ?? null,
          primaryExplanation: data.primaryExplanation ?? null,
          primaryFactChecked: data.primaryFactChecked ?? null,
          altExplanations: data.altExplanations ?? [],
          requestPayload,
          responsePayload: data,
          createdAt: new Date().toISOString(),
          feedbackGroupId: createClientEventId(),
        },
      ])
      setPhase("explore")
    } catch (err) {
      setError(err instanceof Error ? err.message : "알 수 없는 오류")
      setPhase("summary")
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
      })

      const res = await fetch("/api/recommend", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestPayload),
      })
      const data = parseRecommendationResponse(await res.json())
      if (data.error) throw new Error(data.detail ?? data.error)

      if (data.session.publicState !== null || data.session.engineState !== null) {
        setSessionState(data.session.publicState ?? null)
        setEngineSessionState(data.session.engineState ?? null)
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

      setChatMessages(prev => {
        const updated = [...prev]
        updated[updated.length - 1] = {
          role: "ai",
          text: data.text ?? "",
          recommendation: data.recommendation ?? null,
          chips: data.chips ?? [],
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
        }
        return updated
      })
    } catch {
      setChatMessages(prev => {
        const updated = [...prev]
        updated[updated.length - 1] = {
          role: "ai",
          text: "오류가 발생했습니다. 다시 시도해주세요.",
          isLoading: false,
        }
        return updated
      })
    } finally {
      setIsChatSending(false)
    }
  }

  const handleReset = () => {
    setForm(INITIAL_INTAKE_FORM)
    setChatMessages([])
    setIsChatSending(false)
    setError(null)
    setSessionState(null)
    setEngineSessionState(null)
    setCandidateSnapshot(null)
    setCapabilities(DEFAULT_RECOMMENDATION_CAPABILITIES)
    setPhase("intake")
  }

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
    candidateSnapshot,
    capabilities,
    handleFieldChange,
    runRecommendation,
    handleChatSend,
    handleReset,
    handleFeedback,
    handleChipFeedback,
    handleSuccessCapture,
  }
}
