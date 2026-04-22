// SPDX-License-Identifier: MIT
// YG-1 ARIA Simulator v3 — 3D Parallax Tilt Card Wrapper
// 마우스 움직임에 따라 카드가 3D로 기울어지는 iPhone 앱 카드 같은 효과.
// KPI 카드나 비주얼 패널을 감싸면 화려함이 극대화된다 (decorative only, GPU transform).
"use client"

import * as React from "react"
import { motion, useMotionValue, useSpring, useTransform, useReducedMotion } from "framer-motion"

/** Usage:
 * <ParallaxTilt maxTilt={10} glare>
 *   <div className="rounded-2xl p-6">내 KPI 카드</div>
 * </ParallaxTilt>
 *
 * <ParallaxTilt maxTilt={6} glare={false} scale={1.02} speed={300}>
 *   <KpiPanel />
 * </ParallaxTilt>
 */

export interface ParallaxTiltProps {
  children: React.ReactNode
  /** 최대 틸트 각도 (degrees). default 8 */
  maxTilt?: number
  /** 하이라이트 라이트 반사 glare 표시. default true */
  glare?: boolean
  /** hover 시 scale. default 1.03 */
  scale?: number
  /** transition speed (ms). default 400 */
  speed?: number
  /** 원근감 (px). default 1000 */
  perspective?: number
  /** 추가 클래스 (wrapper). */
  className?: string
  /** prefers-reduced-motion override (true면 강제 static). */
  reducedMotion?: boolean
}

// ── 기본값 상수 (매직넘버 방지) ──────────────────────────────────────
const DEFAULT_MAX_TILT_DEG = 8
const DEFAULT_SCALE = 1.03
const DEFAULT_SPEED_MS = 400
const DEFAULT_PERSPECTIVE_PX = 1000
const SPRING_STIFFNESS_BASE = 300
const SPRING_DAMPING = 30
const GLARE_RADIUS_PCT = 50
const GLARE_ALPHA = 0.3
const SHADOW_IDLE = "0 4px 8px rgba(0, 0, 0, 0.1)"
const SHADOW_HOVER = "0 20px 40px rgba(0, 0, 0, 0.3)"

function ParallaxTilt({
  children,
  maxTilt = DEFAULT_MAX_TILT_DEG,
  glare = true,
  scale = DEFAULT_SCALE,
  speed = DEFAULT_SPEED_MS,
  perspective = DEFAULT_PERSPECTIVE_PX,
  className,
  reducedMotion,
}: ParallaxTiltProps) {
  const systemReducedMotion = useReducedMotion()
  const isReduced = reducedMotion ?? systemReducedMotion ?? false

  const containerRef = React.useRef<HTMLDivElement | null>(null)

  // 정규화된 마우스 위치 [-0.5, 0.5]
  const mouseX = useMotionValue(0)
  const mouseY = useMotionValue(0)

  // glare 용 0~100% 위치
  const glareX = useMotionValue(GLARE_RADIUS_PCT)
  const glareY = useMotionValue(GLARE_RADIUS_PCT)

  // spring 기반 부드러운 전환 (speed에 반비례하는 stiffness)
  const stiffness = Math.max(50, Math.round((SPRING_STIFFNESS_BASE * DEFAULT_SPEED_MS) / Math.max(1, speed)))
  const springConfig = { stiffness, damping: SPRING_DAMPING, mass: 1 }

  const rotateY = useSpring(
    useTransform(mouseX, (v) => v * maxTilt * 2),
    springConfig,
  )
  const rotateX = useSpring(
    useTransform(mouseY, (v) => -v * maxTilt * 2),
    springConfig,
  )

  const glareBg = useTransform([glareX, glareY] as unknown as [typeof glareX, typeof glareY], (v) => {
    const [gx, gy] = v as [number, number]
    return `radial-gradient(circle at ${gx}% ${gy}%, rgba(255, 255, 255, ${GLARE_ALPHA}) 0%, transparent ${GLARE_RADIUS_PCT}%)`
  })

  const handleMouseMove = React.useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (isReduced) return
      const el = containerRef.current
      if (!el) return
      const rect = el.getBoundingClientRect()
      const width = rect.width || 1
      const height = rect.height || 1
      const x = (e.clientX - rect.left) / width
      const y = (e.clientY - rect.top) / height
      // offset from center [-0.5, 0.5]
      mouseX.set(x - 0.5)
      mouseY.set(y - 0.5)
      glareX.set(x * 100)
      glareY.set(y * 100)
    },
    [isReduced, mouseX, mouseY, glareX, glareY],
  )

  const handleMouseLeave = React.useCallback(() => {
    mouseX.set(0)
    mouseY.set(0)
    glareX.set(GLARE_RADIUS_PCT)
    glareY.set(GLARE_RADIUS_PCT)
  }, [mouseX, mouseY, glareX, glareY])

  // reduced-motion: static 카드
  if (isReduced) {
    return (
      <div
        ref={containerRef}
        className={className}
        style={{
          boxShadow: SHADOW_IDLE,
          borderRadius: "inherit",
        }}
      >
        {children}
      </div>
    )
  }

  return (
    <motion.div
      ref={containerRef}
      className={className}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      whileHover={{ scale, boxShadow: SHADOW_HOVER }}
      initial={{ boxShadow: SHADOW_IDLE }}
      transition={{ duration: speed / 1000, ease: "easeOut" }}
      style={{
        perspective: `${perspective}px`,
        transformStyle: "preserve-3d",
        rotateX,
        rotateY,
        borderRadius: "inherit",
        willChange: "transform",
      }}
    >
      {children}
      {glare && (
        <motion.div
          aria-hidden
          style={{
            position: "absolute",
            inset: 0,
            pointerEvents: "none",
            background: glareBg,
            mixBlendMode: "overlay",
            borderRadius: "inherit",
          }}
        />
      )}
    </motion.div>
  )
}

export default ParallaxTilt
