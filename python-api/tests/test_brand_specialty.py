"""brand_specialty.specialty_boost — sub-material brand specialty ranker.

The boost signal that discriminates within an ISO group (N copper vs N
aluminum, H mold vs H die). No DB required — the mapping table is a
literal dict in brand_specialty.py.
"""
from brand_specialty import specialty_boost, SPECIALTY_WEIGHTS


def test_crx_copper_primary():
    """CRX S is table-primary for 구리 subgroup → positive boost."""
    boost, reason = specialty_boost("CRX S", workpiece_name="구리")
    assert boost > 0, f"expected positive boost, got {boost} ({reason})"
    assert "primary" in reason.lower() or SPECIALTY_WEIGHTS["primary"] == boost


def test_alu_power_aluminum_primary():
    """ALU-POWER is the canonical aluminum line → primary boost."""
    boost, reason = specialty_boost("ALU-POWER", workpiece_name="알루미늄")
    assert boost > 0, f"expected positive boost, got {boost} ({reason})"


def test_alu_power_copper_wrong():
    """ALU-POWER on copper is a wrong-material bet + ALU-name penalty → net
    negative, or at least strictly below a primary-match brand."""
    boost_alu_on_cu, _ = specialty_boost("ALU-POWER", workpiece_name="구리")
    boost_crx_on_cu, _ = specialty_boost("CRX S", workpiece_name="구리")
    # Relative check: specialist brand must still out-rank the
    # aluminum-marketed one on copper.
    assert boost_crx_on_cu > boost_alu_on_cu


def test_neutral_brand():
    """A brand the table doesn't reference on a specific workpiece →
    name-substring layer only. "RandomBrand42" has no alignment anywhere."""
    boost, reason = specialty_boost("RandomBrand42", workpiece_name="구리")
    assert boost == 0.0, f"unknown brand should get 0, got {boost} ({reason})"


def test_no_workpiece_no_subgroup():
    """Without workpiece_name or material_tag, sub-group resolution fails
    and the helper returns (0, 'no-subgroup')."""
    boost, reason = specialty_boost("ALU-POWER")
    assert boost == 0.0
    assert reason == "no-subgroup"
