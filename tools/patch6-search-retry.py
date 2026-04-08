"""Patch 6: chat-prompt.ts — strengthen 0-result retry rules.

H05 case: chat says "다시 검색해보겠습니다" but doesn't actually re-call tools.
Fix: stronger imperative — MUST call search_products again, never end with "I'll search again" without actually searching.
"""
import sys
sys.stdout.reconfigure(encoding="utf-8", errors="replace")
sys.path.insert(0, "tools")
import vm

REMOTE = "/home/csp/yg1-ai-catalog-dev/lib/chat/application/chat-prompt.ts"
data = vm.read_remote(REMOTE)
print(f"[patch6] read {len(data)} chars")

old = '''### 2. 0 결과 처리 (search 결과 빈 경우)
- search_products가 0건 반환하면 즉시 포기하지 마세요.
- 다음 순서로 조건 완화 + 재검색:
  a) 코팅 조건 제거 → 재검색
  b) 국가 필터 ALL로 변경 → 재검색
  c) 가공 형상 (operation_type) 제거 → 재검색
  d) 그래도 0이면 → 직경 ±2mm 범위 → 재검색
- 4번 시도 후에도 0이면 → 가장 가까운 추천 1개라도 안내 + "정확히 일치하는 제품은 없지만 다음 제품을 검토해 보세요"'''

new = '''### 2. 0 결과 처리 (search 결과 빈 경우) — 절대 중요
- search_products 결과가 0건이면 그 turn 안에서 즉시 search_products를 다시 호출하세요.
- "다시 검색해보겠습니다"라고 말만 하고 끝내면 안 됩니다. 반드시 또 다른 search_products tool call을 발생시키세요.
- 재검색 순서 (각각 별도 tool call):
  1) country 필터 제거 → search_products 재호출
  2) 코팅(coating) 조건 제거 → search_products 재호출
  3) operation_type 제거 → search_products 재호출
  4) 직경(diameter_mm) ±2mm 확장 → search_products 재호출
- 위 4번 모두 시도해도 0이면, 마지막 호출에서 가장 가까운 제품 1개라도 골라서 추천 응답 작성.
- 응답 텍스트에 반드시 "**브랜드명:** ... | **제품코드:** ..." 형식의 추천 1개 이상 포함해야 합니다.'''

if old in data:
    data = data.replace(old, new)
    print("[patch6] ✓ retry rules strengthened")
else:
    print("[patch6] ✗ anchor not found"); sys.exit(1)

vm.write_remote(REMOTE, data)
print(f"[patch6] wrote {len(data)} chars")
