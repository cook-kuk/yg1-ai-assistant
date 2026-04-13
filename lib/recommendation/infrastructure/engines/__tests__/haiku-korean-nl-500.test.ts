/**
 * 500-case Korean natural language understanding test.
 * Tests parseFieldAnswerToFilter, buildAppliedFilterFromValue, resolvePendingQuestionReply,
 * resolveExplicitRevisionRequest, resolveExplicitFilterRequest across 7 categories
 * of Korean NL input.
 *
 * Uses it.each extensively for efficiency.
 */
import { describe, expect, it } from "vitest"

import {
  resolveExplicitRevisionRequest,
  resolveExplicitFilterRequest,
  resolvePendingQuestionReply,
} from "../serve-engine-runtime"
import { getProvider } from "@/lib/recommendation/infrastructure/llm/recommendation-llm"
import {
  buildAppliedFilterFromValue,
  parseFieldAnswerToFilter,
} from "@/lib/recommendation/shared/filter-field-registry"
import type { ExplorationSessionState } from "@/lib/recommendation/domain/types"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeState(overrides: Partial<ExplorationSessionState> = {}): ExplorationSessionState {
  return {
    sessionId: "s1",
    candidateCount: 10,
    appliedFilters: [],
    narrowingHistory: [],
    stageHistory: [],
    resolutionStatus: "narrowing",
    resolvedInput: {
      manufacturerScope: "yg1-only",
      locale: "ko",
      material: "일반강",
    },
    turnCount: 1,
    displayedCandidates: [],
    displayedChips: [],
    displayedOptions: [],
    currentMode: "question",
    lastAskedField: undefined,
    ...overrides,
  } as ExplorationSessionState
}

const subtypeQuestionState = makeState({
  lastAskedField: "toolSubtype",
  displayedOptions: [
    { index: 1, label: "Square (2072개)", field: "toolSubtype", value: "Square", count: 2072 },
    { index: 2, label: "Radius (362개)", field: "toolSubtype", value: "Radius", count: 362 },
    { index: 3, label: "Ball (180개)", field: "toolSubtype", value: "Ball", count: 180 },
    { index: 4, label: "Roughing (95개)", field: "toolSubtype", value: "Roughing", count: 95 },
    { index: 5, label: "Taper (40개)", field: "toolSubtype", value: "Taper", count: 40 },
    { index: 6, label: "Chamfer (30개)", field: "toolSubtype", value: "Chamfer", count: 30 },
    { index: 7, label: "High-Feed (20개)", field: "toolSubtype", value: "High-Feed", count: 20 },
    { index: 8, label: "상관없음", field: "toolSubtype", value: "skip", count: 0 },
  ],
})

const coatingQuestionState = makeState({
  lastAskedField: "coating",
  displayedOptions: [
    { index: 1, label: "TiAlN (500개)", field: "coating", value: "TiAlN", count: 500 },
    { index: 2, label: "AlCrN (300개)", field: "coating", value: "AlCrN", count: 300 },
    { index: 3, label: "TiCN (200개)", field: "coating", value: "TiCN", count: 200 },
    { index: 4, label: "Bright Finish (50개)", field: "coating", value: "Bright Finish", count: 50 },
    { index: 5, label: "DLC (40개)", field: "coating", value: "DLC", count: 40 },
    { index: 6, label: "TiN (30개)", field: "coating", value: "TiN", count: 30 },
    { index: 7, label: "상관없음", field: "coating", value: "skip", count: 0 },
  ],
})

const diameterQuestionState = makeState({
  lastAskedField: "diameterMm",
  displayedOptions: [
    { index: 1, label: "6mm (120개)", field: "diameterMm", value: "6", count: 120 },
    { index: 2, label: "8mm (90개)", field: "diameterMm", value: "8", count: 90 },
    { index: 3, label: "10mm (60개)", field: "diameterMm", value: "10", count: 60 },
    { index: 4, label: "12mm (40개)", field: "diameterMm", value: "12", count: 40 },
    { index: 5, label: "상관없음", field: "diameterMm", value: "skip", count: 0 },
  ],
  displayedChips: ["6mm (120개)", "8mm (90개)", "10mm (60개)", "12mm (40개)", "상관없음"],
})

