export { getProvider } from "@/lib/shared/infrastructure/llm/llm-provider"
export { resolveModel } from "@/lib/shared/infrastructure/llm/llm-provider"
export type {
  LLMProvider,
  LLMTool,
  LLMToolResult,
  ModelSpecifier,
  ModelTier,
} from "@/lib/shared/infrastructure/llm/llm-provider"
export {
  buildExplanationResultPrompt,
  buildGreetingPrompt,
  buildRecommendationSummarySystemPrompt,
  buildSessionContext,
  buildSystemPrompt,
} from "@/lib/recommendation/infrastructure/llm/prompt-builder"
