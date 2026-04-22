// SPDX-License-Identifier: MIT
// YG-1 ARIA Simulator v3 — STEP 5-1 Tool Path Info Modal
// 8종 Tool Path 그래픽 + 한글 설명 + 권장 ADOC/RDOC + Strategy 옵션 + 교육 모드 확장설명
"use client"

import { useMemo } from "react"
import { Check, Info, ChevronRight, CornerDownRight } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog"
import { ToolPathDiagram } from "./tool-path-diagrams"
import { TOOL_PATHS, STRATEGY_OPTIONS } from "./presets"
import { useEducation } from "./education-context"

interface Props {
  open: boolean
  onClose: () => void
  currentPath?: string
  onSelectPath?: (path: string) => void
}

interface PathDetail {
  key: string
  label: string
  hint: string
  korean: string                // 한글 설명 (1~2줄)
  apRec: string                 // 권장 ADOC (ap)
  aeRec: string                 // 권장 RDOC (ae)
  fzRec?: string                // 권장 fz 레인지
  materials: string[]           // 적합 ISO 재질 키 (P/M/K/N/S/H)
  eduDetail: string             // 교육 모드 확장 설명 (왜 좋은가, 50~100자)
  accentClass: string           // 카드 강조 색 클래스
}

// ── 8종 Tool Path 상세 정보 (MAP 수준) ─────────────────────────────────
const PATH_DETAILS: Record<string, PathDetail> = {
  conventional: {
    key: "conventional",
    label: "Conventional",
    hint: "표준 측면/슬롯",
    korean: "가장 기본이 되는 측면·슬롯 경로. 대부분의 표준 가공에 사용되며 예측 가능한 절삭 부하를 제공합니다.",
    apRec: "0.5 ~ 1.0 · D",
    aeRec: "0.2 ~ 0.5 · D",
    fzRec: "Catalog 표준값",
    materials: ["P", "M", "K", "N", "S", "H"],
    eduDetail:
      "Climb milling을 권장. ae=0.2D·ap=D 조합이 안정적이고 공구 수명과 표면 품질의 균형이 좋습니다.",
    accentClass: "border-blue-300 bg-blue-50/50",
  },
  hem: {
    key: "hem",
    label: "HEM (High Efficiency Milling)",
    hint: "낮은 ae, 깊은 ap, 고속이송",
    korean: "얕은 ae와 깊은 ap를 결합해 공구 전장을 활용하며 MRR을 극대화. 열 분산이 유리하고 공구 수명이 길어집니다.",
    apRec: "1.0 ~ 2.0 · D (Full LOC 가능)",
    aeRec: "0.05 ~ 0.15 · D",
    fzRec: "Chip thinning 보정 후 1.5~2× 표준 fz",
    materials: ["P", "M", "S", "H"],
    eduDetail:
      "낮은 ae로 칩 두께가 얇아 chip thinning 보정이 필요. 긴 LOC 활용으로 마모가 균등해져 수명이 2~3배까지 증가합니다.",
    accentClass: "border-emerald-300 bg-emerald-50/50",
  },
  trochoidal: {
    key: "trochoidal",
    label: "Trochoidal (트로코이달)",
    hint: "슬롯/포켓, chip thinning 큼",
    korean: "원형 궤적을 반복해 슬롯·포켓을 가공. 공구 engagement가 짧아 열 충격이 적고 딥 포켓에 적합합니다.",
    apRec: "2.0 · D 이상 (Deep slot)",
    aeRec: "0.05 ~ 0.1 · D",
    fzRec: "매우 공격적 (Chip thinning 2~3×)",
    materials: ["M", "S", "H"],
    eduDetail:
      "Inconel·Ti 등 열관리가 어려운 재질의 딥 슬롯에 최적. 짧은 engagement로 공구 부분만 접촉 → 냉각 시간 확보.",
    accentClass: "border-purple-300 bg-purple-50/50",
  },
  adaptive: {
    key: "adaptive",
    label: "Adaptive Clearing",
    hint: "일정한 공구부하 유지",
    korean: "CAM이 공구 engagement를 일정하게 유지하도록 경로를 재계산. 포켓·공동(cavity) 거친가공에 적합.",
    apRec: "1.5 ~ 2.0 · D",
    aeRec: "0.1 ~ 0.2 · D",
    fzRec: "표준 fz × 1.2~1.5",
    materials: ["P", "M", "K", "S"],
    eduDetail:
      "load control로 급격한 부하 변동을 막아 갑작스러운 공구 파손을 방지. 복잡한 포켓 지오메트리에서도 안정적.",
    accentClass: "border-orange-300 bg-orange-50/50",
  },
  dynamic: {
    key: "dynamic",
    label: "Dynamic Milling (MasterCam)",
    hint: "MasterCam식 적응가공",
    korean: "MasterCam Dynamic·Fusion Adaptive 계열. 칩 두께 제어와 비접촉 급속이송을 결합한 최신 전략.",
    apRec: "2.0 · D (Full LOC)",
    aeRec: "0.1 · D",
    fzRec: "공격적 fz (Chip thinning 완전 보정)",
    materials: ["P", "M", "K", "S", "H"],
    eduDetail:
      "CAM이 재료 남은 부분을 추적해 경로를 최적화. HEM과 유사하나 더 공격적 — 최신 CAM+머신에서 완전한 효과 발휘.",
    accentClass: "border-pink-300 bg-pink-50/50",
  },
  plunge: {
    key: "plunge",
    label: "Plunge (플런징)",
    hint: "축방향 드릴식 가공",
    korean: "공구를 수직으로 하강시켜 드릴처럼 재료를 제거. 깊은 포켓의 초벌, 롱 stickout 조건에 사용.",
    apRec: "ap = LOC (깊이 방향)",
    aeRec: "0.75 · D 이하 (중복량)",
    fzRec: "0.5 × 표준 fz (축방향 부하 큼)",
    materials: ["P", "M", "K"],
    eduDetail:
      "Long stickout·얕은 stiffness에서 반경방향 편향을 피하기 위해 선택. 센터컷팅 가능 공구 필수 (엔드밀은 확인).",
    accentClass: "border-red-300 bg-red-50/50",
  },
  ramping: {
    key: "ramping",
    label: "Ramping (경사 진입)",
    hint: "3~5° 각도로 진입",
    korean: "선형 경사로 재료에 진입. 센터컷 불가 공구나 픽(plunge) 대신 부드럽게 진입할 때 사용.",
    apRec: "단계별 진입 (per pass)",
    aeRec: "0.2 ~ 0.5 · D",
    fzRec: "표준 fz × 0.7",
    materials: ["P", "M", "K", "N"],
    eduDetail:
      "권장 경사각 3~5° (재질에 따라 1~7°). 각도가 크면 축방향 부하 급증 — 급기울기 진입은 공구 파손 위험.",
    accentClass: "border-teal-300 bg-teal-50/50",
  },
  helical: {
    key: "helical",
    label: "Helical Interpolation",
    hint: "나선 보간 홀가공",
    korean: "나선 궤적으로 하강하며 원형 포켓·보어를 가공. 드릴 없이 임의 지름의 홀을 만들 수 있는 표준 전략.",
    apRec: "Step-down 0.05 ~ 0.3 · D per rev",
    aeRec: "N/A (나선 지름 제어)",
    fzRec: "표준 fz × 0.8",
    materials: ["P", "M", "K", "N", "S", "H"],
    eduDetail:
      "홀 지름 = 나선 지름 + D. 한 공구로 여러 지름 홀 가공 가능. Z 이송이 과대하면 칩 배출 문제 발생.",
    accentClass: "border-indigo-300 bg-indigo-50/50",
  },
}

