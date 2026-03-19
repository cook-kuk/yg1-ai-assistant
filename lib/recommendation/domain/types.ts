export type {
  CanonicalProduct,
  ChatMessage,
  MatchStatus,
  MaterialTaxonomy,
  RecommendationInput,
  RecommendationResult,
  ScoreBreakdown,
  ScoredProduct,
} from "@/lib/types/canonical"
export type {
  AppliedFilter,
  ArchivedTask,
  CandidateSnapshot,
  CandidateCounts,
  ClarificationRecord,
  ComparisonArtifact,
  DisplayedOption,
  ExplorationSessionState,
  LastActionType,
  NarrowingStage,
  NarrowingTurn,
  RecommendationCheckpoint,
  RecommendationTask,
  ResolutionStatus,
  SeriesGroup,
  SeriesGroupSummary,
  SessionMode,
  UINarrowingPathEntry,
} from "@/lib/types/exploration"
export type {
  AnswerState,
  InquiryPurpose,
  MachiningIntent,
  ProductIntakeForm,
} from "@/lib/types/intake"
export type {
  CuttingConditions,
  EvidenceChunk,
  EvidenceSummary,
} from "@/lib/types/evidence"
export type {
  FactCheckedRecommendation,
  FactCheckReport,
  FactCheckStep,
  VerificationStatus,
  VerifiedField,
} from "@/lib/types/fact-check"
export type {
  MatchedFact,
  RecommendationExplanation,
  SupportingEvidence,
  UnmatchedFact,
} from "@/lib/types/explanation"
export type {
  CompletenessCheck,
  ExtractedSlot,
  RequestPreparationResult,
  RouteAction,
  RoutePlan,
  SessionContext,
  UndoTarget,
  UserIntent,
} from "@/lib/types/request-preparation"
export type { AppLanguage } from "@/lib/contracts/app-language"
