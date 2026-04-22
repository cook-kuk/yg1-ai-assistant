// SPDX-License-Identifier: MIT
// YG-1 ARIA Simulator v3 — 용어사전 브라우저 (client)
// EDUCATION_DB(112 entry)를 카테고리/검색/난이도/즐겨찾기로 탐색

"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import {
  Search,
  Star,
  StarOff,
  BookOpen,
  AlertTriangle,
  Lightbulb,
  FlaskConical,
  Link2,
  ScrollText,
  ChevronRight,
} from "lucide-react"
import {
  EDUCATION_DB,
  type EducationEntry,
  type EducationLevel,
} from "@/lib/frontend/simulator/v2/education-content"

// ═══════════════════════════════════════════════════════════════════
// 상수 / 설정 (매직넘버 억제)
// ═══════════════════════════════════════════════════════════════════

const FAV_STORAGE_KEY = "yg1-sim-v3-glossary-favs"
const LEVEL_STORAGE_KEY = "yg1-sim-v3-glossary-level"

type Category = EducationEntry["category"]
type FilterCategory = Category | "all" | "favorites"

const CATEGORY_ORDER: Category[] = [
  "speeds",
  "depth",
  "tool-shape",
  "material",
  "coating",
  "machine",
  "operation",
  "coolant",
  "result",
  "phenomenon",
  "technique",
]

const CATEGORY_LABEL: Record<Category, string> = {
  speeds: "속도 Speeds",
  depth: "절입 Depth",
  "tool-shape": "공구 형상",
  material: "재료 Material",
  coating: "코팅 Coating",
  machine: "장비 Machine",
  operation: "가공 Operation",
  coolant: "절삭유 Coolant",
  result: "결과 Result",
  phenomenon: "현상 Phenomenon",
  technique: "기법 Technique",
}

const CATEGORY_BADGE: Record<Category, string> = {
  speeds: "bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-200",
  depth: "bg-indigo-100 text-indigo-800 dark:bg-indigo-950 dark:text-indigo-200",
  "tool-shape": "bg-purple-100 text-purple-800 dark:bg-purple-950 dark:text-purple-200",
  material: "bg-orange-100 text-orange-800 dark:bg-orange-950 dark:text-orange-200",
  coating: "bg-yellow-100 text-yellow-800 dark:bg-yellow-950 dark:text-yellow-200",
  machine: "bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-200",
  operation: "bg-teal-100 text-teal-800 dark:bg-teal-950 dark:text-teal-200",
  coolant: "bg-cyan-100 text-cyan-800 dark:bg-cyan-950 dark:text-cyan-200",
  result: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200",
  phenomenon: "bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-200",
  technique: "bg-fuchsia-100 text-fuchsia-800 dark:bg-fuchsia-950 dark:text-fuchsia-200",
}

const LEVEL_META: Record<
  EducationLevel,
  { label: string; bg: string; ring: string; tabActive: string; tabIdle: string }
> = {
  beginner: {
    label: "초급",
    bg: "bg-emerald-50 dark:bg-emerald-950/50 border-emerald-200 dark:border-emerald-900 text-emerald-950 dark:text-emerald-100",
    ring: "ring-emerald-400",
    tabActive:
      "bg-emerald-600 text-white dark:bg-emerald-500 dark:text-emerald-50",
    tabIdle:
      "bg-emerald-50 text-emerald-800 hover:bg-emerald-100 dark:bg-emerald-950/40 dark:text-emerald-200 dark:hover:bg-emerald-950",
  },
  intermediate: {
    label: "중급",
    bg: "bg-amber-50 dark:bg-amber-950/50 border-amber-200 dark:border-amber-900 text-amber-950 dark:text-amber-100",
    ring: "ring-amber-400",
    tabActive: "bg-amber-600 text-white dark:bg-amber-500 dark:text-amber-50",
    tabIdle:
      "bg-amber-50 text-amber-800 hover:bg-amber-100 dark:bg-amber-950/40 dark:text-amber-200 dark:hover:bg-amber-950",
  },
  expert: {
    label: "고급",
    bg: "bg-violet-50 dark:bg-violet-950/50 border-violet-200 dark:border-violet-900 text-violet-950 dark:text-violet-100",
    ring: "ring-violet-400",
    tabActive:
      "bg-violet-600 text-white dark:bg-violet-500 dark:text-violet-50",
    tabIdle:
      "bg-violet-50 text-violet-800 hover:bg-violet-100 dark:bg-violet-950/40 dark:text-violet-200 dark:hover:bg-violet-950",
  },
}

