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
  allRequiredAnswered,
  countAnswered,
  countUnknowns,
} from "@/lib/frontend/recommendation/intake-types"
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

  if (disabled) {
    return (
      <div className="grid min-h-[108px] grid-cols-[120px_1fr] overflow-hidden rounded-[28px] border border-gray-200 bg-gray-100 opacity-60">
        <div className="relative bg-gray-200">
          <Image
            src={TOOL_CATEGORY_IMAGES[option.value] ?? "/placeholder.jpg"}
            alt={option.label}
            fill
            className="object-cover grayscale"
            sizes="120px"
          />
        </div>
        <div className="flex items-center justify-between px-6 py-5">
          <div>
            <p className="text-[28px] font-light tracking-[-0.03em] text-gray-500">{option.label}</p>
            <p className="mt-1 text-xs uppercase tracking-[0.24em] text-gray-400">
              {language === "ko" ? "준비 중" : "Coming Soon"}
            </p>
          </div>
          <ChevronRight className="h-5 w-5 text-gray-400" />
        </div>
      </div>
    )
  }

  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        "group grid min-h-[108px] w-full grid-cols-[120px_1fr] overflow-hidden rounded-[28px] border bg-white text-left transition-all duration-200",
        selected
          ? "border-gray-900 shadow-[0_20px_50px_-28px_rgba(15,23,42,0.55)]"
          : "border-gray-200 hover:-translate-y-0.5 hover:border-gray-300 hover:shadow-[0_20px_45px_-32px_rgba(15,23,42,0.45)]",
      ].join(" ")}
    >
      <div className="relative bg-gray-200">
        <Image
          src={TOOL_CATEGORY_IMAGES[option.value] ?? "/placeholder.jpg"}
          alt={option.label}
          fill
          className="object-cover transition-transform duration-300 group-hover:scale-[1.03]"
          sizes="120px"
        />
      </div>
      <div className="flex items-center justify-between bg-[linear-gradient(135deg,#fcfcfd_0%,#f2f2f4_100%)] px-6 py-5">
        <div>
          <p className="text-[28px] font-light tracking-[-0.03em] text-gray-800">{option.label}</p>
          <p className="mt-1 text-xs uppercase tracking-[0.24em] text-gray-400">{selected ? "Selected" : "Process"}</p>
        </div>
        <div
          className={[
            "flex h-10 w-10 items-center justify-center rounded-full border transition-colors",
            selected ? "border-gray-900 bg-gray-900 text-white" : "border-gray-300 bg-white text-gray-500",
          ].join(" ")}
        >
          <ChevronRight className="h-4 w-4" />
        </div>
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
        "rounded-[24px] border px-5 py-5 text-left transition-all duration-200",
        selected
          ? "border-gray-900 bg-white shadow-[0_20px_45px_-34px_rgba(15,23,42,0.55)]"
          : "border-gray-200 bg-[#f5f5f6] hover:-translate-y-0.5 hover:border-gray-300 hover:bg-white",
      ].join(" ")}
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className={`text-5xl font-semibold leading-none tracking-[-0.06em] ${accentClass}`}>{option.tag}</div>
          <div className="mt-2 text-lg font-semibold text-gray-900">{option.label}</div>
        </div>
        <span
          className={[
            "mt-1 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-sm border",
            selected ? "border-gray-900 bg-gray-900 text-white" : "border-gray-300 bg-white text-transparent",
          ].join(" ")}
          aria-hidden="true"
        >
          <Check className="h-3.5 w-3.5" />
        </span>
      </div>
      <div className="mt-5 border-t border-gray-200 pt-4">
        <div className="flex items-start gap-3 text-sm text-gray-700">
          <span
            className={[
              "mt-0.5 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-[2px] border",
              selected ? "border-gray-900 bg-gray-900 text-white" : "border-gray-300 bg-white text-transparent",
            ].join(" ")}
            aria-hidden="true"
          >
            <Check className="h-3 w-3" />
          </span>
          <span className="leading-5">{option.label}</span>
        </div>
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

function IntakeFieldSection({
  config,
  index,
  state,
  onChange,
}: {
  config: IntakeFieldConfig
  index: number
  state: AnswerState<string>
  onChange: (s: AnswerState<string>) => void
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
  const referenceStyleSelection =
    config.key === "toolTypeOrCurrentProduct" ? (
      <div className="rounded-[32px] border border-gray-200 bg-[radial-gradient(circle_at_top_left,#ffffff_0%,#f4f4f5_72%)] p-3 sm:p-4">
        <div className="mb-3 px-2">
          <p className="text-xs font-semibold uppercase tracking-[0.28em] text-gray-400">
            {language === "ko" ? "가공 방식" : "Tool Family"}
          </p>
        </div>
        <div className="space-y-3">
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
    ) : config.key === "material" && config.multiSelect ? (
      <div className="rounded-[32px] border border-gray-200 bg-[linear-gradient(180deg,#ffffff_0%,#fafafa_100%)] p-4 sm:p-5">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.28em] text-gray-400">
              {language === "ko" ? "가공 소재" : "Work Material"}
            </p>
            <p className="mt-1 text-sm text-gray-500">
              {language === "ko" ? "ISO 그룹 기준으로 소재를 선택하세요." : "Choose material groups by ISO class."}
            </p>
          </div>
          <div className="rounded-full bg-gray-100 px-3 py-1 text-xs font-medium text-gray-500">
            {selectedValues.size > 0
              ? `${selectedValues.size}${language === "ko" ? "개 선택" : " selected"}`
              : language === "ko"
                ? "복수 선택 가능"
                : "Multi-select"}
          </div>
        </div>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
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
    ) : null

  return (
    <div className="space-y-3 rounded-2xl border border-gray-200 bg-white p-4">
      <div className="flex items-start gap-3">
        <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-blue-100 text-xs font-bold text-blue-700">
          {index + 1}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="text-base">{config.emoji}</span>
            <span className="text-sm font-semibold text-gray-900">{getIntakeFieldLabel(config.key as keyof ProductIntakeForm, language)}</span>
            {state.status !== "unanswered" && (
              <span className={`rounded-full px-1.5 py-0.5 text-xs ${state.status === "unknown" ? "bg-gray-100 text-gray-500" : "bg-green-100 text-green-700"}`}>
                {state.status === "unknown"
                  ? (language === "ko" ? "모름" : "Unknown")
                  : config.multiSelect && selectedCount > 1
                    ? `${selectedCount}${language === "ko" ? "개 선택" : " selected"}`
                    : (language === "ko" ? "선택됨" : "Selected")}
              </span>
            )}
          </div>
          <p className="mt-0.5 text-xs text-gray-500">{localizeIntakeText(config.description, language)}</p>
        </div>
      </div>
      {referenceStyleSelection ? (
        referenceStyleSelection
      ) : (
        <div className="flex flex-wrap gap-2">
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
          className="w-full rounded-xl border-2 border-blue-300 px-3 py-2.5 text-sm focus:border-blue-500 focus:outline-none"
        />
      )}
      <div className="border-t border-gray-100 pt-1">
        <OptionBtn
          label={localizeIntakeText(config.unknownLabel, language)}
          isUnknown
          selected={state.status === "unknown"}
          onClick={() => {
            setShowCustom(false)
            setCustomVal("")
            onChange({ status: "unknown" })
          }}
        />
      </div>
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
