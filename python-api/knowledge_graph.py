"""Knowledge Graph — deterministic pattern DB for frequent queries.

Minimal port of lib/recommendation/core/knowledge-graph.ts. Maps well-known
phrase shapes ("SUS304에 좋은 엔드밀", "알루미늄 드릴", "고경도강 금형") directly
to a SCRIntent so we can skip the LLM call entirely.

The TS KG is richer (entity graph + session state + clarification flows).
Here we keep only the pattern → intent shortcut: scan the message for a
small set of (workpiece, tool_type) pairs and return the first hit.
"""

from __future__ import annotations

import re
from typing import Optional

from schemas import SCRIntent


# Workpiece → ISO material_tag. Order matters: more specific first.
_WORKPIECE_TO_MATERIAL: list[tuple[re.Pattern[str], str, str]] = [
    # (pattern, material_tag, workpiece_label)
    (re.compile(r"sus\s*3?04|sus304|sts\s*304|sts304", re.IGNORECASE), "M", "SUS304"),
    (re.compile(r"sus\s*3?16l?|sus316l?|sts\s*316", re.IGNORECASE), "M", "SUS316"),
    (re.compile(r"스테인리스|스텐|수스|\bsus\b|stainless|inox", re.IGNORECASE), "M", "STAINLESS"),
    (re.compile(r"알루미늄|알미늄|aluminum|aluminium", re.IGNORECASE), "N", "ALUMINUM"),
    (re.compile(r"\bti6al4v\b|티타늄|titanium", re.IGNORECASE), "S", "TITANIUM"),
    (re.compile(r"인코넬|inconel|하스텔로이|hastelloy", re.IGNORECASE), "S", "INCONEL"),
    (re.compile(r"주철|cast\s*iron|\bfcd?\b", re.IGNORECASE), "K", "CAST_IRON"),
    (re.compile(r"고경도강|경화강|hardened|금형강|mold\s*steel|die\s*steel", re.IGNORECASE), "H", "HARDENED"),
    (re.compile(r"탄소강|carbon\s*steel|s45c|sm45c", re.IGNORECASE), "P", "CARBON_STEEL"),
]

# Tool family cues. Each maps to (tool_type, root/canonical hint).
_TOOL_TYPE_CUES: list[tuple[re.Pattern[str], str]] = [
    (re.compile(r"엔드밀|end\s*mill|endmill|밀링", re.IGNORECASE), "End Mill"),
    (re.compile(r"드릴|drill", re.IGNORECASE), "Drill"),
    (re.compile(r"탭핑|\b탭\b|tap\b|tapping", re.IGNORECASE), "Tap"),
    (re.compile(r"리머|reamer|reaming|리밍", re.IGNORECASE), "Reamer"),
]

# Subtype cues. Optional — matched independently of tool type.
_SUBTYPE_CUES: list[tuple[re.Pattern[str], str]] = [
    (re.compile(r"볼\s*엔드밀|볼노즈|ball", re.IGNORECASE), "Ball"),
    (re.compile(r"스퀘어|플랫|flat|square", re.IGNORECASE), "Square"),
    (re.compile(r"코너\s*r|radius|코너레디우스", re.IGNORECASE), "Corner Radius"),
]


def match(message: str) -> Optional[SCRIntent]:
    """Fast pattern lookup. Returns SCRIntent if both workpiece + tool_type
    cues are present in the message, otherwise None.

    Typical hits:
      "SUS304에 좋은 엔드밀"   → material=M, tool_type=End Mill
      "알루미늄 드릴"          → material=N, tool_type=Drill
      "고경도강 금형 엔드밀"   → material=H, tool_type=End Mill
    """
    if not message:
        return None

    material_tag: Optional[str] = None
    for pattern, tag, _ in _WORKPIECE_TO_MATERIAL:
        if pattern.search(message):
            material_tag = tag
            break

    tool_type: Optional[str] = None
    for pattern, label in _TOOL_TYPE_CUES:
        if pattern.search(message):
            tool_type = label
            break

    # KG match requires BOTH a workpiece AND a tool family — otherwise not
    # specific enough to skip the LLM.
    if not material_tag or not tool_type:
        return None

    subtype: Optional[str] = None
    for pattern, value in _SUBTYPE_CUES:
        if pattern.search(message):
            subtype = value
            break

    return SCRIntent(
        diameter=None,
        flute_count=None,
        material_tag=material_tag,
        tool_type=tool_type,
        subtype=subtype,
        brand=None,
        coating=None,
    )
