"use client"

import { useCallback, useEffect, useRef, useState } from "react"

import type {
  ConversationFull,
  ConversationMessageDto,
  ConversationSummary,
} from "@/lib/recommendation/infrastructure/persistence/conversation-repository"

export type { ConversationFull, ConversationMessageDto, ConversationSummary }

export interface SaveParams {
  conversationId: string
  userId?: string
  messages: ConversationMessageDto[]
  sessionState: Record<string, unknown> | null
  intakeForm: Record<string, unknown> | null
}

export function useConversationHistory(userId = "default") {
  const [conversations, setConversations] = useState<ConversationSummary[]>([])
  const [total, setTotal] = useState(0)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inflight = useRef<AbortController | null>(null)

  const refresh = useCallback(async () => {
    inflight.current?.abort()
    const ctrl = new AbortController()
    inflight.current = ctrl
    setIsLoading(true)
    setError(null)
    try {
      const res = await fetch(
        `/api/conversations?userId=${encodeURIComponent(userId)}&limit=50`,
        { signal: ctrl.signal, cache: "no-store" },
      )
      if (!res.ok) throw new Error(`list failed: ${res.status}`)
      const data = await res.json()
      setConversations(Array.isArray(data.conversations) ? data.conversations : [])
      setTotal(typeof data.total === "number" ? data.total : 0)
    } catch (e) {
      if ((e as Error).name === "AbortError") return
      console.warn("[use-conversation-history] refresh failed:", e)
      setError((e as Error).message)
    } finally {
      setIsLoading(false)
    }
  }, [userId])

  useEffect(() => {
    void refresh()
    return () => inflight.current?.abort()
  }, [refresh])

  const load = useCallback(async (conversationId: string): Promise<ConversationFull | null> => {
    try {
      const res = await fetch(
        `/api/conversations/${encodeURIComponent(conversationId)}`,
        { cache: "no-store" },
      )
      if (!res.ok) return null
      return (await res.json()) as ConversationFull
    } catch (e) {
      console.warn("[use-conversation-history] load failed:", e)
      return null
    }
  }, [])

  const save = useCallback(async (params: SaveParams): Promise<boolean> => {
    try {
      const res = await fetch("/api/conversations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, ...params }),
      })
      if (!res.ok) return false
      return true
    } catch (e) {
      console.warn("[use-conversation-history] save failed:", e)
      return false
    }
  }, [userId])

  const remove = useCallback(async (conversationId: string): Promise<boolean> => {
    try {
      const res = await fetch(
        `/api/conversations/${encodeURIComponent(conversationId)}`,
        { method: "DELETE" },
      )
      if (!res.ok) return false
      setConversations(prev => prev.filter(c => c.conversationId !== conversationId))
      setTotal(prev => Math.max(0, prev - 1))
      return true
    } catch (e) {
      console.warn("[use-conversation-history] delete failed:", e)
      return false
    }
  }, [])

  return {
    conversations,
    total,
    isLoading,
    error,
    refresh,
    load,
    save,
    remove,
  }
}
