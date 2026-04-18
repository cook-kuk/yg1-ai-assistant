"""In-memory mirror of product_recommendation_mv.

Loaded once on server startup (125k rows × ~500 bytes ≈ 60 MB) and refreshed
every 2 hours via a daemon Timer thread. `/products` uses `search_products_fast`
which filters the cached list in Python — no DB round-trip per request.

`/recommend` still goes through search.py to preserve golden-test determinism.
"""
from __future__ import annotations

import re
import threading
from typing import Any, Optional

from db import fetch_all
from search import SELECT_COLS, MV_TABLE

_INDEX: list[dict] | None = None
_LOCK = threading.Lock()
_REFRESH_INTERVAL_SEC = 2 * 60 * 60  # 2 hours
_DEFAULT_DIAMETER_TOLERANCE = 0.10   # ±10%, matches search_products heuristic

_NUMERIC_RE = re.compile(r"^-?\d+(?:\.\d+)?$")

# Coatings in the MV are stored as composite strings ("TiCN+Al2O3+TiN",
# "AlCrN/TiN"). The user usually asks for one layer ("TiCN"), so split on
# +, /, -, whitespace and test for token subset inclusion.
_COATING_SPLIT = re.compile(r"[+/\-\s]+")


def _tokenize_coating(s: Any) -> set[str]:
    if not s:
        return set()
    return {t.strip().lower() for t in _COATING_SPLIT.split(str(s)) if t.strip()}


def _coating_match(db_coat: Any, filter_coat: Any) -> bool:
    """True when the user's coating is a token-level subset of the row's
    coating composite. Handles both exact layer names and partial tokens
    (e.g. "TiN" matches "TiCN" by substring within the token)."""
    db_tokens = _tokenize_coating(db_coat)
    filter_tokens = _tokenize_coating(filter_coat)
    if not db_tokens or not filter_tokens:
        return False
    if filter_tokens.issubset(db_tokens):
        return True
    # Last-resort substring — covers "TiN" asked against "TiAlN".
    return any(ft in dt for ft in filter_tokens for dt in db_tokens)


def _to_float(v: Any) -> Optional[float]:
    if v is None:
        return None
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def _to_numeric_str(v: Any) -> Optional[float]:
    """Cast DB-text numeric fields (e.g. '10', '10.5') to float. Rejects
    non-numeric rows like '10mm' or '1/2' the same way search_products does."""
    if v is None:
        return None
    s = str(v).strip()
    if not _NUMERIC_RE.match(s):
        return None
    try:
        return float(s)
    except ValueError:
        return None


def _row_matches_ilike(row_value: Any, needle: str) -> bool:
    if row_value is None:
        return False
    return needle.lower() in str(row_value).lower()


def _load_from_db() -> list[dict]:
    """Pull the whole MV (mill-family rows only, same base filter as
    search_products). Skips rows without a numeric diameter so downstream
    scoring never has to guess.

    The MV has ~1.6 rows per EDP (coating/finish variants) — we collapse
    them here so the index is unique-by-EDP. Without this, downstream
    totalCount reads as row count, not product count, and the candidate
    panel shows the same EDP card multiple times.
    """
    sql = f"""
        SELECT {SELECT_COLS}
        FROM {MV_TABLE}
        WHERE edp_root_category ILIKE %s
          AND milling_outside_dia IS NOT NULL
    """
    rows = fetch_all(sql, ("%mill%",))
    return _dedupe_by_edp(rows)


def _dedupe_by_edp(rows: list[dict]) -> list[dict]:
    """Keep one row per edp_no. Prefer rows with a meaningful coating over
    empty/UNCOATED when both exist — the coated variant is usually the one
    the customer actually receives."""
    best: dict[str, dict] = {}
    for r in rows:
        edp = r.get("edp_no")
        if not edp:
            continue
        prev = best.get(edp)
        if prev is None:
            best[edp] = r
            continue
        if _coating_rank(r.get("coating")) > _coating_rank(prev.get("coating")):
            best[edp] = r
    return list(best.values())


def _coating_rank(coating: Any) -> int:
    """Higher is more informative. Non-empty non-UNCOATED beats UNCOATED
    beats empty."""
    if coating is None:
        return 0
    s = str(coating).strip()
    if not s:
        return 0
    if s.upper() in ("UNCOATED", "BRIGHT FINISH"):
        return 1
    return 2


def load_index() -> list[dict]:
    """Populate the in-process index and schedule the periodic refresh.
    Safe to call multiple times — subsequent calls return the cached list."""
    global _INDEX
    with _LOCK:
        if _INDEX is not None:
            return _INDEX
        try:
            _INDEX = _load_from_db()
        except Exception:
            _INDEX = []
        _schedule_refresh()
    return _INDEX


def refresh() -> int:
    """Force-reload the index from DB. Returns the new row count."""
    global _INDEX
    try:
        new_rows = _load_from_db()
    except Exception:
        return len(_INDEX or [])
    with _LOCK:
        _INDEX = new_rows
    return len(new_rows)


def _schedule_refresh() -> None:
    timer = threading.Timer(_REFRESH_INTERVAL_SEC, _periodic)
    timer.daemon = True
    timer.start()


def _periodic() -> None:
    refresh()
    _schedule_refresh()


# ── in-memory filter engine ──────────────────────────────────────────────

