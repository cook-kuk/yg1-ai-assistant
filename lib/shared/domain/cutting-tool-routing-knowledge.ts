export type CuttingToolTaxonomyKind =
  | "tool_subtype"
  | "application_shape"
  | "process"
  | "hole_type"

export interface CuttingToolTaxonomyEntry {
  canonical: string
  description: string
  kind: CuttingToolTaxonomyKind
  aliases: string[]
}

export const CUTTING_TOOL_ROUTING_TAXONOMY: CuttingToolTaxonomyEntry[] = [
  {
    canonical: "Square",
    kind: "tool_subtype",
    description: "평면, 측면, 슬롯 등 범용 밀링 형상",
    aliases: ["square", "square end mill", "스퀘어", "플랫"],
  },
  {
    canonical: "Ball",
    kind: "tool_subtype",
    description: "3D 곡면, 금형 정삭, R 형상 가공용 형상",
    aliases: ["ball", "ball nose", "ball nose end mill", "볼", "볼 엔드밀"],
  },
  {
    canonical: "Radius",
    kind: "tool_subtype",
    description: "모서리 강도와 수명을 높이는 코너 R 형상",
    aliases: ["radius", "corner radius", "corner r", "라디우스", "코너r", "코너 r"],
  },
  {
    canonical: "Taper",
    kind: "tool_subtype",
    description: "깊은 캐비티, 리브, 경사면 가공용 형상",
    aliases: ["taper", "taper ball", "테이퍼", "테이퍼 볼"],
  },
  {
    canonical: "Roughing",
    kind: "tool_subtype",
    description: "정삭보다 제거율을 우선하는 황삭형 서브타입",
    aliases: ["roughing", "rougher", "황삭"],
  },
  {
    canonical: "High-Feed",
    kind: "tool_subtype",
    description: "고이송과 생산성을 우선하는 서브타입",
    aliases: ["high feed", "high-feed", "하이피드", "고이송"],
  },
  {
    canonical: "Side Milling",
    kind: "application_shape",
    description: "공구 측면을 주로 쓰는 밀링 방식",
    aliases: ["side milling", "sidemilling", "측면가공", "측면 밀링"],
  },
  {
    canonical: "Slotting",
    kind: "application_shape",
    description: "100% 물림 슬롯 가공 방식",
    aliases: ["slotting", "slot", "슬롯", "슬롯가공"],
  },
  {
    canonical: "Profiling",
    kind: "application_shape",
    description: "윤곽이나 곡면 프로파일 가공 방식",
    aliases: ["profiling", "profile", "프로파일", "윤곽가공"],
  },
  {
    canonical: "Facing",
    kind: "application_shape",
    description: "평면을 가공하는 방식",
    aliases: ["facing", "face milling", "페이싱", "평면가공"],
  },
  {
    canonical: "Trochoidal",
    kind: "application_shape",
    description: "트로코이달 경로 기반의 고효율 가공 방식",
    aliases: ["trochoidal", "트로코이달"],
  },
  {
    canonical: "Helical Interpolation",
    kind: "application_shape",
    description: "나선 보간 경로를 활용한 가공 방식",
    aliases: ["helical interpolation", "helical", "헬리컬", "나선 보간"],
  },
  {
    canonical: "Taper Side Milling",
    kind: "application_shape",
    description: "테이퍼 벽면을 측면 가공하는 방식",
    aliases: ["taper side milling", "taper side", "테이퍼 사이드"],
  },
  {
    canonical: "Die-Sinking",
    kind: "application_shape",
    description: "금형 캐비티류를 파내는 다이싱킹 가공 방식",
    aliases: ["die-sinking", "diesinking", "다이싱킹", "캐비티 가공"],
  },
  {
    canonical: "Drilling",
    kind: "process",
    description: "홀 가공 공정",
    aliases: ["drilling", "drill", "드릴링", "드릴"],
  },
  {
    canonical: "Reaming",
    kind: "process",
    description: "홀 정밀 마무리 공정",
    aliases: ["reaming", "reamer", "리밍", "리머"],
  },
  {
    canonical: "Threading",
    kind: "process",
    description: "나사 가공 공정",
    aliases: ["threading", "thread", "탭핑", "thread mill", "쓰레드", "나사 가공"],
  },
  {
    canonical: "Blind",
    kind: "hole_type",
    description: "막힘 홀 형태",
    aliases: ["blind", "blind hole", "막힘홀", "막힌홀"],
  },
  {
    canonical: "Through",
    kind: "hole_type",
    description: "관통 홀 형태",
    aliases: ["through", "through hole", "관통홀", "관통 구멍"],
  },
]

const KNOWLEDGE_INTENT_PATTERN = /차이|비교|뭐야|무엇|알려|설명|원리|방법|팁|주의|장단점|특징|적절|어떤|왜|어떻게|추천|좋은|의미|정의|가능/i

function normalizeTaxonomyText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[\s\-_/(),.]+/g, "")
    .trim()
}

export function findCuttingToolTaxonomyMatches(text: string): CuttingToolTaxonomyEntry[] {
  if (!text) return []

  const normalized = normalizeTaxonomyText(text)
  const matched: CuttingToolTaxonomyEntry[] = []

  for (const entry of CUTTING_TOOL_ROUTING_TAXONOMY) {
    if (entry.aliases.some(alias => normalized.includes(normalizeTaxonomyText(alias)))) {
      matched.push(entry)
    }
  }

  return matched
}

export function hasCuttingToolTaxonomyMatch(text: string): boolean {
  return findCuttingToolTaxonomyMatches(text).length > 0
}

export function isCuttingToolTaxonomyKnowledgeQuestion(text: string): boolean {
  if (!text) return false
  return hasCuttingToolTaxonomyMatch(text) && KNOWLEDGE_INTENT_PATTERN.test(text)
}

export function buildCuttingToolSubtypeTaxonomyKnowledgeBlock(): string {
  return [
    "### 공구/가공 subtype taxonomy",
    "- tool subtype은 공구의 세부 형상/용도를 뜻하며, Square, Ball, Radius, Taper, Roughing, High-Feed 같은 분류가 여기에 들어간다.",
    "- application shape는 가공 방식 분류이며, Side Milling, Slotting, Profiling, Facing, Trochoidal, Helical Interpolation, Taper Side Milling, Die-Sinking 등으로 나뉜다.",
    "- hole/thread 계열은 Drilling, Reaming, Threading처럼 공정 자체를 가리키며, Blind / Through는 홀 형태를 뜻한다.",
    "- 사용자가 이런 용어를 직접 말하면 제품코드로 오인하지 말고 공정/형상 taxonomy로 먼저 해석하라.",
  ].join("\n")
}
