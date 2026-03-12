/**
 * Operation Type Resolver
 * Maps Korean/English operation input → application_shape keywords used in product data
 */

export type OperationGroup = "roughing" | "finishing" | "semi-finishing" | "high-feed" | "slotting" | "drilling" | "other"

interface OperationMapping {
  group: OperationGroup
  keywords: string[]       // user input patterns
  appShapes: string[]      // application_shape values in product data
  labelKo: string
  labelEn: string
}

const OPERATION_MAP: OperationMapping[] = [
  {
    group: "roughing",
    keywords: ["황삭", "rough", "roughing", "황", "헤비컷", "heavy"],
    appShapes: ["Side_Milling", "Profiling", "Roughing"],
    labelKo: "황삭",
    labelEn: "Roughing",
  },
  {
    group: "finishing",
    keywords: ["정삭", "finish", "finishing", "정", "마무리", "fine"],
    appShapes: ["Side_Milling", "Profiling", "Die-Sinking"],
    labelKo: "정삭",
    labelEn: "Finishing",
  },
  {
    group: "semi-finishing",
    keywords: ["중삭", "semi", "semi-finish", "반정삭"],
    appShapes: ["Side_Milling", "Profiling"],
    labelKo: "중삭",
    labelEn: "Semi-finishing",
  },
  {
    group: "high-feed",
    keywords: ["고이송", "high feed", "high-feed", "highfeed", "hfm", "빠른이송"],
    appShapes: ["Trochoidal", "High_Feed"],
    labelKo: "고이송",
    labelEn: "High-Feed",
  },
  {
    group: "slotting",
    keywords: ["슬롯", "slot", "slotting", "홈가공", "홈"],
    appShapes: ["Slotting"],
    labelKo: "슬롯가공",
    labelEn: "Slotting",
  },
  {
    group: "other",
    keywords: ["측면", "side", "윤곽", "contour", "profile", "금형", "die", "mold"],
    appShapes: ["Side_Milling", "Die-Sinking", "Profiling"],
    labelKo: "측면/윤곽",
    labelEn: "Side/Profile",
  },
]

export function resolveOperation(input: string): OperationMapping | null {
  if (!input) return null
  const lower = input.toLowerCase().trim()
  for (const op of OPERATION_MAP) {
    if (op.keywords.some(k => lower.includes(k))) return op
  }
  return null
}

export function getAppShapesForOperation(input: string): string[] {
  const op = resolveOperation(input)
  return op?.appShapes ?? []
}

export function getOperationLabel(input: string, locale: "ko" | "en" = "ko"): string {
  const op = resolveOperation(input)
  if (!op) return input
  return locale === "ko" ? op.labelKo : op.labelEn
}

export { OPERATION_MAP }
