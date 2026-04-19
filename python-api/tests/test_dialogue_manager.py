"""dialogue_manager.detect_fresh_request — fresh vs. follow-up classifier.

No DB or LLM dependency. Pure pattern matching on (message, intent,
prior_filters) — easy to pin to concrete behavior cases.
"""
from schemas import SCRIntent
from dialogue_manager import detect_fresh_request


def _intent(**kwargs) -> SCRIntent:
    return SCRIntent(**kwargs)


def test_fresh_request_verb_anchor():
    """Recommend-verb co-occurring with a fresh anchor → fresh."""
    result = detect_fresh_request(
        message="SKD12 가공 제품 추천해줘",
        current_intent=_intent(material_tag="H", workpiece_name="SKD12"),
        prior_filters={"material_tag": "N"},
    )
    assert result == "verb+anchor"


def test_followup_not_fresh():
    """'이 중에서' is an explicit anti-signal even with multi anchors."""
    result = detect_fresh_request(
        message="이 중에서 4날만 보여줘",
        current_intent=_intent(flute_count=4),
        prior_filters={"material_tag": "N", "diameter": 10.0},
    )
    assert result is None


def test_coating_refine_not_fresh():
    """Refining a single attribute (coating) without a defining-slot swap
    or a recommend-verb stays a follow-up."""
    result = detect_fresh_request(
        message="DLC 코팅만",
        current_intent=_intent(coating="DLC"),
        prior_filters={"material_tag": "N", "diameter": 10.0},
    )
    assert result is None


def test_defining_slot_swap_is_fresh():
    """Switching material from the prior turn = pivot → fresh."""
    result = detect_fresh_request(
        message="인코넬로",
        current_intent=_intent(material_tag="S", workpiece_name="Inconel"),
        prior_filters={"material_tag": "N", "workpiece_name": "구리"},
    )
    # Either "material_tag-swap" or "workpiece_name-swap" — the test only
    # cares that _some_ swap was detected.
    assert result is not None and "swap" in result


def test_no_message_returns_none():
    assert detect_fresh_request("", _intent(), None) is None
    assert detect_fresh_request(None, _intent(), None) is None
