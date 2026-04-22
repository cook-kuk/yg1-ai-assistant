// SPDX-License-Identifier: MIT
// YG-1 ARIA Simulator v3 — CNC 치트시트 (빠른 참고표) 패널
// 재질별 권장 Vc/fz, 코팅 효과, 흔한 실수 Top 10, 공구 선택 매트릭스를
// 탭 전환으로 한 화면에서 참조할 수 있는 참고표 컴포넌트.
//
// - cutting-simulator-v2.tsx 와 독립: 상태는 모두 내부 useState
// - 현재 시뮬레이터 선택값(isoGroup/coating/Vc/fz)을 받아 해당 행 강조
// - 다크모드 지원, 반응형 (모바일 세로 스택)
"use client"

import { useMemo, useState } from "react"

// ─────────────────────────────────────────────────────────────────────
// Props
// ─────────────────────────────────────────────────────────────────────

export interface CheatSheetPanelProps {
  /** 현재 사용자 선택 ISO 그룹(P/M/K/N/S/H) — 재질 표 강조용 */
  currentIsoGroup?: string
  /** 현재 사용자 선택 코팅명 — 코팅 탭 강조용 */
  currentCoating?: string
  /** 현재 Vc (m/min) — 범위 체크 */
  currentVc?: number
  /** 현재 fz (mm/tooth) — 범위 체크 */
  currentFz?: number
  darkMode?: boolean
  /** 초기 펼침 여부 (미지정 시 내부 상태로 동작) */
  expanded?: boolean
  /** 외부 제어용 토글 핸들러 */
  onToggle?: () => void
}

// ─────────────────────────────────────────────────────────────────────
// SSOT — 재질별 Vc/fz 표
// ─────────────────────────────────────────────────────────────────────

interface MaterialRow {
  iso: "P" | "M" | "K" | "N" | "S" | "H"
  name: string
  hardnessMax: string
  vcMin: number
  vcMax: number
  fzMin: number
  fzMax: number
  kc: number
  coating: string
  note: string
}

const MATERIAL_TABLE: readonly MaterialRow[] = [
  { iso: "P", name: "탄소강 (S45C, SM45C)", hardnessMax: "HBW 300", vcMin: 150, vcMax: 250, fzMin: 0.04, fzMax: 0.1, kc: 2000, coating: "AlTiN, TiAlN", note: "일반 기계 부품" },
  { iso: "P", name: "합금강 (4140, 42CrMo)", hardnessMax: "HBW 350", vcMin: 120, vcMax: 200, fzMin: 0.03, fzMax: 0.08, kc: 2200, coating: "AlTiN", note: "피로 강도 ↑" },
  { iso: "M", name: "오스테나이트 SS (304/316)", hardnessMax: "HBW 200", vcMin: 90, vcMax: 150, fzMin: 0.03, fzMax: 0.07, kc: 2200, coating: "AlTiN", note: "가공경화 주의 · ae ≥ 30%D" },
  { iso: "M", name: "마르텐사이트 SS (420)", hardnessMax: "HBW 270", vcMin: 80, vcMax: 120, fzMin: 0.03, fzMax: 0.06, kc: 2300, coating: "AlTiN", note: "자성, 내부식" },
  { iso: "K", name: "회주철 (GC200~300)", hardnessMax: "HBW 240", vcMin: 150, vcMax: 250, fzMin: 0.05, fzMax: 0.12, kc: 1200, coating: "TiAlN", note: "분진 주의, dry 가공 가능" },
  { iso: "K", name: "구상흑연주철 (FCD450~600)", hardnessMax: "HBW 280", vcMin: 130, vcMax: 220, fzMin: 0.04, fzMax: 0.1, kc: 1300, coating: "AlTiN", note: "연성↑" },
  { iso: "N", name: "알루미늄 (6061, 7075)", hardnessMax: "HBW 120", vcMin: 400, vcMax: 800, fzMin: 0.05, fzMax: 0.15, kc: 800, coating: "없음/DLC", note: "고속! 코팅 불필요한 경우도" },
  { iso: "N", name: "구리 (C11000)", hardnessMax: "HBW 100", vcMin: 300, vcMax: 500, fzMin: 0.03, fzMax: 0.1, kc: 900, coating: "DLC", note: "끈적함 주의" },
  { iso: "S", name: "인코넬 718", hardnessMax: "HBW 350", vcMin: 30, vcMax: 60, fzMin: 0.015, fzMax: 0.04, kc: 2500, coating: "AlCrN", note: "저속! 절삭유 필수" },
  { iso: "S", name: "티타늄 (Ti-6Al-4V)", hardnessMax: "HBW 340", vcMin: 50, vcMax: 80, fzMin: 0.02, fzMax: 0.05, kc: 2300, coating: "AlCrN", note: "열 집중 · chip thinning 금지" },
  { iso: "H", name: "경화강 45~55 HRC", hardnessMax: "HRC 55", vcMin: 70, vcMax: 120, fzMin: 0.02, fzMax: 0.04, kc: 3000, coating: "AlCrN", note: "진동 · Ball mill 선호" },
  { iso: "H", name: "경화강 55~65 HRC", hardnessMax: "HRC 65", vcMin: 40, vcMax: 80, fzMin: 0.015, fzMax: 0.03, kc: 3500, coating: "AlCrN/nACo", note: "미세 fz 필수" },
]

