// SPDX-License-Identifier: MIT
// YG-1 ARIA Simulator v3 — 세션 내보내기 (JSON / Excel / Clipboard)
// 영업 proposal 작성용: 현재 세션 (조건 + 결과 + 스냅샷 A/B/C/D + 경고)을 파일로 저장.
"use client"

import { useState, useRef, useEffect, useCallback } from "react"
import { Package, ChevronDown, FileJson, FileSpreadsheet, ClipboardCopy, Check } from "lucide-react"
import * as XLSX from "xlsx"
import { copyText } from "./clipboard-util"

// ─────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────

export interface SessionExportState {
  productCode: string
  isoGroup: string
  operation: string
  diameter: number
  fluteCount: number
  activeShape: string
  Vc: number
  fz: number
  ap: number
  ae: number
}

export interface SessionExportResults {
  n: number
  Vf: number
  MRR: number
  Pc: number
  torque: number
  deflection: number
  toolLifeMin: number
  Ra: number
  chatterRisk: number
}

export interface SessionExportSnapshot {
  label: string
  Vc: number
  fz: number
  ap: number
  ae: number
  n: number
  Vf: number
  MRR: number
  Pc: number
}

export interface SessionExportWarning {
  level: string
  message: string
}

export interface SessionExportProps {
  state: SessionExportState
  results: SessionExportResults
  snapshots: Array<SessionExportSnapshot | null>
  warnings: SessionExportWarning[]
  darkMode?: boolean
}

// ─────────────────────────────────────────────────────────────────────
// 내부 유틸
// ─────────────────────────────────────────────────────────────────────

function timestamp(): string {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, "0")
  return (
    d.getFullYear().toString() +
    pad(d.getMonth() + 1) +
    pad(d.getDate()) +
    "-" +
    pad(d.getHours()) +
    pad(d.getMinutes()) +
    pad(d.getSeconds())
  )
}

function buildSessionObject(props: SessionExportProps) {
  return {
    exportedAt: new Date().toISOString(),
    source: "YG-1 ARIA Simulator v3",
    state: props.state,
    results: props.results,
    snapshots: props.snapshots,
    warnings: props.warnings,
  }
}

function triggerDownload(blob: Blob, filename: string) {
  if (typeof window === "undefined") return
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  // 다음 tick 에 revoke (Safari/Firefox 안전)
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

// ─────────────────────────────────────────────────────────────────────
// Exporters
// ─────────────────────────────────────────────────────────────────────

function exportJson(props: SessionExportProps): void {
  const payload = buildSessionObject(props)
  const json = JSON.stringify(payload, null, 2)
  const blob = new Blob([json], { type: "application/json;charset=utf-8" })
  triggerDownload(blob, `yg1-sim-${timestamp()}.json`)
}

function exportExcel(props: SessionExportProps): void {
  const wb = XLSX.utils.book_new()

  // Sheet 1 — 시뮬 조건
  const stateRows = [
    ["항목", "값"],
    ["제품 코드", props.state.productCode],
    ["ISO 군", props.state.isoGroup],
    ["가공 오퍼레이션", props.state.operation],
    ["공구 지름 (mm)", props.state.diameter],
    ["날수", props.state.fluteCount],
    ["형상", props.state.activeShape],
    ["절삭속도 Vc (m/min)", props.state.Vc],
    ["날당이송 fz (mm/tooth)", props.state.fz],
    ["축방향 절입 ap (mm)", props.state.ap],
    ["반경방향 절입 ae (mm)", props.state.ae],
  ]
  const wsState = XLSX.utils.aoa_to_sheet(stateRows)
  wsState["!cols"] = [{ wch: 26 }, { wch: 28 }]
  XLSX.utils.book_append_sheet(wb, wsState, "시뮬 조건")

  // Sheet 2 — 결과 지표
  const resultRows = [
    ["지표", "값", "단위"],
    ["회전수 n", props.results.n, "rpm"],
    ["이송속도 Vf", props.results.Vf, "mm/min"],
    ["MRR", props.results.MRR, "cm³/min"],
    ["절삭동력 Pc", props.results.Pc, "kW"],
    ["토크", props.results.torque, "N·m"],
    ["공구 편향 deflection", props.results.deflection, "mm"],
    ["공구 수명", props.results.toolLifeMin, "min"],
    ["표면거칠기 Ra", props.results.Ra, "µm"],
    ["채터 리스크", props.results.chatterRisk, "0-1"],
  ]
  const wsResults = XLSX.utils.aoa_to_sheet(resultRows)
  wsResults["!cols"] = [{ wch: 22 }, { wch: 14 }, { wch: 12 }]
  XLSX.utils.book_append_sheet(wb, wsResults, "결과 지표")

  // Sheet 3 — 스냅샷 A/B/C/D 나란히
  const snapHeader: Array<string | number> = ["항목"]
  for (const s of props.snapshots) snapHeader.push(s ? s.label : "—")
  const pick = (s: SessionExportSnapshot | null, key: keyof SessionExportSnapshot): string | number => {
    if (!s) return "—"
    const v = s[key]
    return typeof v === "number" || typeof v === "string" ? v : "—"
  }
  const snapRows: Array<Array<string | number>> = [
    snapHeader,
    ["Vc (m/min)", ...props.snapshots.map(s => pick(s, "Vc"))],
    ["fz (mm/tooth)", ...props.snapshots.map(s => pick(s, "fz"))],
    ["ap (mm)", ...props.snapshots.map(s => pick(s, "ap"))],
    ["ae (mm)", ...props.snapshots.map(s => pick(s, "ae"))],
    ["n (rpm)", ...props.snapshots.map(s => pick(s, "n"))],
    ["Vf (mm/min)", ...props.snapshots.map(s => pick(s, "Vf"))],
    ["MRR (cm³/min)", ...props.snapshots.map(s => pick(s, "MRR"))],
    ["Pc (kW)", ...props.snapshots.map(s => pick(s, "Pc"))],
  ]
  const wsSnap = XLSX.utils.aoa_to_sheet(snapRows)
  wsSnap["!cols"] = [
    { wch: 18 },
    ...props.snapshots.map(() => ({ wch: 14 })),
  ]
  XLSX.utils.book_append_sheet(wb, wsSnap, "스냅샷")

  // Sheet 4 — 경고
  const warnRows: Array<Array<string | number>> = [["#", "레벨", "메시지"]]
  if (props.warnings.length === 0) {
    warnRows.push([1, "info", "경고 없음"])
  } else {
    props.warnings.forEach((w, i) => warnRows.push([i + 1, w.level, w.message]))
  }
  const wsWarn = XLSX.utils.aoa_to_sheet(warnRows)
  wsWarn["!cols"] = [{ wch: 4 }, { wch: 10 }, { wch: 70 }]
  XLSX.utils.book_append_sheet(wb, wsWarn, "경고")

  // Write & download
  const buf = XLSX.write(wb, { bookType: "xlsx", type: "array" }) as ArrayBuffer
  const blob = new Blob([buf], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  })
  triggerDownload(blob, `yg1-sim-${timestamp()}.xlsx`)
}

