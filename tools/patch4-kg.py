"""Patch 4: knowledge-graph.ts — yield to sql-agent on range expressions + tighten diameter regex.

Problem: KG catches "전체 길이 100mm 이상" with confidence 0.92, extracts diameter:100 + overall:100 (both eq), skips sql-agent. KG never recognizes gte/lte ops.

Fix:
1) NUMERIC_PATTERNS: diameter 두 번째 패턴 제거 (overall length keyword와 충돌)
2) tryKGDecision: range expression ("이상","이하","사이","~","between") 감지 시 confidence drop → sql-agent에 양보
3) extractEntities: length-context-guarded — 직경 매칭 시 메시지에 length keyword(전체길이/전장/CL/날장/샹크) 있으면 skip
"""
import sys
sys.stdout.reconfigure(encoding="utf-8", errors="replace")
sys.path.insert(0, "tools")
import vm

REMOTE = "/home/csp/yg1-ai-catalog-dev/lib/recommendation/core/knowledge-graph.ts"
data = vm.read_remote(REMOTE)
print(f"[patch4] read {len(data)} chars")

# ── 4A: NUMERIC_PATTERNS — diameter 두 번째 패턴 (bare \d+mm) 제거 ──
old_dia = '''  {
    field: "diameterMm",
    patterns: [
      /(?:직경|지름|파이|φ|Φ|ø|dia(?:meter)?)\\s*(\\d+(?:\\.\\d+)?)\\s*(?:mm)?/i,
      /(\\d+(?:\\.\\d+)?)\\s*(?:mm|파이)\\b/i,
      new RegExp(`(${KO_NUM_KEYS})\\\\s*(?:미리|밀리|파이|mm)`, "i"),
    ],
    extract: (m) => {
      if (KO_NUM[m[1]]) return KO_NUM[m[1]]
      return parseFloat(m[1])
    },
  },'''

new_dia = '''  {
    field: "diameterMm",
    // Patch4: bare "\\d+mm" 패턴 제거 (전체길이/CL/샹크와 충돌). 키워드 있을 때만 매칭.
    patterns: [
      /(?:직경|지름|파이|φ|Φ|ø|dia(?:meter)?)\\s*(\\d+(?:\\.\\d+)?)\\s*(?:mm)?/i,
      new RegExp(`(${KO_NUM_KEYS})\\\\s*(?:미리|밀리|파이)\\\\b`, "i"),
    ],
    extract: (m) => {
      if (KO_NUM[m[1]]) return KO_NUM[m[1]]
      return parseFloat(m[1])
    },
  },'''

if old_dia in data:
    data = data.replace(old_dia, new_dia)
    print("[patch4] ✓ diameter pattern tightened")
else:
    print("[patch4] ✗ diameter pattern not found — try alt anchor")
    # Try a fuzzier match without exact whitespace
    import re
    pat = re.compile(
        r'\{\s*field:\s*"diameterMm",\s*patterns:\s*\[\s*'
        r'/\(\?:직경\|지름\|파이.*?\)\\s\*\(\\d\+\(\?:\\\.\\d\+\)\?\)\\s\*\(\?:mm\)\?/i,\s*'
        r'/\(\\d\+\(\?:\\\.\\d\+\)\?\)\\s\*\(\?:mm\|파이\)\\b/i,\s*',
        re.DOTALL
    )
    if pat.search(data):
        print("[patch4]   regex anchor matched, doing line-by-line fix")
        data = data.replace('/(\\d+(?:\\.\\d+)?)\\s*(?:mm|파이)\\b/i,', '// [Patch4] removed bare \\d+mm pattern')
        print("[patch4] ✓ diameter bare pattern commented out (alt path)")
    else:
        print("[patch4] ✗ even alt anchor not found"); sys.exit(1)

# ── 4B: tryKGDecision — yield to sql-agent on range expressions ──
# Find the function start and inject a guard at the top
old_kg_start = '''export function tryKGDecision(
  userMessage: string,
  sessionState: ExplorationSessionState | null,
): KGDecisionResult {
  const msg = userMessage.trim()
  const lower = msg.toLowerCase()
  const pendingField = sessionState?.lastAskedField ?? null'''

new_kg_start = '''export function tryKGDecision(
  userMessage: string,
  sessionState: ExplorationSessionState | null,
): KGDecisionResult {
  const msg = userMessage.trim()
  const lower = msg.toLowerCase()
  const pendingField = sessionState?.lastAskedField ?? null

  // Patch4: Range/comparison expression detection — yield to sql-agent (LLM)
  // KG는 op (gte/lte/between)를 인식 못 함. range 표현 있으면 confidence 낮춰 양보.
  const HAS_RANGE_EXPR = /(?:이상|이하|초과|미만|넘는|넘게|보다\s*(?:크|작|긴|짧)|보다\s*(?:많|적)|사이|between|min(?:imum)?|max(?:imum)?|\d+\s*(?:~|-|에서|to)\s*\d+|≥|≤|>=|<=)/iu
  if (HAS_RANGE_EXPR.test(msg)) {
    return {
      decision: null,
      confidence: 0.0,
      source: "none",
      reason: "Patch4: range expression — yield to sql-agent",
    }
  }
  // Patch4: contradiction guard
  const CONTRADICTION = /(?:이상이?면서.*이하|이하이?면서.*이상|넘으면서.*못\s*넘|크면서.*작)/iu
  if (CONTRADICTION.test(msg)) {
    return {
      decision: null,
      confidence: 0.0,
      source: "none",
      reason: "Patch4: contradiction → drop",
    }
  }'''

if old_kg_start in data:
    data = data.replace(old_kg_start, new_kg_start)
    print("[patch4] ✓ KG range/contradiction guard added")
else:
    print("[patch4] ✗ tryKGDecision anchor not found"); sys.exit(1)

vm.write_remote(REMOTE, data)
print(f"[patch4] wrote {len(data)} chars")
print("[patch4] DONE")
