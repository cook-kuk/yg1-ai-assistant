"""guard.py — hallucination scrubber. Uses set_known() to bypass DB."""

import pytest

import guard


@pytest.fixture(autouse=True)
def _seed_known_sets():
    guard.set_known(
        brands={"YG-1", "X-POWER", "ALU-POWER", "TITANOX"},
        series={"V7 PLUS", "V7 PLUS A", "E-FORCE", "4G MILL", "ALU-POWER"},
    )
    yield
    guard.refresh_cache()


def test_removes_fake_sku():
    text = "추천: YG-EM4010 이 최적입니다."
    cleaned, removed = guard.scrub(text)
    assert "YG-EM4010" not in cleaned
    assert "YG-EM4010" in removed


def test_keeps_safe_words():
    text = "SUS304 가공용 M8 탭, 6H tolerance, TiAlN 코팅."
    cleaned, removed = guard.scrub(text)
    # SUS304 is SAFE_WORDS; M8 / 6H also safe; TiAlN safe.
    for safe in ("SUS304", "6H"):
        assert safe in cleaned.upper()
    # None of these should have been removed
    for token in removed:
        assert token.upper() not in {"SUS304", "6H", "TIALN"}


def test_keeps_known_brand_and_series():
    text = "1위: X-POWER / V7 PLUS 추천합니다."
    cleaned, removed = guard.scrub(text)
    assert "X-POWER" in cleaned
    assert "V7 PLUS" in cleaned or "V7" in cleaned


def test_removes_fake_series_not_in_db():
    text = "1위: FAKEBRAND99 시리즈 VX-HALLUCIN123 추천."
    cleaned, removed = guard.scrub(text)
    assert "FAKEBRAND99" in removed or "VX-HALLUCIN123" in removed
    assert "VX-HALLUCIN123" not in cleaned


def test_cleans_empty_parens_and_commas():
    # Removing a fake token should not leave "( )" or ",,".
    guard.set_known(brands=set(), series=set())
    text = "추천: (FAKE99), 공구."
    cleaned, _ = guard.scrub(text)
    assert "( )" not in cleaned
    assert ",," not in cleaned


def test_empty_text_returns_empty():
    cleaned, removed = guard.scrub("")
    assert cleaned == ""
    assert removed == []