const LEVELS: EducationLevel[] = ["beginner", "intermediate", "expert"]

// ═══════════════════════════════════════════════════════════════════
// 즐겨찾기 훅
// ═══════════════════════════════════════════════════════════════════

function useFavorites() {
  const [favs, setFavs] = useState<Set<string>>(new Set())
  const [hydrated, setHydrated] = useState(false)

  useEffect(() => {
    try {
      const raw = localStorage.getItem(FAV_STORAGE_KEY)
      if (raw) {
        const arr = JSON.parse(raw) as string[]
        if (Array.isArray(arr)) setFavs(new Set(arr))
      }
    } catch {
      /* ignore */
    }
    setHydrated(true)
  }, [])

  const persist = useCallback((next: Set<string>) => {
    try {
      localStorage.setItem(FAV_STORAGE_KEY, JSON.stringify([...next]))
    } catch {
      /* ignore */
    }
  }, [])

  const toggle = useCallback(
    (id: string) => {
      setFavs(prev => {
        const next = new Set(prev)
        if (next.has(id)) next.delete(id)
        else next.add(id)
        persist(next)
        return next
      })
    },
    [persist],
  )

  return { favs, toggle, hydrated }
}

// ═══════════════════════════════════════════════════════════════════
// 검색 로직
// ═══════════════════════════════════════════════════════════════════

function matchesQuery(entry: EducationEntry, q: string): boolean {
  if (!q) return true
  const needle = q.toLowerCase()
  if (entry.korean.toLowerCase().includes(needle)) return true
  if (entry.english.toLowerCase().includes(needle)) return true
  if (entry.id.toLowerCase().includes(needle)) return true
  const d = entry.definition
  if (d.beginner.toLowerCase().includes(needle)) return true
  if (d.intermediate.toLowerCase().includes(needle)) return true
  if (d.expert.toLowerCase().includes(needle)) return true
  return false
}

// ═══════════════════════════════════════════════════════════════════
// 메인 컴포넌트
// ═══════════════════════════════════════════════════════════════════

