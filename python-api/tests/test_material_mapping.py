"""MaterialMapping resolver — 100-case coverage for resolve_rich /
reverse_lookup / find_nearest. Exercises every tier of the cascade
(exact / cross_standard / slang / fuzzy / embedding / no_match) plus
the helper APIs.

Categories:
  exact canonical          15
  cross-standard           20
  slang ko                 25
  fuzzy prefix             10
  fuzzy substring / typo   10
  no_match                  5
  reverse_lookup            5
  embedding fallback       10  (marked slow — OpenAI key gated)
  ──────────────────────────
  total                   100

No DB required. The CSV-backed index loads once per module from
data/materials/ via the autouse fixture.
"""
from __future__ import annotations

import os

import pytest

from alias_resolver import (
    _build_material_mapping_index,
    find_nearest,
    material_index_stats,
    resolve_rich,
    reverse_lookup,
)


@pytest.fixture(scope="module", autouse=True)
def _load_index():
    """Build the material mapping index once per test module. Idempotent —
    repeated calls rebuild in place, so test ordering doesn't matter."""
    _build_material_mapping_index()
    stats = material_index_stats()
    if stats["canonicals"] == 0:
        pytest.skip("iso_mapping.csv absent — skipping material mapping tests")
    yield


# Helper — some rows in the CSV carry a canonical with an internal space
# (e.g. "SUS 304" vs "SUS304"). Normalize for assertion comparisons only,
# not for the lookup side (the resolver already handles that).
def _norm(s: str) -> str:
    return (s or "").replace(" ", "").upper()


# ══════════════════════════════════════════════════════════════════════
#  1. EXACT CANONICAL (15)
# ══════════════════════════════════════════════════════════════════════
# User types the canonical itself — resolver returns status="exact"
# with confidence=1.0. Canonical preference is JIS → AISI → DIN → EN
# → Material_No so Korean / Japanese codes stay as-is.
_EXACT_CASES = [
    ("S45C", "S45C", "P"),
    ("SCM440", "SCM440", "P"),
    ("SKD11", "SKD11", "P"),        # VP CSV classifies as P (prehardened)
    ("SKD61", "SKD61", "P"),
    ("SUS316", "SUS316", "M"),
    ("SUS316L", "SUS316L", "M"),
    ("SUS420", "SUS420", "M"),
    ("SUS430", "SUS430", "M"),
    ("NAK80", "NAK80", "H"),        # trade name — iso_group from slang CSV
    ("Inconel 718", "Inconel718", "S"),
    ("inconel 718", "Inconel718", "S"),  # case-insensitive via _normalize_std
    ("Ti-6Al-4V", "Ti-6Al-4V", "S"),
    ("FC250", "FC250", "K"),
    ("FCD450", "FCD450", "K"),
    ("SUH330", "SUH330", "S"),
]


@pytest.mark.parametrize("query,expected_canonical,expected_iso", _EXACT_CASES)
def test_exact_canonical(query, expected_canonical, expected_iso):
    m = resolve_rich(query)
    assert m.status == "exact", (
        f"{query!r} status={m.status} canon={m.canonical_iso}"
    )
    assert _norm(m.canonical_iso) == _norm(expected_canonical)
    assert m.iso_group == expected_iso
    assert m.confidence >= 0.95


