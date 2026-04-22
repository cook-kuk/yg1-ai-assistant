// SPDX-License-Identifier: MIT
// Simulator v3 매뉴얼·개념사전 다운로드 버튼
"use client"

import { useState, useRef, useEffect } from "react"
import { Download, ChevronDown, FileText, BookOpen } from "lucide-react"

const DOWNLOADS = [
  { href: "/docs/simulator-v3-manual.md", label: "사용 매뉴얼 (Markdown)", icon: FileText, kb: 12 },
  { href: "/docs/simulator-v3-manual.docx", label: "사용 매뉴얼 (Word)", icon: FileText, kb: 19 },
  { href: "/docs/simulator-v3-concepts.md", label: "개념 사전 112 entry (Markdown)", icon: BookOpen, kb: 162 },
  { href: "/docs/simulator-v3-concepts.docx", label: "개념 사전 112 entry (Word)", icon: BookOpen, kb: 83 },
]

export function ManualDownloadButton() {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener("mousedown", onClick)
    return () => document.removeEventListener("mousedown", onClick)
  }, [open])

  return (
    <div className="relative" ref={ref}>
      <button type="button" onClick={() => setOpen(o => !o)}
        className="inline-flex items-center gap-1.5 rounded-lg border border-blue-300 bg-blue-50 px-3 py-1.5 text-xs font-semibold text-blue-800 hover:bg-blue-100">
        <Download className="h-3.5 w-3.5" />
        📥 매뉴얼 다운로드
        <ChevronDown className={`h-3 w-3 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 z-50 w-72 rounded-lg border border-blue-200 bg-white dark:bg-slate-900 shadow-xl p-1">
          <div className="px-3 py-2 text-[10px] text-gray-500 dark:text-slate-400 border-b border-gray-100 dark:border-slate-800">
            사용법 + 112 CNC 용어 사전 · Sandvik/Harvey 출처 포함
          </div>
          {DOWNLOADS.map(d => (
            <a key={d.href} href={d.href} download
              className="flex items-center gap-2 px-3 py-2 text-xs text-gray-700 dark:text-slate-200 hover:bg-blue-50 dark:hover:bg-slate-800 rounded">
              <d.icon className="h-4 w-4 text-blue-600 flex-shrink-0" />
              <span className="flex-1">{d.label}</span>
              <span className="text-[10px] text-gray-400 dark:text-slate-500 font-mono">{d.kb}KB</span>
            </a>
          ))}
        </div>
      )}
    </div>
  )
}
