// SPDX-License-Identifier: MIT
// YG-1 ARIA Simulator v3 — 가공 지시서 (Work Instruction) PDF Generator
// A4 portrait, 4페이지: 표지/상세 조건/경고·주의/결재.
// 영업 proposal 또는 shop floor 배포용. 작업자 서명란·결재란 포함.
// 모든 외부 라이브러리는 dynamic import로 chunk 분리.
"use client"

// ── Public Types ────────────────────────────────────────────────────
export interface WorkInstructionState {
  productCode: string
  edpCode?: string
  isoGroup: string
  subgroupKey: string
  operation: string
  coating: string
  diameter: number
  fluteCount: number
  activeShape: string
  cornerR?: number
  LOC: number
  OAL: number
  shankDia: number
  stickoutMm: number
  Vc: number
  fz: number
  ap: number
  ae: number
}

export interface WorkInstructionResults {
  n: number
  Vf: number
  MRR: number
  Pc: number
  torque: number
  deflection: number
  toolLifeMin: number
  Ra: number
}

export interface WorkInstructionWarning {
  level: string
  message: string
}

export interface WorkInstructionMeta {
  partName?: string
  quantity?: number
  operator?: string
  supervisor?: string
  dueDate?: string
  orderNumber?: string
  companyName?: string
  shareUrl?: string
}

export interface WorkInstructionParams {
  state: WorkInstructionState
  results: WorkInstructionResults
  warnings?: WorkInstructionWarning[]
  meta?: WorkInstructionMeta
}

// ── Utils ──────────────────────────────────────────────────────────
function nz(v: unknown, fallback = "—"): string {
  if (v === undefined || v === null || v === "") return fallback
  if (typeof v === "number") return Number.isFinite(v) ? v.toString() : fallback
  return String(v)
}

function fmtNum(v: number | undefined | null, digits = 1): string {
  if (v === undefined || v === null || !Number.isFinite(v)) return "—"
  return (v as number).toFixed(digits)
}

function sanitizeFilename(s: string): string {
  return (s || "unknown").replace(/[^\w.-]+/g, "_")
}

function warningLevelColor(level: string): [number, number, number] {
  const lv = (level || "").toLowerCase()
  if (lv === "error" || lv === "critical" || lv === "danger") return [220, 38, 38]
  if (lv === "warn" || lv === "warning") return [217, 119, 6]
  return [37, 99, 235]
}

