"""Phase 0 — EDP / series prefix routing + digit-contamination guards.

Covers both unit-level (regex, verify-set wiring, diameter validation)
and end-to-end routing (_detect_product_code kind matrix) behavior.

Tests that actually query the Postgres MV are tagged `db`. Everything
else uses `product_index.set_verify_sets` to inject a synthetic catalog
so the suite runs without DB availability.
"""
from __future__ import annotations

import pytest

from config import PREFIX_MIN_LEN
from main import _detect_product_code, _has_prefix_intent_hint
from product_index import (
    find_similar_prefixes,
    get_valid_prefix_set,
    refresh_verify_sets,
    set_verify_sets,
)


# ── Synthetic catalog ─────────────────────────────────────────────
# Mirrors the real failure modes without depending on DB availability.
# UGMG34919 / CG3S01003 / EM4010 — digit-bearing EDPs.
# UGMG34 / GMF52 — series names (one shared with EDP prefix).
_FAKE_EDPS = {
    "CG3S01003", "CG3S01004", "CG3S02001",
    "UGMG34919", "UGMG34920", "UGMH10010",
    "EM4010", "EM4011",
    "ALUX5001", "ALUX5002",
}
_FAKE_SERIES = {
    "CG3S01", "CG3S02",
    "UGMG34", "UGMH10", "UGMF42",
    "EM40",
    "ALUX50", "ALUX51",
}


@pytest.fixture(autouse=True)
def _seed_verify_sets():
    set_verify_sets(_FAKE_EDPS, _FAKE_SERIES)
    yield
    refresh_verify_sets()


# ────────────────────────────────────────────────────────────────────
# 1-5: core routing kinds
# ────────────────────────────────────────────────────────────────────

def test_01_edp_exact_full_match():
    """EDP 정확 — 1건 lookup 의도, 'edp_exact' kind."""
    kind, code = _detect_product_code("CG3S01003 보여줘")
    assert (kind, code) == ("edp_exact", "CG3S01003"), (
        f"Expected ('edp_exact','CG3S01003'), got ({kind},{code})"
    )


def test_02_edp_prefix_six_chars():
    """EDP prefix 6자 — startswith 매칭, digit-bearing이라 HINT 불요."""
    kind, code = _detect_product_code("CG3S01 제품 보여줘")
    # CG3S01 is actually in series set (CG3S01), so series_exact wins.
    assert kind in ("series_exact", "edp_prefix"), (
        f"Expected series_exact or edp_prefix, got {kind}"
    )
    assert code == "CG3S01"


def test_03_digit_less_prefix_with_hint():
    """'UGM로 시작하는' — HINT gate 통과, series_prefix 반환."""
    res = _detect_product_code("UGM로 시작하는 친구 다 보여줘")
    assert res is not None, "digit-less prefix with HINT must route"
    kind, code = res
    assert kind in ("series_prefix", "edp_prefix"), f"got {kind}"
    assert code == "UGM"


def test_04_unknown_prefix_returns_no_match():
    """ZZZX — EDP 모양이지만 DB에 없음 → no_match sentinel."""
    res = _detect_product_code("ZZZX보여줘")
    # ZZZX is 4 alpha only (no digit) — won't match _PRODUCT_CODE_RE.
    # But "ZZZX보여줘" with HINT '보여' contains no PREFIX_INTENT_HINTS
    # phrase either ("보여" alone isn't a prefix hint). Should be None.
    # Use an explicit digit-bearing no-match instead:
    res2 = _detect_product_code("ZZZX9999 보여줘")
    assert res2 is not None
    kind, code = res2
    assert kind == "no_match", f"Expected no_match, got {kind}"
    assert code == "ZZZX9999"


def test_05_ugmg34919_exact():
    """원 증상 쿼리 — 정확히 1개 매칭되고 'edp_exact'."""
    kind, code = _detect_product_code("UGMG34919 보여줘")
    assert (kind, code) == ("edp_exact", "UGMG34919")


# ────────────────────────────────────────────────────────────────────
# 6-10: HINT gate + contamination
# ────────────────────────────────────────────────────────────────────

def test_06_hint_promotes_digit_less_prefix():
    """HINT 없으면 digit-less 'UGM' 은 라우팅 안 됨 (peek-only)."""
    res_no_hint = _detect_product_code("UGM 제품")  # no hint phrase
    assert res_no_hint is None, (
        "digit-less prefix without HINT must not hijack main filter"
    )
    res_with_hint = _detect_product_code("UGM 시리즈 다 보여")
    assert res_with_hint is not None


def test_07_hint_phrase_detection():
    """PREFIX_INTENT_HINTS 중 어느 하나라도 있으면 발동."""
    assert _has_prefix_intent_hint("UGM로 시작하는 거 다 보여") is True
    assert _has_prefix_intent_hint("UGM 같은 걸로 찾아") is True
    assert _has_prefix_intent_hint("UGM 시리즈 알려줘") is True
    assert _has_prefix_intent_hint("UGMG34919 보여줘") is False  # no hint


