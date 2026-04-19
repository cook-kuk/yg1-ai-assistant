"""Brand × material affinity — DB-backed boost for Stage 2 ranking.

Port of lib/data/repos/brand-material-affinity-repo.ts. Queries the
public.brand_material_affinity table:
  - material_kind = 'workpiece'  → material_key ∈ {ALUMINUM, TITANIUM, ...},  score 0..100
  - material_kind = 'iso_group'  → material_key ∈ {P,M,K,N,S,H},              score 0..1

get_affinity() always returns a score on the 0..100 scale (iso_group rows
are rescaled). Cached in-process for 1 hour.
"""

from __future__ import annotations

import re
import time
from typing import Optional

from db import fetch_all


_CACHE_TTL_SEC = 3600.0

# Cache shape:
#   { normalized_brand : { "workpiece": {KEY: score}, "iso_group": {CODE: score} } }
_cache: dict[str, dict[str, dict[str, float]]] = {}
_loaded_at: float = 0.0

# HRC coverage cache — sourced from brand_profile_mv.reference_profiles JSON.
# Shape: { normalized_brand: [(hrc_min, hrc_max, work_piece_name, tag_name), …] }
# Used by scoring._hrc_match_boost to credit brands whose catalog target
# hardness range covers the user-supplied hardness_hrc.
_hrc_cache: dict[str, list[tuple[float, float, str, str]]] = {}
_hrc_loaded_at: float = 0.0

_BRAND_NORM_RE = re.compile(r"[\s\-·ㆍ./(),]+")
_ISO_CODE_RE = re.compile(r"^[PMKNSH]$")


def _normalize_brand(value: Optional[str]) -> str:
    if not value:
        return ""
    return _BRAND_NORM_RE.sub("", value.strip().upper())


def _normalize_key(value: Optional[str]) -> str:
    return str(value or "").strip().upper()


# Korean/English aliases → canonical DB workpiece keys. Only the 3 keys that
# actually appear in public.brand_material_affinity (material_kind='workpiece')
# need to resolve; everything else falls through to the ISO group path.
_WORKPIECE_ALIAS: dict[str, str] = {
    # ─ Copper group ─────────────────────────────────────────────
    # Pure copper, alloys, and the related non-ferrous variants users
    # commonly call out by Korean/industry slang.
    "구리": "COPPER", "copper": "COPPER",
    "동": "COPPER",                       # 동(銅) — bare Sino-Korean form
    "적동": "COPPER",                     # 적동(red copper)
    "백동": "COPPER",                     # 백동(cupronickel)
    "무산소동": "COPPER", "ofc": "COPPER",  # OFC = oxygen-free copper
    "황동": "COPPER", "brass": "COPPER",
    "놋쇠": "COPPER",                     # 놋쇠 = brass (older form)
    "청동": "COPPER", "bronze": "COPPER",
    "인청동": "COPPER",                   # phosphor bronze
    "베릴륨동": "COPPER", "berylliumcopper": "COPPER", "becu": "COPPER",
    # ─ Aluminum group ───────────────────────────────────────────
    # Standard alloys + the magnesium / zinc / tin family that share
    # ALU-CUT/ALU-POWER's recommended cutting envelope (light non-ferrous).
    "알루미늄": "ALUMINUM", "알미늄": "ALUMINUM", "aluminum": "ALUMINUM",
    "aluminium": "ALUMINUM", "알": "ALUMINUM",
    "두랄루민": "ALUMINUM", "duralumin": "ALUMINUM",
    "마그네슘": "ALUMINUM", "magnesium": "ALUMINUM", "mg": "ALUMINUM",
    "아연": "ALUMINUM", "zinc": "ALUMINUM",
    "주석": "ALUMINUM", "tin": "ALUMINUM",
    "a2024": "ALUMINUM", "a5052": "ALUMINUM", "a6061": "ALUMINUM",
    "a7075": "ALUMINUM", "ad12": "ALUMINUM", "ac4ch": "ALUMINUM",
    # ─ Titanium / superalloy group ──────────────────────────────
    # Ti and the nickel/cobalt-based superalloys that map to TitaNox-Power's
    # recommendation envelope. The DB doesn't break these out separately;
    # all roll into TITANIUM affinity bucket.
    "티타늄": "TITANIUM", "titanium": "TITANIUM",
    "ti6al4v": "TITANIUM", "ti-6al-4v": "TITANIUM", "ti": "TITANIUM",
    "인코넬": "TITANIUM", "inconel": "TITANIUM",
    "in718": "TITANIUM", "in625": "TITANIUM",
    "하스텔로이": "TITANIUM", "hastelloy": "TITANIUM",
    "모넬": "TITANIUM", "monel": "TITANIUM",
    "스텔라이트": "TITANIUM", "stellite": "TITANIUM",
    "와스팔로이": "TITANIUM", "waspaloy": "TITANIUM",
    "니모닉": "TITANIUM", "nimonic": "TITANIUM",
    "니켈": "TITANIUM", "nickel": "TITANIUM",
    "니켈합금": "TITANIUM", "ni합금": "TITANIUM",
    "코발트": "TITANIUM", "cobalt": "TITANIUM", "co-cr": "TITANIUM",
    "내열합금": "TITANIUM", "초내열": "TITANIUM", "초내열합금": "TITANIUM",
    "superalloy": "TITANIUM",
}


