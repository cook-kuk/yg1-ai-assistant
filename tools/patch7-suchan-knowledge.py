"""Patch 7: Inject suchan's MATERIAL/COATING/MACHINING knowledge blocks into our chat-prompt.

Take the 4 knowledge constants from suchan's chat-prompt.ts and add them to our prompt.
Insert near the existing "## 참고 지식" section.
"""
import sys
sys.stdout.reconfigure(encoding="utf-8", errors="replace")
sys.path.insert(0, "tools")
import vm

REMOTE = "/home/csp/yg1-ai-catalog-dev/lib/chat/application/chat-prompt.ts"
SUCHAN_LOCAL = "test-results/loop/suchan-chat-prompt.ts"

# Read suchan source to extract knowledge constants
with open(SUCHAN_LOCAL, "r", encoding="utf-8") as f:
    suchan = f.read()

# Extract constants between matching backticks
import re
def extract_const(name):
    m = re.search(rf"const {name}\s*=\s*`(.*?)`", suchan, re.DOTALL)
    return m.group(1) if m else ""

material = extract_const("MATERIAL_KNOWLEDGE")
coating = extract_const("COATING_KNOWLEDGE")
machining = extract_const("MACHINING_KNOWLEDGE")
additional = extract_const("ADDITIONAL_DOMAIN_KNOWLEDGE")

print(f"MATERIAL_KNOWLEDGE: {len(material)} chars")
print(f"COATING_KNOWLEDGE: {len(coating)} chars")
print(f"MACHINING_KNOWLEDGE: {len(machining)} chars")
print(f"ADDITIONAL_DOMAIN_KNOWLEDGE: {len(additional)} chars")

# Read remote
data = vm.read_remote(REMOTE)
print(f"[patch7] read {len(data)} chars")

# Insert blocks at the top of buildSystemPrompt return + replace ISO classification
# Find "### ISO 소재 분류" and replace with rich knowledge block
old_iso = """### ISO 소재 분류
- P: 탄소강, 합금강 (S45C, SCM 등)
- M: 스테인리스 (SUS304, SUS316 등) — "스텐"도 여기
- K: 주철 (FC, FCD 등)
- N: 비철금속 (알루미늄, 구리, 황동 등)
- S: 초내열합금/티타늄 (Inconel, Ti-6Al-4V 등)
- H: 고경도강 (HRc 40~65, SKD, 경화강 등)"""

new_block = f"""### ISO 소재 분류 (절삭공구용)
{material.strip()}

### 코팅 종류 (YG-1 주요)
{coating.strip()}

### 가공 종류별 특성
{machining.strip()}

### 추가 도메인 지식
{additional.strip()}"""

if old_iso in data:
    data = data.replace(old_iso, new_block)
    print("[patch7] ✓ knowledge blocks injected")
else:
    print("[patch7] ✗ ISO anchor not found")
    sys.exit(1)

vm.write_remote(REMOTE, data)
print(f"[patch7] wrote {len(data)} chars")
