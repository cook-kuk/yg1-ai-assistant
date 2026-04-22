// SPDX-License-Identifier: MIT
// YG-1 ARIA Simulator v3 — Holographic Frame Wrapper
// 기존 비주얼 패널을 감싸서 홀로그램 스타일(테두리 + glow + 스캔라인 + 코너 브래킷)을 입힌다.
// 지도라마/SF 영화 UI 수준의 화려한 래퍼 (decorative only, Pure CSS GPU animation).
"use client"

import * as React from "react"

/** Usage:
 * <HolographicFrame accent="cyan" intensity="strong">
 *   <LiveCuttingScene ... />
 * </HolographicFrame>
 *
 * <HolographicFrame accent="violet" intensity="subtle" scanlines={false} darkMode>
 *   <ChartPanel />
 * </HolographicFrame>
 */

export type HoloAccent =
  | "cyan"
  | "violet"
  | "emerald"
  | "rose"
  | "amber"
  | "indigo"

export type HoloIntensity = "subtle" | "medium" | "strong"

export interface HolographicFrameProps {
  children: React.ReactNode
  accent?: HoloAccent
  intensity?: HoloIntensity
  scanlines?: boolean
  cornerBrackets?: boolean
  darkMode?: boolean
  className?: string
}

// ── accent 팔레트 ────────────────────────────────────────────────────
interface AccentPalette {
  hex: string
  rgb: string // "r, g, b" for rgba()
  borderSubtle: string
  borderMedium: string
  borderStrong: string
}

const ACCENT_PALETTE: Record<HoloAccent, AccentPalette> = {
  cyan: {
    hex: "#22d3ee",
    rgb: "34, 211, 238",
    borderSubtle: "rgba(34, 211, 238, 0.35)",
    borderMedium: "rgba(34, 211, 238, 0.60)",
    borderStrong: "rgba(34, 211, 238, 0.85)",
  },
  violet: {
    hex: "#a855f7",
    rgb: "168, 85, 247",
    borderSubtle: "rgba(168, 85, 247, 0.35)",
    borderMedium: "rgba(168, 85, 247, 0.60)",
    borderStrong: "rgba(168, 85, 247, 0.85)",
  },
  emerald: {
    hex: "#10b981",
    rgb: "16, 185, 129",
    borderSubtle: "rgba(16, 185, 129, 0.35)",
    borderMedium: "rgba(16, 185, 129, 0.60)",
    borderStrong: "rgba(16, 185, 129, 0.85)",
  },
  rose: {
    hex: "#f43f5e",
    rgb: "244, 63, 94",
    borderSubtle: "rgba(244, 63, 94, 0.35)",
    borderMedium: "rgba(244, 63, 94, 0.60)",
    borderStrong: "rgba(244, 63, 94, 0.85)",
  },
  amber: {
    hex: "#f59e0b",
    rgb: "245, 158, 11",
    borderSubtle: "rgba(245, 158, 11, 0.35)",
    borderMedium: "rgba(245, 158, 11, 0.60)",
    borderStrong: "rgba(245, 158, 11, 0.85)",
  },
  indigo: {
    hex: "#6366f1",
    rgb: "99, 102, 241",
    borderSubtle: "rgba(99, 102, 241, 0.35)",
    borderMedium: "rgba(99, 102, 241, 0.60)",
    borderStrong: "rgba(99, 102, 241, 0.85)",
  },
}

// ── intensity 매핑 ───────────────────────────────────────────────────
interface IntensityConfig {
  glowOpacity: number
  scanlineOpacity: number
  borderKey: keyof Pick<
    AccentPalette,
    "borderSubtle" | "borderMedium" | "borderStrong"
  >
  pulse: boolean
}

const INTENSITY_CONFIG: Record<HoloIntensity, IntensityConfig> = {
  subtle: {
    glowOpacity: 0.1,
    scanlineOpacity: 0.06,
    borderKey: "borderSubtle",
    pulse: false,
  },
  medium: {
    glowOpacity: 0.2,
    scanlineOpacity: 0.09,
    borderKey: "borderMedium",
    pulse: false,
  },
  strong: {
    glowOpacity: 0.35,
    scanlineOpacity: 0.12,
    borderKey: "borderStrong",
    pulse: true,
  },
}

// ── Corner Bracket (L-shape) SVG ──────────────────────────────────────
interface BracketProps {
  position: "tl" | "tr" | "bl" | "br"
  color: string
}

function CornerBracket({ position, color }: BracketProps): React.ReactElement {
  // 각 코너 transform으로 L 모양 회전
  const rotations: Record<BracketProps["position"], string> = {
    tl: "rotate(0deg)",
    tr: "rotate(90deg)",
    br: "rotate(180deg)",
    bl: "rotate(270deg)",
  }
  const posStyle: React.CSSProperties = {
    position: "absolute",
    width: 18,
    height: 18,
    transform: rotations[position],
    ...(position === "tl" ? { top: 8, left: 8 } : {}),
    ...(position === "tr" ? { top: 8, right: 8 } : {}),
    ...(position === "bl" ? { bottom: 8, left: 8 } : {}),
    ...(position === "br" ? { bottom: 8, right: 8 } : {}),
  }
  return (
    <svg
      viewBox="0 0 18 18"
      style={posStyle}
      className="holo-bracket"
      aria-hidden="true"
      focusable="false"
    >
      <path
        d="M1 7 L1 1 L7 1"
        stroke={color}
        strokeWidth="1.6"
        fill="none"
        strokeLinecap="round"
      />
      <circle cx="1" cy="1" r="1.4" fill={color} />
    </svg>
  )
}

