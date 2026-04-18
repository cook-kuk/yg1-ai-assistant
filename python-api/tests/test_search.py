"""search.py — live-DB filtering behavior."""
import pytest

from search import search_products, product_count, brand_material_rating


@pytest.mark.db
def test_product_count_is_expected_order(db_conn):
    n = product_count()
    assert n > 100_000, f"expected ~125k rows, got {n}"


@pytest.mark.db
def test_search_by_diameter_only(db_conn):
    rows = search_products(diameter=10.0, limit=50)
    assert len(rows) > 0
    for r in rows:
        d = float(r["diameter"])
        assert 9.0 <= d <= 11.0, f"{r['edp_no']} diameter {d} outside ±10% window"


@pytest.mark.db
def test_search_by_material_tag_m(db_conn):
    rows = search_products(material_tag="M", limit=30)
    assert len(rows) > 0
    for r in rows:
        tags = r["material_tags"] or []
        assert "M" in tags, f"{r['edp_no']} tags {tags} missing M"


@pytest.mark.db
def test_search_by_subtype_ball(db_conn):
    rows = search_products(subtype="Ball", limit=20)
    assert len(rows) > 0
    for r in rows:
        assert "ball" in (r["subtype"] or "").lower()


@pytest.mark.db
def test_search_by_flute_count(db_conn):
    rows = search_products(flute_count=4, limit=20)
    assert len(rows) > 0
    for r in rows:
        assert r["flutes"] == "4"


@pytest.mark.db
def test_search_diameter_and_material_combo(db_conn):
    rows = search_products(diameter=10.0, material_tag="M", limit=30)
    assert len(rows) > 0
    for r in rows:
        assert "M" in (r["material_tags"] or [])
        assert 9.0 <= float(r["diameter"]) <= 11.0


@pytest.mark.db
def test_search_by_brand_returns_only_that_brand(db_conn):
    sample = search_products(limit=5)
    assert sample, "baseline query should return rows"
    brand = sample[0]["brand"]
    rows = search_products(brand=brand, limit=20)
    assert len(rows) > 0
    for r in rows:
        assert brand.lower() in (r["brand"] or "").lower()


@pytest.mark.db
def test_search_missing_filter_field_gracefully_empty(db_conn):
    rows = search_products(brand="__NO_SUCH_BRAND__", limit=5)
    assert rows == []


@pytest.mark.db
def test_brand_material_rating_none_for_unknown(db_conn):
    r = brand_material_rating("__NO_SUCH_BRAND__", "M")
    assert r is None
