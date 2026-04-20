"""In-memory result refiner — port of yg1-ai-catalog-serve
`lib/recommendation/core/result-refiner.ts` extended with cross-field
distributions and broadening hints.

When the user drills down into an already-surfaced candidate set
("4날로 좁혀", "TiAlN 만"), the main pipeline would otherwise re-run
SCR + DB search + LLM. Instead, we filter session.last_ranked in
memory and emit a deterministic answer + structured refine chips. Each
chip carries the real candidate count, so the UI never suggests a
value that produces 0 results.

Public API:
    refine_in_memory(ranked, field, value, mode)
    compute_distribution(ranked, field, min_bucket, max_buckets)
    compute_cross_distribution(ranked, fields, top_n)
    compute_broadening_hints(ranked, current_filters)
    build_refine_chips(ranked, current_filters, include_counts, include_cross)

All functions are pure — no DB, no LLM, no session mutation. main.py
owns the session lifecycle; this module is a pure projection layer.
"""
from __future__ import annotations

from typing import Any, Iterable, Literal, Optional


# ── Field-type metadata ─────────────────────────────────────────────
# Tells refine_in_memory / compute_distribution how to treat each field's
# value space. `list` = multi-value column (material_tags), `numeric` =
# continuous value that benefits from bucketing, `categorical` = exact
# string match. Missing keys fall back to categorical.
_FIELD_KIND: dict[str, str] = {
    # list columns on the MV
    "material_tags": "list",
    # numeric — continuous, use buckets for distribution but exact match
    # for refine (user typically types an integer or an exact fraction)
    "diameter": "numeric",
    "flute_count": "numeric",
    "flutes": "numeric",
    "helix_angle": "numeric",
    "point_angle": "numeric",
    "ball_radius": "numeric",
    "thread_pitch": "numeric",
    "thread_tpi": "numeric",
    "shank_diameter": "numeric",
    "total_stock": "numeric",
    # everything else is categorical (coating, subtype, brand, …)
}

# Numeric bucket boundaries for distribution — boundaries intentionally
# conservative so a single-mm diff keeps separate chips on the common
# range but coarser bucketing kicks in for outliers.
_BUCKET_EDGES: dict[str, list[float]] = {
    "diameter": [0, 3, 6, 10, 16, 25, 50, 100],
    "flute_count": [1, 2, 3, 4, 5, 6, 8, 10],
    "flutes": [1, 2, 3, 4, 5, 6, 8, 10],
    "helix_angle": [0, 15, 25, 35, 45, 55, 90],
    "point_angle": [90, 110, 118, 130, 140, 180],
    "ball_radius": [0, 0.5, 1.0, 2.0, 5.0, 10.0],
    "total_stock": [0, 1, 5, 20, 100, 500, 1000],
}


def _row_value(row: dict, field: str) -> Any:
    """Defensive field read. Returns None on anything that can't be used
    for comparison (empty string, missing key, non-primitive unless list)."""
    if not isinstance(row, dict):
        return None
    v = row.get(field)
    if v is None:
        return None
    if isinstance(v, (list, tuple)):
        return list(v) or None
    if isinstance(v, str):
        s = v.strip()
        return s if s else None
    return v


def _to_number(v: Any) -> Optional[float]:
    if v is None or isinstance(v, bool):
        return None
    if isinstance(v, (int, float)):
        return float(v)
    if isinstance(v, str):
        try:
            return float(v.strip())
        except ValueError:
            return None
    return None


def _bucket_label(value: float, edges: list[float]) -> str:
    """Numeric → human-readable bucket ('3-6mm'). Picks the first edge
    pair the value falls into. Values outside the highest edge render
    as '>{last}'. Unit-less so different fields can reuse the helper."""
    if not edges:
        return str(value)
    if value < edges[0]:
        return f"<{edges[0]:g}"
    for i in range(len(edges) - 1):
        lo, hi = edges[i], edges[i + 1]
        if lo <= value < hi:
            # 3-6 range label; exact bound uses "="
            if hi - lo == 1:
                return f"{lo:g}"
            return f"{lo:g}-{hi:g}"
    return f">={edges[-1]:g}"


# ── 1. refine_in_memory ─────────────────────────────────────────────

