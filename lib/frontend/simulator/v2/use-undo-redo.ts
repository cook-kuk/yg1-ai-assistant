"use client"

import { useCallback, useEffect, useRef, useState } from "react"

/**
 * 시뮬레이터 핵심 파라미터 스냅샷.
 * push/undo/redo 모두 이 구조를 단위로 기록한다.
 */
export interface HistoryState {
  Vc: number
  fz: number
  ap: number
  ae: number
  diameter: number
  fluteCount: number
  activeShape: string
  isoGroup: string
  subgroupKey: string
  operation: string
  coating: string
}

export interface UseUndoRedoResult {
  /** 새 상태를 히스토리에 추가 (300ms 디바운스, 동일 상태 중복 방지) */
  push: (state: HistoryState) => void
  /** 이전 상태로 이동 (없으면 null) */
  undo: () => HistoryState | null
  /** 다음 상태로 이동 (없으면 null) */
  redo: () => HistoryState | null
  canUndo: boolean
  canRedo: boolean
  historyCount: number
  /** 히스토리 전체 초기화 */
  clear: () => void
}

/**
 * HistoryState 동치 비교.
 * 모든 핵심 필드가 완전히 같으면 true.
 */
export function isSameState(a: HistoryState, b: HistoryState): boolean {
  return (
    a.Vc === b.Vc &&
    a.fz === b.fz &&
    a.ap === b.ap &&
    a.ae === b.ae &&
    a.diameter === b.diameter &&
    a.fluteCount === b.fluteCount &&
    a.activeShape === b.activeShape &&
    a.isoGroup === b.isoGroup &&
    a.subgroupKey === b.subgroupKey &&
    a.operation === b.operation &&
    a.coating === b.coating
  )
}

const DEFAULT_MAX_HISTORY = 50
const DEBOUNCE_MS = 300

interface HistoryInternal {
  stack: HistoryState[]
  index: number
}

/**
 * 시뮬레이터 Undo/Redo 히스토리 커스텀 훅.
 *
 * - 같은 필드를 연속으로 드래그/타이핑하는 경우가 많아 300ms 디바운스 적용.
 * - 직전 상태와 동일하면 push를 건너뛴다.
 * - maxHistory 개 초과 시 가장 오래된 항목부터 밀려난다 (기본 50).
 * - stack과 index를 한 state 오브젝트로 묶어 atomic 업데이트 보장.
 *
 * @example
 * ```tsx
 * const history = useUndoRedo()
 *
 * // 파라미터 변경 시마다 push
 * useEffect(() => {
 *   history.push({ Vc, fz, ap, ae, diameter, fluteCount,
 *     activeShape, isoGroup, subgroupKey, operation, coating })
 * }, [Vc, fz, ap, ae, diameter, fluteCount,
 *     activeShape, isoGroup, subgroupKey, operation, coating])
 *
 * // Ctrl+Z / Ctrl+Y 바인딩
 * useEffect(() => {
 *   const onKey = (e: KeyboardEvent) => {
 *     const mod = e.ctrlKey || e.metaKey
 *     if (mod && e.key === "z" && !e.shiftKey) {
 *       const prev = history.undo()
 *       if (prev) applyState(prev)
 *     } else if (mod && (e.key === "y" || (e.shiftKey && e.key === "Z"))) {
 *       const next = history.redo()
 *       if (next) applyState(next)
 *     }
 *   }
 *   window.addEventListener("keydown", onKey)
 *   return () => window.removeEventListener("keydown", onKey)
 * }, [history])
 * ```
 */
export function useUndoRedo(maxHistory: number = DEFAULT_MAX_HISTORY): UseUndoRedoResult {
  const [state, setState] = useState<HistoryInternal>({ stack: [], index: -1 })

  // undo/redo는 최신 state를 동기적으로 읽어 반환해야 하므로 ref로 미러링.
  const stateRef = useRef<HistoryInternal>(state)
  useEffect(() => {
    stateRef.current = state
  }, [state])

  const pendingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pendingStateRef = useRef<HistoryState | null>(null)

  // 언마운트 시 대기 중인 push 정리
  useEffect(() => {
    return () => {
      if (pendingTimerRef.current) {
        clearTimeout(pendingTimerRef.current)
        pendingTimerRef.current = null
      }
    }
  }, [])

  const commitPush = useCallback(
    (next: HistoryState) => {
      setState((prev) => {
        // 현재 인덱스 이후 (redo 가능했던 분기) 는 제거
        const truncated = prev.stack.slice(0, prev.index + 1)
        const last = truncated[truncated.length - 1]
        // 직전 상태와 동일하면 push 생략
        if (last && isSameState(last, next)) return prev
        const appended = [...truncated, next]
        // maxHistory 초과 시 앞에서 잘라냄
        const overflow = appended.length - maxHistory
        const trimmed = overflow > 0 ? appended.slice(overflow) : appended
        return { stack: trimmed, index: trimmed.length - 1 }
      })
    },
    [maxHistory]
  )

  const push = useCallback(
    (next: HistoryState) => {
      pendingStateRef.current = next
      if (pendingTimerRef.current) {
        clearTimeout(pendingTimerRef.current)
      }
      pendingTimerRef.current = setTimeout(() => {
        const latest = pendingStateRef.current
        pendingTimerRef.current = null
        pendingStateRef.current = null
        if (latest) commitPush(latest)
      }, DEBOUNCE_MS)
    },
    [commitPush]
  )

  const undo = useCallback((): HistoryState | null => {
    const cur = stateRef.current
    if (cur.index <= 0) return null
    const nextIdx = cur.index - 1
    const target = cur.stack[nextIdx] ?? null
    setState({ stack: cur.stack, index: nextIdx })
    return target
  }, [])

  const redo = useCallback((): HistoryState | null => {
    const cur = stateRef.current
    if (cur.index >= cur.stack.length - 1) return null
    const nextIdx = cur.index + 1
    const target = cur.stack[nextIdx] ?? null
    setState({ stack: cur.stack, index: nextIdx })
    return target
  }, [])

  const clear = useCallback(() => {
    if (pendingTimerRef.current) {
      clearTimeout(pendingTimerRef.current)
      pendingTimerRef.current = null
    }
    pendingStateRef.current = null
    setState({ stack: [], index: -1 })
  }, [])

  return {
    push,
    undo,
    redo,
    canUndo: state.index > 0,
    canRedo: state.index < state.stack.length - 1,
    historyCount: state.stack.length,
    clear,
  }
}
