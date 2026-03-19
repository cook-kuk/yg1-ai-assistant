export { analyzeInquiry, getRedirectResponse } from "@/lib/recommendation/domain/inquiry-analyzer"
export { buildExplanation } from "@/lib/recommendation/domain/explanation-builder"
export { runFactCheck } from "@/lib/recommendation/domain/fact-checker"
export { runHybridRetrieval, classifyHybridResults } from "@/lib/recommendation/domain/hybrid-retrieval"
export { normalizeInput } from "@/lib/recommendation/domain/input-normalizer"
export { resolveMaterialTag } from "@/lib/recommendation/domain/material-resolver"
export { buildProductLabel } from "@/lib/recommendation/domain/product-label"
export { prepareRequest } from "@/lib/recommendation/domain/request-preparation"
export { checkResolution, selectNextQuestion } from "@/lib/recommendation/domain/question-engine"
export { buildGroupSummaries, groupCandidatesBySeries } from "@/lib/recommendation/domain/series-grouper"
export {
  buildSessionState,
  carryForwardState,
  restoreOnePreviousStep,
  restoreToBeforeFilter,
} from "@/lib/recommendation/domain/session-manager"
export { buildDeterministicSummary, buildRationale, buildWarnings } from "@/lib/recommendation/domain/summary-generator"