const fluteQuestionState = makeState({
  lastAskedField: "fluteCount",
  displayedOptions: [
    { index: 1, label: "2날 (512개)", field: "fluteCount", value: "2날", count: 512 },
    { index: 2, label: "3날 (150개)", field: "fluteCount", value: "3날", count: 150 },
    { index: 3, label: "4날 (864개)", field: "fluteCount", value: "4날", count: 864 },
    { index: 4, label: "5날 (60개)", field: "fluteCount", value: "5날", count: 60 },
    { index: 5, label: "6날 (120개)", field: "fluteCount", value: "6날", count: 120 },
    { index: 6, label: "8날 (30개)", field: "fluteCount", value: "8날", count: 30 },
    { index: 7, label: "상관없음", field: "fluteCount", value: "skip", count: 0 },
  ],
})

const provider = getProvider()

// ===========================================================================
// Part 1: 한국어 형상 표현 100가지
// Tests buildAppliedFilterFromValue (canonicalization) and parseFieldAnswerToFilter
// ===========================================================================

describe("Part 1: 한국어 형상 표현 100가지", () => {
  // ----- Group A: buildAppliedFilterFromValue (canonicalization only, 60 cases) -----
  // Tests the alias map directly — no stripLeadingFieldPhrase interference

  const canonSquare: [string, string][] = [
    ["스퀘어", "Square"],
    ["스퀘어로", "Square"],
    ["스퀘어엔드밀", "Square"],
    ["평엔드밀", "Square"],
    ["square", "Square"],
    ["SQUARE", "Square"],
    ["Square엔드밀", "Square"],
    ["스퀘어형", "Square"],
    ["스퀘어밀", "Square"],
    ["square mill", "Square"],
  ]

  const canonBall: [string, string][] = [
    ["볼", "Ball"],
    ["볼엔드밀", "Ball"],
    ["볼노즈", "Ball"],
    ["볼R", "Ball"],
    ["ball", "Ball"],
    ["BALL", "Ball"],
    ["Ball엔드밀", "Ball"],
    ["볼형", "Ball"],
    ["볼밀", "Ball"],
    ["볼날", "Ball"],
  ]

  const canonRadius: [string, string][] = [
    ["라디우스", "Radius"],
    ["코너레디우스", "Radius"],
    ["코너R", "Radius"],
    ["R엔드밀", "Radius"],
    ["radius", "Radius"],
    ["RADIUS", "Radius"],
    ["라디우스엔드밀", "Radius"],
    ["코너레디우스밀", "Radius"],
    ["cornerradius", "Radius"],
    ["코너r엔드밀", "Radius"],
  ]

  const canonRoughing: [string, string][] = [
    ["황삭", "Roughing"],
    ["러프", "Roughing"],
    ["러핑", "Roughing"],
    ["roughing", "Roughing"],
    ["ROUGHING", "Roughing"],
    ["Roughing엔드밀", "Roughing"],
    ["러핑엔드밀", "Roughing"],
    ["rough", "Roughing"],
    ["러프엔드밀", "Roughing"],
    ["황삭날", "Roughing"],
  ]

  const canonTaper: [string, string][] = [
    ["테이퍼", "Taper"],
    ["taper", "Taper"],
    ["TAPER", "Taper"],
    ["테이퍼엔드밀", "Taper"],
    ["테이퍼로", "Taper"],
    ["테이퍼날", "Taper"],
    ["테이퍼형", "Taper"],
    ["테이퍼밀", "Taper"],
    ["taper mill", "Taper"],
    ["tapering", "Taper"],
  ]

  const canonChamfer: [string, string][] = [
    ["챔퍼", "Chamfer"],
    ["chamfer", "Chamfer"],
    ["CHAMFER", "Chamfer"],
    ["챔퍼엔드밀", "Chamfer"],
    ["챔퍼밀", "Chamfer"],
    ["챔퍼형", "Chamfer"],
    ["챔퍼로", "Chamfer"],
    ["chamfering", "Chamfer"],
    ["chamfermill", "Chamfer"],
    ["챔퍼날", "Chamfer"],
  ]

  const canonHighFeed: [string, string][] = [
    ["하이피드", "High-Feed"],
    ["highfeed", "High-Feed"],
    ["하이피드엔드밀", "High-Feed"],
    ["하이피드밀", "High-Feed"],
    ["하이피드로", "High-Feed"],
    ["하이피드형", "High-Feed"],
    ["highfeedmill", "High-Feed"],
    ["HIGH FEED", "High-Feed"],
    ["HIGH-FEED", "High-Feed"],
    ["하이피드날", "High-Feed"],
  ]

  const allCanonCases = [
    ...canonSquare,
    ...canonBall,
    ...canonRadius,
    ...canonRoughing,
    ...canonTaper,
    ...canonChamfer,
    ...canonHighFeed,
  ]

  it.each(allCanonCases)(
    'buildAppliedFilterFromValue("toolSubtype", "%s") → includes %s',
    (input, expected) => {
      const filter = buildAppliedFilterFromValue("toolSubtype", input)
      expect(filter).not.toBeNull()
      expect(filter!.field).toBe("toolSubtype")
      expect(filter!.value.toLowerCase()).toContain(expected.toLowerCase())
    }
  )

  // ----- Group B: parseFieldAnswerToFilter (full pipeline with stripLeadingFieldPhrase, 40 cases) -----
  // These must survive alias stripping — use inputs that canonicalize correctly

  const parseSubtypeCases: [string, string][] = [
    // Direct alias terms (no field-phrase prefix to strip)
    ["스퀘어", "Square"],
    ["스퀘어로", "Square"],
    ["스퀘어엔드밀", "Square"],
    ["볼", "Ball"],
    ["볼엔드밀", "Ball"],
    ["라디우스", "Radius"],
    ["코너레디우스", "Radius"],
    ["황삭", "Roughing"],
    ["러핑", "Roughing"],
    ["러프", "Roughing"],
    ["테이퍼", "Taper"],
    ["챔퍼", "Chamfer"],
    ["하이피드", "High-Feed"],
    // English (not field aliases so they pass through)
    ["square", "Square"],
    ["ball", "Ball"],
    ["radius", "Radius"],
    ["roughing", "Roughing"],
    ["rough", "Roughing"],
    ["taper", "Taper"],
    ["chamfer", "Chamfer"],
    ["highfeed", "High-Feed"],
    // With Korean suffixes/particles (stripped by canonicalize)
    ["스퀘어형", "Square"],
    ["볼형", "Ball"],
    ["테이퍼형", "Taper"],
    ["챔퍼형", "Chamfer"],
    ["하이피드형", "High-Feed"],
    ["러핑엔드밀", "Roughing"],
    ["챔퍼엔드밀", "Chamfer"],
    ["테이퍼엔드밀", "Taper"],
    // Compound no-space (bypasses field alias strip)
    ["코너R", "Radius"],
    ["R엔드밀", "Radius"],
    ["볼R", "Ball"],
    ["볼노즈", "Ball"],
    ["Ball엔드밀", "Ball"],
    ["Square엔드밀", "Square"],
    ["SQUARE", "Square"],
    ["BALL", "Ball"],
    ["ROUGHING", "Roughing"],
    ["TAPER", "Taper"],
    ["CHAMFER", "Chamfer"],
    ["HIGH-FEED", "High-Feed"],
  ]

  it.each(parseSubtypeCases)(
    'parseFieldAnswerToFilter("toolSubtype", "%s") → includes %s',
    (input, expected) => {
      const filter = parseFieldAnswerToFilter("toolSubtype", input)
      expect(filter).not.toBeNull()
      expect(filter!.field).toBe("toolSubtype")
      expect(filter!.value.toLowerCase()).toContain(expected.toLowerCase())
    }
  )
})

