"""public.glossary_terms lookup — cutting-tool vocabulary definitions.

Small DB table (~10 rows), loaded once into memory and matched via
term + alias substring. Feeds the chat path when the user is asking
about a concept ("플루트가 뭐야?") rather than a product.
"""
from __future__ import annotations

import re
import time
from typing import Optional

from db import fetch_all


_CACHE_TTL_SEC = 3600.0

_ROWS: list[dict] = []
_LOADED_AT: float = 0.0

_NORM_RE = re.compile(r"\s+")


def _norm(s: Optional[str]) -> str:
    return _NORM_RE.sub(" ", (s or "").strip().lower())


def _load_all() -> list[dict]:
    rows = fetch_all(
        """
        SELECT term, category, aliases, definition_en, definition_ko,
               yg1_offering, related_terms
        FROM public.glossary_terms
        """
    )
    out: list[dict] = []
    for r in rows:
        term = (r.get("term") or "").strip()
        if not term:
            continue
        out.append({
            "term": term,
            "category": r.get("category"),
            "aliases": list(r.get("aliases") or []),
            "definition_en": r.get("definition_en"),
            "definition_ko": r.get("definition_ko"),
            "yg1_offering": r.get("yg1_offering"),
            "related_terms": list(r.get("related_terms") or []),
        })
    return out


def _ensure_loaded() -> list[dict]:
    global _ROWS, _LOADED_AT
    now = time.time()
    if not _ROWS or now - _LOADED_AT > _CACHE_TTL_SEC:
        try:
            _ROWS = _load_all()
        except Exception:
            _ROWS = []
        _LOADED_AT = now
    return _ROWS


def refresh_cache() -> None:
    global _ROWS, _LOADED_AT
    _ROWS = []
    _LOADED_AT = 0.0


def search(query: str, top_k: int = 1) -> list[dict]:
    """Score each row by longest term/alias substring that appears in the
    query (case + whitespace insensitive). Requires ≥2-char matches so
    a bare 'H' doesn't light up every tag-like entry.

    Returns the raw row dicts (not wrapped in {type,data}) — rag.py does
    the wrapping so callers can treat this like the JSON-KB helpers."""
    if not query:
        return []
    q = _norm(query)
    if not q:
        return []
    rows = _ensure_loaded()
    if not rows:
        return []

    scored: list[tuple[int, dict]] = []
    for row in rows:
        best = 0
        candidates = [row["term"], *row.get("aliases", [])]
        for c in candidates:
            c_norm = _norm(c)
            if len(c_norm) < 2:
                continue
            if c_norm in q:
                if len(c_norm) > best:
                    best = len(c_norm)
        if best > 0:
            scored.append((best, row))

    scored.sort(key=lambda x: (-x[0], x[1]["term"]))
    return [r for _, r in scored[:top_k]]