// ─────────────────────────────────────────────────────────────────────
// SSOT — 코팅 효과
// ─────────────────────────────────────────────────────────────────────

interface CoatingRow {
  name: string
  color: string
  vcMult: number
  lifeMult: number
  bestFor: string
  avoid: string
  temp: string
}

const COATING_TABLE: readonly CoatingRow[] = [
  { name: "없음 (Uncoated)", color: "silver", vcMult: 1.0, lifeMult: 1.0, bestFor: "알루미늄, 구리, CFRP", avoid: "강철 · 스테인리스", temp: "< 400°C" },
  { name: "TiN (Titanium Nitride)", color: "gold", vcMult: 1.1, lifeMult: 1.2, bestFor: "일반 강철 범용", avoid: "고속/고온", temp: "< 500°C" },
  { name: "TiCN", color: "blue-gray", vcMult: 1.15, lifeMult: 1.3, bestFor: "주철, 연강", avoid: "비철", temp: "< 400°C" },
  { name: "AlTiN (보라)", color: "violet", vcMult: 1.35, lifeMult: 1.5, bestFor: "P/M/K 광범위", avoid: "알루미늄", temp: "< 900°C" },
  { name: "AlCrN", color: "dark-blue", vcMult: 1.4, lifeMult: 1.6, bestFor: "고온 (S, H계열)", avoid: "일반 강철에 과도", temp: "< 1100°C" },
  { name: "nACo (AlTiSiN)", color: "black", vcMult: 1.45, lifeMult: 1.7, bestFor: "고경도강 60+HRC", avoid: "비철", temp: "< 1200°C" },
  { name: "DLC (다이아몬드 유사)", color: "black-glossy", vcMult: 1.1, lifeMult: 1.4, bestFor: "알루미늄, 비철, CFRP", avoid: "철강 (Fe와 반응)", temp: "< 600°C" },
  { name: "CVD 다이아몬드", color: "clear", vcMult: 1.3, lifeMult: 3.0, bestFor: "흑연, CFRP, 세라믹", avoid: "철강", temp: "매우 고속 가능" },
]

// ─────────────────────────────────────────────────────────────────────
// SSOT — 실수 Top 10
// ─────────────────────────────────────────────────────────────────────

interface MistakeItem {
  label: string
  detail: string
}

