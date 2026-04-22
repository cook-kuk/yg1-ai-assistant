"use client"

/**
 * Vendor Attribution Tags + Modal
 * ---------------------------------------------------------------------------
 * vendor-attribution.ts (SSOT) 를 소비해 UI 배지/모달을 렌더링한다.
 * cutting-simulator-v2.tsx 는 건드리지 않고, 외부에서 <VendorTag featureId="..." />
 * 로 꽂아 쓰는 방식.
 */

import { useEffect, useState } from "react"
import { X, ExternalLink, Star } from "lucide-react"
import {
  VENDORS,
  FEATURES,
  type VendorSource,
  type FeatureAttribution,
  type VendorInfo,
} from "./vendor-attribution"

// ---------------------------------------------------------------------------
// VendorTag
// ---------------------------------------------------------------------------

type TagVariant = "badge" | "inline" | "corner"
type TagSize = "xs" | "sm" | "md"

interface VendorTagProps {
  featureId: string
  variant?: TagVariant
  size?: TagSize
  darkMode?: boolean
}

const SIZE_CLASS: Record<TagSize, string> = {
  xs: "text-[10px] px-1.5 py-0.5 gap-1",
  sm: "text-xs px-2 py-0.5 gap-1",
  md: "text-sm px-2.5 py-1 gap-1.5",
}

const VARIANT_CLASS: Record<TagVariant, string> = {
  badge: "inline-flex items-center rounded-full border font-medium cursor-pointer transition",
  inline:
    "inline-flex items-center rounded-md border font-medium cursor-pointer transition underline-offset-2",
  corner:
    "absolute top-1 right-1 inline-flex items-center rounded-md border font-medium cursor-pointer transition shadow-sm",
}

function tagColorClass(isOriginal: boolean, darkMode?: boolean): string {
  if (isOriginal) {
    // 🆕 NOVEL 배지 — 강렬한 emerald→teal 그라디언트 + 흰색 볼드
    return "bg-gradient-to-r from-emerald-400 to-teal-500 text-white border-emerald-500 font-bold shadow-sm hover:from-emerald-500 hover:to-teal-600 hover:shadow-md"
  }
  return darkMode
    ? "bg-slate-800 text-slate-200 border-slate-600 hover:bg-slate-700"
    : "bg-slate-100 text-slate-700 border-slate-300 hover:bg-slate-200"
}

function tagLabel(feature: FeatureAttribution, vendor: VendorInfo): string {
  if (feature.yg1Original) return `NOVEL · YG-1 Original`
  return `${vendor.country.split(" ")[0]} ${vendor.name}-inspired`
}

export function VendorTag({
  featureId,
  variant = "badge",
  size = "xs",
  darkMode,
}: VendorTagProps) {
  const [open, setOpen] = useState(false)
  const [initialPulse, setInitialPulse] = useState(true)
  const [hovering, setHovering] = useState(false)
  const feature = FEATURES[featureId]

  // 처음 3초만 animate-pulse — feature 존재 여부와 무관하게 훅 순서 고정
  useEffect(() => {
    const t = window.setTimeout(() => setInitialPulse(false), 3000)
    return () => window.clearTimeout(t)
  }, [])

  if (!feature) return null
  const vendor = VENDORS[feature.primarySource]
  const isOriginal = feature.yg1Original
  const shouldPulse = isOriginal && (initialPulse || hovering)

  return (
    <>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation()
          setOpen(true)
        }}
        onMouseEnter={() => setHovering(true)}
        onMouseLeave={() => setHovering(false)}
        className={[
          VARIANT_CLASS[variant],
          SIZE_CLASS[size],
          tagColorClass(isOriginal, darkMode),
          shouldPulse ? "animate-pulse" : "",
        ]
          .filter(Boolean)
          .join(" ")}
        title={
          isOriginal
            ? `${feature.featureName} — YG-1 Original (업계 최초)`
            : `${feature.featureName} — ${vendor.name} 영감`
        }
      >
        {isOriginal && <span aria-hidden>🆕</span>}
        <span>{tagLabel(feature, vendor)}</span>
        {isOriginal && <Star className="h-3 w-3 fill-current" aria-hidden />}
      </button>
      {open && (
        <VendorAttributionModal
          feature={feature}
          onClose={() => setOpen(false)}
          darkMode={darkMode}
        />
      )}
    </>
  )
}

// ---------------------------------------------------------------------------
// VendorAttributionModal
// ---------------------------------------------------------------------------

interface VendorAttributionModalProps {
  feature: FeatureAttribution
  onClose: () => void
  darkMode?: boolean
}

// 벤더별 그라디언트 헤더 색
const HEADER_GRADIENT: Record<VendorSource, string> = {
  harvey: "from-red-500 to-orange-500",
  sandvik: "from-blue-600 to-cyan-500",
  walter: "from-yellow-500 to-amber-600",
  iscar: "from-blue-500 to-indigo-600",
  kennametal: "from-orange-600 to-red-600",
  mitsubishi: "from-red-600 to-rose-500",
  osg: "from-emerald-600 to-teal-500",
  "yg1-original": "from-emerald-600 to-green-700",
}