def canonicalize_workpiece_key(raw: Optional[str]) -> Optional[str]:
    """Translate a user-facing workpiece name to the DB canonical key.
    Returns None when no mapping found — caller should fall back to ISO
    group or skip the workpiece lookup entirely."""
    if not raw:
        return None
    key = str(raw).strip().lower()
    if not key:
        return None
    if key in _WORKPIECE_ALIAS:
        return _WORKPIECE_ALIAS[key]
    # Substring: "알루미늄 A7075" → "알루미늄" → ALUMINUM
    for alias, canonical in _WORKPIECE_ALIAS.items():
        if alias in key:
            return canonical
    # Already looks like a canonical key? (uppercase English)
    upper = raw.strip().upper()
    if upper in ("ALUMINUM", "COPPER", "TITANIUM"):
        return upper
    return None


def _load_all() -> dict[str, dict[str, dict[str, float]]]:
    rows = fetch_all(
        """
        SELECT brand, material_kind, material_key, rating_score
        FROM public.brand_material_affinity
        WHERE brand IS NOT NULL AND BTRIM(brand) <> ''
        """
    )
    out: dict[str, dict[str, dict[str, float]]] = {}
    for r in rows:
        nb = _normalize_brand(r.get("brand"))
        if not nb:
            continue
        kind = r.get("material_kind") or "workpiece"
        key = _normalize_key(r.get("material_key"))
        if not key:
            continue
        try:
            score = float(r.get("rating_score") or 0.0)
        except (TypeError, ValueError):
            continue
        # rescale iso_group (0..1) → 0..100 to unify the scale
        if kind == "iso_group":
            score = score * 100.0
        brand_bucket = out.setdefault(nb, {"workpiece": {}, "iso_group": {}})
        bucket = brand_bucket.setdefault(kind if kind in ("workpiece", "iso_group") else "workpiece", {})
        # keep max if duplicate
        prev = bucket.get(key)
        if prev is None or score > prev:
            bucket[key] = score
    return out


def _ensure_loaded() -> dict[str, dict[str, dict[str, float]]]:
    global _loaded_at, _cache
    now = time.time()
    if not _cache or now - _loaded_at > _CACHE_TTL_SEC:
        try:
            _cache = _load_all()
        except Exception:
            _cache = {}
        _loaded_at = now
    return _cache


