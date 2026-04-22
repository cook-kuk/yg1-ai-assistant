"use client"

/**
 * AI 채팅 사이드바 (v3 persistent conversational)
 *
 * - 우측 FAB → 클릭 시 sliding panel (400px)
 * - multi-turn 대화, localStorage persistence (최근 50개)
 * - SSE 스트리밍으로 실시간 응답
 * - 매 요청 시 현재 simulator context 주입
 */

import { useCallback, useEffect, useRef, useState } from "react"
import {
  MessageSquare,
  X,
  Send,
  Loader2,
  Trash2,
  Copy,
  Check,
} from "lucide-react"
import { AnimatePresence, motion } from "framer-motion"
import { toast } from "sonner"
import { Markdown } from "@/components/ui/markdown"

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────

interface ChatMessage {
  role: "user" | "assistant"
  content: string
  timestamp: number
}

export interface AiChatSidebarProps {
  /** 현재 simulator state — 매 turn 시스템 프롬프트에 주입 */
  context: unknown
  /** 다크모드 스타일 활성화 */
  darkMode?: boolean
  /** API endpoint override (기본 /api/simulator/chat) */
  endpoint?: string
}

// ─────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────

const STORAGE_KEY = "yg1-sim-v3-chat-history"
const MAX_HISTORY = 50
const WELCOME_MESSAGE: ChatMessage = {
  role: "assistant",
  content: "안녕하세요! 현재 조건에 대해 궁금한 점을 물어보세요.",
  timestamp: 0,
}

// ─────────────────────────────────────────────────────────────
// Storage helpers
// ─────────────────────────────────────────────────────────────

function loadHistory(): ChatMessage[] {
  if (typeof window === "undefined") return [WELCOME_MESSAGE]
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return [WELCOME_MESSAGE]
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed) || parsed.length === 0) return [WELCOME_MESSAGE]
    return parsed
      .filter(
        (m): m is ChatMessage =>
          m &&
          typeof m === "object" &&
          (m.role === "user" || m.role === "assistant") &&
          typeof m.content === "string" &&
          typeof m.timestamp === "number",
      )
      .slice(-MAX_HISTORY)
  } catch {
    return [WELCOME_MESSAGE]
  }
}

function saveHistory(messages: ChatMessage[]) {
  if (typeof window === "undefined") return
  try {
    const slice = messages.slice(-MAX_HISTORY)
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(slice))
  } catch {
    /* quota exceeded 등 무시 */
  }
}

// ─────────────────────────────────────────────────────────────
// SSE stream consumer
// ─────────────────────────────────────────────────────────────

interface StreamHandlers {
  onDelta: (text: string) => void
  onDone: () => void
  onError: (msg: string) => void
}

async function consumeChatStream(
  response: Response,
  handlers: StreamHandlers,
  signal: AbortSignal,
) {
  if (!response.body) {
    handlers.onError("응답 body가 없습니다")
    return
  }
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ""
  let sawDone = false
  try {
    while (true) {
      if (signal.aborted) {
        try {
          await reader.cancel()
        } catch {
          /* noop */
        }
        return
      }
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })

      const events = buffer.split("\n\n")
      buffer = events.pop() ?? ""

      for (const evt of events) {
        const line = evt.split("\n").find((l) => l.startsWith("data:"))
        if (!line) continue
        const payload = line.slice(5).trim()
        if (!payload) continue
        let parsed: { type?: string; [k: string]: unknown }
        try {
          parsed = JSON.parse(payload)
        } catch {
          continue
        }
        if (parsed.type === "delta" && typeof parsed.text === "string") {
          handlers.onDelta(parsed.text)
        } else if (parsed.type === "done") {
          sawDone = true
          handlers.onDone()
        } else if (parsed.type === "error") {
          handlers.onError(
            typeof parsed.message === "string"
              ? parsed.message
              : "알 수 없는 에러",
          )
          return
        }
      }
    }
    if (!sawDone) handlers.onDone()
  } catch (err) {
    if (signal.aborted) return
    handlers.onError(err instanceof Error ? err.message : String(err))
  }
}

// ─────────────────────────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────────────────────────

