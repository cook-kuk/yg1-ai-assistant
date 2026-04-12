import type { AppliedFilter } from "@/lib/recommendation/domain/types"

function findActiveRpmFilter(filters: AppliedFilter[]): AppliedFilter | null {
  for (let index = filters.length - 1; index >= 0; index -= 1) {
    const filter = filters[index]
    if (filter.field === "rpm" && filter.op !== "skip") return filter
  }
  return null
}

function formatRpmValue(value: unknown): string | null {
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return null
  return `${numeric.toLocaleString("ko-KR")}rpm`
}

export function buildRpmExplanationText(filters: AppliedFilter[]): string | null {
  const rpmFilter = findActiveRpmFilter(filters)
  if (!rpmFilter) return null

  const first = formatRpmValue(rpmFilter.rawValue)
  const second = formatRpmValue((rpmFilter as { rawValue2?: unknown }).rawValue2)
  if (!first) return null

  let label = first
  if (rpmFilter.op === "gte") label = `${first} 이상`
  else if (rpmFilter.op === "lte") label = `${first} 이하`
  else if (rpmFilter.op === "between" && second) label = `${first}~${second}`

  return `회전수(RPM)는 공구 직경과 절삭속도(Vc)에 따라 달라져서 같은 수치라도 공구마다 의미가 다릅니다. 지금은 카탈로그 기준으로 ${label} 조건에 맞는 후보만 먼저 추렸습니다.`
}

export function normalizeRpmPhrases(text: string): string {
  return text.replace(/RPM\s*(\d[\d,]*)\s*(이상|이하)/giu, (_match, value, suffix) => {
    const numeric = Number(String(value).replace(/,/g, ""))
    if (!Number.isFinite(numeric)) return _match
    return `회전수 ${numeric.toLocaleString("ko-KR")}rpm ${suffix}`
  })
}
