const SEMANTIC_MUTATION_CUE_RE =
  /(?:\uB9D0\uACE0|\uBE7C\uACE0|\uC81C\uC678|\uC544\uB2CC(?:\s*\uAC70)?|\uC54A\uC740|\uC544\uB2C8\uACE0|\uB300\uC2E0|instead|alternative|\uB2E4\uB978\s*\uAC70|\uB2E4\uB978\uAC70|\uBCC0\uACBD|\uBC14\uAFD4|switch|replace|\bnot\b|except|without|exclude|other\s+than)/iu

const SEMANTIC_COMPARISON_CUE_RE =
  /(?:\uBE44\uAD50\s*(?:\uD574|\uD558|\uD574\uC918|\uD574\uC8FC\uC138\uC694)?|\uCC28\uC774(?:\uC810)?|\uBB50\uAC00\s*\uB2E4\uB974|vs\.?|compare|difference|different\s+from)/iu

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
