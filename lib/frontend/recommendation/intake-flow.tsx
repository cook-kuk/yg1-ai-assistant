"use client"

import Image from "next/image"
import { useMemo, useRef, useState } from "react"
import {
  AlertTriangle,
  ArrowRight,
  ChevronRight,
  Check,
  CheckCircle2,
  Edit2,
  HelpCircle,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import { useApp } from "@/lib/frontend/app-context"
import {
  type AnswerState,
  type IntakeFieldConfig,
  type ProductIntakeForm,
  FIELD_CONFIGS,
  OPERATION_SHAPES_BY_METHOD,
  allRequiredAnswered,
  countAnswered,
  countUnknowns,
} from "@/lib/frontend/recommendation/intake-types"
import { useCompetitorSpec } from "./use-competitor-spec"
import {
  getIntakeDisplayValue,
  getIntakeFieldLabel,
  localizeIntakeText,
} from "@/lib/frontend/recommendation/intake-localization"

const TOOL_CATEGORY_IMAGES: Record<string, string> = {
  Holemaking: "/images/reference/holemaking.png",
  Threading: "/images/reference/threading.png",
  Milling: "/images/reference/milling.png",
  Turning: "/images/reference/turning.png",
  "Tooling System": "/images/reference/turning.png",
}

const OPERATION_SHAPE_IMAGES: Record<string, string> = {
  // Holemaking
  Drilling: "/images/operations/drilling.png",
  Reaming_Blind: "/images/operations/reaming_blind.png",
  Reaming_Through: "/images/operations/reaming_through.png",
  // Threading
  Threading_Blind: "/images/operations/threading_blind.png",
  Threading_Through: "/images/operations/threading_through.png",
  // Milling
  Side_Milling: "/images/operations/side_milling.png",
  Slotting: "/images/operations/slotting.png",
  Profiling: "/images/operations/profiling.png",
  "Die-Sinking": "/images/operations/die_sinking.png",
  Taper_Side_Milling: "/images/operations/taper_side_milling.png",
  Corner_Radius: "/images/operations/corner_radius.png",
  Small_Part: "/images/operations/small_part.png",
  Facing: "/images/operations/facing.png",
  Trochoidal: "/images/operations/trochoidal.png",
  Helical_Interpolation: "/images/operations/helical_interpolation.png",
  // Turning
  ISO_Turning: "/images/operations/iso_turning.png",
  Parting_Grooving: "/images/operations/parting.png",
  // Tooling System
  Tool_Holder: "/images/operations/tool_holder.png",
  Accessory: "/images/operations/accessory.png",
}

const INQUIRY_PURPOSE_ICONS: Record<string, { icon: string; color: string }> = {
  new: { icon: "✨", color: "from-blue-500 to-indigo-500" },
  substitute: { icon: "🔄", color: "from-emerald-500 to-teal-500" },
  inventory_substitute: { icon: "📦", color: "from-amber-500 to-orange-500" },
  cutting_condition: { icon: "⚙️", color: "from-purple-500 to-violet-500" },
  product_lookup: { icon: "🔍", color: "from-gray-500 to-slate-500" },
}

const ISO_ACCENT_BY_TAG: Record<string, string> = {
  P: "text-sky-500",
  M: "text-amber-400",
  K: "text-rose-500",
  N: "text-lime-500",
  S: "text-orange-400",
  H: "text-zinc-400",
}

function ToolCategoryCard({
  option,
  selected,
  disabled,
  onClick,
}: {
  option: IntakeFieldConfig["options"][number]
  selected: boolean
  disabled?: boolean
  onClick: () => void
}) {
  const { language } = useApp()

  return (
    <button
      type="button"
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      className={[
        "group relative overflow-hidden rounded-2xl border text-left transition-all duration-200",
        disabled
          ? "cursor-not-allowed border-gray-200 bg-gray-50 opacity-50"
          : selected
            ? "border-gray-900 shadow-[0_8px_24px_-8px_rgba(15,23,42,0.4)]"
            : "border-gray-200 bg-white hover:-translate-y-0.5 hover:border-gray-300 hover:shadow-lg",
      ].join(" ")}
    >
      <div className="relative aspect-[4/3] bg-gray-100 flex items-center justify-center p-2">
        <Image
          src={TOOL_CATEGORY_IMAGES[option.value] ?? "/placeholder.jpg"}
          alt={option.label}
          fill
          className={`object-contain transition-transform duration-300 ${disabled ? "grayscale" : "group-hover:scale-[1.05]"}`}
          sizes="(max-width: 640px) 45vw, 180px"
        />
        {selected && (
          <div className="absolute top-2 right-2 flex h-5 w-5 items-center justify-center rounded-full bg-gray-900 text-white">
            <Check className="h-3 w-3" />
          </div>
        )}
      </div>
      <div className="px-3 py-2.5 bg-[linear-gradient(135deg,#fcfcfd_0%,#f2f2f4_100%)]">
        <p className="text-sm font-semibold text-gray-800">{option.label}</p>
        <p className="text-[10px] uppercase tracking-[0.2em] text-gray-400">
          {disabled ? (language === "ko" ? "준비 중" : "Coming Soon") : selected ? "Selected" : "Process"}
        </p>
      </div>
    </button>
  )
}

function MaterialOptionPanel({
  option,
  selected,
  onClick,
}: {
  option: IntakeFieldConfig["options"][number]
  selected: boolean
  onClick: () => void
}) {
  const accentClass = ISO_ACCENT_BY_TAG[option.tag ?? ""] ?? "text-gray-500"

  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        "rounded-xl border px-3 py-3 text-left transition-all duration-200",
        selected
          ? "border-gray-900 bg-white shadow-[0_8px_24px_-10px_rgba(15,23,42,0.4)]"
          : "border-gray-200 bg-[#f5f5f6] hover:-translate-y-0.5 hover:border-gray-300 hover:bg-white",
      ].join(" ")}
    >
      <div className="flex items-center gap-3">
        <div className={`text-3xl font-bold leading-none tracking-tight ${accentClass}`}>{option.tag}</div>
        <div className="flex-1">
          <div className="text-sm font-semibold text-gray-900">{option.label}</div>
        </div>
        <span
          className={[
            "inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-sm border",
            selected ? "border-gray-900 bg-gray-900 text-white" : "border-gray-300 bg-white text-transparent",
          ].join(" ")}
        >
          <Check className="h-3 w-3" />
        </span>
      </div>
    </button>
  )
}

