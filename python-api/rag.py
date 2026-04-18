"""Domain-knowledge retrieval — lightweight JSON RAG for the chat path.

Two-stage lookup:
  Phase 1 (default)  — string substring match on symptom/alias/material
                      /operation/coating/series-brand fields. Fast,
                      deterministic, no embedding model needed.
  Phase 2 (fallback) — OpenAI text-embedding-3-small cosine similarity
                      over the full knowledge corpus. Only runs when Phase
                      1 returns no hits, so the embedding API is touched
                      on cold starts and edge queries only.
"""
from __future__ import annotations

import json
import math
import os
import re
from pathlib import Path
from typing import Any

# Symptoms/aliases in the knowledge base often bundle multiple terms in one
# string ("떨림/진동", "칩 엉킴, 감김"). Split on these separators so each
# atomic term can substring-match against the query individually.
_TERM_SPLIT = re.compile(r"[/,·・|]+|\s{2,}")

_BASE_DIR = Path(__file__).resolve().parent / "data"

# (subdir, filename, logical type label) — kept in load order so the type tag
# in the result list is stable across runs.
_SOURCES: list[tuple[str, str, str]] = [
    ("domain-knowledge", "troubleshooting.json", "troubleshooting"),
    ("domain-knowledge", "material-coating-guide.json", "material-coating-guide"),
    ("domain-knowledge", "operation-guide.json", "operation-guide"),
    ("domain-knowledge", "coating-properties.json", "coating-properties"),
    # Pre-generated product/feature QA — series-keyed lookup. Step 1 of the
    # RAG plan: string join, no embedding. Step 2 (pgvector) comes later.
    ("knowledge/qa", "product_knowledge_qa.json", "product_qa"),
    ("knowledge/qa", "feature_to_product_qa.json", "feature_qa"),
]

# Lazy cache — populated on first search_knowledge() call.
_KNOWLEDGE: dict[str, list[dict]] | None = None


def _load_knowledge() -> dict[str, list[dict]]:
    global _KNOWLEDGE
    if _KNOWLEDGE is not None:
        return _KNOWLEDGE
    out: dict[str, list[dict]] = {}
    for subdir, fname, tag in _SOURCES:
        path = _BASE_DIR / subdir / fname
        try:
            with path.open(encoding="utf-8") as f:
                data = json.load(f)
        except FileNotFoundError:
            out[tag] = []
            continue
        if isinstance(data, list):
            out[tag] = data
        elif isinstance(data, dict):
            # Some files wrap the list under a key; take the first list-valued
            # field rather than hardcoding each schema.
            lst = next((v for v in data.values() if isinstance(v, list)), [])
            out[tag] = lst
        else:
            out[tag] = []
    _KNOWLEDGE = out
    return _KNOWLEDGE


def reset_cache() -> None:
    """Drop the in-process knowledge cache; next call reloads from disk."""
    global _KNOWLEDGE
    _KNOWLEDGE = None


def _contains_any(query: str, candidates: list[Any]) -> tuple[bool, int]:
    """Return (hit, score). score rewards longer alias matches so a specific
    hit like '칩 엉킴' beats a generic one like '칩'.

    Each candidate is split on '/', ',' etc. before matching so bundled
    strings like '떨림/진동' still hit on '떨림'."""
    if not candidates:
        return False, 0
    best = 0
    q = query.lower()
    for c in candidates:
        if not c:
            continue
        raw = str(c).strip().lower()
        if not raw:
            continue
        parts = [p.strip() for p in _TERM_SPLIT.split(raw) if p.strip()]
        if not parts:
            parts = [raw]
        for part in parts:
            if len(part) < 2:
                continue
            if part in q:
                best = max(best, len(part))
    return best > 0, best


def _score_troubleshooting(query: str, item: dict) -> int:
    sym = item.get("symptom") or ""
    aliases = item.get("aliases") or []
    _, score_sym = _contains_any(query, [sym])
    _, score_al = _contains_any(query, aliases)
    return max(score_sym, score_al)


def _score_material(query: str, item: dict) -> int:
    mat = item.get("material") or ""
    iso = item.get("iso_group") or ""
    _, s = _contains_any(query, [mat])
    # ISO single-letter groups collide with random letters in prose — require
    # that the token appears as an explicit "M/P/K" chunk separated by spaces
    # or punctuation before we credit it. Substring-as-is is enough for the
    # material name itself.
    q = query.lower()
    iso_s = 0
    if iso:
        iso_lc = iso.lower()
        for sep_pat in (f" {iso_lc} ", f" {iso_lc}", f"{iso_lc} "):
            if sep_pat in f" {q} ":
                iso_s = len(iso_lc) + 2  # boost so exact ISO hits outrank generic "수스"
                break
    return max(s, iso_s)