def refresh_cache() -> None:
    global _cache, _loaded_at, _hrc_cache, _hrc_loaded_at
    _cache = {}
    _loaded_at = 0.0
    _hrc_cache = {}
    _hrc_loaded_at = 0.0


def _load_hrc_ranges() -> dict[str, list[tuple[float, float, str, str]]]:
    """Flatten brand_profile_mv.reference_profiles into a per-brand list of
    HRC ranges. Each row's reference_profiles is a JSON array with items
    like {tag_name, series_name, work_piece_name, hardness_min_hrc,
    hardness_max_hrc}; we keep only the items that carry hardness data
    since the no-HRC rows don't add signal for scoring."""
    try:
        rows = fetch_all(
            """
            SELECT brand_name, reference_profiles
            FROM catalog_app.brand_profile_mv
            WHERE brand_name IS NOT NULL
              AND reference_profiles IS NOT NULL
            """
        )
    except Exception:
        return {}
    out: dict[str, list[tuple[float, float, str, str]]] = {}
    for r in rows:
        nb = _normalize_brand(r.get("brand_name"))
        if not nb:
            continue
        profiles = r.get("reference_profiles") or []
        if not isinstance(profiles, list):
            continue
        ranges: list[tuple[float, float, str, str]] = []
        for p in profiles:
            if not isinstance(p, dict):
                continue
            lo_raw = p.get("hardness_min_hrc")
            hi_raw = p.get("hardness_max_hrc")
            if lo_raw is None and hi_raw is None:
                continue
            try:
                lo = float(lo_raw) if lo_raw is not None else 0.0
                hi = float(hi_raw) if hi_raw is not None else 70.0
            except (TypeError, ValueError):
                continue
            if hi < lo:
                lo, hi = hi, lo
            ranges.append((
                lo, hi,
                str(p.get("work_piece_name") or ""),
                str(p.get("tag_name") or ""),
            ))
        if ranges:
            out[nb] = ranges
    return out


def _ensure_hrc_loaded() -> dict[str, list[tuple[float, float, str, str]]]:
    global _hrc_cache, _hrc_loaded_at
    now = time.time()
    if not _hrc_cache or now - _hrc_loaded_at > _CACHE_TTL_SEC:
        try:
            _hrc_cache = _load_hrc_ranges()
        except Exception:
            _hrc_cache = {}
        _hrc_loaded_at = now
    return _hrc_cache


def hrc_covers(brand: Optional[str], hardness_hrc: Optional[float]) -> bool:
    """True when any of `brand`'s catalog reference_profiles covers the
    given HRC value. Used by the scoring boost; returning bool (not score)
    so the tier magnitude stays in scoring.SCORING_CONFIG."""
    if not brand or hardness_hrc is None:
        return False
    nb = _normalize_brand(brand)
    if not nb:
        return False
    try:
        hv = float(hardness_hrc)
    except (TypeError, ValueError):
        return False
    ranges = _ensure_hrc_loaded().get(nb)
    if not ranges:
        return False
    for lo, hi, _wp, _tag in ranges:
        if lo <= hv <= hi:
            return True
    return False


def set_cache(data: dict[str, dict[str, dict[str, float]]]) -> None:
    """Test hook: inject a pre-built cache (brand → kind → key → score)."""
    global _cache, _loaded_at
    _cache = data
    _loaded_at = time.time()


