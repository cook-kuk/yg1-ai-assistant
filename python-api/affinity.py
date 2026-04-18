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

_BRAND_NORM_RE = re.compile(r"[\s\-·ㆍ./(),]+")
_ISO_CODE_RE = re.compile(r"^[PMKNSH]$")


def _normalize_brand(value: Optional[str]) -> str:
    if not value:
        return ""
    return _BRAND_NORM_RE.sub("", value.strip().upper())


def _normalize_key(value: Optional[str]) -> str:
    return str(value or "").strip().upper()


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
    global _cache, _loaded_at
    _cache = {}
    _loaded_at = 0.0


def set_cache(data: dict[str, dict[str, dict[str, float]]]) -> None:
    """Test hook: inject a pre-built cache (brand → kind → key → score)."""
    global _cache, _loaded_at
    _cache = data
    _loaded_at = time.time()


def get_affinity(brand: Optional[str], key: Optional[str]) -> float:
    """Return boost score 0..100 for (brand, key). `key` can be:
      - ISO single-letter code ("P","M","K","N","S","H") → iso_group lookup
      - workpiece name ("ALUMINUM", "SUS304", …)        → workpiece lookup

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

    # Workpiece name — exact match first, then substring fallback.
    wp = brand_bucket.get("workpiece", {})
    if nk in wp:
        return float(wp[nk])
    for k, v in wp.items():
        if nk in k or k in nk:
            return float(v)
    return 0.0
