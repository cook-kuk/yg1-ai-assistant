// Machine Impact Lab — top-level container. Holds the machine-config
// state, drives `computeImpact()` (plus a BASELINE reference for
// delta badges), and lays out the banner / KPIs / limits / flow /
// config / compare panels.
//
// The lab owns no tool/material/operation state — those are **locked**
// by design. Callers pass them as props (optional — sensible defaults
// mean the lab can be demoed standalone from a dead URL).
"use client"

import { memo, useMemo, useState } from "react"
import { Link2 } from "lucide-react"
import { toast } from "sonner"
import { copyText } from "../clipboard-util"
import {
  DEFAULT_LOCKED_MATERIAL,
  DEFAULT_LOCKED_OPERATION,
  DEFAULT_LOCKED_TOOL,
  IMPACT_PRESETS,
  computeImpact,
  type ComputeInput,
} from "./impact-calc-engine"
import { CalculationFlowPanel } from "./calculation-flow-panel"
import { LimitCheckPanel } from "./limit-check-panel"
import { LiveKpiStrip } from "./live-kpi-strip"
import { LockedToolBanner } from "./locked-tool-banner"
import { MachineConfigPanel, type MachineConfigState } from "./machine-config-panel"
import { ScenarioCompareTable } from "./scenario-compare-table"

interface Props {
  /** Locked tool context. Falls back to the Harvey 942332 demo tool. */
  tool?: typeof DEFAULT_LOCKED_TOOL
  material?: typeof DEFAULT_LOCKED_MATERIAL
  operation?: typeof DEFAULT_LOCKED_OPERATION
  /** Starting machine config. Defaults to BASELINE (ideal combination). */
  initialConfig?: MachineConfigState
  /** Preset key (e.g. "disaster", "premium") — wins over initialConfig when
   * supplied. Used by the ?lab=<key> deep-link on /simulator_v2. Unknown
   * keys silently fall back to BASELINE. */
  initialPresetKey?: string
}

const BASELINE_CONFIG: MachineConfigState = {
  ...IMPACT_PRESETS.baseline.config,
}

function resolveInitialConfig(
  initialConfig: MachineConfigState | undefined,
  initialPresetKey: string | undefined,
): MachineConfigState {
  if (initialPresetKey && initialPresetKey in IMPACT_PRESETS) {
    return { ...IMPACT_PRESETS[initialPresetKey].config }
  }
  return initialConfig ?? BASELINE_CONFIG
}

/** Return the preset key that matches `config` exactly, or null if custom. */
function matchPresetKey(config: MachineConfigState): string | null {
  for (const [key, preset] of Object.entries(IMPACT_PRESETS)) {
    const c = preset.config
    if (
      c.spindleKey === config.spindleKey &&
      c.holderKey === config.holderKey &&
      c.coolantKey === config.coolantKey &&
      c.stickoutInch === config.stickoutInch &&
      c.workholdingPct === config.workholdingPct
    ) {
      return key
    }
  }
  return null
}

function buildShareUrl(config: MachineConfigState): string {
  if (typeof window === "undefined") return ""
  const origin = window.location.origin
  const pathname = window.location.pathname
  const presetKey = matchPresetKey(config)
  const params = new URLSearchParams()
  if (presetKey) {
    params.set("lab", presetKey)
  } else {
    // Custom config — encode all 5 knobs. Lab will hydrate via `initialConfig`
    // if the page passes them along (future enhancement).
    params.set("lab", "custom")
    params.set("spindle", config.spindleKey)
    params.set("holder", config.holderKey)
    params.set("coolant", config.coolantKey)
    params.set("stickout", config.stickoutInch.toFixed(2))
    params.set("wh", String(Math.round(config.workholdingPct)))
  }
  return `${origin}${pathname}?${params.toString()}`
}

export const MachineImpactLab = memo(function MachineImpactLab({
  tool = DEFAULT_LOCKED_TOOL,
  material = DEFAULT_LOCKED_MATERIAL,
  operation = DEFAULT_LOCKED_OPERATION,
  initialConfig,
  initialPresetKey,
}: Props) {
  const [config, setConfig] = useState<MachineConfigState>(() =>
    resolveInitialConfig(initialConfig, initialPresetKey),
  )

  // Locked-context slice — shared by both the live compute and the
  // scenario compare table.
  const lockedInput = useMemo(
    () => ({
      D_inch: tool.diameterInch,
      D_mm: tool.diameter,
      Z: tool.flutes,
      sfmBase: material.sfmBase,
      iptBase: material.iptBase,
      kc: material.kc,
      isoGroup: material.isoGroup,
      adocInch: operation.adocInch,
      rdocInch: operation.rdocInch,
    }),
    [tool, material, operation],
  )

  const input: ComputeInput = useMemo(
    () => ({ ...lockedInput, ...config }),
    [lockedInput, config],
  )

  const result = useMemo(() => computeImpact(input), [input])
  const baseline = useMemo(
    () => computeImpact({ ...lockedInput, ...BASELINE_CONFIG }),
    [lockedInput],
  )

  const currentPresetKey = matchPresetKey(config)

  const handleShare = async () => {
    const url = buildShareUrl(config)
    const ok = await copyText(url)
    if (ok) {
      toast.success(
        currentPresetKey
          ? `${IMPACT_PRESETS[currentPresetKey].label} 링크 복사됨`
          : "커스텀 시나리오 링크 복사됨",
      )
    } else {
      toast.error("클립보드 복사 실패 — URL 을 직접 복사하세요")
    }
  }

  return (
    <div className="space-y-3">
      <LockedToolBanner tool={tool} material={material} operation={operation} />

      {/* Share header — compact strip above KPIs */}
      <div className="flex items-center justify-end gap-2">
        {currentPresetKey ? (
          <span className="text-[10px] font-medium text-slate-500 dark:text-slate-400">
            프리셋 일치: {IMPACT_PRESETS[currentPresetKey].label}
          </span>
        ) : (
          <span className="text-[10px] font-medium text-amber-700 dark:text-amber-300">
            커스텀 설정 (프리셋 미일치)
          </span>
        )}
        <button
          type="button"
          onClick={handleShare}
          aria-label="이 시나리오 링크 복사"
          className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] font-medium text-slate-700 hover:border-slate-300 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
        >
          <Link2 className="h-3 w-3" />
          시나리오 링크 복사
        </button>
      </div>

      <LiveKpiStrip result={result} baseline={baseline} />

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <LimitCheckPanel warnings={result.warnings} />
        <CalculationFlowPanel input={input} result={result} />
      </div>

      <MachineConfigPanel value={config} onChange={setConfig} />

      <ScenarioCompareTable
        input={lockedInput}
        onPick={(_, preset) => setConfig({ ...config, ...preset.config })}
      />
    </div>
  )
})
