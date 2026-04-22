"use client"

/**
 * AnimatedNumber / CountUp
 *
 * Cook-forge YG-1 Simulator v3 전용 부드러운 숫자 카운팅 애니메이션.
 * RPM / Vf / MRR / Pc 등 결과 수치 값이 바뀔 때 spring 기반 tumbling/rolling
 * 애니메이션으로 전환하고, 값 증가 시 green flash / 감소 시 red flash
 * 마이크로 인터랙션을 제공한다.
 *
 * 사용법:
 *   <AnimatedNumber value={result.n} decimals={0} suffix=" rpm" className="text-lg font-bold" />
 *   <AnimatedNumber value={result.MRR} decimals={2} suffix=" cm³/min" />
 *   <CountUp value={totalSavings} prefix="₩" duration={1.5} />
 *
 * 의존성: framer-motion ^12.38 (이미 설치됨)
 * 주의: cutting-simulator-v2.tsx 는 건드리지 않는다. 본 파일은 v3 신규 컴포넌트.
 */

import { motion, useSpring, useTransform } from "framer-motion"
import { useEffect, useRef, useState } from "react"

export interface AnimatedNumberProps {
  /** 표시할 목표 값 */
  value: number
  /** 소수점 자릿수 (default 0) */
  decimals?: number
  /** 커스텀 포맷터. 지정 시 toLocaleString 대신 사용 */
  format?: (n: number) => string
  /** spring 애니메이션 지속시간 (초, default 0.6) */
  duration?: number
  /** 추가 className */
  className?: string
  /** 값 변화 시 flash 효과 (default true) */
  flash?: boolean
  /** 숫자 앞에 붙일 문자열 (예: "₩") */
  prefix?: string
  /** 숫자 뒤에 붙일 문자열 (예: " rpm") */
  suffix?: string
}

/**
 * 값이 바뀔 때 spring 애니메이션으로 부드럽게 전환되는 숫자 표시 컴포넌트.
 * 값이 오르면 emerald flash, 내리면 rose flash 가 잠깐 나타난다.
 */
export function AnimatedNumber({
  value,
  decimals = 0,
  format,
  duration = 0.6,
  className = "",
  flash = true,
  prefix = "",
  suffix = "",
}: AnimatedNumberProps) {
  const spring = useSpring(value, { duration: duration * 1000, bounce: 0 })
  const display = useTransform(spring, (current) => {
    const n = Number(current.toFixed(decimals))
    return format
      ? format(n)
      : n.toLocaleString("ko-KR", {
          maximumFractionDigits: decimals,
          minimumFractionDigits: decimals,
        })
  })

  useEffect(() => {
    spring.set(value)
  }, [value, spring])

  const [flashDir, setFlashDir] = useState<"up" | "down" | null>(null)
  const prevRef = useRef(value)

  useEffect(() => {
    if (!flash) {
      prevRef.current = value
      return
    }
    if (value > prevRef.current + 0.0001) {
      setFlashDir("up")
      const t = setTimeout(() => setFlashDir(null), 500)
      prevRef.current = value
      return () => clearTimeout(t)
    } else if (value < prevRef.current - 0.0001) {
      setFlashDir("down")
      const t = setTimeout(() => setFlashDir(null), 500)
      prevRef.current = value
      return () => clearTimeout(t)
    }
    prevRef.current = value
  }, [value, flash])

  const flashClass =
    flashDir === "up"
      ? "text-emerald-600 dark:text-emerald-400"
      : flashDir === "down"
        ? "text-rose-600 dark:text-rose-400"
        : ""

  return (
    <span
      className={`tabular-nums transition-colors duration-200 ${flashClass} ${className}`}
    >
      {prefix}
      <motion.span>{display}</motion.span>
      {suffix}
    </span>
  )
}

export interface CountUpProps {
  /** 카운트업 목표 값 */
  value: number
  /** 소수점 자릿수 (default 0) */
  decimals?: number
  /** 카운트업 지속시간 (초, default 1.2) */
  duration?: number
  /** 추가 className */
  className?: string
  /** 숫자 앞에 붙일 문자열 */
  prefix?: string
  /** 숫자 뒤에 붙일 문자열 */
  suffix?: string
}

/**
 * mount 시 0 부터 value 까지 한 번만 ease-out cubic 으로 카운트업.
 * value prop 이 바뀌면 다시 0 부터 새로운 value 까지 카운트업한다.
 */
export function CountUp({
  value,
  decimals = 0,
  duration = 1.2,
  className,
  prefix = "",
  suffix = "",
}: CountUpProps) {
  const [current, setCurrent] = useState(0)

  useEffect(() => {
    const start = performance.now()
    let raf = 0
    const tick = (now: number) => {
      const elapsed = (now - start) / (duration * 1000)
      const t = Math.min(1, elapsed)
      // ease-out cubic
      const eased = 1 - Math.pow(1 - t, 3)
      setCurrent(value * eased)
      if (t < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [value, duration])

  return (
    <span className={`tabular-nums ${className ?? ""}`}>
      {prefix}
      {current.toLocaleString("ko-KR", {
        maximumFractionDigits: decimals,
        minimumFractionDigits: decimals,
      })}
      {suffix}
    </span>
  )
}
