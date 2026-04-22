"use client"

import materialProperties from "../../../../data/domain-knowledge/material-properties.json"

type IsoKey = "P" | "M" | "K" | "N" | "S" | "H"

interface MaterialProfile {
  name: string
  standard: string
  iso_group: IsoKey
  category_ko: string
  category_en: string
  hardness: string
  tensile_strength_mpa: number
  thermal_conductivity_w_mk: number
  machinability_index: number
  machining_notes: string
  recommended_vc_range_carbide: string
  source_url: string
  source_name: string
  verified: boolean
}

const PROFILES = materialProperties as MaterialProfile[]

const ISO_BASE_MACHINABILITY: Record<IsoKey, number> = {
  P: 57,
  M: 45,
  K: 100,
  N: 190,
  S: 15,
  H: 30,
}

const ISO_BASE_CONDUCTIVITY: Record<IsoKey, number> = {
  P: 50,
  M: 16,
  K: 45,
  N: 150,
  S: 10,
  H: 22,
}

const ISO_BASE_KC: Record<IsoKey, number> = {
  P: 2000,
  M: 2200,
  K: 1200,
  N: 800,
  S: 2500,
  H: 3500,
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "")
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

export interface WorkpieceMaterialImpact {
  isoGroup: IsoKey
  profile: MaterialProfile | null
  displayName: string
  categoryLabel: string
  baseKc: number
  effectiveKc: number
  kcFactor: number
  thermalFactor: number
  machinabilityIndex: number
  thermalConductivityWmk: number
  tensileStrengthMpa: number
  hardnessLabel: string
  recommendedVcRange: string
  sourceName: string | null
  sourceUrl: string | null
  machiningNotes: string
  verified: boolean
}

export function resolveWorkpieceMaterialImpact(input: {
  isoGroup: string
  workpiece?: string
  hardnessValue?: number
}): WorkpieceMaterialImpact {
  const iso = ((input.isoGroup || "P").trim().toUpperCase().charAt(0) || "P") as IsoKey
  const baseKc = ISO_BASE_KC[iso] ?? ISO_BASE_KC.P
  const raw = (input.workpiece || "").trim()
  const normalized = normalize(raw)
  const profile = normalized
    ? PROFILES.find((item) => normalize(item.name) === normalized)
      ?? PROFILES.find((item) => normalize(item.name).includes(normalized) || normalized.includes(normalize(item.name)))
      ?? null
    : null

  const machinabilityIndex = profile?.machinability_index ?? ISO_BASE_MACHINABILITY[iso]
  const thermalConductivityWmk = profile?.thermal_conductivity_w_mk ?? ISO_BASE_CONDUCTIVITY[iso]
  const tensileStrengthMpa = profile?.tensile_strength_mpa ?? 0
  const hardnessLabel = profile?.hardness ?? `${input.hardnessValue ?? 0} HRC`
  const recommendedVcRange = profile?.recommended_vc_range_carbide ?? "catalog baseline"

  const machFactor = ISO_BASE_MACHINABILITY[iso] / Math.max(5, machinabilityIndex)
  const conductivityFactor = Math.sqrt(ISO_BASE_CONDUCTIVITY[iso] / Math.max(1, thermalConductivityWmk))
  const effectiveKc = Math.round(baseKc * clamp(machFactor, 0.65, 1.9))

  return {
    isoGroup: iso,
    profile,
    displayName: profile?.name ?? (raw || `ISO ${iso}`),
    categoryLabel: profile?.category_ko ?? `ISO ${iso}`,
    baseKc,
    effectiveKc,
    kcFactor: clamp(effectiveKc / Math.max(1, baseKc), 0.65, 1.9),
    thermalFactor: clamp(conductivityFactor, 0.75, 1.9),
    machinabilityIndex,
    thermalConductivityWmk,
    tensileStrengthMpa,
    hardnessLabel,
    recommendedVcRange,
    sourceName: profile?.source_name ?? null,
    sourceUrl: profile?.source_url ?? null,
    machiningNotes: profile?.machining_notes ?? `ISO ${iso} 그룹 기본 물성 기반 추정`,
    verified: profile?.verified ?? false,
  }
}
