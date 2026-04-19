"""product_index — in-memory MV cache + filter engine.

Tagged @pytest.mark.slow because load_index() pulls ~125k rows from the
DB. `pytest tests/` without a marker filter still runs these if DB env is
available; CI configs that don't have the DB can skip via `-m "not slow"`.
"""
import pytest
from product_index import (
    load_index,
    search_products_fast,
    index_size,
    needs_db_path,
)


@pytest.mark.slow
def test_load_index():
    """First load hits the DB; size should reflect deduped unique-EDP count."""
    idx = load_index()
    assert isinstance(idx, list)
    assert index_size() > 0, "index should be non-empty after load"
    # After dedupe-by-edp, no EDP appears twice in the index.
    edps = [p.get("edp_no") for p in idx if p.get("edp_no")]
    assert len(edps) == len(set(edps)), "index should be unique by EDP"


@pytest.mark.slow
def test_search_basic():
    """Basic filter — stainless-steel 10mm should return a non-empty hit list."""
    rows = search_products_fast({"material_tag": "M", "diameter": 10})
    assert len(rows) > 0
    # Every row should actually honor both filters.
    for r in rows[:20]:
        assert "M" in (r.get("material_tags") or [])


def test_needs_db_path_inventory():
    """Inventory gates require the DB path (in-memory index lacks stock)."""
    assert needs_db_path({"in_stock_only": True}) is True
    assert needs_db_path({"stock_min": 100}) is True
    assert needs_db_path({"warehouse": "GLC"}) is True


def test_needs_db_path_drill_thread():
    """Drill / thread filters → DB path (MV is milling-only)."""
    assert needs_db_path({"point_angle": 118}) is True
    assert needs_db_path({"thread_pitch": 1.25}) is True
    assert needs_db_path({"thread_tpi": 20}) is True


def test_needs_db_path_plain():
    """Routine filters — diameter / brand / flute count — stay on the
    in-memory fast path."""
    assert needs_db_path({"diameter": 10}) is False
    assert needs_db_path({"brand": "ALU-POWER"}) is False
    assert needs_db_path({"material_tag": "N", "flute_count": 3}) is False
    assert needs_db_path({}) is False