// ===========================================================================
// Part 2: 한국어 코팅 표현 80가지 (parseFieldAnswerToFilter + buildAppliedFilterFromValue)
// ===========================================================================

describe("Part 2: 한국어 코팅 표현 80가지", () => {
  // --- TiAlN variations (12 cases) ---
  const tialnCases: [string, string][] = [
    ["TiAlN", "tialn"],
    ["tialn", "tialn"],
    ["TIALN", "tialn"],
    ["티알엔", "티알엔"],
    ["Ti-Al-N", "tialn"],
    ["TiAlN코팅", "tialn"],
    ["TiAlN 코팅", "tialn"],
    ["tialn코팅", "tialn"],
    ["TiAlN으로", "tialn"],
    ["TIALN으로", "tialn"],
    ["ti-al-n", "tialn"],
    ["TiAlN로", "tialn"],
  ]

  // --- AlCrN (10 cases) ---
  const alcrnCases: [string, string][] = [
    ["AlCrN", "alcrn"],
    ["alcrn", "alcrn"],
    ["알크롬", "알크롬"],
    ["ALCRN", "alcrn"],
    ["Al-Cr-N", "alcrn"],
    ["AlCrN코팅", "alcrn"],
    ["AlCrN으로", "alcrn"],
    ["알크롬코팅", "알크롬"],
    ["al-cr-n", "alcrn"],
    ["AlCrN 코팅", "alcrn"],
  ]

  // --- Blue (10 cases) ---
  const blueCases: [string, string][] = [
    ["블루", "blue"],
    ["블루코팅", "blue"],
    ["블루 코팅", "blue"],
    ["Blue", "blue"],
    ["blue", "blue"],
    ["BLUE", "blue"],
    ["블루로", "blue"],
    ["블루코팅으로", "blue"],
    ["blue coating", "blue"],
    ["Blue Coating", "blue"],
  ]

  // --- Gold (8 cases) ---
  const goldCases: [string, string][] = [
    ["골드", "gold"],
    ["골드코팅", "tin"],
    ["Gold", "gold"],
    ["TiN", "tin"],
    ["tin", "tin"],
    ["골드 코팅", "tin"],
    ["골드로", "gold"],
    ["TiN코팅", "tin"],
  ]

  // --- Black (6 cases) ---
  const blackCases: [string, string][] = [
    ["블랙", "black"],
    ["블랙코팅", "tialn"],
    ["블랙 코팅", "tialn"],
    ["BLACK", "black"],
    ["black", "black"],
    ["블랙으로", "black"],
  ]

  // --- Uncoated (12 cases) ---
  const uncoatedCases: [string, string][] = [
    ["무코팅", "uncoated"],
    ["비코팅", "uncoated"],
    ["코팅없음", "uncoated"],
    ["uncoated", "uncoated"],
    ["Bright Finish", "bright"],
    ["실버", "bright"],
    ["Uncoated", "uncoated"],
    ["UNCOATED", "uncoated"],
    ["무코팅으로", "uncoated"],
    ["비코팅으로", "uncoated"],
    ["실버코팅", "bright"],
    ["bright finish", "bright"],
  ]

  // --- DLC (8 cases) ---
  const dlcCases: [string, string][] = [
    ["DLC", "dlc"],
    ["dlc", "dlc"],
    ["다이아몬드", "diamond"],
    ["Diamond", "diamond"],
    ["다이아몬드코팅", "diamond"],
    ["DLC코팅", "dlc"],
    ["dlc코팅", "dlc"],
    ["diamond", "diamond"],
  ]

  // --- Others (14 cases) ---
  const otherCases: [string, string][] = [
    ["TiCN", "ticn"],
    ["AlTiN", "altin"],
    ["ticn", "ticn"],
    ["altin", "altin"],
    ["TiCN으로", "ticn"],
    ["AlTiN코팅", "altin"],
    ["TICN", "ticn"],
    ["ALTIN", "altin"],
    ["Al-Ti-N", "altin"],
    ["Ti-C-N", "ticn"],
    ["Steam Homo", "steam"],
    ["steam homo", "steam"],
    ["XCoating", "x-coating"],
    ["YCoating", "y-coating"],
  ]

  const allCoatingCases = [
    ...tialnCases,
    ...alcrnCases,
    ...blueCases,
    ...goldCases,
    ...blackCases,
    ...uncoatedCases,
    ...dlcCases,
    ...otherCases,
  ]

  it.each(allCoatingCases)(
    'parseFieldAnswerToFilter("coating", "%s") → value includes "%s"',
    (input, expectedFragment) => {
      const filter = parseFieldAnswerToFilter("coating", input)
      expect(filter).not.toBeNull()
      expect(filter!.field).toBe("coating")
      expect(filter!.value.toLowerCase()).toContain(expectedFragment.toLowerCase())
    }
  )
})

