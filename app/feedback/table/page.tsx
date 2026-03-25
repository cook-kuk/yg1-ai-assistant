"use client"

import { useEffect, useMemo, useState } from "react"
import {
  ArrowLeft,
  ArrowUpDown,
  ChevronDown,
  Download,
  Filter,
  RefreshCw,
  Search,
  Star,
  X,
} from "lucide-react"
import Link from "next/link"
import { parseFeedbackListResponse } from "@/lib/frontend/feedback/feedback-client"
import type { FeedbackEntryDto, FeedbackEventEntryDto } from "@/lib/contracts/feedback"

// ── Unified row type for the table ────────────────────────────
interface AdminFields {
  csComment: string
  dueDate: string
  completed: boolean
}

interface TableRow {
  id: string
  no: number
  date: string
  department: string
  author: string
  authorType: "internal" | "customer" | "anonymous"
  questionType: string
  questionContent: string
  questionIntent: string
  accuracy: "O" | "X" | "△" | "-"
  qualityScore: number | null
  errorType: string
  correctAnswer: string
  improvement: string
  source: "general" | "event"
  rating: number | null
  tags: string[]
}

// ── LocalStorage persistence for admin fields ────────────────
const ADMIN_STORAGE_KEY = "yg1_feedback_admin_fields"

function loadAdminFields(): Record<string, AdminFields> {
  if (typeof window === "undefined") return {}
  try {
    const raw = localStorage.getItem(ADMIN_STORAGE_KEY)
    return raw ? JSON.parse(raw) : {}
  } catch { return {} }
}

function saveAdminFields(fields: Record<string, AdminFields>) {
  if (typeof window === "undefined") return
  localStorage.setItem(ADMIN_STORAGE_KEY, JSON.stringify(fields))
}

// ── Parse from FeedbackEntryDto ────────────────────────────────
function generalToRow(entry: FeedbackEntryDto, index: number): TableRow {
  const departmentMatch = entry.authorName?.match(/^\[(.+?)\]\s*(.+)$/)
  const department = departmentMatch?.[1] ?? ""
  const author = departmentMatch?.[2] ?? entry.authorName ?? ""

  const lastUserMsg = entry.chatHistory?.filter(m => m.role === "user").pop()?.text ?? ""
  const tags = entry.tags ?? []

  let accuracy: TableRow["accuracy"] = "-"
  if (entry.rating != null) {
    if (entry.rating >= 4) accuracy = "O"
    else if (entry.rating >= 3) accuracy = "△"
    else accuracy = "X"
  }

  const errorType = tags.includes("wrong-product") ? "잘못된정보(팩트오류)"
    : tags.includes("wrong-condition") ? "절삭조건 오류"
    : tags.includes("missing-evidence") ? "근거 부족"
    : tags.includes("slow-response") ? "느린 응답"
    : tags.includes("ui-issue") ? "UI 문제"
    : tags.length > 0 ? tags[0]
    : ""

  return {
    id: entry.id,
    no: index + 1,
    date: formatDate(entry.timestamp),
    department,
    author,
    authorType: entry.authorType,
    questionType: inferQuestionType(lastUserMsg, entry.intakeSummary),
    questionContent: lastUserMsg || entry.intakeSummary || "",
    questionIntent: inferIntent(lastUserMsg),
    accuracy,
    qualityScore: entry.rating,
    errorType,
    correctAnswer: "",
    improvement: entry.comment || "",
    source: "general",
    rating: entry.rating,
    tags,
  }
}

function eventToRow(entry: FeedbackEventEntryDto, index: number): TableRow {
  const userMsg = entry.userMessage || entry.lastUserMessage || ""
  const aiMsg = entry.aiResponse || entry.lastAiResponse || ""

  let accuracy: TableRow["accuracy"] = "-"
  if (entry.feedback === "good" || entry.responseFeedback === "good") accuracy = "O"
  else if (entry.feedback === "bad" || entry.responseFeedback === "bad") accuracy = "X"
  else if (entry.feedback === "neutral") accuracy = "△"

  const errorType = entry.type === "failure_case" ? "문제 사례"
    : entry.type === "success_case" ? "좋은 사례"
    : ""

  return {
    id: entry.id,
    no: index + 1,
    date: formatDate(entry.timestamp),
    department: "",
    author: "",
    authorType: "anonymous",
    questionType: inferQuestionType(userMsg, null),
    questionContent: userMsg,
    questionIntent: entry.mode || "",
    accuracy,
    qualityScore: accuracy === "O" ? 5 : accuracy === "△" ? 3 : accuracy === "X" ? 1 : null,
    errorType,
    correctAnswer: "",
    improvement: entry.userComment || "",
    source: "event",
    rating: null,
    tags: [],
  }
}

