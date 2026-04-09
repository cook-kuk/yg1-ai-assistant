/**
 * Domain Guard — 필터 조합의 도메인 위험을 자동 감지.
 * 10년차 엔지니어가 "잠깐, 그건 좀..." 하는 것과 같은 역할.
 * LLM 호출 없음. 순수 규칙 기반 (0ms).
 */

import type { AppliedFilter } from "@/lib/types/exploration"

export interface DomainWarning {
  level: "info" | "warn" | "danger"
  message: string
  suggestion: string
  /** 관련 필터 필드 */
  relatedField: string
}

export function checkDomainWarnings(filters: AppliedFilter[]): DomainWarning[] {
  const warnings: DomainWarning[] = []

  const getVal = (field: string) => {
    const f = filters.find(x => x.field === field)
    if (!f) return undefined
    return f.rawValue ?? f.value
  }

  const material = String(getVal("workPieceName") ?? "").toLowerCase()
  const coating = String(getVal("coating") ?? "").toLowerCase()
  const diameter = Number(getVal("diameterMm")) || 0
  const overallLength = Number(getVal("overallLengthMm")) || 0
  const fluteCount = Number(getVal("fluteCount")) || 0
  const subtype = String(getVal("toolSubtype") ?? "").toLowerCase()

  // ── 소재-코팅 부적합 경고 ──

  // DLC + 철계/고경도 소재 (내열 400°C → 600~800°C 절삭열 못 견딤)
  if (coating.includes("dlc") && /스테인리스|탄소강|합금강|티타늄|인코넬|주철|고경도|stainless|carbon\s*steel|alloy\s*steel|titanium|inconel|cast\s*iron|hardened/i.test(material)) {
    warnings.push({
      level: "danger",
      message: `DLC 코팅은 ${material}에 부적합합니다. 내열 400°C로 절삭열(600~800°C)에 견디지 못합니다.`,
      suggestion: `AlCrN(Y-Coating)이나 TiAlN(X-Coating)으로 변경을 권장합니다.`,
      relatedField: "coating",
    })
  }

  // TiAlN/AlTiN + 알루미늄 (Ti 함유 → BUE 구성인선)
  if (/tialn|altin|x-coat|x코팅/.test(coating) && /알루미늄|aluminum|비철|구리|copper|non-?ferrous/i.test(material)) {
    warnings.push({
      level: "warn",
      message: `Ti 함유 코팅(${coating})은 알루미늄과 반응하여 BUE(구성인선)가 발생할 수 있습니다.`,
      suggestion: `DLC 또는 무코팅(Bright)이 알루미늄에 적합합니다.`,
      relatedField: "coating",
    })
  }

  // 무코팅 + 고온 소재
  if (/uncoated|bright|무코팅|비코팅/.test(coating) && /스테인리스|티타늄|인코넬|stainless|titanium|inconel/i.test(material)) {
    warnings.push({
      level: "warn",
      message: `무코팅은 ${material} 가공 시 마모가 빠릅니다. 절삭열이 높은 소재에는 코팅 필수입니다.`,
      suggestion: `AlCrN(Y-Coating) 권장.`,
      relatedField: "coating",
    })
  }

  // ── L/D 비 경고 ──
  if (diameter > 0 && overallLength > 0) {
    const ld = overallLength / diameter
    if (ld > 8) {
      warnings.push({
        level: "danger",
        message: `L/D비가 ${ld.toFixed(1)}배입니다. 극심한 떨림과 공구 파손 위험이 있습니다.`,
        suggestion: `넥 타입 공구 + 절입 깊이 축소 + 쿨런트 필수. 전장을 줄이거나 직경을 키우세요.`,
        relatedField: "overallLengthMm",
      })
    } else if (ld > 4) {
      warnings.push({
        level: "warn",
        message: `L/D비가 ${ld.toFixed(1)}배입니다. 떨림 발생 가능성이 있습니다.`,
        suggestion: `부등분할 엔드밀 또는 넥 타입 권장. 절입 깊이(ap)를 줄이세요.`,
        relatedField: "overallLengthMm",
      })
    }
  }

  // ── 날수-소재 미스매치 ──

  // 비철 + 6날 이상 (칩 포켓 부족)
  if (/알루미늄|aluminum|비철|구리/.test(material) && fluteCount >= 6) {
    warnings.push({
      level: "info",
      message: `비철금속에 ${fluteCount}날은 칩 포켓이 부족할 수 있습니다.`,
      suggestion: `2~3날이 칩 배출에 유리합니다.`,
      relatedField: "fluteCount",
    })
  }

  // 스테인리스 + 2날 이하 (강성 부족)
  if (/스테인리스/.test(material) && fluteCount > 0 && fluteCount <= 2) {
    warnings.push({
      level: "info",
      message: `스테인리스에 ${fluteCount}날은 강성이 부족할 수 있습니다.`,
      suggestion: `4날 이상이 절삭력 분산과 안정성에 유리합니다.`,
      relatedField: "fluteCount",
    })
  }

  // ── 형상-가공 경고 ──

  // 볼엔드밀 (바닥 평면 불가)
  if (/ball|볼/.test(subtype)) {
    warnings.push({
      level: "info",
      message: `볼엔드밀은 바닥면이 곡면이 됩니다. 평면 바닥이 필요하면 스퀘어나 라디우스가 적합합니다.`,
      suggestion: `3D 곡면 가공이 아니라면 스퀘어 또는 라디우스를 권장합니다.`,
      relatedField: "toolSubtype",
    })
  }

  return warnings
}

/**
 * 경고를 응답 삽입용 자연스러운 한국어 메시지로 변환.
 * info는 제외 (thinkingProcess에만 남김).
 */
export function formatWarningsForResponse(warnings: DomainWarning[]): string {
  if (warnings.length === 0) return ""
  const lines = warnings
    .filter(w => w.level !== "info")
    .map(w => {
      const icon = w.level === "danger" ? "⚠️" : "💡"
      return `${icon} ${w.message} ${w.suggestion}`
    })
  return lines.length > 0 ? "\n\n" + lines.join("\n") : ""
}
