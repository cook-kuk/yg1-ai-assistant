"""Response Validator — evidence-grounded claim checker.

Unit tests focus on the grounding + dispatch layers with the LLM
extractor mocked (real LLM exercised in eval/ only). Each test sets up
an EvidenceBundle, injects a synthetic claim list, and asserts the
cleaned text + warnings dispatch.
"""
from __future__ import annotations

from unittest.mock import patch

import pytest

import guard
from guard import (
    Claim,
    EvidenceBundle,
    GroundingResult,
    _apply_removals,
    _check_grounding,
    _decide_action,
    _extract_claims_lightweight,
    validate_response,
)


# ── Fixtures ─────────────────────────────────────────────────────

def _bundle(
    *,
    products=None,
    knowledge=None,
    cutting_range=None,
) -> EvidenceBundle:
    return EvidenceBundle(
        products=products or [],
        knowledge_by_type=knowledge or {},
        cutting_range=cutting_range or {},
        catalog_facts={
            "brands": frozenset({"UGM", "YG-1", "V7 PLUS"}),
            "series": frozenset({"UGMG34", "V7 PLUS"}),
            "edps_full": frozenset({"UGMG34919", "EM4010"}),
        },
    )


def _mock_claims(claims):
    """Patch _extract_claims so validate_response returns deterministic
    claim list without hitting the LLM."""
    return patch.object(guard, "_extract_claims", lambda answer, evidence: list(claims))


# ── 1-6: numeric ────────────────────────────────────────────────

def test_01_numeric_grounded_tolerance_inside():
    eb = _bundle(products=[{"edp_no": "X1", "diameter": 10.0}])
    claim = Claim(text="직경 10.05mm", span=(0, 9), type="numeric", subject="product:X1",
                  payload={"value": 10.05, "field": "diameter"}, grounding_required=True)
    res = _check_grounding(claim, eb)
    assert res.status == "grounded"
    assert res.evidence_ref == "products[0].diameter"


def test_02_numeric_boundary_pass():
    eb = _bundle(products=[{"edp_no": "X1", "diameter": 10.0}])
    # exact match — unambiguously grounded
    claim = Claim(text="직경 10mm", span=(0, 7), type="numeric", subject="product:X1",
                  payload={"value": 10.0, "field": "diameter"}, grounding_required=True)
    assert _check_grounding(claim, eb).status == "grounded"


def test_03_numeric_ungrounded_outside_tolerance():
    eb = _bundle(products=[{"edp_no": "X1", "diameter": 10.0}])
    claim = Claim(text="직경 15mm", span=(0, 7), type="numeric", subject="product:X1",
                  payload={"value": 15.0, "field": "diameter"}, grounding_required=True)
    res = _check_grounding(claim, eb)
    assert res.status == "unsupported"
    assert res.evidence_ref is None


def test_04_numeric_strict_mode_strips():
    eb = _bundle(products=[{"edp_no": "X1", "diameter": 10.0}])
    answer = "직경 15mm 입니다."
    claims = [Claim(text="직경 15mm", span=(0, 7), type="numeric", subject="",
                    payload={"value": 15.0, "field": "diameter"}, grounding_required=True)]
    with _mock_claims(claims):
        cleaned, warnings = validate_response(answer, evidence=eb, mode="strict")
    assert "15" not in cleaned
    assert warnings[0]["action"] == "removed"


def test_05_numeric_balanced_mode_strips_too():
    eb = _bundle(products=[{"edp_no": "X1", "diameter": 10.0}])
    answer = "가격은 15,000원 입니다."
    claims = [Claim(text="15,000원", span=(4, 11), type="numeric", subject="",
                    payload={"value": 15000.0, "field": "price"}, grounding_required=True)]
    with _mock_claims(claims):
        cleaned, warnings = validate_response(answer, evidence=eb, mode="balanced")
    assert warnings[0]["action"] == "removed"


