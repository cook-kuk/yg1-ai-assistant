/**
 * Operation Type Resolver
 * Treats operation shapes as selectable series_application_shape text values.
 */

import { OPERATION_SHAPE_OPTIONS } from "@/lib/types/intake"

const DIRECT_OPERATION_SHAPE_VALUES = new Set(OPERATION_SHAPE_OPTIONS.map(option => option.value))

const OPERATION_ALIASES: Array<{ keywords: string[]; values: string[] }> = [
  // Holemaking (broad category → all sub-shapes)
  { keywords: ["holemaking", "홀가공", "홀 가공", "구멍가공", "구멍 가공"], values: ["Drilling", "Reaming_Blind", "Reaming_Through"] },
  { keywords: ["드릴", "drilling", "drill"], values: ["Drilling"] },
  { keywords: ["리밍 블라인드", "reaming blind"], values: ["Reaming_Blind"] },
  { keywords: ["리밍 쓰루", "reaming through"], values: ["Reaming_Through"] },
  // Threading (broad category → all sub-shapes)
  { keywords: ["threading", "나사", "탭", "tap", "tapping"], values: ["Threading_Blind", "Threading_Through"] },
  { keywords: ["나사 블라인드", "threading blind"], values: ["Threading_Blind"] },
  { keywords: ["나사 쓰루", "threading through"], values: ["Threading_Through"] },
  // Turning (broad category)
  { keywords: ["turning", "터닝", "선반", "선삭"], values: ["ISO_Turning", "Parting_Grooving"] },
  // Milling (broad category → common sub-shapes)
  { keywords: ["milling", "밀링", "엔드밀", "end mill", "endmill"], values: ["Side_Milling", "Slotting", "Profiling", "Facing"] },
  // Pocket — DB stores both "Pocketing" and "Pocket milling"; use short "Pocket"
  // as a LIKE token so both variants match.
  { keywords: ["포켓", "pocket", "pocketing", "포켓가공", "포켓 가공", "포켓밀링", "pocket milling"], values: ["Pocket"] },
  { keywords: ["측면가공", "측면", "side milling"], values: ["Side_Milling"] },
  { keywords: ["정면가공", "정면", "face", "facing"], values: ["Facing"] },
  { keywords: ["프로파일", "윤곽", "profiling", "profile", "contour"], values: ["Profiling"] },
  { keywords: ["금형", "die", "mold", "diesinking", "die-sinking"], values: ["Die-Sinking"] },
  { keywords: ["헬리컬 진입", "헬리컬", "helical interpolation"], values: ["Helical_Interpolation"] },
  { keywords: ["챔퍼", "chamfer", "chamfering"], values: ["Chamfering"] },
  { keywords: ["코너 라디우스", "코너라디우스", "corner radius"], values: ["Corner_Radius"] },
  { keywords: ["고이송", "trochoidal"], values: ["Trochoidal"] },
  { keywords: ["taper side milling"], values: ["Taper_Side_Milling"] },
  { keywords: ["small part"], values: ["Small_Part"] },
  { keywords: ["슬롯가공", "슬롯", "slotting", "slot"], values: ["Slotting"] },
  { keywords: ["ramping"], values: ["Ramping"] },
  { keywords: ["plunging"], values: ["Plunging"] },
  // Turning
  { keywords: ["iso 터닝", "iso turning", "iso turn"], values: ["ISO_Turning"] },
  { keywords: ["파팅", "그루빙", "parting", "grooving"], values: ["Parting_Grooving"] },
  // Tooling System
  { keywords: ["툴홀더", "tool holder"], values: ["Tool_Holder"] },
  { keywords: ["악세서리", "accessory"], values: ["Accessory"] },
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
  if (!input) return []

  // Preserve every distinct comma-separated token (lowercased) so that
  // "Side_Milling" and "Side Milling" produce separate SQL LIKE conditions.
  // parseOperationShapeSelections normalises both to the same canonical value,
  // which is correct for UI selection but loses the textual difference needed
  // for DB searching.
  const seen = new Set<string>()
  const results: string[] = []

  for (const rawPart of input.split(",").map(p => p.trim()).filter(Boolean)) {
    const resolved = parseOperationShapeSelections(rawPart)
    for (const value of resolved) {
      const key = value.toLowerCase()
      if (!seen.has(key)) {
        seen.add(key)
        results.push(value)
      }
    }
    // Also keep the raw text if it differs (lowercased) from every resolved value
    const rawKey = rawPart.toLowerCase()
    if (!seen.has(rawKey)) {
      seen.add(rawKey)
      results.push(rawPart)
    }
  }

  return results
}

export function normalizeOperationShapeToken(value: string): string {
  const normalized = normalizeShapeKey(value)
  const map: Record<string, string> = {
    // Holemaking
    drilling: "Drilling",
    "reaming blind": "Reaming_Blind",
    "reaming through": "Reaming_Through",
    // Threading
    "threading blind": "Threading_Blind",
    "threading through": "Threading_Through",
    // Milling
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
    // Turning
    "iso turning": "ISO_Turning",
    "iso turn": "ISO_Turning",
    "parting grooving": "Parting_Grooving",
    // Tooling
    "tool holder": "Tool_Holder",
    accessory: "Accessory",
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