function OptionBtn({
  label,
  selected,
  isUnknown = false,
  tag,
  onClick,
  disabled = false,
}: {
  label: string
  selected: boolean
  isUnknown?: boolean
  tag?: string
  onClick: () => void
  disabled?: boolean
}) {
  const { language } = useApp()

  if (disabled) {
    return (
      <div
        className="relative flex min-h-[44px] cursor-not-allowed select-none items-center gap-1.5 rounded-xl border-2 border-gray-100 bg-gray-50 px-3 py-2.5 text-left text-sm font-medium text-gray-400"
        title={language === "ko" ? "준비 중" : "Coming Soon"}
      >
        <span className="flex-1">{label}</span>
        {tag && <span className="rounded bg-gray-100 px-1.5 py-0.5 font-mono text-xs text-gray-300">{tag}</span>}
        <span className="whitespace-nowrap text-[10px] text-gray-300">{language === "ko" ? "준비 중" : "Coming Soon"}</span>
      </div>
    )
  }

  return (
    <button
      onClick={onClick}
      className={[
        "relative flex min-h-[44px] items-center gap-1.5 rounded-xl px-3 py-2.5 text-left text-sm font-medium transition-all",
        selected
          ? isUnknown
            ? "border-2 border-gray-400 bg-gray-200 text-gray-700"
            : "border-2 border-blue-600 bg-blue-600 text-white shadow-sm"
          : isUnknown
            ? "border-2 border-dashed border-gray-300 bg-white text-gray-500 hover:border-gray-400"
            : "border-2 border-gray-200 bg-white text-gray-700 hover:border-blue-300 hover:bg-blue-50",
      ].join(" ")}
    >
      {selected && !isUnknown && <Check size={13} className="shrink-0 text-blue-200" />}
      {isUnknown && <HelpCircle size={13} className={selected ? "shrink-0 text-gray-500" : "shrink-0 text-gray-400"} />}
      <span className="flex-1">{label}</span>
      {tag && (
        <span className={`rounded px-1.5 py-0.5 font-mono text-xs ${selected && !isUnknown ? "bg-blue-500 text-white" : "bg-gray-100 text-gray-500"}`}>
          {tag}
        </span>
      )}
    </button>
  )
}