function formatDate(value: string) {
  try {
    const d = new Date(value)
    return `${d.getMonth() + 1}/${d.getDate()}/${String(d.getFullYear()).slice(-2)}`
  } catch {
    return value
  }
}

function inferQuestionType(msg: string, intake: string | null): string {
  if (!msg && intake) return "제품탐색"
  if (/추천|제품.*찾|엔드밀|드릴/.test(msg)) return "제품탐색"
  if (/절삭조건|가공조건|속도|이송/.test(msg)) return "기술"
  if (/브랜드|시리즈|설명/.test(msg)) return "제품정보"
  if (/회사|공장|영업소|전화/.test(msg)) return "일반"
  return "기타"
}

function inferIntent(msg: string): string {
  if (/추천|찾아|검색/.test(msg)) return "제품 추천"
  if (/비교|차이/.test(msg)) return "비교"
  if (/절삭조건|가공조건/.test(msg)) return "절삭 조건 문의"
  if (/재고|납기/.test(msg)) return "재고 문의"
  if (/설명|알려|뭐야/.test(msg)) return "스펙 문의"
  return ""
}

// ── Column definitions ────────────────────────────────────────
type SortDir = "asc" | "desc"

const COLUMNS = [
  { key: "no", label: "No.", width: "w-12" },
  { key: "date", label: "일자", width: "w-20" },
  { key: "department", label: "소속부서", width: "w-28" },
  { key: "author", label: "작성자", width: "w-20" },
  { key: "questionType", label: "질문 유형", width: "w-20" },
  { key: "questionContent", label: "질문 내용", width: "w-56 min-w-[180px]" },
  { key: "questionIntent", label: "질문 의도", width: "w-24" },
  { key: "accuracy", label: "정확도", width: "w-16" },
  { key: "qualityScore", label: "품질점수", width: "w-16" },
  { key: "errorType", label: "오류 유형", width: "w-28" },
  { key: "improvement", label: "개선 필요사항", width: "w-48 min-w-[160px]" },
  { key: "csComment", label: "코너스톤 의견", width: "w-48 min-w-[160px]" },
  { key: "dueDate", label: "예상 Due Date", width: "w-32" },
  { key: "completed", label: "완료", width: "w-14" },
] as const

type ColumnKey = (typeof COLUMNS)[number]["key"]

// ── Accuracy badge ────────────────────────────────────────────
function AccuracyBadge({ value }: { value: string }) {
  const cls =
    value === "O" ? "bg-emerald-100 text-emerald-700"
    : value === "X" ? "bg-rose-100 text-rose-700"
    : value === "△" ? "bg-amber-100 text-amber-700"
    : "bg-gray-100 text-gray-400"
  return <span className={`inline-flex items-center justify-center w-7 h-7 rounded-full text-xs font-bold ${cls}`}>{value}</span>
}

function ScoreBadge({ value }: { value: number | null }) {
  if (value == null) return <span className="text-gray-300">-</span>
  const cls =
    value >= 4 ? "text-emerald-600"
    : value >= 3 ? "text-amber-600"
    : "text-rose-600"
  return <span className={`font-bold text-sm ${cls}`}>{value}</span>
}

