"""session.py — in-memory session store unit tests.

No DB dependency — the store is module-level dict + Lock. `get_or_create`,
`add_turn`, and `carry_forward_intent` are the three public entry points
the multi-turn flow relies on, so we pin each to a small behavior contract.
"""
import pytest
from schemas import SCRIntent
from session import (
    get_or_create,
    add_turn,
    carry_forward_intent,
    Session,
    _SESSIONS,
)


@pytest.fixture(autouse=True)
def _clean_sessions():
    """Each test gets a fresh _SESSIONS dict — otherwise TTL-expired state
    from one test bleeds into the next."""
    _SESSIONS.clear()
    yield
    _SESSIONS.clear()


def test_get_or_create_new():
    s = get_or_create(None)
    assert isinstance(s, Session)
    assert s.session_id, "a fresh session should get a UUID"
    assert s.turns == []


def test_get_or_create_existing():
    s1 = get_or_create(None)
    s2 = get_or_create(s1.session_id)
    # Same object, not a fresh mint with the reused id.
    assert s1 is s2


def test_add_turn_user():
    s = get_or_create(None)
    add_turn(s, role="user", message="구리 10mm 추천",
             intent={"material_tag": "N", "diameter": 10.0},
             products=["E5711060"])
    assert len(s.turns) == 1
    turn = s.turns[0]
    assert turn["role"] == "user"
    assert turn["message"] == "구리 10mm 추천"
    assert s.previous_products == ["E5711060"]
    assert s.current_filters.get("material_tag") == "N"


def test_carry_forward_intent():
    """Unset fields on the fresh intent get filled from session.current_filters."""
    s = get_or_create(None)
    s.current_filters = {"material_tag": "N", "diameter": 10.0, "flute_count": 3}
    intent = SCRIntent(subtype="Ball")  # diameter/flute_count/material_tag all None
    carry_forward_intent(s, intent)
    assert intent.material_tag == "N"
    assert intent.diameter == 10.0
    assert intent.flute_count == 3
    assert intent.subtype == "Ball"  # original value kept


def test_carry_forward_does_not_overwrite():
    """Fields already set on the incoming intent win over the carried value."""
    s = get_or_create(None)
    s.current_filters = {"material_tag": "N", "diameter": 10.0}
    intent = SCRIntent(material_tag="M", diameter=20.0)
    carry_forward_intent(s, intent)
    assert intent.material_tag == "M"
    assert intent.diameter == 20.0