function TypingIndicator({ darkMode }: { darkMode?: boolean }) {
  const dotBase = darkMode ? "bg-slate-300" : "bg-slate-500"
  return (
    <div className="flex items-center gap-1 px-2 py-1">
      {[0, 1, 2].map((i) => (
        <motion.span
          key={i}
          className={`h-1.5 w-1.5 rounded-full ${dotBase}`}
          animate={{ opacity: [0.3, 1, 0.3] }}
          transition={{
            duration: 1.2,
            repeat: Infinity,
            delay: i * 0.2,
          }}
        />
      ))}
    </div>
  )
}

function formatTimestamp(ts: number): string {
  if (!ts) return ""
  try {
    const d = new Date(ts)
    const hh = String(d.getHours()).padStart(2, "0")
    const mm = String(d.getMinutes()).padStart(2, "0")
    return `${hh}:${mm}`
  } catch {
    return ""
  }
}

function MessageBubble({
  msg,
  streaming,
  darkMode,
}: {
  msg: ChatMessage
  streaming?: boolean
  darkMode?: boolean
}) {
  const [copied, setCopied] = useState(false)
  const isUser = msg.role === "user"

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(msg.content)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      toast.error("복사 실패")
    }
  }

  const userBubble = darkMode
    ? "bg-sky-500 text-white"
    : "bg-blue-500 text-white"
  const assistantBubble = darkMode
    ? "bg-slate-800 text-slate-100 border border-slate-700"
    : "bg-slate-100 text-slate-900 border border-slate-200"
  const timestampColor = darkMode ? "text-slate-500" : "text-slate-500"

  return (
    <div
      className={`group flex w-full ${isUser ? "justify-end" : "justify-start"}`}
    >
      <div
        className={`relative max-w-[85%] rounded-2xl px-3 py-2 text-sm leading-relaxed shadow-sm ${
          isUser ? userBubble : assistantBubble
        }`}
      >
        {streaming && !msg.content ? (
          <TypingIndicator darkMode={darkMode} />
        ) : isUser ? (
          <div className="whitespace-pre-wrap break-words">{msg.content}</div>
        ) : (
          <Markdown className="text-sm leading-relaxed">{msg.content}</Markdown>
        )}

        {streaming && msg.content && (
          <div className="mt-1 flex items-center gap-1 opacity-70">
            <Loader2 className="h-3 w-3 animate-spin" />
            <span className="text-[10px]">생성 중...</span>
          </div>
        )}

        <div
          className={`mt-1 flex items-center gap-2 text-[10px] ${
            isUser ? "text-sky-100" : timestampColor
          }`}
        >
          <span>{formatTimestamp(msg.timestamp)}</span>
          {msg.content && !streaming && (
            <button
              type="button"
              onClick={handleCopy}
              className={`ml-auto rounded p-0.5 opacity-0 transition hover:bg-black/10 group-hover:opacity-100 ${
                isUser ? "hover:bg-white/20" : ""
              }`}
              aria-label="메시지 복사"
              title="복사"
            >
              {copied ? (
                <Check className="h-3 w-3" />
              ) : (
                <Copy className="h-3 w-3" />
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────
// Main component
// ─────────────────────────────────────────────────────────────

export function AiChatSidebar({
  context,
  darkMode = false,
  endpoint = "/api/simulator/chat",
}: AiChatSidebarProps) {
  const [open, setOpen] = useState(false)
  const [messages, setMessages] = useState<ChatMessage[]>(() => [
    WELCOME_MESSAGE,
  ])
  const [input, setInput] = useState("")
  const [streaming, setStreaming] = useState(false)

  const abortRef = useRef<AbortController | null>(null)
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const hydratedRef = useRef(false)

  // 초기 hydrate (localStorage)
  useEffect(() => {
    if (hydratedRef.current) return
    hydratedRef.current = true
    const loaded = loadHistory()
    if (loaded.length > 0) setMessages(loaded)
  }, [])

  // 저장 (hydrate 이후만)
  useEffect(() => {
    if (!hydratedRef.current) return
    saveHistory(messages)
  }, [messages])

  // 스크롤 bottom 자동
  useEffect(() => {
    if (!scrollRef.current) return
    scrollRef.current.scrollTop = scrollRef.current.scrollHeight
  }, [messages, open, streaming])

  // 언마운트 시 abort
  useEffect(() => {
    return () => {
      abortRef.current?.abort()
    }
  }, [])

  // 열릴 때 textarea 포커스
  useEffect(() => {
    if (open) {
      setTimeout(() => textareaRef.current?.focus(), 250)
    }
  }, [open])

  const handleSend = useCallback(async () => {
    const trimmed = input.trim()
    if (!trimmed || streaming) return

    const now = Date.now()
    const userMsg: ChatMessage = {
      role: "user",
      content: trimmed,
      timestamp: now,
    }
    const placeholder: ChatMessage = {
      role: "assistant",
      content: "",
      timestamp: now + 1,
    }

    // 다음 요청에 보낼 history (환영 메시지 timestamp=0 는 제외)
    const nextHistory = [...messages, userMsg]
    setMessages([...nextHistory, placeholder])
    setInput("")
    setStreaming(true)

    abortRef.current?.abort()
    const ctrl = new AbortController()
    abortRef.current = ctrl

    const apiMessages = nextHistory
      .filter((m) => m.timestamp !== 0 || m.role !== "assistant")
      .map((m) => ({ role: m.role, content: m.content }))

    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: apiMessages, context }),
        signal: ctrl.signal,
      })

      if (!res.ok) {
        let errMsg = `HTTP ${res.status}`
        try {
          const j = await res.json()
          if (j?.error) errMsg = String(j.error)
        } catch {
          /* noop */
        }
        toast.error(`AI 응답 실패: ${errMsg}`)
        setMessages((prev) => prev.slice(0, -1))
        setStreaming(false)
        return
      }

      let accumulated = ""
      await consumeChatStream(
        res,
        {
          onDelta: (t) => {
            accumulated += t
            setMessages((prev) => {
              const copy = [...prev]
              const last = copy[copy.length - 1]
              if (last && last.role === "assistant") {
                copy[copy.length - 1] = { ...last, content: accumulated }
              }
              return copy
            })
          },
          onDone: () => {
            setStreaming(false)
          },
          onError: (m) => {
            toast.error(`AI 에러: ${m}`)
            setMessages((prev) => prev.slice(0, -1))
            setStreaming(false)
          },
        },
        ctrl.signal,
      )
    } catch (err) {
      if (ctrl.signal.aborted) return
      toast.error(
        `요청 실패: ${err instanceof Error ? err.message : String(err)}`,
      )
      setMessages((prev) => prev.slice(0, -1))
      setStreaming(false)
    }
  }, [input, streaming, messages, endpoint, context])

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      void handleSend()
    }
  }

  const handleReset = () => {
    abortRef.current?.abort()
    setMessages([{ ...WELCOME_MESSAGE, timestamp: 0 }])
    setStreaming(false)
    toast.success("대화 기록이 초기화되었습니다")
  }

  // ───── 스타일 토큰 ─────
  const panelBg = darkMode
    ? "bg-slate-950 border-slate-800"
    : "bg-white border-slate-200"
  const headerBg = darkMode
    ? "bg-slate-900 border-slate-800 text-slate-100"
    : "bg-slate-50 border-slate-200 text-slate-900"
  const bodyBg = darkMode ? "bg-slate-950" : "bg-white"
  const inputBg = darkMode
    ? "bg-slate-900 border-slate-700 text-slate-100 placeholder-slate-500"
    : "bg-white border-slate-300 text-slate-900 placeholder-slate-500"
  const iconBtn = darkMode
    ? "text-slate-300 hover:bg-slate-800 hover:text-white"
    : "text-slate-600 hover:bg-slate-200 hover:text-slate-900"

  return (
    <>
      {/* ───── FAB (수축 상태) ───── */}
      <AnimatePresence>
        {!open && (
          <motion.div
            key="fab"
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.8 }}
            transition={{ duration: 0.2 }}
            className="group fixed bottom-24 right-5 z-[70] flex flex-col items-center"
          >
            <button
              type="button"
              onClick={() => setOpen(true)}
              aria-label="AI 채팅 열기"
              className="relative h-14 w-14 rounded-full bg-gradient-to-br from-sky-500 to-indigo-600 text-white shadow-lg shadow-sky-500/40 transition hover:scale-105 hover:shadow-xl focus:outline-none focus:ring-4 focus:ring-sky-400/40"
            >
              <span className="pointer-events-none absolute inset-0 animate-ping rounded-full bg-sky-400/40" />
              <MessageSquare
                className="mx-auto h-6 w-6"
                aria-hidden="true"
              />
            </button>
            <span
              className="pointer-events-none mt-2 whitespace-nowrap rounded-full bg-black/70 px-2 py-0.5 text-[11px] text-white opacity-0 shadow transition group-hover:opacity-100"
            >
              💬 AI 채팅
            </span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ───── Sliding Panel (확장 상태) ───── */}
      <AnimatePresence>
        {open && (
          <motion.aside
            key="panel"
            initial={{ x: 400, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: 400, opacity: 0 }}
            transition={{ type: "tween", duration: 0.28, ease: "easeOut" }}
            className={`fixed right-0 top-0 bottom-0 z-[75] flex w-[400px] max-w-[90vw] flex-col border-l shadow-2xl ${panelBg}`}
            role="dialog"
            aria-modal="true"
            aria-labelledby="yg1-ai-chat-title"
          >
            {/* Header */}
            <header
              className={`flex items-center justify-between border-b px-4 py-3 ${headerBg}`}
            >
              <h2
                id="yg1-ai-chat-title"
                className="flex items-center gap-2 text-sm font-semibold"
              >
                <span aria-hidden="true">💬</span>
                <span>AI 어시스턴트</span>
              </h2>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={handleReset}
                  className={`inline-flex items-center gap-1 rounded px-2 py-1 text-xs transition ${iconBtn}`}
                  title="대화 초기화"
                  aria-label="대화 초기화"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  <span>초기화</span>
                </button>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className={`rounded p-1.5 transition ${iconBtn}`}
                  title="닫기"
                  aria-label="사이드바 닫기"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </header>

            {/* Messages */}
            <div
              ref={scrollRef}
              className={`flex-1 space-y-3 overflow-y-auto px-4 py-3 ${bodyBg}`}
            >
              {messages.map((m, idx) => {
                const isLast = idx === messages.length - 1
                const isStreamingMsg =
                  isLast && streaming && m.role === "assistant"
                return (
                  <MessageBubble
                    key={`${m.timestamp}-${idx}`}
                    msg={m}
                    streaming={isStreamingMsg}
                    darkMode={darkMode}
                  />
                )
              })}
            </div>

            {/* Input */}
            <div
              className={`border-t p-3 ${
                darkMode ? "border-slate-800 bg-slate-900" : "border-slate-200 bg-slate-50"
              }`}
            >
              <div className="flex items-end gap-2">
                <textarea
                  ref={textareaRef}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="질문을 입력하세요 (Shift+Enter 줄바꿈)"
                  aria-label="AI 질문 입력"
                  rows={2}
                  disabled={streaming}
                  className={`flex-1 resize-none rounded-lg border px-3 py-2 text-sm outline-none transition focus:border-sky-500 focus:ring-1 focus:ring-sky-500 disabled:opacity-60 ${inputBg}`}
                />
                <button
                  type="button"
                  onClick={() => void handleSend()}
                  disabled={streaming || !input.trim()}
                  aria-label="메시지 전송"
                  className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-sky-500 to-indigo-600 text-white shadow transition hover:scale-105 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:scale-100"
                >
                  {streaming ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Send className="h-4 w-4" />
                  )}
                </button>
              </div>
              <p
                className={`mt-1.5 text-[10px] ${
                  darkMode ? "text-slate-500" : "text-slate-500"
                }`}
              >
                현재 시뮬 조건이 매 요청에 함께 전송됩니다.
              </p>
            </div>
          </motion.aside>
        )}
      </AnimatePresence>
    </>
  )
}

export default AiChatSidebar