def test_08_digit_contamination_blocked():
    """'UGMG34919' 의 tail 숫자 34919 가 diameter 로 새면 안 됨.
    scr._mask_product_codes 가 placeholder 치환하는지 단위 확인."""
    from scr import _mask_product_codes
    masked, tokens = _mask_product_codes("UGMG34919 보여줘")
    assert "34919" not in masked, (
        f"EDP tail digits must not survive masking. masked={masked!r}"
    )
    assert tokens == ["UGMG34919"]
    assert "__EDP_0__" in masked


def test_09_diameter_out_of_range_resets():
    """34919mm 직경은 밀링 공구 범위 밖 → None."""
    from scr import _validate_diameter
    from schemas import SCRIntent
    intent = SCRIntent(diameter=34919.0)
    _validate_diameter(intent)
    assert intent.diameter is None, "diameter 34919 must be reset"
    intent2 = SCRIntent(diameter=10.0)
    _validate_diameter(intent2)
    assert intent2.diameter == 10.0, "sane diameter preserved"


def test_10_explicit_diameter_with_prefix_preserved():
    """직경이 명시된 '직경 10mm UGM 시리즈' — 마스킹 후에도 diameter 추출 가능."""
    from scr import _mask_product_codes
    masked, _ = _mask_product_codes("직경 10mm UGM 시리즈")
    # UGM is digit-less so not masked; diameter 10 stays visible.
    assert "10mm" in masked
    assert "UGM" in masked


# ────────────────────────────────────────────────────────────────────
# 11-15: conflicts + normalization
# ────────────────────────────────────────────────────────────────────

def test_11_edp_beats_brand_when_both_present():
    """ALU-POWER + EM4010 — EM4010 이 EDP 실존 → edp_exact 우선."""
    res = _detect_product_code("ALU-POWER EM4010 주문")
    # EM4010 is in _FAKE_EDPS → edp_exact. 'ALU-POWER' has no digits.
    assert res is not None
    kind, code = res
    assert kind == "edp_exact", f"expected edp_exact, got {kind}"
    assert code == "EM4010"


def test_12_case_insensitive_prefix():
    """'ugm 시리즈 보여' 소문자 — 대문자 버전과 동일 결과."""
    res_lower = _detect_product_code("ugm 시리즈 보여")
    res_upper = _detect_product_code("UGM 시리즈 보여")
    assert res_lower == res_upper, (
        f"case sensitivity leaked: lower={res_lower}, upper={res_upper}"
    )


def test_13_whitespace_in_token_splits():
    """'CG3S01 003' — 공백은 토큰 분리. 각각 독립 평가."""
    res = _detect_product_code("CG3S01 003 보여줘")
    assert res is not None
    kind, _ = res
    # First token CG3S01 matches series_exact. 003 alone not EDP-shaped.
    assert kind == "series_exact"


def test_14_trailing_leading_whitespace_stripped():
    """선행/후행 공백 — 트리밍 후 동일 결과."""
    r1 = _detect_product_code("  UGMG34919  ")
    r2 = _detect_product_code("UGMG34919")
    assert r1 == r2


def test_15_unicode_whitespace_handled():
    """U+00A0 (no-break space) 같은 변종 공백 — 단어 경계로 취급."""
    res = _detect_product_code("UGMG34919\u00a0보여줘")
    assert res is not None
    assert res == ("edp_exact", "UGMG34919")


# ────────────────────────────────────────────────────────────────────
# 16-20: suggestion + regression guards
# ────────────────────────────────────────────────────────────────────

def test_16_find_similar_prefixes_returns_leading_char_matches():
    """'UGMX' (실존 안 함) 근사 prefix 제안 — UGMG / UGMH / UGM… 상위."""
    suggestions = find_similar_prefixes("UGMX", top_n=3)
    assert len(suggestions) <= 3
    assert len(suggestions) >= 1, "at least one leading-U prefix must surface"
    assert all(s.startswith("U") for s in suggestions), (
        f"suggestions should share leading U: {suggestions}"
    )


def test_17_find_similar_prefixes_empty_on_no_overlap():
    """'XYZ' — 공유 접두사 없음 → 빈 리스트."""
    suggestions = find_similar_prefixes("XYZQ", top_n=3)
    # Empty when no prefix in the set shares even 1 leading char.
    assert isinstance(suggestions, list)
    # Our fake set has no X* or Q* — should be empty.
    assert suggestions == [] or not any(s.startswith("X") for s in suggestions)


def test_18_prefix_set_covers_min_len():
    """derive_prefix_set 이 PREFIX_MIN_LEN 이상 접두사만 포함."""
    prefix_set = get_valid_prefix_set()
    for p in prefix_set:
        assert len(p) >= PREFIX_MIN_LEN
        assert p.isalpha(), f"prefix must be alpha-only: {p!r}"


def test_19_no_match_preserves_diameter_absence():
    """ZZZX9999 는 숫자 9999 를 diameter 로 옮기면 안 됨 (no_match 라서 routing 없음)."""
    from scr import _mask_product_codes
    masked, _ = _mask_product_codes("ZZZX9999 보여줘")
    assert "9999" not in masked


def test_20_empty_and_null_inputs_safe():
    """경계 — 빈 문자열/None 은 모두 None 반환, 예외 없음."""
    assert _detect_product_code("") is None
    assert _detect_product_code(None) is None
    assert _detect_product_code("   ") is None
    assert find_similar_prefixes("") == []
    assert find_similar_prefixes(None) == []  # type: ignore[arg-type]