def test_06_contradicted_always_removed():
    """Contradicted > mode — removed in strict, balanced, AND loose."""
    eb = _bundle()
    answer = "틀린 사실."
    claims = [Claim(text="틀린 사실.", span=(0, 7), type="numeric", subject="",
                    payload={}, grounding_required=True)]
    for mode in ("strict", "balanced", "loose"):
        with _mock_claims(claims):
            # Override grounding result to contradicted
            with patch.object(guard, "_check_grounding",
                              lambda c, e: GroundingResult("contradicted", None, 1.0)):
                _cleaned, warnings = validate_response(answer, evidence=eb, mode=mode)
        assert warnings[0]["action"] == "removed", f"mode={mode}"


# ── 7-10: categorical + citation ─────────────────────────────────

def test_07_categorical_grounded():
    eb = _bundle(products=[{"edp_no": "X1", "coating": "TiAlN"}])
    claim = Claim(text="TiAlN 코팅", span=(0, 9), type="categorical", subject="",
                  payload={"field": "coating", "value": "TiAlN"}, grounding_required=True)
    res = _check_grounding(claim, eb)
    assert res.status == "grounded"
    assert res.evidence_ref == "products[0].coating"


def test_08_categorical_ungrounded():
    eb = _bundle(products=[{"edp_no": "X1", "coating": "TiAlN"}])
    claim = Claim(text="DLC 코팅", span=(0, 7), type="categorical", subject="",
                  payload={"field": "coating", "value": "DLC"}, grounding_required=True)
    assert _check_grounding(claim, eb).status == "unsupported"


def test_09_citation_grounded_via_rag_substring():
    eb = _bundle(knowledge={
        "material_guide": [{"text": "스테인리스 가공 시 AlCrN 코팅 권장"}]
    })
    claim = Claim(text="AlCrN 코팅 권장", span=(0, 13), type="citation", subject="",
                  payload={"source": "AlCrN 코팅 권장"}, grounding_required=True)
    res = _check_grounding(claim, eb)
    assert res.status == "grounded"
    assert res.evidence_ref.startswith("knowledge.material_guide[")


def test_10_citation_ungrounded():
    eb = _bundle(knowledge={"material_guide": [{"text": "completely unrelated"}]})
    claim = Claim(text="공식 정보 기반 AI 추론", span=(0, 16), type="citation", subject="",
                  payload={"source": "공식 정보 기반 AI 추론"}, grounding_required=True)
    res = _check_grounding(claim, eb)
    assert res.status == "unsupported"


# ── 11-13: existential mode dispatch ─────────────────────────────

def test_11_existential_strict_strips():
    eb = _bundle(products=[{"edp_no": "X1"}])
    answer = "이 제품은 즉시 출고됩니다."
    claims = [Claim(text="이 제품은 즉시 출고됩니다.", span=(0, 15), type="existential",
                    subject="general", payload={}, grounding_required=True)]
    with _mock_claims(claims):
        _cleaned, warnings = validate_response(answer, evidence=eb, mode="strict")
    assert warnings[0]["action"] == "removed"


def test_12_existential_balanced_annotates():
    eb = _bundle(products=[{"edp_no": "X1"}])
    answer = "이 제품은 즉시 출고됩니다."
    claims = [Claim(text="이 제품은 즉시 출고됩니다.", span=(0, 15), type="existential",
                    subject="general", payload={}, grounding_required=True)]
    with _mock_claims(claims):
        cleaned, warnings = validate_response(answer, evidence=eb, mode="balanced")
    assert warnings[0]["action"] == "annotated"
    # Text untouched in balanced mode for existential unsupported
    assert answer == cleaned


def test_13_existential_loose_passes():
    eb = _bundle()
    answer = "즉시 출고됩니다."
    claims = [Claim(text="즉시 출고됩니다.", span=(0, 9), type="existential",
                    subject="general", payload={}, grounding_required=True)]
    with _mock_claims(claims):
        cleaned, warnings = validate_response(answer, evidence=eb, mode="loose")
    assert warnings[0]["action"] == "annotated"  # loose → annotated, not passed
    assert cleaned == answer


# ── 14-15: domain_knowledge skip ─────────────────────────────────