def refine_in_memory(
    ranked: list[dict],
    field: str,
    value: Any,
    *,
    mode: Literal["narrow", "drop"] = "narrow",
) -> list[dict]:
    """Apply a single field/value filter to `ranked`.

    narrow: keep only rows where row[field] matches value
    drop:   keep only rows where row[field] does NOT match value

    Match semantics:
      - list fields (material_tags) — value ∈ row[field]
      - numeric fields — abs(row[field] - value)/|value| ≤ 1% (or
        exact when value is integer-ish)
      - string fields — case-insensitive equality

    Unknown field or None value: returns `ranked` unchanged (never
    raises — refine should degrade to no-op rather than error).
    """
    if not ranked or not field:
        return list(ranked or [])
    if value is None or (isinstance(value, str) and not value.strip()):
        return list(ranked)
    kind = _FIELD_KIND.get(field, "categorical")
    out: list[dict] = []
    for row in ranked:
        actual = _row_value(row, field)
        if actual is None:
            matched = False
        elif kind == "list":
            v_s = str(value).strip().lower()
            matched = any(str(x).strip().lower() == v_s for x in actual)
        elif kind == "numeric":
            av = _to_number(actual)
            vv = _to_number(value)
            if av is None or vv is None:
                matched = False
            elif vv == 0:
                matched = av == 0
            else:
                matched = abs(av - vv) / abs(vv) <= 0.01
        else:
            matched = str(actual).strip().lower() == str(value).strip().lower()
        if mode == "drop":
            matched = not matched
        if matched:
            out.append(row)
    return out


# ── 2. compute_distribution ─────────────────────────────────────────

def compute_distribution(
    ranked: list[dict],
    field: str,
    *,
    min_bucket: Optional[int] = None,
    max_buckets: Optional[int] = None,
) -> list[tuple[str, int]]:
    """Value → count aggregation for a single field. Numeric fields go
    through `_BUCKET_EDGES` first so we don't emit one chip per unique
    value. List fields unroll so each tag gets its own bucket.

    Returns `[(label, count), …]` descending by count, filtered to
    count ≥ min_bucket and truncated to max_buckets.
    """
    from config import REFINE_CHIP_MAX_PER_FIELD, REFINE_CHIP_MIN_BUCKET
    if min_bucket is None:
        min_bucket = REFINE_CHIP_MIN_BUCKET
    if max_buckets is None:
        max_buckets = REFINE_CHIP_MAX_PER_FIELD
    if not ranked or not field:
        return []
    kind = _FIELD_KIND.get(field, "categorical")
    counts: dict[str, int] = {}

    for row in ranked:
        actual = _row_value(row, field)
        if actual is None:
            continue
        if kind == "list":
            for tag in actual:
                key = str(tag).strip()
                if key:
                    counts[key] = counts.get(key, 0) + 1
        elif kind == "numeric":
            num = _to_number(actual)
            if num is None:
                continue
            edges = _BUCKET_EDGES.get(field)
            if edges:
                key = _bucket_label(num, edges)
            else:
                # No bucket edges → treat as exact value label
                key = f"{num:g}"
            counts[key] = counts.get(key, 0) + 1
        else:
            key = str(actual).strip()
            if key:
                counts[key] = counts.get(key, 0) + 1

    ranked_entries = sorted(
        ((k, c) for k, c in counts.items() if c >= min_bucket),
        key=lambda kv: (-kv[1], kv[0]),
    )
    return ranked_entries[:max_buckets]


# ── 3. compute_cross_distribution ────────────────────────────────────