// ── 메인 컴포넌트 ────────────────────────────────────────────────────
function HolographicFrame({
  children,
  accent = "cyan",
  intensity = "medium",
  scanlines = true,
  cornerBrackets = true,
  darkMode = false,
  className = "",
}: HolographicFrameProps): React.ReactElement {
  const palette = ACCENT_PALETTE[accent]
  const cfg = INTENSITY_CONFIG[intensity]
  const borderColor = palette[cfg.borderKey]

  // 각 인스턴스가 고유한 keyframe 이름을 갖도록 (전역 충돌 회피)
  const uid = React.useId().replace(/:/g, "")
  const kfGlow = `holoGlow-${uid}`
  const kfScan = `holoScan-${uid}`
  const kfPulse = `holoPulse-${uid}`
  const kfBlink = `holoBlink-${uid}`

  // 컨테이너 배경
  const bgClass = darkMode
    ? "bg-slate-950/60 backdrop-blur-md"
    : "bg-white/80 backdrop-blur-md"

  // 컨테이너 box-shadow (strong이면 pulsing glow)
  const containerStyle: React.CSSProperties = {
    borderColor,
    boxShadow: cfg.pulse
      ? undefined
      : `0 0 18px rgba(${palette.rgb}, ${cfg.glowOpacity * 0.9}), inset 0 0 12px rgba(${palette.rgb}, ${cfg.glowOpacity * 0.5})`,
    animation: cfg.pulse ? `${kfPulse} 4s ease-in-out infinite` : undefined,
  }

  // Holographic glow (레이어 1)
  const glowStyle: React.CSSProperties = {
    position: "absolute",
    inset: 0,
    pointerEvents: "none",
    background: `linear-gradient(135deg, rgba(${palette.rgb}, ${cfg.glowOpacity}) 0%, transparent 35%, transparent 65%, rgba(${palette.rgb}, ${cfg.glowOpacity * 0.7}) 100%)`,
    filter: "blur(14px)",
    opacity: 1,
    animation: `${kfGlow} 12s ease-in-out infinite alternate`,
    willChange: "transform, background-position",
  }

  // Scanlines (레이어 2) — duration 증가 (UI 성능 최적화, 덜 빈번한 리페인트)
  const scanlineStyle: React.CSSProperties = {
    position: "absolute",
    inset: 0,
    pointerEvents: "none",
    backgroundImage: `repeating-linear-gradient(0deg, transparent 0px, transparent 2px, rgba(${palette.rgb}, ${cfg.scanlineOpacity}) 2px, rgba(${palette.rgb}, ${cfg.scanlineOpacity}) 3px)`,
    mixBlendMode: "screen",
    animation: `${kfScan} 5s linear infinite`,
    willChange: "transform",
  }

  // accent별 고유 CSS keyframes (inline <style>)
  const keyframesCss = `
    @keyframes ${kfGlow} {
      0%   { transform: translate3d(-2%, -1%, 0) scale(1.02); background-position: 0% 0%; }
      50%  { transform: translate3d(1%, 2%, 0)  scale(1.04); background-position: 50% 50%; }
      100% { transform: translate3d(2%, -1%, 0) scale(1.02); background-position: 100% 100%; }
    }
    @keyframes ${kfScan} {
      0%   { transform: translate3d(0, 0px, 0); }
      100% { transform: translate3d(0, 3px, 0); }
    }
    @keyframes ${kfPulse} {
      0%, 100% {
        box-shadow:
          0 0 14px rgba(${palette.rgb}, ${cfg.glowOpacity * 0.6}),
          0 0 28px rgba(${palette.rgb}, ${cfg.glowOpacity * 0.3}),
          inset 0 0 12px rgba(${palette.rgb}, ${cfg.glowOpacity * 0.4});
      }
      50% {
        box-shadow:
          0 0 22px rgba(${palette.rgb}, ${cfg.glowOpacity * 1.1}),
          0 0 44px rgba(${palette.rgb}, ${cfg.glowOpacity * 0.6}),
          inset 0 0 18px rgba(${palette.rgb}, ${cfg.glowOpacity * 0.7});
      }
    }
    @keyframes ${kfBlink} {
      0%, 100% { opacity: 1; }
      50%      { opacity: 0.45; }
    }
    .holo-bracket-${uid} { animation: ${kfBlink} 3s ease-in-out infinite; }
  `

  return (
    <div
      className={`relative overflow-hidden rounded-xl border-2 ${bgClass} ${className}`}
      style={containerStyle}
    >
      {/* scoped keyframes */}
      <style>{keyframesCss}</style>

      {/* Layer 1: holographic glow */}
      <div aria-hidden="true" style={glowStyle} />

      {/* Layer 2: scanlines (CRT) */}
      {scanlines && <div aria-hidden="true" style={scanlineStyle} />}

      {/* Layer 3: corner brackets */}
      {cornerBrackets && (
        <div
          aria-hidden="true"
          className={`holo-bracket-${uid}`}
          style={{ position: "absolute", inset: 0, pointerEvents: "none" }}
        >
          <CornerBracket position="tl" color={palette.hex} />
          <CornerBracket position="tr" color={palette.hex} />
          <CornerBracket position="bl" color={palette.hex} />
          <CornerBracket position="br" color={palette.hex} />
        </div>
      )}

      {/* Content */}
      <div className="relative z-10">{children}</div>
    </div>
  )
}

export default HolographicFrame
export { HolographicFrame }
