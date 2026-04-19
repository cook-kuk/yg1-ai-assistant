"""Hybrid-retrieval Stage 2 weighted scoring.

Mirrors the ARIA Stage 2 ranker: each intent field contributes a 0..1 sub-score
that is multiplied by its weight, then summed. Missing intent fields are
skipped (weight is redistributed proportionally so partial intents still rank).
"""

from typing import Optional
from affinity import get_affinity
from db import fetch_all

# Central scoring config — sub-field weights + affinity tier bonuses. Kept as
# a single dict so downstream code can probe/override without hunting through
# the file.
SCORING_CONFIG: dict[str, float] = {
    "diameter": 40,
    "flutes": 15,
    "material": 20,
    "subtype": 15,      # alias of "shape" in WEIGHTS — same semantic
    "coating": 5,
    "affinity_excellent": 15,
    "affinity_good": 10,
    "affinity_fair": 5,
    "flagship_boost": 10,
    "micro_demote": -5,
    "material_pref": 5,
}

# Sum of every possible contribution — used to normalize final score into
# 0..100 for the response. The three affinity tiers are mutually exclusive
# in practice, so this is an over-estimate; the min(100, …) clamp keeps the
# output well-bounded.
MAX_POSSIBLE_SCORE: float = float(sum(SCORING_CONFIG.values()))

# Kept for backward compat with earlier tests (keys: diameter/flutes/material/shape/coating).
WEIGHTS = {
    "diameter": SCORING_CONFIG["diameter"],
    "flutes": SCORING_CONFIG["flutes"],
    "material": SCORING_CONFIG["material"],
    "shape": SCORING_CONFIG["subtype"],
    "coating": SCORING_CONFIG["coating"],
}

# Tier bonuses applied on the final ranked score. Flagship lines are the
# brands YG-1 routinely steers customers toward; micro lines are the general
# commodity series that rarely win at the top of a recommendation.
FLAGSHIP_BRANDS = {
    "V7 PLUS", "X-POWER", "TitaNox-Power", "ALU-POWER", "ALU-POWER HPC", "3S MILL",
}
MICRO_BRANDS: set[str] = set()

_FLAGSHIP_UPPER = {b.upper() for b in FLAGSHIP_BRANDS}
_MICRO_UPPER = {b.upper() for b in MICRO_BRANDS}


def _brand_boost(brand: Optional[str]) -> float:
    """Flat +flagship_boost / +micro_demote addend used at rank time.
    Pulls the magnitude from SCORING_CONFIG so ops can retune without
    touching code."""
    if not brand:
        return 0.0
    key = str(brand).strip().upper()
    if key in _FLAGSHIP_UPPER:
        return float(SCORING_CONFIG["flagship_boost"])
    if key in _MICRO_UPPER:
        return float(SCORING_CONFIG["micro_demote"])
    return 0.0


# ── material → preferred series (ISO LV1 → canonical brand name list) ───
# Hand-curated priority hints. When a candidate's brand appears in the list
# for the current ISO group we add SCORING_CONFIG["material_pref"] to the
# raw score. Missing keys = no preference expressed.
MATERIAL_SERIES_PREF: dict[str, list[str]] = {
    "N": ["ALU-POWER", "ALU-POWER HPC", "ALU-CUT", "CRX S"],
    "M": ["TitaNox-Power", "X-POWER", "V7 PLUS A"],
    "S": ["TitaNox-Power"],
    "H": ["X-POWER", "3S MILL"],
    "P": ["V7 PLUS", "X-POWER", "3S MILL"],
    "K": ["V7 PLUS", "3S MILL"],
}


def _material_pref_boost(brand: Optional[str], material_tag: Optional[str]) -> float:
    """+5 if the candidate's brand is a preferred series for the material
    group. Substring-insensitive prefix match so 'ALU-CUT for Korean Market'
    still hits the 'ALU-CUT' preference entry."""
    if not brand or not material_tag:
        return 0.0
    preferred = MATERIAL_SERIES_PREF.get(str(material_tag).strip().upper(), [])
    if not preferred:
        return 0.0
    b_up = str(brand).strip().upper()
    for p in preferred:
        p_up = p.upper()
        if b_up == p_up or b_up.startswith(p_up + " ") or b_up.startswith(p_up):
            return float(SCORING_CONFIG["material_pref"])
    return 0.0


# ── brand × ISO-group affinity (iso_group rows only) ───────────────────

_AFFINITY_CACHE: dict[tuple[str, str], tuple[str, float]] | None = None