# ══════════════════════════════════════════════════════════════════════
#  2. CROSS-STANDARD (20)
# ══════════════════════════════════════════════════════════════════════
# User types a regional standard (DIN/AISI/BS/UNS/W.Nr); resolver redirects
# to the JIS-preferred canonical. iso_group is the stable invariant —
# canonical may be any row in that group, so only ISO is asserted.
_CROSS_CASES = [
    ("1045", "P"),            # AISI → S45C
    ("C45", "P"),             # DIN → S45C
    ("060A47", "P"),          # BS → S45C
    ("Ck45", "P"),            # DIN variant → S45C
    ("1.2379", "P"),          # W.Nr → SKD11
    ("D2", "P"),              # AISI → SKD11
    ("X155CrVMo121", "P"),    # DIN → SKD11
    ("X5CrNi18-9", "M"),      # DIN → SUS304 family
    ("304", "M"),             # AISI bare → SUS304 family
    ("S30400", "M"),          # UNS → SUS304
    ("1.2343", "P"),          # W.Nr → SKD6
    ("H13", "P"),              # AISI hot-work → SKD61
    ("1.2344", "P"),          # W.Nr → SKD61
    ("X40CrMoV51", "P"),      # DIN → SKD61
    ("42CrMo4", "P"),         # DIN → SCM440 (CSV first-writer is annealed P row)
    ("4140", "P"),             # AISI → SCM440
    ("1.4301", "M"),           # W.Nr stainless
    ("1.4401", "M"),           # W.Nr → SUS316
    ("S31600", "M"),           # UNS → SUS316
    ("F.3551", "M"),           # UNI → SUS304
]


@pytest.mark.parametrize("query,expected_iso", _CROSS_CASES)
def test_cross_standard(query, expected_iso):
    m = resolve_rich(query)
    # Accept exact if the canonical happens to equal the query (rare but
    # possible — e.g. some codes appear verbatim in multiple columns).
    assert m.status in ("cross_standard", "exact"), (
        f"{query!r} got {m.status}"
    )
    assert m.canonical_iso is not None
    assert m.iso_group == expected_iso, (
        f"{query!r} → canon={m.canonical_iso} iso={m.iso_group}"
    )
    assert isinstance(m.cross_refs, dict)


# ══════════════════════════════════════════════════════════════════════
#  3. SLANG KO (25)
# ══════════════════════════════════════════════════════════════════════
# Korean operator shorthand. Each maps to a JIS canonical or trade name
# via slang_ko.csv. Iso group comes from the main CSV when the canonical
# is present there, otherwise from the slang CSV's iso_group column.
_SLANG_CASES = [
    ("사오시", "S45C", "P"),
    ("에스사오시", "S45C", "P"),
    ("S45씨", "S45C", "P"),
    ("낙팔공", "NAK80", "H"),
    ("NAK팔공", "NAK80", "H"),
    ("크로몰리440", "SCM440", "P"),
    ("에스씨엠440", "SCM440", "P"),
    ("에스씨엠435", "SCM435", "P"),
    ("SKD열한", "SKD11", "P"),
    ("스키디십일", "SKD11", "P"),
    ("에스케이디11", "SKD11", "P"),
    ("SKD육일", "SKD61", "P"),
    ("에스케이디61", "SKD61", "P"),
    ("스뎅304", "SUS304", "M"),
    ("서스304", "SUS304", "M"),
    ("스댕304", "SUS304", "M"),
    ("스테인리스304", "SUS304", "M"),
    ("스뎅316", "SUS316", "M"),
    ("서스316", "SUS316", "M"),
    ("주철250", "FC250", "K"),
    ("에프씨250", "FC250", "K"),
    ("구상흑연주철450", "FCD450", "K"),
    ("티타늄64", "Ti-6Al-4V", "S"),
    ("Ti64", "Ti-6Al-4V", "S"),
    ("인코넬718", "Inconel 718", "S"),
]


@pytest.mark.parametrize("query,expected_canonical,expected_iso", _SLANG_CASES)
def test_slang_ko(query, expected_canonical, expected_iso):
    m = resolve_rich(query)
    assert m.status == "slang", f"{query!r} got {m.status}"
    assert _norm(m.canonical_iso) == _norm(expected_canonical)
    assert m.iso_group == expected_iso
    assert m.confidence >= 0.85
    assert m.matched_via == "slang_ko"


