"""Domain-knowledge retrieval — lightweight JSON RAG for the chat path.

Loads four curated knowledge files from data/domain-knowledge/ once per
process and offers a single `search_knowledge(query)` that returns the
best-matching entries across all four types. The match is string-based
(substring on the symptom / alias / material / coating fields) — fast,
deterministic, no embedding model needed.
"""
from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any

# Symptoms/aliases in the knowledge base often bundle multiple terms in one
# string ("떨림/진동", "칩 엉킴, 감김"). Split on these separators so each
# atomic term can substring-match against the query individually.
_TERM_SPLIT = re.compile(r"[/,·・|]+|\s{2,}")

_BASE_DIR = Path(__file__).resolve().parent / "data"

# (subdir, filename, logical type label) — kept in load order so the type tag
# in the result list is stable across runs.
_SOURCES: list[tuple[str, str, str]] = [
    ("domain-knowledge", "troubleshooting.json", "troubleshooting"),
    ("domain-knowledge", "material-coating-guide.json", "material-coating-guide"),
    ("domain-knowledge", "operation-guide.json", "operation-guide"),
    ("domain-knowledge", "coating-properties.json", "coating-properties"),
    # Pre-generated product/feature QA — series-keyed lookup. Step 1 of the
    # RAG plan: string join, no embedding. Step 2 (pgvector) comes later.
    ("knowledge/qa", "product_knowledge_qa.json", "product_qa"),
    ("knowledge/qa", "feature_to_product_qa.json", "feature_qa"),
]

# Lazy cache — populated on first search_knowledge() call.
_KNOWLEDGE: dict[str, list[dict]] | None = None


def _load_knowledge() -> dict[str, list[dict]]:
    global _KNOWLEDGE
    if _KNOWLEDGE is not None:
        return _KNOWLEDGE
    out: dict[str, list[dict]] = {}
    for subdir, fname, tag in _SOURCES:
        path = _BASE_DIR / subdir / fname
        try:
            with path.open(encoding="utf-8") as f:
                data = json.load(f)
        except FileNotFoundError:
            out[tag] = []
            continue
        if isinstance(data, list):
            out[tag] = data
        elif isinstance(data, dict):
            # Some files wrap the list under a key; take the first list-valued
            # field rather than hardcoding each schema.
            lst = next((v for v in data.values() if isinstance(v, list)), [])
            out[tag] = lst
        else:
            out[tag] = []
    _KNOWLEDGE = out
    return _KNOWLEDGE


def reset_cache() -> None:
    """Drop the in-process knowledge cache; next call reloads from disk."""
    global _KNOWLEDGE
    _KNOWLEDGE = None


def _contains_any(query: str, candidates: list[Any]) -> tuple[bool, int]:
    """Return (hit, score). score rewards longer alias matches so a specific
    hit like '칩 엉킴' beats a generic one like '칩'.

    Each candidate is split on '/', ',' etc. before matching so bundled
    strings like '떨림/진동' still hit on '떨림'."""
    if not candidates:
        return False, 0
    best = 0
    q = query.lower()
    for c in candidates:
        if not c:
            continue
        raw = str(c).strip().lower()
        if not raw:
            continue
        parts = [p.strip() for p in _TERM_SPLIT.split(raw) if p.strip()]
        if not parts:
            parts = [raw]
        for part in parts:
            if len(part) < 2:
                continue
            if part in q:
                best = max(best, len(part))
    return best > 0, best


def _score_troubleshooting(query: str, item: dict) -> int:
    sym = item.get("symptom") or ""
    aliases = item.get("aliases") or []
    _, score_sym = _contains_any(query, [sym])
    _, score_al = _contains_any(query, aliases)
    return max(score_sym, score_al)


def _score_material(query: str, item: dict) -> int:
    mat = item.get("material") or ""
    iso = item.get("iso_group") or ""
    _, s = _contains_any(query, [mat])
    # ISO single-letter groups collide with random letters in prose — require
    # that the token appears as an explicit "M/P/K" chunk separated by spaces
    # or punctuation before we credit it. Substring-as-is is enough for the
    # material name itself.
    q = query.lower()
    iso_s = 0
    if iso:
        iso_lc = iso.lower()
        for sep_pat in (f" {iso_lc} ", f" {iso_lc}", f"{iso_lc} "):
            if sep_pat in f" {q} ":
                iso_s = len(iso_lc) + 2  # boost so exact ISO hits outrank generic "수스"
                break
    return max(s, iso_s)


