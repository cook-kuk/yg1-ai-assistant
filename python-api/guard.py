"""Hallucination guard — strip SKU-like tokens that don't exist in the DB.

LLM answers occasionally invent model numbers ("YG-EM4010", "VX-Power 99")
that pattern-match a SKU but aren't in prod_catalog. We load the known
brand + series universe at startup, protect a SAFE_WORDS vocabulary
(ISO codes, coatings, thread specs, abbreviations), and drop anything
else that looks SKU-shaped.

Cache: known_brands / known_series are loaded once per process. Call
refresh_cache() in tests to reset.
"""

from __future__ import annotations

import re
import time
from typing import Optional


# ── SAFE_WORDS — never scrub these even if SKU-shaped ─────────────
SAFE_WORDS: set[str] = {
    # ISO material groups
    "P", "M", "K", "N", "S", "H", "O",
    # Coatings
    "TIALN", "ALTIN", "ALCRN", "TICN", "TIN", "DLC", "CBN", "PCD",
    "Y-COATING", "X-COATING", "Z-COATING", "XC-COATING", "RCH-COATING",
    # Material codes
    "SUS304", "SUS316", "SUS316L", "SUS420", "SUS630",
    "S45C", "S50C", "SM45C", "SCM415", "SCM440", "SKD11", "SKD61", "SKH51",
    "A6061", "A7075", "A5052", "A2024",
    "FC200", "FC250", "FC300", "FCD400", "FCD450", "FCD500",
    "TI6AL4V", "IN718", "IN625",
    # Tap tolerances
    "6H", "6G", "7H", "6HX", "4H", "5H",
    # Hardness
    "HRC", "HRB", "HV",
    # Thread specs
    "UNC", "UNF", "UNEF", "NPT", "BSPT", "BSP",
    # Common abbreviations
    "LOC", "OAL", "CL", "HSK", "BT", "CAT", "ER", "HSS", "MQL", "HPC",
    # Tool types
    "YG1", "YG-1",
}

# SKU-like token: letters+digits mix or A-Z{2+}-\d+ shapes.
# Matches things like "EM4010", "XP-50A", "YG-EM4010", "VX99".
# Deliberately broad; SAFE_WORDS + known-sets prune the false positives.
_SKU_RE = re.compile(r"\b[A-Z][A-Z0-9]*-?[A-Z0-9]*\d+[A-Z0-9-]*\b")

# Empty parens "( )" and runs of commas/spaces left over after removal.
_EMPTY_PAREN_RE = re.compile(r"\(\s*\)")
_MULTI_COMMA_RE = re.compile(r",\s*,+")
_MULTI_SPACE_RE = re.compile(r"[ \t]{2,}")


# ── known-set cache ─────────────────────────────────────────────────
_CACHE_TTL_SEC = 3600.0
_cache: dict[str, object] = {
    "brands": None,
    "series": None,
    "loaded_at": 0.0,
}


def _load_known() -> tuple[set[str], set[str]]:
    """Load {brand, series} from product MV. Empty sets if DB unreachable —
    in that degraded mode the guard falls back to SAFE_WORDS-only."""
    try:
        from db import fetch_all
        rows = fetch_all(
            """
            SELECT DISTINCT
              UPPER(BTRIM(edp_brand_name)) AS brand,
              UPPER(BTRIM(edp_series_name)) AS series
            FROM catalog_app.product_recommendation_mv
            WHERE edp_brand_name IS NOT NULL OR edp_series_name IS NOT NULL
            """
        )
    except Exception:
        return set(), set()

    brands: set[str] = set()
    series: set[str] = set()
    for r in rows:
        if r.get("brand"):
            brands.add(str(r["brand"]))
        if r.get("series"):
            series.add(str(r["series"]))
    return brands, series


def _ensure_cache() -> tuple[set[str], set[str]]:
    now = time.time()
    if (
        _cache["brands"] is None
        or _cache["series"] is None
        or now - float(_cache["loaded_at"]) > _CACHE_TTL_SEC  # type: ignore[arg-type]
    ):
        brands, series = _load_known()
        _cache["brands"] = brands
        _cache["series"] = series
        _cache["loaded_at"] = now
    return _cache["brands"], _cache["series"]  # type: ignore[return-value]


def refresh_cache() -> None:
    _cache["brands"] = None
    _cache["series"] = None
    _cache["loaded_at"] = 0.0


def set_known(brands: set[str], series: set[str]) -> None:
    """Test hook: inject known sets directly and bypass DB load."""
    _cache["brands"] = {b.upper() for b in brands}
    _cache["series"] = {s.upper() for s in series}
    _cache["loaded_at"] = time.time()


def _is_safe(
    token: str,
    brands: set[str],
    series: set[str],
    extra: set[str],
) -> bool:
    up = token.upper()
    if up in SAFE_WORDS:
        return True
    if up in brands or up in series or up in extra:
        return True
    # Substring match — DB brand/series values often include spaces or
    # subscripts (e.g. "V7 MILL-INOX") that the LLM drops, so we also
    # accept the bare token when it appears as a sub-token of a known name.
    for s in brands:
        if up in s:
            return True
    for s in series:
        if up in s:
            return True
    for s in extra:
        if up in s:
            return True
    return False


def scrub(text: str, extra_safe: Optional[set[str]] = None) -> tuple[str, list[str]]:
    """Remove SKU-shaped tokens not in {SAFE_WORDS ∪ known_brands ∪ known_series ∪ extra_safe}.
    Returns (cleaned_text, removed_tokens)."""
    if not text:
        return text, []

    brands, series = _ensure_cache()
    extra = {s.upper() for s in (extra_safe or set()) if s}
    removed: list[str] = []

    def _replace(match: re.Match[str]) -> str:
        token = match.group(0)
        if _is_safe(token, brands, series, extra):
            return token
        removed.append(token)
        return ""

    cleaned = _SKU_RE.sub(_replace, text)

    # tidy up
    cleaned = _EMPTY_PAREN_RE.sub("", cleaned)
    cleaned = _MULTI_COMMA_RE.sub(",", cleaned)
    cleaned = _MULTI_SPACE_RE.sub(" ", cleaned)
    cleaned = re.sub(r"\s+([,.!?])", r"\1", cleaned)
    cleaned = cleaned.strip()

    return cleaned, removed
