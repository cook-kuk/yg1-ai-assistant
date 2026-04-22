// SPDX-License-Identifier: MIT
// YG-1 ARIA Simulator v3 — STEP 5-3 PDF Report Generator
// jsPDF + html2canvas + qrcode. 1페이지 요약, 2페이지 공식 유도, 3페이지 G-Code, 4페이지 교육(옵션).
// 모든 외부 라이브러리는 dynamic import로 chunk 분리.
"use client"

import type { SimWarning } from "../cutting-calculator"

// ── Public Types ────────────────────────────────────────────────────
export interface SimulatorStateLike {
  // Tool
  seriesOrProduct?: string
  edp?: string
  diameter: number
  fluteCount: number
  shape?: string
  LOC?: number
  OAL?: number
  cornerR?: number

  // Material
  isoGroup: string
  subgroupKey?: string
  condition?: string
  hardnessScale?: string
  hardnessValue?: number
  workpiece?: string

  // Operation
  operation: string
  toolPath: string
  strategy?: string

  // Machine
  spindleKey?: string
  holderKey?: string
  maxRpm?: number
  maxKw?: number
  workholding?: number

  // Parameters
  stickoutMm?: number
  Vc: number
  fz: number
  ap: number
  ae: number

  // Process
  coolant?: string
  coating?: string
}

export interface SimulatorResultsLike {
  n: number
  Vf: number
  MRR: number
  Pc: number
  Fc: number
  deflection: number
  toolLife?: number
  raUm?: number
  chatterRisk?: "low" | "medium" | "high" | string
}

export interface GenerateReportParams {
  state: SimulatorStateLike
  results: SimulatorResultsLike
  warnings: SimWarning[]
  url: string
  educationMode: boolean
  filename?: string
}

// ── Utils ──────────────────────────────────────────────────────────
function nz(v: unknown, fallback = "—"): string {
  if (v === undefined || v === null || v === "") return fallback
  if (typeof v === "number") return Number.isFinite(v) ? v.toString() : fallback
  return String(v)
}

function fmtNum(v: number | undefined, digits = 1): string {
  if (v === undefined || !Number.isFinite(v)) return "—"
  return v.toFixed(digits)
}

function warningIcon(level: SimWarning["level"]): { text: string; color: [number, number, number] } {
  if (level === "error") return { text: "[ERROR]", color: [220, 38, 38] }
  if (level === "warn") return { text: "[WARN] ", color: [217, 119, 6] }
  return { text: "[INFO] ", color: [37, 99, 235] }
}

// ── QR code 생성 → dataURL ─────────────────────────────────────────
async function generateQrDataUrl(url: string, sizePx = 300): Promise<string> {
  const QR = await import("qrcode")
  return QR.toDataURL(url, {
    width: sizePx,
    margin: 1,
    errorCorrectionLevel: "M",
    color: { dark: "#000000", light: "#ffffff" },
  })
}

// ── G-Code 생성 (Fanuc 기준) ─────────────────────────────────────
function buildFanucSnippet(state: SimulatorStateLike, results: SimulatorResultsLike): string {
  const nRounded = Math.round(results.n)
  const fRounded = Math.round(results.Vf)
  const toolNo = 1
  const cc = "M08"
  return [
    `( FANUC / HAAS )`,
    `( D=${fmtNum(state.diameter, 2)}mm  ap=${fmtNum(state.ap, 2)}mm  ae=${fmtNum(state.ae, 2)}mm  fz=${fmtNum(state.fz, 4)}mm/tooth )`,
    `O0001`,
    `G21 G17 G40 G49 G80 G90`,
    `T${toolNo.toString().padStart(2, "0")} M06`,
    `G54 G00 X0. Y0. S${nRounded} M03`,
    `G43 Z50. H${toolNo.toString().padStart(2, "0")} ${cc}`,
    `G01 Z-${fmtNum(state.ap, 3)} F${fRounded}.`,
    `( ... 가공 경로 ... )`,
    `G00 Z100. M09`,
    `M05`,
    `M30`,
    `%`,
  ].join("\n")
}

