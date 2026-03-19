"use client"

import { useMemo, useRef, useState } from "react"
import {
  AlertTriangle,
  ArrowRight,
  Check,
  CheckCircle2,
  Edit2,
  HelpCircle,
  Info,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import { useApp } from "@/lib/frontend/app-context"
import {
  type AnswerState,
  type InquiryPurpose,
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
        className="relative flex items-center gap-1.5 px-3 py-2.5 rounded-xl text-sm font-medium text-left min-h-[44px] bg-gray-50 text-gray-400 border-2 border-gray-100 cursor-not-allowed select-none"
        title={language === "ko" ? "준비 중" : "Coming Soon"}
      >
        <span className="flex-1">{label}</span>
        {tag && <span className="text-xs px-1.5 py-0.5 rounded font-mono bg-gray-100 text-gray-300">{tag}</span>}
        <span className="text-[10px] text-gray-300 whitespace-nowrap">{language === "ko" ? "준비 중" : "Coming Soon"}</span>
      </div>
    )
  }

  return (
    <button
      onClick={onClick}
      className={[
        "relative flex items-center gap-1.5 px-3 py-2.5 rounded-xl text-sm font-medium transition-all text-left min-h-[44px]",
        selected
          ? isUnknown
            ? "bg-gray-200 text-gray-700 border-2 border-gray-400"
            : "bg-blue-600 text-white border-2 border-blue-600 shadow-sm"
          : isUnknown
            ? "bg-white text-gray-500 border-2 border-dashed border-gray-300 hover:border-gray-400"
            : "bg-white text-gray-700 border-2 border-gray-200 hover:border-blue-300 hover:bg-blue-50",
      ].join(" ")}
    >
      {selected && !isUnknown && <Check size={13} className="shrink-0 text-blue-200" />}
      {isUnknown && <HelpCircle size={13} className={selected ? "shrink-0 text-gray-500" : "shrink-0 text-gray-400"} />}
      <span className="flex-1">{label}</span>
      {tag && (
        <span className={`text-xs px-1.5 py-0.5 rounded font-mono ${selected && !isUnknown ? "bg-blue-500 text-white" : "bg-gray-100 text-gray-500"}`}>
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

  return (
    <div className="bg-white rounded-2xl border border-gray-200 p-4 space-y-3">
      <div className="flex items-start gap-3">
        <div className="flex-shrink-0 w-7 h-7 rounded-full bg-blue-100 flex items-center justify-center text-xs font-bold text-blue-700">
          {index + 1}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="text-base">{config.emoji}</span>
            <span className="text-sm font-semibold text-gray-900">{getIntakeFieldLabel(config.key as keyof ProductIntakeForm, language)}</span>
            {state.status !== "unanswered" && (
              <span className={`text-xs px-1.5 py-0.5 rounded-full ${state.status === "unknown" ? "bg-gray-100 text-gray-500" : "bg-green-100 text-green-700"}`}>
                {state.status === "unknown"
                  ? (language === "ko" ? "모름" : "Unknown")
                  : config.multiSelect && selectedCount > 1
                    ? `✓ ${selectedCount}${language === "ko" ? "개 선택" : " selected"}`
                    : (language === "ko" ? "✓ 선택됨" : "✓ Selected")}
              </span>
            )}
          </div>
          <p className="text-xs text-gray-500 mt-0.5">{localizeIntakeText(config.description, language)}</p>
        </div>
      </div>
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
            label={localizeIntakeText(config.customInputLabel ?? "직접입력", language)}
            selected={isCustom || (showCustom && state.status !== "unknown")}
            onClick={handleCustomClick}
          />
        )}
      </div>
      {config.hasCustomInput && (showCustom || isCustom) && state.status !== "unknown" && (
        <input
          ref={inputRef}
          value={customVal}
          onChange={event => handleCustomChange(event.target.value)}
          placeholder={localizeIntakeText(config.customInputPlaceholder ?? "직접 입력", language)}
          className="w-full px-3 py-2.5 rounded-xl border-2 border-blue-300 text-sm focus:outline-none focus:border-blue-500"
        />
      )}
      <div className="pt-1 border-t border-gray-100">
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
  const purposeIsSubstitute =
    form.inquiryPurpose.status === "known" &&
    ((form.inquiryPurpose as { status: "known"; value: InquiryPurpose }).value === "substitute" ||
      (form.inquiryPurpose as { status: "known"; value: InquiryPurpose }).value === "inventory_substitute")

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
    <div className="flex flex-col h-full">
      <div className="shrink-0 px-4 pt-5 pb-4 border-b bg-white">
        <h2 className="text-base font-bold text-gray-900">{language === "ko" ? "추천 전 기본 정보 확인" : "Basic Info Before Recommendation"}</h2>
        <p className="text-xs text-gray-500 mt-0.5">
          {language === "ko"
            ? <span>모르는 항목은 비워두지 말고 <strong>&apos;모름&apos;</strong>을 선택해주세요. 추정하지 않습니다.</span>
            : <span>For unknown fields, select <strong>&apos;Unknown&apos;</strong> instead of leaving blank. No guessing.</span>}
        </p>
        <div className="flex items-center gap-2 mt-3">
          {FIELD_CONFIGS.map((config, index) => {
            const fieldState = form[config.key as keyof ProductIntakeForm] as AnswerState<string>
            const done = fieldState.status !== "unanswered"
            return (
              <button
                key={index}
                className={`h-1.5 flex-1 rounded-full transition-colors cursor-pointer hover:opacity-80 ${done ? "bg-blue-500" : "bg-gray-200"}`}
                onClick={() => {
                  const element = fieldRefs.current[config.key]
                  if (element) element.scrollIntoView({ behavior: "smooth", block: "center" })
                }}
                title={getIntakeFieldLabel(config.key as keyof ProductIntakeForm, language)}
              />
            )
          })}
          <span className="text-xs text-gray-500 whitespace-nowrap">{answered}/6</span>
        </div>
      </div>
      <div ref={scrollContainerRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
        {FIELD_CONFIGS.map((config, index) => {
          const highlight = purposeIsSubstitute && config.key === "toolTypeOrCurrentProduct"
          return (
            <div key={config.key} ref={element => { fieldRefs.current[config.key] = element }} className="rounded-xl transition-all duration-300">
              {highlight && (
                <div className="flex items-center gap-1.5 mb-2 px-2">
                  <Info size={11} className="text-blue-500" />
                  <span className="text-xs text-blue-600 font-medium">
                    {localizeIntakeText("대체품 찾기 → 현재 사용 중인 EDP/품번을 입력하면 더 정확합니다", language)}
                  </span>
                </div>
              )}
              <IntakeFieldSection
                config={config}
                index={index}
                state={form[config.key as keyof ProductIntakeForm] as AnswerState<string>}
                onChange={value => handleFieldChange(config.key as keyof ProductIntakeForm, value)}
              />
            </div>
          )
        })}
        <div className="h-4" />
      </div>
      <div className="shrink-0 px-4 py-3 bg-white border-t shadow-md">
        <div className="flex items-center justify-between max-w-lg mx-auto">
          <span className="text-sm text-gray-600">
            {allDone
              ? <span className="text-green-700 font-medium flex items-center gap-1"><CheckCircle2 size={14} />{language === "ko" ? "모두 완료되었습니다" : "All fields complete"}</span>
              : <span>{answered}/6 {language === "ko" ? `항목 완료 · ${6 - answered}개 남음` : `complete · ${6 - answered} remaining`}</span>}
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
    <div className="flex flex-col h-full">
      <div className="shrink-0 px-4 pt-5 pb-4 border-b bg-white">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-base font-bold text-gray-900">{language === "ko" ? "입력 조건 요약" : "Condition Summary"}</h2>
            <p className="text-xs text-gray-500 mt-0.5">
              {language === "ko" ? "아래 조건으로 탐색합니다. 모르는 정보는 추정하지 않습니다." : "Will search with these conditions. Unknown fields are not guessed."}
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={onEdit} className="gap-1 text-xs">
            <Edit2 size={12} />
            {language === "ko" ? "수정" : "Edit"}
          </Button>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-2">
        {FIELD_CONFIGS.map(config => {
          const state = form[config.key as keyof ProductIntakeForm] as AnswerState<string>
          const isUnknown = state.status === "unknown"
          const displayValue = getIntakeDisplayValue(config.key as keyof ProductIntakeForm, state, language)
          return (
            <div
              key={config.key}
              className={`flex items-center gap-3 px-4 py-3 rounded-xl border ${isUnknown ? "bg-gray-50 border-gray-200" : "bg-white border-gray-200"}`}
            >
              <div className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 ${isUnknown ? "bg-gray-200" : "bg-green-100"}`}>
                {isUnknown ? <HelpCircle size={14} className="text-gray-400" /> : <Check size={14} className="text-green-600" />}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-xs text-gray-500">{config.emoji} {getIntakeFieldLabel(config.key as keyof ProductIntakeForm, language)}</div>
                <div className={`text-sm font-medium mt-0.5 ${isUnknown ? "text-gray-400 italic" : "text-gray-900"}`}>
                  {displayValue}
                </div>
              </div>
              <button onClick={onEdit} className="text-xs text-blue-500 hover:text-blue-700 shrink-0">
                {language === "ko" ? "수정" : "Edit"}
              </button>
            </div>
          )
        })}
        {unknownCount > 0 && (
          <div className="flex items-start gap-2 px-4 py-3 bg-amber-50 border border-amber-200 rounded-xl">
            <AlertTriangle size={14} className="text-amber-600 mt-0.5 shrink-0" />
            <div className="text-xs text-amber-800 leading-relaxed">
              {language === "ko" ? (
                <>
                  <strong>{unknownCount}개 항목이 &quot;모름&quot;</strong>으로 설정되어 있습니다.
                  {unknownCount >= 3
                    ? " 많은 조건이 없어 정확 추천 대신 근사 후보로 제공됩니다."
                    : " 해당 조건은 필터에서 제외되고, 알려진 조건 기준으로만 추천됩니다."}
                </>
              ) : (
                <>
                  <strong>{unknownCount} field(s) set to &quot;Unknown&quot;</strong>.
                  {unknownCount >= 3
                    ? " Many conditions unknown — approximate candidates will be provided instead of exact matches."
                    : " Unknown fields will be excluded from filters; recommendation based on known conditions only."}
                </>
              )}
            </div>
          </div>
        )}
        {unknownCount === 0 && (
          <div className="flex items-center gap-2 px-4 py-3 bg-green-50 border border-green-200 rounded-xl">
            <CheckCircle2 size={14} className="text-green-600" />
            <span className="text-xs text-green-800">
              {language === "ko" ? "모든 조건이 입력되었습니다. 정확한 추천이 가능합니다." : "All conditions entered. Exact recommendations are possible."}
            </span>
          </div>
        )}
        <div className="h-4" />
      </div>
      <div className="shrink-0 px-4 py-3 bg-white border-t shadow-md space-y-2">
        <div className="max-w-lg mx-auto">
          <Button onClick={onStart} className="w-full gap-2">
            {language === "ko" ? "이 조건으로 추천 시작" : "Start Recommendation"} <ArrowRight size={14} />
          </Button>
          <Button variant="ghost" onClick={onEdit} className="w-full mt-1 text-xs text-gray-500 gap-1">
            <Edit2 size={11} />
            {language === "ko" ? "추가 조건 수정하기" : "Edit Conditions"}
          </Button>
        </div>
      </div>
    </div>
  )
}

export function LoadingScreen() {
  const { language } = useApp()
  return (
    <div className="flex-1 flex flex-col items-center justify-center px-4 py-16 text-center">
      <div className="flex gap-1.5 mb-4">
        {[0, 1, 2].map(index => (
          <div key={index} className="w-2 h-2 bg-blue-500 rounded-full animate-bounce" style={{ animationDelay: `${index * 0.15}s` }} />
        ))}
      </div>
      <div className="text-sm font-medium text-gray-700">{language === "ko" ? "실제 데이터에서 제품 검색 중..." : "Searching products from real data..."}</div>
      <div className="text-xs text-gray-400 mt-1">{language === "ko" ? "없는 제품은 생성하지 않습니다" : "Only real products — no hallucination"}</div>
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
      ? "\n위 조건으로 적합한 YG-1 제품을 추천해주세요."
      : "\nPlease recommend suitable YG-1 products based on the conditions above."
  )
  return parts.join("\n")
}
