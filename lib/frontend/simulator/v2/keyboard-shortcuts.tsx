// SPDX-License-Identifier: MIT
// YG-1 ARIA Simulator v2 — Keyboard Shortcuts + Help Overlay
//
// <KeyboardShortcuts>
//   • 헤드리스 컴포넌트. window keydown 리스너를 달고 bindings 배열을 순회하며
//     event.key (대소문자 무시) + modifier(ctrl/shift/alt) 매칭 시 handler() 실행.
//   • document.activeElement 가 INPUT/TEXTAREA/SELECT/contentEditable 면 skip
//     — 사용자가 값을 타이핑하는 동안 단축키가 가로채지 않도록 한다.
//   • 매칭되면 event.preventDefault() 로 브라우저 기본 동작(예: Space 스크롤) 차단.
//
// <ShortcutHelpOverlay>
//   • 모달. bindings(key + description) 테이블 렌더.
//   • Escape + 백드롭 클릭으로 닫기. 내부 카드 클릭은 stopPropagation.
//   • 모바일 대응: max-h-[calc(100vh-2rem)] + overflow-y-auto.

"use client"

import * as React from "react"

// ─── Types ────────────────────────────────────────────────────────
export interface ShortcutBinding {
  key: string
  description: string
  handler: () => void
  modifiers?: {
    ctrl?: boolean
    shift?: boolean
    alt?: boolean
  }
}

export interface KeyboardShortcutsProps {
  bindings: ShortcutBinding[]
  enabled?: boolean
}

// ─── Helpers ──────────────────────────────────────────────────────
function isEditableTarget(el: Element | null): boolean {
  if (!el || !(el instanceof HTMLElement)) return false
  const tag = el.tagName
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true
  if (el.isContentEditable) return true
  return false
}

function keysMatch(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase()
}

function modifiersMatch(event: KeyboardEvent, mods: ShortcutBinding["modifiers"]): boolean {
  const want = mods ?? {}
  // Treat metaKey as equivalent to ctrl (macOS ⌘).
  const haveCtrl = event.ctrlKey || event.metaKey
  const haveShift = event.shiftKey
  const haveAlt = event.altKey
  const wantCtrl = !!want.ctrl
  const wantShift = !!want.shift
  const wantAlt = !!want.alt
  return haveCtrl === wantCtrl && haveShift === wantShift && haveAlt === wantAlt
}

// ─── KeyboardShortcuts ────────────────────────────────────────────
export function KeyboardShortcuts({ bindings, enabled = true }: KeyboardShortcutsProps): null {
  // Keep a ref so the handler identity is stable while picking up latest bindings.
  const bindingsRef = React.useRef<ShortcutBinding[]>(bindings)
  React.useEffect(() => {
    bindingsRef.current = bindings
  }, [bindings])

  React.useEffect(() => {
    if (!enabled) return
    if (typeof window === "undefined") return

    const onKeyDown = (event: KeyboardEvent) => {
      // Skip during IME composition.
      if (event.isComposing || event.keyCode === 229) return

      // Don't hijack typing inside text fields / contenteditable.
      if (isEditableTarget(document.activeElement)) return

      const list = bindingsRef.current
      for (const b of list) {
        if (!keysMatch(event.key, b.key)) continue
        if (!modifiersMatch(event, b.modifiers)) continue
        event.preventDefault()
        try {
          b.handler()
        } catch (err) {
          // Handlers are user code — surface errors in dev but don't break the loop.
          if (typeof console !== "undefined") console.error("[KeyboardShortcuts] handler error:", err)
        }
        return
      }
    }

    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [enabled])

  return null
}

// ─── ShortcutHelpOverlay ──────────────────────────────────────────
export interface ShortcutHelpOverlayProps {
  bindings: Array<{ key: string; description: string }>
  open: boolean
  onClose: () => void
}

function prettyKey(raw: string): string {
  if (raw === " ") return "Space"
  if (raw.length === 1) return raw.toUpperCase()
  return raw
}

export function ShortcutHelpOverlay({ bindings, open, onClose }: ShortcutHelpOverlayProps): React.ReactElement | null {
  React.useEffect(() => {
    if (!open) return
    if (typeof window === "undefined") return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault()
        onClose()
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [open, onClose])

  if (!open) return null

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Keyboard shortcuts"
      className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/60 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-md rounded-2xl bg-white shadow-2xl ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-700 dark:text-slate-100 max-h-[calc(100vh-2rem)] flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-700 px-5 py-3">
          <div className="flex items-center gap-2">
            <span className="text-xl" aria-hidden="true">⌨️</span>
            <h4 className="text-sm font-bold tracking-tight">Keyboard Shortcuts</h4>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-md px-2 py-1 text-xs text-slate-500 hover:bg-slate-100 hover:text-slate-900 dark:hover:bg-slate-800 dark:hover:text-slate-100"
          >
            ✕
          </button>
        </div>

        <div className="overflow-y-auto p-4">
          {bindings.length === 0 ? (
            <div className="py-6 text-center text-xs text-slate-500">등록된 단축키가 없습니다.</div>
          ) : (
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="text-[10px] uppercase tracking-wider text-slate-500">
                  <th className="w-[34%] pb-2 font-semibold">Key</th>
                  <th className="pb-2 font-semibold">Description</th>
                </tr>
              </thead>
              <tbody>
                {bindings.map((b, i) => (
                  <tr key={`${b.key}-${i}`} className="border-t border-slate-100 dark:border-slate-800">
                    <td className="py-2 pr-3">
                      <kbd className="inline-block rounded-md border border-slate-300 bg-slate-50 px-2 py-0.5 font-mono text-[11px] font-semibold text-slate-700 shadow-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200">
                        {prettyKey(b.key)}
                      </kbd>
                    </td>
                    <td className="py-2 text-slate-700 dark:text-slate-200">{b.description}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="border-t border-slate-200 dark:border-slate-700 px-4 py-2 text-[10px] text-slate-500">
          <span className="font-mono">Esc</span> 또는 배경 클릭으로 닫기
        </div>
      </div>
    </div>
  )
}

export default KeyboardShortcuts