const MISTAKES: readonly MistakeItem[] = [
  { label: "❌ ae > 공구 지름 D → 즉시 파손", detail: "슬로팅 한계 초과. ae ≤ D, 슬롯 가공은 ap를 낮춰 분할 가공." },
  { label: "❌ ap > 2·D → 공구 급격히 휘어짐", detail: "편향(deflection)이 허용치 이상. 롱넥이면 ap ≤ D 권장." },
  { label: "❌ ae/D < 0.15 (chip thinning 영역) + fz 조정 안 함 → rubbing으로 수명 급감", detail: "실제 칩 두께 hex가 fz보다 작아져 날이 문지름. fz를 (D/ae)·√비율로 보정." },
  { label: "❌ 내열합금에 Vc 100+ → 공구 열로 녹음", detail: "S계열은 열전도율 낮아 칩이 열을 못 빼감. Vc 30~60 범위 고수." },
  { label: "❌ Stick-out / D > 6 → chatter 확정", detail: "L/D 비 증가 시 편향 ∝ L³. 짧게 물릴 수 있으면 짧게." },
  { label: "❌ 알루미늄에 강철용 코팅 (AlTiN) → 칩 응착", detail: "AlTiN은 Al과 반응해 BUE 유발. 비철은 Uncoated 또는 DLC." },
  { label: "❌ Climb과 Conventional 섞어 쓰기 → 표면 불안정", detail: "경로 내에서 절삭방향이 뒤집히면 힘 방향이 변해 표면거칠기·치수 오차 발생." },
  { label: "❌ 워크홀딩 허술 + 큰 ap → 편향 > 편심 오차", detail: "공작물이 밀리면 설정 치수가 무의미. 고정력·지지점 확인." },
  { label: "❌ 냉각수 없이 스테인리스 가공 → 경화층 형성", detail: "오스테나이트계는 가공 중 경화(strain hardening). 습식 또는 MQL 필수." },
  { label: "❌ 신규 공구 바로 최대 조건 → 엣지 마이크로 파손", detail: "Run-in: 첫 5~10분은 fz 50~70%로 길들이기. 이후 정격으로 상승." },
]

// ─────────────────────────────────────────────────────────────────────
// SSOT — 공구 선택 매트릭스
// ─────────────────────────────────────────────────────────────────────

type IsoKey = "P" | "M" | "K" | "N" | "S" | "H"
type OpKey = "Slotting" | "Side" | "Finishing" | "Roughing"

const OP_COLUMNS: readonly OpKey[] = ["Slotting", "Side", "Finishing", "Roughing"]
const ISO_ROWS: readonly IsoKey[] = ["P", "M", "K", "N", "S", "H"]

const TOOL_MATRIX: Record<IsoKey, Record<OpKey, string[]>> = {
  P: {
    Slotting: ["GMF 4F Square", "AluPower 3F (연강용)"],
    Side: ["GMG 4F · GME 5F", "SEM H45 Radius"],
    Finishing: ["GMG24 Ball", "SEMD61 Radius"],
    Roughing: ["Rough Power (chipbreaker)", "GMH 6F"],
  },
  M: {
    Slotting: ["GMF 4F Square", "Solid Carbide Slot"],
    Side: ["GMG 5F AlTiN", "SEM H45"],
    Finishing: ["GMG24 Ball", "SEMD61 Radius"],
    Roughing: ["Rough Power AlTiN", "GMH 6F"],
  },
  K: {
    Slotting: ["GMF 4F TiAlN", "Cast-iron Slot"],
    Side: ["GMG 4F TiAlN", "SEM H45"],
    Finishing: ["GMG24 Ball TiAlN", "SEMD61"],
    Roughing: ["Rough Power TiAlN", "GMH 6F"],
  },
  N: {
    Slotting: ["AluPower 2F", "AluPower 3F"],
    Side: ["AluPower 3F", "AluPower 5F DLC"],
    Finishing: ["AluPower Ball DLC", "AluPower Radius"],
    Roughing: ["AluPower Rough 3F", "HF Plunger"],
  },
  S: {
    Slotting: ["X-power AlCrN Slot", "Inox Slot 4F"],
    Side: ["X-power 5F AlCrN", "SEM H45 AlCrN"],
    Finishing: ["X-power Ball AlCrN", "SEMD61 AlCrN"],
    Roughing: ["X-power Rough", "Trochoidal 6F"],
  },
  H: {
    Slotting: ["HM-Power 4F AlCrN", "Hard Slot 2F"],
    Side: ["HM-Power 6F nACo", "H45 Hard"],
    Finishing: ["HM-Power Ball nACo", "SEMD61 nACo"],
    Roughing: ["HM-Power Rough", "Dia-Coat Rough"],
  },
}

// ─────────────────────────────────────────────────────────────────────
// 유틸 — 코팅명 매칭
// ─────────────────────────────────────────────────────────────────────

function normalizeCoating(s: string | undefined): string {
  if (!s) return ""
  return s.toLowerCase().replace(/[^a-z0-9가-힣]/g, "")
}