export function GlossaryBrowser() {
  const allEntries = useMemo(() => Object.values(EDUCATION_DB), [])

  const [query, setQuery] = useState("")
  const [category, setCategory] = useState<FilterCategory>("all")
  const [level, setLevel] = useState<EducationLevel>("intermediate")
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [sidebarOpenMobile, setSidebarOpenMobile] = useState(false)

  const { favs, toggle: toggleFav, hydrated } = useFavorites()

  // 난이도 초기값 localStorage 복원
  useEffect(() => {
    try {
      const raw = localStorage.getItem(LEVEL_STORAGE_KEY)
      if (raw === "beginner" || raw === "intermediate" || raw === "expert") {
        setLevel(raw)
      }
    } catch {
      /* ignore */
    }
  }, [])

  useEffect(() => {
    try {
      localStorage.setItem(LEVEL_STORAGE_KEY, level)
    } catch {
      /* ignore */
    }
  }, [level])

  // URL 해시 → selectedId
  useEffect(() => {
    function syncFromHash() {
      const hash = window.location.hash.replace(/^#/, "")
      if (hash && EDUCATION_DB[hash]) {
        setSelectedId(hash)
      }
    }
    syncFromHash()
    window.addEventListener("hashchange", syncFromHash)
    return () => window.removeEventListener("hashchange", syncFromHash)
  }, [])

  // 필터 + 검색 적용
  const filtered = useMemo(() => {
    return allEntries.filter(e => {
      if (category === "favorites") {
        if (!favs.has(e.id)) return false
      } else if (category !== "all") {
        if (e.category !== category) return false
      }
      return matchesQuery(e, query)
    })
  }, [allEntries, category, favs, query])

  // 카테고리별 그룹핑 (좌측 리스트용)
  const grouped = useMemo(() => {
    const map = new Map<Category, EducationEntry[]>()
    for (const e of filtered) {
      const arr = map.get(e.category) ?? []
      arr.push(e)
      map.set(e.category, arr)
    }
    for (const [, arr] of map) {
      arr.sort((a, b) => a.korean.localeCompare(b.korean, "ko"))
    }
    return map
  }, [filtered])

  // 선택 entry 자동 교정 (필터가 변할 때 유효성)
  useEffect(() => {
    if (selectedId && !filtered.some(e => e.id === selectedId)) {
      // 결과에서 사라졌어도 상세 자체는 유지 (탐색 편의)
    }
    if (!selectedId && filtered.length > 0) {
      setSelectedId(filtered[0].id)
    }
  }, [filtered, selectedId])

  const selectedEntry = selectedId ? EDUCATION_DB[selectedId] : undefined

  const selectEntry = useCallback((id: string) => {
    setSelectedId(id)
    setSidebarOpenMobile(false)
    if (typeof window !== "undefined") {
      history.replaceState(null, "", `#${id}`)
    }
  }, [])

  const totalCount = filtered.length

  return (
    <div className="space-y-4">
      {/* ─────────────── 상단 검색 / 필터 (sticky) ─────────────── */}
      <div className="sticky top-0 z-30 -mx-4 border-b border-slate-200 bg-white/95 px-4 py-3 backdrop-blur supports-[backdrop-filter]:bg-white/80 dark:border-slate-800 dark:bg-slate-900/95 dark:supports-[backdrop-filter]:bg-slate-900/80">
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400 dark:text-slate-500" />
            <input
              type="text"
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="용어 검색 (한글/영문) ..."
              className="w-full rounded-lg border border-slate-300 bg-white py-2.5 pl-9 pr-3 text-sm text-slate-900 placeholder:text-slate-400 focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-200 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:placeholder:text-slate-500 dark:focus:border-sky-400 dark:focus:ring-sky-900"
            />
          </div>
          <span className="hidden shrink-0 rounded-md bg-slate-100 px-2.5 py-1 text-[11px] font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-300 sm:inline-block">
            {totalCount.toLocaleString()}개 entry
          </span>
        </div>

        {/* 카테고리 칩 */}
        <div className="mt-3 flex flex-wrap gap-1.5">
          <CategoryChip
            active={category === "all"}
            onClick={() => setCategory("all")}
            label={`전체 (${allEntries.length})`}
          />
          <CategoryChip
            active={category === "favorites"}
            onClick={() => setCategory("favorites")}
            label={`★ 즐겨찾기 (${hydrated ? favs.size : "…"})`}
            tone="amber"
          />
          {CATEGORY_ORDER.map(cat => {
            const count = allEntries.filter(e => e.category === cat).length
            return (
              <CategoryChip
                key={cat}
                active={category === cat}
                onClick={() => setCategory(cat)}
                label={`${CATEGORY_LABEL[cat]} (${count})`}
              />
            )
          })}
        </div>

        {/* 난이도 탭 + 모바일 사이드바 토글 */}
        <div className="mt-3 flex items-center justify-between gap-2">
          <div className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-0.5 dark:border-slate-700 dark:bg-slate-800">
            {LEVELS.map(lv => {
              const m = LEVEL_META[lv]
              const isActive = level === lv
              return (
                <button
                  key={lv}
                  type="button"
                  onClick={() => setLevel(lv)}
                  className={`rounded-md px-3 py-1 text-xs font-medium transition ${
                    isActive ? m.tabActive : m.tabIdle
                  }`}
                >
                  {m.label}
                </button>
              )
            })}
          </div>
          <span className="sm:hidden text-[11px] font-medium text-slate-500 dark:text-slate-400">
            {totalCount}개
          </span>
          <button
            type="button"
            onClick={() => setSidebarOpenMobile(v => !v)}
            className="inline-flex items-center gap-1 rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs text-slate-700 md:hidden dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
          >
            목록
            <ChevronRight
              className={`h-3 w-3 transition ${sidebarOpenMobile ? "rotate-90" : ""}`}
            />
          </button>
        </div>
      </div>

      {/* ─────────────── 본문: 사이드바 + 상세 ─────────────── */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-[300px_1fr]">
        <aside
          className={`${
            sidebarOpenMobile ? "block" : "hidden"
          } md:block md:sticky md:top-[210px] md:max-h-[calc(100vh-230px)] md:overflow-y-auto`}
        >
          <div className="rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
            {grouped.size === 0 ? (
              <div className="p-6 text-center text-xs text-slate-500 dark:text-slate-400">
                결과가 없습니다
              </div>
            ) : (
              <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                {CATEGORY_ORDER.filter(c => grouped.has(c)).map(cat => (
                  <li key={cat}>
                    <div className="bg-slate-50 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                      {CATEGORY_LABEL[cat]} ({grouped.get(cat)!.length})
                    </div>
                    <ul>
                      {grouped.get(cat)!.map(entry => {
                        const isSelected = entry.id === selectedId
                        const isFav = favs.has(entry.id)
                        return (
                          <li key={entry.id}>
                            <button
                              type="button"
                              onClick={() => selectEntry(entry.id)}
                              className={`flex w-full items-center gap-2 px-3 py-2 text-left text-[13px] transition ${
                                isSelected
                                  ? "bg-sky-50 text-sky-900 dark:bg-sky-950/40 dark:text-sky-100"
                                  : "hover:bg-slate-50 dark:hover:bg-slate-800/60"
                              }`}
                            >
                              <span className="flex-1 truncate">
                                <span
                                  className={`font-medium ${
                                    isSelected
                                      ? "text-sky-900 dark:text-sky-100"
                                      : "text-slate-800 dark:text-slate-100"
                                  }`}
                                >
                                  {entry.korean}
                                </span>
                                <span className="ml-1 text-[11px] text-slate-400 dark:text-slate-500">
                                  {entry.english}
                                </span>
                              </span>
                              {isFav && (
                                <Star className="h-3 w-3 shrink-0 fill-amber-400 text-amber-400" />
                              )}
                            </button>
                          </li>
                        )
                      })}
                    </ul>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </aside>

        <section>
          {selectedEntry ? (
            <EntryDetail
              entry={selectedEntry}
              level={level}
              onLevelChange={setLevel}
              isFav={favs.has(selectedEntry.id)}
              onToggleFav={() => toggleFav(selectedEntry.id)}
              onSelectEntry={selectEntry}
            />
          ) : (
            <div className="rounded-xl border border-dashed border-slate-300 bg-white p-10 text-center text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400">
              왼쪽 목록에서 용어를 선택하세요
            </div>
          )}
        </section>
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════
// 카테고리 칩
// ═══════════════════════════════════════════════════════════════════

function CategoryChip({
  active,
  onClick,
  label,
  tone = "slate",
}: {
  active: boolean
  onClick: () => void
  label: string
  tone?: "slate" | "amber"
}) {
  const activeClass =
    tone === "amber"
      ? "bg-amber-500 text-white border-amber-500 dark:bg-amber-500 dark:border-amber-500"
      : "bg-slate-900 text-white border-slate-900 dark:bg-slate-100 dark:text-slate-900 dark:border-slate-100"
  const idleClass =
    "bg-white text-slate-700 border-slate-300 hover:bg-slate-50 dark:bg-slate-900 dark:text-slate-200 dark:border-slate-700 dark:hover:bg-slate-800"
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full border px-3 py-1 text-[11px] font-medium transition ${
        active ? activeClass : idleClass
      }`}
    >
      {label}
    </button>
  )
}

// ═══════════════════════════════════════════════════════════════════
// 상세
// ═══════════════════════════════════════════════════════════════════

function EntryDetail({
  entry,
  level,
  onLevelChange,
  isFav,
  onToggleFav,
  onSelectEntry,
}: {
  entry: EducationEntry
  level: EducationLevel
  onLevelChange: (l: EducationLevel) => void
  isFav: boolean
  onToggleFav: () => void
  onSelectEntry: (id: string) => void
}) {
  const levelMeta = LEVEL_META[level]

  return (
    <article className="space-y-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
      {/* 헤더 */}
      <header className="flex items-start justify-between gap-3 border-b border-slate-100 pb-4 dark:border-slate-800">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${CATEGORY_BADGE[entry.category]}`}
            >
              {CATEGORY_LABEL[entry.category]}
            </span>
            <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[10px] text-slate-600 dark:bg-slate-800 dark:text-slate-300">
              #{entry.id}
            </code>
          </div>
          <h2 className="mt-2 text-lg font-semibold text-slate-900 dark:text-slate-50">
            {entry.korean}
          </h2>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            {entry.english}
          </p>
        </div>
        <button
          type="button"
          onClick={onToggleFav}
          aria-label={isFav ? "즐겨찾기 해제" : "즐겨찾기 추가"}
          className={`shrink-0 rounded-md border px-2.5 py-1.5 text-xs font-medium transition ${
            isFav
              ? "border-amber-300 bg-amber-50 text-amber-700 hover:bg-amber-100 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200 dark:hover:bg-amber-950"
              : "border-slate-300 bg-white text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
          }`}
        >
          {isFav ? (
            <span className="inline-flex items-center gap-1">
              <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400" />
              즐겨찾기
            </span>
          ) : (
            <span className="inline-flex items-center gap-1">
              <StarOff className="h-3.5 w-3.5" />
              즐겨찾기
            </span>
          )}
        </button>
      </header>

      {/* 난이도 탭 */}
      <div className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-0.5 dark:border-slate-700 dark:bg-slate-800">
        {LEVELS.map(lv => {
          const m = LEVEL_META[lv]
          const active = level === lv
          return (
            <button
              key={lv}
              type="button"
              onClick={() => onLevelChange(lv)}
              className={`rounded-md px-3 py-1 text-xs font-medium transition ${
                active ? m.tabActive : m.tabIdle
              }`}
            >
              {m.label}
            </button>
          )
        })}
      </div>

      {/* 난이도별 설명 박스 */}
      <div
        className={`rounded-lg border p-4 text-sm leading-relaxed ${levelMeta.bg}`}
      >
        <div className="mb-1 inline-flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wider opacity-80">
          <BookOpen className="h-3 w-3" /> {levelMeta.label} 설명
        </div>
        <p>{entry.definition[level]}</p>
      </div>

      {/* 공식 */}
      {entry.formula && (
        <div>
          <div className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
            공식 / Formula
          </div>
          <pre className="overflow-x-auto rounded-lg border border-slate-200 bg-slate-950 px-4 py-3 font-mono text-[13px] leading-relaxed text-emerald-200 dark:border-slate-700">
            {entry.formula}
          </pre>
        </div>
      )}

      {/* 왜 중요? */}
      <DetailSection
        icon={<Lightbulb className="h-3.5 w-3.5" />}
        title="왜 중요한가?"
        body={entry.whyItMatters}
      />

      {/* 실전 예시 */}
      <DetailSection
        icon={<FlaskConical className="h-3.5 w-3.5" />}
        title="실전 예시"
        body={entry.realWorldExample}
      />

      {/* 흔한 함정 */}
      {entry.commonPitfall && (
        <div className="rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm leading-relaxed text-rose-900 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-100">
          <div className="mb-1 inline-flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wider opacity-80">
            <AlertTriangle className="h-3 w-3" /> 흔한 함정
          </div>
          <p>{entry.commonPitfall}</p>
        </div>
      )}

      {/* 관련 개념 */}
      {entry.relatedConcepts.length > 0 && (
        <div>
          <div className="mb-1.5 inline-flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
            <Link2 className="h-3 w-3" /> 관련 개념
          </div>
          <div className="flex flex-wrap gap-1.5">
            {entry.relatedConcepts.map(rid => {
              const related = EDUCATION_DB[rid]
              if (!related) {
                return (
                  <span
                    key={rid}
                    className="rounded-full border border-dashed border-slate-300 bg-slate-50 px-2.5 py-0.5 text-[11px] text-slate-400 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-500"
                    title="참조된 entry가 DB에 없음"
                  >
                    {rid}
                  </span>
                )
              }
              return (
                <button
                  key={rid}
                  type="button"
                  onClick={() => onSelectEntry(rid)}
                  className="rounded-full border border-sky-200 bg-sky-50 px-2.5 py-0.5 text-[11px] font-medium text-sky-800 hover:bg-sky-100 dark:border-sky-800 dark:bg-sky-950/50 dark:text-sky-200 dark:hover:bg-sky-950"
                >
                  {related.korean}
                </button>
              )
            })}
          </div>
        </div>
      )}

      {/* 출처 */}
      {entry.sourceAuthority && (
        <footer className="flex items-start gap-1.5 border-t border-slate-100 pt-3 text-[11px] text-slate-500 dark:border-slate-800 dark:text-slate-400">
          <ScrollText className="mt-0.5 h-3 w-3 shrink-0" />
          <span>출처: {entry.sourceAuthority}</span>
        </footer>
      )}
    </article>
  )
}

function DetailSection({
  icon,
  title,
  body,
}: {
  icon: React.ReactNode
  title: string
  body: string
}) {
  return (
    <div>
      <div className="mb-1 inline-flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
        {icon} {title}
      </div>
      <p className="text-sm leading-relaxed text-slate-700 dark:text-slate-200">
        {body}
      </p>
    </div>
  )
}
