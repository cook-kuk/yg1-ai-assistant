// SPDX-License-Identifier: MIT
// YG-1 ARIA Simulator v3 — 벤치마크 리더보드
// localStorage 기반 (DB 없이 작동).
// 같은 재질(isoGroup)·가공(operation) 조건에서의 "최고 기록" TOP 10
// 3 카테고리: MRR 최고 / 공구 수명 최고 / 개당 원가 최저
"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { motion, AnimatePresence } from "framer-motion"
import {
  Trophy,
  Zap,
  Shield,
  Coins,
  Upload,
  Download,
  PlusCircle,
  X,
  Check,
  Info,
  Filter,
  Sparkles,
} from "lucide-react"

// ─── Constants (로컬 SSOT) ─────────────────────────────────────────
const STORAGE_KEY = "yg1-sim-v3-benchmark"
const MAX_ENTRIES = 50
const TOP_N = 10
// 현재 조건이 이 값 이내로 근접하면 "동일 조건"으로 간주 (hit detection)
const EPS_Vc = 0.5
const EPS_f = 0.001
const EPS_apAe = 0.01

// ─── Types ─────────────────────────────────────────────────────────
type Category = "mrr" | "life" | "cost"

interface CategoryMeta {
  key: Category
  label: string
  shortLabel: string
  Icon: typeof Trophy
  tone: "amber" | "emerald" | "rose"
  unit: string
  /** true = 큰 값이 좋음 (desc), false = 작은 값이 좋음 (asc) */
  higherIsBetter: boolean
  /** entry에서 정렬 기준값 뽑기 — 없으면 null */
  pick: (e: LeaderboardEntry) => number | null
  /** UI에 표시할 포맷 */
  format: (n: number) => string
}

const CATEGORIES: CategoryMeta[] = [
  {
    key: "mrr",
    label: "⚡ MRR 최고 (많이 깎기)",
    shortLabel: "MRR",
    Icon: Zap,
    tone: "amber",
    unit: "cm³/min",
    higherIsBetter: true,
    pick: (e) => (Number.isFinite(e.MRR) ? e.MRR : null),
    format: (n) => n.toFixed(2),
  },
  {
    key: "life",
    label: "🛡 공구 수명 최고 (오래 쓰기)",
    shortLabel: "수명",
    Icon: Shield,
    tone: "emerald",
    unit: "min",
    higherIsBetter: true,
    pick: (e) => (Number.isFinite(e.toolLifeMin) ? e.toolLifeMin : null),
    format: (n) => n.toFixed(0),
  },
  {
    key: "cost",
    label: "💰 원가 최저 (싸게)",
    shortLabel: "원가",
    Icon: Coins,
    tone: "rose",
    unit: "원/개",
    higherIsBetter: false,
    pick: (e) =>
      typeof e.costPerPart === "number" && Number.isFinite(e.costPerPart)
        ? e.costPerPart
        : null,
    format: (n) => n.toLocaleString("ko-KR", { maximumFractionDigits: 0 }),
  },
]

// ─── Props / Public types ─────────────────────────────────────────
export interface LeaderboardEntry {
  id: string
  timestamp: number
  nickname?: string
  isoGroup: string
  operation: string
  Vc: number
  fz: number
  ap: number
  ae: number
  diameter: number
  fluteCount: number
  MRR: number
  toolLifeMin: number
  costPerPart?: number
  Pc?: number
  Ra?: number
}

export interface BenchmarkLeaderboardProps {
  currentState: {
    isoGroup: string
    operation: string
    Vc: number
    fz: number
    ap: number
    ae: number
    diameter: number
    fluteCount: number
    MRR: number
    toolLifeMin: number
    costPerPart?: number
    Pc?: number
    Ra?: number
  }
  onLoadEntry?: (entry: LeaderboardEntry) => void
  darkMode?: boolean
}

