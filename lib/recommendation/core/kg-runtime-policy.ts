import { isKgDisabled } from "@/lib/recommendation/runtime-flags"

export function isLegacyKgInterpreterEnabled(providerAvailable: boolean): boolean {
  if (isKgDisabled()) return false
  if (process.env.ENABLE_LEGACY_KG_INTERPRETER === "1") return true
  return !providerAvailable
}

export function isLegacyKgHintEnabled(providerAvailable: boolean): boolean {
  if (isKgDisabled()) return false
  if (process.env.ENABLE_LEGACY_KG_HINTS === "1") return true
  return isLegacyKgInterpreterEnabled(providerAvailable)
}