function SubstituteModeInput({
  currentValue,
  onChange,
  onFormChange,
}: {
  currentValue: string | null
  onChange: (s: AnswerState<string>) => void
  onFormChange: (key: keyof ProductIntakeForm, val: AnswerState<string>) => void
}) {
  const [inputVal, setInputVal] = useState(currentValue ?? "")
  const { isResolving, resolvedSpec, resolveError, resolveSpec, clearSpec } =
    useCompetitorSpec(onFormChange)

  const handleSearch = () => {
    if (!inputVal.trim()) return
    onChange({ status: "known", value: inputVal.trim() })
    resolveSpec(inputVal.trim())
  }

  return (
    <div className="rounded-2xl border border-blue-200 bg-blue-50 p-4 space-y-3">
      <div className="flex items-center gap-2">
        <span className="text-lg">🔄</span>
        <div>
          <p className="text-sm font-semibold text-blue-800">
            현재 사용 중인 경쟁사 공구 모델명
          </p>
          <p className="text-[10px] text-blue-500 mt-0.5">
            입력하면 스펙을 자동으로 찾아 아래 항목을 채워줍니다
          </p>
        </div>
      </div>

      <div className="flex gap-2">
        <input
          className="flex-1 rounded-xl border-2 border-blue-300 bg-white px-3 py-2.5 text-sm
                     placeholder:text-gray-400 focus:border-blue-500 focus:outline-none"
          placeholder="예: GUHRING 3736, SANDVIK R216, SGS 47698..."
          value={inputVal}
          onChange={e => {
            setInputVal(e.target.value)
            onChange(
              e.target.value.trim()
                ? { status: "known", value: e.target.value.trim() }
                : { status: "unanswered" },
            )
          }}
          onKeyDown={e => e.key === "Enter" && handleSearch()}
        />
        <button
          type="button"
          onClick={handleSearch}
          disabled={!inputVal.trim() || isResolving}
          className="rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-medium text-white
                     hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed
                     flex items-center gap-1.5 whitespace-nowrap"
        >
          {isResolving ? (
            <>
              <div className="h-3.5 w-3.5 animate-spin rounded-full border-2
                              border-white border-t-transparent" />
              검색 중...
            </>
          ) : (
            <>🔍 스펙 검색</>
          )}
        </button>
      </div>

      {resolvedSpec && !isResolving && (
        <div className="rounded-xl border border-green-200 bg-white p-3 space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold text-green-700 flex items-center gap-1">
              ✓ 스펙 자동 완성됨
              <span className={`ml-1 rounded-full px-1.5 py-0.5 text-[9px] font-medium ${
                resolvedSpec.confidence === "high"
                  ? "bg-green-100 text-green-700"
                  : resolvedSpec.confidence === "medium"
                  ? "bg-amber-100 text-amber-700"
                  : "bg-gray-100 text-gray-500"
              }`}>
                {resolvedSpec.confidence === "high" ? "신뢰도 높음"
                  : resolvedSpec.confidence === "medium" ? "신뢰도 중간"
                  : "신뢰도 낮음 — 확인 권장"}
              </span>
            </p>
            <button
              type="button"
              onClick={() => { clearSpec(); setInputVal(""); onChange({ status: "unanswered" }) }}
              className="text-[10px] text-gray-400 hover:text-gray-600"
            >
              초기화
            </button>
          </div>
          <div className="grid grid-cols-3 gap-1.5 text-[11px]">
            {resolvedSpec.diameterMm != null && (
              <div className="rounded-lg bg-gray-50 px-2 py-1.5">
                <div className="text-gray-400">직경</div>
                <div className="font-semibold text-gray-800">φ{resolvedSpec.diameterMm}mm ✓</div>
              </div>
            )}
            {resolvedSpec.flutes != null && (
              <div className="rounded-lg bg-gray-50 px-2 py-1.5">
                <div className="text-gray-400">날수</div>
                <div className="font-semibold text-gray-800">{resolvedSpec.flutes}날 ✓</div>
              </div>
            )}
            {resolvedSpec.isoMaterial.length > 0 && (
              <div className="rounded-lg bg-gray-50 px-2 py-1.5">
                <div className="text-gray-400">소재</div>
                <div className="font-semibold text-gray-800">{resolvedSpec.isoMaterial.join("/")} ✓</div>
              </div>
            )}
            {resolvedSpec.toolSubtype && (
              <div className="rounded-lg bg-gray-50 px-2 py-1.5">
                <div className="text-gray-400">형상</div>
                <div className="font-semibold text-gray-800">{resolvedSpec.toolSubtype} ✓</div>
              </div>
            )}
            {resolvedSpec.coating && (
              <div className="rounded-lg bg-gray-50 px-2 py-1.5">
                <div className="text-gray-400">코팅</div>
                <div className="font-semibold text-gray-800">{resolvedSpec.coating}</div>
              </div>
            )}
          </div>
          {resolvedSpec.confidence === "low" && (
            <p className="text-[10px] text-amber-600 flex items-center gap-1">
              ⚠ 아래 항목들을 직접 확인하고 수정하세요
            </p>
          )}
          {resolvedSpec.source && (
            <p className="text-[10px] text-gray-400 truncate">출처: {resolvedSpec.source}</p>
          )}
        </div>
      )}

      {resolveError && !isResolving && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5">
          <p className="text-xs text-amber-700">
            ⚠ 스펙을 자동으로 찾지 못했습니다. 아래 항목을 직접 입력해주세요.
          </p>
        </div>
      )}
    </div>
  )
}