// ─── Tone token map (다크모드 호환) ────────────────────────────────
interface ToneTokens {
  text: string
  bg: string
  border: string
  ringFocus: string
}
const TONE_MAP: Record<CategoryMeta["tone"], { light: ToneTokens; dark: ToneTokens }> = {
  amber: {
    light: {
      text: "text-amber-700",
      bg: "bg-amber-50",
      border: "border-amber-200",
      ringFocus: "focus-visible:ring-amber-400",
    },
    dark: {
      text: "text-amber-300",
      bg: "bg-amber-950/40",
      border: "border-amber-800",
      ringFocus: "focus-visible:ring-amber-500",
    },
  },
  emerald: {
    light: {
      text: "text-emerald-700",
      bg: "bg-emerald-50",
      border: "border-emerald-200",
      ringFocus: "focus-visible:ring-emerald-400",
    },
    dark: {
      text: "text-emerald-300",
      bg: "bg-emerald-950/40",
      border: "border-emerald-800",
      ringFocus: "focus-visible:ring-emerald-500",
    },
  },
  rose: {
    light: {
      text: "text-rose-700",
      bg: "bg-rose-50",
      border: "border-rose-200",
      ringFocus: "focus-visible:ring-rose-400",
    },
    dark: {
      text: "text-rose-300",
      bg: "bg-rose-950/40",
      border: "border-rose-800",
      ringFocus: "focus-visible:ring-rose-500",
    },
  },
}

// ─── Helpers ───────────────────────────────────────────────────────
function tone(meta: CategoryMeta, dark: boolean): ToneTokens {
  return dark ? TONE_MAP[meta.tone].dark : TONE_MAP[meta.tone].light
}

function genId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    try {
      return crypto.randomUUID()
    } catch {
      /* fall through */
    }
  }
  return `e_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`
}

function rankBadge(rank: number): { icon: string; fallback: string } {
  if (rank === 1) return { icon: "🥇", fallback: "1" }
  if (rank === 2) return { icon: "🥈", fallback: "2" }
  if (rank === 3) return { icon: "🥉", fallback: "3" }
  return { icon: "", fallback: String(rank) }
}

function formatDate(ts: number): string {
  try {
    const d = new Date(ts)
    const mm = String(d.getMonth() + 1).padStart(2, "0")
    const dd = String(d.getDate()).padStart(2, "0")
    const hh = String(d.getHours()).padStart(2, "0")
    const min = String(d.getMinutes()).padStart(2, "0")
    return `${d.getFullYear()}-${mm}-${dd} ${hh}:${min}`
  } catch {
    return "-"
  }
}

function fmtNum(n: number, digits = 2): string {
  if (!Number.isFinite(n)) return "-"
  return n.toFixed(digits)
}

function sameCondition(a: LeaderboardEntry, curr: BenchmarkLeaderboardProps["currentState"]): boolean {
  return (
    a.isoGroup === curr.isoGroup &&
    a.operation === curr.operation &&
    Math.abs(a.Vc - curr.Vc) <= EPS_Vc &&
    Math.abs(a.fz - curr.fz) <= EPS_f &&
    Math.abs(a.ap - curr.ap) <= EPS_apAe &&
    Math.abs(a.ae - curr.ae) <= EPS_apAe &&
    Math.abs(a.diameter - curr.diameter) <= EPS_apAe &&
    a.fluteCount === curr.fluteCount
  )
}

function sameGroup(a: LeaderboardEntry, curr: BenchmarkLeaderboardProps["currentState"]): boolean {
  return a.isoGroup === curr.isoGroup && a.operation === curr.operation
}

// ─── Storage layer ─────────────────────────────────────────────────
function loadEntries(): LeaderboardEntry[] {
  if (typeof window === "undefined") return []
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter((x): x is LeaderboardEntry => {
      if (!x || typeof x !== "object") return false
      const e = x as Partial<LeaderboardEntry>
      return (
        typeof e.id === "string" &&
        typeof e.timestamp === "number" &&
        typeof e.isoGroup === "string" &&
        typeof e.operation === "string" &&
        typeof e.Vc === "number" &&
        typeof e.fz === "number" &&
        typeof e.ap === "number" &&
        typeof e.ae === "number" &&
        typeof e.diameter === "number" &&
        typeof e.fluteCount === "number" &&
        typeof e.MRR === "number" &&
        typeof e.toolLifeMin === "number"
      )
    })
  } catch {
    return []
  }
}

