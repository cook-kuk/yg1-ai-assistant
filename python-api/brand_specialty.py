"""Brand × sub-material specialty boosts — port of yg1's BRAND_SUBGROUP_SPECIALTY.

The DB's brand_material_affinity table only keys by ISO group, so within
N-group every aluminum-tagged endmill looks equally "excellent" for a copper
request. This module encodes real-world specialty knowledge (which YG-1 brand
actually *targets* which sub-material) so CRX S wins for copper and D-POWER
CFRP wins for composite, instead of whichever brand has the biggest catalog
slice within ISO N.

Design:
  - One static table keyed by canonical (uppercase) brand. Values are an
    ordered tuple of sub-material labels; the FIRST entry is the brand's
    primary specialty (biggest boost).
  - `specialty_boost()` maps a (brand, workpiece_name_or_subgroup) pair to a
    signed boost: primary match ≫ secondary match ≫ 0 ≫ wrong-specialty
    penalty (so a CFRP brand doesn't out-rank CRX S for copper).
  - Sub-material label resolution piggybacks on affinity.canonicalize_workpiece_key
    for the KO/EN aliases it already covers (구리→COPPER etc.), with an extra
    layer for subgroups affinity doesn't model (graphite, composite, tool_steel,
    austenitic, …).
  - Boost magnitudes live in `SPECIALTY_WEIGHTS` so scoring.SCORING_CONFIG can
    override at runtime without touching this file.
"""
from __future__ import annotations

import re
from typing import Optional

# ── Weights ───────────────────────────────────────────────────────────
# Primary specialty match dominates — a brand that *targets* this sub-
# material outranks a generic "excellent for ISO group" peer. Secondary
# (listed but not primary) still boosts, just less. Wrong-specialty
# is a NEGATIVE tax applied when the brand is specialized in a DIFFERENT
# sub-material — this is what prevents D-POWER CFRP from ranking above
# CRX S for copper requests.
SPECIALTY_WEIGHTS: dict[str, float] = {
    "primary": 20.0,       # brand's #1 target — e.g. CRX S for copper
    "secondary": 10.0,     # listed specialty but not primary
    "wrong": -15.0,        # brand targets a DIFFERENT subgroup
    "name_hit": 6.0,       # brand/name/series substring matches subgroup term
    "alu_name_penalty": -12.0,  # ALU-* brand suggested for non-aluminum subgroup
}


