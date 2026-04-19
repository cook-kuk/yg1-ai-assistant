"""clarify.suggest_clarifying_chips — entropy-based narrow suggester.

Marked @pytest.mark.slow because the call path loads the product index
on first invocation (DB pull). Once the index is warm later tests reuse
the cached copy.
"""
import pytest
from clarify import suggest_clarifying_chips, format_chips_for_prompt


@pytest.mark.slow
def test_clarify_returns_dict():
    """With a broad filter (just material_tag=N), entropy picks axes to
    narrow — the shape must be {groups: [...], candidate_count: int}."""
    result = suggest_clarifying_chips({"material_tag": "N"})
    assert isinstance(result, dict)
    assert "groups" in result
    assert "candidate_count" in result
    assert isinstance(result["groups"], list)
    assert isinstance(result["candidate_count"], int)


@pytest.mark.slow
def test_clarify_groups():
    """Each group carries field / label / chips. Format must be stable —
    the LLM prompt reads it verbatim via format_chips_for_prompt()."""
    result = suggest_clarifying_chips({"material_tag": "N"})
    assert result["groups"], "broad material=N should produce narrow chips"
    for g in result["groups"]:
        assert "field" in g
        assert "chips" in g
        assert isinstance(g["chips"], list)


@pytest.mark.slow
def test_format_chips_for_prompt():
    """Helper turns the chip dict into a string the prompt can paste in
    directly. Empty / none inputs must not crash."""
    out_empty = format_chips_for_prompt({})
    assert isinstance(out_empty, str)

    result = suggest_clarifying_chips({"material_tag": "N"})
    out = format_chips_for_prompt(result)
    assert isinstance(out, str)
