"""Patch 3: few-shot examples + Sonnet model upgrade for sql-agent.

Haiku가 anti-pattern을 무시하고 "전체 길이"를 diameter로 매핑함.
1) Few-shot examples 6개 추가 (most common patterns)
2) SQL_AGENT_MODEL: haiku → sonnet
"""
import sys
sys.stdout.reconfigure(encoding="utf-8", errors="replace")
sys.path.insert(0, "tools")
import vm

REMOTE = "/home/csp/yg1-ai-catalog-dev/lib/recommendation/core/sql-agent.ts"
data = vm.read_remote(REMOTE)
print(f"[patch3] read {len(data)} chars")

# ── 3A: Add few-shot examples to prompt (right before "JSON only") ──
old_anchor = '### 8. JSON only, no explanation`'
new_examples = '''### 8. Examples (반드시 학습)

User: "전체 길이 100mm 이상인 것만"
Output: [{"field":"milling_overall_length","op":"gte","value":"100","display":"전장 100mm 이상"}]
(NEVER add diameter filter — "전체 길이"는 길이지 직경 아님)

User: "직경 8~12mm"
Output: [{"field":"search_diameter_mm","op":"between","value":"8","value2":"12","display":"직경 8~12mm"}]

User: "샹크 직경 6에서 10 사이"
Output: [{"field":"milling_shank_dia","op":"between","value":"6","value2":"10","display":"샹크 6~10mm"}]
(샹크 ≠ 외경)

User: "절삭 길이 20mm 이상"
Output: [{"field":"milling_length_of_cut","op":"gte","value":"20","display":"CL 20+ mm"}]

User: "코팅 없는 거"
Output: [{"field":"milling_coating","op":"is_null","value":"","display":"코팅 없음"}]

User: "5날 이상"
Output: [{"field":"search_flute_count","op":"gte","value":"5","display":"5날 이상"}]

User: "직경 999mm"
Output: []
(현실 직경 0.1~60mm 범위 밖 → 빈 배열)

User: "직경 20 이상이면서 5 이하"
Output: []
(모순: gte 20 > lte 5)

User: "한국 재고로 4날 TiAlN 전장 100 이상"
Output: [
  {"field":"country_codes","op":"includes","value":"KOREA","display":"한국"},
  {"field":"stockOnly","op":"eq","value":"true","display":"재고"},
  {"field":"search_flute_count","op":"eq","value":"4","display":"4날"},
  {"field":"milling_coating","op":"eq","value":"TiAlN","display":"TiAlN"},
  {"field":"milling_overall_length","op":"gte","value":"100","display":"전장 100+"}
]
(KOREA는 country_codes — NEVER edp_brand_name)

User: "ALU-POWER 빼고"
Output: [{"field":"edp_brand_name","op":"neq","value":"ALU-POWER","display":"ALU-POWER 제외"}]

### 9. JSON only, no explanation`'''

if old_anchor in data:
    data = data.replace(old_anchor, new_examples)
    print("[patch3] ✓ few-shot examples added")
else:
    print("[patch3] ✗ examples anchor not found"); sys.exit(1)

# ── 3B: Upgrade SQL_AGENT_MODEL haiku → sonnet ──
old_model = 'const SQL_AGENT_MODEL = resolveModel("haiku")'
new_model = 'const SQL_AGENT_MODEL = resolveModel("sonnet")  // Patch3: upgraded for instruction following'

if old_model in data:
    data = data.replace(old_model, new_model)
    print("[patch3] ✓ model upgraded haiku → sonnet")
else:
    print("[patch3] ✗ model line not found")

vm.write_remote(REMOTE, data)
print(f"[patch3] wrote {len(data)} chars")
print("[patch3] DONE")
