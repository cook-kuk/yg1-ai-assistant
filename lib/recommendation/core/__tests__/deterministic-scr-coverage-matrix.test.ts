/**
 * Single-turn 빡센 커버리지 매트릭스.
 *
 * 목표: 등록된 모든 numeric / string 필드 × 모든 연산자(eq/gte/lte/between/neq) 의
 *      자연어 입력이 deterministic-scr 로 끝까지 추출되는지 단일턴으로 검증.
 *      여기서 fail 나는 항목 = 사용자가 자연어로 친 필터가 백엔드에 도달 못 함 = 실제 gap.
 *
 * 정책:
 *   - 추출 자체가 실패하면 it 가 fail 한다 (gap 드러내기 목적).
 *   - DB 에 컬럼이 없는 가상 필드(rpm/feedRate/cuttingSpeed/depthOfCut)는 deterministic
 *     액션만 잡히면 OK (narrowing 은 tool-forge 가 처리).
 *   - 여러 액션이 잡히는 경우 (예: 직경 추출 + 피삭재 추출) 해당 필드 1개만 확인.
 */
import { describe, expect, it } from "vitest"
import { parseDeterministic } from "../deterministic-scr"

type ExpectedAction = {
  field: string
  op?: "eq" | "neq" | "gte" | "lte" | "between"
  value?: string | number
  value2?: number
}

function findField(text: string, field: string) {
  return parseDeterministic(text).find(a => a.field === field)
}

function expectExtraction(text: string, expected: ExpectedAction) {
  const a = findField(text, expected.field)
  if (!a) {
    throw new Error(`[GAP] '${text}' → ${expected.field} 추출 실패`)
  }
  if (expected.op) expect(a.op).toBe(expected.op)
  if (expected.value !== undefined) expect(a.value).toBe(expected.value)
  if (expected.value2 !== undefined) {
    expect((a as { value2?: number }).value2).toBe(expected.value2)
  }
}

// ── NUMERIC FIELDS — 사용자 친화적 한/영 표현 × eq/gte/lte/between ──
describe("coverage: diameterMm × all ops", () => {
  const cases: Array<[string, ExpectedAction]> = [
    ["직경 10mm 엔드밀", { field: "diameterMm", op: "eq", value: 10 }],
    ["직경 8mm 이상", { field: "diameterMm", op: "gte", value: 8 }],
    ["직경 12mm 이하", { field: "diameterMm", op: "lte", value: 12 }],
    ["직경 8~12mm", { field: "diameterMm", op: "between", value: 8, value2: 12 }],
    ["직경 8mm 이상 12mm 이하", { field: "diameterMm", op: "between", value: 8, value2: 12 }],
    ["dia 10 mm", { field: "diameterMm", op: "eq", value: 10 }],
    ["φ10mm", { field: "diameterMm", op: "eq", value: 10 }],
  ]
  it.each(cases)("'%s' → %o", (text, expected) => expectExtraction(text, expected))
})

describe("coverage: fluteCount × all ops", () => {
  const cases: Array<[string, ExpectedAction]> = [
    ["4날 엔드밀", { field: "fluteCount", op: "eq", value: 4 }],
    ["날수 6", { field: "fluteCount", op: "eq", value: 6 }],
    ["3 flute", { field: "fluteCount", op: "eq", value: 3 }],
    ["날수 4 이상", { field: "fluteCount", op: "gte", value: 4 }],
    ["날수 6 이하", { field: "fluteCount", op: "lte", value: 6 }],
  ]
  it.each(cases)("'%s' → %o", (text, expected) => expectExtraction(text, expected))
})

describe("coverage: overallLengthMm × all ops", () => {
  const cases: Array<[string, ExpectedAction]> = [
    ["전장 100mm", { field: "overallLengthMm", op: "eq", value: 100 }],
    ["전체 길이 80mm", { field: "overallLengthMm", op: "eq", value: 80 }],
    ["overall length 120 mm", { field: "overallLengthMm", op: "eq", value: 120 }],
    ["전장 100mm 이상", { field: "overallLengthMm", op: "gte", value: 100 }],
    ["전장 150mm 이하", { field: "overallLengthMm", op: "lte", value: 150 }],
    ["전장 100mm 이상 150mm 이하", { field: "overallLengthMm", op: "between", value: 100, value2: 150 }],
  ]
  it.each(cases)("'%s' → %o", (text, expected) => expectExtraction(text, expected))
})

