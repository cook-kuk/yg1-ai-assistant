/**
 * ML 시그니처 — 실제 프로덕션 엔드포인트가 따라야 하는 타입 계약.
 * mock-data-engine.ts 의 mock* 함수들이 반환하는 Output 타입과
 * 100% 호환되도록 유지 (교체 시 UI 변경 0).
 *
 * TODO: PRODUCTION — 실제 엔드포인트 호출 로직으로 감싸서 이 타입을 반환.
 */

export type MLEndpointPath =
  | "/api/ml/tool-life-predict"
  | "/api/ml/uncertainty"
  | "/api/ml/personalize"
  | "/api/ml/shap"
  | "/api/sensors/stream"

export interface MLRequestMeta {
  requestId: string
  timestamp: number
  factoryId?: string
  userId?: string
}

export interface MLResponseMeta {
  modelVersion: string
  trainingDataSize: number
  inferenceMs?: number
  isDemoData: boolean
}

// Re-export types from mock-data-engine so downstream imports can pick one
// location without caring whether they hit the demo engine or the real API.
export type {
  ToolLifePredictInput,
  ToolLifePredictOutput,
  BayesianUncertaintyOutput,
  SensorFrame,
  PersonalizationInput,
  PersonalizationOutput,
  ShapData,
  DoEDesign,
  DoEExperiment,
  DoEFactor,
  SurvivalCurve,
} from "./mock-data-engine"