def _matches(p: dict, f: dict) -> bool:
    # diameter exact (±10% by default)
    dia_target = f.get("diameter")
    if dia_target is not None:
        actual = _to_numeric_str(p.get("diameter"))
        if actual is None:
            return False
        lo = dia_target * (1.0 - _DEFAULT_DIAMETER_TOLERANCE)
        hi = dia_target * (1.0 + _DEFAULT_DIAMETER_TOLERANCE)
        if not (lo <= actual <= hi):
            return False

    # flute_count exact
    flute = f.get("flute_count")
    if flute is not None:
        actual_f = _to_numeric_str(p.get("flutes"))
        if actual_f is None or int(actual_f) != int(flute):
            return False

    # material_tag array membership
    mat = f.get("material_tag")
    if mat:
        tags = p.get("material_tags") or []
        if mat not in tags:
            return False

    # coating uses token-level subset match since DB stores composites.
    v = f.get("coating")
    if v and not _coating_match(p.get("coating"), v):
        return False

    # ILIKE-equivalent substring filters for the rest.
    for (key, col) in [
        ("tool_type", "tool_type"),
        ("subtype", "subtype"),
        ("brand", "brand"),
        ("shank_type", "search_shank_type"),
        ("machining_category", "tool_type"),
        ("application_shape", "series_application_shape"),
        ("coolant_hole", "milling_coolant_hole"),
    ]:
        v = f.get(key)
        if v and not _row_matches_ilike(p.get(col), str(v)):
            return False

    # tool_material — any of three columns
    tm = f.get("tool_material")
    if tm:
        if not any(
            _row_matches_ilike(p.get(col), str(tm))
            for col in ("milling_tool_material", "holemaking_tool_material", "threading_tool_material")
        ):
            return False

    # country — array membership (case-sensitive values like 'KOREA'/'EUROPE')
    country = f.get("country")
    if country:
        cc = p.get("country_codes") or []
        if country not in cc:
            return False

    # numeric ranges
    for (key_lo, key_hi, col, caster) in [
        ("diameter_min", "diameter_max", "diameter", _to_numeric_str),
        ("overall_length_min", "overall_length_max", "milling_overall_length", _to_numeric_str),
        ("length_of_cut_min", "length_of_cut_max", "milling_length_of_cut", _to_numeric_str),
        ("shank_diameter_min", "shank_diameter_max", "milling_shank_dia", _to_numeric_str),
        ("flute_count_min", "flute_count_max", "flutes", _to_numeric_str),
    ]:
        lo = f.get(key_lo)
        hi = f.get(key_hi)
        if lo is None and hi is None:
            continue
        val = caster(p.get(col))
        if val is None:
            return False
        if lo is not None and val < lo:
            return False
        if hi is not None and val > hi:
            return False

    return True


def search_products_fast(filters: dict, limit: int = 125_000) -> list[dict]:
    """Filter the cached index in Python. Mirrors search.search_products
    behavior so /products output stays identical to the DB path."""
    index = load_index()
    hits: list[dict] = []
    for p in index:
        if _matches(p, filters):
            hits.append(p)
            if len(hits) >= limit:
                break
    return hits


def index_size() -> int:
    return len(_INDEX) if _INDEX is not None else 0


# ── in-memory filter-option facets ───────────────────────────────────────

# Each option field → (accessor, is_list). For list-valued cells (material_tags,
# country_codes) we unnest each value into its own bucket to mirror the SQL
# `unnest()` behavior. Non-list fields use their string value as the bucket key.
_OPTION_FIELDS: dict[str, tuple[str, bool]] = {
    "subtype": ("subtype", False),
    "material_tag": ("material_tags", True),
    "coating": ("coating", False),
    "brand": ("brand", False),
    "flute_count": ("flutes", False),
    "tool_type": ("tool_type", False),
    "shank_type": ("search_shank_type", False),
    "tool_material": ("milling_tool_material", False),
    "coolant_hole": ("milling_coolant_hole", False),
    "country": ("country_codes", True),
}


def get_filter_options_fast(
    field: str,
    current_filters: dict,
    limit: int = 50,
) -> list[dict]:
    """In-memory GROUP BY + COUNT for a single filter field. Matches the
    DB-backed `search.get_filter_options` contract: returns up to `limit`
    `{value, count}` rows sorted by count desc, value asc.

    The caller's filter for `field` itself is excluded — so the toggle UI
    still sees sibling values that would widen (not narrow) the result."""
    spec = _OPTION_FIELDS.get(field)
    if spec is None:
        return []
    col, is_list = spec

    # Build an effective filter dict with the toggled-on field dropped,
    # so count totals reflect "if the user changes this field, how many
    # candidates would each alternative yield?"
    scoped = {k: v for k, v in current_filters.items() if k != field}

    counts: dict[str, int] = {}
    for p in load_index():
        if not _matches(p, scoped):
            continue
        if is_list:
            for raw in (p.get(col) or []):
                if raw in (None, ""):
                    continue
                key = str(raw)
                counts[key] = counts.get(key, 0) + 1
        else:
            raw = p.get(col)
            if raw in (None, ""):
                continue
            key = str(raw)
            counts[key] = counts.get(key, 0) + 1

    ordered = sorted(counts.items(), key=lambda x: (-x[1], x[0]))
    return [{"value": v, "count": c} for v, c in ordered[:limit]]


def count_products_fast(filters: dict) -> int:
    """Match count under the given filter dict — the in-memory analogue of
    search.product_count_filtered. Used by /filter-options for the
    total_with_current_filters figure."""
    index = load_index()
    n = 0
    for p in index:
        if _matches(p, filters):
            n += 1
    return n