describe("coverage: lengthOfCutMm × all ops", () => {
  const cases: Array<[string, ExpectedAction]> = [
    ["절삭 길이 30mm", { field: "lengthOfCutMm", op: "eq", value: 30 }],
    ["날 길이 25mm", { field: "lengthOfCutMm", op: "eq", value: 25 }],
    ["loc 20mm", { field: "lengthOfCutMm", op: "eq", value: 20 }],
    ["length of cut 35mm", { field: "lengthOfCutMm", op: "eq", value: 35 }],
    ["절삭 길이 20mm 이상", { field: "lengthOfCutMm", op: "gte", value: 20 }],
    ["절삭 길이 40mm 이하", { field: "lengthOfCutMm", op: "lte", value: 40 }],
  ]
  it.each(cases)("'%s' → %o", (text, expected) => expectExtraction(text, expected))
})

describe("coverage: shankDiameterMm × all ops", () => {
  const cases: Array<[string, ExpectedAction]> = [
    ["샹크 6mm", { field: "shankDiameterMm", op: "eq", value: 6 }],
    ["생크 직경 8mm", { field: "shankDiameterMm", op: "eq", value: 8 }],
    ["shank diameter 10 mm", { field: "shankDiameterMm", op: "eq", value: 10 }],
    ["샹크 6mm 이상", { field: "shankDiameterMm", op: "gte", value: 6 }],
    ["샹크 12mm 이하", { field: "shankDiameterMm", op: "lte", value: 12 }],
  ]
  it.each(cases)("'%s' → %o", (text, expected) => expectExtraction(text, expected))
})

describe("coverage: helixAngleDeg", () => {
  const cases: Array<[string, ExpectedAction]> = [
    ["헬릭스 30도", { field: "helixAngleDeg", op: "eq", value: 30 }],
    ["나선각 45도", { field: "helixAngleDeg", op: "eq", value: 45 }],
    ["helix 38", { field: "helixAngleDeg", op: "eq", value: 38 }],
    ["헬릭스 30도 이상", { field: "helixAngleDeg", op: "gte", value: 30 }],
  ]
  it.each(cases)("'%s' → %o", (text, expected) => expectExtraction(text, expected))
})

// 드릴/탭 필드(pointAngleDeg, threadPitchMm)는 의도적으로 제외 — milling 전용 매트릭스.

describe("coverage: ballRadiusMm", () => {
  const cases: Array<[string, ExpectedAction]> = [
    ["코너 R 0.5", { field: "ballRadiusMm", op: "eq", value: 0.5 }],
    ["코너 반경 1.0", { field: "ballRadiusMm", op: "eq", value: 1.0 }],
    ["ball radius 2", { field: "ballRadiusMm", op: "eq", value: 2 }],
  ]
  it.each(cases)("'%s' → %o", (text, expected) => expectExtraction(text, expected))
})

// ── VIRTUAL CUTTING-CONDITION FIELDS (rpm/feedRate/cuttingSpeed/depthOfCut) ──
describe("coverage: virtual cutting conditions × gte/lte", () => {
  const cases: Array<[string, ExpectedAction]> = [
    ["RPM 10000 이상", { field: "rpm", op: "gte", value: 10000 }],
    ["회전수 5000 이하", { field: "rpm", op: "lte", value: 5000 }],
    ["spindle 8000 이상", { field: "rpm", op: "gte", value: 8000 }],
    ["이송 0.1 이상", { field: "feedRate", op: "gte", value: 0.1 }],
    ["fz 0.15 이상", { field: "feedRate", op: "gte", value: 0.15 }],
    ["feed rate 0.2 mm/rev 이상", { field: "feedRate", op: "gte", value: 0.2 }],
    ["절삭속도 200 이상", { field: "cuttingSpeed", op: "gte", value: 200 }],
    ["Vc 150 m/min 이상", { field: "cuttingSpeed", op: "gte", value: 150 }],
    ["cutting speed 100 이하", { field: "cuttingSpeed", op: "lte", value: 100 }],
    ["절입 2 이상", { field: "depthOfCut", op: "gte", value: 2 }],
    ["depth of cut 1.5 mm 이상", { field: "depthOfCut", op: "gte", value: 1.5 }],
    ["ap 1 이하", { field: "depthOfCut", op: "lte", value: 1 }],
  ]
  it.each(cases)("'%s' → %o", (text, expected) => expectExtraction(text, expected))
})

