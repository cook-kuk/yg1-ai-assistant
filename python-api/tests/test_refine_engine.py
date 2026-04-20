"""Result Refiner — in-memory narrowing + distribution + chip builder.

25 tests across the 5 public functions + session integration. All
tests are pure — no DB, no LLM. Session integration tests exercise the
last_ranked / previous_products @property contract.
"""
from __future__ import annotations

import pytest

from refine_engine import (
    build_refine_chips,
    compute_broadening_hints,
    compute_cross_distribution,
    compute_distribution,
    format_cross_for_prompt,
    refine_in_memory,
)


# ── Fixtures ─────────────────────────────────────────────────────

@pytest.fixture
def ranked_small():
    """5-row mixed set — every distribution path exercises ≥2 buckets."""
    return [
        {"edp_no": "A", "subtype": "Square", "flute_count": 4, "coating": "TiAlN", "diameter": 6.0, "material_tags": ["M", "P"]},
        {"edp_no": "B", "subtype": "Square", "flute_count": 4, "coating": "AlCrN", "diameter": 10.0, "material_tags": ["M"]},
        {"edp_no": "C", "subtype": "Ball", "flute_count": 2, "coating": "TiAlN", "diameter": 6.0, "material_tags": ["N"]},
        {"edp_no": "D", "subtype": "Square", "flute_count": 2, "coating": "TiAlN", "diameter": 3.0, "material_tags": ["P"]},
        {"edp_no": "E", "subtype": "Corner Radius", "flute_count": 4, "coating": None, "diameter": 10.0, "material_tags": ["P"]},
    ]


# ══════════════════════════════════════════════════════════════════════
#  1. refine_in_memory — narrow / drop / list / numeric  (6 tests)
# ══════════════════════════════════════════════════════════════════════

def test_01_narrow_categorical(ranked_small):
    out = refine_in_memory(ranked_small, "coating", "TiAlN", mode="narrow")
    assert {r["edp_no"] for r in out} == {"A", "C", "D"}


def test_02_drop_categorical(ranked_small):
    """drop inverts narrow: rows where coating != TiAlN. E has coating=None
    (actual→None→no-match→inverted→included); B has AlCrN (always included).
    A/C/D have TiAlN → excluded."""
    out = refine_in_memory(ranked_small, "coating", "TiAlN", mode="drop")
    out_ids = {r["edp_no"] for r in out}
    assert "B" in out_ids
    assert "A" not in out_ids and "C" not in out_ids and "D" not in out_ids


def test_03_narrow_list_field(ranked_small):
    """material_tags = ['M','P'] → narrow by 'P' returns A, D, E."""
    out = refine_in_memory(ranked_small, "material_tags", "P")
    assert {r["edp_no"] for r in out} == {"A", "D", "E"}


def test_04_narrow_numeric_exact(ranked_small):
    """diameter=6.0 with 1% tolerance — matches A and C."""
    out = refine_in_memory(ranked_small, "flute_count", 4)
    assert {r["edp_no"] for r in out} == {"A", "B", "E"}


def test_05_none_value_noop(ranked_small):
    """value=None → returns full ranked unchanged."""
    out = refine_in_memory(ranked_small, "flute_count", None)
    assert len(out) == len(ranked_small)


def test_06_empty_ranked():
    assert refine_in_memory([], "flute_count", 4) == []


# ══════════════════════════════════════════════════════════════════════
#  2. compute_distribution — min_bucket / max_buckets / empty  (4 tests)
# ══════════════════════════════════════════════════════════════════════

def test_07_distribution_categorical(ranked_small):
    dist = compute_distribution(ranked_small, "coating")
    labels = dict(dist)
    assert labels.get("TiAlN") == 3
    assert labels.get("AlCrN") == 1


def test_08_distribution_numeric_bucketed(ranked_small):
    dist = compute_distribution(ranked_small, "diameter")
    # 3.0 → "3-6", 6.0×2 → "6-10", 10.0×2 → "10-16"
    labels = dict(dist)
    assert labels.get("3-6") == 1
    assert labels.get("6-10") == 2
    assert labels.get("10-16") == 2


def test_09_max_buckets_truncates(ranked_small):
    dist = compute_distribution(ranked_small, "subtype", max_buckets=2)
    assert len(dist) == 2
    # Highest count first
    assert dist[0] == ("Square", 3)


def test_10_empty_and_min_bucket():
    assert compute_distribution([], "coating") == []
    # min_bucket=3 drops singletons
    dist = compute_distribution([
        {"coating": "TiAlN"}, {"coating": "TiAlN"}, {"coating": "TiAlN"},
        {"coating": "AlCrN"},
    ], "coating", min_bucket=3)
    assert dist == [("TiAlN", 3)]


# ══════════════════════════════════════════════════════════════════════
#  3. compute_cross_distribution — top_n / ties  (3 tests)
# ══════════════════════════════════════════════════════════════════════

def test_11_cross_basic(ranked_small):
    cross = compute_cross_distribution(
        ranked_small, ("subtype", "flute_count"), top_n=5
    )
    # ("Square", "4") appears A + B = 2
    pairs = dict(cross)
    assert pairs.get(("Square", "4")) == 2


def test_12_cross_top_n(ranked_small):
    cross = compute_cross_distribution(
        ranked_small, ("subtype", "flute_count"), top_n=2
    )
    assert len(cross) == 2


