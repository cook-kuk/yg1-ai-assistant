"""Patch 2: stronger anti-patterns + sql-agent code-side guards.

1) prompt: 강력한 anti-pattern (전체 길이≠직경, KOREA=country, contradiction=빈배열)
2) sql-agent code: contradiction guard (gte>lte for same field), invalid diameter guard
3) prompt: stockOnly 인식
4) coating value 매칭 강화 (T-Coating, TiAlN, AlTiN 등)
"""
import sys, io
sys.stdout.reconfigure(encoding="utf-8", errors="replace")
sys.path.insert(0, "tools")
import vm

REMOTE = "/home/csp/yg1-ai-catalog-dev/lib/recommendation/core/sql-agent.ts"
data = vm.read_remote(REMOTE)
print(f"[patch2] read {len(data)} chars")

# ── 2A: prompt 강화 — 강력한 anti-pattern 추가 ──
old_section = '''## 중요 규칙
1. **범위 표현은 절대 eq로 깎지 말 것**
   - "직경 8~12" → between (NOT eq:8|9|10|11|12)
   - "100 이상" → gte:100 (NOT eq:100, NOT eq:"100+")
   - "80 이하" → lte:80
2. **field 매핑 정확히** — "전체 길이"/"전장"은 overallLength이지 diameter가 아님!
3. **모순(contradiction) 감지** — "직경 20 이상이면서 5 이하" 같은 모순은 빈 배열 [] 반환
4. **음의 직경/0** — diameter <= 0 또는 999 같은 비현실 값은 [] 반환
5. **navigation**: skip(상관없음/패스) → _skip, reset(처음부터/초기화) → _reset, back(이전/돌아가) → _back
6. **questions** (필터 없는 질문) → [] (empty array)
7. **JSON only, no explanation**`'''

new_section = '''## 중요 규칙 (반드시 지켜라)

### 1. 범위 표현 (eq 금지)
- "직경 8~12" / "8~12mm" / "8 에서 12 사이" → ONE filter with op=between, value=8, value2=12
- "100 이상" / "100mm 보다 긴" / "100 넘는" / "100 초과" → gte:100
- "80 이하" / "80mm 보다 짧은" / "80 미만" / "80 안 넘는" → lte:80
- ❌ NEVER: eq:"8|9|10|11|12", eq:"100+", includes:"80+"

### 2. Field 매핑 — 잘못 매핑하면 결과 0건 됨
- "전체 길이"/"전장"/"OAL"/"길이"/"긴 거"/"짧은 거" → milling_overall_length (NEVER search_diameter_mm!)
- "절삭 길이"/"CL"/"날장"/"flute length" → milling_length_of_cut (NEVER search_diameter_mm!)
- "샹크"/"shank"/"생크" → milling_shank_dia (NEVER search_diameter_mm!)
- "직경"/"외경"/"파이"/"φ"/"Ø" → search_diameter_mm
- "헬릭스"/"helix" → milling_helix_angle
- "한국"/"코리아"/"국내"/"KOREA"/"KR" → country (search by 'KOREA' in country_codes), NEVER edp_brand_name!
- "유럽"/"미국"/"아시아" → 같은 country
- "재고"/"stock"/"in stock"/"재고 있는" → stockOnly:eq:true (특수 필드)
- "ALU-POWER"/"X5070" 등 실제 브랜드명 → edp_brand_name

### 3. Coating 정확한 값 (sample list 참조)
- "T-Coating" 또는 "T 코팅" → milling_coating, op=eq, value="T-Coating" (NOT X-Coating!)
- "TiAlN" → milling_coating, eq, "TiAlN"
- "AlTiN" → milling_coating, eq, "AlTiN"
- "코팅 없는"/"uncoated"/"bright finish"/"노코팅" → milling_coating op=is_null

### 4. 모순/비현실 값 감지 (반드시 빈 배열 반환)
- "직경 20 이상이면서 5 이하" → [] (gte > lte는 모순)
- "직경 999mm" / "직경 1000mm" / "0mm" / "음수" → [] (현실 직경은 0.1~50mm)
- "전장 1000mm 이상" → [] (현실 전장은 30~300mm)

### 5. 다중 필드 동시 추출
한 user msg에 여러 조건 있으면 모두 분리해서 배열로:
- "10mm 4날 TiAlN 코팅" → 3 filters: diameter eq 10, flute eq 4, coating eq TiAlN

### 6. 음수 추출 안 함
- 한 필드에 대해 같은 op는 마지막 값만 (덮어쓰기)
- "전체 길이 100 이상" → [overall gte 100] only. NEVER include diameter.

### 7. navigation
skip(상관없음/패스) → _skip, reset(처음부터/초기화) → _reset, back(이전/돌아가) → _back

### 8. JSON only, no explanation`'''

