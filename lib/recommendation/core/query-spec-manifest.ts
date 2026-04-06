/**
 * QuerySpec Semantic Manifest
 *
 * planner가 raw DB schema 대신 이 manifest를 참조하여 semantic field로 판단.
 * raw DB column 노출을 줄이고, 도메인 의미 기반으로 필드를 식별.
 */

import type { QueryField, QueryOp } from "./query-spec"

// ── Field Manifest Entry ────────────────────────────────────

export interface FieldManifestEntry {
  field: QueryField
  label: string
  description: string
  allowedOps: QueryOp[]
  aliases: string[]
  valueType: "string" | "number" | "range"
  examples: string[]
}

// ── Manifest ────────────────────────────────────────────────

export const QUERY_FIELD_MANIFEST: FieldManifestEntry[] = [
  {
    field: "materialGroup",
    label: "소재 그룹 (ISO)",
    description: "ISO 분류 기반 피삭재 대그룹. P(강), M(스테인리스), K(주철), N(비철), S(내열합금), H(고경도강), O(기타).",
    allowedOps: ["eq", "neq", "in"],
    aliases: ["소재", "피삭재", "material", "재질", "재료", "가공소재"],
    valueType: "string",
    examples: ["P", "M", "K", "N", "S", "H"],
  },
  {
    field: "workpiece",
    label: "세부 피삭재",
    description: "구체적인 피삭재 이름. 구리, 알루미늄, 스테인리스, 탄소강, 티타늄 등.",
    allowedOps: ["eq", "neq", "in", "contains"],
    aliases: ["피삭재", "소재", "workpiece", "work piece", "재질"],
    valueType: "string",
    examples: ["Copper", "Aluminum", "Stainless Steels", "Carbon Steel", "Titanium", "구리", "알루미늄", "스테인리스"],
  },
  {
    field: "toolFamily",
    label: "공구 대분류",
    description: "공구의 대분류. End Mill, Drill, Tap, Reamer, Insert 등.",
    allowedOps: ["eq", "neq"],
    aliases: ["공구", "tool", "공구타입", "tool type"],
    valueType: "string",
    examples: ["End Mill", "Drill", "Tap"],
  },
  {
    field: "toolSubtype",
    label: "공구 세부 형상",
    description: "엔드밀의 세부 형상. Square(스퀘어/평), Ball(볼), Corner Radius(코너R), Chamfer 등.",
    allowedOps: ["eq", "neq", "in"],
    aliases: ["형상", "타입", "종류", "type", "subtype", "shape", "모양"],
    valueType: "string",
    examples: ["Square", "Ball", "Corner Radius", "Chamfer", "T-Slot"],
  },
  {
    field: "diameterMm",
    label: "직경 (mm)",
    description: "공구 직경 (밀리미터 단위). 정확히 또는 범위로 지정 가능.",
    allowedOps: ["eq", "neq", "gte", "lte", "between"],
    aliases: ["직경", "지름", "diameter", "dia", "파이", "Ø", "mm"],
    valueType: "number",
    examples: ["6", "8", "10", "12", "16", "20"],
  },
  {
    field: "fluteCount",
    label: "날수",
    description: "절삭 날의 수. 2날, 3날, 4날, 6날 등.",
    allowedOps: ["eq", "neq", "gte", "lte"],
    aliases: ["날", "날수", "flute", "플루트", "날개"],
    valueType: "number",
    examples: ["2", "3", "4", "6"],
  },
  {
    field: "coating",
    label: "코팅",
    description: "공구 코팅 종류. TiAlN, AlCrN, DLC, TiN, 무코팅 등.",
    allowedOps: ["eq", "neq", "in", "contains"],
    aliases: ["코팅", "coating", "표면처리"],
    valueType: "string",
    examples: ["TiAlN", "AlCrN", "DLC", "TiN", "Uncoated", "무코팅"],
  },
  {
    field: "brand",
    label: "브랜드/시리즈 브랜드",
    description: "제품 브랜드명. TANK-POWER, X5070, CRX-S, ALU-CUT 등.",
    allowedOps: ["eq", "neq", "contains"],
    aliases: ["브랜드", "brand", "상표"],
    valueType: "string",
    examples: ["TANK-POWER", "X5070", "CRX-S", "ALU-CUT", "V7"],
  },
  {
    field: "seriesName",
    label: "시리즈명",
    description: "제품 시리즈 코드. GAA29, CE7406 등.",
    allowedOps: ["eq", "neq", "contains"],
    aliases: ["시리즈", "series", "모델"],
    valueType: "string",
    examples: ["GAA29", "CE7406", "GYG77"],
  },
  {
    field: "operationType",
    label: "가공 종류",
    description: "가공 형태. 슬로팅, 숄더링, 포켓가공, 면삭 등.",
    allowedOps: ["eq", "neq", "in"],
    aliases: ["가공", "가공방법", "operation", "machining", "작업"],
    valueType: "string",
    examples: ["slotting", "shouldering", "pocketing", "profiling", "facing"],
  },
  {
    field: "operationShape",
    label: "가공 형상",
    description: "가공 대상 형상. 포켓, 벽면, 홈 등.",
    allowedOps: ["eq", "neq"],
    aliases: ["형상", "가공형상", "shape"],
    valueType: "string",
    examples: ["pocket", "wall", "slot", "hole"],
  },
  {
    field: "country",
    label: "생산국",
    description: "제품 생산국가.",
    allowedOps: ["eq", "neq"],
    aliases: ["국가", "생산국", "country", "원산지"],
    valueType: "string",
    examples: ["Korea", "Israel", "China"],
  },
]

// ── Helpers ─────────────────────────────────────────────────

const _manifestMap = new Map(QUERY_FIELD_MANIFEST.map(e => [e.field, e]))

export function getFieldManifest(field: QueryField): FieldManifestEntry | undefined {
  return _manifestMap.get(field)
}

/** planner system prompt에 삽입할 manifest 요약 텍스트 */
export function buildManifestPromptSection(): string {
  const lines = QUERY_FIELD_MANIFEST.map(e => {
    const ops = e.allowedOps.join(", ")
    const aliases = e.aliases.slice(0, 4).join(", ")
    const examples = e.examples.slice(0, 4).join(", ")
    return `- ${e.field} (${e.label}): ${e.description}\n  ops=[${ops}] aliases=[${aliases}] examples=[${examples}]`
  })
  return lines.join("\n")
}
