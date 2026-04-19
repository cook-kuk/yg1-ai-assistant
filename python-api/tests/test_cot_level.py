"""Coverage matrix for chat._assess_cot_level — every signal in
isolation + the session-gated pair (0건 / DISSAT).

The escalation logic is the only thing standing between a routine
"수스 10mm 4날" query and a 30-second Strong-CoT round trip, so the
seven signals deserve unit-level proof. No LLM, no DB; pure function.
"""
from __future__ import annotations

from types import SimpleNamespace

import pytest

from chat import _assess_cot_level


def _intent(**kw):
    """Minimal SCRIntent stand-in — _assess_cot_level only reads
    `material_tag` plus the eight slot fields it counts for the
    "many constraints" booster."""
    base = dict(
        material_tag=None,
        diameter=None,
        flute_count=None,
        subtype=None,
        brand=None,
        coating=None,
        tool_material=None,
        shank_type=None,
    )
    base.update(kw)
    return SimpleNamespace(**base)


def _session(turn_count: int = 0):
    """Minimal session stub — the helper only checks `turns` truthiness.
    None is the "no session" path; SimpleNamespace(turns=[…]) is the
    follow-up path that unlocks DISSAT and 0건 escalation."""
    if turn_count <= 0:
        return None
    return SimpleNamespace(turns=[{"role": "user", "message": f"prior {i}"} for i in range(turn_count)])


# ── Signal 1: total_count == 0 ────────────────────────────────────────


def test_zero_count_with_prior_session_escalates_to_strong():
    """`total_count=0` on a follow-up turn means the user previously had
    matches and now we hit a dead end — Strong is worth the wait."""
    level = _assess_cot_level(
        message="이 중에서 4날", intent=_intent(),
        products=[], knowledge=[], total_count=0, relaxed_fields=None,
        session=_session(2),
    )
    assert level == "strong"


def test_zero_count_short_fresh_query_stays_light():
    """First turn + ≤15 chars + 0 results → user just hasn't given enough
    detail. Strong is wasted; light should ask a clarifying question."""
    level = _assess_cot_level(
        message="sus", intent=_intent(),
        products=[], knowledge=[], total_count=0, relaxed_fields=None,
        session=None,
    )
    assert level == "light"


def test_zero_count_long_fresh_query_still_escalates():
    """The short-circuit only protects ≤15 char fresh queries. A long
    query with 0 results is genuinely worth Strong analysis."""
    level = _assess_cot_level(
        message="아주 구체적인 조건으로 16자 넘는 첫 메시지를 보냈는데 결과 0건",
        intent=_intent(material_tag="P"),
        products=[], knowledge=[], total_count=0, relaxed_fields=None,
        session=None,
    )
    assert level == "strong"


# ── Signal 2: difficult material (S/H) ───────────────────────────────


def test_titanium_alone_escalates():
    """Titanium (S) and hardened steel (H) carry the biggest coating /
    geometry tradeoff space — Strong by default."""
    level = _assess_cot_level(
        message="티타늄 가공", intent=_intent(material_tag="S"),
        products=[{"edp_no": "x"}], knowledge=[], total_count=10, relaxed_fields=None,
        session=None,
    )
    assert level == "strong"


def test_carbon_steel_alone_stays_light():
    """P-group is the everyday case — no Strong tax on routine queries."""
    level = _assess_cot_level(
        message="탄소강 가공", intent=_intent(material_tag="P"),
        products=[{"edp_no": "x"}], knowledge=[], total_count=10, relaxed_fields=None,
        session=None,
    )
    assert level == "light"


# ── Signal 3: compare / why intent ───────────────────────────────────


def test_compare_keyword_escalates():
    level = _assess_cot_level(
        message="V7 PLUS vs X-POWER 비교해줘", intent=_intent(),
        products=[], knowledge=[], total_count=5, relaxed_fields=None,
        session=None,
    )
    assert level == "strong"


def test_why_keyword_escalates():
    level = _assess_cot_level(
        message="이 제품이 더 좋은 이유가 뭐야", intent=_intent(),
        products=[], knowledge=[], total_count=5, relaxed_fields=None,
        session=None,
    )
    assert level == "strong"


