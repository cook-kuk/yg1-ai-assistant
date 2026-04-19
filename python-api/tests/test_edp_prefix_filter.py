"""
test_edp_prefix_filter — unit test for the edp_no / series-family prefix
filter added to search._build_where. Pure WHERE-builder test, no DB.
"""
from search import _build_where


def _has_clause(where, substring):
    return any(substring in clause for clause in where)


def test_edp_no_family_prefix_emits_prefix_clause():
    where, params = _build_where({"edp_no": "UGM"})
    assert _has_clause(where, "edp_no ILIKE"), where
    assert _has_clause(where, "edp_series_name ILIKE"), where
    assert params.count("UGM%") == 2, params


def test_edp_no_concrete_edp_emits_prefix_clause():
    where, params = _build_where({"edp_no": "UGMG34919"})
    assert _has_clause(where, "edp_no ILIKE"), where
    assert "UGMG34919%" in params, params


def test_edp_no_normalizes_case_and_whitespace():
    where, params = _build_where({"edp_no": "  ugmh  "})
    assert "UGMH%" in params, params
    assert "ugmh%" not in params, params


def test_edp_no_empty_string_does_not_add_clause():
    where_empty, _ = _build_where({"edp_no": ""})
    assert not _has_clause(where_empty, "edp_no ILIKE"), where_empty
    where_ws, _ = _build_where({"edp_no": "   "})
    assert not _has_clause(where_ws, "edp_no ILIKE"), where_ws


def test_edp_no_respects_skip_exclude():
    where, _ = _build_where({"edp_no": "UGM"}, exclude="edp_no")
    assert not _has_clause(where, "edp_no ILIKE"), where


def test_edp_no_coexists_with_other_filters():
    where, _ = _build_where({"edp_no": "UGMH", "material_tag": "M", "diameter": 10.0})
    assert _has_clause(where, "edp_no ILIKE"), where
    assert _has_clause(where, "material_tags"), where
    assert _has_clause(where, "search_diameter_mm"), where
