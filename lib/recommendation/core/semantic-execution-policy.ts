const SEMANTIC_MUTATION_CUE_RE =
  /(?:말고|빼고|제외|아닌(?:\s*거)?|않은|아니고|대신|instead|alternative|다른\s*거|다른거|변경|바꿔|switch|replace|\bnot\b|except|without|exclude|other\s+than)/iu

const SEMANTIC_COMPARISON_CUE_RE =
  /(?:비교\s*(?:해|하|해줘|해주세요)?|차이(?:점)?|뭐가\s*다르|vs\.?|compare|difference|different\s+from)/iu

export function hasSemanticMutationCue(message: string): boolean {
  return SEMANTIC_MUTATION_CUE_RE.test(message)
}

export function hasSemanticComparisonCue(message: string): boolean {
  return SEMANTIC_COMPARISON_CUE_RE.test(message)
}

export function shouldDeferHardcodedSemanticExecution(message: string): boolean {
  return hasSemanticMutationCue(message) || hasSemanticComparisonCue(message)
}

export const SEMANTIC_INTERPRETATION_POLICY_PROMPT = [
  "Semantic policy:",
  "- Deterministic hints and keyword hits are advisory only, not final truth.",
  "- Do not finalize natural-language negation, alternatives, comparison, or follow-up revision from cue words alone.",
  "- Broad cues include Korean negation / alternative / comparison words such as malgo, ppaego, jeoe, anin, daesin, bigyo, chai, and vs.",
  "- Use the full utterance and current session state to infer intent and scope.",
  "- If scope is ambiguous, prefer uncertainty over a wrong mutation. Return the best candidate and let validation decide.",
  "- If still unclear after validation, ask for clarification instead of guessing.",
].join("\n")
