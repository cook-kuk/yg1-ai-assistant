"use client"

import { motion, useMotionValue, useMotionTemplate, animate } from "framer-motion"
import { useEffect, useMemo, useRef, useState } from "react"
import { LiveIndicator } from "./live-indicator"

export interface Endmill3DPreviewProps {
  shape: "square" | "ball" | "radius" | "chamfer"
  diameter: number       // mm
  flutes: number         // 2 | 3 | 4
  rpm: number            // 회전 속도 (애니메이션 속도)
  helixAngle?: number    // 30~45도, default 38
  cornerR?: number       // radius 형상일 때 모서리 R
  coating?: string       // "altin" | "aicrn" | "uncoated" | "dlc" | "tialn"
  darkMode?: boolean
  autoRotate?: boolean   // default true
}

// 코팅별 색상 팔레트 (body, edge, highlight)
const COATING_TINT: Record<string, { body: string; edge: string; highlight: string }> = {
  altin:    { body: "#d4a84a", edge: "#a47823", highlight: "#ffe29a" },
  aicrn:    { body: "#8a5ab8", edge: "#5c3d84", highlight: "#cfa9f0" },
  uncoated: { body: "#c8cdd3", edge: "#8a9099", highlight: "#f2f4f7" },
  silver:   { body: "#c8cdd3", edge: "#8a9099", highlight: "#f2f4f7" },
  dlc:      { body: "#2a2a2e", edge: "#0d0d10", highlight: "#5a5a62" },
  tialn:    { body: "#6d4a2a", edge: "#3e2a18", highlight: "#a4744a" },
}

function resolveTint(coating?: string) {
  if (!coating) return COATING_TINT.uncoated
  const key = coating.toLowerCase()
  return COATING_TINT[key] ?? COATING_TINT.uncoated
}