// ===========================================================================
// Part 3: 한국어 직경 표현 80가지 (parseFieldAnswerToFilter)
// ===========================================================================

describe("Part 3: 한국어 직경 표현 80가지", () => {
  // --- mm variations (14 cases) ---
  const mmCases: [string, number][] = [
    ["10mm", 10],
    ["10MM", 10],
    ["10 mm", 10],
    ["10.0mm", 10],
    ["10밀리", 10],
    ["10미리", 10],
    ["6mm", 6],
    ["6.0mm", 6],
    ["8mm", 8],
    ["12mm", 12],
    ["16mm", 16],
    ["20mm", 20],
    ["3mm", 3],
    ["25mm", 25],
  ]

  // --- phi (10 cases) ---
  const phiCases: [string, number][] = [
    ["φ10", 10],
    ["Φ10", 10],
    ["파이10", 10],
    ["파이 10", 10],
    ["φ6", 6],
    ["Φ8", 8],
    ["파이12", 12],
    ["φ16", 16],
    ["파이 6", 6],
    ["Φ20", 20],
  ]

  // --- inch (14 cases) ---
  const inchCases: [string, number][] = [
    ['3/8"', 9.525],
    ['1/2"', 12.7],
    ['3/4"', 19.05],
    ['1/4"', 6.35],
    ["3/8인치", 9.525],
    ["5/16인치", 7.9375],
    ["1/4 inch", 6.35],
    ["3/8 inch", 9.525],
    ["1/2 inch", 12.7],
    ['5/16"', 7.9375],
    ['1/8"', 3.175],
    ['3/16"', 4.7625],
    ["1/4인치", 6.35],
    ["1/2인치", 12.7],
  ]

  // --- approximate (12 cases) ---
  const approxCases: [string, number][] = [
    ["약 10mm", 10],
    ["한 10mm쯤", 10],
    ["10mm정도", 10],
    ["10mm입니다", 10],
    ["약 6mm", 6],
    ["한 8mm쯤", 8],
    ["12mm정도", 12],
    ["약 16mm", 16],
    ["한 20mm쯤", 20],
    ["6mm입니다", 6],
    ["약 3mm", 3],
    ["한 25mm쯤", 25],
  ]

  // --- bare numbers (10 cases) ---
  const bareCases: [string, number][] = [
    ["10", 10],
    ["10.0", 10],
    ["6.35", 6.35],
    ["6", 6],
    ["8", 8],
    ["12", 12],
    ["16", 16],
    ["20", 20],
    ["3", 3],
    ["25", 25],
  ]

  // --- with units/prefix (20 cases) ---
  const unitPrefixCases: [string, number][] = [
    ["직경 10mm", 10],
    ["지름 10", 10],
    ["dia 10", 10],
    ["D10", 10],
    ["직경 6mm", 6],
    ["지름 8", 8],
    ["dia 12", 12],
    ["D16", 16],
    ["직경 20mm", 20],
    ["지름 6.35", 6.35],
    ["dia 8", 8],
    ["D6", 6],
    ["직경 3mm", 3],
    ["지름 25", 25],
    ["dia 16", 16],
    ["D20", 20],
    ["직경 12", 12],
    ["diameter 10", 10],
    ["지름 3mm", 3],
    ["dia 25", 25],
  ]

  const allDiameterCases = [
    ...mmCases,
    ...phiCases,
    ...inchCases,
    ...approxCases,
    ...bareCases,
    ...unitPrefixCases,
  ]

  it.each(allDiameterCases)(
    'parseFieldAnswerToFilter("diameterMm", "%s") → rawValue ≈ %d',
    (input, expected) => {
      const filter = parseFieldAnswerToFilter("diameterMm", input)
      expect(filter).not.toBeNull()
      expect(filter!.field).toBe("diameterMm")
      const raw = typeof filter!.rawValue === "number" ? filter!.rawValue : Number(filter!.rawValue)
      expect(raw).toBeCloseTo(expected, 1)
    }
  )
})

