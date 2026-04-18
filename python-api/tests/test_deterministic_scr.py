"""deterministic_scr.py — regex prefilter. Pure unit tests (no DB/LLM)."""

import deterministic_scr


def test_10mm_4flute_ball():
    intent = deterministic_scr.parse("10mm 4날 볼 엔드밀")
    assert intent is not None
    assert intent.diameter == 10.0
    assert intent.flute_count == 4
    assert intent.subtype == "Ball"
    assert intent.tool_type == "Solid"


def test_sus304_extracts_material_M():
    intent = deterministic_scr.parse("SUS304 가공용 6mm 엔드밀")
    assert intent is not None
    assert intent.diameter == 6.0
    assert intent.material_tag == "M"


def test_4pi_ball_suseu():
    intent = deterministic_scr.parse("수스 4파이 볼 엔드밀")
    assert intent is not None
    assert intent.diameter == 4.0
    assert intent.subtype == "Ball"
    assert intent.material_tag == "M"


def test_aluminum_drill_returns_intent_with_tool_type():
    intent = deterministic_scr.parse("알루미늄 8mm 드릴")
    assert intent is not None
    assert intent.diameter == 8.0
    assert intent.material_tag == "N"
    assert intent.tool_type == "Solid"


def test_hrc55_is_H():
    intent = deterministic_scr.parse("HRC55 경화강 12mm 엔드밀")
    assert intent is not None
    assert intent.material_tag == "H"
    assert intent.diameter == 12.0


def test_square_endmill():
    intent = deterministic_scr.parse("10mm 스퀘어 엔드밀")
    assert intent is not None
    assert intent.subtype == "Square"


def test_coating_extracted():
    intent = deterministic_scr.parse("10mm 4날 TiAlN 엔드밀")
    assert intent is not None
    assert intent.coating == "TiAlN"


def test_greeting_returns_none():
    # No strong cue → fall back to LLM.
    assert deterministic_scr.parse("안녕하세요") is None


def test_bare_endmill_returns_none():
    # tool_type alone is too weak — caller should try KG/LLM.
    assert deterministic_scr.parse("엔드밀 추천해줘") is None


def test_empty_message_returns_none():
    assert deterministic_scr.parse("") is None