export function Endmill3DPreview({
  shape,
  diameter,
  flutes,
  rpm,
  helixAngle = 38,
  cornerR = 0.5,
  coating,
  darkMode = false,
  autoRotate = true,
}: Endmill3DPreviewProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const rotateY = useMotionValue(0)
  const rotateX = useMotionValue(-10)
  const [isHover, setIsHover] = useState(false)
  const [isDragging, setIsDragging] = useState(false)
  const [isInViewport, setIsInViewport] = useState(true)
  const [isDocumentVisible, setIsDocumentVisible] = useState(true)
  const dragStart = useRef<{ x: number; y: number; rx: number; ry: number } | null>(null)

  const tint = useMemo(() => resolveTint(coating), [coating])

  // RPM → 회전 1바퀴 duration (초). rpm 높을수록 짧아짐. 너무 느릴 경우 하한.
  const duration = useMemo(() => {
    const safeRpm = Math.max(500, rpm || 1000)
    // spec: duration = 60 / (rpm / 1000)
    const raw = 60 / (safeRpm / 1000)
    // 가시성 확보: 최소 1.5s, 최대 12s
    return Math.min(12, Math.max(1.5, raw))
  }, [rpm])

  // 오토 회전 animate 제어 (hover/drag 시 일시 정지)
  useEffect(() => {
    if (!autoRotate || isHover || isDragging || !isInViewport || !isDocumentVisible) return
    const controls = animate(rotateY, rotateY.get() + 360, {
      duration,
      ease: "linear",
      repeat: Infinity,
    })
    return () => controls.stop()
  }, [autoRotate, duration, isDocumentVisible, isHover, isDragging, isInViewport, rotateY])

  useEffect(() => {
    if (typeof document === "undefined") return
    const onVisibilityChange = () => {
      setIsDocumentVisible(document.visibilityState !== "hidden")
    }
    onVisibilityChange()
    document.addEventListener("visibilitychange", onVisibilityChange)
    return () => document.removeEventListener("visibilitychange", onVisibilityChange)
  }, [])

  useEffect(() => {
    const node = containerRef.current
    if (!node || typeof IntersectionObserver === "undefined") return
    const observer = new IntersectionObserver(
      ([entry]) => {
        setIsInViewport(entry?.isIntersecting ?? true)
      },
      { threshold: 0.08 },
    )
    observer.observe(node)
    return () => observer.disconnect()
  }, [])

  // 드래그 핸들러
  function onPointerDown(e: React.PointerEvent) {
    setIsDragging(true)
    ;(e.target as HTMLElement).setPointerCapture?.(e.pointerId)
    dragStart.current = {
      x: e.clientX,
      y: e.clientY,
      rx: rotateX.get(),
      ry: rotateY.get(),
    }
  }
  function onPointerMove(e: React.PointerEvent) {
    if (!isDragging || !dragStart.current) return
    const dx = e.clientX - dragStart.current.x
    const dy = e.clientY - dragStart.current.y
    rotateY.set(dragStart.current.ry + dx * 0.6)
    rotateX.set(Math.max(-60, Math.min(60, dragStart.current.rx - dy * 0.4)))
  }
  function onPointerUp(e: React.PointerEvent) {
    setIsDragging(false)
    ;(e.target as HTMLElement).releasePointerCapture?.(e.pointerId)
    dragStart.current = null
  }
  function onDoubleClick() {
    animate(rotateX, -10, { duration: 0.4, ease: "easeOut" })
    animate(rotateY, 0, { duration: 0.4, ease: "easeOut" })
  }

  // Transform template
  const transform = useMotionTemplate`rotateX(${rotateX}deg) rotateY(${rotateY}deg)`

  // 치수 계산 (시각적 스케일)
  const minD = 2, maxD = 20
  const dClamped = Math.min(maxD, Math.max(minD, diameter))
  const bodyWidth = 44 + (dClamped - minD) * (46 / (maxD - minD))  // 44 ~ 90 px
  const bodyHeight = 120
  const shankWidth = bodyWidth * 0.85
  const shankHeight = 70
  const helixLean = Math.max(16, Math.min(helixAngle, 52))
  const sliceCount = 8
  const depthShift = Math.max(8, Math.min(18, bodyWidth * 0.16))

  // 나선 stripe 위치 (flutes 수만큼)
  const fluteCount = Math.max(2, Math.min(6, flutes || 4))
  const fluteGrooveWidth = Math.max(6, bodyWidth * (fluteCount <= 2 ? 0.18 : fluteCount === 3 ? 0.15 : fluteCount === 4 ? 0.13 : fluteCount === 5 ? 0.11 : 0.1))
  const fluteFaceLabel = fluteCount <= 2 ? "wide flute" : fluteCount === 3 ? "balanced flute" : fluteCount === 4 ? "general flute" : fluteCount === 5 ? "dense flute" : "micro flute"
  const stripes = Array.from({ length: fluteCount }, (_, i) => ({
    offset: (i / fluteCount) * 100,
    key: i,
  }))
  const bodySlices = Array.from({ length: sliceCount }, (_, i) => i)

  // tip 렌더링
  const tipHeight = shape === "ball" ? bodyWidth / 2 : shape === "chamfer" ? 14 : 10
  const tipStyle: React.CSSProperties = (() => {
    const base: React.CSSProperties = {
      width: bodyWidth,
      height: tipHeight,
      background: `linear-gradient(180deg, ${tint.body} 0%, ${tint.edge} 100%)`,
      margin: "0 auto",
      boxShadow: `inset 0 -2px 4px rgba(0,0,0,0.3)`,
    }
    switch (shape) {
      case "ball":
        return {
          ...base,
          borderBottomLeftRadius: "50%",
          borderBottomRightRadius: "50%",
          height: bodyWidth / 2,
        }
      case "radius": {
        const r = Math.min(45, Math.max(5, cornerR * 5))
        return {
          ...base,
          borderBottomLeftRadius: `${r}%`,
          borderBottomRightRadius: `${r}%`,
        }
      }
      case "chamfer":
        return {
          ...base,
          clipPath: `polygon(14% 0, 86% 0, 100% 100%, 0 100%)`,
        }
      case "square":
      default:
        return base
    }
  })()

  // 배경/텍스트 테마
  const bg = darkMode
    ? "radial-gradient(ellipse at center, #1a1d24 0%, #0b0d12 70%)"
    : "radial-gradient(ellipse at center, #f4f6fa 0%, #d9dee5 70%)"
  const textColor = darkMode ? "#e6ebf2" : "#1f2937"
  const labelBg = darkMode ? "rgba(20,22,28,0.75)" : "rgba(255,255,255,0.8)"

  return (
    <div
      ref={containerRef}
      data-rotation-state={autoRotate && isDocumentVisible && isInViewport && !isHover && !isDragging ? "active" : "sleeping"}
      onMouseEnter={() => setIsHover(true)}
      onMouseLeave={() => setIsHover(false)}
      onDoubleClick={onDoubleClick}
      style={{
        position: "relative",
        width: "100%",
        maxWidth: 200,
        height: 280,
        perspective: "800px",
        background: bg,
        borderRadius: 12,
        overflow: "hidden",
        touchAction: "none",
        userSelect: "none",
        margin: "0 auto",
        boxShadow: darkMode
          ? "inset 0 0 20px rgba(0,0,0,0.4)"
          : "inset 0 0 20px rgba(0,0,0,0.08)",
      }}
    >
      {/* LIVE 인디케이터 (좌상단) */}
      <div
        style={{
          position: "absolute",
          top: 8,
          left: 8,
          zIndex: 3,
          pointerEvents: "none",
        }}
      >
        <LiveIndicator watch={[rpm, diameter, flutes]} color="cyan" darkMode={darkMode} />
      </div>

      {/* RPM 배지 */}
      <motion.div
        animate={{ opacity: autoRotate && !isHover ? [1, 0.55, 1] : 1 }}
        transition={{ duration: 1.2, repeat: Infinity, ease: "easeInOut" }}
        style={{
          position: "absolute",
          top: 8,
          right: 8,
          fontSize: 11,
          fontWeight: 600,
          padding: "3px 8px",
          borderRadius: 999,
          background: labelBg,
          color: textColor,
          border: `1px solid ${darkMode ? "#2a2f3a" : "#d1d5db"}`,
          zIndex: 3,
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {(rpm || 0).toLocaleString()} rpm
      </motion.div>

      <div
        style={{
          position: "absolute",
          top: 38,
          right: 8,
          fontSize: 11,
          fontWeight: 600,
          padding: "3px 8px",
          borderRadius: 999,
          background: labelBg,
          color: textColor,
          border: `1px solid ${darkMode ? "#2a2f3a" : "#d1d5db"}`,
          zIndex: 3,
          fontVariantNumeric: "tabular-nums",
        }}
      >
        helix {helixAngle}°
      </div>

      <div
        style={{
          position: "absolute",
          top: 68,
          right: 8,
          fontSize: 10,
          fontWeight: 700,
          padding: "3px 8px",
          borderRadius: 999,
          background: labelBg,
          color: textColor,
          border: `1px solid ${darkMode ? "#2a2f3a" : "#d1d5db"}`,
          zIndex: 3,
        }}
      >
        Z{fluteCount} · {fluteFaceLabel}
      </div>

      {/* 3D 스테이지 */}
      <div
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          cursor: isDragging ? "grabbing" : "grab",
          transformStyle: "preserve-3d",
        }}
      >
        <motion.div
          style={{
            transformStyle: "preserve-3d",
            transform,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            width: bodyWidth,
          }}
        >
          {/* Shank (상단) */}
          <div
            style={{
              width: shankWidth,
              height: shankHeight,
              background:
                "linear-gradient(90deg, #6b7280 0%, #b8bec8 45%, #eef0f3 52%, #b8bec8 60%, #6b7280 100%)",
              borderTopLeftRadius: 4,
              borderTopRightRadius: 4,
              boxShadow: "inset 0 2px 4px rgba(255,255,255,0.25), inset 0 -2px 4px rgba(0,0,0,0.25)",
            }}
          />
          {/* 경계 홈 */}
          <div
            style={{
              width: bodyWidth + 4,
              height: 4,
              background: darkMode ? "#111317" : "#374151",
              borderRadius: 2,
              boxShadow: "inset 0 1px 2px rgba(0,0,0,0.5)",
            }}
          />
          {/* Body + 나선 flutes */}
          <div
            style={{
              position: "relative",
              width: bodyWidth,
              height: bodyHeight,
              background: `linear-gradient(90deg, ${tint.edge} 0%, ${tint.body} 32%, ${tint.highlight} 50%, ${tint.body} 68%, ${tint.edge} 100%)`,
              overflow: "hidden",
              borderRadius: 8,
              boxShadow:
                "inset 0 2px 4px rgba(255,255,255,0.2), inset 0 -2px 4px rgba(0,0,0,0.3)",
            }}
          >
            {bodySlices.map((slice) => {
              const depthPct = slice / (sliceCount - 1)
              return (
                <div
                  key={`slice-${slice}`}
                  style={{
                    position: "absolute",
                    inset: 0,
                    borderRadius: 8,
                    transform: `translate3d(${(depthPct - 0.5) * depthShift}px, 0, ${-slice * 4}px) scaleX(${1 - depthPct * 0.04})`,
                    background: `linear-gradient(90deg, rgba(0,0,0,${0.26 - depthPct * 0.16}), transparent 28%, rgba(255,255,255,${0.16 - depthPct * 0.08}) 52%, transparent 74%, rgba(0,0,0,${0.18 - depthPct * 0.1}))`,
                    mixBlendMode: "overlay",
                    pointerEvents: "none",
                  }}
                />
              )
            })}
            {stripes.map((s) => (
              <div
                key={s.key}
                style={{
                  position: "absolute",
                  top: -28,
                  left: `calc(${s.offset}% - ${fluteGrooveWidth / 2}px)`,
                  width: fluteGrooveWidth,
                  height: bodyHeight + 56,
                  borderRadius: 999,
                  background: `linear-gradient(180deg, rgba(0,0,0,0.72), rgba(255,255,255,0.12) 18%, rgba(0,0,0,0.82) 58%, rgba(255,255,255,0.08))`,
                  transform: `rotate(${helixLean}deg) translateZ(12px)`,
                  transformOrigin: "top center",
                  opacity: 0.88,
                  boxShadow: "inset 1px 0 0 rgba(255,255,255,0.16), inset -1px 0 0 rgba(0,0,0,0.35)",
                }}
              />
            ))}
            {/* 중앙 하이라이트 하이라이트 */}
            <div
              style={{
                position: "absolute",
                top: 0,
                left: "48%",
                width: 3,
                height: "100%",
                background: "linear-gradient(180deg, rgba(255,255,255,0.6), rgba(255,255,255,0.15))",
                filter: "blur(1px)",
              }}
            />
            <div
              style={{
                position: "absolute",
                inset: 0,
                background: "linear-gradient(180deg, rgba(255,255,255,0.16), transparent 26%, transparent 74%, rgba(0,0,0,0.18))",
                pointerEvents: "none",
              }}
            />
            {stripes.map((s) => (
              <div
                key={`edge-${s.key}`}
                style={{
                  position: "absolute",
                  top: 0,
                  left: `calc(${s.offset}% - 1px)`,
                  width: 2,
                  height: "100%",
                  background: "linear-gradient(180deg, rgba(255,255,255,0.45), rgba(255,255,255,0.02))",
                  opacity: fluteCount >= 5 ? 0.45 : 0.65,
                  transform: `rotate(${helixLean}deg)`,
                  transformOrigin: "top center",
                }}
              />
            ))}
          </div>
          {/* Tip */}
          <div style={tipStyle} />
        </motion.div>
      </div>

      {/* 하단 라벨 */}
      <div
        style={{
          position: "absolute",
          bottom: 8,
          left: "50%",
          transform: "translateX(-50%)",
          fontSize: 11,
          fontWeight: 500,
          padding: "3px 10px",
          borderRadius: 999,
          background: labelBg,
          color: textColor,
          border: `1px solid ${darkMode ? "#2a2f3a" : "#d1d5db"}`,
          whiteSpace: "nowrap",
          zIndex: 3,
          fontVariantNumeric: "tabular-nums",
        }}
      >
        D{diameter}mm · Z{flutes} · {shape}
      </div>

      <div
        style={{
          position: "absolute",
          left: 10,
          bottom: 38,
          display: "flex",
          gap: 4,
          zIndex: 3,
        }}
      >
        {Array.from({ length: fluteCount }, (_, i) => (
          <span
            key={`flute-badge-${i}`}
            style={{
              width: fluteCount >= 5 ? 10 : 12,
              height: fluteCount >= 5 ? 10 : 12,
              borderRadius: 999,
              background: i % 2 === 0 ? tint.highlight : tint.edge,
              border: `1px solid ${darkMode ? "#111827" : "#cbd5e1"}`,
              boxShadow: "0 0 0 1px rgba(255,255,255,0.25) inset",
            }}
          />
        ))}
      </div>

      {/* 힌트 (hover 시) */}
      {isHover && (
        <div
          style={{
            position: "absolute",
            top: 30,
            left: 8,
            fontSize: 10,
            color: darkMode ? "#94a3b8" : "#6b7280",
            zIndex: 3,
            pointerEvents: "none",
          }}
        >
          drag · dbl-click reset
        </div>
      )}
    </div>
  )
}

export default Endmill3DPreview