def get_affinity(brand: Optional[str], key: Optional[str]) -> float:
    """Return boost score 0..100 for (brand, key). `key` can be:
      - ISO single-letter code ("P","M","K","N","S","H") → iso_group lookup
      - workpiece name ("ALUMINUM", "구리", "인코넬", …) → workpiece lookup
        Korean/slang aliases are canonicalized to the 3 DB keys.

    Returns 0.0 on any miss (unknown brand, unknown key, DB error)."""
    nb = _normalize_brand(brand)
    nk = _normalize_key(key)
    if not nb or not nk:
        return 0.0

    data = _ensure_loaded()
    brand_bucket = data.get(nb)
    if not brand_bucket:
        return 0.0

    # ISO code first if 1 letter — workpiece fallback if iso_group missing.
    if _ISO_CODE_RE.match(nk):
        iso = brand_bucket.get("iso_group", {})
        score = iso.get(nk)
        if score is not None:
            return float(score)
        return 0.0

    # Workpiece name — try canonicalized form first (구리 → COPPER), then the
    # raw normalized key as a fallback for already-canonical inputs.
    wp = brand_bucket.get("workpiece", {})
    canonical = canonicalize_workpiece_key(key)
    if canonical and canonical in wp:
        return float(wp[canonical])
    if nk in wp:
        return float(wp[nk])
    for k, v in wp.items():
        if nk in k or k in nk:
            return float(v)
    return 0.0


def get_affinity_rating(
    brand: Optional[str],
    workpiece_name: Optional[str] = None,
    material_tag: Optional[str] = None,
) -> Optional[str]:
    """Return the public tier label for (brand, workpiece|iso) affinity:
    "EXCELLENT" (≥80), "GOOD" (40..79), "FAIR" (10..39), None below.

    Mirrors _score_to_tier_bonus thresholds in scoring.py so the UI badge
    aligns with the scorer's tier-bonus bands. Prefers workpiece_name
    (higher resolution) with ISO fallback — same precedence as
    get_affinity_boost."""
    score = 0.0
    if brand and workpiece_name:
        score = get_affinity(brand, workpiece_name)
    if score <= 0 and brand and material_tag:
        score = get_affinity(brand, material_tag)
    if score >= 80.0:
        return "EXCELLENT"
    if score >= 40.0:
        return "GOOD"
    if score >= 10.0:
        return "FAIR"
    return None


def list_excellent_brands(
    workpiece_name: Optional[str] = None,
    material_tag: Optional[str] = None,
    threshold: float = 80.0,
) -> list[str]:
    """Return the normalized brand keys whose affinity score for the given
    (workpiece_name | material_tag) is ≥ threshold. Prefers workpiece
    (higher resolution) and falls back to ISO group when workpiece is unknown
    or yields no hits. Used by the fast-path brand auto-injection so that
    '구리 추천해줘' without explicit brand still surfaces CRX-S over a
    commodity brand.

    Returns the ORIGINAL-CASE brand form (e.g. 'ALU-CUT') by rescanning the
    DB rows — the normalized key inside the cache strips hyphens and spaces."""
    data = _ensure_loaded()
    if not data:
        return []
    # Resolve which kind/key to probe.
    candidates: list[tuple[str, str]] = []  # (kind, key)
    if workpiece_name:
        canon = canonicalize_workpiece_key(workpiece_name)
        if canon:
            candidates.append(("workpiece", canon))
    if material_tag:
        iso = _normalize_key(material_tag)
        if _ISO_CODE_RE.match(iso):
            candidates.append(("iso_group", iso))

    matched_norm: list[str] = []
    for kind, key in candidates:
        for nb, buckets in data.items():
            score = buckets.get(kind, {}).get(key)
            if score is not None and score >= threshold:
                if nb not in matched_norm:
                    matched_norm.append(nb)
        if matched_norm:
            break  # stop at first tier that yields hits (workpiece > iso)
    if not matched_norm:
        return []

    # Recover original-case brand strings from a one-shot DB query. Cache
    # intentionally drops the original form to keep memory small.
    try:
        rows = fetch_all(
            "SELECT DISTINCT BTRIM(brand) AS brand "
            "FROM public.brand_material_affinity "
            "WHERE brand IS NOT NULL AND BTRIM(brand) <> ''"
        )
    except Exception:
        return []
    result: list[str] = []
    for r in rows:
        raw = (r.get("brand") or "").strip()
        if not raw:
            continue
        if _normalize_brand(raw) in matched_norm and raw not in result:
            result.append(raw)
    return result
