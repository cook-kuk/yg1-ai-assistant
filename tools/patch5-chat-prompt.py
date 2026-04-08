"""Patch 5: chat-prompt.ts — fallback rules for invalid diameter + 0-result.

Targets fail cases:
- E01 (999mm): currently says "비현실적" but returns 0 products → FAIL
- H05 (KOREA + 초내열): 0 search results → FAIL

Fix: instruct chat to suggest valid alternative diameter or relax conditions, always return ≥1 product.
"""
import sys
sys.stdout.reconfigure(encoding="utf-8", errors="replace")
sys.path.insert(0, "tools")
import vm

REMOTE = "/home/csp/yg1-ai-catalog-dev/lib/chat/application/chat-prompt.ts"
data = vm.read_remote(REMOTE)
print(f"[patch5] read {len(data)} chars")

# Add fallback rules section before "## 절대 금지"
old_anchor = "## 절대 금지"
new_block = '''## Fallback 규칙 (반드시 지켜라)

### 1. 비현실적 입력 처리
- 직경이 0mm, 999mm 같이 비현실 (range: 0.5~50mm 이외)이면:
  → "입력하신 ${value}는 일반적 범위가 아닙니다. 일반적인 ${nearest}mm로 추천드릴까요?" 식으로 안내
  → 그리고 가장 가까운 현실적 직경 (3, 5, 8, 10mm 등)으로 즉시 search_products 호출
  → 결과 1개 이상 PRODUCT 추천 필수
- 직경이 음수나 텍스트면 같은 방식으로 처리

### 2. 0 결과 처리 (search 결과 빈 경우)
- search_products가 0건 반환하면 즉시 포기하지 마세요.
- 다음 순서로 조건 완화 + 재검색:
  a) 코팅 조건 제거 → 재검색
  b) 국가 필터 ALL로 변경 → 재검색
  c) 가공 형상 (operation_type) 제거 → 재검색
  d) 그래도 0이면 → 직경 ±2mm 범위 → 재검색
- 4번 시도 후에도 0이면 → 가장 가까운 추천 1개라도 안내 + "정확히 일치하는 제품은 없지만 다음 제품을 검토해 보세요"

### 3. 모순 / 빈 입력 처리
- "20 이상이면서 5 이하" 같은 모순 입력은 → "입력하신 조건이 서로 모순됩니다. ${first}로 처리해드릴까요?"
- 그래도 product 1개 이상 안내해야 함

## 절대 금지'''

if old_anchor in data and "Fallback 규칙" not in data:
    data = data.replace(old_anchor, new_block, 1)
    print("[patch5] ✓ fallback rules injected")
else:
    print(f"[patch5] ✗ anchor missing or already patched (Fallback in file: {'Fallback 규칙' in data})")
    sys.exit(1)

vm.write_remote(REMOTE, data)
print(f"[patch5] wrote {len(data)} chars")
