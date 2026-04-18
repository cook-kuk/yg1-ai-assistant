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
    "3S MILL", "V7 PLUS", "X-POWER", "ALU-POWER", "ALU-POWER HPC",
    "TitaNox-Power", "I-POWER", "DREAM DRILLS", "DREAM DRILLS-INOX",
}
MICRO_BRANDS = {"GENERAL HSS", "GENERAL CARBIDE", "K-2 CARBIDE"}

FLAGSHIP_BONUS = 15.0
MICRO_PENALTY = -30.0

_FLAGSHIP_UPPER = {b.upper() for b in FLAGSHIP_BRANDS}
_MICRO_UPPER = {b.upper() for b in MICRO_BRANDS}


def _brand_boost(brand: Optional[str]) -> float:
    if not brand:
        return 0.0
    key = str(brand).strip().upper()
    if key in _FLAGSHIP_UPPER:
        return FLAGSHIP_BONUS
    if key in _MICRO_UPPER:
        return MICRO_PENALTY
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


def get_affinity_boost(brand: Optional[str], material_tag: Optional[str]) -> float:
    """Flat additive boost based on the affinity `rating` label. Returns
    SCORING_CONFIG["affinity_excellent"] / "_good" / "_fair" or 0."""
    if not brand or not material_tag:
        return 0.0
    cache = _load_affinity()
    key = (str(brand).strip().upper(), str(material_tag).strip().upper())
    entry = cache.get(key)
    if not entry:
        return 0.0
    rating = (entry[0] or "").upper()
    if "EXCELLENT" in rating:
        return float(SCORING_CONFIG["affinity_excellent"])
    if "GOOD" in rating:
        return float(SCORING_CONFIG["affinity_good"])
    if "FAIR" in rating:
        return float(SCORING_CONFIG["affinity_fair"])
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


def _material_score(intent: Optional[str], material_tags, brand: Optional[str]) -> Optional[float]:
    if not intent:
        return None
    tags = material_tags or []
    base = 1.0 if intent in tags else 0.0
    if not brand:
        return base
    boost = get_affinity(brand, intent) / 100.0
    boost = min(max(boost, 0.0), 1.0)
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
    subs: dict[str, Optional[float]] = {
        "diameter": _diameter_score(intent.diameter, _safe_float(candidate.get("diameter"))),
        "flutes": _flutes_score(intent.flute_count, candidate.get("flutes")),
        "material": _material_score(intent.material_tag, candidate.get("material_tags"), candidate.get("brand")),
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
    for c in candidates:
        base, breakdown = score_candidate(c, intent)
        boost = _brand_boost(c.get("brand"))
        affinity = get_affinity_boost(c.get("brand"), mat_tag)
        # breakdown keeps raw per-dimension contributions (debug-friendly),
        # including the flat affinity bonus.
        breakdown = {**breakdown, "affinity": round(affinity, 2)}
        raw = base + boost + affinity
        normalized = min(100.0, round(raw / MAX_POSSIBLE_SCORE * 100, 1))
        scored.append((c, normalized, breakdown))
    scored.sort(key=lambda x: x[1], reverse=True)
    return scored[:top_k]
