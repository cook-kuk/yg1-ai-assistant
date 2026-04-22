// SPDX-License-Identifier: MIT
// Interactive GCode Viewer — 파라미터 변경 시 실시간 diff highlight + 라인별 설명
"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { Copy, Check, Info } from "lucide-react"
import { copyText } from "./clipboard-util"
import { toast } from "sonner"

export interface InteractiveGcodeViewerProps {
  /** generateGCode()로 이미 생성된 텍스트 */
  gcode: string
  /** 현재 파라미터 — 변경 감지용 */
  params: {
    n: number
    Vf: number
    Vc: number
    fz: number
    ap: number
    ae: number
    D: number
    dialect: "fanuc" | "heidenhain" | "siemens"
  }
  darkMode?: boolean
}

/**
 * G-code 한 줄을 파싱해서 주요 단어 + 설명 반환
 * 예: "G00 X0. Y0. S8218 M03" → { cmd: "G00", desc: "급속이송", tokens: [...] }
 */
function annotateLine(line: string): {
  cmdType: "motion" | "spindle" | "coolant" | "feed" | "tool" | "comment" | "header" | "plain"
  desc: string
  tokens: Array<{ text: string; meaning?: string }>
} {
  const trimmed = line.trim()
  if (!trimmed) return { cmdType: "plain", desc: "", tokens: [{ text: line }] }

  // Comment (Fanuc: `( ... )`, Siemens/HDH: `; ...`)
  if (trimmed.startsWith("(") || trimmed.startsWith(";")) {
    return { cmdType: "comment", desc: "주석 · 가공자 메모", tokens: [{ text: line }] }
  }
  // Header keywords
  if (/BEGIN PGM|END PGM|^%$|^O\d+|M30|M02/.test(trimmed)) {
    return { cmdType: "header", desc: "프로그램 경계 (시작/종료)", tokens: [{ text: line }] }
  }

  // 공통 토큰 파서 (매우 간단)
  const tokens: Array<{ text: string; meaning?: string }> = []
  const parts = line.split(/(\s+)/)
  let cmdType: "motion" | "spindle" | "coolant" | "feed" | "tool" | "comment" | "header" | "plain" = "plain"
  let desc = ""

  for (const p of parts) {
    if (/^G0[01]$|^G00$|^G01$/.test(p)) {
      tokens.push({ text: p, meaning: p === "G00" ? "급속이송 (non-cutting)" : "직선절삭 (G01)" })
      cmdType = "motion"
      desc = p === "G00" ? "급속 위치 이동" : "절삭 이송"
    } else if (/^G02$|^G03$/.test(p)) {
      tokens.push({ text: p, meaning: p === "G02" ? "시계 원호" : "반시계 원호" })
      cmdType = "motion"
      desc = "원호 절삭"
    } else if (/^M0[38]|^M03|^M04|^M05/.test(p)) {
      tokens.push({ text: p, meaning: p === "M03" ? "스핀들 정회전" : p === "M04" ? "역회전" : "정지" })
      cmdType = "spindle"
      desc = "스핀들 제어"
    } else if (/^M0[789]|^M08|^M09/.test(p)) {
      tokens.push({ text: p, meaning: p === "M08" ? "쿨런트 ON" : "쿨런트 OFF" })
      cmdType = "coolant"
      desc = "쿨런트 제어"
    } else if (/^S\d+/.test(p)) {
      tokens.push({ text: p, meaning: `스핀들 속도 ${p.slice(1)} RPM` })
      if (!cmdType || cmdType === "plain") cmdType = "spindle"
    } else if (/^F[\d.]+/.test(p)) {
      tokens.push({ text: p, meaning: `이송 ${p.slice(1)} mm/min (Vf)` })
      if (!cmdType || cmdType === "plain") cmdType = "feed"
    } else if (/^T\d+/.test(p)) {
      tokens.push({ text: p, meaning: `공구 번호 ${p.slice(1)}` })
      cmdType = "tool"
    } else if (/^[XYZIJK][+-]?[\d.]+/.test(p)) {
      const axis = p[0]
      const val = p.slice(1)
      tokens.push({ text: p, meaning: `${axis}축 좌표 ${val}mm` })
    } else if (p.trim() === "") {
      tokens.push({ text: p })
    } else {
      tokens.push({ text: p })
    }
  }
  if (!desc) desc = "보조 명령"
  return { cmdType, desc, tokens }
}

const CMD_COLORS: Record<string, string> = {
  motion: "text-emerald-400 dark:text-emerald-300",
  spindle: "text-sky-400 dark:text-sky-300",
  coolant: "text-cyan-400 dark:text-cyan-300",
  feed: "text-amber-400 dark:text-amber-300",
  tool: "text-violet-400 dark:text-violet-300",
  comment: "text-slate-500 dark:text-slate-500",
  header: "text-rose-400 dark:text-rose-300 font-bold",
  plain: "text-green-400 dark:text-green-400",
}