def _score_operation(query: str, item: dict) -> int:
    op = item.get("operation") or ""
    aliases = item.get("aliases") or []
    _, s_op = _contains_any(query, [op])
    _, s_al = _contains_any(query, aliases)
    return max(s_op, s_al)


def _score_coating(query: str, item: dict) -> int:
    name = item.get("coating_name") or ""
    _, s = _contains_any(query, [name])
    return s


# QA matching — series/brand/feature keys must be reasonably specific to
# avoid false hits (e.g. a 1-char brand matching every query). Product QA
# covers 2k+ series so we also disambiguate multi-category hits on the same
# series using a small intent-keyword boost (e.g. "특징" → category=feature).
_QA_MIN_KEY_LEN = 3

# category tag → substrings in the query that hint at that category.
_CATEGORY_HINTS: dict[str, tuple[str, ...]] = {
    "feature": ("특징", "특성", "장점"),
    "product_overview": ("뭐야", "뭔가요", "뭔가", "뭐냐", "어떤 시리즈", "소개"),
    "brand_overview": ("뭐야", "뭔가요", "소개", "어떤 회사", "어떤 브랜드"),
    "application": ("어디에", "어디 써", "어디에 써", "용도", "어디서"),
    "material_target": ("어떤 소재", "어느 소재", "재질", "소재"),
    "tool_shape": ("사양", "스펙", "규격", "사이즈"),
    "selection": ("추천", "골라", "선택"),
    "coating_material": ("코팅", "표면처리"),
    "brand_application": ("용도", "어디"),
    "brand_lineup": ("라인업", "어떤 제품", "뭐 있", "종류"),
}


def _category_boost(query: str, category: str | None) -> int:
    if not category:
        return 0
    hints = _CATEGORY_HINTS.get(category, ())
    q = query.lower()
    for h in hints:
        if h.lower() in q:
            return 5
    return 0


def _token_match(query: str, token: str | None) -> int:
    """Case-insensitive substring match for QA keys (series/brand/feature).
    Guards against short tokens that collide with prose."""
    if not token:
        return 0
    t = str(token).strip()
    if len(t) < _QA_MIN_KEY_LEN:
        return 0
    return len(t) if t.lower() in query.lower() else 0


def _score_product_qa(query: str, item: dict) -> int:
    series_s = _token_match(query, item.get("series"))
    brand_s = _token_match(query, item.get("brand"))
    if series_s == 0 and brand_s == 0:
        return 0
    # Series match is stronger than brand alone — 'E5D72' is more specific
    # than 'ALU-CUT' (which covers 10+ series). Weight accordingly.
    base = series_s * 3 + brand_s * 2
    return base + _category_boost(query, item.get("category"))


def _score_feature_qa(query: str, item: dict) -> int:
    fv = _token_match(query, item.get("feature_value"))
    if fv == 0:
        # Fall back to first-phrase match on the canned question so
        # paraphrased asks still hit (e.g. "알루미늄용 제품 뭐 있어?"
        # matches "알루미늄 가공에 적합한 제품은?" via substring 알루미늄).
        q_text = item.get("question") or ""
        # Extract the question's subject noun-ish prefix (before 가공/용/에).
        head = re.split(r"[ \u00A0]가공|용|에 ", q_text, maxsplit=1)[0].strip()
        return _token_match(query, head)
    return fv * 2


_SCORERS = {
    "troubleshooting": _score_troubleshooting,
    "material-coating-guide": _score_material,
    "operation-guide": _score_operation,
    "coating-properties": _score_coating,
    "product_qa": _score_product_qa,
    "feature_qa": _score_feature_qa,
}


def _keyword_search(query: str, top_k: int = 3) -> list[dict]:
    """Phase-1 substring match across the registered knowledge types."""
    if not query:
        return []
    knowledge = _load_knowledge()
    ranked: list[tuple[int, str, dict]] = []
    for tag, items in knowledge.items():
        scorer = _SCORERS.get(tag)
        if not scorer:
            continue
        for item in items:
            if not isinstance(item, dict):
                continue
            s = scorer(query, item)
            if s > 0:
                ranked.append((s, tag, item))
    ranked.sort(key=lambda x: x[0], reverse=True)
    return [{"type": tag, "data": item} for _, tag, item in ranked[:top_k]]


# ── Phase 2: embedding-based semantic fallback ──────────────────────────

EMBED_MODEL = os.environ.get("RAG_EMBED_MODEL", "text-embedding-3-small")
# Below this cosine similarity an embedding "hit" is more likely noise than
# a real match — cap it so we don't surface irrelevant docs.
_MIN_SEMANTIC_SIM = 0.30

