"use client"

import { useEffect, useRef, useState, type ReactNode } from "react"
import { motion, AnimatePresence } from "framer-motion"

interface RippleButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  rippleColor?: string
}

export function RippleButton({
  children,
  onClick,
  rippleColor = "rgba(59,130,246,0.35)",
  className = "",
  ...rest
}: RippleButtonProps) {
  const [ripples, setRipples] = useState<Array<{ id: number; x: number; y: number }>>([])
  const handleClick = (e: React.MouseEvent<HTMLButtonElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top
    const id = Date.now()
    setRipples((r) => [...r, { id, x, y }])
    setTimeout(() => setRipples((r) => r.filter((rp) => rp.id !== id)), 600)
    onClick?.(e)
  }
  return (
    <button className={`relative overflow-hidden ${className}`} onClick={handleClick} {...rest}>
      {children}
      {ripples.map((r) => (
        <span
          key={r.id}
          className="pointer-events-none absolute rounded-full"
          style={{
            left: r.x,
            top: r.y,
            background: rippleColor,
            transform: "translate(-50%, -50%)",
            animation: "ripple-expand 600ms ease-out forwards",
          }}
        />
      ))}
      <style>{`@keyframes ripple-expand { from { width: 0; height: 0; opacity: 0.5; } to { width: 500px; height: 500px; opacity: 0; } }`}</style>
    </button>
  )
}

interface MagneticWrapProps {
  children: ReactNode
  strength?: number
  className?: string
}

export function MagneticWrap({ children, strength = 0.3, className = "" }: MagneticWrapProps) {
  const ref = useRef<HTMLDivElement>(null)
  const [offset, setOffset] = useState({ x: 0, y: 0 })
  const onMove = (e: React.MouseEvent) => {
    if (!ref.current) return
    const rect = ref.current.getBoundingClientRect()
    const cx = rect.left + rect.width / 2
    const cy = rect.top + rect.height / 2
    setOffset({ x: (e.clientX - cx) * strength, y: (e.clientY - cy) * strength })
  }
  const onLeave = () => setOffset({ x: 0, y: 0 })
  return (
    <motion.div
      ref={ref}
      className={className}
      onMouseMove={onMove}
      onMouseLeave={onLeave}
      animate={{ x: offset.x, y: offset.y }}
      transition={{ type: "spring", stiffness: 150, damping: 15 }}
    >
      {children}
    </motion.div>
  )
}

interface ConfettiBurstProps {
  trigger: number
  count?: number
  colors?: string[]
}

export function ConfettiBurst({
  trigger,
  count = 14,
  colors = ["#f59e0b", "#10b981", "#3b82f6", "#ec4899"],
}: ConfettiBurstProps) {
  const [particles, setParticles] = useState<
    Array<{ id: number; angle: number; distance: number; color: string; rotate: number }>
  >([])
  useEffect(() => {
    if (trigger === 0) return
    const arr = Array.from({ length: count }, (_, i) => ({
      id: Date.now() + i,
      angle: (i / count) * 360 + Math.random() * 20,
      distance: 40 + Math.random() * 40,
      color: colors[i % colors.length],
      rotate: Math.random() * 720 - 360,
    }))
    setParticles(arr)
    const t = setTimeout(() => setParticles([]), 900)
    return () => clearTimeout(t)
  }, [trigger, count, colors])
  return (
    <span className="pointer-events-none absolute inset-0 flex items-center justify-center">
      {particles.map((p) => (
        <motion.span
          key={p.id}
          className="absolute rounded-sm"
          style={{ width: 6, height: 6, background: p.color }}
          initial={{ x: 0, y: 0, opacity: 1, rotate: 0 }}
          animate={{
            x: Math.cos((p.angle * Math.PI) / 180) * p.distance,
            y: Math.sin((p.angle * Math.PI) / 180) * p.distance,
            opacity: 0,
            rotate: p.rotate,
          }}
          transition={{ duration: 0.8, ease: "easeOut" }}
        />
      ))}
    </span>
  )
}

interface SparkleOnUpdateProps {
  watch: unknown
  children: ReactNode
}

export function SparkleOnUpdate({ watch, children }: SparkleOnUpdateProps) {
  const prev = useRef(watch)
  const [on, setOn] = useState(false)
  useEffect(() => {
    if (prev.current !== watch) {
      setOn(true)
      const t = setTimeout(() => setOn(false), 700)
      prev.current = watch
      return () => clearTimeout(t)
    }
  }, [watch])
  return (
    <span className="relative inline-flex">
      {children}
      <AnimatePresence>
        {on && (
          <motion.span
            className="pointer-events-none absolute -right-2 -top-2 text-amber-400 text-sm"
            initial={{ opacity: 0, scale: 0, rotate: 0 }}
            animate={{ opacity: 1, scale: 1.2, rotate: 180 }}
            exit={{ opacity: 0, scale: 0 }}
            transition={{ duration: 0.6 }}
          >
            ✨
          </motion.span>
        )}
      </AnimatePresence>
    </span>
  )
}
