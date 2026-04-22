// SPDX-License-Identifier: MIT
// YG-1 ARIA Simulator v3 — 즐겨찾기 북마크 패널
// 자주 쓰는 조건(ISO / 서브그룹 / operation / coating / Vc·fz·ap·ae / 지름·날수·형상)을
// ⭐ 북마크로 저장·불러오기·편집·삭제하는 독립 UI.
//
// - cutting-simulator-v2.tsx 는 건드리지 않음
// - 상태는 localStorage("yg1-sim-v3-favorites") 에만 저장
// - 외부 상태/스토어 의존성 없음: currentState + onApply 콜백만 받음
// - 애니메이션/다크모드/검색·태그 필터/JSON import·export 지원
"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"

// ─────────────────────────────────────────────────────────────────────
// 상수
// ─────────────────────────────────────────────────────────────────────

export const FAVORITES_STORAGE_KEY = "yg1-sim-v3-favorites"
const FAVORITES_SCHEMA_VERSION = 1

// ─────────────────────────────────────────────────────────────────────
// 타입 정의
// ─────────────────────────────────────────────────────────────────────

export interface FavoriteEntry {
  id: string
  name: string
  star?: boolean
  note?: string
  createdAt: number
  tags: string[]
  // 조건
  isoGroup: string
  subgroupKey: string
  operation: string
  coating: string
  Vc: number
  fz: number
  ap: number
  ae: number
  diameter: number
  fluteCount: number
  activeShape: string
}

export type FavoriteCondition = Omit<
  FavoriteEntry,
  "id" | "name" | "createdAt" | "tags" | "star" | "note"
>

export interface FavoritesPanelProps {
  currentState: FavoriteCondition
  onApply: (entry: FavoriteEntry) => void
  darkMode?: boolean
}

// ─────────────────────────────────────────────────────────────────────
// Storage helpers
// ─────────────────────────────────────────────────────────────────────

interface StoredBlob {
  version: number
  entries: FavoriteEntry[]
}

function isEntry(x: unknown): x is FavoriteEntry {
  if (!x || typeof x !== "object") return false
  const r = x as Record<string, unknown>
  return (
    typeof r.id === "string" &&
    typeof r.name === "string" &&
    typeof r.createdAt === "number" &&
    Array.isArray(r.tags) &&
    typeof r.isoGroup === "string" &&
    typeof r.subgroupKey === "string" &&
    typeof r.operation === "string" &&
    typeof r.coating === "string" &&
    typeof r.Vc === "number" &&
    typeof r.fz === "number" &&
    typeof r.ap === "number" &&
    typeof r.ae === "number" &&
    typeof r.diameter === "number" &&
    typeof r.fluteCount === "number" &&
    typeof r.activeShape === "string"
  )
}