if old_section in data:
    data = data.replace(old_section, new_section)
    print("[patch2] ✓ prompt anti-patterns strengthened")
else:
    print("[patch2] ✗ prompt section not found"); sys.exit(1)

# ── 2B: code-side guard — naturalLanguageToFilters wrap ──
old_call = '''  const filters = parseAgentResponse(raw)
  return { filters, raw }
}'''

new_call = '''  let filters = parseAgentResponse(raw)
  // Patch2: code-side guards — drop contradictions, invalid ranges
  filters = applyFilterGuards(filters)
  return { filters, raw }
}

function applyFilterGuards(filters: AgentFilter[]): AgentFilter[] {
  if (!filters || filters.length === 0) return filters
  // Group by field
  const byField = new Map<string, AgentFilter[]>()
  for (const f of filters) {
    if (!byField.has(f.field)) byField.set(f.field, [])
    byField.get(f.field)!.push(f)
  }
  // Detect contradictions: gte > lte for same field
  for (const [field, group] of byField) {
    const gte = group.find(f => f.op === "gte" || f.op === "gt")
    const lte = group.find(f => f.op === "lte" || f.op === "lt")
    if (gte && lte) {
      const lo = parseFloat(String(gte.value))
      const hi = parseFloat(String(lte.value))
      if (!isNaN(lo) && !isNaN(hi) && lo > hi) {
        console.warn(`[sql-agent:guard] contradiction on ${field}: gte ${lo} > lte ${hi} → drop all filters`)
        return []
      }
    }
  }
  // Invalid diameter guard (현실 직경 0.1 ~ 60mm)
  const dia = filters.find(f => f.field === "search_diameter_mm" || f.field === "milling_outside_dia" || f.field === "holemaking_outside_dia" || f.field === "threading_outside_dia")
  if (dia && (dia.op === "eq" || dia.op === "gte" || dia.op === "lte" || dia.op === "between")) {
    const v = parseFloat(String(dia.value))
    if (!isNaN(v) && (v <= 0 || v > 60)) {
      console.warn(`[sql-agent:guard] invalid diameter ${v} → drop all filters`)
      return []
    }
  }
  // Invalid OAL guard (현실 30 ~ 300mm)
  const oal = filters.find(f => /overall_length|overallLengthMm/.test(f.field))
  if (oal && (oal.op === "eq" || oal.op === "gte" || oal.op === "lte")) {
    const v = parseFloat(String(oal.value))
    if (!isNaN(v) && (v <= 0 || v > 500)) {
      console.warn(`[sql-agent:guard] invalid OAL ${v} → drop`)
      return filters.filter(f => f !== oal)
    }
  }
  return filters
}'''

if old_call in data:
    data = data.replace(old_call, new_call)
    print("[patch2] ✓ filter guards added")
else:
    print("[patch2] ✗ call site not found"); sys.exit(1)

vm.write_remote(REMOTE, data)
print(f"[patch2] wrote {len(data)} chars")
print("[patch2] DONE")