# ── Signal 4: troubleshooting ────────────────────────────────────────


def test_trouble_keyword_escalates():
    level = _assess_cot_level(
        message="가공 중 떨림이 너무 심해요", intent=_intent(material_tag="M"),
        products=[], knowledge=[], total_count=10, relaxed_fields=None,
        session=None,
    )
    assert level == "strong"


# ── Signal 5: many constraints (booster, never primary alone) ────────


def test_filter_richness_alone_stays_light():
    """4 filled slots adds +1 (booster). On its own it shouldn't cross
    threshold=3 — only when combined with another booster."""
    level = _assess_cot_level(
        message="수스 10mm 4날 스퀘어",
        intent=_intent(material_tag="M", diameter=10, flute_count=4, subtype="Square"),
        products=[{"edp_no": "x"}], knowledge=[], total_count=20, relaxed_fields=None,
        session=None,
    )
    assert level == "light"


def test_long_message_plus_filters_still_below_threshold():
    """50+ chars with 3+ filters is +1 +1 = 2 — below threshold=3."""
    level = _assess_cot_level(
        message="안녕하세요 제가 지금 스테인리스 10mm 4날 스퀘어 엔드밀이 필요한데요 추천 부탁드려요",
        intent=_intent(material_tag="M", diameter=10, flute_count=4, subtype="Square"),
        products=[{"edp_no": "x"}], knowledge=[], total_count=20, relaxed_fields=None,
        session=None,
    )
    assert level == "light"


# ── Signal 6: knowledge depth booster ────────────────────────────────


def test_knowledge_alone_below_threshold():
    """Knowledge ≥2 only contributes +1 — won't escalate by itself."""
    level = _assess_cot_level(
        message="추천", intent=_intent(material_tag="P"),
        products=[{"edp_no": "x"}], knowledge=[{"a": 1}, {"b": 2}],
        total_count=10, relaxed_fields=None,
        session=None,
    )
    assert level == "light"


# ── Signal 7: dissatisfaction (session-gated) ────────────────────────


def test_dissat_with_prior_turns_escalates():
    """User said '아니 그거 말고' AFTER seeing a prior turn — they're
    explicitly asking for reconsideration."""
    level = _assess_cot_level(
        message="아니 그거 말고 다른 거", intent=_intent(),
        products=[], knowledge=[], total_count=5, relaxed_fields=None,
        session=_session(2),
    )
    assert level == "strong"


def test_dissat_on_fresh_session_stays_light():
    """'아니' on turn-1 with no prior context is conversational filler,
    not a complaint — escalation would burn 30s for no reason."""
    level = _assess_cot_level(
        message="아니 그게 아니고 sus 추천", intent=_intent(material_tag="M"),
        products=[{"edp_no": "x"}], knowledge=[], total_count=5, relaxed_fields=None,
        session=None,
    )
    assert level == "light"


# ── Misc safety nets ─────────────────────────────────────────────────


def test_empty_message_returns_light():
    """No work to escalate when there's no question."""
    assert _assess_cot_level(
        message="", intent=_intent(),
        products=[], knowledge=[], total_count=0, relaxed_fields=None,
        session=None,
    ) == "light"


def test_relaxed_fields_alone_below_threshold():
    """relaxed_fields adds +2 — only crosses threshold combined with
    something else."""
    level = _assess_cot_level(
        message="수스 10mm",
        intent=_intent(material_tag="M", diameter=10),
        products=[{"edp_no": "x"}], knowledge=[],
        total_count=5, relaxed_fields=["coating"],
        session=None,
    )
    assert level == "light"


def test_relaxed_plus_titanium_escalates():
    """+2 (relaxed) + +3 (S material) = 5 ≥ 3 → strong."""
    level = _assess_cot_level(
        message="티타늄 추천",
        intent=_intent(material_tag="S"),
        products=[{"edp_no": "x"}], knowledge=[],
        total_count=5, relaxed_fields=["coating"],
        session=None,
    )
    assert level == "strong"