# ── Brand → ordered sub-material specialties ─────────────────────────
# Ordered: first entry is the brand's PRIMARY specialty. Missing brands
# fall back to the name-substring heuristic below.
#
# Names normalized to uppercase with one space between tokens — cook-forge's
# brand_norm rule. `_canonical_brand()` maps user-provided brand strings to
# these keys.
BRAND_SUBGROUP_SPECIALTY: dict[str, tuple[str, ...]] = {
    # ── N (non-ferrous) ────────────────────────────────────────────
    "CRX S":                         ("copper", "brass", "bronze"),
    "D-POWER GRAPHITE":              ("graphite",),
    "G-CUT FOR KOREAN MARKET":       ("graphite", "copper", "brass"),
    "D-POWER CFRP":                  ("composite",),
    "COMPOSITE MATERIALS":           ("composite",),
    "ALU-POWER":                     ("aluminum",),
    "ALU-POWER HPC":                 ("aluminum",),
    "ALU-CUT FOR KOREAN MARKET":     ("aluminum",),
    "ALU-CUT":                       ("aluminum",),
    # ── S (superalloy / heat-resistant) ────────────────────────────
    "TITANOX-POWER":                 ("titanium", "inconel", "hastelloy", "waspaloy", "monel", "cobalt"),
    "TITANOX-POWER HPC":             ("inconel", "titanium", "waspaloy", "nimonic", "hastelloy"),
    "TI-PHOON":                      ("titanium", "inconel"),
    "YG TAP TI NI":                  ("titanium", "inconel", "monel"),
    # ── H (hardened / tool / mold steel) ───────────────────────────
    "X5070":                         ("tool_steel", "mold_steel", "hardened_high"),
    "X5070 S":                       ("hardened_high", "tool_steel", "powder_steel"),
    "DREAM DRILLS FOR HIGH HARDENED STEEL": ("mold_steel", "tool_steel", "hardened_high"),
    "CBN":                           ("hardened_high", "powder_steel", "white_iron"),
    "CBN END MILLS":                 ("hardened_high", "powder_steel"),
    "X-POWER S":                     ("tool_steel", "mold_steel", "hardened_high"),
    "X-POWER PRO":                   ("tool_steel", "mold_steel"),
    "V7 PLUS A":                     ("tool_steel", "carbon_steel", "alloy_steel", "bearing_steel"),
    # ── M (stainless) ──────────────────────────────────────────────
    "V7 MILL-INOX":                  ("austenitic", "martensitic", "ferritic", "duplex", "precipitation"),
    "SUS-CUT FOR KOREAN MARKET":     ("austenitic", "martensitic", "ferritic"),
    "DREAM DRILLS-INOX":             ("austenitic", "martensitic", "ferritic", "duplex"),
    "YG TAP INOX":                   ("austenitic", "martensitic", "ferritic"),
    # ── P (steel) ──────────────────────────────────────────────────
    "V7 PLUS":                       ("carbon_steel", "alloy_steel", "structural"),
    "V7 MILL-STEEL":                 ("carbon_steel", "alloy_steel", "structural"),
    "TANK-POWER":                    ("alloy_steel", "carbon_steel", "grey_iron", "ductile_iron"),
    "3S MILL":                       ("tool_steel_p", "carbon_steel", "alloy_steel"),
    "K-2 CARBIDE":                   ("alloy_steel", "carbon_steel"),
    "JET-POWER":                     ("carbon_steel", "alloy_steel", "inconel"),
    # ── K (cast iron) ──────────────────────────────────────────────
    "4G MILL":                       ("grey_iron", "ductile_iron", "white_iron", "malleable"),
    # ── General-purpose fallbacks (no primary specialty) ───────────
    "WIDE-CUT FOR KOREAN MARKET":    (),
    "GENERAL CARBIDE":               (),
    "DREAM DRILLS-GENERAL":          (),
}


_BRAND_NORM_RE = re.compile(r"[\-·ㆍ./(),]+")


def _canonical_brand(brand: Optional[str]) -> str:
    """Normalize a user-provided brand string to the specialty table's
    key form: uppercase, collapse inner punctuation (hyphen/dot/etc) to
    space, collapse runs of whitespace. Matches the way the keys above
    were hand-written, so 'alu-power hpc' and 'ALU POWER HPC' both hit
    'ALU-POWER HPC'. Hyphens are preserved as-is because several real
    brand names ("ALU-POWER", "V7 MILL-INOX") use them canonically — we
    only collapse OTHER punctuation."""
    if not brand:
        return ""
    s = str(brand).strip().upper()
    if not s:
        return ""
    s = re.sub(r"\s+", " ", s)
    return s


