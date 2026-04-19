"""Regex + keyword SSOT — anything that looks for specific Korean /
English phrases in user messages lives here, not inline in the caller.

Mirrors the TypeScript side's `lib/patterns.ts`. Touchpoints:
  scr.py    — negation cues, Korean flute map, material slang,
              brand-fuzzy denylist, double-negation patterns
  chat.py   — dual-CoT signals (compare / why / trouble / dissat)
  main.py   — follow-up narrow phrases, brand-exclusion regex

Keep tuples/frozensets (immutable) so a downstream mutation can't
silently corrupt the other callers' view.
"""
from __future__ import annotations

import re

# ══════════════════════════════════════════════════════════════════════
# SCR — negation
# ══════════════════════════════════════════════════════════════════════
# Korean negation cues appear AFTER the excluded term ("CRX-S 말고 …");
# English cues appear BEFORE ("no DLC"). Split so we can scan the right
# side of the brand token for KR and the left side for EN.
NEG_CUE_KR_AFTER = re.compile(
    r"(말고|제외|빼고|아닌|아니고|없이|제외하고|필요\s*없|원치\s*않|원하지\s*않|안\s*써|싫어)",
)

NEG_CUE_EN_BEFORE = re.compile(
    r"(\bno\b|\bnot\b|\bexcept\b|\bwithout\b)",
    re.IGNORECASE,
)

# Double-negation ("X 아니면 제외" = "keep only X"). When any of these
# phrases appears in the message, we short-circuit _is_brand_excluded so
# the term stays INCLUDED rather than getting nulled.
DOUBLE_NEG_PATTERNS: tuple[str, ...] = (
    "아니면 제외", "아니면 빼", "아닌 건 제외", "아닌 거 빼",
    "아니면 빼고", "아니면 빼줘",
)

# Broader negation regex used by main.py's brand-exclusion detector —
# covers more conversational variants than the tight KR_AFTER list.
NEG_BRAND_RE = re.compile(
    r"(필요\s*없|빼\s*줘|빼고|제외|원치\s*않|원하지\s*않|"
    r"안\s*써|안\s*해|이미\s*(샀|구매|있)|말고|별로|싫)",
)

# ══════════════════════════════════════════════════════════════════════
# SCR — Korean flute count normalization
# ══════════════════════════════════════════════════════════════════════
# "두날" → "2날" rewrite so the LLM always sees the digit form regardless
# of how the user spelled it. Deterministic mapping, no ambiguity.
KR_FLUTE_RE = re.compile(r"(한|두|세|네|다섯|여섯|일곱|여덟)\s*날")

KR_FLUTE_NUM: dict[str, str] = {
    "한": "1", "두": "2", "세": "3", "네": "4",
    "다섯": "5", "여섯": "6", "일곱": "7", "여덟": "8",
}

# ══════════════════════════════════════════════════════════════════════
# SCR — material slang
# ══════════════════════════════════════════════════════════════════════
# Industry konglish + pure-Korean shortcuts the CSV-normalized lookup
# can't see. First-wins O(1) scan in _pre_resolve_material. Pure Korean
# only; English aliases are already in material_mapping CSV.
MATERIAL_SLANG: dict[str, str] = {
    "스뎅": "M", "스댕": "M", "스텡": "M", "스텐": "M", "서스": "M",
    "에스유에스": "M", "수스": "M", "스텐레스": "M",
    "알미늄": "N", "두랄루민": "N", "놋쇠": "N",
    "인코": "S", "하스텔로이": "S",
    "초경강": "H", "열처리강": "H", "금형강": "H",
    "주물": "K", "회주철": "K", "덕타일": "K",
}

