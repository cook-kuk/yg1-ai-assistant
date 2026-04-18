"""scoring.py — weighted sum unit tests (no DB required for core logic).

Affinity lookups are bypassed by omitting brand/material combinations that
would trigger `brand_material_rating`, except in the combo test which asserts
behavior on a non-existent brand (returns None → falls through to base score).
"""
from schemas import SCRIntent
from scoring import score_candidate, rank_candidates, WEIGHTS


def _intent(**kwargs) -> SCRIntent:
    return SCRIntent(**kwargs)


def _cand(**kwargs) -> dict:
    base = {
        "edp_no": kwargs.get("edp_no", "TEST-0"),
        "brand": None,
        "series": None,
        "diameter": None,
        "flutes": None,
        "material_tags": None,
        "subtype": None,
        "coating": None,
    }
    base.update(kwargs)
    return base


def test_weights_sum_known_values():
    assert sum(WEIGHTS.values()) == 95.0


def test_full_match_scores_100():
    intent = _intent(diameter=10, flute_count=4, material_tag="M", subtype="Ball", coating="AlTiN")
    # No brand → material_score uses base 1.0 without affinity blend.
    cand = _cand(diameter="10", flutes="4", material_tags=["M"], subtype="Ball", coating="AlTiN")
    score, breakdown = score_candidate(cand, intent)
    assert score == 100.0
    for k in WEIGHTS:
        assert breakdown[k] > 0, f"{k} should contribute when all fields match"


def test_partial_match_beats_mismatch():
    intent = _intent(diameter=10, flute_count=4, material_tag="M", subtype="Ball")
    perfect = _cand(edp_no="A", diameter="10", flutes="4", material_tags=["M"], subtype="Ball")
    partial = _cand(edp_no="B", diameter="10", flutes="4", material_tags=["P"], subtype="Square")
    # Truly missing on every field: diameter far off, flutes far off, wrong material, wrong shape
    mismatch = _cand(edp_no="C", diameter="20", flutes="12", material_tags=["K"], subtype="Square")

    s_perfect, _ = score_candidate(perfect, intent)
    s_partial, _ = score_candidate(partial, intent)
    s_mismatch, _ = score_candidate(mismatch, intent)

    assert s_perfect > s_partial > s_mismatch
    assert s_perfect == 100.0
    assert s_mismatch == 0.0


def test_diameter_tolerance_window_linear_falloff():
    # Linear falloff over 0..20% relative error, then clamped to 0.
    intent = _intent(diameter=10)
    exact = _cand(diameter="10")
    near = _cand(diameter="10.5")  # 5% off → subscore 0.75
    far = _cand(diameter="12")     # 20% off → 0

    s_exact, _ = score_candidate(exact, intent)
    s_near, _ = score_candidate(near, intent)
    s_far, _ = score_candidate(far, intent)

    assert s_exact == 100.0
    # diameter is the only active intent → subscore maps directly to total.
    assert 70.0 <= s_near <= 80.0
    assert s_exact > s_near > s_far
    assert s_far == 0.0


def test_missing_intent_field_redistributes_weight():
    """Only diameter is specified → diameter alone contributes 100 on a match."""
    intent = _intent(diameter=10)
    cand = _cand(diameter="10")
    score, breakdown = score_candidate(cand, intent)
    assert score == 100.0
    assert breakdown["diameter"] == 100.0
    for k in ("flutes", "material", "shape", "coating"):
        assert breakdown[k] == 0.0


def test_rank_candidates_orders_by_score_desc():
    intent = _intent(diameter=10, flute_count=4, subtype="Ball")
    cands = [
        _cand(edp_no="low", diameter="20", flutes="2", subtype="Square"),
        _cand(edp_no="mid", diameter="10.5", flutes="4", subtype="Square"),
        _cand(edp_no="top", diameter="10", flutes="4", subtype="Ball"),
    ]
    ranked = rank_candidates(cands, intent, top_k=3)
    ids = [c["edp_no"] for c, _, _ in ranked]
    assert ids == ["top", "mid", "low"]


def test_rank_candidates_honors_top_k():
    intent = _intent(diameter=10)
    cands = [_cand(edp_no=f"r{i}", diameter="10") for i in range(10)]
    ranked = rank_candidates(cands, intent, top_k=3)
    assert len(ranked) == 3


def test_empty_intent_returns_zero_score():
    intent = _intent()
    cand = _cand(diameter="10", flutes="4", material_tags=["M"], subtype="Ball", coating="AlTiN")
    score, _ = score_candidate(cand, intent)
    assert score == 0.0