# ── Sub-material resolution (workpiece_name/material_tag → subgroup) ─
# Covers the Korean/English/alias vocabulary the SCR emits in workpiece_name
# plus a few ISO-group-only fallbacks. When the caller only has a material_tag
# (P/M/K/N/S/H), we return None — there's no *specific* sub-material to
# discriminate against, so specialty scoring stays neutral.
_WORKPIECE_TO_SUBGROUP: dict[str, str] = {
    # ── N ───────────────────────────────────────────
    "구리": "copper", "copper": "copper", "cu": "copper",
    "황동": "brass", "brass": "brass",
    "청동": "bronze", "bronze": "bronze",
    "알루미늄": "aluminum", "알미늄": "aluminum", "aluminum": "aluminum",
    "aluminium": "aluminum", "두랄루민": "aluminum", "duralumin": "aluminum",
    "그라파이트": "graphite", "흑연": "graphite", "graphite": "graphite",
    "복합재": "composite", "cfrp": "composite", "composite": "composite",
    "gfrp": "composite", "탄소섬유": "composite",
    "마그네슘": "magnesium", "magnesium": "magnesium", "magnes": "magnesium",
    "수지": "plastic", "plastic": "plastic",
    # ── S ───────────────────────────────────────────
    "티타늄": "titanium", "titanium": "titanium", "ti6al4v": "titanium",
    "인코넬": "inconel", "inconel": "inconel", "in718": "inconel", "in625": "inconel",
    "하스텔로이": "hastelloy", "hastelloy": "hastelloy",
    "와스팔로이": "waspaloy", "waspaloy": "waspaloy",
    "모넬": "monel", "monel": "monel",
    "니모닉": "nimonic", "nimonic": "nimonic",
    # ── H ───────────────────────────────────────────
    "금형강": "mold_steel", "프리하든": "mold_steel",
    "nak80": "mold_steel", "nak55": "mold_steel",
    "hpm38": "mold_steel", "hpm50": "mold_steel",
    "공구강": "tool_steel", "skd11": "tool_steel", "skd61": "tool_steel",
    "d2": "tool_steel", "h13": "tool_steel",
    "sks": "tool_steel", "sks3": "tool_steel",
    "powder": "powder_steel", "분말강": "powder_steel",
    "pm": "powder_steel",
    "고경도강": "hardened_high", "담금질강": "hardened_high",
    # ── M ───────────────────────────────────────────
    "sus304": "austenitic", "sus316": "austenitic", "sus321": "austenitic",
    "sus": "austenitic", "austenitic": "austenitic", "오스테나이트": "austenitic",
    "sus410": "martensitic", "sus420": "martensitic", "sus440": "martensitic",
    "martensitic": "martensitic", "마르텐사이트": "martensitic",
    "sus430": "ferritic", "ferritic": "ferritic", "페라이트": "ferritic",
    "duplex": "duplex", "듀플렉스": "duplex", "2205": "duplex",
    "17-4ph": "precipitation", "precipitation": "precipitation",
    # ── P ───────────────────────────────────────────
    "s45c": "carbon_steel", "s50c": "carbon_steel", "s55c": "carbon_steel",
    "sm45c": "carbon_steel", "carbon_steel": "carbon_steel", "탄소강": "carbon_steel",
    "scm": "alloy_steel", "scm440": "alloy_steel", "scm4140": "alloy_steel",
    "4140": "alloy_steel", "4340": "alloy_steel", "alloy_steel": "alloy_steel",
    "합금강": "alloy_steel",
    "sts304": "alloy_steel",
    "ss400": "structural", "sm490": "structural", "structural": "structural", "구조용강": "structural",
    "베어링강": "bearing_steel", "bearing_steel": "bearing_steel", "suj2": "bearing_steel",
    # ── K ───────────────────────────────────────────
    "회주철": "grey_iron", "gc": "grey_iron", "gg": "grey_iron", "grey_iron": "grey_iron",
    "fc": "grey_iron", "fc200": "grey_iron", "fc250": "grey_iron",
    "구상흑연주철": "ductile_iron", "fcd": "ductile_iron", "fcd450": "ductile_iron",
    "gggg": "ductile_iron", "ductile": "ductile_iron", "ductile_iron": "ductile_iron",
    "백주철": "white_iron", "white_iron": "white_iron",
    "가단주철": "malleable", "malleable": "malleable",
}


def resolve_subgroup(
    workpiece_name: Optional[str] = None,
    material_tag: Optional[str] = None,
) -> Optional[str]:
    """Return the sub-material label our specialty table uses, or None when
    we can't narrow below the ISO group (material_tag alone isn't enough —
    P covers both carbon_steel and tool_steel_p, etc.)."""
    if workpiece_name:
        key = str(workpiece_name).strip().lower()
        if key in _WORKPIECE_TO_SUBGROUP:
            return _WORKPIECE_TO_SUBGROUP[key]
        for alias, sub in _WORKPIECE_TO_SUBGROUP.items():
            if alias in key:
                return sub
    # material_tag alone is too coarse — no specialty resolution.
    _ = material_tag
    return None