async function exportClipboard(props: SessionExportProps): Promise<boolean> {
  const payload = buildSessionObject(props)
  return copyText(JSON.stringify(payload, null, 2))
}

// ─────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────

export default function SessionExport(props: SessionExportProps) {
  const { darkMode = false } = props
  const [open, setOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener("mousedown", onClick)
    return () => document.removeEventListener("mousedown", onClick)
  }, [open])

  const handleJson = useCallback(() => {
    exportJson(props)
    setOpen(false)
  }, [props])

  const handleExcel = useCallback(() => {
    exportExcel(props)
    setOpen(false)
  }, [props])

  const handleClipboard = useCallback(async () => {
    const ok = await exportClipboard(props)
    if (ok) {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    }
    setOpen(false)
  }, [props])

  const btnClass = darkMode
    ? "inline-flex items-center gap-1.5 rounded-lg border border-indigo-700 bg-indigo-900/40 px-3 py-1.5 text-xs font-semibold text-indigo-200 hover:bg-indigo-900/60"
    : "inline-flex items-center gap-1.5 rounded-lg border border-indigo-300 bg-indigo-50 px-3 py-1.5 text-xs font-semibold text-indigo-800 hover:bg-indigo-100"

  const menuClass = darkMode
    ? "absolute right-0 top-full mt-1 z-50 w-64 rounded-lg border border-indigo-700 bg-slate-900 shadow-xl p-1"
    : "absolute right-0 top-full mt-1 z-50 w-64 rounded-lg border border-indigo-200 bg-white shadow-xl p-1"

  const headerClass = darkMode
    ? "px-3 py-2 text-[10px] text-slate-400 border-b border-slate-800"
    : "px-3 py-2 text-[10px] text-gray-500 border-b border-gray-100"

  const itemClass = darkMode
    ? "flex items-center gap-2 px-3 py-2 text-xs text-slate-200 hover:bg-slate-800 rounded w-full text-left"
    : "flex items-center gap-2 px-3 py-2 text-xs text-gray-700 hover:bg-indigo-50 rounded w-full text-left"

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className={btnClass}
        aria-haspopup="menu"
        aria-expanded={open}
        title="현재 세션을 JSON/Excel 파일로 내보내기"
      >
        <Package className="h-3.5 w-3.5" />
        📦 내보내기
        <ChevronDown className={`h-3 w-3 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div className={menuClass} role="menu">
          <div className={headerClass}>
            현재 시뮬 조건 + 결과 + 스냅샷 + 경고
          </div>

          <button type="button" onClick={handleJson} className={itemClass} role="menuitem">
            <FileJson className="h-4 w-4 text-blue-600 flex-shrink-0" />
            <span className="flex-1">📄 JSON 다운로드</span>
            <span className={darkMode ? "text-[10px] text-slate-500 font-mono" : "text-[10px] text-gray-400 font-mono"}>
              .json
            </span>
          </button>

          <button type="button" onClick={handleExcel} className={itemClass} role="menuitem">
            <FileSpreadsheet className="h-4 w-4 text-emerald-600 flex-shrink-0" />
            <span className="flex-1">📊 Excel 다운로드</span>
            <span className={darkMode ? "text-[10px] text-slate-500 font-mono" : "text-[10px] text-gray-400 font-mono"}>
              .xlsx
            </span>
          </button>

          <button type="button" onClick={handleClipboard} className={itemClass} role="menuitem">
            {copied ? (
              <Check className="h-4 w-4 text-emerald-500 flex-shrink-0" />
            ) : (
              <ClipboardCopy className="h-4 w-4 text-indigo-600 flex-shrink-0" />
            )}
            <span className="flex-1">📋 클립보드 복사 (JSON)</span>
            <span className={darkMode ? "text-[10px] text-slate-500 font-mono" : "text-[10px] text-gray-400 font-mono"}>
              {copied ? "✓" : "json"}
            </span>
          </button>
        </div>
      )}
    </div>
  )
}
