import type { LeadTimeRecord } from "@/lib/types/canonical"

function logDisabled(_normalizedCode: string): void {}

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
