"""DB-backed clarification helper.

When the user's intent is ambiguous (lots of candidates, few filters set), this
module inspects the *actual* DB facet distribution under the current filters
and suggests the 1–2 fields whose values most-differentiate the remaining
candidates. Returned as structured chip groups so the chat layer can render
them as one-click narrowers.

Design notes:
  - Operates on the in-memory index (product_index.load_index + _matches) so
    it adds no per-request DB round-trip. ~125k rows scan in <200ms.
  - Sorts candidate fields by entropy over their value distribution — a
    field with 800 rows at 30° and 800 at 45° is more useful than a field
    with 1590 at 30° and 10 at 45°.
  - Skips fields the user already pinned in the filter dict.
  - Caps result to the top 2 fields × top 6 values so chips stay scannable.
"""
from __future__ import annotations

import math
from typing import Any, Optional

from config import CLARIFY_MAX_FIELDS, CLARIFY_MIN_CANDIDATES
from product_index import load_index, _matches

# Fields the clarifier considers as candidates to surface chips for. Kept
# separate from search.FIELD_TO_EXPR so a pure-UI toggle field (like country)
# doesn't flood the clarification flow with geography chips.
CLARIFY_FIELDS: list[tuple[str, str, str, bool]] = [
    # (filter-key, column, human label ko, is_numeric)
    ("helix_angle", "milling_helix_angle", "헬릭스각(°)", True),
    ("point_angle", "holemaking_point_angle", "선단각(°)", True),
    ("thread_pitch", "threading_pitch", "피치(mm)", True),
    ("thread_tpi", "threading_tpi", "TPI", True),
    ("diameter_tolerance", "milling_diameter_tolerance", "직경공차", False),
    ("ball_radius", "milling_ball_radius", "볼반경(mm)", True),
    ("flute_count", "flutes", "날수", True),
    ("subtype", "subtype", "형상", False),
    ("coating", "coating", "코팅", False),
    ("brand", "brand", "브랜드", False),
    ("tool_material", "milling_tool_material", "공구재질", False),
    ("shank_type", "search_shank_type", "샹크", False),
    ("coolant_hole", "milling_coolant_hole", "냉각(밀링)", False),
    ("unit_system", "edp_unit", "단위", False),
]

_MIN_BUCKET = 5        # ignore values that appear < this many times
_MAX_BUCKETS_PER_FIELD = 6
_MIN_ENTROPY = 0.5     # log-scale; 0 = single-value, >0.5 ≈ at least 2 bins


def _entropy(counts: list[int]) -> float:
    total = sum(counts)
    if total <= 0:
        return 0.0
    h = 0.0
    for c in counts:
        if c <= 0:
            continue
        p = c / total
        h -= p * math.log2(p)
    return h


def _bucket_rows(
    index_rows: list[dict],
    col: str,
    is_numeric: bool,
) -> list[tuple[str, int]]:
    """Group index rows by the column's raw value. Numeric columns pass the
    text through _to_numeric_str semantics (leaf display format preserved) so
    chips render the DB's actual spelling ("30" not "30.0")."""
    counts: dict[str, int] = {}
    for r in index_rows:
        v = r.get(col)
        if v is None:
            continue
        s = str(v).strip()
        if not s:
            continue
        if is_numeric:
            # Strip decorations like "30°" / "45N" so near-duplicate bins
            # collapse to the same chip — raw value still shown for clarity
            # on the chip label builder side.
            norm = s.replace("°", "").replace("N", "").strip()
            if not norm:
                continue
            counts[norm] = counts.get(norm, 0) + 1
        else:
            counts[s] = counts.get(s, 0) + 1
    return sorted(counts.items(), key=lambda x: (-x[1], x[0]))


def suggest_clarifying_chips(
    current_filters: dict,
    *,
    min_candidates: int = CLARIFY_MIN_CANDIDATES,
    max_fields: int = CLARIFY_MAX_FIELDS,
) -> dict[str, Any]:
    """Return a dict shaped for the chat layer's chip-groups mechanism.

    Output:
      {
        "candidate_count": int,
        "groups": [
          {"field": "helix_angle", "label": "헬릭스각(°)",
           "chips": [{"value": "30", "count": 812}, ...]},
          ...
        ]
      }

    Returns `{candidate_count, groups: []}` when:
      - the filtered set is small (≤ min_candidates) — no clarification needed
      - no field yields entropy above _MIN_ENTROPY under the current filters
    """
    index = load_index()
    if not index:
        return {"candidate_count": 0, "groups": []}

    # Scope: apply the current filter dict once and reuse the matched slice
    # for every field's facet calc. Inventory gates can't run on the index
    # (they live on sister tables) — but that's OK: the caller only hits
    # this helper to *propose* narrowings, and narrowing down a superset
    # doesn't produce an incorrect chip.
    scoped_filters = {k: v for k, v in current_filters.items() if v is not None}
    matched = [r for r in index if _matches(r, scoped_filters)]
    candidate_count = len(matched)

    if candidate_count <= min_candidates:
        return {"candidate_count": candidate_count, "groups": []}

    # Score each unspecified field by entropy × coverage.
    scored: list[tuple[float, dict]] = []
    for key, col, label, is_numeric in CLARIFY_FIELDS:
        if scoped_filters.get(key) is not None:
            continue
        buckets = _bucket_rows(matched, col, is_numeric)
        if not buckets:
            continue
        # Drop long tail so a noisy field (e.g. brand with 60 variants) scores
        # fairly — entropy over the TOP-N bins, not the full distribution.
        top_bins = [
            (v, c) for v, c in buckets[:_MAX_BUCKETS_PER_FIELD] if c >= _MIN_BUCKET
        ]
        if len(top_bins) < 2:
            continue
        ent = _entropy([c for _, c in top_bins])
        if ent < _MIN_ENTROPY:
            continue
        coverage = sum(c for _, c in top_bins) / max(candidate_count, 1)
        score = ent * coverage
        scored.append((
            score,
            {
                "field": key,
                "label": label,
                "chips": [{"value": v, "count": c} for v, c in top_bins],
            },
        ))

    scored.sort(key=lambda x: -x[0])
    groups = [g for _, g in scored[:max_fields]]
    return {"candidate_count": candidate_count, "groups": groups}


def format_chips_for_prompt(result: dict[str, Any]) -> str:
    """Render the suggest_clarifying_chips() output as a compact string the
    chat prompt can embed under [clarify]. Empty string when nothing to ask."""
    groups = result.get("groups") or []
    if not groups:
        return ""
    lines = [f"candidate_count: {result.get('candidate_count', 0)}"]
    for g in groups:
        preview = " · ".join(
            f"{c['value']}({c['count']})" for c in (g.get("chips") or [])[:6]
        )
        lines.append(f"{g['label']} [{g['field']}]: {preview}")
    return "\n".join(lines)