# ══════════════════════════════════════════════════════════════════════
# SCR — brand fuzzy denylist
# ══════════════════════════════════════════════════════════════════════
# Generic English nouns that the fuzzy fallback would prefix-match to
# category-style brands ("tool" → "Tooling System"). These aren't brand
# references — they're the user describing what kind of cutter.
BRAND_FUZZY_DENYLIST: frozenset[str] = frozenset({
    "tool", "tools", "tooling",
    "mill", "mills", "milling",
    "insert", "inserts",
    "cutter", "cutters",
    "turning",
    "drill", "drills",
    "endmill", "endmills",
})

# ══════════════════════════════════════════════════════════════════════
# Chat — dual-CoT escalation signals
# ══════════════════════════════════════════════════════════════════════
# Each signal crosses the strong-threshold (config.DUAL_COT_STRONG_THRESHOLD=3)
# on its own, so a compare-or-why-or-trouble query alone routes to Strong.
# Dissatisfaction (follow-up "아니") likewise forces Strong since the
# user is explicitly asking us to reconsider.
COMPARE_SIGNALS: tuple[str, ...] = (
    "비교", "차이", "뭐가 나아", "어떤 게", "vs", "장단점", "둘 중", "어느 게",
)

WHY_SIGNALS: tuple[str, ...] = (
    "왜", "이유", "근거", "어째서", "왜냐", "because",
)

TROUBLE_SIGNALS: tuple[str, ...] = (
    "떨림", "파손", "수명", "마모", "채터", "진동",
    "깨짐", "부러", "문제", "안 돼", "안돼", "이상", "불량",
)

DISSAT_SIGNALS: tuple[str, ...] = (
    "아니", "그거 말고", "다시", "다른 거", "다른거",
    "안 맞", "안맞", "틀렸", "말고",
)

# ══════════════════════════════════════════════════════════════════════
# Main — follow-up narrow phrases
# ══════════════════════════════════════════════════════════════════════
# When the message contains one of these we intersect the new search
# with session.previous_products. Without them vague follow-ups would
# permanently cap the candidate pool at the last turn's top-50.
NARROW_PHRASES: tuple[str, ...] = (
    "이 중에서", "이 중", "그 중에서", "그 중", "그중",
    "여기서", "여기 중", "여기에서",
    "저 중에서", "저 중",
    "이거 중", "이중에",
    "in this", "from these",
)

# ══════════════════════════════════════════════════════════════════════
# Dialogue manager — fresh request vs. follow-up classification
# ══════════════════════════════════════════════════════════════════════
# Verbs that read as "start a new product recommendation". When any of
# these co-occurs with a fresh anchor in the current turn, dialogue_manager
# treats it as a fresh request and drops prior filter context.
FRESH_REQUEST_VERBS: tuple[str, ...] = (
    # Korean
    "추천", "보여줘", "보여주세요", "찾아줘", "찾아주세요",
    "알려줘", "알려주세요", "보고 싶어", "보고싶어",
    "골라줘", "뽑아줘", "제안",
    # English
    "recommend", "show me", "suggest", "find me", "looking for",
)

# Phrases that explicitly mean "stay within the prior turn's result set".
# If any of these appears in the raw message it's a genuine follow-up and
# we do NOT apply the fresh-request reset even if the user named a new slot.
FOLLOWUP_HINTS: tuple[str, ...] = (
    "이 중에서", "이중에서", "그 중에서", "그중에서", "위에서", "위 제품",
    "방금", "이것들 중", "거기서", "위에 나온", "이 리스트", "그 리스트",
    "from these", "among these", "from the list", "of these",
)

# ══════════════════════════════════════════════════════════════════════
# Index dedupe — uncoated-tier coating labels
# ══════════════════════════════════════════════════════════════════════
# When product_recommendation_mv has multiple rows for the same EDP, we
# keep the coated variant over these "no-coat" labels. Case-insensitive
# membership; compare with s.upper() in s.upper() for "BRIGHT FINISH".
UNCOATED_LABELS: frozenset[str] = frozenset({
    "UNCOATED", "BRIGHT FINISH",
})