// ── Main page component ────────────────────────────────────────
export default function FeedbackTablePage() {
  const [rows, setRows] = useState<TableRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Admin fields (persisted in localStorage)
  const [adminFields, setAdminFields] = useState<Record<string, AdminFields>>({})

  useEffect(() => {
    setAdminFields(loadAdminFields())
  }, [])

  const updateAdminField = (id: string, field: keyof AdminFields, value: string | boolean) => {
    setAdminFields(prev => {
      const current = prev[id] ?? { csComment: "", dueDate: "", completed: false }
      const updated = { ...prev, [id]: { ...current, [field]: value } }
      saveAdminFields(updated)
      return updated
    })
  }

  // Filters
  const [searchText, setSearchText] = useState("")
  const [filterDepartment, setFilterDepartment] = useState<string>("")
  const [filterAuthorType, setFilterAuthorType] = useState<string>("")
  const [filterQuestionType, setFilterQuestionType] = useState<string>("")
  const [filterAccuracy, setFilterAccuracy] = useState<string>("")
  const [filterErrorType, setFilterErrorType] = useState<string>("")

  // Sort
  const [sortKey, setSortKey] = useState<ColumnKey>("no")
  const [sortDir, setSortDir] = useState<SortDir>("asc")

  // Detail modal
  const [selectedRow, setSelectedRow] = useState<TableRow | null>(null)

  // Fetch data
  const fetchData = async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch("/api/feedback?page=1&pageSize=500")
      if (!res.ok) throw new Error(`${res.status}`)
      const data = parseFeedbackListResponse(await res.json())

      const generalRows = data.generalEntries.map((e, i) => generalToRow(e, i))
      const eventRows = data.feedbackEntries.map((e, i) => eventToRow(e, generalRows.length + i))
      const all = [...generalRows, ...eventRows].map((r, i) => ({ ...r, no: i + 1 }))
      setRows(all)
    } catch (err) {
      setError(err instanceof Error ? err.message : "데이터 로드 실패")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchData() }, [])

  // Unique filter options
  const departments = useMemo(() => [...new Set(rows.map(r => r.department).filter(Boolean))], [rows])
  const questionTypes = useMemo(() => [...new Set(rows.map(r => r.questionType).filter(Boolean))], [rows])
  const errorTypes = useMemo(() => [...new Set(rows.map(r => r.errorType).filter(Boolean))], [rows])

  // Filter + sort
  const filteredRows = useMemo(() => {
    let result = rows

    if (searchText) {
      const q = searchText.toLowerCase()
      result = result.filter(r =>
        r.questionContent.toLowerCase().includes(q) ||
        r.improvement.toLowerCase().includes(q) ||
        r.author.toLowerCase().includes(q) ||
        r.department.toLowerCase().includes(q)
      )
    }
    if (filterDepartment) result = result.filter(r => r.department === filterDepartment)
    if (filterAuthorType) result = result.filter(r => r.authorType === filterAuthorType)
    if (filterQuestionType) result = result.filter(r => r.questionType === filterQuestionType)
    if (filterAccuracy) result = result.filter(r => r.accuracy === filterAccuracy)
    if (filterErrorType) result = result.filter(r => r.errorType === filterErrorType)

    result = [...result].sort((a, b) => {
      const aVal = a[sortKey as keyof TableRow]
      const bVal = b[sortKey as keyof TableRow]
      if (aVal == null && bVal == null) return 0
      if (aVal == null) return 1
      if (bVal == null) return -1
      if (typeof aVal === "number" && typeof bVal === "number") {
        return sortDir === "asc" ? aVal - bVal : bVal - aVal
      }
      return sortDir === "asc"
        ? String(aVal).localeCompare(String(bVal))
        : String(bVal).localeCompare(String(aVal))
    })

    return result
  }, [rows, searchText, filterDepartment, filterAuthorType, filterQuestionType, filterAccuracy, filterErrorType, sortKey, sortDir])

  // Stats
  const stats = useMemo(() => {
    const total = filteredRows.length
    const accurate = filteredRows.filter(r => r.accuracy === "O").length
    const partial = filteredRows.filter(r => r.accuracy === "△").length
    const wrong = filteredRows.filter(r => r.accuracy === "X").length
    const avgScore = filteredRows.filter(r => r.qualityScore != null).reduce((sum, r) => sum + (r.qualityScore ?? 0), 0) / (filteredRows.filter(r => r.qualityScore != null).length || 1)
    return { total, accurate, partial, wrong, avgScore }
  }, [filteredRows])

  const handleSort = (key: ColumnKey) => {
    if (sortKey === key) {
      setSortDir(prev => prev === "asc" ? "desc" : "asc")
    } else {
      setSortKey(key)
      setSortDir("asc")
    }
  }

  const clearFilters = () => {
    setSearchText("")
    setFilterDepartment("")
    setFilterAuthorType("")
    setFilterQuestionType("")
    setFilterAccuracy("")
    setFilterErrorType("")
  }

  const hasFilters = searchText || filterDepartment || filterAuthorType || filterQuestionType || filterAccuracy || filterErrorType

  const handleExportCSV = () => {
    const headers = COLUMNS.map(c => c.label).join(",")
    const csvRows = filteredRows.map(r =>
      COLUMNS.map(c => {
        const val = r[c.key as keyof TableRow]
        const str = val == null ? "" : String(val)
        return `"${str.replace(/"/g, '""')}"`
      }).join(",")
    )
    const csv = [headers, ...csvRows].join("\n")
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `YG1_평가_${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b sticky top-0 z-30">
        <div className="max-w-[1600px] mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link href="/feedback" className="text-gray-400 hover:text-gray-600">
              <ArrowLeft size={18} />
            </Link>
            <h1 className="text-lg font-bold text-gray-900">AI 평가 데이터셋</h1>
            <span className="text-xs text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">
              {filteredRows.length}건{hasFilters ? ` / ${rows.length}건` : ""}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={fetchData} className="p-2 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-100" title="새로고침">
              <RefreshCw size={16} className={loading ? "animate-spin" : ""} />
            </button>
            <button onClick={handleExportCSV} className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-gray-600 bg-gray-100 rounded-lg hover:bg-gray-200" title="CSV 다운로드">
              <Download size={14} /> CSV
            </button>
          </div>
        </div>
      </div>

      {/* Stats bar */}
      <div className="max-w-[1600px] mx-auto px-4 py-3">
        <div className="flex gap-3 flex-wrap">
          <div className="bg-white rounded-xl border px-4 py-2 flex items-center gap-2">
            <span className="text-xs text-gray-500">전체</span>
            <span className="text-lg font-bold text-gray-900">{stats.total}</span>
          </div>
          <div className="bg-emerald-50 rounded-xl border border-emerald-200 px-4 py-2 flex items-center gap-2">
            <span className="text-xs text-emerald-600">정확 (O)</span>
            <span className="text-lg font-bold text-emerald-700">{stats.accurate}</span>
          </div>
          <div className="bg-amber-50 rounded-xl border border-amber-200 px-4 py-2 flex items-center gap-2">
            <span className="text-xs text-amber-600">부분 (△)</span>
            <span className="text-lg font-bold text-amber-700">{stats.partial}</span>
          </div>
          <div className="bg-rose-50 rounded-xl border border-rose-200 px-4 py-2 flex items-center gap-2">
            <span className="text-xs text-rose-600">오류 (X)</span>
            <span className="text-lg font-bold text-rose-700">{stats.wrong}</span>
          </div>
          <div className="bg-blue-50 rounded-xl border border-blue-200 px-4 py-2 flex items-center gap-2">
            <span className="text-xs text-blue-600">평균 점수</span>
            <span className="text-lg font-bold text-blue-700">{stats.avgScore.toFixed(1)}</span>
          </div>
        </div>
      </div>

      {/* Filter bar */}
      <div className="max-w-[1600px] mx-auto px-4 pb-3">
        <div className="bg-white rounded-xl border px-4 py-3 flex flex-wrap gap-2 items-center">
          <Filter size={14} className="text-gray-400" />
          <div className="relative">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              value={searchText}
              onChange={e => setSearchText(e.target.value)}
              placeholder="검색..."
              className="pl-8 pr-3 py-1.5 text-xs border rounded-lg w-48 focus:outline-none focus:ring-2 focus:ring-blue-300"
            />
          </div>
          <select value={filterDepartment} onChange={e => setFilterDepartment(e.target.value)} className="text-xs border rounded-lg px-2 py-1.5 text-gray-600">
            <option value="">부서 전체</option>
            {departments.map(d => <option key={d} value={d}>{d}</option>)}
          </select>
          <select value={filterAuthorType} onChange={e => setFilterAuthorType(e.target.value)} className="text-xs border rounded-lg px-2 py-1.5 text-gray-600">
            <option value="">유형 전체</option>
            <option value="internal">내부 개발팀</option>
            <option value="customer">고객사</option>
            <option value="anonymous">익명</option>
          </select>
          <select value={filterQuestionType} onChange={e => setFilterQuestionType(e.target.value)} className="text-xs border rounded-lg px-2 py-1.5 text-gray-600">
            <option value="">질문유형 전체</option>
            {questionTypes.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
          <select value={filterAccuracy} onChange={e => setFilterAccuracy(e.target.value)} className="text-xs border rounded-lg px-2 py-1.5 text-gray-600">
            <option value="">정확도 전체</option>
            <option value="O">O (정확)</option>
            <option value="△">△ (부분)</option>
            <option value="X">X (오류)</option>
          </select>
          <select value={filterErrorType} onChange={e => setFilterErrorType(e.target.value)} className="text-xs border rounded-lg px-2 py-1.5 text-gray-600">
            <option value="">오류유형 전체</option>
            {errorTypes.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
          {hasFilters && (
            <button onClick={clearFilters} className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-700 px-2 py-1 rounded hover:bg-gray-100">
              <X size={12} /> 초기화
            </button>
          )}
        </div>
      </div>

      {/* Table */}
      <div className="max-w-[1600px] mx-auto px-4 pb-8">
        {loading ? (
          <div className="text-center py-20 text-gray-400">불러오는 중...</div>
        ) : error ? (
          <div className="text-center py-20 text-rose-500">{error}</div>
        ) : (
          <div className="bg-white rounded-xl border overflow-x-auto shadow-sm">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-gray-50 border-b">
                  {COLUMNS.map(col => {
                    const isAdmin = col.key === "csComment" || col.key === "dueDate" || col.key === "completed"
                    return (
                      <th
                        key={col.key}
                        className={`px-3 py-2.5 text-left font-semibold cursor-pointer hover:bg-gray-100 select-none ${col.width} ${isAdmin ? "bg-violet-50 text-violet-700" : "text-gray-600"}`}
                        onClick={() => handleSort(col.key)}
                      >
                        <div className="flex items-center gap-1">
                          {col.label}
                          {sortKey === col.key ? (
                            <ArrowUpDown size={12} className="text-blue-500" />
                          ) : (
                            <ArrowUpDown size={10} className={isAdmin ? "text-violet-300" : "text-gray-300"} />
                          )}
                        </div>
                      </th>
                    )
                  })}
                </tr>
              </thead>
              <tbody>
                {filteredRows.length === 0 ? (
                  <tr><td colSpan={COLUMNS.length} className="text-center py-12 text-gray-400">데이터 없음</td></tr>
                ) : (
                  filteredRows.map(row => (
                    <tr
                      key={row.id}
                      className="border-b hover:bg-blue-50/50 cursor-pointer transition-colors"
                      onClick={() => setSelectedRow(row)}
                    >
                      <td className="px-3 py-2.5 text-gray-400 font-mono">{row.no}</td>
                      <td className="px-3 py-2.5 text-gray-600 whitespace-nowrap">{row.date}</td>
                      <td className="px-3 py-2.5">
                        <div className="flex flex-col gap-0.5">
                          {row.authorType === "internal" && (
                            <span className="bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded text-[10px] font-bold w-fit">내부 개발팀</span>
                          )}
                          {row.authorType === "customer" && (
                            <span className="bg-green-100 text-green-700 px-1.5 py-0.5 rounded text-[10px] font-bold w-fit">고객사</span>
                          )}
                          {row.authorType === "anonymous" && (
                            <span className="bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded text-[10px] w-fit">익명</span>
                          )}
                          {row.department && (
                            <span className="text-[10px] text-gray-500">{row.department}</span>
                          )}
                        </div>
                      </td>
                      <td className="px-3 py-2.5 text-gray-700 font-medium">{row.author || <span className="text-gray-300">-</span>}</td>
                      <td className="px-3 py-2.5">
                        <span className="bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded text-[10px]">{row.questionType}</span>
                      </td>
                      <td className="px-3 py-2.5 text-gray-700 max-w-xs truncate" title={row.questionContent}>{row.questionContent || <span className="text-gray-300">-</span>}</td>
                      <td className="px-3 py-2.5 text-gray-500">{row.questionIntent || <span className="text-gray-300">-</span>}</td>
                      <td className="px-3 py-2.5 text-center"><AccuracyBadge value={row.accuracy} /></td>
                      <td className="px-3 py-2.5 text-center"><ScoreBadge value={row.qualityScore} /></td>
                      <td className="px-3 py-2.5">
                        {row.errorType ? (
                          <span className="bg-rose-50 text-rose-600 px-1.5 py-0.5 rounded text-[10px]">{row.errorType}</span>
                        ) : <span className="text-gray-300">-</span>}
                      </td>
                      <td className="px-3 py-2.5 text-gray-600 max-w-xs truncate" title={row.improvement}>{row.improvement || <span className="text-gray-300">-</span>}</td>
                      {/* 코너스톤 의견 */}
                      <td className="px-3 py-2.5" onClick={e => e.stopPropagation()}>
                        <input
                          type="text"
                          value={adminFields[row.id]?.csComment ?? ""}
                          onChange={e => updateAdminField(row.id, "csComment", e.target.value)}
                          placeholder="의견 입력..."
                          className="w-full px-2 py-1 text-xs border border-gray-200 rounded-md focus:outline-none focus:ring-1 focus:ring-violet-400 focus:border-violet-400 bg-violet-50/30 placeholder-gray-300"
                        />
                      </td>
                      {/* 예상 Due Date */}
                      <td className="px-3 py-2.5" onClick={e => e.stopPropagation()}>
                        <input
                          type="date"
                          value={adminFields[row.id]?.dueDate ?? ""}
                          onChange={e => updateAdminField(row.id, "dueDate", e.target.value)}
                          className="w-full px-2 py-1 text-xs border border-gray-200 rounded-md focus:outline-none focus:ring-1 focus:ring-violet-400 focus:border-violet-400 bg-violet-50/30"
                        />
                      </td>
                      {/* 완료 여부 */}
                      <td className="px-3 py-2.5 text-center" onClick={e => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          checked={adminFields[row.id]?.completed ?? false}
                          onChange={e => updateAdminField(row.id, "completed", e.target.checked)}
                          className="w-4 h-4 rounded border-gray-300 text-violet-600 focus:ring-violet-500 cursor-pointer"
                        />
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Detail modal */}
      {selectedRow && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setSelectedRow(null)}>
          <div className="bg-white rounded-2xl w-full max-w-2xl max-h-[85vh] overflow-y-auto shadow-2xl mx-4" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-6 py-4 border-b">
              <h3 className="font-bold text-gray-900">평가 #{selectedRow.no} 상세</h3>
              <button onClick={() => setSelectedRow(null)} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
            </div>
            <div className="px-6 py-4 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <div className="text-[10px] text-gray-400 mb-0.5">일자</div>
                  <div className="text-sm font-medium">{selectedRow.date}</div>
                </div>
                <div>
                  <div className="text-[10px] text-gray-400 mb-0.5">작성자</div>
                  <div className="text-sm font-medium">
                    {selectedRow.department && <span className="bg-blue-50 text-blue-700 px-1.5 py-0.5 rounded text-[10px] mr-1">{selectedRow.department}</span>}
                    {selectedRow.author || "익명"}
                  </div>
                </div>
                <div>
                  <div className="text-[10px] text-gray-400 mb-0.5">질문 유형</div>
                  <div className="text-sm">{selectedRow.questionType}</div>
                </div>
                <div>
                  <div className="text-[10px] text-gray-400 mb-0.5">질문 의도</div>
                  <div className="text-sm">{selectedRow.questionIntent || "-"}</div>
                </div>
                <div>
                  <div className="text-[10px] text-gray-400 mb-0.5">정확도</div>
                  <AccuracyBadge value={selectedRow.accuracy} />
                </div>
                <div>
                  <div className="text-[10px] text-gray-400 mb-0.5">품질 점수</div>
                  <div className="flex items-center gap-1">
                    <ScoreBadge value={selectedRow.qualityScore} />
                    {selectedRow.qualityScore != null && <span className="text-gray-400 text-xs">/ 5</span>}
                  </div>
                </div>
              </div>
              <div>
                <div className="text-[10px] text-gray-400 mb-1">질문 내용</div>
                <div className="text-sm bg-gray-50 rounded-lg p-3 whitespace-pre-wrap">{selectedRow.questionContent || "-"}</div>
              </div>
              {selectedRow.errorType && (
                <div>
                  <div className="text-[10px] text-gray-400 mb-1">오류 유형</div>
                  <span className="bg-rose-50 text-rose-600 px-2 py-1 rounded text-xs">{selectedRow.errorType}</span>
                </div>
              )}
              {selectedRow.improvement && (
                <div>
                  <div className="text-[10px] text-gray-400 mb-1">개선 필요사항</div>
                  <div className="text-sm bg-amber-50 rounded-lg p-3 whitespace-pre-wrap">{selectedRow.improvement}</div>
                </div>
              )}
              {selectedRow.tags.length > 0 && (
                <div>
                  <div className="text-[10px] text-gray-400 mb-1">태그</div>
                  <div className="flex flex-wrap gap-1">
                    {selectedRow.tags.map(tag => (
                      <span key={tag} className="bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full text-[10px]">{tag}</span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