// ===========================================================================
// Part 4: 한국어 날수 표현 60가지 (parseFieldAnswerToFilter)
// ===========================================================================

describe("Part 4: 한국어 날수 표현 60가지", () => {
  const fluteCases: [string, number][] = [
    // 2날 variations (12)
    ["2날", 2],
    ["2 날", 2],
    ["2날이요", 2],
    ["2날로", 2],
    ["2플루트", 2],
    ["2 flute", 2],
    ["two flute", 2],
    ["2F", 2],
    ["날 2개", 2],
    ["날수 2개", 2],
    ["flute 2", 2],
    ["F2", 2],

    // 3날 variations (8)
    ["3날", 3],
    ["3 날", 3],
    ["3날이요", 3],
    ["3플루트", 3],
    ["three flute", 3],
    ["3F", 3],
    ["날 3개", 3],
    ["flute 3", 3],

    // 4날 variations (10)
    ["4날", 4],
    ["4 날", 4],
    ["4날이요", 4],
    ["4날로", 4],
    ["4플루트", 4],
    ["4 flute", 4],
    ["four flute", 4],
    ["4F", 4],
    ["날 4개", 4],
    ["flute 4", 4],

    // 5날 variations (6)
    ["5날", 5],
    ["5 날", 5],
    ["5플루트", 5],
    ["five flute", 5],
    ["5F", 5],
    ["날 5개", 5],

    // 6날 variations (8)
    ["6날", 6],
    ["6 날", 6],
    ["6날이요", 6],
    ["6플루트", 6],
    ["six flute", 6],
    ["6F", 6],
    ["날 6개", 6],
    ["flute 6", 6],

    // 8날 variations (6)
    ["8날", 8],
    ["8 날", 8],
    ["8플루트", 8],
    ["eight flute", 8],
    ["8F", 8],
    ["날 8개", 8],

    // Additional mixed (10)
    ["2", 2],
    ["4", 4],
    ["6", 6],
    ["3날로 해줘", 3],
    ["4날 엔드밀", 4],
    ["2날짜리", 2],
    ["6날짜리", 6],
    ["10날", 10],
    ["ten flute", 10],
    ["10F", 10],
  ]

  it.each(fluteCases)(
    'parseFieldAnswerToFilter("fluteCount", "%s") → rawValue = %d',
    (input, expected) => {
      const filter = parseFieldAnswerToFilter("fluteCount", input)
      expect(filter).not.toBeNull()
      expect(filter!.field).toBe("fluteCount")
      const raw = typeof filter!.rawValue === "number" ? filter!.rawValue : Number(filter!.rawValue)
      expect(raw).toBe(expected)
    }
  )
})

