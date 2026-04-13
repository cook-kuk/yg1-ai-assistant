import { buildYG1CompanyPromptSnippet } from "@/lib/recommendation/shared/canonical-values"

/**
 * Centralized company facts for every prompt path.
 * Do not inline the same factual values elsewhere.
 */
export const YG1_COMPANY_SNIPPET = buildYG1CompanyPromptSnippet()