def _load_affinity() -> dict[tuple[str, str], tuple[str, float]]:
    """Full load of public.brand_material_affinity (material_kind='iso_group')
    into an in-process dict keyed by (UPPER(brand), UPPER(iso_letter)).
    Value: (rating_label, rating_score). Cached after first call."""
    global _AFFINITY_CACHE
    if _AFFINITY_CACHE is not None:
        return _AFFINITY_CACHE
    try:
        rows = fetch_all(
            "SELECT UPPER(BTRIM(brand)) AS brand, "
            "UPPER(material_key) AS mat, rating, rating_score "
            "FROM public.brand_material_affinity "
            "WHERE material_kind = 'iso_group'"
        )
    except Exception:
        _AFFINITY_CACHE = {}
        return _AFFINITY_CACHE
    cache: dict[tuple[str, str], tuple[str, float]] = {}
    for r in rows:
        key = (r["brand"], r["mat"])
        try:
            score = float(r.get("rating_score") or 0)
        except (TypeError, ValueError):
            score = 0.0
        cache[key] = (r.get("rating") or "", score)
    _AFFINITY_CACHE = cache
    return _AFFINITY_CACHE


def _score_to_tier_bonus(score: float) -> float:
    """Map a unified 0..100 affinity score to the tier bonus. Thresholds mirror
    the TS side (brand-material-affinity-repo + series-material-status): ≥80
    is EXCELLENT, 40..79 GOOD, 10..39 FAIR, below is no boost."""
    if score >= 80.0:
        return float(SCORING_CONFIG["affinity_excellent"])
    if score >= 40.0:
        return float(SCORING_CONFIG["affinity_good"])
    if score >= 10.0:
        return float(SCORING_CONFIG["affinity_fair"])
    return 0.0


def get_affinity_boost(
    brand: Optional[str],
    workpiece_name: Optional[str] = None,
    material_tag: Optional[str] = None,
) -> float:
    """Additive boost based on brand × (workpiece_name | ISO) affinity.

    Uses affinity.get_affinity (the unified 0..100 cache from affinity.py):
    workpiece_name first — same brand can be EXCELLENT for 구리 but only
    GOOD for 알루미늄 within ISO group N. ISO fallback covers the case
    where the LLM only emitted the ISO group.

    Returns SCORING_CONFIG["affinity_excellent"] / "_good" / "_fair" / 0."""
    if not brand:
        return 0.0
    # Workpiece — higher resolution, preferred. Covers Korean/English/slang
    # via affinity.get_affinity's substring fallback.
    if workpiece_name:
        score = get_affinity(brand, workpiece_name)
        if score > 0:
            return _score_to_tier_bonus(score)
    # ISO group fallback — coarser but catches generic queries ("피삭재 N군").
    if material_tag:
        score = get_affinity(brand, material_tag)
        if score > 0:
            return _score_to_tier_bonus(score)
    return 0.0


def _safe_float(v) -> Optional[float]:
    if v is None:
        return None
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def _diameter_score(intent: Optional[float], actual: Optional[float]) -> Optional[float]:
    if intent is None:
        return None
    if actual is None or intent <= 0:
        return 0.0
    delta = abs(actual - intent) / intent
    if delta == 0:
        return 1.0
    if delta >= 0.2:
        return 0.0
    return max(0.0, 1.0 - delta / 0.2)


def _flutes_score(intent: Optional[int], actual_raw) -> Optional[float]:
    if intent is None:
        return None
    actual = _safe_float(actual_raw)
    if actual is None:
        return 0.0
    if int(actual) == intent:
        return 1.0
    return max(0.0, 1.0 - abs(actual - intent) / max(intent, 1))


def _material_score(
    intent: Optional[str],
    material_tags,
    brand: Optional[str],
    workpiece_name: Optional[str] = None,
) -> Optional[float]:
    if not intent:
        return None
    tags = material_tags or []
    base = 1.0 if intent in tags else 0.0
    if not brand:
        return base
    # Workpiece-keyed affinity first (0..100 scale, e.g. ALU-CUT × ALUMINUM=100).
    # ISO fallback for coarse queries. Score normalized to 0..1 for sub-score use.
    raw = 0.0
    if workpiece_name:
        raw = get_affinity(brand, workpiece_name)
    if raw <= 0:
        raw = get_affinity(brand, intent)
    boost = min(max(raw / 100.0, 0.0), 1.0)
    return 0.5 * base + 0.5 * boost