def test_14_domain_knowledge_always_grounded():
    eb = _bundle()
    claim = Claim(text="일반 가공 상식.", span=(0, 8), type="domain_knowledge",
                  subject="", payload={}, grounding_required=False)
    res = _check_grounding(claim, eb)
    assert res.status == "grounded"


def test_15_domain_knowledge_never_stripped():
    eb = _bundle()
    answer = "일반적으로 스테인리스는 가공경화성이 높다."
    claims = [Claim(text=answer, span=(0, len(answer)), type="domain_knowledge",
                    subject="", payload={}, grounding_required=False)]
    with _mock_claims(claims):
        cleaned, warnings = validate_response(answer, evidence=eb, mode="strict")
    assert cleaned == answer
    assert warnings[0]["action"] == "passed"


# ── 16-17: empty + short answer short-circuit ────────────────────

def test_16_empty_answer_no_work():
    eb = _bundle()
    cleaned, warnings = validate_response("", evidence=eb, mode="balanced")
    assert cleaned == ""
    assert warnings == []


def test_17_short_answer_skips_llm():
    """Answer below VALIDATOR_LLM_MIN_CHARS → _extract_claims returns []
    without hitting the LLM. Assert by mocking the LLM path to raise if
    called, then verifying it's NOT called."""
    eb = _bundle()
    with patch.object(guard, "_get_embed_client",
                      side_effect=AssertionError("LLM must not be called")):
        cleaned, warnings = validate_response(
            "짧은 답", evidence=eb, mode="balanced", skip_product_extraction=False
        )
    # No claims extracted + no lightweight citation hits
    assert warnings == []


# ── 18-20: partial removal + tolerance ───────────────────────────

def test_18_partial_strip_from_multi_claim_sentence():
    eb = _bundle(products=[{"edp_no": "X1", "diameter": 10.0}])
    answer = "직경 10mm TiAlN 코팅 제품이며 HRC 60까지 가능합니다."
    claims = [
        # grounded diameter
        Claim(text="직경 10mm", span=(0, 7), type="numeric", subject="",
              payload={"value": 10.0, "field": "diameter"}, grounding_required=True),
        # ungrounded HRC
        Claim(text="HRC 60까지 가능합니다.", span=(answer.index("HRC"), len(answer)),
              type="numeric", subject="",
              payload={"value": 60.0, "field": "hardness_hrc"},
              grounding_required=True),
    ]
    with _mock_claims(claims):
        cleaned, warnings = validate_response(answer, evidence=eb, mode="strict")
    assert "10mm" in cleaned
    assert "HRC" not in cleaned
    assert sum(1 for w in warnings if w["action"] == "removed") == 1
    assert sum(1 for w in warnings if w["action"] == "passed") == 1


def test_19_numeric_tolerance_inside():
    eb = _bundle(products=[{"edp_no": "X1", "diameter": 100.0}])
    # 0.5% off — within default 1%
    claim = Claim(text="100.5mm", span=(0, 7), type="numeric", subject="",
                  payload={"value": 100.5, "field": "diameter"}, grounding_required=True)
    assert _check_grounding(claim, eb).status == "grounded"


def test_20_numeric_tolerance_outside():
    eb = _bundle(products=[{"edp_no": "X1", "diameter": 100.0}])
    # 5% off — outside default 1%
    claim = Claim(text="105mm", span=(0, 5), type="numeric", subject="",
                  payload={"value": 105.0, "field": "diameter"}, grounding_required=True)
    assert _check_grounding(claim, eb).status == "unsupported"


# ── 21-22: semantic threshold proxy ──────────────────────────────

def test_21_citation_substring_hit_passes_any_threshold():
    eb = _bundle(knowledge={
        "material_guide": [{"text": "스테인리스 가공 시 AlCrN 권장"}]
    })
    claim = Claim(text="AlCrN 권장", span=(0, 8), type="citation", subject="",
                  payload={"source": "AlCrN 권장"}, grounding_required=True)
    # Substring path doesn't involve embeddings
    assert _check_grounding(claim, eb).status == "grounded"