export default function InteractiveGcodeViewer({
  gcode,
  params,
  darkMode,
}: InteractiveGcodeViewerProps) {
  const lines = useMemo(() => gcode.split("\n"), [gcode])
  const annotated = useMemo(() => lines.map(annotateLine), [lines])

  // 변화 감지
  const prevGcodeRef = useRef<string>("")
  const [changedLines, setChangedLines] = useState<Set<number>>(new Set())
  const [copiedLine, setCopiedLine] = useState<number | null>(null)
  const [updateCount, setUpdateCount] = useState(0)
  const [lastUpdateTs, setLastUpdateTs] = useState(Date.now())
  const [hoveredToken, setHoveredToken] = useState<{ line: number; idx: number } | null>(null)

  useEffect(() => {
    if (prevGcodeRef.current && prevGcodeRef.current !== gcode) {
      const prevLines = prevGcodeRef.current.split("\n")
      const diff = new Set<number>()
      lines.forEach((line, i) => {
        if (line !== prevLines[i]) diff.add(i)
      })
      setChangedLines(diff)
      setUpdateCount(c => c + 1)
      setLastUpdateTs(Date.now())
      const t = setTimeout(() => setChangedLines(new Set()), 1500)
      return () => clearTimeout(t)
    }
    prevGcodeRef.current = gcode
  }, [gcode, lines])

  const copyLine = async (idx: number, line: string) => {
    const ok = await copyText(line)
    if (ok) {
      setCopiedLine(idx)
      setTimeout(() => setCopiedLine(null), 1200)
      toast.success("라인 복사됨")
    }
  }

  const elapsed = Math.floor((Date.now() - lastUpdateTs) / 1000)

  return (
    <div className={`rounded-lg border overflow-hidden ${darkMode ? "border-slate-700 bg-slate-950" : "border-slate-700 bg-slate-950"}`}>
      {/* 상단 메타바 */}
      <div className="flex items-center justify-between px-3 py-1.5 bg-slate-900 border-b border-slate-800 text-[10px]">
        <div className="flex items-center gap-2 text-slate-400">
          <span className="flex items-center gap-1">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
            <span className="text-emerald-400 font-semibold tracking-wider uppercase">LIVE</span>
          </span>
          <span className="text-slate-600">|</span>
          <span>{params.dialect.toUpperCase()}</span>
          <span className="text-slate-600">|</span>
          <span className="font-mono">{lines.length} 라인</span>
          <span className="text-slate-600">|</span>
          <span>업데이트 #{updateCount}</span>
        </div>
        <div className="flex items-center gap-2 text-slate-500">
          <span>n={params.n}rpm · F={Math.round(params.Vf)}</span>
          <button
            onClick={async () => {
              const ok = await copyText(gcode)
              if (ok) toast.success("전체 G-code 복사됨")
            }}
            className="inline-flex items-center gap-1 rounded bg-emerald-600 px-2 py-0.5 text-white font-semibold hover:bg-emerald-500 transition"
          >
            <Copy className="h-2.5 w-2.5" /> 전체 복사
          </button>
        </div>
      </div>

      {/* 변경 알림 배너 */}
      <AnimatePresence>
        {changedLines.size > 0 && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="bg-gradient-to-r from-amber-500/20 via-orange-500/20 to-amber-500/20 border-b border-amber-600/40 px-3 py-1 text-[10px] text-amber-200"
          >
            🔄 파라미터 변경 감지 · {changedLines.size} 라인 업데이트
          </motion.div>
        )}
      </AnimatePresence>

      {/* G-code 본문 */}
      <div className="max-h-[480px] overflow-y-auto overflow-x-auto font-mono text-[11px] leading-relaxed py-2">
        {annotated.map((ann, i) => {
          const line = lines[i]
          const isChanged = changedLines.has(i)
          const isHovered = hoveredToken?.line === i
          const lineNum = String(i + 1).padStart(3, " ")
          return (
            <div
              key={i}
              className={`group relative flex items-start gap-2 px-3 py-0.5 transition-all ${
                isChanged ? "bg-amber-500/20" : isHovered ? "bg-slate-800/50" : "hover:bg-slate-800/30"
              }`}
              onMouseEnter={() => setHoveredToken({ line: i, idx: 0 })}
              onMouseLeave={() => setHoveredToken(null)}
            >
              {/* 라인 번호 */}
              <span className="select-none text-slate-600 flex-shrink-0 w-8 tabular-nums text-right">
                {lineNum}
              </span>
              {/* 라인 내용 */}
              <span className={`flex-1 ${CMD_COLORS[ann.cmdType]} whitespace-pre break-all`}>
                {ann.tokens.map((tok, ti) => (
                  tok.meaning ? (
                    <span
                      key={ti}
                      title={tok.meaning}
                      className="relative border-b border-dotted border-current/40 cursor-help"
                    >
                      {tok.text}
                    </span>
                  ) : (
                    <span key={ti}>{tok.text}</span>
                  )
                ))}
              </span>
              {/* 설명 (hover 시만) */}
              {ann.desc && isHovered && !ann.desc.includes("주석") && (
                <span className="text-[9px] text-slate-500 italic flex-shrink-0 pr-1">{ann.desc}</span>
              )}
              {/* Copy 버튼 (hover 시) */}
              <button
                onClick={() => copyLine(i, line)}
                aria-label={`라인 ${i + 1} 복사`}
                className={`opacity-0 group-hover:opacity-100 transition flex-shrink-0 rounded p-0.5 ${
                  copiedLine === i ? "text-emerald-400" : "text-slate-500 hover:text-slate-200"
                }`}
              >
                {copiedLine === i ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
              </button>
            </div>
          )
        })}
      </div>

      {/* 푸터 범례 */}
      <div className={`px-3 py-1.5 bg-slate-900 border-t border-slate-800 text-[9px] text-slate-500 flex flex-wrap items-center gap-3`}>
        <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 bg-emerald-400 rounded-full" /> 이송(G00/G01)</span>
        <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 bg-sky-400 rounded-full" /> 스핀들(M03/S)</span>
        <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 bg-amber-400 rounded-full" /> 이송속도(F)</span>
        <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 bg-cyan-400 rounded-full" /> 쿨런트(M08/09)</span>
        <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 bg-violet-400 rounded-full" /> 공구(T)</span>
        <span className="ml-auto flex items-center gap-1">
          <Info className="h-2.5 w-2.5" /> 단어에 밑줄 있으면 hover로 의미 확인
        </span>
      </div>
    </div>
  )
}
