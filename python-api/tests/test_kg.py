"""knowledge_graph.py — pattern → intent shortcut. Pure unit tests."""

import knowledge_graph


def test_sus304_endmill():
    intent = knowledge_graph.match("SUS304에 좋은 엔드밀 추천")
    assert intent is not None
    assert intent.material_tag == "M"
    assert intent.tool_type == "End Mill"


def test_aluminum_drill():
    intent = knowledge_graph.match("알루미늄 드릴")
    assert intent is not None
    assert intent.material_tag == "N"
    assert intent.tool_type == "Drill"


def test_hardened_endmill():
    intent = knowledge_graph.match("고경도강 금형 엔드밀")
    assert intent is not None
    assert intent.material_tag == "H"
    assert intent.tool_type == "End Mill"


def test_subtype_optional():
    intent = knowledge_graph.match("알루미늄 볼 엔드밀")
    assert intent is not None
    assert intent.material_tag == "N"
    assert intent.tool_type == "End Mill"
    assert intent.subtype == "Ball"


def test_no_workpiece_returns_none():
    # "엔드밀" alone — no workpiece cue.
    assert knowledge_graph.match("엔드밀 추천해줘") is None


def test_no_tool_type_returns_none():
    # Workpiece only — no tool family.
    assert knowledge_graph.match("SUS304 가공용") is None


def test_empty_message_returns_none():
    assert knowledge_graph.match("") is None
