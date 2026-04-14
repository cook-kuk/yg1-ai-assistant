/**
 * Turn-level complexity routing.
 *
 * The goal is not "always reason deeply", but "spend only the reasoning budget
 * the utterance actually needs".
 */

export type ComplexityLevel = "light" | "normal" | "deep"
export type ResolverStageBudget = "stage1" | "stage2" | "stage3"
export type UiThinkingMode = "hidden" | "simple" | "full"

export interface ComplexityDecision {
  level: ComplexityLevel
  reason: string
  runSelfCorrection: boolean
  searchKB: boolean
  generateCoT: boolean
  allowWebSearch: boolean
  maxSentences: number
  resolverStageBudget: ResolverStageBudget
  allowLegacyLlmFallback: boolean
  allowToolForge: boolean
  uiThinkingMode: UiThinkingMode
}

const FAST_ACK_RE = /^(?:ok|okay|yes|yeah|네|넵|응|예|좋아|맞아|그래|고마워)$/iu
const FAST_SKIP_RE = /^(?:상관없음|아무거나|패스|skip|모름|무관)$/iu
const FAST_COUNTRY_RE = /^(?:국내|미국|일본|유럽)$/iu
const FAST_SINGLE_VALUE_RE = /^(?:square|ball|radius|taper|chamfer|spiral(?:\s+flute)?|스퀘어|볼|래디우스|테이퍼|챔퍼|나선)$/iu
const FAST_ALNUM_RE = /^[A-Za-z][\w-]*$/u
const FAST_NUMERIC_RE = /^(?:\d+(?:\.\d+)?\s*(?:mm|inch|in(?:ch)?|인치|도)(?:\s*(?:이상|이하|초과|미만))?|\d+\s*날|\d+\s*(?:개|건|ea|pcs))$/iu
const CHIP_CLICK_PATTERN = /\(\s*\d+\s*(?:개|건)\s*\)\s*$/u
const STRUCTURED_INTAKE_PATTERN = /(?:문의\s*목적|가공\s*소재|조건에\s*맞는\s*yg-1)/iu

