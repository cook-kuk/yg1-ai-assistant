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
    description: "ISO 대분류. P/M/K/N/S/H 같은 단일 알파벳 코드일 때만 사용. 구체적 소재명(구리, 스테인리스 등)은 workpiece 사용.",
    allowedOps: ["eq", "neq", "in"],
    aliases: ["소재그룹", "ISO소재", "material group"],
    valueType: "string",
    examples: ["P", "M", "K", "N", "S", "H"],
  },
  {
    field: "workpiece",
    label: "세부 피삭재",
    description: "구체적인 피삭재 이름. 구리, 알루미늄, 스테인리스, 탄소강, 티타늄 등. '소재'라고 하면 이 필드.",
    allowedOps: ["eq", "neq", "in", "contains"],
    aliases: ["피삭재", "소재", "workpiece", "재질", "material", "재료", "가공소재"],
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
    field: "shankType",
    label: "생크 타입",
    description: "공구 생크(자루) 형태. Plain(플레인/일반), Weldon(웰던), HA 등. '싱크 타입', '생크 타입'이라고 하면 이 필드.",
    allowedOps: ["eq", "neq", "contains"],
    aliases: ["싱크 타입", "생크 타입", "shank type", "생크", "싱크"],
    valueType: "string",
    examples: ["Plain", "Weldon", "HA"],
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
  {
    field: "overallLengthMm",
    label: "전장 (OAL)",
    description: "공구 전체 길이. '전체 길이', '전장', 'OAL' 등으로 표현. 단위 mm.",
    allowedOps: ["eq", "neq", "gte", "lte", "between"],
    aliases: ["전장", "전체 길이", "전체길이", "총길이", "OAL", "오버롤"],
    valueType: "number",
    examples: ["100", "80", "≥100", "≤80"],
  },
  {
    field: "lengthOfCutMm",
    label: "날장 (LOC / CL)",
    description: "절삭 가능한 날 부분 길이. '날장', '절삭 길이', 'LOC', 'CL' 등. 단위 mm.",
    allowedOps: ["eq", "neq", "gte", "lte", "between"],
    aliases: ["날장", "절삭 길이", "절삭길이", "날 길이", "LOC", "CL"],
    valueType: "number",
    examples: ["20", "30", "≥20"],
  },
  {
    field: "shankDiameterMm",
    label: "샹크 직경",
    description: "공구 자루(샹크) 직경. '샹크 직경', '생크 직경'. 단위 mm.",
    allowedOps: ["eq", "neq", "gte", "lte", "between"],
    aliases: ["샹크 직경", "생크 직경", "샹크직경", "shank diameter"],
    valueType: "number",
    examples: ["6", "10", "6~10"],
  },
  {
    field: "helixAngleDeg",
    label: "헬릭스 각도",
    description: "나선 각도. '헬릭스', '나선각'. 단위 도(°).",
    allowedOps: ["eq", "neq", "gte", "lte", "between"],
    aliases: ["헬릭스", "헬릭스각", "나선각", "helix"],
    valueType: "number",
    examples: ["30", "45", "≥45"],
  },
  {
    field: "coolantHole",
    label: "쿨런트홀",
    description: "냉각유 통공 유무. '쿨런트홀', '쿨런트', 'coolant hole'. true/false.",
    allowedOps: ["eq", "neq"],
    aliases: ["쿨런트홀", "쿨런트", "냉각수공", "coolant hole"],
    valueType: "string",
    examples: ["true", "false"],
  },
  {
    field: "pointAngleDeg",
    label: "드릴 포인트 각도",
    description: "드릴 팁 포인트 각도(°). '포인트 각도', '드릴 각도', 'point angle'. 홀메이킹 전용.",
    allowedOps: ["eq", "neq", "gte", "lte", "between"],
    aliases: ["포인트 각도", "드릴 각도", "point angle", "드릴 포인트"],
    valueType: "number",
    examples: ["118", "140", "≥135"],
  },
  {
    field: "threadPitchMm",
    label: "나사 피치",
    description: "탭/나사 가공의 피치(mm). '피치', 'pitch', 'P1.5', 'M10 P1.5'. 쓰레딩 전용.",
    allowedOps: ["eq", "neq", "gte", "lte", "between"],
    aliases: ["피치", "pitch", "나사 피치"],
    valueType: "number",
    examples: ["1.5", "1.0", "0.5"],
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
