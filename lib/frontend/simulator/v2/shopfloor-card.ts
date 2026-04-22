// SPDX-License-Identifier: MIT
// YG-1 ARIA Simulator v3 — 작업장 Shopfloor Card (A6) PDF Generator
// jsPDF + qrcode. 105 × 148 mm portrait, 현장 부착용 1페이지 요약.
// 모든 외부 라이브러리는 dynamic import로 chunk 분리.
"use client"

// ── Public Types ────────────────────────────────────────────────────
export interface ShopfloorCardState {
  productCode?: string
  endmillShape?: string
  diameter: number
  flutes: number
  materialGroup?: string
  materialSubgroup?: string
  operation?: string
  coating?: string
  Vc: number
  fz: number
  ap: number
  ae: number
}

export interface ShopfloorCardResults {
  n: number
  Vf: number
  MRR: number
  Pc: number
  toolLifeMin?: number
  Ra?: number
  chatterRisk?: "low" | "medium" | "high" | string
}

export interface ShopfloorCardParams {
  state: ShopfloorCardState
  results: ShopfloorCardResults
  warnings?: string[]
  shareUrl?: string
  generatedBy?: string
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

// ── QR code 생성 → dataURL ─────────────────────────────────────────
async function generateQrDataUrl(url: string, sizePx = 240): Promise<string> {
  const QR = await import("qrcode")
  return QR.toDataURL(url, {
    width: sizePx,
    margin: 1,
    errorCorrectionLevel: "M",
    color: { dark: "#000000", light: "#ffffff" },
  })
}

// ── 메인 엔트리 ─────────────────────────────────────────────────
export async function generateShopfloorCardPDF(params: ShopfloorCardParams): Promise<void> {
  const { state, results, warnings = [], shareUrl, generatedBy = "YG-1 ARIA v3" } = params

  // dynamic imports (QR은 shareUrl 있을 때만)
  const [{ jsPDF }, qrDataUrl] = await Promise.all([
    import("jspdf"),
    shareUrl ? generateQrDataUrl(shareUrl, 240) : Promise.resolve<string | null>(null),
  ])

  // A6 portrait: 105 × 148 mm
  const pdf = new jsPDF({ orientation: "p", unit: "mm", format: "a6" })
  const pageW = pdf.internal.pageSize.getWidth()
  const pageH = pdf.internal.pageSize.getHeight()
  const margin = 5

  // Helper: 텍스트
  const text = (
    s: string,
    x: number,
    yPos: number,
    opts?: {
      bold?: boolean
      size?: number
      color?: [number, number, number]
      align?: "left" | "center" | "right"
    }
  ) => {
    pdf.setFont("helvetica", opts?.bold ? "bold" : "normal")
    if (opts?.size) pdf.setFontSize(opts.size)
    if (opts?.color) pdf.setTextColor(opts.color[0], opts.color[1], opts.color[2])
    else pdf.setTextColor(20, 20, 20)
    pdf.text(s, x, yPos, opts?.align ? { align: opts.align } : undefined)
  }

  // ═══════════════════════════════════════════════════════════════
  // 상단 헤더 (10mm 영역)
  // ═══════════════════════════════════════════════════════════════
  pdf.setFillColor(30, 58, 138)
  pdf.rect(0, 0, pageW, 10, "F")
  text("YG-1 ARIA", margin, 6.8, { bold: true, size: 12, color: [255, 255, 255] })
  text("SHOPFLOOR CARD", margin + 26, 6.8, { size: 8, color: [200, 220, 255] })

  // QR 우측 상단 (18 × 18 mm)
  const qrSize = 18
  const qrX = pageW - margin - qrSize
  const qrY = 11
  if (qrDataUrl) {
    pdf.addImage(qrDataUrl, "PNG", qrX, qrY, qrSize, qrSize)
  } else {
    pdf.setDrawColor(200, 200, 200)
    pdf.setFillColor(245, 245, 245)
    pdf.rect(qrX, qrY, qrSize, qrSize, "FD")
    text("QR", qrX + qrSize / 2, qrY + qrSize / 2 + 1, {
      size: 7,
      color: [150, 150, 150],
      align: "center",
    })
  }

  let y = 14

  // ═══════════════════════════════════════════════════════════════
  // 공구 / 재질 섹션
  // ═══════════════════════════════════════════════════════════════
  const toolLine =
    `D${fmtNum(state.diameter, state.diameter < 10 ? 1 : 0)} ` +
    `Z${state.flutes} ` +
    `${nz(state.endmillShape, "Endmill")} / ${nz(state.coating)}`
  // 공구 라인은 QR을 피하기 위해 폭 제한
  const leftMaxW = qrX - margin - 1
  pdf.setFont("helvetica", "bold")
  pdf.setFontSize(11)
  pdf.setTextColor(20, 20, 20)
  const toolLines = pdf.splitTextToSize(toolLine, leftMaxW)
  pdf.text(toolLines, margin, y)
  y += 4.5 * Math.min(toolLines.length, 2)

  // productCode 작은 글씨
  if (state.productCode) {
    pdf.setFont("helvetica", "normal")
    pdf.setFontSize(7)
    pdf.setTextColor(100, 100, 100)
    const pcLines = pdf.splitTextToSize(`[${state.productCode}]`, leftMaxW)
    pdf.text(pcLines[0], margin, y)
    y += 3.5
  }

  // 재질 라인
  const matLine = `${nz(state.materialGroup)} · ${nz(state.materialSubgroup)}${
    state.operation ? "  |  " + state.operation : ""
  }`
  pdf.setFont("helvetica", "bold")
  pdf.setFontSize(10)
  pdf.setTextColor(60, 60, 60)
  const matLines = pdf.splitTextToSize(matLine, leftMaxW)
  pdf.text(matLines[0], margin, y)
  y += 5

  // QR 아래쪽 아래로 내려가기 (QR 영역: y 11 ~ 29)
  if (y < 30) y = 30

  // 구분선
  pdf.setDrawColor(200, 200, 200)
  pdf.setLineWidth(0.2)
  pdf.line(margin, y, pageW - margin, y)
  y += 3

  // ═══════════════════════════════════════════════════════════════
  // 큰 수치 박스: Vc, n, fz, Vf, MRR (2열 그리드)
  // ═══════════════════════════════════════════════════════════════
  const gridCols = 2
  const gridW = (pageW - margin * 2) / gridCols
  const cellH = 11

  const metrics: Array<{ label: string; value: string; unit: string }> = [
    { label: "Vc", value: fmtNum(state.Vc, 0), unit: "m/min" },
    { label: "n", value: fmtNum(results.n, 0), unit: "RPM" },
    { label: "fz", value: fmtNum(state.fz, 4), unit: "mm/t" },
    { label: "Vf", value: fmtNum(results.Vf, 0), unit: "mm/min" },
    { label: "MRR", value: fmtNum(results.MRR, 2), unit: "cm³/min" },
  ]

  metrics.forEach((m, idx) => {
    const col = idx % gridCols
    const row = Math.floor(idx / gridCols)
    const cx = margin + col * gridW
    const cy = y + row * cellH

    pdf.setFillColor(239, 246, 255)
    pdf.setDrawColor(147, 197, 253)
    pdf.setLineWidth(0.2)
    pdf.roundedRect(cx + 0.5, cy, gridW - 1, cellH - 1, 1, 1, "FD")

    // label
    pdf.setFont("helvetica", "normal")
    pdf.setFontSize(7)
    pdf.setTextColor(100, 116, 139)
    pdf.text(m.label, cx + 2, cy + 3)

    // value (big)
    pdf.setFont("helvetica", "bold")
    pdf.setFontSize(12)
    pdf.setTextColor(30, 64, 175)
    pdf.text(m.value, cx + 2, cy + 8)

    // unit
    pdf.setFont("helvetica", "normal")
    pdf.setFontSize(6)
    pdf.setTextColor(100, 116, 139)
    pdf.text(m.unit, cx + gridW - 2, cy + 8, { align: "right" })
  })

  const metricRows = Math.ceil(metrics.length / gridCols)
  y += metricRows * cellH + 2

  // ═══════════════════════════════════════════════════════════════
  // 경고 박스 (빨간 테두리, 최대 3개)
  // ═══════════════════════════════════════════════════════════════
  if (warnings.length > 0) {
    const shown = warnings.slice(0, 3)
    const warnH = shown.length * 4 + 3
    pdf.setDrawColor(220, 38, 38)
    pdf.setFillColor(254, 242, 242)
    pdf.setLineWidth(0.4)
    pdf.roundedRect(margin, y, pageW - margin * 2, warnH, 1, 1, "FD")
    pdf.setFont("helvetica", "bold")
    pdf.setFontSize(7)
    pdf.setTextColor(185, 28, 28)
    let wy = y + 3
    shown.forEach((w) => {
      const line = pdf.splitTextToSize(`! ${w}`, pageW - margin * 2 - 3)[0]
      pdf.text(line, margin + 1.5, wy)
      wy += 4
    })
    y += warnH + 2
  }

  // ═══════════════════════════════════════════════════════════════
  // 보조 수치 (9pt): Pc / 공구수명 / Ra / Chatter
  // ═══════════════════════════════════════════════════════════════
  pdf.setFont("helvetica", "normal")
  pdf.setFontSize(8)
  pdf.setTextColor(60, 60, 60)
  const auxLine1 = `Pc ${fmtNum(results.Pc, 2)} kW   |   Tool life ${fmtNum(results.toolLifeMin, 0)} min`
  const auxLine2 = `Ra ${fmtNum(results.Ra, 2)} μm   |   Chatter ${nz(results.chatterRisk)}`
  pdf.text(auxLine1, margin, y + 3)
  pdf.text(auxLine2, margin, y + 7)
  y += 10

  // ap / ae 보조 (같은 줄에 더 작게)
  pdf.setFontSize(7)
  pdf.setTextColor(120, 120, 120)
  pdf.text(
    `ap ${fmtNum(state.ap, 2)} mm  ·  ae ${fmtNum(state.ae, 2)} mm`,
    margin,
    y
  )
  y += 3

  // ═══════════════════════════════════════════════════════════════
  // 푸터 (하단 고정)
  // ═══════════════════════════════════════════════════════════════
  const footerY = pageH - 3
  pdf.setDrawColor(220, 220, 220)
  pdf.setLineWidth(0.2)
  pdf.line(margin, footerY - 4, pageW - margin, footerY - 4)
  pdf.setFont("helvetica", "normal")
  pdf.setFontSize(6)
  pdf.setTextColor(120, 120, 120)
  const today = new Date().toISOString().slice(0, 10)
  pdf.text(today, margin, footerY)
  pdf.text("v3.0", pageW / 2, footerY, { align: "center" })
  pdf.text(generatedBy, pageW - margin, footerY, { align: "right" })

  // ── Save ──
  const ts = new Date()
    .toISOString()
    .replace(/[:T]/g, "-")
    .replace(/\..+$/, "")
  const safeCode = (state.productCode ?? "unknown").replace(/[^\w.-]+/g, "_")
  const outName = `shopfloor-card-${safeCode}-${ts}.pdf`
  pdf.save(outName)
}

export default generateShopfloorCardPDF
