"""affinity.get_affinity / hrc_covers — brand × material affinity reader.

These tests inject a synthetic cache via `set_cache()` so the DB isn't
touched. HRC coverage uses a similar in-process cache.
"""
import pytest
from affinity import (
    get_affinity,
    hrc_covers,
    set_cache,
)


@pytest.fixture(autouse=True)
def _seed_cache():
    """Inject a minimal affinity table so get_affinity has predictable
    values without hitting the DB. Mimics the real public.brand_material_affinity
    layout: {brand_upper: {kind: {key: score}}}."""
    # _normalize_brand strips dashes/spaces, so the table must be keyed on
    # the normalized form ("ALU-POWER" → "ALUPOWER"). Same for workpiece
    # keys which use the affinity module's canonicalized form (COPPER etc).
    set_cache({
        "ALUPOWER": {
            "iso_group": {"N": 92.0},
            "workpiece": {"ALUMINUM": 95.0, "COPPER": 35.0},
        },
        "V7PLUS": {
            "iso_group": {"P": 88.0, "M": 72.0},
            "workpiece": {"CARBONSTEEL": 88.0},
        },
        "XPOWER": {
            "iso_group": {"H": 75.0},
            "workpiece": {"HARDENEDSTEEL": 80.0},
        },
    })
    yield
    set_cache({})


def test_excellent_rating():
    """ALU-POWER on N-group → high score → EXCELLENT tier downstream."""
    assert get_affinity("ALU-POWER", "N") == 92.0


def test_workpiece_level_resolution():
    """Workpiece-level key beats ISO-level when the cache has it."""
    assert get_affinity("ALU-POWER", "알루미늄") == 95.0
    # Unknown brand → 0.0, not an exception.
    assert get_affinity("NO-SUCH-BRAND", "N") == 0.0


def test_good_rating():
    """V7 PLUS on M-group → GOOD-tier-ish score."""
    score = get_affinity("V7 PLUS", "M")
    assert score > 0 and score < 95


def test_hrc_covers_returns_bool():
    """hrc_covers reads a separate cache; absent data → False but no crash."""
    result = hrc_covers("X-POWER", 58.0)
    assert isinstance(result, bool)


def test_unknown_brand_returns_zero():
    assert get_affinity(None, "N") == 0.0
    assert get_affinity("X-POWER", None) == 0.0
    assert get_affinity("", "") == 0.0