// ===========================================================================
// Part 5: skip/위임 표현 60가지 (resolvePendingQuestionReply)
// ===========================================================================

describe("Part 5: skip/위임 표현 60가지", () => {
  // --- Group A: Direct skip tokens matched via displayed option "상관없음" (15 cases) ---
  const skipTokenCases: [string][] = [
    ["상관없음"],
    ["상관 없음"],
    ["모름"],
    ["skip"],
    ["아무거나"],
    ["아무거나요"],
    ["패스"],
    ["스킵"],
    ["넘어가"],
    ["넘어가줘"],
    ["넘어갈게"],
    ["모르겠어"],
    ["모르겠어요"],
    ["다괜찮아"],
    ["뭐든상관없어"],
  ]

  it.each(skipTokenCases)(
    'resolvePendingQuestionReply(subtypeState, "%s") → resolved (skip option match)',
    (input) => {
      const result = resolvePendingQuestionReply(subtypeQuestionState, input)
      expect(result.kind).not.toBe("unresolved")
    }
  )

  // --- Group B: Delegation expressions (regex match → skip) (15 cases) ---
  const delegationCases: [string][] = [
    ["알아서 해줘"],
    ["너가 골라"],
    ["추천해줘"],
    ["추천으로 골라줘"],
    ["그냥 추천해"],
    ["아무거나 한개"],
    ["니가 골라줘"],
    ["알아서 추천해"],
    ["하나만 골라줘"],
    ["추천해"],
    ["너가 골라줘"],
    ["알아서 해"],
    ["아무거나 하나만"],
    ["니가 추천해줘"],
    ["알아서 골라줘"],
  ]

  it.each(delegationCases)(
    'resolvePendingQuestionReply(subtypeState, "%s") → resolved as delegation/skip',
    (input) => {
      const result = resolvePendingQuestionReply(subtypeQuestionState, input)
      expect(result.kind).toBe("resolved")
      if (result.kind === "resolved") {
        expect(result.filter.op).toBe("skip")
      }
    }
  )

  // --- Group C: Skip tokens across different question states (30 cases) ---
  // Only tokens that are in SKIP_TOKENS set or matched by delegation regex
  const crossStateSkipCases: [string, ExplorationSessionState][] = [
    ["상관없음", coatingQuestionState],
    ["상관 없음", fluteQuestionState],
    ["모름", diameterQuestionState],
    ["skip", coatingQuestionState],
    ["패스", fluteQuestionState],
    ["스킵", diameterQuestionState],
    ["넘어가", coatingQuestionState],
    ["넘어가줘", fluteQuestionState],
    ["넘어갈게", diameterQuestionState],
    ["모르겠어", coatingQuestionState],
    ["모르겠어요", fluteQuestionState],
    ["아무거나", diameterQuestionState],
    ["아무거나요", coatingQuestionState],
    ["다괜찮아", fluteQuestionState],
    ["뭐든상관없어", diameterQuestionState],
    // Delegation expressions across states
    ["추천해줘", coatingQuestionState],
    ["알아서 해줘", fluteQuestionState],
    ["너가 골라", diameterQuestionState],
    ["추천으로 골라줘", coatingQuestionState],
    ["그냥 추천해", fluteQuestionState],
    ["아무거나 한개", diameterQuestionState],
    ["추천해", coatingQuestionState],
    ["알아서 해", fluteQuestionState],
    ["너가 골라줘", diameterQuestionState],
    ["하나만 골라줘", coatingQuestionState],
    ["니가 골라줘", fluteQuestionState],
    ["알아서 추천해", diameterQuestionState],
    ["니가 추천해줘", coatingQuestionState],
    ["아무거나 하나만", fluteQuestionState],
    ["알아서 골라줘", diameterQuestionState],
  ]

  it.each(crossStateSkipCases)(
    'resolvePendingQuestionReply(state, "%s") → resolved (skip/delegation)',
    (input, state) => {
      const result = resolvePendingQuestionReply(state, input)
      expect(result.kind).toBe("resolved")
    }
  )
})