def compute_cross_distribution(
    ranked: list[dict],
    fields: tuple[str, str],
    *,
    top_n: Optional[int] = None,
) -> list[tuple[tuple[str, str], int]]:
    """2-way value-pair → count. Inputs must be a 2-tuple of field names;
    output pairs are (valA, valB) with count descending. List fields
    cross-product into each tag. Numeric fields use the same bucket
    labels as compute_distribution so UI chips line up.
    """
    from config import REFINE_CROSS_TOP_N
    if top_n is None:
        top_n = REFINE_CROSS_TOP_N
    if not ranked or not fields or len(fields) != 2:
        return []
    f1, f2 = fields
    if f1 == f2:
        return []

    def _label_values(row: dict, field: str) -> list[str]:
        actual = _row_value(row, field)
        if actual is None:
            return []
        kind = _FIELD_KIND.get(field, "categorical")
        if kind == "list":
            return [str(x).strip() for x in actual if str(x).strip()]
        if kind == "numeric":
            num = _to_number(actual)
            if num is None:
                return []
            edges = _BUCKET_EDGES.get(field)
            if edges:
                return [_bucket_label(num, edges)]
            return [f"{num:g}"]
        s = str(actual).strip()
        return [s] if s else []

    counts: dict[tuple[str, str], int] = {}
    for row in ranked:
        for v1 in _label_values(row, f1):
            for v2 in _label_values(row, f2):
                key = (v1, v2)
                counts[key] = counts.get(key, 0) + 1
    return sorted(counts.items(), key=lambda kv: (-kv[1], kv[0]))[:top_n]


# ── 4. compute_broadening_hints ──────────────────────────────────────

def compute_broadening_hints(
    ranked: list[dict],
    current_filters: dict,
    *,
    full_pool: Optional[list[dict]] = None,
) -> list[tuple[str, int]]:
    """For each currently-active filter field, estimate how many MORE
    rows would appear if that single field were relaxed.

    When `full_pool` is supplied (e.g. product_index.load_index()), the
    delta reflects the real catalog impact. Otherwise we can't measure
    broadening against rows we don't have, and the function returns
    `[]` — caller should skip the hint in that case.

    Returns `[(field, delta), …]` with delta > 0, sorted descending.
    """
    if not current_filters or not full_pool:
        return []
    # Only numeric/categorical filter keys known to refine semantics
    # count — exclude UI-only / session flags.
    try:
        from config import REFINE_EXCLUDED_FIELDS
    except Exception:
        REFINE_EXCLUDED_FIELDS = []

    # Compute ranked count under current filters (approx — we have the
    # already-filtered `ranked` as the baseline).
    current_count = len(ranked)

    # Simulated pool — how many rows match current_filters MINUS one
    # field at a time. Built by filtering the full pool against all
    # filters except the one being relaxed.
    hints: list[tuple[str, int]] = []
    active_fields = [
        k for k, v in current_filters.items()
        if v is not None and v != "" and k not in REFINE_EXCLUDED_FIELDS
    ]
    for relax_field in active_fields:
        trial_filters = {k: v for k, v in current_filters.items() if k != relax_field}
        trial_count = _count_matches(full_pool, trial_filters)
        delta = trial_count - current_count
        if delta > 0:
            hints.append((relax_field, delta))
    return sorted(hints, key=lambda x: -x[1])


def _count_matches(pool: list[dict], filters: dict) -> int:
    """Minimal in-memory filter — only handles the exact-match semantics
    refine understands. Used for broadening hint estimation; real
    product search goes through search.py."""
    if not pool or not filters:
        return len(pool or [])
    scoped = {k: v for k, v in filters.items() if v is not None and v != ""}
    if not scoped:
        return len(pool)
    count = 0
    for row in pool:
        if all(_matches_single(row, k, v) for k, v in scoped.items()):
            count += 1
    return count


def _matches_single(row: dict, field: str, value: Any) -> bool:
    """One-field exact-match probe. Mirrors refine_in_memory semantics
    with mode='narrow' so the broadening delta is consistent."""
    kind = _FIELD_KIND.get(field, "categorical")
    actual = _row_value(row, field)
    if actual is None:
        return False
    if kind == "list":
        v_s = str(value).strip().lower()
        return any(str(x).strip().lower() == v_s for x in actual)
    if kind == "numeric":
        av = _to_number(actual)
        vv = _to_number(value)
        if av is None or vv is None:
            return False
        if vv == 0:
            return av == 0
        return abs(av - vv) / abs(vv) <= 0.01
    return str(actual).strip().lower() == str(value).strip().lower()


# ── 5. build_refine_chips ────────────────────────────────────────────

# Fields that make sense as refine chips. Drawn from the 카테고리형
# subset of Matrix C in Step 1. Prefix / identity fields handled by
# Phase 0 are explicitly excluded via config.REFINE_EXCLUDED_FIELDS.
_REFINE_CANDIDATE_FIELDS: tuple[str, ...] = (
    "subtype", "cutting_edge_shape",
    "coating", "brand", "tool_material", "shank_type",
    "flute_count", "flutes",
    "diameter",
    "material_tags",
    "unit_system",
    "stock_status",
)


