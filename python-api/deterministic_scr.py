"""Deterministic SCR — regex-based intent prefilter.

Ported from lib/recommendation/core/deterministic-scr.ts.
Extracts diameter / flute_count / material_tag / tool_type / subtype / coating
from Korean/English messages via regex cues. Returns None when confidence is
low (fewer than one high-signal field extracted), so callers fall back to the
LLM SCR path (scr.parse_intent).
"""

from __future__ import annotations

import re
from typing import Optional

from schemas import SCRIntent


# ── Numeric cues ─────────────────────────────────────────────────────
# 직경/지름/파이/φ/ø/dia + N  → diameter (mm)
_DIAMETER_PATTERNS = [
    re.compile(r"(?:직경|지름|외경|파이|φ|Φ|ø|dia(?:meter)?)(?:[이가은는을를도만])?\s*(\d+(?:\.\d+)?)\s*(?:mm)?", re.IGNORECASE),
    re.compile(r"(\d+(?:\.\d+)?)\s*(?:파이|φ|Φ|ø)\b", re.IGNORECASE),
    re.compile(r"\bD(\d+(?:\.\d+)?)\b", re.IGNORECASE),
    re.compile(r"(\d+(?:\.\d+)?)\s*mm\b", re.IGNORECASE),
]

# "4날" / "4 flute" / "5F" — inline
_FLUTE_PATTERNS = [
    re.compile(r"(\d+)\s*(?:날|낭|flutes?|fl\b|f\b)", re.IGNORECASE),
    re.compile(r"(?:날수|날\s*수|flute\s*count|flutes?)(?:[이가은는을를도만])?\s*(\d+)", re.IGNORECASE),
]


# ── Material tag (ISO P/M/K/N/S/H/O) ─────────────────────────────────
_MATERIAL_CUES: list[tuple[re.Pattern[str], str]] = [
    (re.compile(r"(스테인리스|스텐|스뎅|수스|sus\s*\d*l?|sts\s*\d*|stainless|inox)", re.IGNORECASE), "M"),
    (re.compile(r"(티타늄|타이태늄|titanium|\bti6al4v\b)", re.IGNORECASE), "S"),
    (re.compile(r"(인코넬|inconel|하스텔로이|hastelloy|내열\s*합금|heat[\s-]?resistant|hrsa|nimonic|waspaloy)", re.IGNORECASE), "S"),
    (re.compile(r"(알루미늄|알미늄|aluminum|aluminium|두랄루민|duralumin)", re.IGNORECASE), "N"),
    (re.compile(r"(황동|brass|청동|bronze|\bcopper\b|구리)", re.IGNORECASE), "N"),
    (re.compile(r"(주철|cast\s*iron|덕타일|ductile|fcd|\bfc\b\d*)", re.IGNORECASE), "K"),
    (re.compile(r"(고경도|경화강|hardened|HRc?\s*\d|hrc)", re.IGNORECASE), "H"),
    (re.compile(r"(금형강|mold\s*steel|die\s*steel|p20\b|nak80|stavax)", re.IGNORECASE), "H"),
    (re.compile(r"(탄소강|carbon\s*steel|sm45c|s45c|s50c|구조용\s*강|structural\s*steel|합금강|alloy\s*steel|공구강|tool\s*steel)", re.IGNORECASE), "P"),
    (re.compile(r"(cfrp|gfrp|kfrp|복합재|honeycomb|허니컴|아크릴|acrylic|플라스틱|plastic|graphite|그라파이트|흑연)", re.IGNORECASE), "O"),
]