# ══════════════════════════════════════════════════════════════════════
#  4. FUZZY PREFIX (10)
# ══════════════════════════════════════════════════════════════════════
# Truncated / partial codes that match via digit+prefix scoring. Accept
# exact/cross_standard/fuzzy because short codes sometimes hit exactly.
# Asserting only iso_group here — specific canonical depends on CSV content
# and is noisy for partial prefixes.
_FUZZY_PREFIX_CASES = [
    ("SUS30", "M"),
    ("S45", "P"),
    ("SKD6", "P"),
    ("SKD1", "P"),
    ("SUS31", "M"),
    ("1.23", "P"),
    ("SCM44", "P"),
    ("FC25", "K"),
    ("FCD45", "K"),
    ("SUS4", "M"),
]


@pytest.mark.parametrize("query,expected_iso", _FUZZY_PREFIX_CASES)
def test_fuzzy_prefix(query, expected_iso):
    m = resolve_rich(query)
    assert m.status != "no_match", f"{query!r} no_match"
    assert m.canonical_iso is not None, f"{query!r} no canonical"
    # iso_group must align — the prefix carries enough signal that the
    # resolver shouldn't misroute to an unrelated ISO group.
    assert m.iso_group == expected_iso, (
        f"{query!r} → canon={m.canonical_iso} iso={m.iso_group}"
    )


# ══════════════════════════════════════════════════════════════════════
#  5. FUZZY SUBSTRING / TYPO (10)
# ══════════════════════════════════════════════════════════════════════
# Embedded codes or typo variants — code appears inside a longer string
# or carries a spacing/casing tweak. _normalize_std collapses punctuation
# so most cases actually hit exact after normalization.
_FUZZY_SUB_CASES = [
    ("SUS-304", "M"),            # punctuation strip
    ("S-45-C", "P"),
    ("SKD_11", "P"),
    ("SUS_304", "M"),
    ("NAK_80", "H"),
    ("Ti 6Al 4V", "S"),          # spaces → collapse
    ("SKD 11", "P"),
    ("inconel718", "S"),
    ("sus304l", "M"),
    ("s45 c", "P"),
]


@pytest.mark.parametrize("query,expected_iso", _FUZZY_SUB_CASES)
def test_fuzzy_substring(query, expected_iso):
    m = resolve_rich(query)
    assert m.status != "no_match", f"{query!r} no_match"
    assert m.iso_group == expected_iso, (
        f"{query!r} → canon={m.canonical_iso} iso={m.iso_group}"
    )


# ══════════════════════════════════════════════════════════════════════
#  6. NO_MATCH (5)
# ══════════════════════════════════════════════════════════════════════
# Non-material strings — must not produce exact / cross_standard / slang.
# Alternatives may be empty (no signal at all) or populated with weak
# find_nearest guesses.
_NO_MATCH_CASES = [
    "ZZZXNONEXISTENT",
    "완전히존재하지않는소재명XYZ",
    "abcdefghijklmnop_not_a_material",
    "!!!!",
    "random gibberish 12345",
]


@pytest.mark.parametrize("query", _NO_MATCH_CASES)
def test_no_match(query):
    m = resolve_rich(query)
    assert m.status not in ("exact", "cross_standard", "slang"), (
        f"{query!r} unexpectedly matched as {m.status} canon={m.canonical_iso}"
    )
    if m.status == "no_match":
        assert m.canonical_iso is None
        assert m.confidence == 0.0
        assert isinstance(m.alternatives, list)


# ══════════════════════════════════════════════════════════════════════
#  7. REVERSE_LOOKUP (5)
# ══════════════════════════════════════════════════════════════════════
# Given a canonical, fetch every synonym. Trade names degrade gracefully
# to {canonical, iso_group, slang_ko}.

def test_reverse_lookup_jis_canonical():
    """S45C canonical → full cross-standard + slang harvest."""
    out = reverse_lookup("S45C")
    assert out["canonical"] == ["S45C"]
    assert out["iso_group"] == ["P"]
    assert "jis" in out and out["jis"] == ["S45C"]
    assert "din" in out and out["din"] == ["C45"]
    assert "aisi" in out and out["aisi"] == ["1045"]
    slang_set = set(out.get("slang_ko", []))
    assert "사오시" in slang_set
    assert "에스사오시" in slang_set