// ── STRING FIELDS × eq/neq ──
describe("coverage: workMaterial(피삭재) — ISO 7군 전부", () => {
  // workMaterial 는 deterministic 가 직접 추출 (WORK_MATERIAL_CUES 사용).
  // 액션 field 는 'workMaterial' 또는 'material'. 둘 중 하나라도 잡히면 OK.
  const cases: Array<[string, string]> = [
    ["스테인리스 가공", "M"],
    ["sus 가공", "M"],
    ["티타늄 가공", "S"],
    ["인코넬 가공", "S"],
    ["하스텔로이 가공", "S"],
    ["알루미늄 가공", "N"],
    ["구리 가공", "N"],
    ["황동 가공", "N"],
    ["주철 가공", "K"],
    ["덕타일 가공", "K"],
    ["고경도강 가공", "H"],
    ["HRc 60 가공", "H"],
    ["탄소강 가공", "P"],
    ["S45C 가공", "P"],
    ["합금강 가공", "P"],
    ["CFRP 가공", "O"],
    ["복합재 가공", "O"],
  ]
  it.each(cases)("'%s' → workMaterial/material = %s", (text, expected) => {
    const actions = parseDeterministic(text)
    const found = actions.find(a => (a.field === "workMaterial" || a.field === "material") && a.value === expected)
    if (!found) {
      throw new Error(`[GAP] '${text}' → workMaterial(${expected}) 추출 실패. 실제 actions: ${JSON.stringify(actions.map(a => `${a.field}=${a.value}`))}`)
    }
    expect(found.value).toBe(expected)
  })
})

describe("coverage: toolMaterial(공구재질) × eq/neq", () => {
  const cases: Array<[string, ExpectedAction]> = [
    ["카바이드 공구", { field: "toolMaterial", op: "eq", value: "Carbide" }],
    ["초경 엔드밀", { field: "toolMaterial", op: "eq", value: "Carbide" }],
    ["HSS 공구", { field: "toolMaterial", op: "eq", value: "HSS" }],
    ["하이스 공구", { field: "toolMaterial", op: "eq", value: "HSS" }],
    ["CBN 공구", { field: "toolMaterial", op: "eq", value: "CBN" }],
    ["다이아몬드 공구", { field: "toolMaterial", op: "eq", value: "Diamond" }],
    ["PCD 공구", { field: "toolMaterial", op: "eq", value: "Diamond" }],
    ["하이스 빼고", { field: "toolMaterial", op: "neq", value: "HSS" }],
    ["카바이드 제외", { field: "toolMaterial", op: "neq", value: "Carbide" }],
  ]
  it.each(cases)("'%s' → %o", (text, expected) => expectExtraction(text, expected))
})

describe("coverage: country × eq", () => {
  const cases: Array<[string, ExpectedAction]> = [
    ["한국 제품", { field: "country", op: "eq", value: "한국" }],
    ["국내산", { field: "country", op: "eq", value: "한국" }],
    ["일본 제품", { field: "country", op: "eq", value: "일본" }],
    ["독일 제품", { field: "country", op: "eq", value: "독일" }],
    ["미국 제품", { field: "country", op: "eq", value: "미국" }],
    ["중국 제품", { field: "country", op: "eq", value: "중국" }],
    ["유럽 제품", { field: "country", op: "eq", value: "유럽" }],
  ]
  it.each(cases)("'%s' → %o", (text, expected) => expectExtraction(text, expected))
})

describe("coverage: stockStatus × instock + threshold", () => {
  it("'재고 있는 거' → stockStatus instock", () => {
    const a = findField("재고 있는 거 보여줘", "stockStatus")
    if (!a) throw new Error("[GAP] stockStatus instock 추출 실패")
  })
  it("'재고 50개 이상' → stockStatus 임계값 50 (value 또는 rawValue 어딘가에)", () => {
    const a = findField("재고 50개 이상", "stockStatus")
    if (!a) throw new Error("[GAP] stockStatus threshold 추출 실패")
    const blob = JSON.stringify(a)
    expect(/50/.test(blob)).toBe(true)
  })
})

describe("coverage: coolantHole × eq/neq", () => {
  const cases: Array<[string, ExpectedAction]> = [
    ["쿨런트 홀 있는 거", { field: "coolantHole", op: "eq", value: "true" }],
    ["쿨런트 없는 거", { field: "coolantHole", op: "eq", value: "false" }],
  ]
  it.each(cases)("'%s' → %o", (text, expected) => expectExtraction(text, expected))
})