def test_13_cross_same_field_empty(ranked_small):
    assert compute_cross_distribution(ranked_small, ("subtype", "subtype")) == []


# ══════════════════════════════════════════════════════════════════════
#  4. compute_broadening_hints — no full_pool / with pool  (3 tests)
# ══════════════════════════════════════════════════════════════════════

def test_14_broaden_no_pool_returns_empty():
    """Without full_pool, can't estimate → empty."""
    assert compute_broadening_hints(
        [{"coating": "TiAlN"}], {"coating": "TiAlN"}
    ) == []


def test_15_broaden_computes_delta(ranked_small):
    """full_pool = all 5 rows. Current filter coating=TiAlN → 3 rows match.
    Relaxing coating → 5 rows. delta = 5 - 3 = 2."""
    filtered = refine_in_memory(ranked_small, "coating", "TiAlN")
    hints = compute_broadening_hints(
        filtered, {"coating": "TiAlN"}, full_pool=ranked_small
    )
    assert ("coating", 2) in hints


def test_16_broaden_delta_zero_excluded():
    """If relaxing produces no change, skip."""
    pool = [{"coating": "TiAlN"}, {"coating": "TiAlN"}]
    filtered = pool
    hints = compute_broadening_hints(filtered, {"coating": "TiAlN"}, full_pool=pool)
    # Relaxing coating doesn't add rows (all rows have TiAlN, filter was noop)
    assert hints == []


# ══════════════════════════════════════════════════════════════════════
#  5. build_refine_chips — excluded / pinned / zero / cross  (5 tests)
# ══════════════════════════════════════════════════════════════════════

def test_17_chips_skip_excluded_fields(ranked_small):
    """edp_no / series are in REFINE_EXCLUDED_FIELDS → no chips from them."""
    chips = build_refine_chips(ranked_small, {})
    fields = {c["field"] for c in chips}
    assert "edp_no" not in fields
    assert "edp_series_name" not in fields


def test_18_chips_skip_pinned_fields(ranked_small):
    """When current_filters has coating pinned, no coating chips emit."""
    chips = build_refine_chips(ranked_small, {"coating": "TiAlN"})
    fields = {c["field"] for c in chips}
    assert "coating" not in fields


def test_19_chips_count_never_zero(ranked_small):
    """Every chip must have count ≥ REFINE_CHIP_MIN_BUCKET (default 1)."""
    chips = build_refine_chips(ranked_small, {})
    assert all(c["count"] >= 1 for c in chips)


def test_20_chips_have_narrow_action(ranked_small):
    chips = build_refine_chips(ranked_small, {})
    assert chips
    assert all(c["action"] == "narrow" for c in chips)


def test_21_chips_cross_when_enabled():
    """With enough ranked (≥3) and include_cross=True, cross-field chips appear
    with field containing '+'."""
    ranked = [
        {"subtype": "Square", "flute_count": 4, "coating": "TiAlN"} for _ in range(5)
    ] + [
        {"subtype": "Ball", "flute_count": 2, "coating": "AlCrN"} for _ in range(3)
    ]
    chips = build_refine_chips(ranked, {}, include_cross=True)
    # Cross chips have '+' in field name
    cross_chips = [c for c in chips if "+" in c["field"]]
    assert cross_chips, "cross chips should be present"
    assert all(isinstance(c["value"], dict) for c in cross_chips)


# ══════════════════════════════════════════════════════════════════════
#  6. Session integration — last_ranked / previous_products  (2 tests)
# ══════════════════════════════════════════════════════════════════════

def test_22_session_update_last_ranked_from_tuples():
    from session import get_or_create
    s = get_or_create(None)
    ranked_tuples = [
        ({"edp_no": "X1", "brand": "Y"}, 90.0, {"affinity": 15}),
        ({"edp_no": "X2"}, 85.0, {}),
    ]
    s.update_last_ranked(ranked_tuples)
    # Stored as dicts with _score / _breakdown attached
    assert len(s.last_ranked) == 2
    assert s.last_ranked[0]["edp_no"] == "X1"
    assert s.last_ranked[0]["_score"] == 90.0
    # Derived @property
    assert s.previous_products == ["X1", "X2"]


def test_23_session_cap_respected():
    from session import get_or_create
    from config import REFINE_RANKED_CAP
    s = get_or_create(None)
    many = [({"edp_no": f"X{i}"}, 1.0, {}) for i in range(REFINE_RANKED_CAP + 10)]
    s.update_last_ranked(many)
    assert len(s.last_ranked) == REFINE_RANKED_CAP


# ══════════════════════════════════════════════════════════════════════
#  7. format_cross_for_prompt — LLM injection shape  (2 tests)
# ══════════════════════════════════════════════════════════════════════

def test_24_prompt_line_shape():
    ranked = [
        {"subtype": "Square", "flute_count": 4} for _ in range(8)
    ] + [
        {"subtype": "Ball", "flute_count": 2} for _ in range(5)
    ]
    line = format_cross_for_prompt(ranked, {})
    assert "×" in line  # cross marker
    # Each pair rendered as "valA+valB=N"
    assert "=" in line


def test_25_prompt_empty_below_threshold():
    """Fewer than 3 ranked rows → empty prompt line."""
    assert format_cross_for_prompt(
        [{"subtype": "Square", "flute_count": 4}], {}
    ) == ""