# ── tool_type / subtype cues ─────────────────────────────────────────
_SUBTYPE_CUES: list[tuple[re.Pattern[str], str]] = [
    (re.compile(r"(볼\s*노즈|볼노즈|볼\s*엔드밀|볼엔드밀|ball\s*nose|ballnose|ball\s*end\s*mill|\bball\b)", re.IGNORECASE), "Ball"),
    (re.compile(r"(플랫\s*엔드밀|플랫엔드밀|스퀘어\s*엔드밀|스퀘어엔드밀|플랫|스퀘어|flat\s*end\s*mill|square\s*end\s*mill|\bflat\b|\bsquare\b)", re.IGNORECASE), "Square"),
    (re.compile(r"(코너\s*r|코너r|코너\s*레디우스|코너레디우스|corner\s*radius|코너\s*반경|radius)", re.IGNORECASE), "Corner Radius"),
    (re.compile(r"(테이퍼\s*엔드밀|테이퍼|taper\s*end\s*mill|\btaper\b)", re.IGNORECASE), "Taper"),
    (re.compile(r"(챔퍼|모따기|면취|chamfer)", re.IGNORECASE), "Chamfer"),
    (re.compile(r"(하이\s*피드|하이피드|high[\s-]?feed|고이송)", re.IGNORECASE), "High-Feed"),
    (re.compile(r"(황삭|러핑|roughing)", re.IGNORECASE), "Roughing"),
]

# tool_type cue → "Solid" if 엔드밀/드릴/탭, None otherwise
_SOLID_TOOL_RE = re.compile(r"(엔드밀|드릴|탭|end\s*mill|endmill|drill|tap)", re.IGNORECASE)
_INDEXABLE_RE = re.compile(r"(인덱서블|indexable|인서트|insert)", re.IGNORECASE)


# ── Coating values (DB-known) ────────────────────────────────────────
_COATING_VALUES = [
    "TiAlN", "AlTiN", "AlCrN", "DLC", "TiCN", "TiN",
    "Bright Finish", "Diamond", "Uncoated",
]


def _find_first_group(patterns: list[re.Pattern[str]], text: str) -> Optional[str]:
    for p in patterns:
        m = p.search(text)
        if m:
            return m.group(1)
    return None


def _extract_diameter(text: str) -> Optional[float]:
    raw = _find_first_group(_DIAMETER_PATTERNS, text)
    if raw is None:
        return None
    try:
        val = float(raw)
    except ValueError:
        return None
    if val <= 0 or val > 500:
        return None
    return val


def _extract_flute_count(text: str) -> Optional[int]:
    raw = _find_first_group(_FLUTE_PATTERNS, text)
    if raw is None:
        return None
    try:
        n = int(raw)
    except ValueError:
        return None
    if n <= 0 or n > 20:
        return None
    return n


def _extract_material_tag(text: str) -> Optional[str]:
    for pattern, tag in _MATERIAL_CUES:
        if pattern.search(text):
            return tag
    return None


def _extract_subtype(text: str) -> Optional[str]:
    for pattern, value in _SUBTYPE_CUES:
        if pattern.search(text):
            return value
    return None


def _extract_tool_type(text: str) -> Optional[str]:
    if _INDEXABLE_RE.search(text):
        return "Indexable_Tools"
    if _SOLID_TOOL_RE.search(text):
        return "Solid"
    return None


def _extract_coating(text: str) -> Optional[str]:
    low = text.lower()
    for v in sorted(_COATING_VALUES, key=len, reverse=True):
        if v.lower() in low:
            return v
    return None


def parse(message: str) -> Optional[SCRIntent]:
    """Regex prefilter. Returns SCRIntent if ≥2 high-signal fields hit,
    otherwise None so the caller can fall back to LLM SCR."""
    if not message:
        return None

    diameter = _extract_diameter(message)
    flute_count = _extract_flute_count(message)
    material_tag = _extract_material_tag(message)
    subtype = _extract_subtype(message)
    tool_type = _extract_tool_type(message)
    coating = _extract_coating(message)

    # confidence: need at least one strong cue (diameter/flute/material/subtype).
    # tool_type alone (e.g. just "엔드밀") is too weak — falls back to LLM.
    strong_hits = sum(
        1 for v in (diameter, flute_count, material_tag, subtype) if v is not None
    )
    if strong_hits < 1:
        return None

    return SCRIntent(
        diameter=diameter,
        flute_count=flute_count,
        material_tag=material_tag,
        tool_type=tool_type,
        subtype=subtype,
        brand=None,
        coating=coating,
    )