function saveEntries(entries: LeaderboardEntry[]): void {
  if (typeof window === "undefined") return
  try {
    const trimmed = entries.slice(0, MAX_ENTRIES)
    localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed))
  } catch {
    /* quota exceeded — fail silently */
  }
}

// ─── Nickname Modal ────────────────────────────────────────────────
interface NicknameModalProps {
  open: boolean
  onClose: () => void
  onConfirm: (nickname: string) => void
  darkMode: boolean
}

function NicknameModal({ open, onClose, onConfirm, darkMode }: NicknameModalProps) {
  const [value, setValue] = useState("")
  const inputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    if (open) {
      setValue("")
      requestAnimationFrame(() => inputRef.current?.focus())
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose()
    }
    window.addEventListener("keydown", handler)
    return () => window.removeEventListener("keydown", handler)
  }, [open, onClose])

  const submit = () => {
    onConfirm(value.trim() || "익명")
  }

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
        >
          <motion.div
            className={`w-full max-w-sm rounded-xl border shadow-2xl ${
              darkMode ? "bg-slate-900 border-slate-700" : "bg-white border-slate-200"
            }`}
            role="dialog"
            aria-modal="true"
            aria-labelledby="yg1-bench-nick-title"
            initial={{ opacity: 0, scale: 0.95, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 8 }}
            onClick={(e) => e.stopPropagation()}
          >
            <div
              className={`flex items-center justify-between px-4 py-3 border-b ${
                darkMode ? "border-slate-700" : "border-slate-200"
              }`}
            >
              <h3
                id="yg1-bench-nick-title"
                className={`text-sm font-semibold ${darkMode ? "text-slate-100" : "text-slate-900"}`}
              >
                이 조건 등록
              </h3>
              <button
                type="button"
                onClick={onClose}
                className={`p-1 rounded hover:bg-opacity-20 ${
                  darkMode ? "text-slate-400 hover:bg-slate-700" : "text-slate-500 hover:bg-slate-100"
                }`}
                aria-label="닫기"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="px-4 py-4 space-y-3">
              <label
                htmlFor="yg1-bench-nick-input"
                className={`block text-xs font-medium ${
                  darkMode ? "text-slate-300" : "text-slate-700"
                }`}
              >
                닉네임 (선택)
              </label>
              <input
                id="yg1-bench-nick-input"
                ref={inputRef}
                type="text"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") submit()
                }}
                maxLength={20}
                placeholder="빈 값이면 '익명'"
                className={`w-full px-3 py-2 rounded-md border text-sm outline-none focus-visible:ring-2 focus-visible:ring-violet-400 ${
                  darkMode
                    ? "bg-slate-800 border-slate-600 text-slate-100 placeholder-slate-500"
                    : "bg-white border-slate-300 text-slate-900 placeholder-slate-500"
                }`}
              />
              <p className={`text-xs ${darkMode ? "text-slate-400" : "text-slate-500"}`}>
                현재 조건이 리더보드에 추가됩니다.
              </p>
            </div>
            <div
              className={`flex gap-2 px-4 py-3 border-t ${
                darkMode ? "border-slate-700" : "border-slate-200"
              }`}
            >
              <button
                type="button"
                onClick={onClose}
                className={`flex-1 px-3 py-2 rounded-md text-sm font-medium ${
                  darkMode
                    ? "bg-slate-800 text-slate-300 hover:bg-slate-700"
                    : "bg-slate-100 text-slate-700 hover:bg-slate-200"
                }`}
              >
                취소
              </button>
              <button
                type="button"
                onClick={submit}
                className="flex-1 px-3 py-2 rounded-md text-sm font-semibold text-white bg-gradient-to-r from-violet-600 to-fuchsia-600 hover:from-violet-500 hover:to-fuchsia-500 shadow-sm inline-flex items-center justify-center gap-1"
              >
                <Check className="w-4 h-4" />
                등록
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

