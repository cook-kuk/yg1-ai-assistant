"""scr.py — Haiku intent parser. Network + LLM calls, marked slow."""
import pytest

from scr import parse_intent


@pytest.mark.slow
def test_parse_10mm_endmill(anthropic_client):
    intent = parse_intent("10mm 엔드밀 추천해줘")
    assert intent.diameter == 10
    # "엔드밀"만 있으면 tool_type=Solid 로 추출되어야 함 (시스템 프롬프트 규칙)
    assert intent.tool_type == "Solid"


@pytest.mark.slow
def test_parse_sus_4pi(anthropic_client):
    intent = parse_intent("수스 4파이 볼 엔드밀 추천")
    assert intent.diameter == 4
    assert intent.subtype and intent.subtype.lower() == "ball"
    assert intent.material_tag == "M"  # 수스/SUS/스테인리스 → M


@pytest.mark.slow
def test_parse_4flute_ball_stainless(anthropic_client):
    intent = parse_intent("10mm 4날 스테인리스 볼 엔드밀")
    assert intent.diameter == 10
    assert intent.flute_count == 4
    assert intent.material_tag == "M"
    assert intent.subtype and "ball" in intent.subtype.lower()


@pytest.mark.slow
def test_parse_cast_iron_drill(anthropic_client):
    intent = parse_intent("주철 가공용 6mm 드릴")
    assert intent.diameter == 6
    assert intent.material_tag == "K"  # 주철 → K


@pytest.mark.slow
def test_parse_titanium_is_group_s(anthropic_client):
    intent = parse_intent("티타늄 12mm 엔드밀")
    assert intent.diameter == 12
    assert intent.material_tag == "S"


@pytest.mark.slow
def test_parse_empty_intent_on_generic_message(anthropic_client):
    """A message with no tool cue should return an almost-empty intent —
    Haiku may guess, but at least diameter/flute_count must stay null."""
    intent = parse_intent("안녕하세요")
    assert intent.diameter is None
    assert intent.flute_count is None
