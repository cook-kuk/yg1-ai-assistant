"""Patch 1: sql-agent.ts — expand op enum + pass-through op + better instructions.

Changes:
  1) buildSystemPrompt: op enum 확장 (gte/lte/between/in/is_null), range/null/contradiction 처리 instruction
  2) validateFilters: 새 op 허용
  3) buildAppliedFilterFromAgentFilter: op pass-through (collapse 제거)
  4) coerceRawValue: 더 많은 numeric 필드
  5) between rawValue2 처리
"""
import sys, io
sys.stdout.reconfigure(encoding="utf-8", errors="replace")
sys.path.insert(0, "tools")
import vm

REMOTE = "/home/csp/yg1-ai-catalog-dev/lib/recommendation/core/sql-agent.ts"
data = vm.read_remote(REMOTE)
print(f"[patch1] read {len(data)} chars")

# ── Patch 1A: system prompt — op enum + instructions ──
old_prompt = '''## Instructions
Extract filter conditions from user message as JSON array:
[{"field":"column_name","op":"eq|neq|like","value":"...","display":"한국어 설명"}]

Rules:
- field MUST be actual column_name from schema, or "_workPieceName" for workpiece materials, or "_skip"/"_reset"/"_back" for navigation
- Use column descriptions and sample values to determine the correct column for the user's intent
- For exclusion/negation (빼고/말고/제외/아닌것 etc.) → op="neq"
- For navigation: skip(상관없음/패스) → _skip, reset(처음부터/초기화) → _reset, back(이전/돌아가) → _back
- For questions or non-filter messages → [] (empty array)
- ALWAYS respond with valid JSON array only. No explanation.`'''

new_prompt = '''## Instructions
Extract filter conditions from user message as JSON array:
[{"field":"column_name","op":"OP","value":"...","value2":"...","display":"한국어 설명"}]

## op enum (반드시 이 값 중 하나)
- eq        : 정확히 같음 ("X 직경 10mm" → eq:10)
- neq       : 같지 않음 ("X 빼고", "X 제외" → neq:X)
- gte       : 이상 / 보다 큰 / 넘는 / 최소 ("100 이상", "100mm 보다 긴", "100 넘는" → gte:100)
- lte       : 이하 / 보다 작은 / 안 넘는 / 최대 ("80 이하", "80 미만", "80 안 넘는" → lte:80)
- gt        : 초과 (strict) — 거의 안 씀, 보통 gte
- lt        : 미만 (strict) — 거의 안 씀, 보통 lte
- between   : 범위 ("8~12", "8에서 12 사이", "8mm 이상 12mm 이하"). value=하한, value2=상한
- like      : 부분 문자열 매칭 (string 컬럼만)
- is_null   : 값 없음 / NULL ("코팅 없는 거", "uncoated", "bright finish" → coating is_null)
- is_not_null : 값 있음

## Field 매핑 (반드시 정확한 column_name 사용)
- 직경 / φ / Ø / 외경 / mm / 파이 / 파이 → search_diameter_mm  (NOT shank or CL!)
- 샹크 직경 / shank dia / 생크 → milling_shank_dia
- 절삭 길이 / CL / 날장 / flute length → milling_length_of_cut (Milling) | holemaking_flute_length
- 전체 길이 / 전장 / OAL / 길이 → milling_overall_length (Milling) | holemaking_overall_length | threading_overall_length
- 헬릭스 / helix → milling_helix_angle | holemaking_helix_angle
- 포인트 각도 / point angle → (mv에 컬럼 없음, 무시)
- 피치 / pitch → (mv에 없음, 무시)
- 코팅 / coating → milling_coating | holemaking_coating | threading_coating | search_coating
- 날 수 / flute / 날 / F → search_flute_count or milling_number_of_flute
- 브랜드 / brand → edp_brand_name
- 시리즈 → edp_series_name
- 가공 형상 / Slotting / Side Milling / Drilling → series_application_shape
- 소재 / material / P/M/K/N/S/H / 탄소강/스테인리스/주철/비철/초내열/고경도 → _workPieceName

## 중요 규칙
1. **범위 표현은 절대 eq로 깎지 말 것**
   - "직경 8~12" → between (NOT eq:8|9|10|11|12)
   - "100 이상" → gte:100 (NOT eq:100, NOT eq:"100+")
   - "80 이하" → lte:80
2. **field 매핑 정확히** — "전체 길이"/"전장"은 overallLength이지 diameter가 아님!
3. **모순(contradiction) 감지** — "직경 20 이상이면서 5 이하" 같은 모순은 빈 배열 [] 반환
4. **음의 직경/0** — diameter <= 0 또는 999 같은 비현실 값은 [] 반환
5. **navigation**: skip(상관없음/패스) → _skip, reset(처음부터/초기화) → _reset, back(이전/돌아가) → _back
6. **questions** (필터 없는 질문) → [] (empty array)
7. **JSON only, no explanation**'''

if old_prompt in data:
    data = data.replace(old_prompt, new_prompt)
    print("[patch1] ✓ system prompt replaced")
else:
    print("[patch1] ✗ system prompt anchor not found"); sys.exit(1)

# ── Patch 1B: validateFilters — accept new ops ──
old_validate = '''function validateFilters(arr: unknown[]): AgentFilter[] {
  return arr.filter((item): item is AgentFilter => {
    if (typeof item !== "object" || item === null) return false
    const obj = item as Record<string, unknown>
    return typeof obj.field === "string" && typeof obj.op === "string" && typeof obj.value !== "undefined"
  }).map(f => ({
    field: f.field,
    op: f.op,
    value: String(f.value),
    display: f.display ? String(f.display) : undefined,
  }))
}'''

