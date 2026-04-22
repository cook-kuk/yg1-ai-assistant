// SPDX-License-Identifier: MIT
// YG-1 ARIA Simulator v3 — Cyberpunk HUD Overlay
// 화면 모서리에 SF 영화 HUD 요소를 overlay (타겟팅 레티클, 데이터 스트림,
// 상태 인디케이터, 미니 레이다). 우주선 조종석 느낌.
// cutting-simulator-v2.tsx 는 건드리지 않고 별도 overlay 로 합성됨.
// decorative only · pointer-events-none · aria-hidden · prefers-reduced-motion 대응.
"use client"

import * as React from "react"

// ─────────────────────────────────────────────
// 로컬 SSOT (하드코딩 금지 — 모든 매직넘버는 상수)
// ─────────────────────────────────────────────
const Z_INDEX = 30

// 코너 브래킷
const CORNER_BRACKET_SIZE = 40
const CORNER_BRACKET_STROKE = 2
const CORNER_BRACKET_INSET = 12

// 좌상단 HUD
const HUD_TITLE = "YG-1 ARIA v3"
const HUD_PANEL_MIN_WIDTH = 180

// Mini Radar
const RADAR_SIZE = 50
const RADAR_DOT_BASE = 2
const RADAR_DOT_MAX_BY_LEVEL: Record<ChatterLevel, number> = {
  low: 2,
  med: 4,
  high: 6,
}
const RADAR_SWEEP_DURATION_S = 3

// Data Stream (matrix)
const DATA_STREAM_ROWS = 14
const DATA_STREAM_ANIM_S = 12

// Status Bars
const STATUS_BAR_HEIGHT = 4
const STATUS_BAR_WIDTH = 96
const STATUS_DANGER_THRESHOLD = 0.85
const STATUS_WARN_THRESHOLD = 0.65

// Scanline
const SCANLINE_DURATION_S = 8
const SCANLINE_OPACITY = 0.05

// 시간 업데이트
const CLOCK_TICK_MS = 1000

// 정규화 기준 (props 단위 → 백분율)
const RPM_REF = 12000 // rpm 풀스케일 기준
const VF_REF = 5000 // mm/min 풀스케일
const PC_REF = 10 // kW 풀스케일

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────
export type ChatterLevel = "low" | "med" | "high"
export type CyberpunkTheme = "cyan" | "amber" | "rose"

export interface CyberpunkHudProps {
  rpm: number
  Vf: number
  Pc: number
  chatterLevel: ChatterLevel
  mode: string // "LIVE" | "IDLE" | "ALERT" (자유 string 허용)
  darkMode?: boolean
  theme?: CyberpunkTheme
  /** true 면 4 코너 브래킷만 표시, 나머지 HUD 요소는 숨김 */
  cornerOnly?: boolean
}

// ─────────────────────────────────────────────
// 테마 팔레트
// ─────────────────────────────────────────────
interface ThemePalette {
  hex: string
  rgb: string // "r, g, b"
  dim: string
  glow: string
  warn: string
  danger: string
}

const THEME_PALETTE: Record<CyberpunkTheme, ThemePalette> = {
  cyan: {
    hex: "#22d3ee",
    rgb: "34, 211, 238",
    dim: "rgba(34, 211, 238, 0.45)",
    glow: "rgba(34, 211, 238, 0.85)",
    warn: "#f59e0b",
    danger: "#f43f5e",
  },
  amber: {
    hex: "#f59e0b",
    rgb: "245, 158, 11",
    dim: "rgba(245, 158, 11, 0.45)",
    glow: "rgba(245, 158, 11, 0.85)",
    warn: "#f97316",
    danger: "#f43f5e",
  },
  rose: {
    hex: "#f43f5e",
    rgb: "244, 63, 94",
    dim: "rgba(244, 63, 94, 0.45)",
    glow: "rgba(244, 63, 94, 0.85)",
    warn: "#f59e0b",
    danger: "#dc2626",
  },
}

