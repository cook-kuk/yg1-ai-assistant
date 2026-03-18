import type {
  AnswerState,
  InquiryPurpose,
  MachiningIntent,
  ProductIntakeForm,
} from "@/lib/types/intake"

export type AppLanguage = "ko" | "en"
export type LocalizedIntakeFieldKey = Exclude<keyof ProductIntakeForm, "advanced">

const FIELD_LABELS: Record<LocalizedIntakeFieldKey, { ko: string; en: string }> = {
  inquiryPurpose: { ko: "문의 목적", en: "Inquiry Purpose" },
  material: { ko: "피삭재 (소재)", en: "Workpiece Material" },
  operationType: { ko: "가공 형상", en: "Operation Shape" },
  machiningIntent: { ko: "가공 성격", en: "Machining Intent" },
  toolTypeOrCurrentProduct: { ko: "공구 타입 / 현재 제품", en: "Tool Type / Current Product" },
  diameterInfo: { ko: "공구 직경", en: "Tool Diameter" },
  country: { ko: "시장 / 국가", en: "Market / Country" },
  unitSystem: { ko: "단위 계열", en: "Unit System" },
}

const INQUIRY_PURPOSE_LABELS_LOCALIZED: Record<InquiryPurpose, { ko: string; en: string }> = {
  new: { ko: "신규 제품 추천", en: "New Product Recommendation" },
  substitute: { ko: "YG-1 대체품 찾기", en: "Find a YG-1 Substitute" },
  inventory_substitute: { ko: "재고 없는 대체품", en: "Out-of-Stock Substitute" },
  cutting_condition: { ko: "가공조건 참고", en: "Cutting Condition Reference" },
  product_lookup: { ko: "현재 제품 정보 확인", en: "Current Product Lookup" },
}

const MACHINING_INTENT_LABELS_LOCALIZED: Record<MachiningIntent, { ko: string; en: string }> = {
  roughing: { ko: "황삭", en: "Roughing" },
  semi: { ko: "중삭", en: "Semi-finishing" },
  finishing: { ko: "정삭", en: "Finishing" },
}

const TEXT_REPLACEMENTS_EN: Array<[string, string]> = [
  ["어떤 목적으로 제품을 찾으시나요?", "What is the purpose of this search?"],
  ["가공할 소재를 선택하세요 (복수 선택 가능)", "Select the workpiece material (multiple selection allowed)"],
  ["어떤 형태의 가공인가요? (복수 선택 가능)", "What machining shape is required? (multiple selection allowed)"],
  ["황삭 / 중삭 / 정삭 중 어느 쪽인가요?", "Is this roughing, semi-finishing, or finishing?"],
  ["원하는 공구 타입 또는 현재 사용 중인 EDP를 알려주세요", "Enter the desired tool type or the current EDP in use"],
  ["공구 직경을 선택하거나 직접 입력하세요", "Select the tool diameter or enter it directly"],
  ["대체품 찾기 → 현재 사용 중인 EDP/품번을 입력하면 더 정확합니다", "Substitute search -> Enter the current EDP / part number for better accuracy"],
  ["실제 데이터에서 제품 검색 중...", "Searching products from real data..."],
  ["없는 제품은 생성하지 않습니다", "Only real products - no hallucination"],
  ["YG-1 제품 탐색", "YG-1 Product Search"],
  ["조건 입력", "Enter Conditions"],
  ["조건 확인", "Review Conditions"],
  ["검색 중", "Searching"],
  ["YG-1 대체품 찾기", "Find a YG-1 Substitute"],
  ["재고 없는 대체품", "Out-of-Stock Substitute"],
  ["가공조건 참고", "Cutting Condition Reference"],
  ["현재 제품 정보 확인", "Current Product Lookup"],
  ["신규 제품 추천", "New Product Recommendation"],
  ["피삭재", "Workpiece"],
  ["소재", "Material"],
  ["가공 형상", "Operation Shape"],
  ["가공 성격", "Machining Intent"],
  ["공구 타입", "Tool Type"],
  ["현재 제품", "Current Product"],
  ["공구 직경", "Tool Diameter"],
  ["알루미늄 / 비철", "Aluminum / Non-ferrous"],
  ["일반강 / 탄소강", "General / Carbon Steel"],
  ["스테인리스 (SUS)", "Stainless Steel (SUS)"],
  ["고경도강 (HRC40+)", "Hardened Steel (HRC40+)"],
  ["티타늄 / 내열합금", "Titanium / Superalloy"],
  ["구리 / 흑연", "Copper / Graphite"],
  ["측면가공 (Side)", "Side Milling"],
  ["슬롯 (Slot)", "Slotting"],
  ["포켓 (Pocket)", "Pocketing"],
  ["헬리컬 진입", "Helical Entry"],
  ["정면가공 (Face)", "Facing"],
  ["프로파일 / 윤곽", "Profiling / Contour"],
  ["엔드밀 (Square / Ball / CR)", "End Mill (Square / Ball / CR)"],
  ["EDP 코드 직접입력", "Enter EDP Code"],
  ["직접입력", "Custom Input"],
  ["직접 입력", "Enter manually"],
  ["해당없음", "Not applicable"],
  ["예:", "e.g."],
  ["준비 중", "Coming Soon"],
  ["알루미늄", "Aluminum"],
  ["비철금속", "Non-ferrous"],
  ["비철계", "Non-ferrous"],
  ["비철", "Non-ferrous"],
  ["일반강", "Carbon Steel"],
  ["탄소강", "Carbon Steel"],
  ["합금강", "Alloy Steel"],
  ["스테인리스", "Stainless Steel"],
  ["스테인레스", "Stainless Steel"],
  ["스텐레스스틸", "Stainless Steel"],
  ["스텐", "Stainless Steel"],
  ["주철", "Cast Iron"],
  ["고경도강", "Hardened Steel"],
  ["티타늄", "Titanium"],
  ["내열합금", "Superalloy"],
  ["인코넬", "Inconel"],
  ["구리", "Copper"],
  ["흑연", "Graphite"],
  ["그라파이트", "Graphite"],
  ["측면가공", "Side Milling"],
  ["슬롯가공", "Slotting"],
  ["슬롯", "Slotting"],
  ["포켓", "Pocketing"],
  ["헬리컬 진입", "Helical Interpolation"],
  ["헬리컬", "Helical Interpolation"],
  ["정면가공", "Facing"],
  ["프로파일", "Profiling"],
  ["윤곽", "Contour"],
  ["황삭", "Roughing"],
  ["중삭", "Semi-finishing"],
  ["정삭", "Finishing"],
  ["엔드밀", "End Mill"],
  ["드릴", "Drill"],
  ["탭", "Tap"],
  ["모름", "Unknown"],
  ["미입력", "Not provided"],
  ["상관없음", "No preference"],
]

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