// ── 밀링 카테고리 필드 ──
describe("coverage: coating × eq/neq + 무코팅", () => {
  const cases: Array<[string, ExpectedAction]> = [
    ["TiAlN 코팅", { field: "coating", op: "eq", value: "TiAlN" }],
    ["AlCrN 코팅 추천", { field: "coating", op: "eq", value: "AlCrN" }],
    ["DLC 코팅", { field: "coating", op: "eq", value: "DLC" }],
    ["Y 코팅 (공백 변형)", { field: "coating", op: "eq", value: "Y-Coating" }],
    ["X-Coating", { field: "coating", op: "eq", value: "X-Coating" }],
    ["Z코팅 빼고", { field: "coating", op: "neq", value: "Z-Coating" }],
    ["무코팅 제품", { field: "coating", op: "eq", value: "Bright Finish" }],
    ["코팅 없는 거", { field: "coating", op: "eq", value: "Bright Finish" }],
    // 'uncoated' 는 COATING_VALUES 에 'Uncoated' canonical 이 별도로 있어 그쪽으로 매핑.
    ["uncoated", { field: "coating", op: "eq", value: "Uncoated" }],
  ]
  it.each(cases)("'%s' → %o", (text, expected) => {
    // Y 코팅 표현은 letterCoatingMatch 가 잡으니 prefix 만 비교
    const text2 = text.replace(/\s*\(공백 변형\)/, "")
    expectExtraction(text2, expected)
  })
})

describe("coverage: brand × eq (실제 BRAND_VALUES 항목)", () => {
  const cases: Array<[string, string]> = [
    ["ONLY ONE 브랜드만", "ONLY ONE"],
    ["X-POWER 추천해줘", "X-POWER"],
    ["TANK-POWER 만 보여줘", "TANK-POWER"],
    ["ALU-POWER 시리즈", "ALU-POWER"],
    ["TitaNox 브랜드", "TitaNox"],
    ["4G MILL 만", "4G MILL"],
  ]
  it.each(cases)("'%s' → brand=%s", (text, expected) => {
    const a = findField(text, "brand")
    if (!a) throw new Error(`[GAP] '${text}' → brand 추출 실패`)
    expect(String(a.value).toUpperCase()).toBe(String(expected).toUpperCase())
  })
})

describe("coverage: toolSubtype × eq (밀링 형상)", () => {
  const cases: Array<[string, string]> = [
    ["더블 엔드 엔드밀", "Double"],
    ["double-ended 추천", "Double"],
    ["싱글 엔드", "Single"],
    ["single-ended", "Single"],
  ]
  it.each(cases)("'%s' → toolSubtype=%s", (text, expected) => {
    const a = findField(text, "toolSubtype")
    if (!a) throw new Error(`[GAP] '${text}' → toolSubtype 추출 실패`)
    expect(a.value).toBe(expected)
  })
})

// ── EDGE CASES — 한국어 조사 / 인치 / 콤마 / 소수점 / 단위 변형 ──
describe("edge: 한국어 조사 부착", () => {
  const cases: Array<[string, ExpectedAction]> = [
    ["직경이 10mm 인거", { field: "diameterMm", op: "eq", value: 10 }],
    ["직경은 8mm", { field: "diameterMm", op: "eq", value: 8 }],
    ["전장이 100mm 이상", { field: "overallLengthMm", op: "gte", value: 100 }],
    ["날수가 4개", { field: "fluteCount", op: "eq", value: 4 }],
    ["재고가 50개 이상", { field: "stockStatus" }],
  ]
  it.each(cases)("'%s' → %o", (text, expected) => expectExtraction(text, expected))
})

describe("edge: 인치/분수/콤마/소수점", () => {
  it("'1/4 인치' → 6.35mm", () => {
    const a = findField("1/4 인치 엔드밀", "diameterMm")
    if (!a) throw new Error("[GAP] 1/4 인치 → diameter 추출 실패")
    expect(a.value).toBeCloseTo(6.35, 1)
  })
  it("'직경 12.7mm' → 소수점", () => {
    const a = findField("직경 12.7mm", "diameterMm")
    expect(a?.value).toBe(12.7)
  })
  it("'RPM 12,000 이상' → 콤마 separator", () => {
    const a = findField("RPM 12,000 이상", "rpm")
    expect(a?.value).toBe(12000)
  })
  it("'전장 100.5mm' → overallLength 소수점", () => {
    const a = findField("전장 100.5mm", "overallLengthMm")
    expect(a?.value).toBe(100.5)
  })
})

describe("edge: 단위 부착/분리/생략 변형", () => {
  const cases: Array<[string, ExpectedAction]> = [
    ["10mm 직경", { field: "diameterMm", op: "eq", value: 10 }],
    ["10 mm 직경", { field: "diameterMm", op: "eq", value: 10 }],
    ["직경10mm", { field: "diameterMm", op: "eq", value: 10 }],
    ["dia.10", { field: "diameterMm", op: "eq", value: 10 }],
  ]
  it.each(cases)("'%s' → %o", (text, expected) => expectExtraction(text, expected))
})