export function VendorAttributionModal({
  feature,
  onClose,
  darkMode,
}: VendorAttributionModalProps) {
  const vendor = VENDORS[feature.primarySource]
  const secondary = (feature.secondarySources ?? []).map((k) => VENDORS[k])
  const isOriginal = feature.yg1Original

  // Esc 닫기
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose()
    }
    window.addEventListener("keydown", handler)
    return () => window.removeEventListener("keydown", handler)
  }, [onClose])

  const bodyClass = darkMode
    ? "bg-slate-900 text-slate-100"
    : "bg-white text-slate-900"
  const mutedClass = darkMode ? "text-slate-400" : "text-slate-500"
  const sectionBorder = darkMode ? "border-slate-700" : "border-slate-200"

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={`${feature.featureName} 출처`}
    >
      <div
        className={`relative w-full max-w-lg overflow-hidden rounded-2xl shadow-2xl ${bodyClass}`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Gradient header */}
        <div
          className={`relative bg-gradient-to-r ${HEADER_GRADIENT[feature.primarySource]} px-6 py-5 text-white`}
        >
          <button
            type="button"
            onClick={onClose}
            className="absolute right-3 top-3 rounded-full p-1 text-white/80 hover:bg-white/20 hover:text-white"
            aria-label="닫기"
          >
            <X className="h-4 w-4" />
          </button>
          <div className="text-xs font-medium uppercase tracking-wider opacity-90">
            Feature Attribution
          </div>
          <div className="mt-1 text-xl font-bold">{feature.featureName}</div>
          <div className="mt-1 text-sm opacity-95">
            {vendor.country} {vendor.name} · {vendor.productName}
          </div>
        </div>

        {/* Body */}
        <div className="space-y-4 px-6 py-5">
          {/* Vendor info */}
          <section>
            <div className={`text-xs font-semibold uppercase ${mutedClass}`}>
              원조 벤더
            </div>
            <div className="mt-1 text-sm">
              <div className="font-semibold">
                {vendor.name}{" "}
                <span className={`text-xs font-normal ${mutedClass}`}>
                  ({vendor.country})
                </span>
              </div>
              <div className={`text-xs ${mutedClass}`}>
                제품: {vendor.productName}
              </div>
              <div className={`text-xs ${mutedClass}`}>
                강점: {vendor.coreStrength}
              </div>
            </div>
          </section>

          {/* How ARIA differs */}
          <section className={`border-t pt-4 ${sectionBorder}`}>
            <div className={`text-xs font-semibold uppercase ${mutedClass}`}>
              ARIA의 차별점
            </div>
            <p className="mt-1 text-sm leading-relaxed">
              {feature.howAriaDiffers}
            </p>
          </section>

          {/* Secondary sources */}
          {secondary.length > 0 && (
            <section className={`border-t pt-4 ${sectionBorder}`}>
              <div className={`text-xs font-semibold uppercase ${mutedClass}`}>
                보조 출처
              </div>
              <ul className="mt-1 flex flex-wrap gap-2 text-xs">
                {secondary.map((v) => (
                  <li
                    key={v.key}
                    className={`rounded-full border px-2 py-0.5 ${
                      darkMode
                        ? "border-slate-600 bg-slate-800 text-slate-200"
                        : "border-slate-300 bg-slate-100 text-slate-700"
                    }`}
                  >
                    {v.country.split(" ")[0]} {v.name}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* YG-1 Original highlight */}
          {isOriginal && (
            <section
              className={`rounded-xl border-2 p-3 ${
                darkMode
                  ? "border-emerald-700 bg-emerald-950/40"
                  : "border-emerald-400 bg-emerald-50"
              }`}
            >
              <div className="flex items-center gap-2 text-sm font-bold text-emerald-700 dark:text-emerald-300">
                <Star className="h-4 w-4 fill-current" aria-hidden />
                🇰🇷 YG-1 Original
              </div>
              <p
                className={`mt-1 text-xs ${
                  darkMode ? "text-emerald-200/90" : "text-emerald-800"
                }`}
              >
                이 기능은 타 벤더에 없거나 업계 최초로 ARIA 가 설계했습니다.
              </p>
            </section>
          )}

          {/* External link */}
          <div className={`border-t pt-4 ${sectionBorder}`}>
            <a
              href={vendor.url}
              target="_blank"
              rel="noopener noreferrer"
              className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-medium transition ${
                darkMode
                  ? "border-slate-600 bg-slate-800 text-slate-100 hover:bg-slate-700"
                  : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
              }`}
            >
              출처 공식 사이트
              <ExternalLink className="h-3.5 w-3.5" />
            </a>
          </div>
        </div>
      </div>
    </div>
  )
}