// ── 교육 요약 블록 (4페이지) ───────────────────────────────────
function educationSummary(state: SimulatorStateLike): Array<{ term: string; desc: string }> {
  return [
    { term: "Vc (절삭속도)", desc: `공구 날 끝에서의 원주 속도. 현재 ${fmtNum(state.Vc, 0)} m/min.` },
    { term: "fz (칩 부하)", desc: `날 1개당 이송량. 현재 ${fmtNum(state.fz, 4)} mm/tooth.` },
    { term: "ap (ADOC, 축방향 깊이)", desc: `Z방향 절입. 현재 ${fmtNum(state.ap, 2)} mm = ${fmtNum(state.ap / state.diameter, 2)}·D.` },
    { term: "ae (RDOC, 반경방향 폭)", desc: `XY평면 스텝오버. 현재 ${fmtNum(state.ae, 2)} mm = ${fmtNum(state.ae / state.diameter, 2)}·D.` },
    { term: "Tool Path", desc: `현재 ${state.toolPath}. 경로 선택에 따라 권장 ap/ae 비율이 달라집니다.` },
    { term: "Workholding", desc: `고정 강성 ${fmtNum(state.workholding, 0)}% — ap·ae 허용 한계에 직접 영향.` },
    { term: "ISO 재질군", desc: `${state.isoGroup} (${state.subgroupKey ?? "—"}) / 경도 ${state.hardnessValue ?? "—"} ${state.hardnessScale ?? ""}.` },
    { term: "Coating / Coolant", desc: `${state.coating ?? "—"} · ${state.coolant ?? "—"} — Vc 한계에 영향.` },
  ]
}

