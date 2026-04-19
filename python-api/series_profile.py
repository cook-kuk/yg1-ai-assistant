"""series_profile_mv lookup — compact summary per tool series.

Answers "V7 PLUS 시리즈 헬릭스각은?" / "GMF52 직경 범위?" style questions
without dragging the per-EDP recommender. The MV already aggregates the
ranges, so this module is a thin cache + text-format layer on top of a
single-key fetch.
"""
from __future__ import annotations

import re
import time
from typing import Any, Optional

from config import CACHE_TTL_SEC as _CACHE_TTL_SEC
from db import fetch_all

# {normalized_series_name: profile_dict}. Normalized form is lower-cased
# with spaces/hyphens stripped so "V7 PLUS" / "v7plus" / "v7-plus" all
# resolve to the same entry.
_CACHE: dict[str, dict] = {}
_LOADED_AT: float = 0.0

_NAME_NORM_RE = re.compile(r"[\s\-·ㆍ./(),]+")


def _norm_name(s: Optional[str]) -> str:
    if not s:
        return ""
    return _NAME_NORM_RE.sub("", str(s).strip().lower())


def _decimal_to_float(v: Any) -> Optional[float]:
    if v is None:
        return None
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def _decimal_list(v: Any) -> list[float]:
    if not isinstance(v, list):
        return []
    out: list[float] = []
    for item in v:
        f = _decimal_to_float(item)
        if f is not None:
            out.append(f)
    return out


def _load_all() -> dict[str, dict]:
    """Pull the whole series_profile_mv into memory. ~1.5k series in the
    DB, one row each — single SELECT with a curated column list to avoid
    carrying the translation JSON/file_pic arrays that aren't used here."""
    rows = fetch_all(
        """
        SELECT
            series_name,
            primary_brand_name,
            primary_tool_type,
            primary_cutting_edge_shape,
            primary_shank_type,
            primary_application_shape,
            primary_description,
            primary_feature,
            primary_unit,
            diameter_min_mm,
            diameter_max_mm,
            shank_diameter_min_mm,
            shank_diameter_max_mm,
            length_of_cut_min_mm,
            length_of_cut_max_mm,
            overall_length_min_mm,
            overall_length_max_mm,
            helix_angle_values,
            ball_radius_values,
            taper_angle_values,
            coolant_hole_values,
            flute_counts,
            material_tags,
            material_work_piece_names,
            edp_count,
            series_name_variants
        FROM catalog_app.series_profile_mv
        WHERE series_name IS NOT NULL AND BTRIM(series_name) <> ''
        """
    )
    out: dict[str, dict] = {}
    for r in rows:
        name = (r.get("series_name") or "").strip()
        if not name:
            continue
        profile = {
            "series_name": name,
            "brand": r.get("primary_brand_name"),
            "tool_type": r.get("primary_tool_type"),
            "cutting_edge_shape": r.get("primary_cutting_edge_shape"),
            "shank_type": r.get("primary_shank_type"),
            "application_shape": r.get("primary_application_shape"),
            "description": r.get("primary_description"),
            "feature": r.get("primary_feature"),
            "unit": r.get("primary_unit"),
            "diameter_min": _decimal_to_float(r.get("diameter_min_mm")),
            "diameter_max": _decimal_to_float(r.get("diameter_max_mm")),
            "shank_diameter_min": _decimal_to_float(r.get("shank_diameter_min_mm")),
            "shank_diameter_max": _decimal_to_float(r.get("shank_diameter_max_mm")),
            "loc_min": _decimal_to_float(r.get("length_of_cut_min_mm")),
            "loc_max": _decimal_to_float(r.get("length_of_cut_max_mm")),
            "oal_min": _decimal_to_float(r.get("overall_length_min_mm")),
            "oal_max": _decimal_to_float(r.get("overall_length_max_mm")),
            "helix_angles": _decimal_list(r.get("helix_angle_values")),
            "ball_radii": _decimal_list(r.get("ball_radius_values")),
            "taper_angles": _decimal_list(r.get("taper_angle_values")),
            "flute_counts": _decimal_list(r.get("flute_counts")),
            "material_tags": r.get("material_tags") or [],
            "work_piece_names": r.get("material_work_piece_names") or [],
            "edp_count": r.get("edp_count"),
        }
        out[_norm_name(name)] = profile
        # Name variants (alternate spellings seeded into the MV) alias to
        # the same profile — "V7 PLUS" and "V7PLUS" hit the same entry.
        for v in (r.get("series_name_variants") or []):
            nv = _norm_name(v)
            if nv and nv not in out:
                out[nv] = profile
    return out


def _ensure_loaded() -> dict[str, dict]:
    global _CACHE, _LOADED_AT
    now = time.time()
    if not _CACHE or now - _LOADED_AT > _CACHE_TTL_SEC:
        try:
            _CACHE = _load_all()
        except Exception:
            _CACHE = {}
        _LOADED_AT = now
    return _CACHE


def refresh_cache() -> None:
    global _CACHE, _LOADED_AT
    _CACHE = {}
    _LOADED_AT = 0.0


def lookup(series_name: Optional[str]) -> Optional[dict]:
    """Exact-normalized name lookup. Returns the profile dict or None."""
    if not series_name:
        return None
    return _ensure_loaded().get(_norm_name(series_name))


def find_in_text(query: str) -> Optional[dict]:
    """Scan `query` for any known series name and return its profile on
    first hit. Longest series-name keys win so "V7 PLUS A" beats the bare
    "V7 PLUS" when both appear. Requires ≥3 chars to dodge 1-2 char noise
    like 'Z' / 'U' showing up in common prose."""
    if not query:
        return None
    data = _ensure_loaded()
    if not data:
        return None
    haystack = _norm_name(query)
    if not haystack:
        return None
    for key in sorted(data.keys(), key=len, reverse=True):
        if len(key) < 3:
            continue
        if key in haystack:
            return data[key]
    return None


def format_summary(profile: dict) -> str:
    """One-line human-readable summary of the range fields. Used as the
    [시리즈 프로파일] block payload so the chat LLM has a concrete string
    to quote instead of dict-dumping."""
    parts: list[str] = []
    if profile.get("brand"):
        parts.append(f"브랜드 {profile['brand']}")
    if profile.get("tool_type"):
        parts.append(str(profile["tool_type"]))
    if profile.get("cutting_edge_shape"):
        parts.append(str(profile["cutting_edge_shape"]))

    def _rng(lo_key: str, hi_key: str, label: str, unit: str = "") -> Optional[str]:
        lo = profile.get(lo_key)
        hi = profile.get(hi_key)
        if lo is None and hi is None:
            return None
        if lo == hi:
            return f"{label} {lo}{unit}"
        return f"{label} {lo}–{hi}{unit}"

    for r in (
        _rng("diameter_min", "diameter_max", "직경", "mm"),
        _rng("shank_diameter_min", "shank_diameter_max", "섕크", "mm"),
        _rng("loc_min", "loc_max", "LOC", "mm"),
        _rng("oal_min", "oal_max", "OAL", "mm"),
    ):
        if r:
            parts.append(r)

    if profile.get("helix_angles"):
        parts.append(f"헬릭스 {profile['helix_angles']}°")
    if profile.get("ball_radii"):
        parts.append(f"볼반경 {profile['ball_radii']}")
    if profile.get("flute_counts"):
        parts.append(f"날수 {profile['flute_counts']}")
    if profile.get("material_tags"):
        parts.append(f"재질 {profile['material_tags']}")
    if profile.get("edp_count"):
        parts.append(f"EDP {profile['edp_count']}종")
    return " · ".join(parts)