function IntakeFieldSection({
  config,
  index,
  state,
  onChange,
  form,
  onFormChange,
}: {
  config: IntakeFieldConfig
  index: number
  state: AnswerState<string>
  onChange: (s: AnswerState<string>) => void
  form?: ProductIntakeForm
  onFormChange?: (key: keyof ProductIntakeForm, val: AnswerState<string>) => void
}) {
  const { language } = useApp()
  const [showCustom, setShowCustom] = useState(false)
  const [customVal, setCustomVal] = useState(
    state.status === "known" &&
      !config.options.some(option => option.value === (state as { status: "known"; value: string }).value)
      ? (state as { status: "known"; value: string }).value
      : ""
  )
  const inputRef = useRef<HTMLInputElement>(null)
  const currentValue = state.status === "known" ? (state as { status: "known"; value: string }).value : null

  const selectedValues = useMemo(() => {
    if (!config.multiSelect || !currentValue) return new Set<string>()
    return new Set(currentValue.split(",").map(value => value.trim()).filter(Boolean))
  }, [config.multiSelect, currentValue])

  const isQuickOption = currentValue !== null && config.options.some(option =>
    config.multiSelect ? selectedValues.has(option.value) : option.value === currentValue
  )
  const isCustom = currentValue !== null && !isQuickOption && !config.multiSelect

  const handleCustomClick = () => {
    setShowCustom(true)
    setTimeout(() => inputRef.current?.focus(), 50)
  }

  const handleCustomChange = (value: string) => {
    setCustomVal(value)
    if (value.trim()) onChange({ status: "known", value: value.trim() })
    else onChange({ status: "unanswered" })
  }

  const handleMultiToggle = (optionValue: string) => {
    const next = new Set(selectedValues)
    if (next.has(optionValue)) next.delete(optionValue)
    else next.add(optionValue)

    if (next.size === 0) onChange({ status: "unanswered" })
    else onChange({ status: "known", value: [...next].join(",") })
  }

  const selectedCount = config.multiSelect ? selectedValues.size : (state.status === "known" ? 1 : 0)
  const isSubstituteMode =
    config.key === "toolTypeOrCurrentProduct" &&
    form?.inquiryPurpose?.status === "known" &&
    (form.inquiryPurpose as { status: "known"; value: string }).value === "substitute"

  const referenceStyleSelection =
    config.key === "toolTypeOrCurrentProduct" ? (
      isSubstituteMode && onFormChange ? (
        <SubstituteModeInput
          currentValue={currentValue}
          onChange={onChange}
          onFormChange={onFormChange}
        />
      ) : (
        <div className="rounded-2xl border border-gray-200 bg-[radial-gradient(circle_at_top_left,#ffffff_0%,#f4f4f5_72%)] p-3">
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(clamp(120px, 22vw, 240px), 1fr))", gap: "0.5rem" }}>
            {config.options.map(option => (
              <ToolCategoryCard
                key={option.value}
                option={option}
                disabled={option.disabled}
                selected={state.status === "known" && currentValue === option.value}
                onClick={() => onChange({ status: "known", value: option.value })}
              />
            ))}
          </div>
        </div>
      )
    ) : config.key === "inquiryPurpose" ? (
      <div className="rounded-2xl border border-gray-200 bg-[linear-gradient(180deg,#ffffff_0%,#fafafa_100%)] p-3">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(clamp(100px, 20vw, 220px), 1fr))", gap: "0.5rem" }}>
          {config.options.map(option => {
            const iconConfig = INQUIRY_PURPOSE_ICONS[option.value]
            const isSelected = state.status === "known" && currentValue === option.value
            return (
              <button
                key={option.value}
                type="button"
                disabled={option.disabled}
                onClick={() => onChange({ status: "known", value: option.value })}
                className={[
                  "group flex items-center gap-2.5 rounded-xl border px-3 py-3 text-left transition-all duration-200",
                  option.disabled
                    ? "cursor-not-allowed border-gray-100 bg-gray-50 opacity-50"
                    : isSelected
                      ? "border-gray-900 bg-white shadow-[0_6px_20px_-8px_rgba(15,23,42,0.3)]"
                      : "border-gray-200 bg-white hover:-translate-y-0.5 hover:border-gray-300 hover:shadow-md",
                ].join(" ")}
              >
                <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br ${iconConfig?.color ?? "from-gray-400 to-gray-500"} text-sm shadow-sm`}>
                  {iconConfig?.icon ?? "📋"}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-semibold text-gray-900">{localizeIntakeText(option.label, language)}</p>
                  {option.disabled && <p className="text-[9px] text-gray-400">{language === "ko" ? "준비 중" : "Coming Soon"}</p>}
                </div>
                {isSelected && <Check className="h-4 w-4 shrink-0 text-gray-900" />}
              </button>
            )
          })}
        </div>
      </div>
    ) : config.key === "operationType" && config.multiSelect ? (() => {
      const selectedMethod = form?.toolTypeOrCurrentProduct
      const methodValue = selectedMethod?.status === "known" ? (selectedMethod as { status: "known"; value: string }).value : null
      const filteredOptions = methodValue && OPERATION_SHAPES_BY_METHOD[methodValue]
        ? OPERATION_SHAPES_BY_METHOD[methodValue]
        : config.options
      const needsMethod = !methodValue

      return (
        <div className="rounded-2xl border border-gray-200 bg-[linear-gradient(180deg,#ffffff_0%,#fafafa_100%)] p-3">
          {needsMethod ? (
            <div className="flex flex-col items-center justify-center py-8 text-center">
              <div className="mb-2 text-2xl">🛠️</div>
              <p className="text-sm font-medium text-gray-500">
                {language === "ko" ? "먼저 가공 방식을 선택해 주세요" : "Please select a machining method first"}
              </p>
              <p className="mt-1 text-[10px] text-gray-400">
                {language === "ko" ? "가공 방식에 따라 형상이 표시됩니다" : "Shapes will appear based on your method"}
              </p>
            </div>
          ) : (
            <>
              <div className="mb-2 flex items-center justify-between">
                <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-gray-400">
                  {methodValue} — {language === "ko" ? "가공 형상" : "Application Shape"}
                </p>
                <span className="text-[10px] text-gray-400">
                  {selectedValues.size > 0
                    ? `${selectedValues.size}${language === "ko" ? "개 선택" : " selected"}`
                    : language === "ko" ? "복수 선택" : "Multi"}
                </span>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(clamp(80px, 14vw, 130px), 1fr))", gap: "0.5rem" }}>
                {filteredOptions.map(option => {
                  const imgSrc = OPERATION_SHAPE_IMAGES[option.value]
                  const isSelected = selectedValues.has(option.value)
                  return (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => handleMultiToggle(option.value)}
                      className={[
                        "group flex flex-col items-center gap-1.5 rounded-xl border p-3 transition-all duration-150",
                        isSelected
                          ? "border-blue-500 bg-blue-50 shadow-md"
                          : "border-gray-200 bg-white hover:border-gray-300 hover:shadow-md hover:-translate-y-0.5",
                      ].join(" ")}
                    >
                      {imgSrc ? (
                        <div className="flex h-16 w-16 items-center justify-center rounded-lg bg-slate-100 p-1.5">
                          <img src={imgSrc} alt={option.label} className="h-full w-full object-contain" style={{ filter: "contrast(1.6) brightness(0.85)" }} />
                        </div>
                      ) : (
                        <div className="flex h-16 w-16 items-center justify-center rounded-lg bg-gray-100 text-gray-400 text-xs">?</div>
                      )}
                      <span className={`text-[10px] font-medium text-center leading-tight ${isSelected ? "text-blue-700" : "text-gray-600"}`}>
                        {option.label}
                      </span>
                      {isSelected && (
                        <div className="absolute top-1.5 right-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-blue-500 text-white">
                          <Check className="h-2.5 w-2.5" />
                        </div>
                      )}
                    </button>
                  )
                })}
              </div>
            </>
          )}
        </div>
      )
    })()
    : config.key === "material" && config.multiSelect ? (
      <div className="rounded-2xl border border-gray-200 bg-[linear-gradient(180deg,#ffffff_0%,#fafafa_100%)] p-3">
        <div className="mb-2 flex items-center justify-between">
          <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-gray-400">
            {language === "ko" ? "ISO 소재 그룹" : "ISO Material Group"}
          </p>
          <span className="text-[10px] text-gray-400">
            {selectedValues.size > 0
              ? `${selectedValues.size}${language === "ko" ? "개 선택" : " selected"}`
              : language === "ko" ? "복수 선택" : "Multi"}
          </span>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(clamp(100px, 16vw, 180px), 1fr))", gap: "0.5rem" }}>
          {config.options.map(option => (
            <MaterialOptionPanel
              key={option.value}
              option={option}
              selected={selectedValues.has(option.value)}
              onClick={() => handleMultiToggle(option.value)}
            />
          ))}
        </div>
      </div>
    ) : config.key === "diameterInfo" ? (
      <div className="rounded-2xl border border-gray-200 bg-[linear-gradient(180deg,#ffffff_0%,#fafafa_100%)] p-3">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(clamp(40px, 7vw, 65px), 1fr))", gap: "0.25rem" }} className="mb-3">
          {config.options.map(option => {
            const diamNum = parseFloat(option.value)
            const barPct = 30 + (diamNum / 12) * 70
            const isSelected = state.status === "known" && currentValue === option.value
            return (
              <button
                key={option.value}
                type="button"
                onClick={() => { setShowCustom(false); onChange({ status: "known", value: option.value }) }}
                className="group flex flex-col items-center gap-1"
              >
                <div className="w-full flex items-end justify-center" style={{ height: "60px" }}>
                  <div
                    className={[
                      "rounded-sm transition-all duration-200 w-3/5",
                      isSelected
                        ? "bg-gradient-to-t from-blue-600 to-blue-400 shadow-md"
                        : "bg-gradient-to-t from-gray-300 to-gray-200 group-hover:from-blue-400 group-hover:to-blue-300",
                    ].join(" ")}
                    style={{ height: `${barPct}%` }}
                  />
                </div>
                <span className={`text-[10px] font-mono font-semibold ${isSelected ? "text-blue-700" : "text-gray-500"}`}>
                  {option.label}
                </span>
              </button>
            )
          })}
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={handleCustomClick}
            className={[
              "flex-1 rounded-xl border-2 border-dashed px-3 py-2 text-xs font-medium transition-colors",
              isCustom || (showCustom && state.status !== "unknown")
                ? "border-blue-400 bg-blue-50 text-blue-700"
                : "border-gray-300 text-gray-500 hover:border-gray-400",
            ].join(" ")}
          >
            {localizeIntakeText(config.customInputLabel ?? "직접 입력", language)}
          </button>
        </div>
      </div>
    ) : null

  return (
    <div className="space-y-2 rounded-xl border border-gray-200 bg-white p-3">
      <div className="flex items-start gap-2">
        <div className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-blue-100 text-[10px] font-bold text-blue-700">
          {index + 1}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="text-sm">{config.emoji}</span>
            <span className="text-xs font-semibold text-gray-900">{getIntakeFieldLabel(config.key as keyof ProductIntakeForm, language)}</span>
            {state.status !== "unanswered" && (
              <span className={`rounded-full px-1.5 py-0.5 text-[10px] ${state.status === "unknown" ? "bg-gray-100 text-gray-500" : "bg-green-100 text-green-700"}`}>
                {state.status === "unknown"
                  ? (language === "ko" ? "모름" : "Unknown")
                  : config.multiSelect && selectedCount > 1
                    ? `${selectedCount}${language === "ko" ? "개 선택" : " selected"}`
                    : (language === "ko" ? "선택됨" : "Selected")}
              </span>
            )}
          </div>
          <p className="text-[10px] text-gray-500">{localizeIntakeText(config.description, language)}</p>
        </div>
      </div>
      {referenceStyleSelection ? (
        referenceStyleSelection
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(clamp(80px, 13vw, 140px), 1fr))", gap: "0.375rem" }}>
          {config.options.map(option => (
            <OptionBtn
              key={option.value}
              label={localizeIntakeText(option.label, language)}
              tag={option.tag}
              disabled={option.disabled}
              selected={config.multiSelect ? selectedValues.has(option.value) : state.status === "known" && currentValue === option.value}
              onClick={() => {
                setShowCustom(false)
                if (config.multiSelect) handleMultiToggle(option.value)
                else onChange({ status: "known", value: option.value })
              }}
            />
          ))}
          {config.hasCustomInput && (
            <OptionBtn
              label={localizeIntakeText(config.customInputLabel ?? "직접 입력", language)}
              selected={isCustom || (showCustom && state.status !== "unknown")}
              onClick={handleCustomClick}
            />
          )}
        </div>
      )}
      {config.hasCustomInput && (showCustom || isCustom) && state.status !== "unknown" && (
        <input
          ref={inputRef}
          value={customVal}
          onChange={event => handleCustomChange(event.target.value)}
          placeholder={localizeIntakeText(config.customInputPlaceholder ?? "직접 입력", language)}
          className="w-full rounded-lg border-2 border-blue-300 px-3 py-2 text-xs focus:border-blue-500 focus:outline-none"
        />
      )}
      <button
        type="button"
        onClick={() => {
          setShowCustom(false)
          setCustomVal("")
          onChange({ status: "unknown" })
        }}
        className={[
          "w-full rounded-lg border px-3 py-2 text-xs font-medium transition-all",
          state.status === "unknown"
            ? "border-gray-400 bg-gray-200 text-gray-700"
            : "border-dashed border-gray-300 text-gray-400 hover:border-gray-400 hover:text-gray-500",
        ].join(" ")}
      >
        {localizeIntakeText(config.unknownLabel, language)}
      </button>
    </div>
  )
}

export function IntakeGate({
  form,
  onChange,
  onNext,
}: {
  form: ProductIntakeForm
  onChange: (key: keyof ProductIntakeForm, val: AnswerState<string>) => void
  onNext: () => void
}) {
  const { language } = useApp()
  const answered = countAnswered(form)
  const allDone = allRequiredAnswered(form)

  const fieldRefs = useRef<Record<string, HTMLDivElement | null>>({})
  const scrollContainerRef = useRef<HTMLDivElement | null>(null)

  const scrollToNextUnanswered = (justAnsweredKey: string) => {
    const index = FIELD_CONFIGS.findIndex(config => config.key === justAnsweredKey)
    for (let offset = 1; offset <= FIELD_CONFIGS.length; offset++) {
      const nextIndex = (index + offset) % FIELD_CONFIGS.length
      const nextKey = FIELD_CONFIGS[nextIndex].key
      const nextState = form[nextKey as keyof ProductIntakeForm] as AnswerState<string>
      if (nextState.status === "unanswered") {
        const element = fieldRefs.current[nextKey]
        if (element && scrollContainerRef.current) {
          setTimeout(() => {
            element.scrollIntoView({ behavior: "smooth", block: "center" })
            element.classList.add("ring-2", "ring-blue-400", "ring-offset-2")
            setTimeout(() => element.classList.remove("ring-2", "ring-blue-400", "ring-offset-2"), 1500)
          }, 200)
        }
        return
      }
    }
  }

  const handleFieldChange = (key: keyof ProductIntakeForm, value: AnswerState<string>) => {
    onChange(key, value)
    // 가공방식 변경 시 가공형상 초기화 (종속 선택)
    if (key === "toolTypeOrCurrentProduct") {
      const prev = form.toolTypeOrCurrentProduct
      const prevVal = prev.status === "known" ? (prev as { status: "known"; value: string }).value : null
      const newVal = value.status === "known" ? (value as { status: "known"; value: string }).value : null
      if (prevVal !== newVal && form.operationType.status === "known") {
        onChange("operationType", { status: "unanswered" })
      }
    }
    if (value.status !== "unanswered") scrollToNextUnanswered(key as string)
  }

  return (
    <div className="flex h-full flex-col">
      <div className="shrink-0 border-b bg-white px-4 pb-4 pt-5">
        <h2 className="text-base font-bold text-gray-900">{language === "ko" ? "추천 전 기본 정보 확인" : "Basic Info Before Recommendation"}</h2>
        <p className="mt-0.5 text-xs text-gray-500">
          {language === "ko"
            ? <span>모르는 항목은 비워두지 말고 <strong>&apos;모름&apos;</strong>을 선택해 주세요. 추정하지 않습니다.</span>
            : <span>For unknown fields, select <strong>&apos;Unknown&apos;</strong> instead of leaving blank. No guessing.</span>}
        </p>
        <div className="mt-3 flex items-center gap-2">
          {FIELD_CONFIGS.map((config, index) => {
            const fieldState = form[config.key as keyof ProductIntakeForm] as AnswerState<string>
            const done = fieldState.status !== "unanswered"
            return (
              <button
                key={index}
                className={`h-1.5 flex-1 cursor-pointer rounded-full transition-colors hover:opacity-80 ${done ? "bg-blue-500" : "bg-gray-200"}`}
                onClick={() => {
                  const element = fieldRefs.current[config.key]
                  if (element) element.scrollIntoView({ behavior: "smooth", block: "center" })
                }}
                title={getIntakeFieldLabel(config.key as keyof ProductIntakeForm, language)}
              />
            )
          })}
          <span className="whitespace-nowrap text-xs text-gray-500">{answered}/6</span>
        </div>
      </div>
      <div ref={scrollContainerRef} className="flex-1 space-y-3 overflow-y-auto bg-[linear-gradient(180deg,#ffffff_0%,#f7f7f8_100%)] px-4 py-4">
        {FIELD_CONFIGS.map((config, index) => (
          <div key={config.key} ref={element => { fieldRefs.current[config.key] = element }} className="rounded-xl transition-all duration-300">
            <IntakeFieldSection
              config={config}
              index={index}
              state={form[config.key as keyof ProductIntakeForm] as AnswerState<string>}
              onChange={value => handleFieldChange(config.key as keyof ProductIntakeForm, value)}
              form={form}
              onFormChange={(key, val) => handleFieldChange(key, val)}
            />
          </div>
        ))}
        <div className="h-4" />
      </div>
      <div className="shrink-0 border-t bg-white px-4 py-3 shadow-md">
        <div className="mx-auto flex max-w-lg items-center justify-between">
          <span className="text-sm text-gray-600">
            {allDone
              ? <span className="flex items-center gap-1 font-medium text-green-700"><CheckCircle2 size={14} />{language === "ko" ? "모든 필드를 입력했습니다." : "All fields complete"}</span>
              : <span>{answered}/6 {language === "ko" ? `항목 입력, ${6 - answered}개 남음` : `complete, ${6 - answered} remaining`}</span>}
          </span>
          <Button onClick={onNext} disabled={!allDone} className="gap-2">
            {language === "ko" ? "조건 요약 확인" : "Review Conditions"} <ArrowRight size={14} />
          </Button>
        </div>
      </div>
    </div>
  )
}

export function IntakeSummaryScreen({
  form,
  onEdit,
  onStart,
}: {
  form: ProductIntakeForm
  onEdit: () => void
  onStart: () => void
}) {
  const { language } = useApp()
  const unknownCount = countUnknowns(form)

  return (
    <div className="flex h-full flex-col">
      <div className="shrink-0 border-b bg-white px-4 pb-4 pt-5">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-base font-bold text-gray-900">{language === "ko" ? "입력 조건 요약" : "Condition Summary"}</h2>
            <p className="mt-0.5 text-xs text-gray-500">
              {language === "ko" ? "아래 조건으로 검색합니다. 모르는 정보는 추정하지 않습니다." : "Will search with these conditions. Unknown fields are not guessed."}
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={onEdit} className="gap-1 text-xs">
            <Edit2 size={12} />
            {language === "ko" ? "수정" : "Edit"}
          </Button>
        </div>
      </div>
      <div className="flex-1 space-y-2 overflow-y-auto px-4 py-4">
        {FIELD_CONFIGS.map(config => {
          const state = form[config.key as keyof ProductIntakeForm] as AnswerState<string>
          const isUnknown = state.status === "unknown"
          const displayValue = getIntakeDisplayValue(config.key as keyof ProductIntakeForm, state, language)
          return (
            <div
              key={config.key}
              className={`flex items-center gap-3 rounded-xl border px-4 py-3 ${isUnknown ? "border-gray-200 bg-gray-50" : "border-gray-200 bg-white"}`}
            >
              <div className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${isUnknown ? "bg-gray-200" : "bg-green-100"}`}>
                {isUnknown ? <HelpCircle size={14} className="text-gray-400" /> : <Check size={14} className="text-green-600" />}
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-xs text-gray-500">{config.emoji} {getIntakeFieldLabel(config.key as keyof ProductIntakeForm, language)}</div>
                <div className={`mt-0.5 text-sm font-medium ${isUnknown ? "italic text-gray-400" : "text-gray-900"}`}>
                  {displayValue}
                </div>
              </div>
              <button onClick={onEdit} className="shrink-0 text-xs text-blue-500 hover:text-blue-700">
                {language === "ko" ? "수정" : "Edit"}
              </button>
            </div>
          )
        })}
        {unknownCount > 0 && (
          <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
            <AlertTriangle size={14} className="mt-0.5 shrink-0 text-amber-600" />
            <div className="text-xs leading-relaxed text-amber-800">
              {language === "ko" ? (
                <>
                  <strong>{unknownCount}개 항목이 &quot;모름&quot;</strong>으로 설정되어 있습니다.
                  {unknownCount >= 3
                    ? " 모르는 조건이 많아 정확 추천 대신 근사 후보를 제공할 수 있습니다."
                    : " 모르는 조건은 필터에서 제외하고, 확인된 조건만 기준으로 추천합니다."}
                </>
              ) : (
                <>
                  <strong>{unknownCount} field(s) set to &quot;Unknown&quot;</strong>.
                  {unknownCount >= 3
                    ? " Many conditions unknown, so approximate candidates may be provided instead of exact matches."
                    : " Unknown fields will be excluded from filters; recommendation based on known conditions only."}
                </>
              )}
            </div>
          </div>
        )}
        {unknownCount === 0 && (
          <div className="flex items-center gap-2 rounded-xl border border-green-200 bg-green-50 px-4 py-3">
            <CheckCircle2 size={14} className="text-green-600" />
            <span className="text-xs text-green-800">
              {language === "ko" ? "모든 조건을 입력했습니다. 더 정확한 추천이 가능합니다." : "All conditions entered. Exact recommendations are possible."}
            </span>
          </div>
        )}
        <div className="h-4" />
      </div>
      <div className="shrink-0 space-y-2 border-t bg-white px-4 py-3 shadow-md">
        <div className="mx-auto max-w-lg">
          <Button onClick={onStart} className="w-full gap-2">
            {language === "ko" ? "이 조건으로 추천 시작" : "Start Recommendation"} <ArrowRight size={14} />
          </Button>
          <Button variant="ghost" onClick={onEdit} className="mt-1 w-full gap-1 text-xs text-gray-500">
            <Edit2 size={11} />
            {language === "ko" ? "조건 다시 수정" : "Edit Conditions"}
          </Button>
        </div>
      </div>
    </div>
  )
}