function coatingMatches(row: string, current: string | undefined): boolean {
  const a = normalizeCoating(row)
  const b = normalizeCoating(current)
  if (!a || !b) return false
  return a === b || a.includes(b) || b.includes(a)
}

// ─────────────────────────────────────────────────────────────────────
// 탭 키
// ─────────────────────────────────────────────────────────────────────

type TabKey = "materials" | "coatings" | "mistakes" | "tool-matrix"

const TABS: readonly { key: TabKey; label: string }[] = [
  { key: "materials", label: "🧱 재질별 Vc/fz" },
  { key: "coatings", label: "💎 코팅 효과" },
  { key: "mistakes", label: "⚠ 실수 Top 10" },
  { key: "tool-matrix", label: "🔧 공구 선택" },
]

// ─────────────────────────────────────────────────────────────────────
// 컴포넌트
// ─────────────────────────────────────────────────────────────────────

export default function CheatSheetPanel({
  currentIsoGroup,
  currentCoating,
  currentVc,
  currentFz,
  darkMode = false,
  expanded,
  onToggle,
}: CheatSheetPanelProps) {
  // expanded 제어: 외부에서 prop으로 주어지면 controlled, 아니면 내부 상태
  const isControlled = typeof expanded === "boolean"
  const [internalExpanded, setInternalExpanded] = useState<boolean>(true)
  const isOpen = isControlled ? (expanded as boolean) : internalExpanded
  const toggle = () => {
    if (onToggle) onToggle()
    if (!isControlled) setInternalExpanded(p => !p)
  }

  const [tab, setTab] = useState<TabKey>("materials")

  // ── 카드 외곽 ─────────────────────────────────────────────────────
  const cardCls = useMemo(() => {
    if (darkMode) {
      return "rounded-xl border border-slate-700 bg-gradient-to-br from-slate-900 to-indigo-950/30 p-4 sm:p-5"
    }
    return "rounded-xl border border-slate-200 bg-gradient-to-br from-slate-50 to-indigo-50/30 p-4 sm:p-5"
  }, [darkMode])

  const headerTextCls = darkMode ? "text-slate-100" : "text-slate-800"
  const subtleTextCls = darkMode ? "text-slate-400" : "text-slate-500"
  const borderCls = darkMode ? "border-slate-700" : "border-slate-200"

  return (
    <section className={cardCls} aria-label="CNC 치트시트">
      {/* ── 헤더 ───────────────────────────────────────────────── */}
      <header className="flex flex-wrap items-center gap-2">
        <span className="text-xl leading-none" aria-hidden>📋</span>
        <h3 className={`text-base font-semibold ${headerTextCls}`}>CNC 치트시트</h3>
        <span
          className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold ${
            darkMode
              ? "bg-indigo-900/40 text-indigo-300 border-indigo-700"
              : "bg-indigo-100 text-indigo-700 border-indigo-300"
          }`}
        >
          빠른 참고표
        </span>

        {/* 탭 버튼 (펼쳤을 때만) */}
        {isOpen && (
          <div className="order-3 flex w-full flex-wrap gap-1 sm:order-none sm:ml-3 sm:w-auto">
            {TABS.map(t => {
              const active = tab === t.key
              return (
                <button
                  key={t.key}
                  type="button"
                  onClick={() => setTab(t.key)}
                  aria-pressed={active}
                  className={`rounded-md border px-2 py-1 text-[11px] font-medium transition-colors ${
                    active
                      ? darkMode
                        ? "border-indigo-500 bg-indigo-900/40 text-indigo-200"
                        : "border-indigo-400 bg-indigo-100 text-indigo-800"
                      : darkMode
                        ? "border-slate-700 bg-slate-800/60 text-slate-300 hover:bg-slate-700"
                        : "border-slate-200 bg-white text-slate-600 hover:bg-slate-100"
                  }`}
                >
                  {t.label}
                </button>
              )
            })}
          </div>
        )}

        <button
          type="button"
          onClick={toggle}
          aria-expanded={isOpen}
          aria-label={isOpen ? "접기" : "펼치기"}
          className={`ml-auto inline-flex h-7 w-7 items-center justify-center rounded-md border text-sm transition-colors ${
            darkMode
              ? "border-slate-700 bg-slate-800 text-slate-200 hover:bg-slate-700"
              : "border-slate-200 bg-white text-slate-600 hover:bg-slate-100"
          }`}
        >
          {isOpen ? "▾" : "▸"}
        </button>
      </header>

      {/* ── 본문 ───────────────────────────────────────────────── */}
      {isOpen && (
        <div className="mt-4">
          {tab === "materials" && (
            <MaterialsTab
              currentIsoGroup={currentIsoGroup}
              currentVc={currentVc}
              currentFz={currentFz}
              darkMode={darkMode}
            />
          )}
          {tab === "coatings" && (
            <CoatingsTab currentCoating={currentCoating} darkMode={darkMode} />
          )}
          {tab === "mistakes" && <MistakesTab darkMode={darkMode} />}
          {tab === "tool-matrix" && (
            <ToolMatrixTab currentIsoGroup={currentIsoGroup} darkMode={darkMode} />
          )}

          {/* 하단 공통 주석 */}
          <p className={`mt-3 text-[10px] ${subtleTextCls}`}>
            참고용 — 실제 적용 전 카탈로그 및 기계 사양(스핀들 파워·강성) 확인 필수.
          </p>
        </div>
      )}

      {/* 접혔을 때 보조 표시 */}
      {!isOpen && (
        <p className={`mt-2 text-[11px] ${subtleTextCls}`}>
          재질별 Vc/fz · 코팅 효과 · 실수 Top 10 · 공구 매트릭스 — 탭으로 참조
          <span className={`mx-1 ${borderCls}`}>·</span>
          펼치려면 ▸
        </p>
      )}
    </section>
  )
}

// ─────────────────────────────────────────────────────────────────────
// Tab 1 — 재질별 Vc/fz
// ─────────────────────────────────────────────────────────────────────

function MaterialsTab({
  currentIsoGroup,
  currentVc,
  currentFz,
  darkMode,
}: {
  currentIsoGroup?: string
  currentVc?: number
  currentFz?: number
  darkMode: boolean
}) {
  const thCls = darkMode
    ? "bg-slate-800/80 text-slate-300 border-slate-700"
    : "bg-slate-100 text-slate-600 border-slate-200"
  const tdBase = darkMode
    ? "border-slate-700 text-slate-200"
    : "border-slate-200 text-slate-700"

  const isoLabel = currentIsoGroup?.toUpperCase()

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[760px] border-collapse text-[11px] sm:text-[12px]">
        <thead>
          <tr>
            {["ISO", "재질", "경도(max)", "Vc (m/min)", "fz (mm/t)", "kc (N/mm²)", "권장 코팅", "특이사항"].map(h => (
              <th
                key={h}
                className={`border px-2 py-1.5 text-left font-semibold ${thCls}`}
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {MATERIAL_TABLE.map((row, idx) => {
            const isCurrentIso = isoLabel && row.iso === isoLabel
            // 현재 Vc/fz 범위 밖이면 해당 행에 경고 스타일
            const vcOut =
              isCurrentIso &&
              typeof currentVc === "number" &&
              (currentVc < row.vcMin || currentVc > row.vcMax)
            const fzOut =
              isCurrentIso &&
              typeof currentFz === "number" &&
              (currentFz < row.fzMin || currentFz > row.fzMax)
            const outOfRange = Boolean(vcOut || fzOut)

            const rowBg = isCurrentIso
              ? darkMode
                ? "bg-amber-900/20"
                : "bg-amber-50"
              : idx % 2 === 0
                ? darkMode
                  ? "bg-slate-900/40"
                  : "bg-white"
                : darkMode
                  ? "bg-slate-900/10"
                  : "bg-slate-50/60"

            const textColor = outOfRange
              ? darkMode
                ? "text-rose-300"
                : "text-rose-700"
              : ""

            return (
              <tr key={`${row.iso}-${row.name}`} className={`${rowBg} ${textColor}`}>
                <td className={`border px-2 py-1.5 font-semibold ${tdBase}`}>
                  {isCurrentIso && <span className="mr-1" aria-hidden>💡</span>}
                  {row.iso}
                </td>
                <td className={`border px-2 py-1.5 ${tdBase}`}>{row.name}</td>
                <td className={`border px-2 py-1.5 tabular-nums ${tdBase}`}>{row.hardnessMax}</td>
                <td className={`border px-2 py-1.5 font-mono tabular-nums ${tdBase}`}>
                  {row.vcMin}–{row.vcMax}
                </td>
                <td className={`border px-2 py-1.5 font-mono tabular-nums ${tdBase}`}>
                  {row.fzMin.toFixed(3)}–{row.fzMax.toFixed(3)}
                </td>
                <td className={`border px-2 py-1.5 font-mono tabular-nums ${tdBase}`}>{row.kc}</td>
                <td className={`border px-2 py-1.5 ${tdBase}`}>{row.coating}</td>
                <td className={`border px-2 py-1.5 ${tdBase}`}>{row.note}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
      {isoLabel && (
        <p
          className={`mt-2 text-[11px] ${
            darkMode ? "text-amber-300" : "text-amber-700"
          }`}
        >
          💡 현재 선택된 ISO 그룹: <b>{isoLabel}</b>
          {typeof currentVc === "number" && (
            <>
              {" "}· Vc ={" "}
              <span className="font-mono">{currentVc.toFixed(0)} m/min</span>
            </>
          )}
          {typeof currentFz === "number" && (
            <>
              {" "}· fz ={" "}
              <span className="font-mono">{currentFz.toFixed(3)} mm/t</span>
            </>
          )}
          <span className="ml-1">— 범위 밖 행은 빨간색으로 표시됩니다.</span>
        </p>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────
// Tab 2 — 코팅 효과
// ─────────────────────────────────────────────────────────────────────

function CoatingsTab({
  currentCoating,
  darkMode,
}: {
  currentCoating?: string
  darkMode: boolean
}) {
  return (
    <div className="grid grid-cols-1 items-stretch gap-2 sm:grid-cols-2 lg:grid-cols-3">
      {COATING_TABLE.map(c => {
        const active = coatingMatches(c.name, currentCoating)
        const cardCls = active
          ? darkMode
            ? "border-indigo-500 bg-indigo-900/30"
            : "border-indigo-400 bg-indigo-50"
          : darkMode
            ? "border-slate-700 bg-slate-800/60"
            : "border-slate-200 bg-white"
        return (
          <div
            key={c.name}
            className={`flex h-full min-w-0 flex-col gap-1 rounded-lg border p-3 ${cardCls}`}
          >
            <div className="flex items-center justify-between gap-2 min-w-0">
              <span
                className={`truncate font-semibold min-w-0 ${
                  darkMode ? "text-slate-100" : "text-slate-800"
                }`}
                title={c.name}
              >
                {active && <span className="mr-1" aria-hidden>💡</span>}
                {c.name}
              </span>
              <span
                className={`flex-shrink-0 whitespace-nowrap rounded-full border px-1.5 py-0.5 text-[10px] ${
                  darkMode
                    ? "border-slate-600 text-slate-300"
                    : "border-slate-200 text-slate-500"
                }`}
              >
                {c.color}
              </span>
            </div>

            <div className="mt-1 flex gap-2 text-[11px]">
              <span
                className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 font-mono ${
                  darkMode
                    ? "bg-emerald-900/40 text-emerald-300"
                    : "bg-emerald-50 text-emerald-700"
                }`}
              >
                Vc ×{c.vcMult.toFixed(2)}
              </span>
              <span
                className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 font-mono ${
                  darkMode
                    ? "bg-sky-900/40 text-sky-300"
                    : "bg-sky-50 text-sky-700"
                }`}
              >
                수명 ×{c.lifeMult.toFixed(2)}
              </span>
            </div>

            <ul
              className={`mt-1 space-y-0.5 text-[11px] break-words ${
                darkMode ? "text-slate-300" : "text-slate-600"
              }`}
            >
              <li>
                <b className={darkMode ? "text-emerald-300" : "text-emerald-700"}>
                  ✓ 적합:
                </b>{" "}
                {c.bestFor}
              </li>
              <li>
                <b className={darkMode ? "text-rose-300" : "text-rose-700"}>
                  ✗ 회피:
                </b>{" "}
                {c.avoid}
              </li>
              <li>
                <b>🌡 내온도:</b> {c.temp}
              </li>
            </ul>
          </div>
        )
      })}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────
// Tab 3 — 실수 Top 10
// ─────────────────────────────────────────────────────────────────────

function MistakesTab({ darkMode }: { darkMode: boolean }) {
  const [openIdx, setOpenIdx] = useState<number | null>(null)

  return (
    <ol className="space-y-2">
      {MISTAKES.map((m, i) => {
        const isOpen = openIdx === i
        const itemCls = darkMode
          ? "border-rose-800/70 bg-rose-900/20 text-rose-200"
          : "border-rose-200 bg-rose-50 text-rose-800"
        return (
          <li key={i} className={`rounded-md border ${itemCls}`}>
            <button
              type="button"
              onClick={() => setOpenIdx(prev => (prev === i ? null : i))}
              aria-expanded={isOpen}
              className="flex w-full items-start gap-2 px-3 py-2 text-left text-[12px] leading-snug"
            >
              <span
                className={`mt-[1px] inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold ${
                  darkMode
                    ? "bg-rose-800 text-rose-100"
                    : "bg-rose-200 text-rose-800"
                }`}
              >
                {i + 1}
              </span>
              <span className="flex-1">{m.label}</span>
              <span className="ml-1 text-[10px] opacity-60">{isOpen ? "▾" : "▸"}</span>
            </button>
            {isOpen && (
              <div
                className={`border-t px-3 py-2 text-[11px] leading-relaxed ${
                  darkMode
                    ? "border-rose-800/70 text-rose-100"
                    : "border-rose-200 text-rose-700"
                }`}
              >
                {m.detail}
              </div>
            )}
          </li>
        )
      })}
    </ol>
  )
}

// ─────────────────────────────────────────────────────────────────────
// Tab 4 — 공구 선택 매트릭스
// ─────────────────────────────────────────────────────────────────────

function ToolMatrixTab({
  currentIsoGroup,
  darkMode,
}: {
  currentIsoGroup?: string
  darkMode: boolean
}) {
  const thCls = darkMode
    ? "bg-slate-800/80 text-slate-300 border-slate-700"
    : "bg-slate-100 text-slate-600 border-slate-200"
  const cellBase = darkMode
    ? "border-slate-700 text-slate-200"
    : "border-slate-200 text-slate-700"

  const isoLabel = currentIsoGroup?.toUpperCase() as IsoKey | undefined

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] border-collapse text-[11px] sm:text-[12px]">
        <thead>
          <tr>
            <th className={`border px-2 py-1.5 text-left font-semibold ${thCls}`}>
              ISO \ 가공
            </th>
            {OP_COLUMNS.map(op => (
              <th
                key={op}
                className={`border px-2 py-1.5 text-left font-semibold ${thCls}`}
              >
                {op}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {ISO_ROWS.map(iso => {
            const isCurrent = isoLabel && iso === isoLabel
            const rowBg = isCurrent
              ? darkMode
                ? "bg-amber-900/20"
                : "bg-amber-50"
              : darkMode
                ? "bg-slate-900/30"
                : "bg-white"
            return (
              <tr key={iso} className={rowBg}>
                <td className={`border px-2 py-1.5 font-semibold ${cellBase}`}>
                  {isCurrent && <span className="mr-1" aria-hidden>💡</span>}
                  {iso}
                </td>
                {OP_COLUMNS.map(op => {
                  const items = TOOL_MATRIX[iso][op]
                  return (
                    <td key={op} className={`border px-2 py-1.5 align-top ${cellBase}`}>
                      <ul className="list-disc space-y-0.5 pl-4">
                        {items.map(it => (
                          <li key={it} className="leading-snug">
                            {it}
                          </li>
                        ))}
                      </ul>
                    </td>
                  )
                })}
              </tr>
            )
          })}
        </tbody>
      </table>
      <p
        className={`mt-2 text-[10px] ${
          darkMode ? "text-slate-400" : "text-slate-500"
        }`}
      >
        YG-1 카탈로그 시리즈 기반 추천. 현장 조건(냉각/강성/L:D)에 맞춰 조정 필요.
      </p>
    </div>
  )
}