def build_refine_chips(
    ranked: list[dict],
    current_filters: dict,
    *,
    include_counts: bool = True,
    include_cross: bool = False,
) -> list[dict]:
    """Emit structured refine chips for the frontend.

    Each chip: {field, value, label, count, action}
      - action ∈ {"narrow", "drop", "broaden"}
      - narrow: `refine_in_memory(..., mode="narrow", value=value)`
      - drop:   `refine_in_memory(..., mode="drop", value=value)`
      - broaden: signals "relax current filter on this field" (consumer
        re-runs full search minus this field)

    Skips fields the user already pinned (current_filters has a non-None
    value for it — narrowing further on the same value is a no-op) and
    fields in config.REFINE_EXCLUDED_FIELDS.
    """
    from config import REFINE_EXCLUDED_FIELDS, REFINE_CHIP_MAX_PER_FIELD
    if not ranked:
        return []
    excluded = set(REFINE_EXCLUDED_FIELDS or [])
    pinned = {k for k, v in (current_filters or {}).items() if v is not None and v != ""}

    chips: list[dict] = []
    for field in _REFINE_CANDIDATE_FIELDS:
        if field in excluded or field in pinned:
            continue
        dist = compute_distribution(ranked, field)
        if not dist:
            continue
        for value, count in dist[:REFINE_CHIP_MAX_PER_FIELD]:
            label = f"{value} ({count})" if include_counts else str(value)
            chips.append({
                "field": field,
                "value": value,
                "label": label,
                "count": count,
                "action": "narrow",
            })

    # Cross-field chips — surface top-N 2-way combinations when enabled.
    # Kept as distinct entries so the UI can group them separately (same
    # action="narrow" but payload carries both fields).
    if include_cross and len(ranked) >= 3:
        # Pick the two most-informative single fields (highest bucket count)
        # and cross them. Skips gracefully when only one field has > 1 bucket.
        scored_fields: list[tuple[str, int]] = []
        for field in _REFINE_CANDIDATE_FIELDS:
            if field in excluded or field in pinned:
                continue
            d = compute_distribution(ranked, field)
            if len(d) >= 2:
                scored_fields.append((field, len(d)))
        scored_fields.sort(key=lambda x: -x[1])
        if len(scored_fields) >= 2:
            f1, f2 = scored_fields[0][0], scored_fields[1][0]
            cross = compute_cross_distribution(ranked, (f1, f2))
            for (v1, v2), count in cross:
                chips.append({
                    "field": f"{f1}+{f2}",
                    "value": {f1: v1, f2: v2},
                    "label": f"{v1} · {v2} ({count})" if include_counts else f"{v1} · {v2}",
                    "count": count,
                    "action": "narrow",
                })
    return chips


# ── Prompt-side helper ──────────────────────────────────────────────

def format_cross_for_prompt(
    ranked: list[dict],
    current_filters: dict,
) -> str:
    """Compact line for LLM prompt injection — top-3 cross-field combos.
    Returns "" when the ranked set is too small or distributions are flat.
    """
    if not ranked or len(ranked) < 3:
        return ""
    try:
        from config import REFINE_EXCLUDED_FIELDS
    except Exception:
        REFINE_EXCLUDED_FIELDS = []
    excluded = set(REFINE_EXCLUDED_FIELDS or [])
    pinned = {k for k, v in (current_filters or {}).items() if v is not None and v != ""}

    scored: list[tuple[str, int]] = []
    for field in _REFINE_CANDIDATE_FIELDS:
        if field in excluded or field in pinned:
            continue
        d = compute_distribution(ranked, field)
        if len(d) >= 2:
            scored.append((field, len(d)))
    scored.sort(key=lambda x: -x[1])
    if len(scored) < 2:
        return ""
    f1, f2 = scored[0][0], scored[1][0]
    cross = compute_cross_distribution(ranked, (f1, f2))
    if not cross:
        return ""
    pairs = ", ".join(f"{v1}+{v2}={c}" for (v1, v2), c in cross)
    return f"{f1}×{f2}: {pairs}"