function loadFavorites(): FavoriteEntry[] {
  if (typeof window === "undefined") return []
  try {
    const raw = window.localStorage.getItem(FAVORITES_STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    // v1: { version, entries }
    if (parsed && typeof parsed === "object" && "entries" in parsed) {
      const blob = parsed as StoredBlob
      if (Array.isArray(blob.entries)) {
        return blob.entries.filter(isEntry)
      }
    }
    // legacy: 배열 직접 저장
    if (Array.isArray(parsed)) {
      return (parsed as unknown[]).filter(isEntry)
    }
    return []
  } catch {
    return []
  }
}

function saveFavorites(entries: FavoriteEntry[]): void {
  if (typeof window === "undefined") return
  try {
    const blob: StoredBlob = { version: FAVORITES_SCHEMA_VERSION, entries }
    window.localStorage.setItem(FAVORITES_STORAGE_KEY, JSON.stringify(blob))
  } catch {
    /* quota exceeded 등은 무시 */
  }
}

function genId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID()
  }
  return `fav-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

function parseTags(raw: string): string[] {
  return raw
    .split(/[,\n]/)
    .map(s => s.trim())
    .filter(s => s.length > 0)
    .slice(0, 12)
}

// ─────────────────────────────────────────────────────────────────────
// 정렬: star 먼저, 그 다음 최신순
// ─────────────────────────────────────────────────────────────────────

function sortEntries(entries: FavoriteEntry[]): FavoriteEntry[] {
  return [...entries].sort((a, b) => {
    const sa = a.star ? 1 : 0
    const sb = b.star ? 1 : 0
    if (sa !== sb) return sb - sa
    return b.createdAt - a.createdAt
  })
}

// ─────────────────────────────────────────────────────────────────────
// 메인 컴포넌트
// ─────────────────────────────────────────────────────────────────────

export default function FavoritesPanel({
  currentState,
  onApply,
  darkMode = false,
}: FavoritesPanelProps) {
  const [entries, setEntries] = useState<FavoriteEntry[]>([])
  const [search, setSearch] = useState("")
  const [tagFilter, setTagFilter] = useState<string | null>(null)
  const [modal, setModal] = useState<
    | { mode: "add" }
    | { mode: "edit"; id: string }
    | null
  >(null)
  const [removing, setRemoving] = useState<Set<string>>(new Set())
  const [newlyAdded, setNewlyAdded] = useState<string | null>(null)
  const [pulseId, setPulseId] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // 최초 로드
  useEffect(() => {
    setEntries(loadFavorites())
  }, [])

  // 변경 시 저장
  useEffect(() => {
    // 초기 빈 배열을 storage에 덮어쓰지 않도록: 최초 mount 시 반영된 상태만 저장
    saveFavorites(entries)
  }, [entries])

  // 정렬된 리스트
  const sorted = useMemo(() => sortEntries(entries), [entries])

  // 전체 태그 목록
  const allTags = useMemo(() => {
    const s = new Set<string>()
    for (const e of entries) for (const t of e.tags) s.add(t)
    return Array.from(s).sort()
  }, [entries])

  // 검색·태그 필터 적용
  const visible = useMemo(() => {
    const q = search.trim().toLowerCase()
    return sorted.filter(e => {
      if (tagFilter && !e.tags.includes(tagFilter)) return false
      if (!q) return true
      if (e.name.toLowerCase().includes(q)) return true
      if (e.note && e.note.toLowerCase().includes(q)) return true
      if (e.tags.some(t => t.toLowerCase().includes(q))) return true
      return false
    })
  }, [sorted, search, tagFilter])

  // ── CRUD ──
  const handleSave = useCallback(
    (input: {
      name: string
      note: string
      tagsRaw: string
      star: boolean
    }) => {
      const tags = parseTags(input.tagsRaw)
      if (modal?.mode === "edit") {
        const id = modal.id
        setEntries(prev =>
          prev.map(e =>
            e.id === id
              ? {
                  ...e,
                  name: input.name.trim() || e.name,
                  note: input.note.trim() || undefined,
                  tags,
                  star: input.star,
                }
              : e,
          ),
        )
      } else {
        const id = genId()
        const newEntry: FavoriteEntry = {
          id,
          name: input.name.trim() || "이름 없음",
          note: input.note.trim() || undefined,
          tags,
          star: input.star,
          createdAt: Date.now(),
          ...currentState,
        }
        setEntries(prev => [newEntry, ...prev])
        setNewlyAdded(id)
        window.setTimeout(() => setNewlyAdded(p => (p === id ? null : p)), 450)
      }
      setModal(null)
    },
    [modal, currentState],
  )

  const handleDelete = useCallback((id: string) => {
    setRemoving(prev => {
      const next = new Set(prev)
      next.add(id)
      return next
    })
    window.setTimeout(() => {
      setEntries(prev => prev.filter(e => e.id !== id))
      setRemoving(prev => {
        const next = new Set(prev)
        next.delete(id)
        return next
      })
    }, 250)
  }, [])

  const handleStarToggle = useCallback((id: string) => {
    setEntries(prev =>
      prev.map(e => (e.id === id ? { ...e, star: !e.star } : e)),
    )
    setPulseId(id)
    window.setTimeout(() => setPulseId(p => (p === id ? null : p)), 400)
  }, [])

  // ── Import/Export ──
  const handleExport = useCallback(() => {
    if (typeof window === "undefined") return
    const blob: StoredBlob = { version: FAVORITES_SCHEMA_VERSION, entries }
    const json = JSON.stringify(blob, null, 2)
    const file = new Blob([json], { type: "application/json" })
    const url = URL.createObjectURL(file)
    const a = document.createElement("a")
    a.href = url
    const ts = new Date().toISOString().slice(0, 10)
    a.download = `yg1-sim-favorites-${ts}.json`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }, [entries])

  const handleImportClick = useCallback(() => {
    fileInputRef.current?.click()
  }, [])

  const handleImportFile = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0]
      e.target.value = ""
      if (!file) return
      const reader = new FileReader()
      reader.onload = () => {
        try {
          const raw = reader.result
          if (typeof raw !== "string") return
          const parsed = JSON.parse(raw) as unknown
          let incoming: FavoriteEntry[] = []
          if (parsed && typeof parsed === "object" && "entries" in parsed) {
            const blob = parsed as StoredBlob
            if (Array.isArray(blob.entries)) {
              incoming = blob.entries.filter(isEntry)
            }
          } else if (Array.isArray(parsed)) {
            incoming = (parsed as unknown[]).filter(isEntry)
          }
          if (incoming.length === 0) {
            window.alert("가져올 북마크가 없습니다.")
            return
          }
          // id 충돌 시 신규 id 부여, 기존과 병합
          setEntries(prev => {
            const existing = new Set(prev.map(x => x.id))
            const merged = [
              ...incoming.map(x =>
                existing.has(x.id) ? { ...x, id: genId() } : x,
              ),
              ...prev,
            ]
            return merged
          })
        } catch {
          window.alert("파일 형식이 올바르지 않습니다.")
        }
      }
      reader.readAsText(file)
    },
    [],
  )

  // ── 스타일 ──
  const cardCls = darkMode
    ? "rounded-xl border border-slate-700 bg-gradient-to-br from-slate-900 to-amber-950/20 p-4 sm:p-5"
    : "rounded-xl border border-slate-200 bg-gradient-to-br from-slate-50 to-amber-50/30 p-4 sm:p-5"
  const headerTextCls = darkMode ? "text-slate-100" : "text-slate-800"
  const subtleCls = darkMode ? "text-slate-400" : "text-slate-500"
  const inputCls = darkMode
    ? "w-full rounded-md border border-slate-700 bg-slate-800 px-2 py-1 text-[12px] text-slate-100 placeholder-slate-500 focus:border-amber-500 focus:outline-none"
    : "w-full rounded-md border border-slate-300 bg-white px-2 py-1 text-[12px] text-slate-800 placeholder-slate-500 focus:border-amber-500 focus:outline-none"
  const btnPrimary = darkMode
    ? "inline-flex items-center gap-1 rounded-md border border-amber-600 bg-amber-700/40 px-2.5 py-1 text-[11px] font-semibold text-amber-100 hover:bg-amber-700/60"
    : "inline-flex items-center gap-1 rounded-md border border-amber-400 bg-amber-100 px-2.5 py-1 text-[11px] font-semibold text-amber-800 hover:bg-amber-200"
  const btnGhost = darkMode
    ? "inline-flex items-center gap-1 rounded-md border border-slate-700 bg-slate-800 px-2 py-1 text-[11px] font-medium text-slate-300 hover:bg-slate-700"
    : "inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] font-medium text-slate-600 hover:bg-slate-100"

  return (
    <section className={cardCls} aria-label="즐겨찾기 북마크">
      <StyleInject />

      {/* ── 헤더 ──────────────────────────────────────────────── */}
      <header className="flex flex-wrap items-center gap-2">
        <span className="text-xl leading-none" aria-hidden>⭐</span>
        <h3 className={`text-base font-semibold ${headerTextCls}`}>
          즐겨찾기 조건
        </h3>
        <span
          className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold tabular-nums ${
            darkMode
              ? "border-amber-700 bg-amber-900/40 text-amber-300"
              : "border-amber-300 bg-amber-100 text-amber-700"
          }`}
        >
          {entries.length}
        </span>

        <div className="ml-auto flex flex-wrap items-center gap-1">
          <button
            type="button"
            onClick={handleImportClick}
            className={btnGhost}
            title="JSON 파일에서 북마크 가져오기"
          >
            ⬆ 가져오기
          </button>
          <button
            type="button"
            onClick={handleExport}
            className={btnGhost}
            title="전체 북마크를 JSON으로 내보내기"
            disabled={entries.length === 0}
          >
            ⬇ 내보내기
          </button>
          <button
            type="button"
            onClick={() => setModal({ mode: "add" })}
            className={btnPrimary}
            title="현재 조건을 북마크로 저장"
          >
            + 추가
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="application/json,.json"
            aria-label="북마크 JSON 파일 가져오기"
            className="hidden"
            onChange={handleImportFile}
          />
        </div>
      </header>

      {/* ── 검색/태그 필터 ───────────────────────────────────── */}
      {entries.length > 0 && (
        <div className="mt-3 flex flex-col gap-2">
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="🔍 이름, 메모, 태그 검색…"
            aria-label="북마크 검색 (이름, 메모, 태그)"
            className={inputCls}
          />
          {allTags.length > 0 && (
            <div className="flex flex-wrap gap-1">
              <button
                type="button"
                onClick={() => setTagFilter(null)}
                className={`rounded-full border px-2 py-0.5 text-[10px] font-medium transition-colors ${
                  tagFilter === null
                    ? darkMode
                      ? "border-amber-500 bg-amber-900/40 text-amber-200"
                      : "border-amber-400 bg-amber-100 text-amber-800"
                    : darkMode
                      ? "border-slate-700 bg-slate-800/60 text-slate-400 hover:bg-slate-700"
                      : "border-slate-200 bg-white text-slate-500 hover:bg-slate-100"
                }`}
              >
                전체
              </button>
              {allTags.map(t => {
                const active = tagFilter === t
                return (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setTagFilter(active ? null : t)}
                    className={`rounded-full border px-2 py-0.5 text-[10px] font-medium transition-colors ${
                      active
                        ? darkMode
                          ? "border-amber-500 bg-amber-900/40 text-amber-200"
                          : "border-amber-400 bg-amber-100 text-amber-800"
                        : darkMode
                          ? "border-slate-700 bg-slate-800/60 text-slate-400 hover:bg-slate-700"
                          : "border-slate-200 bg-white text-slate-500 hover:bg-slate-100"
                    }`}
                  >
                    #{t}
                  </button>
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* ── 리스트 ───────────────────────────────────────────── */}
      <div className="mt-3">
        {entries.length === 0 ? (
          <EmptyState darkMode={darkMode} />
        ) : visible.length === 0 ? (
          <p className={`py-6 text-center text-[12px] ${subtleCls}`}>
            검색 결과가 없습니다.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {visible.map(entry => (
              <FavoriteCard
                key={entry.id}
                entry={entry}
                darkMode={darkMode}
                isRemoving={removing.has(entry.id)}
                isNew={newlyAdded === entry.id}
                isPulsing={pulseId === entry.id}
                onApply={() => onApply(entry)}
                onEdit={() => setModal({ mode: "edit", id: entry.id })}
                onDelete={() => handleDelete(entry.id)}
                onStarToggle={() => handleStarToggle(entry.id)}
              />
            ))}
          </ul>
        )}
      </div>

      {/* ── 추가/편집 모달 ─────────────────────────────────── */}
      {modal && (
        <FavoriteModal
          darkMode={darkMode}
          initial={
            modal.mode === "edit"
              ? entries.find(e => e.id === modal.id)
              : undefined
          }
          currentState={currentState}
          mode={modal.mode}
          onSave={handleSave}
          onCancel={() => setModal(null)}
        />
      )}
    </section>
  )
}

// ─────────────────────────────────────────────────────────────────────
// 개별 카드
// ─────────────────────────────────────────────────────────────────────

function FavoriteCard({
  entry,
  darkMode,
  isRemoving,
  isNew,
  isPulsing,
  onApply,
  onEdit,
  onDelete,
  onStarToggle,
}: {
  entry: FavoriteEntry
  darkMode: boolean
  isRemoving: boolean
  isNew: boolean
  isPulsing: boolean
  onApply: () => void
  onEdit: () => void
  onDelete: () => void
  onStarToggle: () => void
}) {
  const baseCls = darkMode
    ? "border-slate-700 bg-slate-800/60 hover:ring-amber-500/60 hover:bg-slate-800"
    : "border-slate-200 bg-white hover:ring-amber-400/60 hover:bg-amber-50/40"
  const starredBorder = entry.star
    ? darkMode
      ? "ring-1 ring-amber-600/60"
      : "ring-1 ring-amber-400/70"
    : ""

  const anim = isRemoving
    ? "yg1-fav-fade-out"
    : isNew
      ? "yg1-fav-slide-in"
      : ""

  return (
    <li
      className={`relative flex flex-col gap-1.5 rounded-lg border p-2.5 transition-all hover:ring-2 ${baseCls} ${starredBorder} ${anim}`}
    >
      {/* 1행: star · 이름 · 액션 */}
      <div className="flex items-start gap-2">
        <button
          type="button"
          onClick={onStarToggle}
          aria-pressed={!!entry.star}
          aria-label={entry.star ? "최고 즐겨찾기 해제" : "최고 즐겨찾기로 지정"}
          className={`mt-[1px] shrink-0 text-base leading-none transition-transform ${
            entry.star
              ? darkMode
                ? "text-amber-400"
                : "text-amber-500"
              : darkMode
                ? "text-slate-600 hover:text-amber-400"
                : "text-slate-300 hover:text-amber-500"
          } ${isPulsing ? "yg1-fav-pulse" : ""}`}
        >
          {entry.star ? "★" : "☆"}
        </button>

        <div className="min-w-0 flex-1">
          <div
            className={`truncate font-semibold text-[12.5px] ${
              darkMode ? "text-slate-100" : "text-slate-800"
            }`}
          >
            {entry.name}
          </div>
          <ConditionSummary entry={entry} darkMode={darkMode} />
        </div>

        <div className="flex shrink-0 flex-wrap items-center justify-end gap-1">
          <button
            type="button"
            onClick={onApply}
            className={
              darkMode
                ? "rounded-md border border-emerald-700 bg-emerald-900/40 px-2 py-0.5 text-[10.5px] font-semibold text-emerald-200 hover:bg-emerald-800/60"
                : "rounded-md border border-emerald-400 bg-emerald-50 px-2 py-0.5 text-[10.5px] font-semibold text-emerald-700 hover:bg-emerald-100"
            }
            title="이 조건을 현재 시뮬레이터에 적용"
          >
            ✓ 적용
          </button>
          <button
            type="button"
            onClick={onEdit}
            className={
              darkMode
                ? "rounded-md border border-slate-700 bg-slate-800 px-2 py-0.5 text-[10.5px] font-medium text-slate-300 hover:bg-slate-700"
                : "rounded-md border border-slate-200 bg-white px-2 py-0.5 text-[10.5px] font-medium text-slate-600 hover:bg-slate-100"
            }
            title="이름·메모·태그 편집"
            aria-label={`${entry.name} 편집`}
          >
            <span aria-hidden>✏</span>
          </button>
          <button
            type="button"
            onClick={onDelete}
            className={
              darkMode
                ? "rounded-md border border-rose-800 bg-rose-900/30 px-2 py-0.5 text-[10.5px] font-medium text-rose-300 hover:bg-rose-900/60"
                : "rounded-md border border-rose-300 bg-rose-50 px-2 py-0.5 text-[10.5px] font-medium text-rose-700 hover:bg-rose-100"
            }
            title="북마크 삭제"
            aria-label={`${entry.name} 삭제`}
          >
            <span aria-hidden>🗑</span>
          </button>
        </div>
      </div>

      {/* 2행: tags */}
      {entry.tags.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {entry.tags.map(t => (
            <span
              key={t}
              className={`rounded-full border px-1.5 py-0.5 text-[10px] ${
                darkMode
                  ? "border-slate-700 bg-slate-900/60 text-slate-300"
                  : "border-slate-200 bg-slate-50 text-slate-600"
              }`}
            >
              #{t}
            </span>
          ))}
        </div>
      )}

      {/* 3행: note */}
      {entry.note && (
        <p
          className={`text-xs leading-snug break-words ${
            darkMode ? "text-slate-400" : "text-slate-500"
          }`}
        >
          {entry.note}
        </p>
      )}
    </li>
  )
}

// ─────────────────────────────────────────────────────────────────────
// 조건 요약 한 줄 (Vc/fz/ap/ae + iso/op)
// ─────────────────────────────────────────────────────────────────────

function ConditionSummary({
  entry,
  darkMode,
}: {
  entry: FavoriteEntry
  darkMode: boolean
}) {
  const chipCls = darkMode
    ? "rounded bg-slate-900/60 px-1.5 py-0.5 font-mono text-[10px] text-slate-300"
    : "rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[10px] text-slate-600"
  const metaCls = darkMode ? "text-slate-400" : "text-slate-500"

  return (
    <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[10.5px] min-w-0">
      <span className={`${metaCls} truncate max-w-full`}>
        {entry.isoGroup || "?"}
        {entry.operation ? ` · ${entry.operation}` : ""}
        {entry.coating ? ` · ${entry.coating}` : ""}
      </span>
      <span className={`${chipCls} whitespace-nowrap`}>Vc {entry.Vc.toFixed(0)}</span>
      <span className={`${chipCls} whitespace-nowrap`}>fz {entry.fz.toFixed(3)}</span>
      <span className={`${chipCls} whitespace-nowrap`}>ap {entry.ap.toFixed(2)}</span>
      <span className={`${chipCls} whitespace-nowrap`}>ae {entry.ae.toFixed(2)}</span>
      <span className={`${chipCls} whitespace-nowrap`}>
        ⌀{entry.diameter.toFixed(1)}/{entry.fluteCount}F
      </span>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────
// 빈 상태
// ─────────────────────────────────────────────────────────────────────

function EmptyState({ darkMode }: { darkMode: boolean }) {
  return (
    <div
      className={`flex flex-col items-center gap-2 rounded-lg border-2 border-dashed py-8 text-center ${
        darkMode
          ? "border-slate-700 text-slate-400"
          : "border-slate-300 text-slate-500"
      }`}
    >
      <span className="text-2xl" aria-hidden>⭐</span>
      <p className="text-[12px] font-medium">자주 쓰는 조건을 북마크하세요</p>
      <p className="text-[11px] opacity-80">
        현재 시뮬레이터 설정을 저장하고 한 번 클릭으로 불러올 수 있어요.
      </p>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────
// 추가/편집 모달
// ─────────────────────────────────────────────────────────────────────

function FavoriteModal({
  darkMode,
  initial,
  currentState,
  mode,
  onSave,
  onCancel,
}: {
  darkMode: boolean
  initial?: FavoriteEntry
  currentState: FavoriteCondition
  mode: "add" | "edit"
  onSave: (input: {
    name: string
    note: string
    tagsRaw: string
    star: boolean
  }) => void
  onCancel: () => void
}) {
  const [name, setName] = useState(initial?.name ?? "")
  const [note, setNote] = useState(initial?.note ?? "")
  const [tagsRaw, setTagsRaw] = useState(initial?.tags.join(", ") ?? "")
  const [star, setStar] = useState(!!initial?.star)

  // ESC 닫기
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [onCancel])

  const panelCls = darkMode
    ? "bg-slate-900 border-slate-700 text-slate-100"
    : "bg-white border-slate-200 text-slate-800"
  const labelCls = darkMode
    ? "text-[11px] font-semibold text-slate-300"
    : "text-[11px] font-semibold text-slate-600"
  const inputCls = darkMode
    ? "w-full rounded-md border border-slate-700 bg-slate-800 px-2 py-1.5 text-[12px] text-slate-100 placeholder-slate-500 focus:border-amber-500 focus:outline-none"
    : "w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-[12px] text-slate-800 placeholder-slate-500 focus:border-amber-500 focus:outline-none"
  const metaCls = darkMode ? "text-slate-400" : "text-slate-500"

  const preview = initial ?? { ...currentState }

  const canSave = name.trim().length > 0

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="yg1-fav-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onCancel}
    >
      <div
        className={`w-full max-w-md rounded-xl border p-4 shadow-2xl ${panelCls} yg1-fav-slide-in`}
        onClick={e => e.stopPropagation()}
      >
        <h4
          id="yg1-fav-modal-title"
          className="mb-3 flex items-center gap-2 text-sm font-semibold"
        >
          <span aria-hidden>{mode === "edit" ? "✏" : "⭐"}</span>
          {mode === "edit" ? "북마크 편집" : "현재 조건을 북마크로 저장"}
        </h4>

        <div className="flex flex-col gap-3">
          <label className="flex flex-col gap-1">
            <span className={labelCls}>이름 *</span>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="예: SUS304 마감 프리셋"
              className={inputCls}
              autoFocus
              maxLength={60}
            />
          </label>

          <label className="flex flex-col gap-1">
            <span className={labelCls}>메모 (선택)</span>
            <textarea
              value={note}
              onChange={e => setNote(e.target.value)}
              placeholder="현장 메모, 주의사항, 출처 등"
              rows={3}
              maxLength={400}
              className={inputCls + " resize-y"}
            />
          </label>

          <label className="flex flex-col gap-1">
            <span className={labelCls}>태그 (쉼표 구분, 최대 12개)</span>
            <input
              type="text"
              value={tagsRaw}
              onChange={e => setTagsRaw(e.target.value)}
              placeholder="SUS304, 마감, 프리미엄"
              className={inputCls}
            />
          </label>

          <label className="flex cursor-pointer items-center gap-2">
            <input
              type="checkbox"
              checked={star}
              onChange={e => setStar(e.target.checked)}
              className="h-4 w-4 accent-amber-500"
            />
            <span className={labelCls}>
              <span aria-hidden>⭐</span> 최고 즐겨찾기로 (상단 고정)
            </span>
          </label>

          {/* 조건 프리뷰 */}
          <div
            className={`rounded-md border p-2 text-[11px] ${
              darkMode
                ? "border-slate-700 bg-slate-800/60"
                : "border-slate-200 bg-slate-50"
            }`}
          >
            <div className={`mb-1 font-semibold ${metaCls}`}>
              저장할 조건 프리뷰
            </div>
            <div className={`grid grid-cols-2 gap-x-3 gap-y-0.5 font-mono ${metaCls}`}>
              <span>ISO: {preview.isoGroup || "-"}</span>
              <span>op: {preview.operation || "-"}</span>
              <span>코팅: {preview.coating || "-"}</span>
              <span>서브: {preview.subgroupKey || "-"}</span>
              <span>Vc: {preview.Vc.toFixed(1)}</span>
              <span>fz: {preview.fz.toFixed(3)}</span>
              <span>ap: {preview.ap.toFixed(2)}</span>
              <span>ae: {preview.ae.toFixed(2)}</span>
              <span>⌀: {preview.diameter.toFixed(1)} mm</span>
              <span>날수: {preview.fluteCount}F</span>
              <span className="col-span-2">형상: {preview.activeShape || "-"}</span>
            </div>
          </div>
        </div>

        <div className="mt-4 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className={
              darkMode
                ? "rounded-md border border-slate-700 bg-slate-800 px-3 py-1 text-[12px] font-medium text-slate-300 hover:bg-slate-700"
                : "rounded-md border border-slate-200 bg-white px-3 py-1 text-[12px] font-medium text-slate-600 hover:bg-slate-100"
            }
          >
            취소
          </button>
          <button
            type="button"
            onClick={() => onSave({ name, note, tagsRaw, star })}
            disabled={!canSave}
            className={
              darkMode
                ? "rounded-md border border-amber-600 bg-amber-700/60 px-3 py-1 text-[12px] font-semibold text-amber-100 hover:bg-amber-700 disabled:cursor-not-allowed disabled:opacity-50"
                : "rounded-md border border-amber-500 bg-amber-500 px-3 py-1 text-[12px] font-semibold text-white hover:bg-amber-600 disabled:cursor-not-allowed disabled:opacity-50"
            }
          >
            저장
          </button>
        </div>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────
// 애니메이션 스타일 주입 (모듈 단위 1회)
// ─────────────────────────────────────────────────────────────────────

let STYLE_INJECTED = false

function StyleInject() {
  useEffect(() => {
    if (STYLE_INJECTED) return
    if (typeof document === "undefined") return
    const css = `
@keyframes yg1-fav-slide-in {
  0% { opacity: 0; transform: translateY(-6px) scale(0.98); }
  100% { opacity: 1; transform: translateY(0) scale(1); }
}
@keyframes yg1-fav-fade-out {
  0% { opacity: 1; transform: translateX(0); }
  100% { opacity: 0; transform: translateX(8px); }
}
@keyframes yg1-fav-pulse {
  0% { transform: scale(1); }
  50% { transform: scale(1.35); }
  100% { transform: scale(1); }
}
.yg1-fav-slide-in { animation: yg1-fav-slide-in 220ms ease-out; }
.yg1-fav-fade-out { animation: yg1-fav-fade-out 240ms ease-in forwards; pointer-events: none; }
.yg1-fav-pulse { animation: yg1-fav-pulse 380ms ease-out; }
@media (prefers-reduced-motion: reduce) {
  .yg1-fav-slide-in, .yg1-fav-fade-out, .yg1-fav-pulse { animation: none !important; }
}
`
    const el = document.createElement("style")
    el.setAttribute("data-yg1-favorites", "v1")
    el.appendChild(document.createTextNode(css))
    document.head.appendChild(el)
    STYLE_INJECTED = true
  }, [])
  return null
}
