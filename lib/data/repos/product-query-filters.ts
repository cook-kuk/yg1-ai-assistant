export type RequestedToolFamily = "milling" | "holemaking" | "threading"

export function resolveRequestedToolFamily(toolType: string | null | undefined): RequestedToolFamily | null {
  if (!toolType) return null
  const lower = toolType.trim().toLowerCase()

  if (
    lower.includes("엔드밀") ||
    lower.includes("end mill") ||
    lower.includes("endmill") ||
    lower.includes("밀링")
  ) {
    return "milling"
  }

  if (
    lower.includes("드릴") ||
    lower.includes("drill") ||
    lower.includes("holemaking")
  ) {
    return "holemaking"
  }

  if (
    lower.includes("탭") ||
    lower.includes("tap") ||
    lower.includes("thread")
  ) {
    return "threading"
  }

  return null
}