def _shape_score(intent: Optional[str], actual: Optional[str]) -> Optional[float]:
    if not intent:
        return None
    if not actual:
        return 0.0
    return 1.0 if intent.lower() in actual.lower() else 0.0


def _coating_score(intent: Optional[str], actual: Optional[str]) -> Optional[float]:
    if not intent:
        return None
    if not actual:
        return 0.0
    return 1.0 if intent.lower() in actual.lower() else 0.0


def score_candidate(candidate: dict, intent) -> tuple[float, dict[str, float]]:
    wp_name = getattr(intent, "workpiece_name", None)
    subs: dict[str, Optional[float]] = {
        "diameter": _diameter_score(intent.diameter, _safe_float(candidate.get("diameter"))),
        "flutes": _flutes_score(intent.flute_count, candidate.get("flutes")),
        "material": _material_score(
            intent.material_tag, candidate.get("material_tags"), candidate.get("brand"),
            workpiece_name=wp_name,
        ),
        "shape": _shape_score(intent.subtype, candidate.get("subtype")),
        "coating": _coating_score(intent.coating, candidate.get("coating")),
    }

    active_weight = sum(WEIGHTS[k] for k, v in subs.items() if v is not None)
    if active_weight == 0:
        return 0.0, {k: 0.0 for k in WEIGHTS}

    breakdown: dict[str, float] = {}
    total = 0.0
    norm = 100.0 / active_weight
    for k, v in subs.items():
        if v is None:
            breakdown[k] = 0.0
            continue
        contrib = v * WEIGHTS[k] * norm
        breakdown[k] = round(contrib, 2)
        total += contrib

    return round(total, 2), breakdown


def rank_candidates(candidates: list[dict], intent, top_k: int = 5) -> list[tuple[dict, float, dict[str, float]]]:
    scored: list[tuple[dict, float, dict[str, float]]] = []
    mat_tag = getattr(intent, "material_tag", None)
    wp_name = getattr(intent, "workpiece_name", None)
    for c in candidates:
        base, breakdown = score_candidate(c, intent)
        flagship = _brand_boost(c.get("brand"))
        # Pass both — affinity prefers workpiece_name (higher res) with ISO
        # fallback. Preserves prior behavior when workpiece_name is absent.
        affinity = get_affinity_boost(c.get("brand"), wp_name, mat_tag)
        material_pref = _material_pref_boost(c.get("brand"), mat_tag)
        breakdown = {
            **breakdown,
            "affinity": round(affinity, 2),
            "flagship": round(flagship, 2),
            "material_pref": round(material_pref, 2),
        }
        raw = base + flagship + affinity + material_pref
        normalized = min(100.0, round(raw / MAX_POSSIBLE_SCORE * 100, 1))
        scored.append((c, normalized, breakdown))
    scored.sort(key=lambda x: x[1], reverse=True)
    # Diversity shuffle: keeps #1 put, nudges later ranks away from repeats.
    scored = diversity_rerank(scored, top_k=min(10, len(scored)))
    return scored[:top_k]


def diversity_rerank(
    ranked: list[tuple[dict, float, dict[str, float]]],
    top_k: int = 10,
) -> list[tuple[dict, float, dict[str, float]]]:
    """Greedy brand-diversity rerank over the first `top_k` positions.
    The #1 slot is locked in — below it, already-seen brands take a 0.8×
    multiplicative penalty when choosing the next pick so we don't paint
    the first page with a single brand. Below the top_k window the
    original order is preserved.
    Scores in the returned tuples are untouched — only positions change."""
    if len(ranked) <= 1 or top_k <= 1:
        return ranked
    selected = [ranked[0]]
    remaining = list(ranked[1:])
    seen_brands: set[str] = set()
    first_brand = ranked[0][0].get("brand") or ""
    if first_brand:
        seen_brands.add(str(first_brand))
    while remaining and len(selected) < top_k:
        best_idx = 0
        best_adjusted = -1.0
        for i, (c, s, _b) in enumerate(remaining):
            brand = str(c.get("brand") or "")
            penalty = 0.8 if brand and brand in seen_brands else 1.0
            adjusted = s * penalty
            if adjusted > best_adjusted:
                best_adjusted = adjusted
                best_idx = i
        pick = remaining.pop(best_idx)
        selected.append(pick)
        pb = pick[0].get("brand")
        if pb:
            seen_brands.add(str(pb))
    selected.extend(remaining)
    return selected