function warningLevelLabel(level: string): string {
  const lv = (level || "").toLowerCase()
  if (lv === "error" || lv === "critical" || lv === "danger") return "[ERROR]"
  if (lv === "warn" || lv === "warning") return "[WARN] "
  return "[INFO] "
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

// ── 공구 파손 위험 자동 주의사항 ──────────────────────────────────
function autoSafetyNotes(
  state: WorkInstructionState,
  results: WorkInstructionResults
): string[] {
  const notes: string[] = []

  // 1) stickout 대 직경 비
  if (state.stickoutMm && state.diameter) {
    const ratio = state.stickoutMm / state.diameter
    if (ratio >= 4) {
      notes.push(
        `돌출 길이 L/D = ${ratio.toFixed(1)} (>= 4.0). Deflection/Chatter 주의. ap·ae 단계 축소 권장.`
      )
    }
  }

  // 2) Deflection
  if (Number.isFinite(results.deflection) && results.deflection >= 20) {
    notes.push(
      `계산 Deflection ${fmtNum(results.deflection, 0)} μm (>= 20). 공구 파손/치수 이탈 위험.`
    )
  }

  // 3) Pc
  if (Number.isFinite(results.Pc) && results.Pc >= 5) {
    notes.push(
      `절삭 동력 Pc ${fmtNum(results.Pc, 2)} kW. 스핀들 과부하 여부 머신 사양 재확인.`
    )
  }

  // 4) ap/D 비
  if (state.ap && state.diameter) {
    const apD = state.ap / state.diameter
    if (apD > 1.5) {
      notes.push(
        `축방향 절입 ap/D = ${apD.toFixed(2)} (> 1.5). Slotting 시 칩 배출 불량/공구 파손 위험.`
      )
    }
  }

  // 5) Tool life 낮을 때
  if (
    Number.isFinite(results.toolLifeMin) &&
    results.toolLifeMin > 0 &&
    results.toolLifeMin < 15
  ) {
    notes.push(
      `예상 Tool life ${fmtNum(results.toolLifeMin, 0)} min (< 15). 공구 교체 주기 단축 필요.`
    )
  }

  // 기본 공통 주의사항 (최소 3개 보장)
  const defaults: string[] = [
    "가공 전 공구 장착 상태·척 클램핑 토크·동심도 확인.",
    "첫 가공 시 Dry run 후 실가공, 1차 칩 형상·소음·진동 상태 점검.",
    "쿨런트 분사 각도·유량 확인. 건식일 경우 에어 블로우 필수.",
    "공구 마모도(VB) 주기적 측정. 색 변화·엣지 파손 시 즉시 교체.",
    "워크홀딩 강성·공구 돌출 길이는 가능한 한 최소화.",
  ]

  const result = [...notes]
  for (const d of defaults) {
    if (result.length >= 5) break
    result.push(d)
  }
  // 최소 3개 보장
  while (result.length < 3 && defaults.length > 0) {
    result.push(defaults[result.length % defaults.length])
  }
  return result.slice(0, 7)
}

// ── 메인 엔트리 ─────────────────────────────────────────────────
export async function generateWorkInstructionPDF(
  params: WorkInstructionParams
): Promise<void> {
  const { state, results, warnings = [], meta = {} } = params

  const [{ jsPDF }, qrDataUrl] = await Promise.all([
    import("jspdf"),
    meta.shareUrl
      ? generateQrDataUrl(meta.shareUrl, 300)
      : Promise.resolve<string | null>(null),
  ])

  const pdf = new jsPDF({ orientation: "p", unit: "mm", format: "a4" })
  const pageW = pdf.internal.pageSize.getWidth()
  const pageH = pdf.internal.pageSize.getHeight()
  const margin = 14
  let y = margin

  const TOTAL_PAGES = 4
  let currentPage = 1

  // Helpers ──────────────────────────────────────────────────────────
  const text = (
    s: string,
    x: number,
    yPos: number,
    opts?: {
      bold?: boolean
      italic?: boolean
      size?: number
      color?: [number, number, number]
      align?: "left" | "center" | "right"
      font?: "helvetica" | "courier" | "times"
    }
  ) => {
    const family = opts?.font ?? "helvetica"
    const style = opts?.bold
      ? opts?.italic
        ? "bolditalic"
        : "bold"
      : opts?.italic
        ? "italic"
        : "normal"
    pdf.setFont(family, style)
    if (opts?.size) pdf.setFontSize(opts.size)
    if (opts?.color) pdf.setTextColor(opts.color[0], opts.color[1], opts.color[2])
    else pdf.setTextColor(20, 20, 20)
    pdf.text(s, x, yPos, opts?.align ? { align: opts.align } : undefined)
  }

  const hr = (yPos: number, color: [number, number, number] = [200, 200, 200]) => {
    pdf.setDrawColor(color[0], color[1], color[2])
    pdf.setLineWidth(0.2)
    pdf.line(margin, yPos, pageW - margin, yPos)
  }

  const pageHeader = (title: string, subtitle?: string) => {
    pdf.setFillColor(30, 58, 138)
    pdf.rect(0, 0, pageW, 16, "F")
    text(title, margin, 10, {
      bold: true,
      size: 12,
      color: [255, 255, 255],
    })
    if (subtitle) {
      text(subtitle, pageW - margin, 10, {
        size: 8,
        color: [200, 220, 255],
        align: "right",
      })
    }
  }

  const pageFooter = () => {
    pdf.setFont("helvetica", "normal")
    pdf.setFontSize(7)
    pdf.setTextColor(150, 150, 150)
    pdf.text(
      `${meta.companyName ?? "YG-1"} · Work Instruction · Reference only`,
      margin,
      pageH - 6
    )
    pdf.text(
      `Page ${currentPage} / ${TOTAL_PAGES}`,
      pageW - margin,
      pageH - 6,
      { align: "right" }
    )
  }

  const newPage = () => {
    pageFooter()
    pdf.addPage()
    currentPage += 1
    y = margin
  }

  // 간단 2열 테이블: [label, value] 배열 렌더
  const drawKeyValueTable = (
    rows: Array<[string, string]>,
    startY: number,
    opts?: {
      labelW?: number
      rowH?: number
      labelColor?: [number, number, number]
      valueColor?: [number, number, number]
      border?: boolean
      labelBgColor?: [number, number, number]
    }
  ): number => {
    const labelW = opts?.labelW ?? 50
    const rowH = opts?.rowH ?? 7
    const tblX = margin
    const tblW = pageW - margin * 2
    const labelBg = opts?.labelBgColor ?? [243, 244, 246]

    rows.forEach((row, idx) => {
      const ry = startY + idx * rowH

      // 라벨 배경
      pdf.setFillColor(labelBg[0], labelBg[1], labelBg[2])
      pdf.rect(tblX, ry, labelW, rowH, "F")

      // 테두리
      if (opts?.border !== false) {
        pdf.setDrawColor(210, 210, 210)
        pdf.setLineWidth(0.15)
        pdf.rect(tblX, ry, tblW, rowH)
        pdf.line(tblX + labelW, ry, tblX + labelW, ry + rowH)
      }

      // 라벨
      pdf.setFont("helvetica", "bold")
      pdf.setFontSize(9)
      const lc = opts?.labelColor ?? [55, 65, 81]
      pdf.setTextColor(lc[0], lc[1], lc[2])
      pdf.text(row[0], tblX + 2, ry + rowH - 2.5)

      // 값
      pdf.setFont("helvetica", "normal")
      pdf.setFontSize(9)
      const vc = opts?.valueColor ?? [30, 30, 30]
      pdf.setTextColor(vc[0], vc[1], vc[2])
      const maxValW = tblW - labelW - 4
      const vLines = pdf.splitTextToSize(row[1], maxValW)
      pdf.text(vLines[0] ?? "", tblX + labelW + 2, ry + rowH - 2.5)
    })

    return startY + rows.length * rowH
  }

  const today = new Date()
  const todayStr = today.toISOString().slice(0, 10)
  const timestamp = today.toISOString().slice(0, 19).replace("T", " ")

  // ═══════════════════════════════════════════════════════════════
  // PAGE 1 — 표지 & 요약
  // ═══════════════════════════════════════════════════════════════
  pageHeader(
    "가공 지시서 (Work Instruction)",
    meta.companyName ?? "YG-1 ARIA Simulator v3"
  )

  y = 26

  // 회사 로고 자리 placeholder
  pdf.setDrawColor(200, 200, 200)
  pdf.setLineWidth(0.3)
  pdf.rect(margin, y, 40, 16)
  pdf.setFont("helvetica", "italic")
  pdf.setFontSize(7)
  pdf.setTextColor(150, 150, 150)
  pdf.text("LOGO", margin + 20, y + 9.5, { align: "center" })

  // 제목 블록 (로고 옆)
  text("가공 지시서", margin + 46, y + 7, {
    bold: true,
    size: 18,
    color: [17, 24, 39],
  })
  text("Work Instruction Sheet", margin + 46, y + 13.5, {
    size: 10,
    color: [107, 114, 128],
    italic: true,
  })

  // QR 우상단
  const qrSize = 28
  const qrX = pageW - margin - qrSize
  const qrY = y
  if (qrDataUrl) {
    pdf.addImage(qrDataUrl, "PNG", qrX, qrY, qrSize, qrSize)
    pdf.setFontSize(6.5)
    pdf.setTextColor(100, 100, 100)
    pdf.text("Sim restore URL", qrX + qrSize / 2, qrY + qrSize + 3, {
      align: "center",
    })
  } else {
    pdf.setDrawColor(220, 220, 220)
    pdf.setFillColor(248, 248, 248)
    pdf.rect(qrX, qrY, qrSize, qrSize, "FD")
    pdf.setFontSize(8)
    pdf.setTextColor(160, 160, 160)
    pdf.text("QR", qrX + qrSize / 2, qrY + qrSize / 2 + 1, { align: "center" })
  }

  y += 22
  hr(y)
  y += 5

  // 작업 지시 식별 블록
  const orderRows: Array<[string, string]> = [
    ["작업 지시번호 (Order No.)", nz(meta.orderNumber)],
    ["부품명 (Part Name)", nz(meta.partName)],
    ["수량 (Quantity)", meta.quantity != null ? `${meta.quantity} EA` : "—"],
    ["납기일 (Due Date)", nz(meta.dueDate)],
    ["작성일 (Issued)", todayStr],
  ]
  y = drawKeyValueTable(orderRows, y, { labelW: 60, rowH: 7 })
  y += 5

  // 공구 정보 섹션
  text("■ 공구 정보 (Tool Information)", margin, y, {
    bold: true,
    size: 11,
    color: [30, 58, 138],
  })
  y += 5

  const toolRows: Array<[string, string]> = [
    ["Series", nz(state.productCode)],
    ["EDP Code", nz(state.edpCode)],
    [
      "Diameter × Flutes",
      `D${fmtNum(state.diameter, 2)} mm × Z${state.fluteCount}`,
    ],
    [
      "Shape / Corner R",
      `${nz(state.activeShape)} / R${fmtNum(state.cornerR, 2)}`,
    ],
    ["Coating", nz(state.coating)],
    [
      "LOC / OAL / Shank",
      `LOC ${fmtNum(state.LOC, 1)} / OAL ${fmtNum(state.OAL, 1)} / SH ${fmtNum(state.shankDia, 1)} mm`,
    ],
  ]
  y = drawKeyValueTable(toolRows, y, { labelW: 55, rowH: 6.5 })
  y += 5

  // 재질 & 가공
  text("■ 재질 · 가공 (Material & Operation)", margin, y, {
    bold: true,
    size: 11,
    color: [30, 58, 138],
  })
  y += 5
  const matOpRows: Array<[string, string]> = [
    ["ISO Group · Subgroup", `${nz(state.isoGroup)} · ${nz(state.subgroupKey)}`],
    ["Operation", nz(state.operation)],
  ]
  y = drawKeyValueTable(matOpRows, y, { labelW: 55, rowH: 6.5 })
  y += 6

  // 주요 절삭 조건 5종 — 큰 숫자 (Vc / fz / ap / ae / n)
  text("■ 주요 절삭 조건 (Key Parameters)", margin, y, {
    bold: true,
    size: 11,
    color: [30, 58, 138],
  })
  y += 5

  const bigBoxH = 30
  pdf.setFillColor(239, 246, 255)
  pdf.setDrawColor(147, 197, 253)
  pdf.setLineWidth(0.4)
  pdf.roundedRect(margin, y, pageW - margin * 2, bigBoxH, 2, 2, "FD")

  const cells = [
    { label: "Vc", value: fmtNum(state.Vc, 0), unit: "m/min" },
    { label: "fz", value: fmtNum(state.fz, 4), unit: "mm/tooth" },
    { label: "ap", value: fmtNum(state.ap, 2), unit: "mm" },
    { label: "ae", value: fmtNum(state.ae, 2), unit: "mm" },
    { label: "n", value: fmtNum(results.n, 0), unit: "RPM" },
  ]
  const cellW = (pageW - margin * 2) / cells.length
  cells.forEach((c, i) => {
    const cx = margin + i * cellW
    if (i > 0) {
      pdf.setDrawColor(191, 219, 254)
      pdf.setLineWidth(0.3)
      pdf.line(cx, y + 3, cx, y + bigBoxH - 3)
    }
    pdf.setFont("helvetica", "normal")
    pdf.setFontSize(8)
    pdf.setTextColor(71, 85, 105)
    pdf.text(c.label, cx + cellW / 2, y + 7, { align: "center" })

    pdf.setFont("helvetica", "bold")
    pdf.setFontSize(16)
    pdf.setTextColor(30, 64, 175)
    pdf.text(c.value, cx + cellW / 2, y + 17, { align: "center" })

    pdf.setFont("helvetica", "normal")
    pdf.setFontSize(7)
    pdf.setTextColor(100, 116, 139)
    pdf.text(c.unit, cx + cellW / 2, y + 24, { align: "center" })
  })
  y += bigBoxH + 4

  // 요약 1줄
  pdf.setFont("helvetica", "italic")
  pdf.setFontSize(8)
  pdf.setTextColor(120, 120, 120)
  pdf.text(
    `Vf ${fmtNum(results.Vf, 0)} mm/min · MRR ${fmtNum(results.MRR, 2)} cm³/min · Pc ${fmtNum(results.Pc, 2)} kW`,
    margin,
    y + 3
  )
  y += 6

  // ═══════════════════════════════════════════════════════════════
  // PAGE 2 — 상세 조건 & 계산
  // ═══════════════════════════════════════════════════════════════
  newPage()
  pageHeader("상세 조건 및 계산 (Details & Calculations)", meta.orderNumber ?? "")
  y = 22

  text("■ 입력 파라미터 (Input Parameters)", margin, y, {
    bold: true,
    size: 11,
    color: [30, 58, 138],
  })
  y += 5

  const inputRows: Array<[string, string]> = [
    ["Product / EDP", `${nz(state.productCode)} / ${nz(state.edpCode)}`],
    ["ISO / Subgroup", `${nz(state.isoGroup)} · ${nz(state.subgroupKey)}`],
    ["Operation / Shape", `${nz(state.operation)} / ${nz(state.activeShape)}`],
    ["Coating", nz(state.coating)],
    [
      "Diameter / Flutes",
      `D ${fmtNum(state.diameter, 3)} mm · Z ${state.fluteCount}`,
    ],
    ["Corner R", fmtNum(state.cornerR, 2) + " mm"],
    [
      "LOC / OAL / Shank D",
      `${fmtNum(state.LOC, 2)} / ${fmtNum(state.OAL, 2)} / ${fmtNum(state.shankDia, 2)} mm`,
    ],
    ["Stickout L", fmtNum(state.stickoutMm, 1) + " mm"],
    ["Vc", fmtNum(state.Vc, 1) + " m/min"],
    ["fz", fmtNum(state.fz, 4) + " mm/tooth"],
    ["ap (ADOC)", fmtNum(state.ap, 3) + " mm"],
    ["ae (RDOC)", fmtNum(state.ae, 3) + " mm"],
  ]
  y = drawKeyValueTable(inputRows, y, { labelW: 55, rowH: 6 })
  y += 5

  text("■ 계산 결과 (Calculated Results)", margin, y, {
    bold: true,
    size: 11,
    color: [5, 150, 105],
  })
  y += 5

  const resultRows: Array<[string, string]> = [
    ["n (Spindle Speed)", fmtNum(results.n, 0) + " RPM"],
    ["Vf (Feed Rate)", fmtNum(results.Vf, 0) + " mm/min"],
    ["MRR (Material Removal Rate)", fmtNum(results.MRR, 2) + " cm³/min"],
    ["Pc (Cutting Power)", fmtNum(results.Pc, 2) + " kW"],
    ["Torque (Spindle)", fmtNum(results.torque, 2) + " N·m"],
    ["Deflection (Tool Tip)", fmtNum(results.deflection, 1) + " μm"],
    ["Tool Life (est.)", fmtNum(results.toolLifeMin, 0) + " min"],
    ["Ra (Surface Roughness)", fmtNum(results.Ra, 2) + " μm"],
  ]
  y = drawKeyValueTable(resultRows, y, {
    labelW: 65,
    rowH: 6,
    labelBgColor: [236, 253, 245],
    labelColor: [6, 95, 70],
  })
  y += 5

  // 주요 공식
  text("■ 주요 공식 (Key Formulas)", margin, y, {
    bold: true,
    size: 11,
    color: [30, 58, 138],
  })
  y += 5

  const formulas: string[] = [
    "n = 1000 · Vc / (π · D)                                 [RPM]",
    "Vf = fz · Z · n                                         [mm/min]",
    "MRR = (ap · ae · Vf) / 1000                             [cm³/min]",
    "Pc = (ap · ae · Vf · kc) / (60 · 10^6 · η)              [kW]",
    "Fc = Pc · 60000 / Vc                                    [N]",
    "Torque = Pc · 9549 / n                                  [N·m]",
    "δ ∝ F · L³ / (3 · E · I)                                [μm]",
  ]
  pdf.setFont("courier", "normal")
  pdf.setFontSize(8.5)
  pdf.setTextColor(40, 40, 40)
  formulas.forEach((f) => {
    pdf.text(f, margin + 2, y)
    y += 4.5
  })
  y += 2
  pdf.setFont("helvetica", "italic")
  pdf.setFontSize(7)
  pdf.setTextColor(120, 120, 120)
  pdf.text(
    "※ 계산은 Sandvik Coromant 기반 근사치. 실가공은 공구 마모, 냉각, 머신 강성, 진동 영향 받음.",
    margin,
    y
  )

  // ═══════════════════════════════════════════════════════════════
  // PAGE 3 — 경고 & 주의사항
  // ═══════════════════════════════════════════════════════════════
  newPage()
  pageHeader("경고 및 주의사항 (Warnings & Safety)", meta.orderNumber ?? "")
  y = 22

  text("■ 시뮬레이션 경고 (Warnings)", margin, y, {
    bold: true,
    size: 11,
    color: [185, 28, 28],
  })
  y += 6

  if (!warnings || warnings.length === 0) {
    pdf.setFillColor(240, 253, 244)
    pdf.setDrawColor(134, 239, 172)
    pdf.setLineWidth(0.3)
    pdf.roundedRect(margin, y, pageW - margin * 2, 10, 1.5, 1.5, "FD")
    pdf.setFont("helvetica", "bold")
    pdf.setFontSize(10)
    pdf.setTextColor(22, 101, 52)
    pdf.text("[OK] 경고 없음 — 시뮬레이션 통과", margin + 4, y + 6.5)
    y += 14
  } else {
    warnings.forEach((w) => {
      if (y > pageH - 30) {
        newPage()
        pageHeader(
          "경고 및 주의사항 (계속)",
          meta.orderNumber ?? ""
        )
        y = 22
      }
      const color = warningLevelColor(w.level)
      const label = warningLevelLabel(w.level)
      const msgLines = pdf.splitTextToSize(
        w.message,
        pageW - margin * 2 - 24
      )
      const boxH = Math.max(7, 4 + 4.5 * msgLines.length)

      // 좌측 색 바
      pdf.setFillColor(color[0], color[1], color[2])
      pdf.rect(margin, y, 2, boxH, "F")

      // 본문 배경
      pdf.setFillColor(252, 252, 252)
      pdf.setDrawColor(229, 231, 235)
      pdf.setLineWidth(0.2)
      pdf.rect(margin + 2, y, pageW - margin * 2 - 2, boxH, "FD")

      pdf.setFont("helvetica", "bold")
      pdf.setFontSize(8)
      pdf.setTextColor(color[0], color[1], color[2])
      pdf.text(label, margin + 4, y + 5)

      pdf.setFont("helvetica", "normal")
      pdf.setFontSize(9)
      pdf.setTextColor(55, 65, 81)
      pdf.text(msgLines, margin + 22, y + 5)

      y += boxH + 2
    })
  }

  y += 4

  // 작업 시 주의사항 (자동 생성)
  text("■ 작업 시 주의사항 (Operational Safety Notes)", margin, y, {
    bold: true,
    size: 11,
    color: [180, 83, 9],
  })
  y += 6

  const notes = autoSafetyNotes(state, results)
  pdf.setFont("helvetica", "normal")
  pdf.setFontSize(9.5)
  pdf.setTextColor(55, 65, 81)
  notes.forEach((n, i) => {
    if (y > pageH - 20) {
      newPage()
      pageHeader("주의사항 (계속)", meta.orderNumber ?? "")
      y = 22
    }
    const wrapped = pdf.splitTextToSize(
      `${i + 1}. ${n}`,
      pageW - margin * 2 - 4
    )
    pdf.text(wrapped, margin + 2, y)
    y += 4.8 * wrapped.length + 1.5
  })

  y += 4
  pdf.setFont("helvetica", "italic")
  pdf.setFontSize(7.5)
  pdf.setTextColor(120, 120, 120)
  pdf.text(
    "※ 본 지시서의 절삭 조건은 참고값입니다. 실가공 전 첫 시편에서 안전 검증 후 양산 투입하세요.",
    margin,
    y
  )

  // ═══════════════════════════════════════════════════════════════
  // PAGE 4 — 결재 & 서명란
  // ═══════════════════════════════════════════════════════════════
  newPage()
  pageHeader("결재 및 서명 (Approval & Signature)", meta.orderNumber ?? "")
  y = 26

  text("아래 결재란에 작성자·검토자·승인자의 서명을 기재하세요.", margin, y, {
    size: 9,
    color: [75, 85, 99],
    italic: true,
  })
  y += 8

  // 3-column 결재 박스
  const colCount = 3
  const colGap = 4
  const boxW = (pageW - margin * 2 - colGap * (colCount - 1)) / colCount
  const boxH = 70

  const signRoles: Array<{ title: string; name?: string }> = [
    { title: "작성자\nPrepared by", name: meta.operator },
    { title: "검토자\nReviewed by", name: meta.supervisor },
    { title: "승인자\nApproved by" },
  ]

  signRoles.forEach((role, i) => {
    const bx = margin + i * (boxW + colGap)
    const by = y

    // 외곽 테두리
    pdf.setDrawColor(100, 100, 100)
    pdf.setLineWidth(0.4)
    pdf.rect(bx, by, boxW, boxH)

    // 타이틀 밴드
    pdf.setFillColor(30, 58, 138)
    pdf.rect(bx, by, boxW, 10, "F")
    pdf.setFont("helvetica", "bold")
    pdf.setFontSize(9)
    pdf.setTextColor(255, 255, 255)
    const titleLines = role.title.split("\n")
    pdf.text(titleLines[0], bx + boxW / 2, by + 4.5, { align: "center" })
    pdf.setFont("helvetica", "italic")
    pdf.setFontSize(7)
    pdf.setTextColor(200, 220, 255)
    pdf.text(titleLines[1] ?? "", bx + boxW / 2, by + 8, { align: "center" })

    // 이름 / 날짜 / 서명 slot
    const slotY1 = by + 18
    const slotY2 = by + 34
    const slotY3 = by + 50

    pdf.setFont("helvetica", "normal")
    pdf.setFontSize(8)
    pdf.setTextColor(60, 60, 60)

    // 이름
    pdf.text("이름 (Name)", bx + 3, slotY1 - 1)
    pdf.setDrawColor(180, 180, 180)
    pdf.setLineWidth(0.2)
    pdf.line(bx + 3, slotY1 + 6, bx + boxW - 3, slotY1 + 6)
    if (role.name) {
      pdf.setFont("helvetica", "bold")
      pdf.setFontSize(10)
      pdf.setTextColor(20, 20, 20)
      pdf.text(role.name, bx + 3, slotY1 + 4)
      pdf.setFont("helvetica", "normal")
      pdf.setFontSize(8)
      pdf.setTextColor(60, 60, 60)
    }

    // 날짜
    pdf.text("날짜 (Date)", bx + 3, slotY2 - 1)
    pdf.line(bx + 3, slotY2 + 6, bx + boxW - 3, slotY2 + 6)

    // 서명
    pdf.text("서명 (Signature)", bx + 3, slotY3 - 1)
    pdf.line(bx + 3, by + boxH - 3, bx + boxW - 3, by + boxH - 3)
  })

  y += boxH + 8

  // 지시서 식별 요약
  pdf.setDrawColor(200, 200, 200)
  pdf.setLineWidth(0.2)
  pdf.rect(margin, y, pageW - margin * 2, 22)
  pdf.setFont("helvetica", "bold")
  pdf.setFontSize(9)
  pdf.setTextColor(55, 65, 81)
  pdf.text("■ 지시서 요약 (Summary)", margin + 3, y + 5)

  pdf.setFont("helvetica", "normal")
  pdf.setFontSize(8)
  pdf.setTextColor(75, 85, 99)
  const summaryL1 = `Order: ${nz(meta.orderNumber)}   |   Part: ${nz(meta.partName)}   |   Qty: ${meta.quantity != null ? meta.quantity + " EA" : "—"}`
  const summaryL2 = `Tool: ${nz(state.productCode)} D${fmtNum(state.diameter, 2)} Z${state.fluteCount} ${nz(state.coating)}   |   Material: ${nz(state.isoGroup)}·${nz(state.subgroupKey)}   |   Op: ${nz(state.operation)}`
  const summaryL3 = `Vc ${fmtNum(state.Vc, 0)} · fz ${fmtNum(state.fz, 4)} · ap ${fmtNum(state.ap, 2)} · ae ${fmtNum(state.ae, 2)}  →  n ${fmtNum(results.n, 0)} / Vf ${fmtNum(results.Vf, 0)} / MRR ${fmtNum(results.MRR, 2)}`
  pdf.text(summaryL1, margin + 3, y + 10)
  pdf.text(summaryL2, margin + 3, y + 14.5)
  pdf.text(summaryL3, margin + 3, y + 19)

  y += 26

  // 하단 생성 정보
  pdf.setFont("helvetica", "italic")
  pdf.setFontSize(7)
  pdf.setTextColor(140, 140, 140)
  pdf.text(
    `생성 (Generated): YG-1 ARIA Simulator v3 · ${timestamp}`,
    margin,
    pageH - 12
  )
  if (meta.shareUrl) {
    const urlLine = pdf.splitTextToSize(
      `Restore URL: ${meta.shareUrl}`,
      pageW - margin * 2
    )
    pdf.text(urlLine[0] ?? "", margin, pageH - 8.5)
  }

  // 마지막 페이지 footer
  pageFooter()

  // ── Save ──
  const orderOrCode = meta.orderNumber
    ? sanitizeFilename(meta.orderNumber)
    : sanitizeFilename(state.productCode)
  const outName = `work-instruction-${orderOrCode}-${todayStr}.pdf`
  pdf.save(outName)
}

export default generateWorkInstructionPDF