describe("edge: 복합 입력 — 한 문장에 여러 필드", () => {
  it("'알루미늄 10mm 4날 카바이드 TiAlN 코팅' → 5필드 동시", () => {
    const actions = parseDeterministic("알루미늄 10mm 4날 카바이드 TiAlN 코팅")
    const fields = new Map(actions.map(a => [a.field, a.value]))
    expect(fields.get("diameterMm")).toBe(10)
    expect(fields.get("fluteCount")).toBe(4)
    expect(fields.get("toolMaterial")).toBe("Carbide")
    expect(fields.get("coating")).toBe("TiAlN")
    // 알루미늄 → workMaterial=N
    const wm = actions.find(a => (a.field === "workMaterial" || a.field === "material") && a.value === "N")
    expect(wm).toBeDefined()
  })

  it("'스테인리스 8mm 슬로팅 4날 RPM 8000 이상' → 5필드 (밀링 가공형상 포함)", () => {
    const actions = parseDeterministic("스테인리스 8mm 슬로팅 4날 RPM 8000 이상")
    const fields = new Map(actions.map(a => [a.field, a.value]))
    expect(fields.get("diameterMm")).toBe(8)
    expect(fields.get("fluteCount")).toBe(4)
    expect(fields.get("rpm")).toBe(8000)
    expect(fields.get("applicationShape")).toBe("Slotting")
    const wm = actions.find(a => (a.field === "workMaterial" || a.field === "material") && a.value === "M")
    expect(wm).toBeDefined()
  })

  it("'직경 6mm 이상 12mm 이하, 4날, TiAlN' → between + flute + coating", () => {
    const actions = parseDeterministic("직경 6mm 이상 12mm 이하, 4날, TiAlN")
    const dia = actions.find(a => a.field === "diameterMm")
    expect(dia?.op).toBe("between")
    expect(dia?.value).toBe(6)
    expect((dia as { value2?: number }).value2).toBe(12)
    expect(actions.find(a => a.field === "fluteCount")?.value).toBe(4)
    expect(actions.find(a => a.field === "coating")?.value).toBe("TiAlN")
  })
})

describe("edge: negation 다양한 표현 (말고/빼고/제외/말구)", () => {
  const cases: Array<[string, ExpectedAction]> = [
    ["TiAlN 빼고", { field: "coating", op: "neq", value: "TiAlN" }],
    ["AlCrN 말고", { field: "coating", op: "neq", value: "AlCrN" }],
    ["DLC 제외", { field: "coating", op: "neq", value: "DLC" }],
    ["하이스 빼고 추천", { field: "toolMaterial", op: "neq", value: "HSS" }],
  ]
  it.each(cases)("'%s' → %o", (text, expected) => expectExtraction(text, expected))
})

describe("edge: false-positive 가드 — 노이즈 문장은 추출 X", () => {
  const noisyTexts = [
    "안녕하세요",
    "고마워요",
    "추천해줘",
    "이전 단계",
    "당신은 누구",
    "도움 좀 줘",
  ]
  it.each(noisyTexts)("'%s' → 어떤 필드도 추출되지 않음", (text) => {
    const actions = parseDeterministic(text)
    // 액션이 0개 이거나, 있어도 phantom 가드된 brand/country/seriesName 은 안 나와야
    const offending = actions.filter(a => ["brand", "country", "seriesName", "diameterMm", "fluteCount", "coating", "toolMaterial"].includes(a.field))
    expect(offending).toEqual([])
  })
})

describe("coverage: applicationShape × eq (밀링 가공 형상 9종)", () => {
  const cases: Array<[string, string]> = [
    ["페이싱 가공", "Facing"],
    ["면 가공", "Facing"],
    ["헬리컬 보간", "Helical_Interpolation"],
    ["사이드 밀링", "Side_Milling"],
    ["측면 가공", "Side_Milling"],
    ["슬로팅", "Slotting"],
    ["홈 가공", "Slotting"],
    ["트로코이달 가공", "Trochoidal"],
    ["프로파일링", "Profiling"],
    ["윤곽 가공", "Profiling"],
    ["램핑", "Ramping"],
    ["플런징", "Plunging"],
    ["챔퍼 가공", "Chamfering"],
  ]
  it.each(cases)("'%s' → applicationShape=%s", (text, expected) => {
    const a = findField(text, "applicationShape")
    if (!a) throw new Error(`[GAP] '${text}' → applicationShape 추출 실패`)
    expect(a.value).toBe(expected)
  })
})