const ISO_LABELS_KR: Record<string, string> = {
  P: "P · 강",
  M: "M · 스테인리스",
  K: "K · 주철",
  N: "N · 비철",
  S: "S · 내열합금",
  H: "H · 경화강",
}

// ── 개별 Path 카드 ───────────────────────────────────────────────────
function ToolPathCard({
  detail,
  isActive,
  educationMode,
  onSelect,
}: {
  detail: PathDetail
  isActive: boolean
  educationMode: boolean
  onSelect?: (key: string) => void
}) {
  const strategies = STRATEGY_OPTIONS[detail.key] ?? []

  return (
    <div
      className={`rounded-lg border p-3 transition-all ${
        isActive
          ? "ring-2 ring-blue-500 shadow-md " + detail.accentClass
          : "border-gray-200 bg-white hover:shadow-sm dark:bg-gray-900 dark:border-gray-700"
      }`}
    >
      <div className="flex items-start gap-3">
        <div className="flex-shrink-0 w-20 h-20 rounded-md bg-white border border-gray-200 dark:bg-gray-800 dark:border-gray-700 flex items-center justify-center">
          <ToolPathDiagram pathKey={detail.key} className="w-16 h-16 text-gray-700 dark:text-gray-200" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h4 className="font-bold text-sm text-gray-900 dark:text-gray-100">{detail.label}</h4>
            {isActive && (
              <span className="inline-flex items-center gap-0.5 rounded-full bg-blue-600 text-white text-[9px] px-1.5 py-0.5 font-semibold">
                <Check className="h-2.5 w-2.5" /> 현재
              </span>
            )}
          </div>
          <p className="text-[11px] text-gray-600 dark:text-gray-300 mt-0.5 leading-snug">
            {detail.korean}
          </p>
        </div>
      </div>

      {/* 권장 ADOC/RDOC */}
      <div className="mt-2 grid grid-cols-2 gap-1.5 text-[10px]">
        <div className="rounded bg-gray-50 dark:bg-gray-800 px-2 py-1">
          <span className="text-gray-500 dark:text-gray-400">권장 ADOC (ap)</span>
          <div className="font-mono font-semibold text-gray-900 dark:text-gray-100">{detail.apRec}</div>
        </div>
        <div className="rounded bg-gray-50 dark:bg-gray-800 px-2 py-1">
          <span className="text-gray-500 dark:text-gray-400">권장 RDOC (ae)</span>
          <div className="font-mono font-semibold text-gray-900 dark:text-gray-100">{detail.aeRec}</div>
        </div>
        {detail.fzRec && (
          <div className="col-span-2 rounded bg-gray-50 dark:bg-gray-800 px-2 py-1">
            <span className="text-gray-500 dark:text-gray-400">권장 fz</span>
            <div className="font-mono text-[10px] text-gray-800 dark:text-gray-200">{detail.fzRec}</div>
          </div>
        )}
      </div>

      {/* 적합 재질 */}
      <div className="mt-2 flex flex-wrap gap-1 items-center">
        <span className="text-[10px] text-gray-500 dark:text-gray-400">적합 재질:</span>
        {detail.materials.map((m) => (
          <span
            key={m}
            className="inline-flex items-center rounded-full border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-1.5 py-0.5 text-[9px] font-mono text-gray-700 dark:text-gray-200"
          >
            {ISO_LABELS_KR[m] ?? m}
          </span>
        ))}
      </div>

      {/* Strategy 옵션 */}
      {strategies.length > 0 && (
        <div className="mt-2 rounded border border-dashed border-gray-300 dark:border-gray-600 px-2 py-1.5">
          <div className="text-[10px] text-gray-500 dark:text-gray-400 font-semibold mb-0.5">
            <CornerDownRight className="inline h-2.5 w-2.5 mr-0.5" />
            세부 Strategy
          </div>
          <ul className="space-y-0.5">
            {strategies.map((s) => (
              <li key={s.value} className="text-[10px] text-gray-700 dark:text-gray-200 flex items-center gap-1">
                <ChevronRight className="h-2.5 w-2.5 text-gray-400" />
                {s.label}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* 교육 모드 확장 */}
      {educationMode && (
        <div className="mt-2 rounded bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 px-2 py-1.5">
          <div className="text-[10px] font-semibold text-amber-800 dark:text-amber-200 flex items-center gap-1">
            <Info className="h-2.5 w-2.5" />왜 이 경로가 이 재질에 좋은가?
          </div>
          <p className="text-[10px] text-amber-900 dark:text-amber-100 leading-relaxed mt-0.5">
            {detail.eduDetail}
          </p>
        </div>
      )}

      {/* 선택 버튼 */}
      {onSelect && (
        <button
          type="button"
          onClick={() => onSelect(detail.key)}
          disabled={isActive}
          className={`mt-2 w-full rounded-md px-2 py-1 text-[11px] font-semibold transition-colors ${
            isActive
              ? "bg-gray-200 text-gray-500 dark:bg-gray-700 dark:text-gray-400 cursor-default"
              : "bg-blue-600 text-white hover:bg-blue-700"
          }`}
        >
          {isActive ? "현재 선택됨" : "이 경로 사용"}
        </button>
      )}
    </div>
  )
}

// ── 메인 모달 ────────────────────────────────────────────────────────
export function ToolPathInfoModal({ open, onClose, currentPath, onSelectPath }: Props) {
  const edu = useEducation()

  const details = useMemo<PathDetail[]>(
    () =>
      TOOL_PATHS.map((tp) => PATH_DETAILS[tp.key] ?? {
        key: tp.key,
        label: tp.label,
        hint: tp.hint,
        korean: tp.hint,
        apRec: "표준",
        aeRec: "표준",
        materials: ["P"],
        eduDetail: tp.hint,
        accentClass: "border-gray-300 bg-gray-50",
      }),
    []
  )

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose() }}>
      <DialogContent className="max-w-4xl sm:max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Info className="h-5 w-5 text-blue-600" />
            Tool Path 정보 — 8종 가공 경로 비교
          </DialogTitle>
          <DialogDescription>
            각 가공 경로의 그래픽, 권장 ADOC/RDOC, 적합 재질, 세부 Strategy 옵션을 한눈에 확인하세요.
            {edu.enabled && (
              <span className="ml-1 text-amber-700 dark:text-amber-400 font-semibold">
                · 교육 모드 ON — "왜 좋은가" 해설 표시 중
              </span>
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-2">
          {details.map((d) => (
            <ToolPathCard
              key={d.key}
              detail={d}
              isActive={d.key === currentPath}
              educationMode={edu.enabled}
              onSelect={
                onSelectPath
                  ? (k) => {
                      onSelectPath(k)
                      onClose()
                    }
                  : undefined
              }
            />
          ))}
        </div>

        <div className="mt-3 text-[10px] text-gray-500 dark:text-gray-400 border-t border-gray-100 dark:border-gray-800 pt-2">
          출처: Harvey Tool MAP, Helical Solutions, Sandvik Coromant Application Guide. 권장값은 1/4~1/2 인치 엔드밀 기준
          일반 지침이며, 실제 조건(재질·경도·머신 강성)에 따라 조정이 필요합니다.
        </div>
      </DialogContent>
    </Dialog>
  )
}

export default ToolPathInfoModal
