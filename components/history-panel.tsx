"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import {
  ChevronLeft,
  ChevronRight,
  History,
  PenSquare,
  Search as SearchIcon,
  Trash2,
  X as XIcon,
} from "lucide-react"
import { useConversationHistory } from "@/lib/frontend/recommendation/use-conversation-history"
import { cn } from "@/lib/utils"
import { useApp } from "@/lib/store"

const STORAGE_KEY = "yg1.historyPanel.open"
const WIDTH_STORAGE_KEY = "yg1.historyPanel.width"
const DEFAULT_WIDTH = 256
const MIN_WIDTH = 200
const MAX_WIDTH = 480

export function HistoryPanel() {
  const router = useRouter()
  const { language } = useApp()
  const [open, setOpen] = useState(true)
  const [width, setWidth] = useState(DEFAULT_WIDTH)
  const [resizing, setResizing] = useState(false)
  const [historySearch, setHistorySearch] = useState("")
  const { conversations, remove: removeConversation } = useConversationHistory("default", historySearch)
  const asideRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    try {
      const storedOpen = window.localStorage.getItem(STORAGE_KEY)
      if (storedOpen !== null) setOpen(storedOpen === "1")
      const storedWidth = window.localStorage.getItem(WIDTH_STORAGE_KEY)
      if (storedWidth !== null) {
        const n = Number(storedWidth)
        if (Number.isFinite(n) && n >= MIN_WIDTH && n <= MAX_WIDTH) setWidth(n)
      }
    } catch {}
  }, [])

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, open ? "1" : "0")
    } catch {}
  }, [open])

  useEffect(() => {
    try {
      window.localStorage.setItem(WIDTH_STORAGE_KEY, String(width))
    } catch {}
  }, [width])

  // Ctrl/Cmd+B toggles the panel. Skip when user is typing in an input/textarea/contentEditable.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.shiftKey || e.altKey) return
      if (e.key.toLowerCase() !== "b") return
      const t = e.target as HTMLElement | null
      if (t) {
        const tag = t.tagName
        if (tag === "INPUT" || tag === "TEXTAREA" || t.isContentEditable) return
      }
      e.preventDefault()
      setOpen(v => !v)
    }
    window.addEventListener("keydown", handler)
    return () => window.removeEventListener("keydown", handler)
  }, [])

  // Drag-to-resize
  const startResize = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    setResizing(true)
    const startX = e.clientX
    const startWidth = width
    const onMove = (ev: MouseEvent) => {
      const next = startWidth + (ev.clientX - startX)
      setWidth(Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, next)))
    }
    const onUp = () => {
      setResizing(false)
      window.removeEventListener("mousemove", onMove)
      window.removeEventListener("mouseup", onUp)
      document.body.style.cursor = ""
      document.body.style.userSelect = ""
    }
    document.body.style.cursor = "col-resize"
    document.body.style.userSelect = "none"
    window.addEventListener("mousemove", onMove)
    window.addEventListener("mouseup", onUp)
  }, [width])

  const handleNewChat = () => {
    router.push(`/products?reset=${Date.now()}`)
  }

  const searchParams = typeof window !== "undefined" ? new URLSearchParams(window.location.search) : null
  const activeConvId = searchParams?.get("convId") ?? null

  const groupedConversations = (() => {
    const now = Date.now()
    const DAY = 1000 * 60 * 60 * 24
    const bucket = (iso: string): string => {
      const t = new Date(iso).getTime()
      if (!Number.isFinite(t)) return language === "ko" ? "이전" : "Earlier"
      const diffDays = (now - t) / DAY
      if (diffDays < 1) return language === "ko" ? "오늘" : "Today"
      if (diffDays < 2) return language === "ko" ? "어제" : "Yesterday"
      if (diffDays < 7) return language === "ko" ? "지난 7일" : "Previous 7 days"
      if (diffDays < 30) return language === "ko" ? "지난 30일" : "Previous 30 days"
      return language === "ko" ? "이전" : "Earlier"
    }
    const order = language === "ko"
      ? ["오늘", "어제", "지난 7일", "지난 30일", "이전"]
      : ["Today", "Yesterday", "Previous 7 days", "Previous 30 days", "Earlier"]
    const groups = new Map<string, typeof conversations>()
    for (const conv of conversations) {
      const key = bucket(conv.updatedAt)
      if (!groups.has(key)) groups.set(key, [])
      groups.get(key)!.push(conv)
    }
    return order
      .filter(k => groups.has(k))
      .map(k => ({ label: k, items: groups.get(k)! }))
  })()

  const handleConversationClick = (conversationId: string) => {
    router.push(`/products?convId=${encodeURIComponent(conversationId)}`)
  }

  const handleConversationDelete = async (e: React.MouseEvent, conversationId: string) => {
    e.stopPropagation()
    e.preventDefault()
    if (!confirm(language === "ko" ? "이 대화를 삭제할까요?" : "Delete this conversation?")) return
    await removeConversation(conversationId)
    if (activeConvId === conversationId) {
      router.push(`/products?reset=${Date.now()}`)
    }
  }

  const formatTime = (iso: string): string => {
    try {
      const d = new Date(iso)
      const diffMs = Date.now() - d.getTime()
      const hrs = diffMs / (1000 * 60 * 60)
      if (hrs < 1) return language === "ko" ? "방금" : "just now"
      if (hrs < 24) return `${Math.floor(hrs)}${language === "ko" ? "시간 전" : "h ago"}`
      const days = Math.floor(hrs / 24)
      if (days < 7) return `${days}${language === "ko" ? "일 전" : "d ago"}`
      return d.toLocaleDateString(language === "ko" ? "ko-KR" : "en-US", { month: "short", day: "numeric" })
    } catch {
      return ""
    }
  }

  // Collapsed rail
  if (!open) {
    return (
      <aside className="hidden lg:flex flex-col w-10 shrink-0 border-r border-sidebar-border bg-sidebar text-sidebar-foreground">
        <button
          onClick={() => setOpen(true)}
          className="flex items-center justify-center h-12 border-b border-sidebar-border text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
          title={language === "ko" ? "대화 기록 열기 (Ctrl+B)" : "Open history (Ctrl+B)"}
          aria-label={language === "ko" ? "대화 기록 열기" : "Open history"}
        >
          <ChevronRight className="h-4 w-4" />
        </button>
        <button
          onClick={handleNewChat}
          className="flex items-center justify-center py-3 text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
          title={language === "ko" ? "새 대화" : "New chat"}
          aria-label={language === "ko" ? "새 대화" : "New chat"}
        >
          <PenSquare className="h-4 w-4" />
        </button>
        <button
          onClick={() => setOpen(true)}
          className="flex flex-col items-center gap-2 py-3 text-sidebar-foreground/60 hover:bg-sidebar-accent/40 hover:text-sidebar-foreground"
          title={language === "ko" ? "대화 기록" : "History"}
          aria-label={language === "ko" ? "대화 기록" : "History"}
        >
          <History className="h-4 w-4" />
          {conversations.length > 0 && (
            <span className="text-[10px] font-medium">{conversations.length}</span>
          )}
        </button>
      </aside>
    )
  }

  // Expanded panel
  return (
    <aside
      ref={asideRef}
      style={{ width }}
      className="hidden lg:flex relative flex-col shrink-0 border-r border-sidebar-border bg-sidebar text-sidebar-foreground"
    >
      <div className="flex items-center gap-2 h-12 px-3 border-b border-sidebar-border">
        <History className="h-4 w-4 text-sidebar-foreground/70" />
        <span className="flex-1 text-sm font-semibold">
          {language === "ko" ? "대화 기록" : "History"}
        </span>
        {conversations.length > 0 && (
          <span className="text-[10px] text-sidebar-foreground/50">{conversations.length}</span>
        )}
        <button
          onClick={handleNewChat}
          className="p-1 rounded text-sidebar-foreground/60 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
          title={language === "ko" ? "새 대화" : "New chat"}
          aria-label={language === "ko" ? "새 대화" : "New chat"}
        >
          <PenSquare className="h-4 w-4" />
        </button>
        <button
          onClick={() => setOpen(false)}
          className="p-1 -mr-1 rounded text-sidebar-foreground/60 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
          title={language === "ko" ? "대화 기록 닫기 (Ctrl+B)" : "Collapse history (Ctrl+B)"}
          aria-label={language === "ko" ? "대화 기록 닫기" : "Collapse history"}
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
      </div>

      <div className="relative px-3 py-2 border-b border-sidebar-border">
        <SearchIcon className="absolute left-5 top-1/2 h-3 w-3 -translate-y-1/2 text-sidebar-foreground/40" />
        <input
          type="text"
          value={historySearch}
          onChange={e => setHistorySearch(e.target.value)}
          placeholder={language === "ko" ? "대화 검색..." : "Search conversations..."}
          className="h-7 w-full rounded-md border border-sidebar-border bg-sidebar-accent/40 pl-6 pr-6 text-xs text-sidebar-foreground placeholder:text-sidebar-foreground/40 focus:outline-none focus:ring-1 focus:ring-sidebar-primary"
        />
        {historySearch && (
          <button
            onClick={() => setHistorySearch("")}
            className="absolute right-4 top-1/2 -translate-y-1/2 text-sidebar-foreground/40 hover:text-sidebar-foreground"
            title={language === "ko" ? "지우기" : "Clear"}
          >
            <XIcon className="h-3 w-3" />
          </button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto px-2 py-2">
        {conversations.length === 0 ? (
          <div className="px-3 py-2 text-xs text-sidebar-foreground/40">
            {historySearch
              ? (language === "ko" ? "검색 결과가 없습니다" : "No matches")
              : (language === "ko" ? "저장된 대화가 없습니다" : "No saved conversations")}
          </div>
        ) : (
          groupedConversations.map(group => (
            <div key={group.label} className="mt-1 first:mt-0">
              <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-sidebar-foreground/40">
                {group.label}
              </div>
              <ul className="space-y-0.5">
                {group.items.map(conv => {
                  const isActive = activeConvId === conv.conversationId
                  return (
                    <li key={conv.conversationId} className="group relative">
                      <button
                        onClick={() => handleConversationClick(conv.conversationId)}
                        className={cn(
                          "flex w-full flex-col items-start gap-0.5 rounded-md px-2 py-2 text-left text-xs transition-colors",
                          isActive
                            ? "bg-sidebar-accent text-sidebar-accent-foreground"
                            : "text-sidebar-foreground/80 hover:bg-sidebar-accent/50"
                        )}
                      >
                        <div className="flex w-full items-center gap-1.5">
                          <span className="flex-1 truncate font-medium">{conv.title}</span>
                          <span className="shrink-0 text-[9px] text-sidebar-foreground/40">
                            {formatTime(conv.updatedAt)}
                          </span>
                        </div>
                        {conv.lastUserMessage && (
                          <span className="line-clamp-1 text-[10px] text-sidebar-foreground/50">
                            {conv.lastUserMessage}
                          </span>
                        )}
                        {conv.filterSummary.length > 0 && (
                          <div className="mt-0.5 flex flex-wrap gap-1">
                            {conv.filterSummary.slice(0, 3).map((f, i) => (
                              <span
                                key={i}
                                className="rounded bg-sidebar-accent/70 px-1 py-[1px] text-[9px] text-sidebar-foreground/60"
                              >
                                {f}
                              </span>
                            ))}
                          </div>
                        )}
                      </button>
                      <button
                        onClick={(e) => handleConversationDelete(e, conv.conversationId)}
                        className="absolute right-1.5 top-1.5 hidden rounded p-1 text-sidebar-foreground/40 hover:bg-red-500/20 hover:text-red-500 group-hover:block"
                        title={language === "ko" ? "삭제" : "Delete"}
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </li>
                  )
                })}
              </ul>
            </div>
          ))
        )}
      </div>

      {/* Resize handle */}
      <div
        onMouseDown={startResize}
        onDoubleClick={() => setWidth(DEFAULT_WIDTH)}
        role="separator"
        aria-orientation="vertical"
        title={language === "ko" ? "드래그로 크기 조절 (더블클릭: 초기화)" : "Drag to resize (double-click: reset)"}
        className={cn(
          "absolute top-0 right-0 h-full w-1 cursor-col-resize hover:bg-sidebar-primary/40",
          resizing && "bg-sidebar-primary/60"
        )}
      />
    </aside>
  )
}
