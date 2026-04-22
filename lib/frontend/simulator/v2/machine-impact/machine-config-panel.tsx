// Machine Impact Lab — machine config panel. The only mutable UI in the
// lab: spindle / holder / coolant / stickout / workholding knobs.
// Everything else is a read-only render of the engine's result.
"use client"

import { memo } from "react"
import { Slider } from "@/components/ui/slider"
import { SPINDLE_PRESETS, HOLDER_PRESETS, COOLANTS } from "../presets"
import type { ImpactPreset } from "./impact-calc-engine"
import { IMPACT_PRESETS, spindleCategory } from "./impact-calc-engine"

export interface MachineConfigState {
  spindleKey: string
  holderKey: string
  coolantKey: string
  stickoutInch: number
  workholdingPct: number
}

interface Props {
  value: MachineConfigState
  onChange: (next: MachineConfigState) => void
}

function RadioGrid({
  options,
  selectedKey,
  onSelect,
  renderLabel,
  renderSub,
}: {
  options: { key: string; label: string }[]
  selectedKey: string
  onSelect: (key: string) => void
  renderLabel?: (opt: { key: string; label: string }) => React.ReactNode
  renderSub?: (opt: { key: string; label: string }) => React.ReactNode
}) {
  return (
    <div className="grid grid-cols-2 gap-1.5 md:grid-cols-3">
      {options.map((opt) => {
        const active = opt.key === selectedKey
        return (
          <button
            key={opt.key}
            type="button"
            onClick={() => onSelect(opt.key)}
            className={`rounded-md border px-2 py-1.5 text-left text-[11px] transition ${
              active
                ? "border-blue-400 bg-blue-50 text-blue-900 dark:border-blue-500 dark:bg-blue-950/40 dark:text-blue-200"
                : "border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
            }`}
          >
            <div className="font-semibold leading-tight">
              {renderLabel ? renderLabel(opt) : opt.label}
            </div>
            {renderSub ? (
              <div className="mt-0.5 text-[9px] opacity-70">{renderSub(opt)}</div>
            ) : null}
          </button>
        )
      })}
    </div>
  )
}

export const MachineConfigPanel = memo(function MachineConfigPanel({ value, onChange }: Props) {
  const applyPreset = (p: ImpactPreset) => onChange({ ...value, ...p.config })

  return (
    <section className="space-y-3 rounded-lg border border-slate-200 bg-white/80 p-3 shadow-sm dark:border-slate-700 dark:bg-slate-900/50">
      <header className="flex items-center justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-300">
          머신 설정 (Machine Config)
        </h3>
        <span className="text-[10px] font-medium text-slate-500 dark:text-slate-400">
          공구·소재·조건 고정 · 아래만 변경
        </span>
      </header>

      {/* ── Preset shortcuts ─────────────────────────────────────── */}
      <div>
        <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
          프리셋 빠른 로드
        </div>
        <div className="flex flex-wrap gap-1.5">
          {Object.entries(IMPACT_PRESETS).map(([key, p]) => (
            <button
              key={key}
              type="button"
              onClick={() => applyPreset(p)}
              className="rounded-full border border-slate-200 bg-white px-2.5 py-0.5 text-[10px] font-medium text-slate-700 hover:border-slate-300 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {/* ── Spindle ──────────────────────────────────────────────── */}
      <div>
        <div className="mb-1 flex items-center justify-between">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
            Spindle
          </span>
          <span className="font-mono text-[10px] text-slate-600 dark:text-slate-300">
            {SPINDLE_PRESETS.find((s) => s.key === value.spindleKey)?.maxRpm.toLocaleString() ?? "—"} RPM 한계
          </span>
        </div>
        <RadioGrid
          options={SPINDLE_PRESETS}
          selectedKey={value.spindleKey}
          onSelect={(k) => onChange({ ...value, spindleKey: k })}
          renderLabel={(opt) => {
            const full = SPINDLE_PRESETS.find((s) => s.key === opt.key)
            if (!full) return opt.label
            return (
              <span className="flex items-center gap-1">
                <span>{full.label}</span>
                <span className="rounded bg-slate-100 px-1 py-px text-[8px] font-bold uppercase text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                  {spindleCategory(full)}
                </span>
              </span>
            )
          }}
          renderSub={(opt) => {
            const full = SPINDLE_PRESETS.find((s) => s.key === opt.key)
            if (!full) return null
            return `${full.maxRpm.toLocaleString()} RPM · ${full.maxKw} kW`
          }}
        />
      </div>

      {/* ── Holder ───────────────────────────────────────────────── */}
      <div>
        <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
          Holder
        </div>
        <RadioGrid
          options={HOLDER_PRESETS}
          selectedKey={value.holderKey}
          onSelect={(k) => onChange({ ...value, holderKey: k })}
          renderSub={(opt) => {
            const full = HOLDER_PRESETS.find((h) => h.key === opt.key)
            if (!full) return null
            const parts = [`강성 ${full.rigidity}`]
            if (full.tirMicron !== undefined) parts.push(`TIR ${full.tirMicron}μm`)
            if (full.maxRpm !== undefined) parts.push(`${full.maxRpm.toLocaleString()} RPM`)
            return parts.join(" · ")
          }}
        />
      </div>

      {/* ── Coolant ──────────────────────────────────────────────── */}
      <div>
        <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
          Coolant
        </div>
        <RadioGrid
          options={COOLANTS}
          selectedKey={value.coolantKey}
          onSelect={(k) => onChange({ ...value, coolantKey: k })}
          renderSub={(opt) => {
            const full = COOLANTS.find((c) => c.key === opt.key)
            if (!full) return null
            return `Vc ×${full.vcMultiplier.toFixed(2)} · 열제거 ${Math.round(full.heatRemoval * 100)}%`
          }}
        />
      </div>

      {/* ── Stickout + Workholding sliders ──────────────────────── */}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <div>
          <div className="mb-1 flex items-center justify-between">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
              Stickout
            </span>
            <span className="font-mono text-[11px] font-semibold text-slate-800 dark:text-slate-100">
              {value.stickoutInch.toFixed(2)}″
            </span>
          </div>
          <Slider
            min={0.4}
            max={5.0}
            step={0.05}
            value={[value.stickoutInch]}
            onValueChange={(v) => onChange({ ...value, stickoutInch: v[0] ?? value.stickoutInch })}
          />
          <div className="mt-0.5 flex justify-between text-[9px] text-slate-400 dark:text-slate-500">
            <span>0.4″ (짧음 · 강성↑)</span>
            <span>5.0″ (길음 · 처짐↑)</span>
          </div>
        </div>

        <div>
          <div className="mb-1 flex items-center justify-between">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
              Workholding
            </span>
            <span className="font-mono text-[11px] font-semibold text-slate-800 dark:text-slate-100">
              {Math.round(value.workholdingPct)}%
            </span>
          </div>
          <Slider
            min={30}
            max={100}
            step={1}
            value={[value.workholdingPct]}
            onValueChange={(v) => onChange({ ...value, workholdingPct: v[0] ?? value.workholdingPct })}
          />
          <div className="mt-0.5 flex justify-between text-[9px] text-slate-400 dark:text-slate-500">
            <span>30% (느슨)</span>
            <span>100% (완전 고정)</span>
          </div>
        </div>
      </div>
    </section>
  )
})