// ===========================================================================
// Part 6: side question 표현 60가지 (resolvePendingQuestionReply)
// ===========================================================================

describe("Part 6: side question 표현 60가지", () => {
  // Group A: question-mark terminated (always side_question due to /[?？]/ check) (15 cases)
  const questionMarkCases: [string][] = [
    ["이게 뭐야?"],
    ["뭔가요?"],
    ["왜?"],
    ["뭐가 다른가요?"],
    ["어떤 게 좋은가요?"],
    ["이건 뭐죠?"],
    ["왜 그런거죠?"],
    ["뭘 써야 하나요?"],
    ["어떤 게 좋아?"],
    ["재고 있어?"],
    ["가격이 얼마야?"],
    ["stock 있어?"],
    ["이게 뭐죠?"],
    ["얼마인가요?"],
    ["차이가 뭐야?"],
  ]

  it.each(questionMarkCases)(
    'resolvePendingQuestionReply(subtypeState, "%s") → side_question (question mark)',
    (input) => {
      const result = resolvePendingQuestionReply(subtypeQuestionState, input)
      expect(result.kind).toBe("side_question")
    }
  )

  // Group B: keyword-matched side questions (matched by regex in resolvePendingQuestionReply) (45 cases)
  const keywordSideQuestionCases: [string][] = [
    // 설명/정보 요청
    ["설명해줘"],
    ["설명 좀"],
    ["차이 알려줘"],
    ["종류별 차이"],
    ["어떻게 다른 거야"],
    ["뭐야 이게"],
    ["알려줘 이거"],

    // 재고/납기
    ["재고 몇개"],
    ["납기 얼마나"],
    ["재고 확인해줘"],
    ["리드타임 알려줘"],
    ["배송 알려줘"],
    ["납기일 궁금"],
    ["리드 타임"],

    // 가격
    ["가격 알려줘"],
    ["가격 비교"],
    ["price 알려줘"],

    // 회사/영업소
    ["영업소 번호"],
    ["부산 지점"],
    ["회사 연락처"],
    ["영업소 알려줘"],
    ["공장 어디"],
    ["지점 정보"],
    ["연락처 알려줘"],
    ["사우디 지점"],

    // 비교
    ["1번 2번 비교"],
    ["비교 결과"],

    // 도메인 질문
    ["스펙 알려줘"],
    ["카탈로그 궁금"],
    ["적합한 소재"],

    // Navigation
    ["처음부터 다시"],
    ["이전 단계로"],
    ["결과 보여줘"],

    // 기타
    ["해외 공장"],
    ["국가별 지점"],
    ["매출 알려줘"],
    ["궁금한 게 있어"],
    ["정보 알려줘"],

    // More keywords
    ["왜 그런 거야"],
    ["뭐야 이 종류"],
    ["도시 알려줘"],
    ["사우디 영업소"],
    ["어디서 생산"],
    ["재고 상황"],
    ["stock 알려줘"],
    ["inventory 알려줘"],
  ]

  it.each(keywordSideQuestionCases)(
    'resolvePendingQuestionReply(subtypeState, "%s") → side_question (keyword match)',
    (input) => {
      const result = resolvePendingQuestionReply(subtypeQuestionState, input)
      expect(result.kind).toBe("side_question")
    }
  )
})