// ─── Main Component ────────────────────────────────────────────────
export function BenchmarkLeaderboard({
  currentState,
  onLoadEntry,
  darkMode = false,
}: BenchmarkLeaderboardProps) {
  const [entries, setEntries] = useState<LeaderboardEntry[]>([])
  const [hydrated, setHydrated] = useState(false)
  const [activeCategory, setActiveCategory] = useState<Category>("mrr")
  const [showAll, setShowAll] = useState(false)
  const [nickModalOpen, setNickModalOpen] = useState(false)
  const [justAddedId, setJustAddedId] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  // Hydrate once on mount
  useEffect(() => {
    setEntries(loadEntries())
    setHydrated(true)
  }, [])

  // Persist on change (skip initial hydration)
  useEffect(() => {
    if (!hydrated) return
    saveEntries(entries)
  }, [entries, hydrated])

  // Clear "NEW" flag after 6s
  useEffect(() => {
    if (!justAddedId) return
    const t = setTimeout(() => setJustAddedId(null), 6000)
    return () => clearTimeout(t)
  }, [justAddedId])

  const meta = CATEGORIES.find((c) => c.key === activeCategory) ?? CATEGORIES[0]

  // Filter by condition group (isoGroup + operation) unless showAll
  const filtered = useMemo(() => {
    if (showAll) return entries
    return entries.filter((e) => sameGroup(e, currentState))
  }, [entries, currentState, showAll])

  // Rank by active category
  const ranked = useMemo(() => {
    const list = filtered
      .map((e) => ({ entry: e, value: meta.pick(e) }))
      .filter((x): x is { entry: LeaderboardEntry; value: number } => x.value !== null)
    list.sort((a, b) => (meta.higherIsBetter ? b.value - a.value : a.value - b.value))
    return list.slice(0, TOP_N)
  }, [filtered, meta])

  // Detect whether the "current" condition is already in the visible top
  const currentInTop = useMemo(() => {
    return ranked.some((r) => sameCondition(r.entry, currentState))
  }, [ranked, currentState])

  // ─── Register current condition ──────────────────────────────
  const handleRegister = useCallback(
    (nickname: string) => {
      const newEntry: LeaderboardEntry = {
        id: genId(),
        timestamp: Date.now(),
        nickname: nickname || "익명",
        isoGroup: currentState.isoGroup,
        operation: currentState.operation,
        Vc: currentState.Vc,
        fz: currentState.fz,
        ap: currentState.ap,
        ae: currentState.ae,
        diameter: currentState.diameter,
        fluteCount: currentState.fluteCount,
        MRR: currentState.MRR,
        toolLifeMin: currentState.toolLifeMin,
        costPerPart: currentState.costPerPart,
        Pc: currentState.Pc,
        Ra: currentState.Ra,
      }
      setEntries((prev) => {
        const next = [newEntry, ...prev]
        // Cap to MAX_ENTRIES — drop oldest beyond cap
        if (next.length > MAX_ENTRIES) {
          next.sort((a, b) => b.timestamp - a.timestamp)
          return next.slice(0, MAX_ENTRIES)
        }
        return next
      })
      setJustAddedId(newEntry.id)
      setNickModalOpen(false)
    },
    [currentState],
  )

  // ─── Export / Import ────────────────────────────────────────
  const handleExport = useCallback(() => {
    try {
      const payload = JSON.stringify(entries, null, 2)
      const blob = new Blob([payload], { type: "application/json" })
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      const stamp = new Date().toISOString().slice(0, 10)
      a.href = url
      a.download = `yg1-benchmark-${stamp}.json`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
    } catch {
      /* ignore */
    }
  }, [entries])

  const handleImportFile = useCallback((file: File) => {
    const reader = new FileReader()
    reader.onload = () => {
      try {
        const raw = reader.result
        if (typeof raw !== "string") return
        const parsed = JSON.parse(raw)
        if (!Array.isArray(parsed)) return
        // Validate via same rules as loadEntries
        const clean = parsed.filter((x): x is LeaderboardEntry => {
          if (!x || typeof x !== "object") return false
          const e = x as Partial<LeaderboardEntry>
          return (
            typeof e.id === "string" &&
            typeof e.timestamp === "number" &&
            typeof e.isoGroup === "string" &&
            typeof e.operation === "string" &&
            typeof e.Vc === "number" &&
            typeof e.fz === "number" &&
            typeof e.ap === "number" &&
            typeof e.ae === "number" &&
            typeof e.diameter === "number" &&
            typeof e.fluteCount === "number" &&
            typeof e.MRR === "number" &&
            typeof e.toolLifeMin === "number"
          )
        })
        setEntries((prev) => {
          // Merge — de-dup by id
          const byId = new Map<string, LeaderboardEntry>()
          for (const e of prev) byId.set(e.id, e)
          for (const e of clean) byId.set(e.id, e)
          const arr = Array.from(byId.values())
          arr.sort((a, b) => b.timestamp - a.timestamp)
          return arr.slice(0, MAX_ENTRIES)
        })
      } catch {
        /* ignore */
      }
    }
    reader.readAsText(file)
  }, [])

  const triggerImport = () => fileInputRef.current?.click()

  // ─── Theme tokens ────────────────────────────────────────────
  const rootBg = darkMode ? "bg-slate-900" : "bg-white"
  const rootBorder = darkMode ? "border-slate-700" : "border-slate-200"
  const titleFg = darkMode ? "text-slate-100" : "text-slate-900"
  const subFg = darkMode ? "text-slate-400" : "text-slate-500"
  const rowBg = darkMode ? "bg-slate-800/50" : "bg-slate-50"
  const rowHoverBg = darkMode ? "hover:bg-slate-800" : "hover:bg-slate-100"
  const rowBorder = darkMode ? "border-slate-700" : "border-slate-200"
  const rowFg = darkMode ? "text-slate-200" : "text-slate-800"
  const chipBg = darkMode ? "bg-slate-800 text-slate-300" : "bg-slate-100 text-slate-600"

  const activeTone = tone(meta, darkMode)

  return (
    <div className={`rounded-2xl border shadow-sm ${rootBg} ${rootBorder}`}>
      {/* ── Header ──────────────────────────────────────────── */}
      <div
        className={`flex flex-wrap items-start justify-between gap-3 px-4 py-3 border-b ${rowBorder}`}
      >
        <div className="min-w-0">
          <h2 className={`flex items-center gap-2 text-base font-semibold ${titleFg}`}>
            <Trophy className="w-5 h-5 text-amber-500" />
            벤치마크 리더보드
          </h2>
          <p className={`mt-0.5 text-xs ${subFg}`}>
            같은 재질·가공 조건 중 상위 기록 · {currentState.isoGroup || "-"} /{" "}
            {currentState.operation || "-"}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setNickModalOpen(true)}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-white bg-gradient-to-r from-violet-600 to-fuchsia-600 hover:from-violet-500 hover:to-fuchsia-500 shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400"
        >
          <PlusCircle className="w-4 h-4" />
          이 조건 등록
        </button>
      </div>

      {/* ── Tabs ─────────────────────────────────────────────── */}
      <div className={`flex flex-wrap gap-1 px-4 py-2 border-b ${rowBorder}`} role="tablist">
        {CATEGORIES.map((c) => {
          const active = c.key === activeCategory
          const t = tone(c, darkMode)
          return (
            <button
              key={c.key}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setActiveCategory(c.key)}
              className={[
                "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors",
                "focus-visible:outline-none focus-visible:ring-2",
                t.ringFocus,
                active
                  ? `${t.bg} ${t.text} ${t.border} border`
                  : `${chipBg} border border-transparent`,
              ].join(" ")}
            >
              <c.Icon className="w-3.5 h-3.5" />
              {c.label}
            </button>
          )
        })}
      </div>

      {/* ── Filter row ───────────────────────────────────────── */}
      <div
        className={`flex items-center justify-between gap-2 px-4 py-2 border-b ${rowBorder}`}
      >
        <div className={`inline-flex items-center gap-1.5 text-xs ${subFg}`}>
          <Filter className="w-3.5 h-3.5" />
          {showAll
            ? "전체 조건 표시 중"
            : `현재 조건(${currentState.isoGroup || "-"} / ${
                currentState.operation || "-"
              })만 표시`}
        </div>
        <label className="inline-flex items-center gap-1.5 text-xs cursor-pointer select-none">
          <input
            type="checkbox"
            checked={showAll}
            onChange={(e) => setShowAll(e.target.checked)}
            className="accent-violet-600"
          />
          <span className={darkMode ? "text-slate-300" : "text-slate-700"}>전체 보기</span>
        </label>
      </div>

      {/* ── List ─────────────────────────────────────────────── */}
      <div className="px-4 py-3">
        {!hydrated ? (
          <div className={`py-6 text-center text-xs ${subFg}`}>불러오는 중…</div>
        ) : ranked.length === 0 ? (
          <div
            className={`py-8 text-center rounded-lg border border-dashed ${rowBorder} ${subFg}`}
          >
            <Sparkles className="w-6 h-6 mx-auto mb-2 opacity-60" />
            <p className="text-sm">아직 등록된 기록이 없어요. 첫 기록을 남겨보세요! 🎯</p>
          </div>
        ) : (
          <ul className="space-y-1.5">
            <AnimatePresence initial={false}>
              {ranked.map((r, idx) => {
                const rank = idx + 1
                const badge = rankBadge(rank)
                const isCurrent = sameCondition(r.entry, currentState)
                const isJustAdded = justAddedId === r.entry.id
                const value = r.value
                const clickable = typeof onLoadEntry === "function"
                return (
                  <motion.li
                    key={r.entry.id}
                    layout="position"
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -6 }}
                    transition={{ type: "spring", stiffness: 320, damping: 28 }}
                    className={[
                      "relative flex items-center gap-3 px-3 py-2 rounded-lg border text-sm",
                      rowBg,
                      rowBorder,
                      rowFg,
                      clickable ? `cursor-pointer ${rowHoverBg}` : "",
                      isCurrent ? "ring-2 ring-violet-400 ring-offset-1 ring-offset-transparent" : "",
                    ].join(" ")}
                    onClick={() => {
                      if (clickable && onLoadEntry) onLoadEntry(r.entry)
                    }}
                    role={clickable ? "button" : undefined}
                    tabIndex={clickable ? 0 : undefined}
                    onKeyDown={(e) => {
                      if (!clickable || !onLoadEntry) return
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault()
                        onLoadEntry(r.entry)
                      }
                    }}
                  >
                    {/* Rank */}
                    <div
                      className={`flex-none w-8 text-center font-bold ${
                        rank <= 3 ? "text-lg leading-none" : `text-sm ${subFg}`
                      }`}
                      aria-label={`${rank}위`}
                    >
                      {badge.icon || badge.fallback}
                    </div>

                    {/* Condition mini */}
                    <div className="flex-1 min-w-0">
                      <div
                        className={`text-xs ${subFg} truncate`}
                        title={`Vc ${fmtNum(r.entry.Vc, 0)} · fz ${fmtNum(r.entry.fz, 3)} · ap ${fmtNum(r.entry.ap, 2)} · ae ${fmtNum(r.entry.ae, 2)} · Ø${fmtNum(r.entry.diameter, 1)}/${r.entry.fluteCount}F`}
                      >
                        <span className="font-medium">
                          Vc {fmtNum(r.entry.Vc, 0)}
                        </span>
                        <span className="mx-1">·</span>
                        <span>fz {fmtNum(r.entry.fz, 3)}</span>
                        <span className="mx-1">·</span>
                        <span>ap {fmtNum(r.entry.ap, 2)}</span>
                        <span className="mx-1">·</span>
                        <span>ae {fmtNum(r.entry.ae, 2)}</span>
                        <span className="mx-1">·</span>
                        <span>
                          Ø{fmtNum(r.entry.diameter, 1)}/{r.entry.fluteCount}F
                        </span>
                      </div>
                      <div className="mt-0.5 flex flex-wrap items-center gap-2">
                        <span
                          className={`text-[11px] px-1.5 py-0.5 rounded ${chipBg} truncate max-w-[50%]`}
                          title={r.entry.nickname || "익명"}
                        >
                          {r.entry.nickname || "익명"}
                        </span>
                        <span className={`text-[11px] ${subFg}`}>
                          {formatDate(r.entry.timestamp)}
                        </span>
                        {showAll && !sameGroup(r.entry, currentState) && (
                          <span
                            className={`text-[10px] px-1.5 py-0.5 rounded border ${rowBorder} ${subFg}`}
                          >
                            {r.entry.isoGroup}/{r.entry.operation}
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Metric value */}
                    <div className="flex-none text-right max-w-[40%]">
                      <div className={`truncate font-mono text-sm font-semibold ${activeTone.text}`} title={meta.format(value)}>
                        {meta.format(value)}
                      </div>
                      <div className={`truncate text-[10px] ${subFg}`}>{meta.unit}</div>
                    </div>

                    {/* NEW! badge */}
                    {isJustAdded && (
                      <motion.span
                        className="absolute -top-1.5 -right-1.5 px-1.5 py-0.5 rounded-full text-[10px] font-bold text-white bg-gradient-to-r from-violet-600 to-fuchsia-600 shadow"
                        initial={{ scale: 0 }}
                        animate={{
                          scale: [1, 1.15, 1],
                        }}
                        transition={{
                          duration: 1.2,
                          repeat: Infinity,
                          ease: "easeInOut",
                        }}
                      >
                        NEW!
                      </motion.span>
                    )}
                  </motion.li>
                )
              })}
            </AnimatePresence>
          </ul>
        )}

        {/* Tip: current condition not in top */}
        {hydrated && ranked.length > 0 && !currentInTop && (
          <div
            className={`mt-2 inline-flex items-center gap-1.5 text-[11px] ${subFg}`}
          >
            <Info className="w-3.5 h-3.5" />
            현재 조건은 아직 TOP {TOP_N} 안에 없어요. 등록해보세요!
          </div>
        )}
      </div>

      {/* ── Footer: Export/Import ────────────────────────────── */}
      <div
        className={`flex items-center justify-between gap-2 px-4 py-2 border-t ${rowBorder}`}
      >
        <div className={`text-[11px] ${subFg}`}>
          저장 {entries.length}/{MAX_ENTRIES} · localStorage
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={handleExport}
            disabled={entries.length === 0}
            className={`inline-flex items-center gap-1 px-2 py-1 rounded text-[11px] font-medium disabled:opacity-40 ${chipBg} ${rowHoverBg}`}
          >
            <Download className="w-3 h-3" />
            JSON 내보내기
          </button>
          <button
            type="button"
            onClick={triggerImport}
            className={`inline-flex items-center gap-1 px-2 py-1 rounded text-[11px] font-medium ${chipBg} ${rowHoverBg}`}
          >
            <Upload className="w-3 h-3" />
            가져오기
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="application/json,.json"
            aria-label="리더보드 JSON 파일 가져오기"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) handleImportFile(f)
              // reset so selecting same file twice still fires onChange
              e.target.value = ""
            }}
          />
        </div>
      </div>

      {/* ── Nickname modal ───────────────────────────────────── */}
      <NicknameModal
        open={nickModalOpen}
        onClose={() => setNickModalOpen(false)}
        onConfirm={handleRegister}
        darkMode={darkMode}
      />
    </div>
  )
}

export default BenchmarkLeaderboard