export function LoadingScreen() {
  const { language } = useApp()
  return (
    <div className="flex flex-1 flex-col items-center justify-center px-4 py-16 text-center">
      <div className="mb-4 flex gap-1.5">
        {[0, 1, 2].map(index => (
          <div key={index} className="h-2 w-2 animate-bounce rounded-full bg-blue-500" style={{ animationDelay: `${index * 0.15}s` }} />
        ))}
      </div>
      <div className="text-sm font-medium text-gray-700">{language === "ko" ? "실제 데이터에서 제품을 검색 중입니다..." : "Searching products from real data..."}</div>
      <div className="mt-1 text-xs text-gray-400">{language === "ko" ? "없는 제품은 생성하지 않습니다." : "Only real products - no hallucination"}</div>
    </div>
  )
}

export function buildIntakePromptText(form: ProductIntakeForm, language: "ko" | "en"): string {
  const parts: string[] = []
  FIELD_CONFIGS.forEach(config => {
    const state = form[config.key as keyof ProductIntakeForm] as AnswerState<string>
    const value = getIntakeDisplayValue(config.key as keyof ProductIntakeForm, state, language)
    const label = getIntakeFieldLabel(config.key as keyof ProductIntakeForm, language)
    parts.push(`${config.emoji} ${label}: ${value}`)
  })
  parts.push(
    language === "ko"
      ? "\n위 조건에 맞는 YG-1 제품을 추천해 주세요."
      : "\nPlease recommend suitable YG-1 products based on the conditions above."
  )
  return parts.join("\n")
}
