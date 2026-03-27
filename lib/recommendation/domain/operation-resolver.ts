/**
 * Operation Type Resolver
 * Treats operation shapes as selectable series_application_shape text values.
 */

import { OPERATION_SHAPE_OPTIONS } from "@/lib/types/intake"

const DIRECT_OPERATION_SHAPE_VALUES = new Set(OPERATION_SHAPE_OPTIONS.map(option => option.value))

const OPERATION_ALIASES: Array<{ keywords: string[]; values: string[] }> = [
  { keywords: ["측면가공", "측면", "side milling"], values: ["Side_Milling", "Side Milling"] },
  { keywords: ["정면가공", "정면", "face", "facing"], values: ["Facing"] },
  { keywords: ["프로파일", "윤곽", "profiling", "profile", "contour"], values: ["Profiling"] },
  { keywords: ["금형", "die", "mold", "diesinking", "die-sinking"], values: ["Die-Sinking"] },
  { keywords: ["헬리컬 진입", "헬리컬", "helical interpolation"], values: ["Helical_Interpolation", "Helical Interpolation"] },
  { keywords: ["챔퍼", "chamfer", "chamfering"], values: ["Chamfering"] },
  { keywords: ["코너 라디우스", "코너라디우스", "corner radius"], values: ["Corner_Radius", "Corner Radius"] },
  { keywords: ["고이송", "trochoidal"], values: ["Trochoidal"] },
  { keywords: ["taper side milling"], values: ["Taper Side Milling", "Taper_Side_Milling"] },
  { keywords: ["small part"], values: ["Small Part", "Small_Part"] },
  { keywords: ["슬롯가공", "슬롯", "slotting", "slot"], values: ["Slotting"] },
  { keywords: ["ramping"], values: ["Ramping"] },
  { keywords: ["plunging"], values: ["Plunging"] },
]

function normalizeShapeKey(value: string): string {
  return value.trim().toLowerCase().replace(/[\s_-]+/g, " ")
}

export function parseOperationShapeSelections(input: string): string[] {
  if (!input) return []

  const selections = new Set<string>()
  for (const rawPart of input.split(",").map(part => part.trim()).filter(Boolean)) {
    if (DIRECT_OPERATION_SHAPE_VALUES.has(rawPart)) {
      selections.add(rawPart)
      continue
    }

    const normalizedPart = normalizeShapeKey(rawPart)
    const directMatches = OPERATION_SHAPE_OPTIONS
      .filter(option => normalizeShapeKey(option.value) === normalizedPart)
      .map(option => option.value)
    if (directMatches.length === 1) {
      selections.add(directMatches[0])
      continue
    }
    if (directMatches.length > 1) {
      for (const match of directMatches) selections.add(match)
      continue
    }

    const aliasMatch = OPERATION_ALIASES.find(alias =>
      alias.keywords.some(keyword => normalizedPart.includes(normalizeShapeKey(keyword)))
    )
    if (aliasMatch) {
      for (const value of aliasMatch.values) selections.add(value)
      continue
    }

    selections.add(rawPart)
  }

  return [...selections]
}

export function getOperationShapeSearchTexts(input: string): string[] {
  return parseOperationShapeSelections(input)
}

export function normalizeOperationShapeToken(value: string): string {
  const normalized = normalizeShapeKey(value)
  const map: Record<string, string> = {
    "side milling": "Side_Milling",
    facing: "Facing",
    profiling: "Profiling",
    "die sinking": "Die-Sinking",
    "helical interpolation": "Helical_Interpolation",
    chamfering: "Chamfering",
    "corner radius": "Corner_Radius",
    trochoidal: "Trochoidal",
    "taper side milling": "Taper_Side_Milling",
    "small part": "Small_Part",
    slotting: "Slotting",
    ramping: "Ramping",
    plunging: "Plunging",
  }

  return map[normalized] ?? value.trim()
}

export function getAppShapesForOperation(input: string): string[] {
  return parseOperationShapeSelections(input).map(normalizeOperationShapeToken)
}

export function getOperationLabel(input: string, _locale: "ko" | "en" = "ko"): string {
  const selections = parseOperationShapeSelections(input)
  return selections[0] ?? input
}
