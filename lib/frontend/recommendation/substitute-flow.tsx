"use client"

import { useState } from "react"
import { ArrowRight, Search, RefreshCw, CheckCircle2, AlertTriangle } from "lucide-react"
import { Button } from "@/components/ui/button"
import type { ProductIntakeForm } from "@/lib/types/intake"
import { resolveCompetitorSpec, type CompetitorSpec } from "./competitor-spec-resolver"

const ISO_OPTIONS = [
  { value: "P", label: "탄소강" },
  { value: "M", label: "스테인리스" },
  { value: "K", label: "주철" },
  { value: "N", label: "비철금속" },
  { value: "S", label: "초내열합금" },
  { value: "H", label: "고경도강" },
]

const SHAPE_OPTIONS = [
  { value: "Side_Milling", label: "Side Milling" },
  { value: "Slotting", label: "Slotting" },
  { value: "Profiling", label: "Profiling" },
  { value: "Trochoidal", label: "Trochoidal" },
  { value: "Facing", label: "Facing" },
  { value: "Die-Sinking", label: "Die-Sinking" },
  { value: "Corner_Radius", label: "Corner Radius" },
  { value: "Helical_Interpolation", label: "Helical Interpolation" },
]

const DIAMETER_PRESETS = ["1mm","2mm","3mm","4mm","5mm","6mm","8mm","10mm","12mm","16mm","20mm","25mm"]

interface SubstituteSpec {
  diameterMm: number | null
  isoMaterial: string[]
  flutes: number | null
  toolSubtype: string | null
  coating: string | null
  confidence: "high" | "medium" | "low"
  source: string
}

interface SubstituteFlowProps {
  onStart: (form: ProductIntakeForm) => void
  language: "ko" | "en"
}

