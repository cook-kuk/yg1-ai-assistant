"""Brand / coating / shank / invalid-brand SSOT.

Mirrors the TypeScript side's `lib/types/canonical-values.ts`. Brand and
coating vocabularies live here so scr.py, scoring.py, and the verifier
all see the same canonical forms; mismatches between modules were a
source of silent ranking bugs.

Note: the LIVE brand universe (all 79 DB brands) is still fetched from
`catalog_app.product_recommendation_mv.edp_brand_name` by
`scr._get_brands()` — that stays dynamic. What's here are the fixed
classification sets (shank / coating / invalid).
"""
from __future__ import annotations

# ══════════════════════════════════════════════════════════════════════
# Shank types — fixed DB canonical set
# ══════════════════════════════════════════════════════════════════════
# The full list referenced by scr._fuzzy_resolve when normalizing a
# shank string the LLM emitted. Order matters for the "longest first"
# tiebreak in _pick — specifically, "Flat (YG-1 Standard)" and
# "Flat (DIN 1835B)" come after bare "Flat" so prefix matches resolve
# to the shorter canonical when the user typed just "Flat".
SHANK_CANONICAL: tuple[str, ...] = (
    "Weldon",
    "Cylindrical",
    "Morse Taper",
    "Straight",
    "Flat",
    "Flat (YG-1 Standard)",
    "Flat (DIN 1835B)",
)

# ══════════════════════════════════════════════════════════════════════
# Coatings — fixed DB canonical set
# ══════════════════════════════════════════════════════════════════════
# Same rationale as shank — used by _fuzzy_resolve for normalization.
# TiAlN / AlTiN / AlCrN are the pure chemistry names; T-/Y-/X-/Z-Coating
# are YG-1 branded families that map roughly (see SYSTEM_PROMPT_TEMPLATE's
# 한글·축약 변형 table). Bright Finish ≈ Uncoated in practice but DB
# keeps them distinct so we carry both.
COATING_CANONICAL: tuple[str, ...] = (
    "TiAlN", "AlTiN", "AlCrN", "TiCN", "TiN", "DLC", "Diamond",
    "T-Coating", "Y-Coating", "X-Coating", "Z-Coating",
    "XC-Coating", "RCH-Coating", "Hardslick",
    "Bright Finish", "Uncoated",
)

# ══════════════════════════════════════════════════════════════════════
# Invalid brand carry-forward set
# ══════════════════════════════════════════════════════════════════════
# Category-style "brands" the LLM sometimes hallucinates from generic
# nouns ("tool", "insert"). Blocking them from session.carry_forward
# prevents a stale misparse on turn 1 from poisoning turn 2's search
# after the prompt fix landed.
INVALID_BRANDS: frozenset[str] = frozenset({
    "Tooling System",
    "Milling Insert",
    "ADKT Cutter",
    "MORSE TAPER SHANK DRILLS",
    "Morse Taper Shank Drills",
    "Turning",
})

# ══════════════════════════════════════════════════════════════════════
# Flagship / micro brand tiers (scoring.py)
# ══════════════════════════════════════════════════════════════════════
# Brands YG-1 routinely steers customers toward — they pick up a flat
# +flagship_boost at rank time. Micro is the inverse list for commodity
# lines; kept empty by default but wired so ops can flip brands without
# touching code.
FLAGSHIP_BRANDS: frozenset[str] = frozenset({
    "V7 PLUS", "X-POWER", "TitaNox-Power",
    "ALU-POWER", "ALU-POWER HPC", "3S MILL",
})

MICRO_BRANDS: frozenset[str] = frozenset()

# ══════════════════════════════════════════════════════════════════════
# ISO material groups + per-material preferred brand order
# ══════════════════════════════════════════════════════════════════════
# ISO 513 machinability groups — P/M/K/N/S/H (O is "others"; intentionally
# excluded here since the ranker doesn't special-case it).
ISO_MATERIAL_GROUPS: tuple[str, ...] = ("P", "M", "K", "N", "S", "H")

# Hand-curated priority hints. When a candidate's brand appears in the
# list for the current ISO group we add SCORING_CONFIG["material_pref"]
# to the raw score. Missing keys = no preference expressed.
MATERIAL_SERIES_PREF: dict[str, list[str]] = {
    "N": ["ALU-POWER", "ALU-POWER HPC", "ALU-CUT", "CRX S"],
    "M": ["TitaNox-Power", "X-POWER", "V7 PLUS A"],
    "S": ["TitaNox-Power"],
    "H": ["X-POWER", "3S MILL"],
    "P": ["V7 PLUS", "X-POWER", "3S MILL"],
    "K": ["V7 PLUS", "3S MILL"],
}
