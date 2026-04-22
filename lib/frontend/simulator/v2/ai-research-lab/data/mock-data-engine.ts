/**
 * Mock Data Engine — AI Research Lab DEMO 전용 가짜 데이터 생성.
 *
 * 원칙:
 *  - Seedable: 같은 입력 → 같은 출력 (재현성)
 *  - Domain-realistic: 가공 도메인 상식에 맞는 범위
 *  - Patterned: 공구/재질별 일관된 패턴
 *  - Flagged: 반환 객체에 항상 `isDemoData: true`
 *
 * TODO: PRODUCTION — 각 `mock*` 함수는 실제 ML 엔드포인트로 교체.
 * 상단 주석 블록에 @endpoint/@model/@latency/@accuracy 명시.
 */

// ─────────────────────────────────────
// Seedable PRNG (mulberry32) + string hash
// ─────────────────────────────────────

export function createRng(seed: number): () => number {
  let s = seed | 0
  return () => {
    s = (s + 0x6d2b79f5) | 0
    let t = Math.imul(s ^ (s >>> 15), 1 | s)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function hashString(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

// ═══════════════════════════════════════════════════════════════════════
// 1. 공구 수명 예측 (XGBoost mock)
// ═══════════════════════════════════════════════════════════════════════

/**
 * TODO: PRODUCTION IMPLEMENTATION
 * @endpoint POST /api/ml/tool-life-predict
 * @model    XGBoost (gradient-boosted trees)
 * @training YG-1 SpeedLab 가공 로그 (최소 10,000건)
 * @features 12개 (공구·재질·조건·기계·환경)
 * @target   실제 측정 공구 수명 (분)
 * @latency  p95 < 200ms
 * @accuracy 목표 MAPE < 15%
 */
export interface ToolLifePredictInput {
  sandvikPrediction: number
  toolCode: string
  materialKey: string
  factoryId?: string
}

export interface ToolLifePredictOutput {
  mlPrediction: number
  correction: number
  confidence: number
  lower95: number
  upper95: number
  featureImportance: Array<{
    feature: string
    importance: number
    direction: "positive" | "negative"
  }>
  metadata: {
    modelVersion: string
    trainingDataSize: number
    isDemoData: true
  }
}

export function mockToolLifePredict(input: ToolLifePredictInput): ToolLifePredictOutput {
  const seed = hashString(`${input.toolCode}_${input.materialKey}_${input.factoryId ?? "default"}`)
  const rng = createRng(seed)

  const correction = 0.85 + rng() * 0.3
  const mlPrediction = input.sandvikPrediction * correction
  const confidence = 0.7 + rng() * 0.25
  const uncertaintyWidth = (1 - confidence) * 0.4 + 0.1
  const lower95 = mlPrediction * (1 - uncertaintyWidth / 2)
  const upper95 = mlPrediction * (1 + uncertaintyWidth / 2)

  const rawImportance = [
    { feature: "쿨런트 종류", base: 0.28, direction: "positive" as const },
    { feature: "TIR (홀더)", base: 0.22, direction: "negative" as const },
    { feature: "SFM", base: 0.15, direction: "negative" as const },
    { feature: "공구 코팅", base: 0.12, direction: "positive" as const },
    { feature: "재질 경도", base: 0.1, direction: "negative" as const },
    { feature: "L/D 비율", base: 0.08, direction: "negative" as const },
    { feature: "Workholding", base: 0.05, direction: "positive" as const },
  ]

  const featureImportance = rawImportance.map(f => ({
    feature: f.feature,
    importance: f.base * (0.9 + rng() * 0.2),
    direction: f.direction,
  }))
  const sum = featureImportance.reduce((a, b) => a + b.importance, 0)
  featureImportance.forEach(f => {
    f.importance /= sum
  })

  return {
    mlPrediction,
    correction,
    confidence,
    lower95,
    upper95,
    featureImportance,
    metadata: {
      modelVersion: "demo-v0.1",
      trainingDataSize: 2000 + Math.floor(rng() * 3000),
      isDemoData: true,
    },
  }
}

// ═══════════════════════════════════════════════════════════════════════
// 2. 베이지안 불확실성 (GP Regression mock)
// ═══════════════════════════════════════════════════════════════════════

export interface BayesianUncertaintyOutput {
  mean: number
  std: number
  lower95: number
  upper95: number
  samplePoints: Array<{ x: number; density: number }>
  effectiveSamples: number
  metadata: { isDemoData: true }
}

/**
 * TODO: PRODUCTION
 * @endpoint POST /api/ml/uncertainty
 * @model    Gaussian Process Regression or MC Dropout BNN
 */
export function mockBayesianUncertainty(
  toolLifeMean: number,
  samples: number = 100,
  seed: number = 42,
): BayesianUncertaintyOutput {
  const rng = createRng(seed ^ Math.floor(toolLifeMean * 100))
  // 표준편차는 샘플 수에 반비례 (큰 샘플 → 좁은 분포)
  const baseStd = toolLifeMean * 0.18
  const std = baseStd / Math.sqrt(samples / 100)
  const lower95 = toolLifeMean - 1.96 * std
  const upper95 = toolLifeMean + 1.96 * std

  // Bell curve 샘플링 (분포 시각화용)
  const samplePoints: Array<{ x: number; density: number }> = []
  const xMin = toolLifeMean - 4 * std
  const xMax = toolLifeMean + 4 * std
  const steps = 80
  for (let i = 0; i <= steps; i++) {
    const x = xMin + (i / steps) * (xMax - xMin)
    const z = (x - toolLifeMean) / std
    const density = Math.exp(-0.5 * z * z) / (std * Math.sqrt(2 * Math.PI))
    // 작은 랜덤 노이즈로 샘플 기반 추정 흉내
    const jitter = 1 + (rng() - 0.5) * 0.05
    samplePoints.push({ x, density: density * jitter })
  }

  return {
    mean: toolLifeMean,
    std,
    lower95,
    upper95,
    samplePoints,
    effectiveSamples: samples,
    metadata: { isDemoData: true },
  }
}

// ═══════════════════════════════════════════════════════════════════════
// 3. 시계열 센서 스트림 (Fanuc FOCAS + 1D-CNN mock)
// ═══════════════════════════════════════════════════════════════════════

export interface SensorFrame {
  timestamp: number
  spindleLoadPct: number
  vibrationG: number
  temperatureC: number
  currentA: number
  anomalyScore: number
  chatterRisk: number
  predictedRUL_min: number
}

/**
 * TODO: PRODUCTION
 * @endpoint WebSocket /api/sensors/stream
 * @source   Fanuc FOCAS + MTConnect → Kafka
 * 60초치 시계열 생성. 75% 지점부터 이상 급증 (데모 효과).
 */
export function mockSensorStream(
  durationSec: number = 60,
  injectAnomaly: boolean = true,
  seed: number = 42,
): SensorFrame[] {
  const rng = createRng(seed)
  const frames: SensorFrame[] = []
  const now = Date.now()
  const frameCount = durationSec * 2 // 2 Hz

  for (let i = 0; i < frameCount; i++) {
    const t = i / 2
    const progress = t / durationSec
    const basePhase = Math.sin(t * 0.5) * 0.5 + Math.sin(t * 1.3) * 0.3
    const anomalyKick =
      injectAnomaly && progress > 0.75 ? Math.pow((progress - 0.75) / 0.25, 2) * 0.8 : 0

    const spindleLoadPct = 45 + basePhase * 8 + anomalyKick * 35 + (rng() - 0.5) * 3
    const vibrationG = 0.3 + basePhase * 0.1 + anomalyKick * 1.2 + (rng() - 0.5) * 0.05
    const temperatureC = 42 + t * 0.15 + anomalyKick * 12 + (rng() - 0.5) * 1
    const currentA = 8 + basePhase + anomalyKick * 4 + (rng() - 0.5) * 0.5
    const anomalyScore = Math.min(1, 0.1 + anomalyKick * 1.1 + (rng() - 0.5) * 0.05)
    const chatterRisk = Math.min(1, 0.15 + anomalyKick * 0.7)
    const predictedRUL_min = Math.max(0, 45 - t * 0.5 - anomalyKick * 40)

    frames.push({
      timestamp: now - durationSec * 1000 + i * 500,
      spindleLoadPct,
      vibrationG,
      temperatureC,
      currentA,
      anomalyScore,
      chatterRisk,
      predictedRUL_min,
    })
  }
  return frames
}

// ═══════════════════════════════════════════════════════════════════════
// 4. 공장 개인화 (Contextual Bandit mock)
// ═══════════════════════════════════════════════════════════════════════

export interface PersonalizationInput {
  factoryId: string
  toolCode: string
  materialKey: string
  baselineConditions: { sfm: number; ipt: number; adoc: number; rdoc: number }
}

export interface PersonalizationOutput {
  recommendedConditions: { sfm: number; ipt: number; adoc: number; rdoc: number }
  adjustmentReasons: Array<{ param: string; delta: string; reason: string }>
  expectedImprovement: { toolLife: number; mrr: number; surfaceRa: number }
  confidence: number
  historicalSampleSize: number
  isDemoData: true
}

/**
 * TODO: PRODUCTION
 * @endpoint POST /api/ml/personalize
 * @model    Contextual Bandit (LinUCB)
 */
export function mockPersonalization(input: PersonalizationInput): PersonalizationOutput {
  const seed = hashString(`${input.factoryId}_${input.toolCode}`)
  const rng = createRng(seed)
  const isConservative = rng() > 0.5

  const sfmMul = isConservative ? 0.92 + rng() * 0.05 : 1.03 + rng() * 0.05
  const iptMul = isConservative ? 0.9 + rng() * 0.08 : 1.05 + rng() * 0.05
  const b = input.baselineConditions
  const recommendedConditions = {
    sfm: b.sfm * sfmMul,
    ipt: b.ipt * iptMul,
    adoc: b.adoc,
    rdoc: b.rdoc * (isConservative ? 0.95 : 1.0),
  }

  const adjustmentReasons = [
    {
      param: "SFM",
      delta: `${sfmMul > 1 ? "+" : ""}${((sfmMul - 1) * 100).toFixed(1)}%`,
      reason: isConservative
        ? "이 공장의 과거 데이터는 보수적 SFM에서 더 높은 성공률을 보임"
        : "이 공장은 공격적 SFM 사용 가능한 기계 상태 (낮은 TIR 기록)",
    },
    {
      param: "IPT",
      delta: `${iptMul > 1 ? "+" : ""}${((iptMul - 1) * 100).toFixed(1)}%`,
      reason: isConservative
        ? "Ra 품질 우선 (과거 Ra 0.8 이하 목표 기록)"
        : "생산성 우선 (과거 MRR 최대화 기록)",
    },
  ]

  return {
    recommendedConditions,
    adjustmentReasons,
    expectedImprovement: {
      toolLife: isConservative ? 15 + rng() * 10 : -5 + rng() * 10,
      mrr: isConservative ? -8 + rng() * 5 : 12 + rng() * 8,
      surfaceRa: isConservative ? -15 + rng() * 5 : 3 + rng() * 5,
    },
    confidence: 0.65 + rng() * 0.25,
    historicalSampleSize: 200 + Math.floor(rng() * 800),
    isDemoData: true,
  }
}

// ═══════════════════════════════════════════════════════════════════════
// 5. SHAP 값 + 인과 그래프 (causal-xai mock)
// ═══════════════════════════════════════════════════════════════════════

export interface ShapData {
  baseline: number
  finalPrediction: number
  contributions: Array<{ feature: string; value: number }>
  graphNodes: Array<{ id: string; label: string; category: "input" | "mediator" | "output" }>
  graphEdges: Array<{ from: string; to: string; strength: number }>
  isDemoData: true
}

/**
 * TODO: PRODUCTION
 * @endpoint POST /api/ml/shap
 * @model    SHAP (TreeExplainer) + DoWhy
 */
export function mockShapValues(input: {
  prediction: number
  sandvikPrediction: number
  toolCode: string
}): ShapData {
  const seed = hashString(input.toolCode)
  const rng = createRng(seed)
  const baseline = input.sandvikPrediction

  const features = [
    { feature: "쿨런트 종류", base: 3.2 },
    { feature: "TIR (홀더)", base: -2.8 },
    { feature: "SFM 설정", base: -1.5 },
    { feature: "공구 코팅", base: 1.8 },
    { feature: "재질 경도", base: -0.9 },
    { feature: "L/D 비율", base: -0.7 },
  ]

  const contributions = features.map(f => ({
    feature: f.feature,
    value: f.base * (0.8 + rng() * 0.4),
  }))

  // 최종 예측과 맞추기 위한 residual 재조정
  const sumContrib = contributions.reduce((a, b) => a + b.value, 0)
  const target = input.prediction - baseline
  if (Math.abs(sumContrib) > 0.001) {
    const scale = target / sumContrib
    contributions.forEach(c => {
      c.value *= scale
    })
  }

  const graphNodes = [
    { id: "coolant", label: "쿨런트", category: "input" as const },
    { id: "tir", label: "TIR", category: "input" as const },
    { id: "sfm", label: "SFM", category: "input" as const },
    { id: "coating", label: "코팅", category: "input" as const },
    { id: "heat", label: "절삭열", category: "mediator" as const },
    { id: "vibration", label: "진동", category: "mediator" as const },
    { id: "wear", label: "공구 마모", category: "mediator" as const },
    { id: "life", label: "공구 수명", category: "output" as const },
  ]
  const graphEdges = [
    { from: "coolant", to: "heat", strength: 0.85 },
    { from: "tir", to: "vibration", strength: 0.92 },
    { from: "sfm", to: "heat", strength: 0.75 },
    { from: "coating", to: "wear", strength: 0.7 },
    { from: "heat", to: "wear", strength: 0.8 },
    { from: "vibration", to: "wear", strength: 0.65 },
    { from: "wear", to: "life", strength: 0.95 },
  ]

  return {
    baseline,
    finalPrediction: input.prediction,
    contributions,
    graphNodes,
    graphEdges,
    isDemoData: true,
  }
}

// ═══════════════════════════════════════════════════════════════════════
// 6. DOE Taguchi L9 설계
// ═══════════════════════════════════════════════════════════════════════

const L9_ARRAY: number[][] = [
  [1, 1, 1],
  [1, 2, 2],
  [1, 3, 3],
  [2, 1, 2],
  [2, 2, 3],
  [2, 3, 1],
  [3, 1, 3],
  [3, 2, 1],
  [3, 3, 2],
]

export interface DoEFactor {
  name: string
  levels: number[]
}

export interface DoEExperiment {
  id: number
  conditions: Record<string, number>
  predictedResult: {
    toolLife: number
    mrr: number
    surfaceRa: number
  }
}

export interface DoEDesign {
  method: "taguchi-l9"
  factors: string[]
  levels: Record<string, number[]>
  experiments: DoEExperiment[]
  optimalHint: Record<string, number>
  isDemoData: true
}

export function mockDoEDesign(factors: DoEFactor[], seed: number = 42): DoEDesign {
  if (factors.length !== 3 || factors.some(f => f.levels.length !== 3)) {
    throw new Error("L9 는 3 factor × 3 level 만 지원")
  }
  const rng = createRng(seed)

  const experiments: DoEExperiment[] = L9_ARRAY.map((row, i) => {
    const conditions: Record<string, number> = {}
    factors.forEach((f, j) => {
      conditions[f.name] = f.levels[row[j] - 1]
    })
    const normalizedSum = factors.reduce((acc, _, j) => acc + (row[j] - 2) * 0.1, 1.0)
    return {
      id: i + 1,
      conditions,
      predictedResult: {
        toolLife: 60 * normalizedSum * (0.9 + rng() * 0.2),
        mrr: 3.5 * normalizedSum * (0.9 + rng() * 0.2),
        surfaceRa: (0.8 / Math.max(normalizedSum, 0.6)) * (0.9 + rng() * 0.2),
      },
    }
  })

  // 간단한 S/N 최적화: 각 factor 의 수준별 평균 toolLife 가 가장 높은 수준 선택
  const optimalHint: Record<string, number> = {}
  factors.forEach((f, j) => {
    const perLevel: Record<number, number[]> = { 1: [], 2: [], 3: [] }
    L9_ARRAY.forEach((row, i) => {
      perLevel[row[j]].push(experiments[i].predictedResult.toolLife)
    })
    const avg = (arr: number[]) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0)
    const scores = [avg(perLevel[1]), avg(perLevel[2]), avg(perLevel[3])]
    const bestLevel = scores.indexOf(Math.max(...scores)) + 1
    optimalHint[f.name] = f.levels[bestLevel - 1]
  })

  return {
    method: "taguchi-l9",
    factors: factors.map(f => f.name),
    levels: Object.fromEntries(factors.map(f => [f.name, f.levels])),
    experiments,
    optimalHint,
    isDemoData: true,
  }
}

// ═══════════════════════════════════════════════════════════════════════
// 7. 생존분석 (Kaplan-Meier / Weibull mock)
// ═══════════════════════════════════════════════════════════════════════

export interface SurvivalCurve {
  points: Array<{ timeMin: number; survivalProb: number; atRisk: number; events: number }>
  median: number
  p75: number
  p25: number
  scale: number
  shape: number
  isDemoData: true
}

/**
 * Weibull S(t) = exp(-(t/λ)^k), k=2 = 마모 파손 패턴.
 */
export function mockSurvivalCurve(
  expectedLife: number,
  sampleSize: number = 200,
  seed: number = 42,
): SurvivalCurve {
  createRng(seed) // reserved — 향후 관측 노이즈 추가 시 사용
  const shape = 2
  const scale = expectedLife / Math.pow(Math.log(2), 1 / shape)

  const points: SurvivalCurve["points"] = []
  const maxTime = expectedLife * 2.5
  const step = maxTime / 100
  let atRisk = sampleSize
  for (let t = 0; t <= maxTime; t += step) {
    const survivalProb = Math.exp(-Math.pow(t / scale, shape))
    const expectedRemaining = sampleSize * survivalProb
    const events = Math.max(0, atRisk - expectedRemaining)
    atRisk = expectedRemaining
    points.push({
      timeMin: t,
      survivalProb,
      atRisk: Math.round(atRisk),
      events: Math.round(events),
    })
  }

  return {
    points,
    median: scale * Math.pow(Math.log(2), 1 / shape),
    p75: scale * Math.pow(Math.log(4 / 3), 1 / shape),
    p25: scale * Math.pow(Math.log(4), 1 / shape),
    scale,
    shape,
    isDemoData: true,
  }
}