// ── 메인 엔트리 ─────────────────────────────────────────────────
export async function generateReportPDF(params: GenerateReportParams): Promise<void> {
  const { state, results, warnings, url, educationMode, filename } = params

  // dynamic imports
  const [{ jsPDF }, qrDataUrl] = await Promise.all([
    import("jspdf"),
    generateQrDataUrl(url, 300),
  ])

  const pdf = new jsPDF("p", "mm", "a4")
  const pageW = pdf.internal.pageSize.getWidth()
  const pageH = pdf.internal.pageSize.getHeight()
  const margin = 12
  let y = margin

  // Helper: 새 페이지
  const newPage = () => {
    pdf.addPage()
    y = margin
  }

  // Helper: 텍스트
  const text = (s: string, x: number, yPos: number, opts?: { bold?: boolean; size?: number; color?: [number, number, number] }) => {
    if (opts?.bold) pdf.setFont("helvetica", "bold")
    else pdf.setFont("helvetica", "normal")
    if (opts?.size) pdf.setFontSize(opts.size)
    if (opts?.color) pdf.setTextColor(opts.color[0], opts.color[1], opts.color[2])
    else pdf.setTextColor(20, 20, 20)
    pdf.text(s, x, yPos)
  }

  // Helper: 라인
  const hr = (yPos: number) => {
    pdf.setDrawColor(200, 200, 200)
    pdf.setLineWidth(0.2)
    pdf.line(margin, yPos, pageW - margin, yPos)
  }

  // ═══════════════════════════════════════════════════════════════
  // PAGE 1: 요약
  // ═══════════════════════════════════════════════════════════════
  pdf.setFillColor(30, 58, 138)
  pdf.rect(0, 0, pageW, 18, "F")
  text("YG-1 ARIA Simulator v3 — 절삭 조건 리포트", margin, 11, {
    bold: true,
    size: 13,
    color: [255, 255, 255],
  })
  const dateStr = new Date().toISOString().slice(0, 19).replace("T", " ")
  pdf.setFontSize(8)
  pdf.setTextColor(200, 220, 255)
  pdf.text(dateStr, pageW - margin, 11, { align: "right" })

  y = 26

  // QR 코드 (우상단, 3cm × 3cm)
  const qrSize = 30
  pdf.addImage(qrDataUrl, "PNG", pageW - margin - qrSize, y, qrSize, qrSize)
  pdf.setFontSize(7)
  pdf.setTextColor(100, 100, 100)
  pdf.text("이 조건 공유 URL", pageW - margin - qrSize / 2, y + qrSize + 3, { align: "center" })

  // 섹션 1: 공구
  text("■ 공구 (Tool)", margin, y, { bold: true, size: 11 })
  y += 5
  pdf.setFontSize(9)
  pdf.setTextColor(60, 60, 60)
  const toolLines = [
    `Series/EDP: ${nz(state.seriesOrProduct)} / ${nz(state.edp)}`,
    `Diameter D: ${fmtNum(state.diameter, 2)} mm    Flutes Z: ${nz(state.fluteCount)}`,
    `Shape: ${nz(state.shape)}    LOC: ${nz(state.LOC)} mm    OAL: ${nz(state.OAL)} mm    Corner R: ${nz(state.cornerR)}`,
  ]
  toolLines.forEach((l) => {
    pdf.text(l, margin, y)
    y += 4.5
  })

  y += 2
  hr(y)
  y += 3

  // 섹션 2: 재질
  text("■ 재질 (Material)", margin, y, { bold: true, size: 11 })
  y += 5
  pdf.setFontSize(9)
  pdf.setTextColor(60, 60, 60)
  const matLines = [
    `ISO ${state.isoGroup} · ${nz(state.subgroupKey)}    조건: ${nz(state.condition)}`,
    `경도: ${fmtNum(state.hardnessValue, 0)} ${nz(state.hardnessScale)}    Workpiece: ${nz(state.workpiece)}`,
  ]
  matLines.forEach((l) => {
    pdf.text(l, margin, y)
    y += 4.5
  })

  y += 2
  hr(y)
  y += 3

  // 섹션 3: 가공 유형
  text("■ 가공 (Operation)", margin, y, { bold: true, size: 11 })
  y += 5
  pdf.setFontSize(9)
  pdf.setTextColor(60, 60, 60)
  pdf.text(`Operation: ${nz(state.operation)}    Tool Path: ${nz(state.toolPath)}    Strategy: ${nz(state.strategy)}`, margin, y)
  y += 4.5
  pdf.text(`Coolant: ${nz(state.coolant)}    Coating: ${nz(state.coating)}    Holder: ${nz(state.holderKey)}    Spindle: ${nz(state.spindleKey)}`, margin, y)
  y += 6

  hr(y)
  y += 3

  // 섹션 4: 최종 결과 (큰 박스)
  text("■ 최종 절삭 조건 (Final Parameters)", margin, y, { bold: true, size: 11 })
  y += 5

  const boxH = 28
  pdf.setFillColor(239, 246, 255)
  pdf.setDrawColor(147, 197, 253)
  pdf.roundedRect(margin, y, pageW - margin * 2, boxH, 2, 2, "FD")

  const col1X = margin + 4
  const col2X = margin + 55
  const col3X = margin + 110
  const col4X = margin + 150
  const rowY1 = y + 6
  const rowY2 = y + 15
  const rowY3 = y + 24

  pdf.setFont("helvetica", "bold")
  pdf.setFontSize(10)
  pdf.setTextColor(30, 64, 175)

  pdf.text(`Vc = ${fmtNum(state.Vc, 0)} m/min`, col1X, rowY1)
  pdf.text(`n = ${fmtNum(results.n, 0)} RPM`, col2X, rowY1)
  pdf.text(`Vf = ${fmtNum(results.Vf, 0)} mm/min`, col3X, rowY1)

  pdf.text(`fz = ${fmtNum(state.fz, 4)} mm/tooth`, col1X, rowY2)
  pdf.text(`ap = ${fmtNum(state.ap, 2)} mm`, col2X, rowY2)
  pdf.text(`ae = ${fmtNum(state.ae, 2)} mm`, col3X, rowY2)

  pdf.text(`MRR = ${fmtNum(results.MRR, 2)} cm³/min`, col1X, rowY3)
  pdf.text(`Pc = ${fmtNum(results.Pc, 2)} kW`, col2X, rowY3)
  pdf.text(`Fc = ${fmtNum(results.Fc, 0)} N`, col3X, rowY3)

  // 컬럼 4: chatter risk + life
  pdf.setFont("helvetica", "normal")
  pdf.setFontSize(8)
  pdf.setTextColor(60, 60, 60)
  pdf.text(`Deflection: ${fmtNum(results.deflection, 1)} μm`, col4X, rowY1)
  pdf.text(`Tool life: ${fmtNum(results.toolLife, 0)} min`, col4X, rowY2)
  pdf.text(`Ra: ${fmtNum(results.raUm, 2)} μm · Chatter: ${nz(results.chatterRisk)}`, col4X, rowY3)

  y += boxH + 6

  // 섹션 5: 경고 레벨 아이콘
  text("■ 경고 요약 (Warnings)", margin, y, { bold: true, size: 11 })
  y += 5
  pdf.setFontSize(9)
  if (warnings.length === 0) {
    pdf.setTextColor(34, 139, 34)
    pdf.text("[OK] 경고 없음", margin, y)
    y += 5
  } else {
    warnings.slice(0, 10).forEach((w) => {
      const ic = warningIcon(w.level)
      pdf.setTextColor(ic.color[0], ic.color[1], ic.color[2])
      pdf.setFont("helvetica", "bold")
      pdf.text(ic.text, margin, y)
      pdf.setFont("helvetica", "normal")
      pdf.setTextColor(60, 60, 60)
      const lines = pdf.splitTextToSize(w.message, pageW - margin * 2 - 20)
      pdf.text(lines, margin + 18, y)
      y += 4.5 * Math.max(1, lines.length)
      if (y > pageH - 15) {
        newPage()
      }
    })
    if (warnings.length > 10) {
      pdf.setTextColor(120, 120, 120)
      pdf.text(`... 외 ${warnings.length - 10}건`, margin, y)
      y += 5
    }
  }

  // Footer
  pdf.setFontSize(7)
  pdf.setTextColor(150, 150, 150)
  pdf.text("Generated by YG-1 ARIA Simulator v3 · Reference only", margin, pageH - 6)
  pdf.text("Page 1 / " + (educationMode ? "4" : "3"), pageW - margin, pageH - 6, { align: "right" })

  // ═══════════════════════════════════════════════════════════════
  // PAGE 2: 공식 단계별 유도
  // ═══════════════════════════════════════════════════════════════
  newPage()
  pdf.setFillColor(30, 58, 138)
  pdf.rect(0, 0, pageW, 14, "F")
  text("공식 유도 (Formula Derivation)", margin, 9, { bold: true, size: 11, color: [255, 255, 255] })

  y = 22

  // (1) RPM
  text("1. 주축 회전수 n = 1000 · Vc / (π · D)", margin, y, { bold: true, size: 10 })
  y += 5
  pdf.setFont("courier", "normal")
  pdf.setFontSize(9)
  pdf.setTextColor(40, 40, 40)
  pdf.text(`= 1000 × ${fmtNum(state.Vc, 0)} / (π × ${fmtNum(state.diameter, 2)})`, margin + 4, y)
  y += 5
  pdf.text(`= ${fmtNum(results.n, 0)} RPM`, margin + 4, y)
  y += 7

  // (2) Vf
  text("2. 이송속도 Vf = fz · Z · n", margin, y, { bold: true, size: 10 })
  y += 5
  pdf.setFont("courier", "normal")
  pdf.text(`= ${fmtNum(state.fz, 4)} × ${state.fluteCount} × ${fmtNum(results.n, 0)}`, margin + 4, y)
  y += 5
  pdf.text(`= ${fmtNum(results.Vf, 0)} mm/min`, margin + 4, y)
  y += 7

  // (3) MRR
  text("3. 재료 제거율 MRR = ap · ae · Vf / 1000", margin, y, { bold: true, size: 10 })
  y += 5
  pdf.setFont("courier", "normal")
  pdf.text(`= ${fmtNum(state.ap, 2)} × ${fmtNum(state.ae, 2)} × ${fmtNum(results.Vf, 0)} / 1000`, margin + 4, y)
  y += 5
  pdf.text(`= ${fmtNum(results.MRR, 2)} cm³/min`, margin + 4, y)
  y += 7

  // (4) Pc (Sandvik)
  text("4. 절삭 동력 Pc = (ap · ae · Vf · kc) / (60 · 10^6 · η)", margin, y, { bold: true, size: 10 })
  y += 5
  pdf.setFontSize(8)
  pdf.setFont("helvetica", "italic")
  pdf.setTextColor(100, 100, 100)
  pdf.text("(Sandvik Coromant · kc = specific cutting force [N/mm²], η ≈ 0.80)", margin + 4, y)
  y += 5
  pdf.setFont("courier", "normal")
  pdf.setFontSize(9)
  pdf.setTextColor(40, 40, 40)
  pdf.text(`Result: Pc ≈ ${fmtNum(results.Pc, 2)} kW`, margin + 4, y)
  y += 7

  // (5) Fc
  text("5. 절삭력 Fc = Pc · 60000 / Vc (N)", margin, y, { bold: true, size: 10 })
  y += 5
  pdf.setFont("courier", "normal")
  pdf.text(`= ${fmtNum(results.Pc, 2)} × 60000 / ${fmtNum(state.Vc, 0)}`, margin + 4, y)
  y += 5
  pdf.text(`≈ ${fmtNum(results.Fc, 0)} N`, margin + 4, y)
  y += 7

  // (6) Deflection
  text("6. 공구 편향 δ ∝ F · L³ / (3 · E · I)", margin, y, { bold: true, size: 10 })
  y += 5
  pdf.setFont("courier", "normal")
  pdf.text(`Stickout L=${fmtNum(state.stickoutMm, 1)}mm, D=${fmtNum(state.diameter, 2)}mm`, margin + 4, y)
  y += 5
  pdf.text(`Result: δ ≈ ${fmtNum(results.deflection, 1)} μm`, margin + 4, y)
  y += 7

  pdf.setFontSize(7)
  pdf.setFont("helvetica", "italic")
  pdf.setTextColor(120, 120, 120)
  pdf.text(
    "※ 모든 값은 근사치입니다. 실제 가공에서는 공구 코팅, 냉각, 머신 강성, 진동 등이 영향을 줍니다.",
    margin,
    pageH - 12
  )
  pdf.text("Page 2 / " + (educationMode ? "4" : "3"), pageW - margin, pageH - 6, { align: "right" })

  // ═══════════════════════════════════════════════════════════════
  // PAGE 3: G-Code
  // ═══════════════════════════════════════════════════════════════
  newPage()
  pdf.setFillColor(30, 58, 138)
  pdf.rect(0, 0, pageW, 14, "F")
  text("G-Code 스니펫 (Fanuc / HAAS)", margin, 9, { bold: true, size: 11, color: [255, 255, 255] })

  y = 22
  pdf.setFontSize(9)
  pdf.setTextColor(60, 60, 60)
  pdf.setFont("helvetica", "normal")
  pdf.text("아래 G-Code는 기본 골격이며, 실제 사용 전 머신·공구·좌표계에 맞게 검토·수정하세요.", margin, y)
  y += 6

  const gcode = buildFanucSnippet(state, results)

  // 회색 배경 박스
  const lines = gcode.split("\n")
  const gcodeH = lines.length * 4.5 + 6
  pdf.setFillColor(245, 245, 245)
  pdf.setDrawColor(200, 200, 200)
  pdf.roundedRect(margin, y, pageW - margin * 2, gcodeH, 1.5, 1.5, "FD")
  pdf.setFont("courier", "normal")
  pdf.setFontSize(9)
  pdf.setTextColor(30, 30, 30)
  let gy = y + 5
  lines.forEach((line) => {
    pdf.text(line, margin + 3, gy)
    gy += 4.5
  })
  y += gcodeH + 6

  // 비고
  pdf.setFont("helvetica", "italic")
  pdf.setFontSize(8)
  pdf.setTextColor(120, 120, 120)
  pdf.text("• 공구 번호, 좌표계 (G54~G59), 쿨런트 코드는 머신 세팅에 맞게 조정", margin, y)
  y += 4
  pdf.text("• 실제 가공 경로는 CAM 후처리(Post-processor)로 생성 권장", margin, y)
  y += 4

  pdf.setFontSize(7)
  pdf.setTextColor(150, 150, 150)
  pdf.text("Page 3 / " + (educationMode ? "4" : "3"), pageW - margin, pageH - 6, { align: "right" })

  // ═══════════════════════════════════════════════════════════════
  // PAGE 4: 교육 모드 요약 (옵션)
  // ═══════════════════════════════════════════════════════════════
  if (educationMode) {
    newPage()
    pdf.setFillColor(180, 83, 9)
    pdf.rect(0, 0, pageW, 14, "F")
    text("교육 모드 · 입력값 용어 해설", margin, 9, { bold: true, size: 11, color: [255, 255, 255] })

    y = 22
    pdf.setFontSize(8)
    pdf.setTextColor(120, 120, 120)
    pdf.setFont("helvetica", "italic")
    pdf.text(
      "이 페이지는 교육 모드가 활성화된 상태에서만 생성됩니다. 주요 입력 파라미터의 의미·영향·현재값을 요약합니다.",
      margin,
      y
    )
    y += 6

    const entries = educationSummary(state)
    entries.forEach((e) => {
      if (y > pageH - 25) {
        newPage()
        y = 22
      }
      pdf.setFont("helvetica", "bold")
      pdf.setFontSize(10)
      pdf.setTextColor(146, 64, 14)
      pdf.text(`· ${e.term}`, margin, y)
      y += 5
      pdf.setFont("helvetica", "normal")
      pdf.setFontSize(9)
      pdf.setTextColor(50, 50, 50)
      const wrapped = pdf.splitTextToSize(e.desc, pageW - margin * 2 - 4)
      pdf.text(wrapped, margin + 4, y)
      y += 4.5 * wrapped.length + 2
    })

    pdf.setFontSize(7)
    pdf.setTextColor(150, 150, 150)
    pdf.text("Page 4 / 4", pageW - margin, pageH - 6, { align: "right" })
  }

  // ── Save ──
  const outName =
    filename ??
    `ARIA_Simulator_${state.isoGroup}_D${state.diameter}_${new Date().toISOString().slice(0, 10)}.pdf`
  pdf.save(outName)
}

export default generateReportPDF