new_validate = '''const ALLOWED_AGENT_OPS = new Set(["eq","neq","gte","lte","gt","lt","between","like","is_null","is_not_null","in","not_in"])

function validateFilters(arr: unknown[]): AgentFilter[] {
  return arr.filter((item): item is AgentFilter => {
    if (typeof item !== "object" || item === null) return false
    const obj = item as Record<string, unknown>
    if (typeof obj.field !== "string" || typeof obj.op !== "string") return false
    if (!ALLOWED_AGENT_OPS.has(obj.op)) return false
    // is_null/is_not_null don't need value
    if (obj.op === "is_null" || obj.op === "is_not_null") return true
    return typeof obj.value !== "undefined" && obj.value !== null
  }).map((f: any) => ({
    field: f.field,
    op: f.op,
    value: f.value != null ? String(f.value) : "",
    value2: f.value2 != null ? String(f.value2) : undefined,
    display: f.display ? String(f.display) : undefined,
  }))
}'''

if old_validate in data:
    data = data.replace(old_validate, new_validate)
    print("[patch1] ✓ validateFilters replaced")
else:
    print("[patch1] ✗ validateFilters anchor not found"); sys.exit(1)

# ── Patch 1C: AgentFilter type — add value2 ──
old_type = '''export interface AgentFilter {'''
if old_type in data:
    # Find the type body and add value2
    idx = data.find(old_type)
    end = data.find("}", idx)
    body = data[idx:end+1]
    if "value2" not in body:
        new_body = body.replace("value:", "value2?: string  // for between (upper bound)\n  value:")
        data = data.replace(body, new_body)
        print("[patch1] ✓ AgentFilter.value2 added")

# ── Patch 1D: buildAppliedFilterFromAgentFilter — pass-through op ──
old_convert = '''  // Convert op for compatibility
  const op = agentFilter.op === "like" ? "includes" as const
    : agentFilter.op === "neq" ? "neq" as const
    : "eq" as const'''

new_convert = '''  // Convert op for compatibility — pass-through (Patch1: keep gte/lte/between/is_null)
  const opMap: Record<string, AppliedFilter["op"]> = {
    eq: "eq", neq: "neq", gte: "gte", lte: "lte", gt: "gte", lt: "lte",
    between: "between", like: "includes", in: "eq", not_in: "neq",
    is_null: "eq", is_not_null: "neq",
  }
  const op = (opMap[agentFilter.op] ?? "eq") as AppliedFilter["op"]'''

if old_convert in data:
    data = data.replace(old_convert, new_convert)
    print("[patch1] ✓ op pass-through enabled")
else:
    print("[patch1] ✗ convert anchor not found"); sys.exit(1)

# ── Patch 1E: coerceRawValue — support more numeric fields + arrays ──
old_coerce = '''function coerceRawValue(field: string, value: string): string | number {
  if (field === "diameterMm" || field === "fluteCount") {
    const n = parseFloat(value)
    return isNaN(n) ? value : n
  }
  return value
}'''

new_coerce = '''const NUMERIC_REGISTRY_FIELDS = new Set([
  "diameterMm", "fluteCount", "overallLengthMm", "lengthOfCutMm",
  "shankDiameterMm", "helixAngleDeg", "taperAngleDeg", "ballRadiusMm",
])

function coerceRawValue(field: string, value: string): string | number {
  if (NUMERIC_REGISTRY_FIELDS.has(field)) {
    // strip non-numeric chars but keep dots and minus
    const cleaned = String(value).replace(/[^0-9.\\-]/g, "")
    const n = parseFloat(cleaned)
    return isNaN(n) ? value : n
  }
  return value
}'''

if old_coerce in data:
    data = data.replace(old_coerce, new_coerce)
    print("[patch1] ✓ coerceRawValue expanded")
else:
    print("[patch1] ✗ coerceRawValue anchor not found"); sys.exit(1)

# ── Patch 1F: buildAppliedFilterFromAgentFilter — handle between value2 ──
# Find the registryField return block
old_registry_return = '''  if (registryField) {
    // Known field → standard AppliedFilter
    return {
      field: registryField,
      op,
      value: agentFilter.display ?? agentFilter.value,
      rawValue: coerceRawValue(registryField, agentFilter.value),
      appliedAt: turnCount,
    }
  }'''

new_registry_return = '''  if (registryField) {
    // Known field → standard AppliedFilter (Patch1: between rawValue2 + is_null guard)
    const base = {
      field: registryField,
      op,
      value: agentFilter.display ?? agentFilter.value ?? "",
      rawValue: coerceRawValue(registryField, agentFilter.value ?? ""),
      appliedAt: turnCount,
    } as AppliedFilter
    if (agentFilter.op === "between" && agentFilter.value2 != null) {
      base.rawValue2 = coerceRawValue(registryField, String(agentFilter.value2)) as string | number
    }
    if (agentFilter.op === "is_null") {
      base.value = agentFilter.display ?? "없음"
      base.rawValue = ""
    }
    return base
  }'''

if old_registry_return in data:
    data = data.replace(old_registry_return, new_registry_return)
    print("[patch1] ✓ between value2 + is_null handling added")
else:
    print("[patch1] ✗ registry return anchor not found")

# Write back
vm.write_remote(REMOTE, data)
print(f"[patch1] wrote {len(data)} chars to {REMOTE}")
print("[patch1] DONE")
