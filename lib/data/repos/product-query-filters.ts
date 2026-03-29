export type RequestedToolFamily = "Milling" | "Holemaking" | "Threading" | "Tooling System"

export function resolveRequestedToolFamily(toolType: string | null | undefined): RequestedToolFamily | null {
  if (!toolType) return null
  const lower = toolType.trim().toLowerCase()

  if (
    lower === "tooling system" ||
    lower.includes("turning") ||
    lower.includes("turn") ||
    lower.includes("터닝") ||
    lower.includes("선삭")
  ) {
    return "Tooling System"
  }

  if (lower === "milling") return "Milling"
  if (lower === "holemaking") return "Holemaking"
  if (lower === "threading") return "Threading"

  if (
    lower.includes("엔드밀") ||
    lower.includes("end mill") ||
    lower.includes("endmill") ||
    lower.includes("밀링") ||
    lower.includes("milling")
  ) {
    return "Milling"
  }

  if (
    lower.includes("드릴") ||
    lower.includes("drill") ||
    lower.includes("holemaking")
  ) {
    return "Holemaking"
  }

  if (
    lower.includes("탭") ||
    lower.includes("tap") ||
    lower.includes("thread")
  ) {
    return "Threading"
  }

  return null
}
