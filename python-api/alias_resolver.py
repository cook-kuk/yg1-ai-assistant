"""Embedding-based alias resolver for DB-canonical vocabularies.

Keeps a small in-memory cache of `{field: [(canonical, embedding), …]}`
and exposes `resolve(field, raw, threshold)` which embeds the user-provided
text once and returns the closest canonical above the cosine threshold.
`init_resolver()` populates the cache from the product MV at server start
so the hot path only pays one embedding per query.
"""
from __future__ import annotations

import math
import os
from typing import Optional


_CACHE: dict[str, list[tuple[str, list[float]]]] = {}

# Exact lookup dict populated from public.material_aliases. Keys are the
# lower-cased, whitespace-stripped alias; values are the 1-letter ISO group
# (P/M/K/N/S/H/O). Precomputed once at init_resolver() time — the DB table
# is ~2.6k rows, tiny enough to keep in memory and consulted before the
# more expensive embedding path.
_DB_MATERIAL_MAP: dict[str, str] = {}

# Embed model id — SSOT in config. Kept as a module const so the two
# callsites below (resolve + init) don't both import it each call.
from config import OPENAI_EMBED_MODEL as _EMBED_MODEL  # noqa: E402


def _cosine(a: list[float], b: list[float]) -> float:
    dot = sum(x * y for x, y in zip(a, b))
    na = math.sqrt(sum(x * x for x in a))
    nb = math.sqrt(sum(x * x for x in b))
    return dot / (na * nb) if na and nb else 0.0


def _embed(texts: list[str]) -> list[list[float]]:
    """Batched embedding call. Raises on network/auth failure so the caller
    can degrade gracefully."""
    from openai import OpenAI

    client = OpenAI(api_key=os.environ.get("OPENAI_API_KEY"))
    resp = client.embeddings.create(input=texts, model=_EMBED_MODEL)
    return [d.embedding for d in resp.data]


def _build_cache(field: str, canonical_values: list[str]) -> None:
    """Embed the canonical set for `field` once. No-op if already cached or
    if the canonical list is empty. Swallows failures so a missing OpenAI
    key at startup doesn't crash the whole server."""
    if field in _CACHE:
        return
    if not canonical_values:
        _CACHE[field] = []
        return
    try:
        vecs = _embed(canonical_values)
        _CACHE[field] = list(zip(canonical_values, vecs))
    except Exception:
        _CACHE[field] = []


def resolve(field: str, raw: str, threshold: float = 0.75) -> Optional[str]:
    """Map `raw` to the canonical value for `field` whose embedding is most
    similar. Returns None when the field isn't cached, when the similarity
    stays below `threshold`, or when the embedding call fails."""
    if not raw:
        return None
    cache = _CACHE.get(field)
    if not cache:
        return None
    try:
        q_vec = _embed([raw])[0]
    except Exception:
        return None
    best_val: Optional[str] = None
    best_sim = 0.0
    for canonical, vec in cache:
        sim = _cosine(q_vec, vec)
        if sim > best_sim:
            best_sim = sim
            best_val = canonical
    return best_val if best_sim >= threshold else None


def _norm_alias(s: str) -> str:
    """Canonical form for material_aliases lookup. Lower-case, collapse
    internal whitespace. Deliberately not stripping punctuation since
    grade codes like "St 37-2" or "16MnCr5" carry meaning in those
    characters."""
    return " ".join(str(s).split()).lower()


def _load_db_material_aliases() -> dict[str, str]:
    """Load public.material_aliases into a flat dict keyed by normalized
    alias. Returns {} on any error so the CSV/slang fallbacks in scr.py
    stay authoritative when the DB is unreachable."""
    from db import fetch_all

    try:
        rows = fetch_all(
            "SELECT alias, iso_group FROM public.material_aliases "
            "WHERE alias IS NOT NULL AND iso_group IS NOT NULL"
        )
    except Exception:
        return {}
    out: dict[str, str] = {}
    for r in rows:
        key = _norm_alias(r.get("alias") or "")
        iso = (r.get("iso_group") or "").strip().upper()
        # Guard against stray rows — only the 7 valid ISO groups make it in.
        if not key or iso not in {"P", "M", "K", "N", "S", "H", "O"}:
            continue
        # First writer wins — alias table has occasional duplicates across
        # language variants, and a single alias shouldn't oscillate between
        # ISO groups on reload.
        out.setdefault(key, iso)
    return out


def resolve_material_iso(raw: str | None) -> str | None:
    """Map a raw workpiece token (e.g. "SUS304", "St 37-2") to its ISO
    group via the DB-backed material_aliases table. Returns None when the
    alias isn't known or the cache hasn't been initialized yet; callers
    fall back to the CSV/slang path when this is None."""
    if not raw:
        return None
    return _DB_MATERIAL_MAP.get(_norm_alias(raw))


def find_material_iso_in_text(message: str) -> str | None:
    """Scan `message` for any known material alias from the DB and return
    its ISO group on first hit. Longest aliases win so "st 37-2" beats a
    bare "st 37". Case-insensitive; relies on _norm_alias for the match."""
    if not message or not _DB_MATERIAL_MAP:
        return None
    haystack = _norm_alias(message)
    # Cache the sorted-by-length key list once per process — 2.6k rows means
    # the sort is cheap but still worth avoiding on every call.
    global _DB_MATERIAL_KEYS_SORTED
    keys = globals().get("_DB_MATERIAL_KEYS_SORTED")
    if keys is None:
        keys = sorted(_DB_MATERIAL_MAP.keys(), key=len, reverse=True)
        globals()["_DB_MATERIAL_KEYS_SORTED"] = keys
    for key in keys:
        # Skip ultra-short aliases (≤2 chars) — they false-positive against
        # incidental text like "M" / "P" appearing inside unrelated words.
        if len(key) < 3:
            continue
        if key in haystack:
            return _DB_MATERIAL_MAP[key]
    return None


def init_resolver() -> None:
    """Populate the cache from the product MV. Safe to call multiple times;
    _build_cache skips fields already present."""
    from db import fetch_all

    global _DB_MATERIAL_MAP
    if not _DB_MATERIAL_MAP:
        _DB_MATERIAL_MAP = _load_db_material_aliases()
        globals().pop("_DB_MATERIAL_KEYS_SORTED", None)

    brands = [
        r["brand"]
        for r in fetch_all(
            "SELECT DISTINCT edp_brand_name AS brand "
            "FROM catalog_app.product_recommendation_mv "
            "WHERE edp_brand_name IS NOT NULL"
        )
    ]
    _build_cache("brand", brands)

    subtypes = [
        r["subtype"]
        for r in fetch_all(
            "SELECT DISTINCT search_subtype AS subtype "
            "FROM catalog_app.product_recommendation_mv "
            "WHERE search_subtype IS NOT NULL"
        )
    ]
    _build_cache("subtype", subtypes)

    coatings = [
        r["coating"]
        for r in fetch_all(
            "SELECT DISTINCT milling_coating AS coating "
            "FROM catalog_app.product_recommendation_mv "
            "WHERE milling_coating IS NOT NULL"
        )
    ]
    _build_cache("coating", coatings)