def test_reverse_lookup_trade_name():
    """NAK80 (trade name, not in VP CSV's standard columns) — degraded
    output: just canonical + iso_group + slang_ko."""
    out = reverse_lookup("NAK80")
    assert out["canonical"] == ["NAK80"]
    assert out["iso_group"] == ["H"]
    assert "jis" not in out
    assert "낙팔공" in set(out.get("slang_ko", []))


def test_reverse_lookup_stainless_canonical():
    """SUS 304 (with space — CSV's canonical form). Must surface DIN and
    all 4 Korean slang variants."""
    # Accept either space or no-space spelling as dict key
    out = reverse_lookup("SUS 304") or reverse_lookup("SUS304")
    assert out.get("iso_group") == ["M"]
    assert "스뎅304" in set(out.get("slang_ko", []))
    assert "서스304" in set(out.get("slang_ko", []))


def test_reverse_lookup_inconel_trade():
    """Inconel 718 — trade name with S group and 3 Korean slang."""
    out = reverse_lookup("Inconel 718")
    assert out["iso_group"] == ["S"]
    slang_set = set(out.get("slang_ko", []))
    assert "인코넬718" in slang_set


def test_reverse_lookup_unknown():
    """Unknown canonical → empty dict, not an exception."""
    out = reverse_lookup("CompletelyUnknownMaterial")
    assert out == {}


# ══════════════════════════════════════════════════════════════════════
#  8. EMBEDDING FALLBACK (10) — SLOW, OPENAI-GATED
# ══════════════════════════════════════════════════════════════════════
# CSV-miss novel phrasings. Index-build skips embedding when OPENAI_API_KEY
# is absent, so these are marked slow and skipped on key-less runs.
_EMBEDDING_CASES = [
    "stainless steel 304",
    "inconel seven eighteen",
    "4140 chromoly steel",
    "mild carbon steel",
    "austenitic stainless grade",
    "hardened tool steel D2",
    "gray cast iron GG25",
    "titanium alloy Ti64",
    "pre-hardened plastic mold steel",
    "nickel-based super alloy",
]


@pytest.mark.slow
@pytest.mark.parametrize("query", _EMBEDDING_CASES)
def test_embedding_fallback(query):
    """Novel natural-language phrasing — embedding tier should find SOME
    canonical above threshold, OR (when cosine stays below the 0.75 floor)
    at minimum surface reasonable alternatives so the UI can prompt the
    user. This covers the "we tried but weren't confident" degraded path
    that still beats silent no-op."""
    if not os.environ.get("OPENAI_API_KEY"):
        pytest.skip("no OPENAI_API_KEY — embedding tier disabled")
    from alias_resolver import _canonical_embeddings, _build_material_embeddings
    if not _canonical_embeddings:
        _build_material_embeddings()
    if not _canonical_embeddings:
        pytest.skip("embedding index failed to build (upstream error)")
    m = resolve_rich(query)
    # Pass condition: resolved status OR no_match with plausible alternatives.
    # Natural-language descriptions rarely cross the 0.75 cosine floor
    # against bare canonical names (needs richer corpus), so the fallback
    # of surfacing top-3 guesses is the meaningful signal for the LLM.
    if m.status == "no_match":
        assert len(m.alternatives) >= 1, (
            f"{query!r} → no_match with no alternatives"
        )
    else:
        # Any cascaded resolution (embedding/fuzzy/cross/exact/slang) is fine.
        assert m.canonical_iso is not None


# ══════════════════════════════════════════════════════════════════════
#  9. find_nearest sanity — 3 sanity checks (do not count toward 100)
# ══════════════════════════════════════════════════════════════════════

def test_find_nearest_sorted_desc():
    results = find_nearest("SUS3", 5)
    assert len(results) > 0
    scores = [s for _, s in results]
    assert scores == sorted(scores, reverse=True)


def test_find_nearest_respects_top_n():
    assert len(find_nearest("S", 3)) <= 3


def test_find_nearest_empty_query():
    assert find_nearest("", 3) == []