// ===========================================================================
// Part 7: revision signal 표현 60가지 (resolvePendingQuestionReply → unresolved)
// ===========================================================================

describe("Part 7: revision signal 표현 60가지", () => {
  // When a pending question is active, revision signals yield "unresolved"
  // so that the revision resolver handles them downstream.
  // Note: inputs with "?" are classified as side_question first, so exclude those.

  const revisionCases: [string][] = [
    // 말고 (instead of)
    ["스퀘어 말고"],
    ["볼 말고 라디우스"],
    ["TiAlN 말고"],
    ["4날 말고 2날"],
    ["이거 말고"],
    ["지금꺼 말고"],

    // 대신 (instead)
    ["스퀘어 대신 볼"],
    ["TiAlN 대신 AlCrN"],
    ["4날 대신 2날"],
    ["이것 대신"],
    ["현재꺼 대신"],

    // 변경 (change)
    ["형상 변경"],
    ["코팅 변경해줘"],
    ["날수 변경"],
    ["직경 변경할래"],
    ["형상을 변경하고 싶어"],
    ["코팅을 변경해주세요"],

    // 바꿔/바꿀 (switch)
    ["스퀘어로 바꿔"],
    ["코팅 바꿔줘"],
    ["날수 바꿀게"],
    ["형상 바꿔"],
    ["바꿔줘"],
    ["바꿀래"],

    // 수정 (modify)
    ["코팅 수정"],
    ["형상 수정해줘"],
    ["수정하고 싶어"],
    ["수정해주세요"],
    ["날수 수정"],

    // 아니고/아닌/아니라 (not X but Y)
    ["스퀘어 아니고 볼"],
    ["TiAlN 아니고"],
    ["4날 아닌 2날"],
    ["이거 아니라 저거"],
    ["이거 아니고"],
    ["아니고 다른 거"],

    // English expressions
    ["switch to ball"],
    ["change to radius"],
    ["instead of square"],
    ["replace with ball"],
    ["switch to TiAlN"],
    ["change to 4 flute"],

    // Internet slang
    ["ㄴㄴ 스퀘어"],
    ["ㄴㄴ 볼로"],
    ["ㄴㄴ 다시"],

    // Compound expressions (no question marks to avoid side_question trigger)
    ["코팅을 수정하고 싶어"],
    ["형상 변경할래"],
    ["날수를 바꿀게요"],
    ["직경을 변경해주세요"],
    ["코팅 말고 다른 걸로"],
    ["형상을 바꿔주세요"],
    ["날수 대신 다른 거"],
    ["이전 선택 바꿀래"],
    ["아까 선택 수정"],
    ["다시 바꿔줘"],
    ["수정하고 싶은데"],
    ["코팅 대신 무코팅"],
    ["스퀘어 말고 볼로 바꿔"],
    ["형상 바꿀 수 있나"],
    ["코팅 바꿀 수 있나"],
  ]

  it.each(revisionCases)(
    'resolvePendingQuestionReply(subtypeState, "%s") → unresolved (revision signal)',
    (input) => {
      const result = resolvePendingQuestionReply(subtypeQuestionState, input)
      expect(result.kind).toBe("unresolved")
    }
  )
})