def _score_operation(query: str, item: dict) -> int:
    op = item.get("operation") or ""
    aliases = item.get("aliases") or []
    _, s_op = _contains_any(query, [op])
    _, s_al = _contains_any(query, aliases)
    return max(s_op, s_al)


def _score_coating(query: str, item: dict) -> int:
    name = item.get("coating_name") or ""
    _, s = _contains_any(query, [name])
    return s


# QA matching — series/brand/feature keys must be reasonably specific to
# avoid false hits (e.g. a 1-char brand matching every query). Product QA
# covers 2k+ series so we also disambiguate multi-category hits on the same
# series using a small intent-keyword boost (e.g. "특징" → category=feature).
_QA_MIN_KEY_LEN = 3

# category tag → substrings in the query that hint at that category.
_CATEGORY_HINTS: dict[str, tuple[str, ...]] = {
    "feature": ("특징", "특성", "장점"),
    "product_overview": ("뭐야", "뭔가요", "뭔가", "뭐냐", "어떤 시리즈", "소개"),
    "brand_overview": ("뭐야", "뭔가요", "소개", "어떤 회사", "어떤 브랜드"),
    "application": ("어디에", "어디 써", "어디에 써", "용도", "어디서"),
    "material_target": ("어떤 소재", "어느 소재", "재질", "소재"),
    "tool_shape": ("사양", "스펙", "규격", "사이즈"),
    "selection": ("추천", "골라", "선택"),
    "coating_material": ("코팅", "표면처리"),
    "brand_application": ("용도", "어디"),
    "brand_lineup": ("라인업", "어떤 제품", "뭐 있", "종류"),
}


def _category_boost(query: str, category: str | None) -> int:
    if not category:
        return 0
    hints = _CATEGORY_HINTS.get(category, ())
    q = query.lower()
    for h in hints:
        if h.lower() in q:
            return 5
    return 0


def _token_match(query: str, token: str | None) -> int:
    """Case-insensitive substring match for QA keys (series/brand/feature).
    Guards against short tokens that collide with prose."""
    if not token:
        return 0
    t = str(token).strip()
    if len(t) < _QA_MIN_KEY_LEN:
        return 0
    return len(t) if t.lower() in query.lower() else 0


def _score_product_qa(query: str, item: dict) -> int:
    series_s = _token_match(query, item.get("series"))
    brand_s = _token_match(query, item.get("brand"))
    if series_s == 0 and brand_s == 0:
        return 0
    # Series match is stronger than brand alone — 'E5D72' is more specific
    # than 'ALU-CUT' (which covers 10+ series). Weight accordingly.
    base = series_s * 3 + brand_s * 2
    return base + _category_boost(query, item.get("category"))


def _score_feature_qa(query: str, item: dict) -> int:
    fv = _token_match(query, item.get("feature_value"))
    if fv == 0:
        # Fall back to first-phrase match on the canned question so
        # paraphrased asks still hit (e.g. "알루미늄용 제품 뭐 있어?"
        # matches "알루미늄 가공에 적합한 제품은?" via substring 알루미늄).
        q_text = item.get("question") or ""
        # Extract the question's subject noun-ish prefix (before 가공/용/에).
        head = re.split(r"[ \u00A0]가공|용|에 ", q_text, maxsplit=1)[0].strip()
        return _token_match(query, head)
    return fv * 2


_SCORERS = {
    "troubleshooting": _score_troubleshooting,
    "material-coating-guide": _score_material,
    "operation-guide": _score_operation,
    "coating-properties": _score_coating,
    "product_qa": _score_product_qa,
    "feature_qa": _score_feature_qa,
}


def search_knowledge(query: str, top_k: int = 3) -> list[dict]:
    """Cross-source knowledge lookup. Returns up to `top_k` matches sorted
    by match strength (longer exact-substring hit wins). Each result is
    `{"type": <source>, "data": <full entry>}`."""
    if not query:
        return []
    knowledge = _load_knowledge()
    ranked: list[tuple[int, str, dict]] = []
    for tag, items in knowledge.items():
        scorer = _SCORERS.get(tag)
        if not scorer:
            continue
        for item in items:
            if not isinstance(item, dict):
                continue
            s = scorer(query, item)
            if s > 0:
                ranked.append((s, tag, item))
    ranked.sort(key=lambda x: x[0], reverse=True)
    return [{"type": tag, "data": item} for _, tag, item in ranked[:top_k]]
