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

_EMBED_MODEL = "text-embedding-3-small"


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


def init_resolver() -> None:
    """Populate the cache from the product MV. Safe to call multiple times;
    _build_cache skips fields already present."""
    from db import fetch_all

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
