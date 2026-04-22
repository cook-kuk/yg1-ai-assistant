"use client"

import { useEffect } from "react"

type SnapshotSlot = "A" | "B" | "C" | "D"

interface ShortcutHandlers {
  onSaveSnapshot?: (slot: SnapshotSlot) => void
  onOpenHelp?: () => void
  onOpenCommand?: () => void
  onPrint?: () => void
  onTogglePdf?: () => void
  onUndo?: () => void
  onRedo?: () => void
  enabled?: boolean
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!target || !(target instanceof HTMLElement)) return false
  const tag = target.tagName
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true
  if (target.isContentEditable) return true
  return false
}

function isComposing(event: KeyboardEvent): boolean {
  // `isComposing` is the modern API; 229 is the legacy IME sentinel.
  return event.isComposing || event.keyCode === 229
}

export function useSimulatorShortcuts(handlers: ShortcutHandlers): void {
  const {
    onSaveSnapshot,
    onOpenHelp,
    onOpenCommand,
    onPrint,
    onTogglePdf,
    onUndo,
    onRedo,
    enabled = true,
  } = handlers

  useEffect(() => {
    if (!enabled) return

    const handleKeyDown = (event: KeyboardEvent) => {
      if (isComposing(event)) return

      const editable = isEditableTarget(event.target)
      const mod = event.ctrlKey || event.metaKey
      const key = event.key

      // Esc is allowed even inside inputs so modals can close.
      if (key === "Escape") {
        // Parent components handle Esc through their own modal listeners;
        // we intentionally do not intercept it here.
        return
      }

      if (editable) return

      // Ctrl/Cmd + S → snapshot A, Ctrl/Cmd + Shift + S → snapshot B
      if (mod && (key === "s" || key === "S")) {
        if (!onSaveSnapshot) return
        event.preventDefault()
        onSaveSnapshot(event.shiftKey ? "B" : "A")
        return
      }

      // Ctrl/Cmd + K → command palette
      if (mod && (key === "k" || key === "K")) {
        if (!onOpenCommand) return
        event.preventDefault()
        onOpenCommand()
        return
      }

      // Ctrl/Cmd + Z → undo, Ctrl/Cmd + Shift + Z (or Y) → redo
      if (mod && (key === "z" || key === "Z")) {
        if (event.shiftKey) {
          if (!onRedo) return
          event.preventDefault()
          onRedo()
          return
        }
        if (!onUndo) return
        event.preventDefault()
        onUndo()
        return
      }
      if (mod && (key === "y" || key === "Y")) {
        if (!onRedo) return
        event.preventDefault()
        onRedo()
        return
      }

      // Ctrl/Cmd + P → print / toggle PDF
      if (mod && (key === "p" || key === "P")) {
        const handler = onPrint ?? onTogglePdf
        if (!handler) return
        event.preventDefault()
        handler()
        return
      }

      // `?` (Shift + /) → help overlay
      if (key === "?" && !mod) {
        if (!onOpenHelp) return
        event.preventDefault()
        onOpenHelp()
        return
      }
    }

    window.addEventListener("keydown", handleKeyDown)
    return () => {
      window.removeEventListener("keydown", handleKeyDown)
    }
  }, [enabled, onSaveSnapshot, onOpenHelp, onOpenCommand, onPrint, onTogglePdf, onUndo, onRedo])
}

export interface ShortcutHint {
  keys: string[]
  label: string
  description?: string
  icon: string
  category: "snapshot" | "output" | "nav" | "help"
}

export const SHORTCUT_HINTS: ShortcutHint[] = [
  { keys: ["Ctrl", "S"], label: "스냅샷 A 저장", description: "현재 조건을 A슬롯에", icon: "💾", category: "snapshot" },
  { keys: ["Ctrl", "Shift", "S"], label: "스냅샷 B 저장", description: "현재 조건을 B슬롯에", icon: "💾", category: "snapshot" },
  { keys: ["Ctrl", "Z"], label: "실행 취소", description: "이전 조건으로 되돌리기", icon: "↶", category: "snapshot" },
  { keys: ["Ctrl", "Y"], label: "다시 실행", description: "Undo 취소 · Redo", icon: "↷", category: "snapshot" },
  { keys: ["Ctrl", "P"], label: "작업장 카드 PDF", description: "A6 1장 · QR 포함", icon: "📋", category: "output" },
  { keys: ["Ctrl", "K"], label: "명령 팔레트", description: "공구·재질·페이지 통합 검색", icon: "🔍", category: "nav" },
  { keys: ["?"], label: "단축키 도움말", description: "이 창 열기", icon: "⌨", category: "help" },
  { keys: ["Esc"], label: "모달 닫기", description: "열린 팝업/모달 닫기", icon: "✕", category: "help" },
]

export const SHORTCUT_CATEGORIES: Record<ShortcutHint["category"], { label: string; color: string }> = {
  snapshot: { label: "스냅샷", color: "emerald" },
  output: { label: "출력·공유", color: "orange" },
  nav: { label: "네비게이션", color: "blue" },
  help: { label: "도움말", color: "slate" },
}