def test_22_citation_no_substring_and_no_embed_yields_unsupported():
    eb = _bundle(knowledge={"material_guide": [{"text": "foo bar baz"}]})
    claim = Claim(text="quux", span=(0, 4), type="citation", subject="",
                  payload={"source": "quux"}, grounding_required=True)
    # No embedding API in test env → has_rag_mention returns None
    assert _check_grounding(claim, eb).status == "unsupported"


# ── 23-25: mode transition matrix ────────────────────────────────

@pytest.mark.parametrize("mode,expected", [
    ("strict", "removed"),
    ("balanced", "removed"),     # numeric → removed in balanced
    ("loose", "annotated"),
])
def test_23_to_25_numeric_mode_matrix(mode: str, expected: str):
    assert _decide_action("unsupported", "numeric", mode) == expected


# ── 26-27: lightweight path (verifier already ran) ───────────────

def test_26_lightweight_path_no_llm_call():
    eb = _bundle(products=[{"edp_no": "X1", "diameter": 10.0}])
    answer = (
        "직경 10mm TiAlN 코팅 제품입니다. "
        "공식 정보 기반 AI 추론에 따르면 이 제품은 최고입니다."
    )
    # Assertion: _extract_claims must NOT be called on lightweight path
    with patch.object(guard, "_extract_claims",
                      side_effect=AssertionError("LLM path must be skipped")):
        cleaned, warnings = validate_response(
            answer, evidence=eb, mode="balanced", skip_product_extraction=True
        )
    # Citation pattern in patterns.FAKE_CITATION_PHRASES → flagged
    assert any(w["category"] == "citation" for w in warnings)


def test_27_full_path_llm_called_when_verifier_off():
    eb = _bundle(products=[{"edp_no": "X1"}])
    answer = "직경 10mm 이며 TiAlN 코팅입니다. 여러 문장이 포함되어야 LLM 이 호출됩니다."
    calls = []

    def _fake_extract(ans, ev):
        calls.append(ans)
        return []
    with patch.object(guard, "_extract_claims", side_effect=_fake_extract):
        _cleaned, _warnings = validate_response(
            answer, evidence=eb, mode="balanced", skip_product_extraction=False
        )
    assert len(calls) == 1


# ── 28-30: mechanics ─────────────────────────────────────────────

def test_28_multi_span_removal_back_to_front():
    # Three non-overlapping spans; _apply_removals must produce same result
    # regardless of input order.
    txt = "ABCDEFGHIJKLMNOP"
    spans = [(2, 5), (8, 10), (13, 15)]
    cleaned_a = _apply_removals(txt, spans)
    cleaned_b = _apply_removals(txt, list(reversed(spans)))
    assert cleaned_a == cleaned_b
    assert "CDE" not in cleaned_a
    assert "IJ" not in cleaned_a
    assert "NO" not in cleaned_a


def test_29_invalid_span_claim_skipped():
    """LLM returned a span outside the answer bounds — _finalize_claims
    must rebuild via substring OR drop the claim (no IndexError)."""
    eb = _bundle()
    answer = "정상 문장입니다."
    bogus = [{"text": "없는 문장", "type": "numeric", "subject": "",
              "payload": {}, "grounding_required": True, "span": [0, 999]}]
    claims = guard._finalize_claims(bogus, answer)
    # Text "없는 문장" not in answer → claim dropped
    assert claims == []


def test_30_warnings_json_serializable():
    """ProductsResponse.validator_warnings must survive json.dumps without
    custom encoders. Tuple spans become list[int] on asdict; check the
    whole list serializes cleanly."""
    import json
    eb = _bundle()
    answer = "공식 정보 기반 AI 추론에 따르면 이 제품이 좋습니다."
    _cleaned, warnings = validate_response(
        answer, evidence=eb, mode="balanced", skip_product_extraction=True
    )
    assert warnings, "citation detector should fire on the fake citation"
    serialized = json.dumps(warnings, ensure_ascii=False)
    round_trip = json.loads(serialized)
    assert isinstance(round_trip, list)
    assert all(isinstance(w["span"], list) and len(w["span"]) == 2 for w in round_trip)