# ── Name-substring fallback for brands NOT in the specialty table ────
# Keyed by subgroup, each entry lists terms that usually appear in the
# brand / series / product-name strings of tools targeting that subgroup.
# Matched as case-insensitive substrings.
_NAME_HITS: dict[str, tuple[str, ...]] = {
    "copper":    ("copper", "구리"),
    "brass":     ("brass", "황동"),
    "bronze":    ("bronze", "청동"),
    "aluminum":  ("alu", "aluminum", "알루"),
    "graphite":  ("graphite", "그라파이트", "흑연"),
    "composite": ("composite", "cfrp", "복합", "carbon"),
    "plastic":   ("plastic", "수지"),
    "magnesium": ("magnesium", "magnes", "마그"),
    "titanium":  ("titanox", "titan", "ti-", "ti "),
    "inconel":   ("inconel", "hrsa", "super"),
    "hardened_high": ("hard", "cbn", "x5070", "x-power"),
    "austenitic":    ("inox", "sus-cut", "stainless"),
}

# Brands whose name pattern (ALU-*, ALUPOWER, …) identifies them as aluminum-
# specialized. Used to actively penalize when the request is NOT aluminum so
# ALU-CUT doesn't rank above CRX S for copper.
_ALU_NAME_PATS: tuple[str, ...] = ("alu-", "alu ", " alu", "alupower", "alucut")


def specialty_boost(
    brand: Optional[str],
    *,
    workpiece_name: Optional[str] = None,
    material_tag: Optional[str] = None,
    series: Optional[str] = None,
    product_name: Optional[str] = None,
) -> tuple[float, str]:
    """Return the additive ranking boost for (brand, subgroup) plus a short
    reason tag so the caller can log / expose it in the score breakdown.

    The boost is layered:
      (a) Exact BRAND_SUBGROUP_SPECIALTY hit — primary / secondary / wrong.
      (b) Name-substring hit on brand · series · product_name for brands
          the table doesn't cover.
      (c) Cross-subgroup ALU-name penalty for brands that look aluminum-
          specialized when the user asked for something else.

    Layers stack: a brand can simultaneously lose "wrong specialty" from
    (a) and gain "name_hit" from (b) if its name matches a term — this is
    intentional, the two signals measure different things and the final
    sum is what ranks.
    """
    sub = resolve_subgroup(workpiece_name, material_tag)
    if not sub:
        return 0.0, "no-subgroup"

    total = 0.0
    reasons: list[str] = []

    brand_key = _canonical_brand(brand)
    specialty = BRAND_SUBGROUP_SPECIALTY.get(brand_key) if brand_key else None

    # Layer (a): exact table lookup.
    if specialty is not None:
        if specialty and specialty[0] == sub:
            total += SPECIALTY_WEIGHTS["primary"]
            reasons.append(f"primary:{sub}")
        elif sub in specialty:
            total += SPECIALTY_WEIGHTS["secondary"]
            reasons.append(f"secondary:{sub}")
        elif specialty:
            # brand IS specialized, just in a different subgroup → penalize
            total += SPECIALTY_WEIGHTS["wrong"]
            reasons.append(f"wrong:{specialty[0]}vs{sub}")
        # empty tuple (general-purpose fallback) → no layer-a contribution

    # Layer (b): name-substring fallback (only credit when layer-a didn't
    # already award primary/secondary — avoids double-counting).
    if not reasons or not reasons[0].startswith(("primary", "secondary")):
        hits = _NAME_HITS.get(sub, ())
        if hits:
            haystack = " ".join(s for s in (
                (brand or "").lower(),
                (series or "").lower(),
                (product_name or "").lower(),
            ) if s)
            if any(t in haystack for t in hits):
                total += SPECIALTY_WEIGHTS["name_hit"]
                reasons.append(f"name_hit:{sub}")

    # Layer (c): ALU-name penalty when request is NOT aluminum.
    if sub != "aluminum" and brand:
        brand_l = str(brand).lower()
        if any(p in brand_l for p in _ALU_NAME_PATS):
            total += SPECIALTY_WEIGHTS["alu_name_penalty"]
            reasons.append("alu_name_penalty")

    return total, ("|".join(reasons) if reasons else "neutral")