export function SubstituteFlow({ onStart, language }: SubstituteFlowProps) {
  const [step, setStep] = useState<"input" | "confirm">("input")
  const [modelName, setModelName] = useState("")
  const [isSearching, setIsSearching] = useState(false)
  const [searchError, setSearchError] = useState<string | null>(null)
  const [spec, setSpec] = useState<SubstituteSpec | null>(null)

  const [selectedMaterials, setSelectedMaterials] = useState<string[]>([])
  const [selectedDiameter, setSelectedDiameter] = useState<string>("")
  const [customDiameter, setCustomDiameter] = useState("")
  const [selectedShape, setSelectedShape] = useState<string>("")

  const handleSearch = async () => {
    if (!modelName.trim()) return
    setIsSearching(true)
    setSearchError(null)
    try {
      const result = await resolveCompetitorSpec(modelName.trim())
      if (result.success && result.spec) {
        const s = result.spec
        setSpec({
          diameterMm: s.diameterMm,
          isoMaterial: s.isoMaterial ?? [],
          flutes: s.flutes,
          toolSubtype: s.toolSubtype,
          coating: s.coating,
          confidence: s.confidence,
          source: s.source ?? "",
        })
        setSelectedMaterials(s.isoMaterial ?? [])
        if (typeof s.diameterMm === "number" && s.diameterMm > 0) {
          const preset = `${s.diameterMm}mm`
          if (DIAMETER_PRESETS.includes(preset)) {
            setSelectedDiameter(preset)
          } else {
            setSelectedDiameter("custom")
            setCustomDiameter(preset)
          }
        }
        setStep("confirm")
      } else {
        setSpec(null)
        setSearchError("스펙을 자동으로 찾지 못했습니다. 직접 입력해주세요.")
        setStep("confirm")
      }
    } catch {
      setSearchError("검색 중 오류가 발생했습니다.")
      setStep("confirm")
    } finally {
      setIsSearching(false)
    }
  }

  const canStart =
    selectedMaterials.length > 0 &&
    (selectedDiameter !== "" || customDiameter !== "") &&
    selectedShape !== ""

  const handleStart = () => {
    const diameter = selectedDiameter === "custom" ? customDiameter : selectedDiameter

    const form: ProductIntakeForm = {
      inquiryPurpose: { status: "known", value: "substitute" },
      material: { status: "known", value: selectedMaterials.join(",") },
      operationType: { status: "known", value: selectedShape },
      machiningIntent: { status: "unanswered" },
      toolTypeOrCurrentProduct: { status: "known", value: modelName.trim() },
      diameterInfo: diameter ? { status: "known", value: diameter } : { status: "unknown" },
      country: { status: "known", value: "ALL" },
    }
    onStart(form)
  }

  // ── Step A: 모델명 입력 ──
  if (step === "input") {
    return (
      <div className="flex h-full flex-col">
        <div className="shrink-0 border-b bg-white px-4 pb-4 pt-5">
          <h2 className="text-base font-bold text-gray-900">경쟁사 공구 대체품 찾기</h2>
          <p className="mt-0.5 text-xs text-gray-500">
            현재 사용 중인 경쟁사 공구 모델명을 입력하면 YG-1 대체 공구를 추천합니다.
          </p>
        </div>
        <div className="flex flex-1 flex-col items-center justify-center gap-6 px-6 py-10">
          <div className="w-full max-w-lg space-y-3">
            <label className="text-sm font-semibold text-gray-800">
              🔄 경쟁사 공구 모델명
            </label>
            <div className="flex gap-2">
              <input
                className="flex-1 rounded-xl border-2 border-gray-200 px-4 py-3 text-sm
                           placeholder:text-gray-400 focus:border-blue-400 focus:outline-none"
                placeholder="예: GUHRING 3736, SANDVIK R216, SGS 47698, Kennametal B2C..."
                value={modelName}
                onChange={e => setModelName(e.target.value)}
                onKeyDown={e => e.key === "Enter" && handleSearch()}
                autoFocus
              />
              <Button
                onClick={handleSearch}
                disabled={!modelName.trim() || isSearching}
                className="gap-1.5 px-5"
              >
                {isSearching ? (
                  <>
                    <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                    검색 중...
                  </>
                ) : (
                  <>
                    <Search className="h-3.5 w-3.5" />
                    스펙 검색
                  </>
                )}
              </Button>
            </div>
            <p className="text-[11px] text-gray-400">
              모델명 입력 후 검색하면 직경·소재·날수를 자동으로 찾아드립니다.
              찾지 못해도 직접 입력하여 진행할 수 있습니다.
            </p>
          </div>

          <div className="w-full max-w-lg">
            <p className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-gray-400">
              지원 경쟁사 예시
            </p>
            <div className="flex flex-wrap gap-1.5">
              {["GUHRING", "SANDVIK", "SGS", "Kennametal", "ISCAR", "SECO", "Walter", "OSG", "Mitsubishi"].map(b => (
                <span key={b} className="rounded-full border border-gray-200 bg-gray-50 px-2.5 py-1 text-[10px] text-gray-500">
                  {b}
                </span>
              ))}
            </div>
          </div>
        </div>
      </div>
    )
  }

  // ── Step B: 스펙 확인/수정 ──
  return (
    <div className="flex h-full flex-col">
      <div className="shrink-0 border-b bg-white px-4 pb-4 pt-5">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-base font-bold text-gray-900">스펙 확인 및 수정</h2>
            <p className="mt-0.5 text-xs text-gray-500">
              <strong className="text-gray-700">{modelName}</strong> 기준 스펙을 확인하고 추천을 시작하세요.
            </p>
          </div>
          <button
            onClick={() => { setStep("input"); setSpec(null); setSelectedShape("") }}
            className="text-xs text-blue-500 hover:text-blue-700"
          >
            ← 다시 검색
          </button>
        </div>
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto px-4 py-4">
        {spec && (
          <div className={`flex items-center gap-2 rounded-xl px-3 py-2.5 text-xs ${
            spec.confidence === "high"
              ? "bg-green-50 text-green-700 border border-green-200"
              : spec.confidence === "medium"
              ? "bg-amber-50 text-amber-700 border border-amber-200"
              : "bg-gray-50 text-gray-600 border border-gray-200"
          }`}>
            {spec.confidence === "high"
              ? <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
              : <AlertTriangle className="h-3.5 w-3.5 shrink-0" />}
            {spec.confidence === "high"
              ? "공식 카탈로그에서 스펙 확인 완료 — 자동 입력된 값을 검토 후 가공 형상만 선택하세요."
              : spec.confidence === "medium"
              ? "스펙을 부분적으로 확인했습니다. 아래 값을 반드시 검토하고 수정하세요."
              : "스펙을 찾지 못했습니다. 아래 항목을 직접 입력해주세요."}
          </div>
        )}
        {searchError && !spec && (
          <div className="flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs text-amber-700">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
            {searchError}
          </div>
        )}

        {/* ① 소재 선택 */}
        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <div className="mb-3 flex items-center gap-2">
            <span className="text-sm">🧱</span>
            <span className="text-sm font-semibold text-gray-900">가공 소재</span>
            {selectedMaterials.length > 0 && (
              <span className="rounded-full bg-green-100 px-2 py-0.5 text-[10px] text-green-700">
                {selectedMaterials.length}개 선택됨
              </span>
            )}
            <span className="ml-auto text-[10px] text-gray-400">복수 선택 가능</span>
          </div>
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
            {ISO_OPTIONS.map(opt => {
              const isSelected = selectedMaterials.includes(opt.value)
              return (
                <button
                  key={opt.value}
                  onClick={() => {
                    setSelectedMaterials(prev =>
                      prev.includes(opt.value)
                        ? prev.filter(v => v !== opt.value)
                        : [...prev, opt.value]
                    )
                  }}
                  className={`rounded-xl border-2 px-2 py-3 text-center transition-all ${
                    isSelected
                      ? "border-blue-500 bg-blue-50"
                      : "border-gray-200 bg-gray-50 hover:border-gray-300"
                  }`}
                >
                  <div className={`text-lg font-bold ${isSelected ? "text-blue-700" : "text-gray-500"}`}>
                    {opt.value}
                  </div>
                  <div className={`text-[9px] ${isSelected ? "text-blue-600" : "text-gray-400"}`}>
                    {opt.label}
                  </div>
                </button>
              )
            })}
          </div>
        </div>

        {/* ② 직경 선택 */}
        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <div className="mb-3 flex items-center gap-2">
            <span className="text-sm">📏</span>
            <span className="text-sm font-semibold text-gray-900">공구 직경</span>
            {selectedDiameter && (
              <span className="rounded-full bg-green-100 px-2 py-0.5 text-[10px] text-green-700">
                선택됨
              </span>
            )}
          </div>
          <div className="flex flex-wrap gap-2 mb-2">
            {DIAMETER_PRESETS.map(d => (
              <button
                key={d}
                onClick={() => { setSelectedDiameter(d); setCustomDiameter("") }}
                className={`rounded-lg border-2 px-3 py-1.5 text-xs font-medium transition-all ${
                  selectedDiameter === d
                    ? "border-blue-500 bg-blue-50 text-blue-700"
                    : "border-gray-200 text-gray-600 hover:border-gray-300"
                }`}
              >
                {d}
              </button>
            ))}
          </div>
          <div className="flex gap-2 mt-2">
            <input
              className={`flex-1 rounded-lg border-2 px-3 py-1.5 text-xs placeholder:text-gray-400 focus:outline-none ${
                selectedDiameter === "custom" ? "border-blue-400" : "border-gray-200"
              }`}
              placeholder="직접 입력 (예: 7mm, 3.5mm)"
              value={customDiameter}
              onChange={e => {
                setCustomDiameter(e.target.value)
                setSelectedDiameter(e.target.value ? "custom" : "")
              }}
            />
          </div>
        </div>

        {/* ③ 가공 형상 선택 */}
        <div className="rounded-xl border-2 border-dashed border-blue-200 bg-blue-50/50 p-4">
          <div className="mb-3 flex items-center gap-2">
            <span className="text-sm">📐</span>
            <span className="text-sm font-semibold text-gray-900">가공 형상</span>
            <span className="rounded-full bg-blue-100 px-2 py-0.5 text-[10px] text-blue-700">
              직접 선택 필요
            </span>
          </div>
          <p className="mb-3 text-[11px] text-blue-600">
            어떤 가공에 사용하실 예정인가요?
          </p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {SHAPE_OPTIONS.map(opt => (
              <button
                key={opt.value}
                onClick={() => setSelectedShape(opt.value)}
                className={`rounded-xl border-2 px-3 py-2.5 text-xs font-medium transition-all ${
                  selectedShape === opt.value
                    ? "border-blue-500 bg-blue-500 text-white"
                    : "border-gray-200 bg-white text-gray-600 hover:border-blue-300"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        {/* 추가 정보 */}
        {spec && (spec.flutes || spec.coating || spec.toolSubtype) && (
          <div className="rounded-xl border border-gray-200 bg-gray-50 p-3">
            <p className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-gray-400">
              검색된 추가 정보 (참고용)
            </p>
            <div className="flex flex-wrap gap-2 text-xs text-gray-600">
              {spec.flutes && <span className="rounded-full bg-white border border-gray-200 px-2.5 py-1">날수: {spec.flutes}날</span>}
              {spec.toolSubtype && <span className="rounded-full bg-white border border-gray-200 px-2.5 py-1">형상: {spec.toolSubtype}</span>}
              {spec.coating && <span className="rounded-full bg-white border border-gray-200 px-2.5 py-1">코팅: {spec.coating}</span>}
            </div>
          </div>
        )}

        <div className="h-4" />
      </div>

      {/* 하단 버튼 */}
      <div className="shrink-0 border-t bg-white px-4 py-3 shadow-md">
        <div className="mx-auto max-w-lg">
          {!canStart && (
            <p className="mb-2 text-center text-xs text-amber-600">
              {selectedMaterials.length === 0 ? "소재를 선택해주세요" : ""}
              {selectedMaterials.length === 0 && (!selectedDiameter && !customDiameter) ? " · " : ""}
              {!selectedDiameter && !customDiameter ? "직경을 선택해주세요" : ""}
              {(!selectedDiameter && !customDiameter) && !selectedShape ? " · " : ""}
              {(selectedDiameter || customDiameter) && selectedMaterials.length > 0 && !selectedShape ? "" : ""}
              {!selectedShape ? "가공 형상을 선택해주세요" : ""}
            </p>
          )}
          <Button
            onClick={handleStart}
            disabled={!canStart}
            className="w-full gap-2"
          >
            {modelName} 대체품 찾기
            <ArrowRight className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  )
}