_EMBEDDINGS: list[tuple[str, list[float], dict]] | None = None


def _entry_to_text(entry: dict, source: str) -> str:
    """Flatten a knowledge entry into a single search-friendly string.
    Fields picked are the ones the Phase-1 scorers already use, so both
    stages are looking at the same semantic surface."""
    parts: list[str] = []
    for key in ("symptom", "material", "operation", "coating_name",
                "feature_value", "series", "brand", "question"):
        v = entry.get(key)
        if v:
            parts.append(str(v))
    for key in ("aliases", "causes", "machining_tips", "common_problems",
                "recommended_materials", "avoid_materials"):
        v = entry.get(key)
        if isinstance(v, list):
            for item in v:
                if isinstance(item, str):
                    parts.append(item)
                elif isinstance(item, dict):
                    parts.append(str(item.get("action") or item.get("detail") or ""))
    sol = entry.get("solutions")
    if isinstance(sol, list):
        for s in sol:
            if isinstance(s, dict):
                parts.append(str(s.get("action") or ""))
                parts.append(str(s.get("detail") or ""))
    ans = entry.get("answer")
    if isinstance(ans, str) and len(ans) < 400:
        parts.append(ans)
    return " ".join(p for p in parts if p).strip()


def _cosine_sim(a: list[float], b: list[float]) -> float:
    """Plain Python cosine — 1536-dim × ~100 items is ≪1ms, no numpy needed."""
    dot = 0.0
    na = 0.0
    nb = 0.0
    for x, y in zip(a, b):
        dot += x * y
        na += x * x
        nb += y * y
    if na == 0.0 or nb == 0.0:
        return 0.0
    return dot / (math.sqrt(na) * math.sqrt(nb))


def _build_embeddings() -> list[tuple[str, list[float], dict]]:
    """Build the semantic index on first use. One batched embeddings call
    covers all entries — ~100–150 total across our four knowledge files,
    so this fits comfortably in a single request."""
    global _EMBEDDINGS
    if _EMBEDDINGS is not None:
        return _EMBEDDINGS

    knowledge = _load_knowledge()
    rows: list[tuple[str, dict, str]] = []  # (text, entry, source)
    for source, entries in knowledge.items():
        if not isinstance(entries, list):
            continue
        for entry in entries:
            if not isinstance(entry, dict):
                continue
            text = _entry_to_text(entry, source)
            if len(text) < 10:
                continue
            rows.append((text, entry, source))

    if not rows:
        _EMBEDDINGS = []
        return _EMBEDDINGS

    try:
        from openai import OpenAI  # local import keeps startup light
        client = OpenAI(api_key=os.environ.get("OPENAI_API_KEY"))
        resp = client.embeddings.create(
            input=[r[0] for r in rows],
            model=EMBED_MODEL,
        )
        vectors = [d.embedding for d in resp.data]
    except Exception:
        # Embedding provider unavailable — mark cache empty so we retry
        # next time and Phase 1 stays the effective surface meanwhile.
        _EMBEDDINGS = []
        return _EMBEDDINGS

    _EMBEDDINGS = [
        (rows[i][0], vectors[i], {"source": rows[i][2], "data": rows[i][1]})
        for i in range(len(rows))
    ]
    return _EMBEDDINGS


def search_knowledge_semantic(query: str, top_k: int = 3) -> list[dict]:
    """Embedding-space cosine similarity. Returns [{type,data,similarity}]
    sorted desc, filtered by `_MIN_SEMANTIC_SIM`."""
    if not query:
        return []
    corpus = _build_embeddings()
    if not corpus:
        return []
    try:
        from openai import OpenAI
        client = OpenAI(api_key=os.environ.get("OPENAI_API_KEY"))
        q_resp = client.embeddings.create(input=[query], model=EMBED_MODEL)
        q_vec = q_resp.data[0].embedding
    except Exception:
        return []

    scored: list[tuple[float, dict]] = []
    for _text, vec, meta in corpus:
        sim = _cosine_sim(q_vec, vec)
        if sim >= _MIN_SEMANTIC_SIM:
            scored.append((sim, meta))
    scored.sort(key=lambda x: x[0], reverse=True)
    return [
        {"type": m["source"], "data": m["data"], "similarity": round(s, 3)}
        for s, m in scored[:top_k]
    ]


def search_knowledge(query: str, top_k: int = 3) -> list[dict]:
    """Phase 1 keyword → Phase 2 embedding fallback. Each entry is
    `{"type": <source>, "data": <full entry>}` with an optional
    `similarity` field when the result came from Phase 2."""
    hits = _keyword_search(query, top_k)
    if hits:
        return hits
    try:
        return search_knowledge_semantic(query, top_k)
    except Exception:
        return []