// ─────────────────────────────────────────────
// 유틸
// ─────────────────────────────────────────────
function clamp01(x: number): number {
  if (!Number.isFinite(x)) return 0
  if (x < 0) return 0
  if (x > 1) return 1
  return x
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n)
}

function fmtClock(d: Date): string {
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`
}

// 간단한 결정론적 PRNG (chatterLevel 시드로 dot 위치 안정화)
function seededRandom(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 0xffffffff
  }
}

// chatterLevel → 위협도 색상 분포
function dotColorFor(idx: number, level: ChatterLevel, palette: ThemePalette): string {
  if (level === "high") {
    return idx % 3 === 0 ? palette.danger : palette.warn
  }
  if (level === "med") {
    return idx % 2 === 0 ? palette.warn : palette.hex
  }
  return palette.hex
}

// ─────────────────────────────────────────────
// 컴포넌트
// ─────────────────────────────────────────────
function CyberpunkHud(props: CyberpunkHudProps): React.ReactElement | null {
  const {
    rpm,
    Vf,
    Pc,
    chatterLevel,
    mode,
    darkMode = false,
    theme = "cyan",
    cornerOnly = false,
  } = props

  const palette = THEME_PALETTE[theme]

  // SSR guard — 브라우저가 아니면 아무것도 렌더링하지 않음 (시간/애니메이션 모두 client-only).
  const [mounted, setMounted] = React.useState(false)
  React.useEffect(() => {
    setMounted(true)
  }, [])

  // 시계 (1s 업데이트)
  const [now, setNow] = React.useState<Date>(() => new Date())
  React.useEffect(() => {
    if (typeof window === "undefined") return
    const id = window.setInterval(() => setNow(new Date()), CLOCK_TICK_MS)
    return () => window.clearInterval(id)
  }, [])

  // reduced motion 감지 (한번만)
  const [reducedMotion, setReducedMotion] = React.useState(false)
  React.useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)")
    setReducedMotion(mq.matches)
    const handler = (e: MediaQueryListEvent) => setReducedMotion(e.matches)
    mq.addEventListener?.("change", handler)
    return () => mq.removeEventListener?.("change", handler)
  }, [])

  // 정규화 비율 (status bar)
  const rpmPct = clamp01(rpm / RPM_REF)
  const vfPct = clamp01(Vf / VF_REF)
  const pcPct = clamp01(Pc / PC_REF)

  // 파생: vc (대략 표시용 — 실제 공식은 cutting-simulator 가 관리)
  // Vc ≈ π·D·n / 1000, 여기서는 D 를 모르므로 rpm 기반 근사 readout만 보여줌.
  const vcDisplay = Math.round(rpm * 0.0314) // decorative only

  // radar dots (chatterLevel 에 따라 수 변동, 위치는 결정론적)
  const radarDots = React.useMemo(() => {
    const count = RADAR_DOT_MAX_BY_LEVEL[chatterLevel] ?? RADAR_DOT_BASE
    const seed = chatterLevel === "high" ? 7 : chatterLevel === "med" ? 3 : 1
    const rnd = seededRandom(seed)
    const arr: Array<{ cx: number; cy: number; color: string; r: number }> = []
    const center = RADAR_SIZE / 2
    const maxR = RADAR_SIZE / 2 - 4
    for (let i = 0; i < count; i++) {
      const angle = rnd() * Math.PI * 2
      const radius = rnd() * maxR
      arr.push({
        cx: center + Math.cos(angle) * radius,
        cy: center + Math.sin(angle) * radius,
        color: dotColorFor(i, chatterLevel, palette),
        r: 1.2 + rnd() * 0.8,
      })
    }
    return arr
  }, [chatterLevel, palette])

  if (!mounted) return null

  // 테마 색 CSS 변수
  const styleVars: React.CSSProperties = {
    // CSS custom properties (typed loosely via Record)
    ...({
      "--hud-accent": palette.hex,
      "--hud-accent-rgb": palette.rgb,
      "--hud-dim": palette.dim,
      "--hud-glow": palette.glow,
      "--hud-warn": palette.warn,
      "--hud-danger": palette.danger,
      "--hud-text": darkMode ? "#e2e8f0" : "#0f172a",
      "--hud-panel-bg": darkMode ? "rgba(2, 6, 23, 0.55)" : "rgba(255, 255, 255, 0.35)",
    } as Record<string, string>),
  }

  const showBody = !cornerOnly
  const showReticle = !cornerOnly && mode.toUpperCase() === "ALERT"

  return (
    <div
      aria-hidden="true"
      className="cyberpunk-hud-root"
      style={styleVars}
    >
      <style>{hudStyles(reducedMotion)}</style>

      {/* ── 4 코너 브래킷 ─────────────────────────────── */}
      <CornerBracket position="tl" />
      <CornerBracket position="tr" />
      <CornerBracket position="bl" />
      <CornerBracket position="br" />

      {showBody && (
        <>
          {/* ── 좌상단 HUD 패널 ────────────────────────── */}
          <div className="hud-panel hud-panel--tl">
            <svg
              width={10}
              height={18}
              viewBox="0 0 10 18"
              className="hud-bracket"
              role="presentation"
            >
              <path
                d="M8 1 H2 V17 H8"
                fill="none"
                stroke="currentColor"
                strokeWidth={1.5}
                strokeLinecap="square"
              />
            </svg>
            <div className="hud-panel-body">
              <div className="hud-title">{HUD_TITLE}</div>
              <div className={`hud-mode hud-mode--${modeClass(mode)}`}>
                <span className="hud-mode-dot" />
                MODE: {mode.toUpperCase()}
              </div>
              <div className="hud-readout">
                <span>SYS</span>
                <span className="hud-num">{fmtClock(now)}</span>
              </div>
              <div className="hud-readout">
                <span>N</span>
                <span className="hud-num">{Math.round(rpm).toString().padStart(5, "0")}</span>
              </div>
              <div className="hud-readout">
                <span>VF</span>
                <span className="hud-num">{Math.round(Vf).toString().padStart(5, "0")}</span>
              </div>
            </div>
            <svg
              width={10}
              height={18}
              viewBox="0 0 10 18"
              className="hud-bracket hud-bracket--right"
              role="presentation"
            >
              <path
                d="M2 1 H8 V17 H2"
                fill="none"
                stroke="currentColor"
                strokeWidth={1.5}
                strokeLinecap="square"
              />
            </svg>
          </div>

          {/* ── 우상단 Mini Radar ─────────────────────── */}
          <div className="hud-radar">
            <svg
              width={RADAR_SIZE}
              height={RADAR_SIZE}
              viewBox={`0 0 ${RADAR_SIZE} ${RADAR_SIZE}`}
              role="presentation"
            >
              <defs>
                <radialGradient id="hud-radar-bg" cx="50%" cy="50%" r="50%">
                  <stop offset="0%" stopColor={`rgba(${palette.rgb}, 0.25)`} />
                  <stop offset="100%" stopColor={`rgba(${palette.rgb}, 0.02)`} />
                </radialGradient>
                <linearGradient id="hud-radar-sweep" x1="0" y1="0" x2="1" y2="0">
                  <stop offset="0%" stopColor={`rgba(${palette.rgb}, 0)`} />
                  <stop offset="100%" stopColor={`rgba(${palette.rgb}, 0.85)`} />
                </linearGradient>
              </defs>
              {/* 배경 + 링 */}
              <circle
                cx={RADAR_SIZE / 2}
                cy={RADAR_SIZE / 2}
                r={RADAR_SIZE / 2 - 1}
                fill="url(#hud-radar-bg)"
                stroke={palette.dim}
                strokeWidth={1}
              />
              <circle
                cx={RADAR_SIZE / 2}
                cy={RADAR_SIZE / 2}
                r={RADAR_SIZE / 3}
                fill="none"
                stroke={palette.dim}
                strokeWidth={0.5}
              />
              <circle
                cx={RADAR_SIZE / 2}
                cy={RADAR_SIZE / 2}
                r={RADAR_SIZE / 6}
                fill="none"
                stroke={palette.dim}
                strokeWidth={0.5}
              />
              {/* 십자 */}
              <line
                x1={RADAR_SIZE / 2}
                y1={2}
                x2={RADAR_SIZE / 2}
                y2={RADAR_SIZE - 2}
                stroke={palette.dim}
                strokeWidth={0.5}
              />
              <line
                x1={2}
                y1={RADAR_SIZE / 2}
                x2={RADAR_SIZE - 2}
                y2={RADAR_SIZE / 2}
                stroke={palette.dim}
                strokeWidth={0.5}
              />
              {/* 스윕 */}
              <g
                className="hud-radar-sweep-group"
                style={{ transformOrigin: `${RADAR_SIZE / 2}px ${RADAR_SIZE / 2}px` }}
              >
                <path
                  d={`M${RADAR_SIZE / 2} ${RADAR_SIZE / 2} L${RADAR_SIZE - 2} ${RADAR_SIZE / 2} A${RADAR_SIZE / 2 - 2} ${RADAR_SIZE / 2 - 2} 0 0 0 ${RADAR_SIZE / 2} ${RADAR_SIZE / 2 - (RADAR_SIZE / 2 - 2)} Z`}
                  fill="url(#hud-radar-sweep)"
                  opacity={0.55}
                />
              </g>
              {/* dots */}
              {radarDots.map((d, i) => (
                <circle
                  key={i}
                  cx={d.cx}
                  cy={d.cy}
                  r={d.r}
                  fill={d.color}
                  className="hud-radar-dot"
                />
              ))}
            </svg>
          </div>

          {/* ── 좌하단 Data Stream (matrix) ──────────── */}
          <div className="hud-datastream">
            <div className="hud-datastream-inner">
              {Array.from({ length: DATA_STREAM_ROWS }).map((_, i) => (
                <div className="hud-datastream-row" key={i}>
                  {`Vc=${vcDisplay}m/min | n=${Math.round(rpm)}rpm | Vf=${Math.round(Vf)}mm/min | Pc=${Pc.toFixed(2)}kW | c=${chatterLevel}`}
                </div>
              ))}
            </div>
          </div>

          {/* ── 우하단 Status Bars ─────────────────── */}
          <div className="hud-status">
            <StatusBar label="RPM" pct={rpmPct} />
            <StatusBar label="VF" pct={vfPct} />
            <StatusBar label="PC" pct={pcPct} />
          </div>

          {/* ── 중앙 Crosshair (ALERT 전용) ────────── */}
          {showReticle && (
            <div className="hud-reticle">
              <svg width={36} height={36} viewBox="0 0 36 36" role="presentation">
                <circle
                  cx={18}
                  cy={18}
                  r={14}
                  fill="none"
                  stroke={palette.danger}
                  strokeWidth={1}
                  strokeDasharray="2 2"
                />
                <line x1={18} y1={2} x2={18} y2={12} stroke={palette.danger} strokeWidth={1.5} />
                <line x1={18} y1={24} x2={18} y2={34} stroke={palette.danger} strokeWidth={1.5} />
                <line x1={2} y1={18} x2={12} y2={18} stroke={palette.danger} strokeWidth={1.5} />
                <line x1={24} y1={18} x2={34} y2={18} stroke={palette.danger} strokeWidth={1.5} />
                <circle cx={18} cy={18} r={1.5} fill={palette.danger} />
              </svg>
            </div>
          )}

          {/* ── Scanline ──────────────────────────── */}
          <div className="hud-scanline" />
        </>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────
// 서브 컴포넌트
// ─────────────────────────────────────────────
function CornerBracket(props: { position: "tl" | "tr" | "bl" | "br" }): React.ReactElement {
  const s = CORNER_BRACKET_SIZE
  const t = CORNER_BRACKET_STROKE
  // 각 코너별 path — L자 모양
  let d = ""
  switch (props.position) {
    case "tl":
      d = `M${s} ${t / 2} H${t / 2} V${s}`
      break
    case "tr":
      d = `M0 ${t / 2} H${s - t / 2} V${s}`
      break
    case "bl":
      d = `M${t / 2} 0 V${s - t / 2} H${s}`
      break
    case "br":
      d = `M0 ${s - t / 2} H${s - t / 2} V0`
      break
  }
  return (
    <svg
      className={`hud-corner hud-corner--${props.position}`}
      width={s}
      height={s}
      viewBox={`0 0 ${s} ${s}`}
      role="presentation"
    >
      <path d={d} fill="none" stroke="currentColor" strokeWidth={t} strokeLinecap="square" />
    </svg>
  )
}

function StatusBar(props: { label: string; pct: number }): React.ReactElement {
  const { label, pct } = props
  const danger = pct >= STATUS_DANGER_THRESHOLD
  const warn = !danger && pct >= STATUS_WARN_THRESHOLD
  const cls = danger ? "danger" : warn ? "warn" : "ok"
  return (
    <div className={`hud-status-bar hud-status-bar--${cls}`}>
      <span className="hud-status-label">{label}</span>
      <div className="hud-status-track">
        <div
          className="hud-status-fill"
          style={{ width: `${(pct * 100).toFixed(1)}%` }}
        />
      </div>
      <span className="hud-status-num">{Math.round(pct * 100)}%</span>
    </div>
  )
}

function modeClass(mode: string): string {
  const m = mode.toUpperCase()
  if (m === "ALERT") return "alert"
  if (m === "IDLE") return "idle"
  return "live"
}

// ─────────────────────────────────────────────
// CSS (component-scoped via root class)
// ─────────────────────────────────────────────
function hudStyles(reducedMotion: boolean): string {
  const anim = reducedMotion ? "none" : undefined
  return `
.cyberpunk-hud-root {
  position: fixed;
  inset: 0;
  z-index: ${Z_INDEX};
  pointer-events: none;
  color: var(--hud-accent);
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
}

/* ── Corner brackets ─────────────────────────── */
.cyberpunk-hud-root .hud-corner {
  position: fixed;
  color: var(--hud-accent);
  filter: drop-shadow(0 0 4px var(--hud-glow));
  opacity: 0.9;
}
.cyberpunk-hud-root .hud-corner--tl { top: ${CORNER_BRACKET_INSET}px; left: ${CORNER_BRACKET_INSET}px; }
.cyberpunk-hud-root .hud-corner--tr { top: ${CORNER_BRACKET_INSET}px; right: ${CORNER_BRACKET_INSET}px; }
.cyberpunk-hud-root .hud-corner--bl { bottom: ${CORNER_BRACKET_INSET}px; left: ${CORNER_BRACKET_INSET}px; }
.cyberpunk-hud-root .hud-corner--br { bottom: ${CORNER_BRACKET_INSET}px; right: ${CORNER_BRACKET_INSET}px; }

/* ── 좌상단 HUD panel ───────────────────────── */
.cyberpunk-hud-root .hud-panel {
  position: fixed;
  top: ${CORNER_BRACKET_INSET + 8}px;
  display: flex;
  align-items: stretch;
  gap: 6px;
  padding: 6px 10px;
  min-width: ${HUD_PANEL_MIN_WIDTH}px;
  background: var(--hud-panel-bg);
  backdrop-filter: blur(6px);
  -webkit-backdrop-filter: blur(6px);
  border: 1px solid rgba(var(--hud-accent-rgb), 0.45);
  border-radius: 2px;
  color: var(--hud-accent);
  font-size: 10px;
  line-height: 1.4;
  letter-spacing: 0.04em;
  box-shadow: 0 0 18px rgba(var(--hud-accent-rgb), 0.18), inset 0 0 8px rgba(var(--hud-accent-rgb), 0.12);
}
.cyberpunk-hud-root .hud-panel--tl { left: ${CORNER_BRACKET_INSET + 48}px; }
.cyberpunk-hud-root .hud-bracket { color: var(--hud-accent); flex: 0 0 auto; align-self: center; }
.cyberpunk-hud-root .hud-panel-body { display: flex; flex-direction: column; gap: 2px; flex: 1 1 auto; }
.cyberpunk-hud-root .hud-title {
  font-weight: 700;
  font-size: 11px;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--hud-accent);
  text-shadow: 0 0 6px var(--hud-glow);
}
.cyberpunk-hud-root .hud-mode {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 1px 6px;
  width: fit-content;
  border: 1px solid currentColor;
  border-radius: 9999px;
  font-size: 9px;
  letter-spacing: 0.12em;
}
.cyberpunk-hud-root .hud-mode-dot {
  width: 6px;
  height: 6px;
  border-radius: 9999px;
  background: currentColor;
  box-shadow: 0 0 6px currentColor;
  animation: ${anim ?? "hud-pulse 1.6s ease-in-out infinite"};
}
.cyberpunk-hud-root .hud-mode--live { color: #22c55e; }
.cyberpunk-hud-root .hud-mode--idle { color: var(--hud-accent); }
.cyberpunk-hud-root .hud-mode--alert { color: var(--hud-danger); }
.cyberpunk-hud-root .hud-readout {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  font-size: 10px;
  color: rgba(var(--hud-accent-rgb), 0.75);
}
.cyberpunk-hud-root .hud-num {
  font-variant-numeric: tabular-nums;
  letter-spacing: 0.06em;
  color: var(--hud-accent);
  text-shadow: 0 0 4px var(--hud-glow);
}

/* ── 우상단 radar ──────────────────────────── */
.cyberpunk-hud-root .hud-radar {
  position: fixed;
  top: ${CORNER_BRACKET_INSET + 8}px;
  right: ${CORNER_BRACKET_INSET + 48}px;
  filter: drop-shadow(0 0 6px var(--hud-glow));
}
.cyberpunk-hud-root .hud-radar-sweep-group {
  animation: ${anim ?? `hud-radar-sweep ${RADAR_SWEEP_DURATION_S}s linear infinite`};
  transform-box: fill-box;
}
.cyberpunk-hud-root .hud-radar-dot {
  animation: ${anim ?? "hud-dot-blink 1.4s ease-in-out infinite"};
}

/* ── 좌하단 data stream (matrix) ───────────── */
.cyberpunk-hud-root .hud-datastream {
  position: fixed;
  left: ${CORNER_BRACKET_INSET + 4}px;
  bottom: ${CORNER_BRACKET_INSET + 48}px;
  width: 260px;
  height: 160px;
  overflow: hidden;
  opacity: 0.5;
  mask-image: linear-gradient(to bottom, transparent 0%, black 20%, black 80%, transparent 100%);
  -webkit-mask-image: linear-gradient(to bottom, transparent 0%, black 20%, black 80%, transparent 100%);
}
.cyberpunk-hud-root .hud-datastream-inner {
  animation: ${anim ?? `hud-stream ${DATA_STREAM_ANIM_S}s linear infinite`};
}
.cyberpunk-hud-root .hud-datastream-row {
  font-size: 10px;
  line-height: 1.5;
  color: #22c55e;
  white-space: nowrap;
  letter-spacing: 0.04em;
}

/* ── 우하단 status bars ────────────────────── */
.cyberpunk-hud-root .hud-status {
  position: fixed;
  right: ${CORNER_BRACKET_INSET + 4}px;
  bottom: ${CORNER_BRACKET_INSET + 48}px;
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 6px 8px;
  background: var(--hud-panel-bg);
  backdrop-filter: blur(6px);
  -webkit-backdrop-filter: blur(6px);
  border: 1px solid rgba(var(--hud-accent-rgb), 0.45);
  border-radius: 2px;
}
.cyberpunk-hud-root .hud-status-bar {
  display: grid;
  grid-template-columns: 28px ${STATUS_BAR_WIDTH}px 34px;
  align-items: center;
  gap: 6px;
  font-size: 10px;
  color: var(--hud-accent);
}
.cyberpunk-hud-root .hud-status-label { letter-spacing: 0.1em; }
.cyberpunk-hud-root .hud-status-track {
  height: ${STATUS_BAR_HEIGHT}px;
  background: rgba(var(--hud-accent-rgb), 0.15);
  border: 1px solid rgba(var(--hud-accent-rgb), 0.35);
  position: relative;
  overflow: hidden;
}
.cyberpunk-hud-root .hud-status-fill {
  height: 100%;
  background: var(--hud-accent);
  box-shadow: 0 0 6px var(--hud-glow);
  transition: width 300ms ease-out;
}
.cyberpunk-hud-root .hud-status-bar--warn .hud-status-fill {
  background: var(--hud-warn);
  box-shadow: 0 0 6px var(--hud-warn);
}
.cyberpunk-hud-root .hud-status-bar--danger .hud-status-fill {
  background: var(--hud-danger);
  box-shadow: 0 0 8px var(--hud-danger);
  animation: ${anim ?? "hud-pulse 0.9s ease-in-out infinite"};
}
.cyberpunk-hud-root .hud-status-num {
  font-variant-numeric: tabular-nums;
  text-align: right;
  font-size: 10px;
}

/* ── 중앙 reticle ──────────────────────────── */
.cyberpunk-hud-root .hud-reticle {
  position: fixed;
  left: 50%;
  top: 50%;
  transform: translate(-50%, -50%);
  color: var(--hud-danger);
  filter: drop-shadow(0 0 6px var(--hud-danger));
  animation: ${anim ?? "hud-pulse 0.8s ease-in-out infinite"};
}

/* ── scanline ──────────────────────────────── */
.cyberpunk-hud-root .hud-scanline {
  position: fixed;
  left: 0;
  right: 0;
  top: 0;
  height: 2px;
  background: linear-gradient(to bottom, transparent, var(--hud-accent), transparent);
  opacity: ${SCANLINE_OPACITY};
  animation: ${anim ?? `hud-scanline ${SCANLINE_DURATION_S}s linear infinite`};
}

/* ── keyframes ─────────────────────────────── */
@keyframes hud-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.35; }
}
@keyframes hud-radar-sweep {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}
@keyframes hud-dot-blink {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.35; }
}
@keyframes hud-stream {
  from { transform: translateY(0); }
  to { transform: translateY(-50%); }
}
@keyframes hud-scanline {
  from { transform: translateY(0); }
  to { transform: translateY(100vh); }
}

@media (prefers-reduced-motion: reduce) {
  .cyberpunk-hud-root .hud-mode-dot,
  .cyberpunk-hud-root .hud-radar-sweep-group,
  .cyberpunk-hud-root .hud-radar-dot,
  .cyberpunk-hud-root .hud-datastream-inner,
  .cyberpunk-hud-root .hud-status-bar--danger .hud-status-fill,
  .cyberpunk-hud-root .hud-reticle,
  .cyberpunk-hud-root .hud-scanline {
    animation: none !important;
  }
}
`
}

export default CyberpunkHud