const DEEP_NEGATION_RE = /(?:말고|빼고|제외|아니고|not\b|except|without)/iu
const DEEP_COMPARISON_RE = /(?:비교|차이|vs\b|대체품|대체|비슷한|similar|alternative|compare|difference)/iu
const DEEP_CONTEXT_RE = /(?:그거|그게|이거|이게|저거|저게|아까|방금|previous|last)/iu
const DEEP_GENERIC_RE = /(?:뭐가\s*좋|어떤\s*게|multiple\s+helix|generic|concept|개념|계열|추천해줄수\s*있)/iu
const DEEP_TROUBLE_RE = /(?:이유|원인|떨림|진동|채터|깨짐|수명|문제|에러|trouble|chatter)/iu
const DEEP_COMPETITOR_RE = /(?:sandvik|kennametal|mitsubishi|osg|walter|iscar|seco)/iu
const DEEP_SPEC_RE = /(?:pvd|cvd|iso\s*\d|규격)/iu
const DEEP_ALIAS_RE = /(?:[가-힣]{3,}\s*브랜드|[가-힣]{5,}(?:으로만|로만|만)\s*(?:보여줘|추천))/u
// Uncertainty / low-info messages — user admits they don't know key conditions
// and/or describes only a domain (aerospace/automotive/mold). These need CoT
// to drive a clarification dialog back rather than a phantom-filtered guess.
const DEEP_UNCERTAINTY_RE = /(몰라|모르|잘\s*몰|아무\s*것도|don'?t\s*know|no\s*idea|not\s*sure|처음|초보)/iu
const DEEP_DOMAIN_RE = /(에어로스페이스|항공우주|aerospace|automotive|자동차\s*산업|die\s*mold|금형\s*산업|medical\s*device|의료기기)/iu

function buildDecision(
  level: ComplexityLevel,
  reason: string,
): ComplexityDecision {
  switch (level) {
    case "light":
      return {
        level,
        reason,
        runSelfCorrection: false,
        searchKB: false,
        generateCoT: false,
        allowWebSearch: false,
        maxSentences: 2,
        resolverStageBudget: "stage1",
        allowLegacyLlmFallback: false,
        allowToolForge: false,
        uiThinkingMode: "hidden",
      }
    case "deep":
      return {
        level,
        reason,
        runSelfCorrection: true,
        searchKB: true,
        generateCoT: true,
        allowWebSearch: true,
        maxSentences: 6,
        resolverStageBudget: "stage3",
        allowLegacyLlmFallback: true,
        allowToolForge: true,
        uiThinkingMode: "full",
      }
    default:
      return {
        level: "normal",
        reason,
        runSelfCorrection: false,
        searchKB: false,
        generateCoT: false,
        allowWebSearch: false,
        maxSentences: 4,
        resolverStageBudget: "stage2",
        allowLegacyLlmFallback: false,
        allowToolForge: false,
        uiThinkingMode: "simple",
      }
  }
}

function isFastValueOnlyMessage(message: string, appliedFilterCount: number): boolean {
  const text = message.trim()
  if (!text) return false
  if (CHIP_CLICK_PATTERN.test(text)) return true
  if (STRUCTURED_INTAKE_PATTERN.test(text)) return true
  if (FAST_ACK_RE.test(text)) return true
  if (FAST_SKIP_RE.test(text)) return true
  if (FAST_COUNTRY_RE.test(text)) return true
  if (FAST_SINGLE_VALUE_RE.test(text)) return true
  if (FAST_NUMERIC_RE.test(text)) return true
  if (FAST_ALNUM_RE.test(text)) return true
  if (text.length <= 8 && appliedFilterCount > 0) return true
  return false
}

function isDeepNaturalLanguage(message: string): boolean {
  const text = message.trim()
  if (!text) return false
  if (DEEP_NEGATION_RE.test(text)) return true
  if (DEEP_COMPARISON_RE.test(text)) return true
  if (DEEP_CONTEXT_RE.test(text)) return true
  if (DEEP_GENERIC_RE.test(text)) return true
  if (DEEP_TROUBLE_RE.test(text)) return true
  if (DEEP_COMPETITOR_RE.test(text)) return true
  if (DEEP_SPEC_RE.test(text)) return true
  if (DEEP_ALIAS_RE.test(text)) return true
  if (DEEP_UNCERTAINTY_RE.test(text)) return true
  if (DEEP_DOMAIN_RE.test(text)) return true
  if (text.length >= 30) return true
  return false
}

export function assessComplexity(
  message: string,
  appliedFilterCount: number = 0,
): ComplexityDecision {
  const text = message.trim()

  if (isFastValueOnlyMessage(text, appliedFilterCount)) {
    if (CHIP_CLICK_PATTERN.test(text)) return buildDecision("light", "chip_click")
    if (STRUCTURED_INTAKE_PATTERN.test(text)) return buildDecision("light", "structured_intake")
    if (FAST_NUMERIC_RE.test(text)) return buildDecision("light", "deterministic_numeric")
    return buildDecision("light", "simple_value")
  }

  if (isDeepNaturalLanguage(text)) {
    if (DEEP_NEGATION_RE.test(text)) return buildDecision("deep", "negation")
    if (DEEP_COMPARISON_RE.test(text)) return buildDecision("deep", "comparison")
    if (DEEP_CONTEXT_RE.test(text)) return buildDecision("deep", "context_dependent")
    if (DEEP_GENERIC_RE.test(text)) return buildDecision("deep", "generic_concept")
    if (DEEP_TROUBLE_RE.test(text)) return buildDecision("deep", "troubleshooting")
    if (DEEP_UNCERTAINTY_RE.test(text)) return buildDecision("deep", "low_info_clarification")
    if (DEEP_DOMAIN_RE.test(text)) return buildDecision("deep", "domain_only")
    if (DEEP_ALIAS_RE.test(text)) return buildDecision("deep", "alias_ambiguity")
    return buildDecision("deep", "complex_natural_language")
  }

  return buildDecision("normal", "compound_recommendation")
}

export function canUseResolverStage(
  decision: ComplexityDecision | null | undefined,
  stage: ResolverStageBudget,
): boolean {
  const budget = decision?.resolverStageBudget ?? "stage3"
  if (budget === "stage3") return true
  if (budget === "stage2") return stage !== "stage3"
  return stage === "stage1"
}