function translateFreeTextToEnglish(text: string): string {
  let translated = text

  translated = translated.replace(/(\d+)\s*날/g, "$1 FL")
  translated = translated.replace(/(\d+)\s*개/g, "$1")

  for (const [source, target] of [...TEXT_REPLACEMENTS_EN].sort((a, b) => b[0].length - a[0].length)) {
    translated = translated.replace(new RegExp(escapeRegExp(source), "g"), target)
  }

  return translated
}

export function getIntakeFieldLabel(key: keyof ProductIntakeForm, language: AppLanguage): string {
  if (key === "advanced") return language === "ko" ? "고급 조건" : "Advanced Filters"
  return FIELD_LABELS[key][language]
}

export function localizeIntakeText(text: string, language: AppLanguage): string {
  if (language === "ko") return text
  return translateFreeTextToEnglish(text)
}

export function canonicalizeIntakeSearchText(text: string): string {
  return translateFreeTextToEnglish(text)
}

export function getIntakeDisplayValue(
  key: keyof ProductIntakeForm,
  state: AnswerState<string>,
  language: AppLanguage
): string {
  if (key === "advanced") return language === "ko" ? "미입력" : "Not provided"
  if (state.status === "unknown") return language === "ko" ? "모름" : "Unknown"
  if (state.status === "unanswered") return language === "ko" ? "미입력" : "Not provided"

  const value = state.value
  if (key === "inquiryPurpose") {
    return INQUIRY_PURPOSE_LABELS_LOCALIZED[value as InquiryPurpose]?.[language] ?? value
  }
  if (key === "machiningIntent") {
    return MACHINING_INTENT_LABELS_LOCALIZED[value as MachiningIntent]?.[language] ?? value
  }
  if (key === "country") {
    const countryLabels: Record<string, { ko: string; en: string }> = {
      ALL: { ko: "전체", en: "All Countries" },
      KOR: { ko: "한국", en: "Korea" },
      ENG: { ko: "영국", en: "UK" },
      CHN: { ko: "중국", en: "China" },
      DEU: { ko: "독일", en: "Germany" },
      ESP: { ko: "스페인", en: "Spain" },
      FRA: { ko: "프랑스", en: "France" },
      HUN: { ko: "헝가리", en: "Hungary" },
      ITA: { ko: "이탈리아", en: "Italy" },
      JPN: { ko: "일본", en: "Japan" },
      POL: { ko: "폴란드", en: "Poland" },
      PRT: { ko: "포르투갈", en: "Portugal" },
      RUS: { ko: "러시아", en: "Russia" },
      THA: { ko: "태국", en: "Thailand" },
      TUR: { ko: "튀르키예", en: "Turkey" },
      VNM: { ko: "베트남", en: "Vietnam" },
      CZE: { ko: "체코", en: "Czech Republic" },
    }
    return countryLabels[value]?.[language] ?? value
  }
  if (key === "unitSystem") {
    const unitLabels: Record<string, { ko: string; en: string }> = {
      METRIC: { ko: "미터법 (mm)", en: "Metric (mm)" },
      INCH: { ko: "인치 (inch)", en: "Inch" },
      ALL: { ko: "전체", en: "All Units" },
    }
    return unitLabels[value]?.[language] ?? value
  }

  return localizeIntakeText(value, language)
}
