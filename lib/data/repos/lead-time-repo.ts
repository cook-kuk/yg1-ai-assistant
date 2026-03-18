import type { LeadTimeRecord } from "@/lib/types/canonical"

function logDisabled(normalizedCode: string): void {
  console.warn(
    `[lead-time-repo] lookup skipped code=${normalizedCode}: runtime JSON source disabled and DB source is not implemented`
  )
}

export const LeadTimeRepo = {
  getByEdp(normalizedCode: string): LeadTimeRecord[] {
    logDisabled(normalizedCode)
    return []
  },

  minLeadTime(normalizedCode: string): number | null {
    logDisabled(normalizedCode)
    return null
  },

  maxLeadTime(normalizedCode: string): number | null {
    logDisabled(normalizedCode)
    return null
  },

  representative(normalizedCode: string): number | null {
    logDisabled(normalizedCode)
    return null
  },
}
