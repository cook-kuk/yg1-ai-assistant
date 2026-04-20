"""Embedding-based alias resolver for DB-canonical vocabularies.

Keeps a small in-memory cache of `{field: [(canonical, embedding), …]}`
and exposes `resolve(field, raw, threshold)` which embeds the user-provided
text once and returns the closest canonical above the cosine threshold.
`init_resolver()` populates the cache from the product MV at server start
so the hot path only pays one embedding per query.

Also hosts the MaterialMapping cross-standard index — a 447-entry table
(JIS/DIN/AISI/UNS/GB/…/ISO group + HB/HRC/VDI) loaded from
data/materials/iso_mapping.csv at startup, paired with a data-driven
Korean slang dict (data/materials/slang_ko.csv). The `resolve_rich`
cascade surfaces exact/cross-standard/slang/fuzzy/embedding tiers so
upstream SCR can enrich intent.workpiece_name without a hardcoded list.
"""
from __future__ import annotations

import csv
import difflib
import math
import os
from dataclasses import dataclass, field
from pathlib import Path
from typing import Literal, Optional


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

    # Material cross-standard index + Korean slang — built once at startup
    # from CSV files. Separate from the _DB_MATERIAL_MAP above which only
    # carries ISO-group mappings; this index adds 13-standard canonicals,
    # hardness, and a reverse (canonical → all synonyms) view.
    _build_material_mapping_index()


# ══════════════════════════════════════════════════════════════════════
#  MaterialMapping — cross-standard index (resolve_rich / reverse_lookup /
#  find_nearest). Ported & extended from yg1-ai-cutting-tool-master VP
#  benchmark (backend/src/services/material_mapping.py). Extensions:
#    (a) bidirectional reverse_lookup (canonical → all synonyms incl. ko)
#    (b) embedding fallback for CSV-miss slang
#    (c) cross_refs returned inline in every match
#  See docs/followup/material_hardness_cutting_range.md for the pending
#  HRC→cutting_range integration.
# ══════════════════════════════════════════════════════════════════════

# 13 standard-name columns in the CSV that carry aliases. LV1_ISO is not
# an alias (it's the ISO group); LV2_Category / Material_Description /
# Composition / Brands are descriptive, not lookup keys. Material_No is
# the W.Nr — a real alias standard, keep it.
_STD_COLUMNS: tuple[str, ...] = (
    "Material_No", "JIS", "DIN", "AISI_ASTM_SAE", "BS", "EN", "AFNOR",
    "SS", "UNI", "UNE_IHA", "UNS", "GOST", "GB",
)

# Columns → cross_refs key name (short, lower-case). These are the keys
# surfaced on MaterialMatch.cross_refs so downstream can render "JIS: S45C,
# DIN: C45, AISI: 1045" chips without knowing the CSV's column spelling.
_STD_COL_TO_KEY: dict[str, str] = {
    "Material_No": "wnr",
    "JIS": "jis", "DIN": "din", "AISI_ASTM_SAE": "aisi",
    "BS": "bs", "EN": "en", "AFNOR": "afnor", "SS": "ss",
    "UNI": "uni", "UNE_IHA": "une", "UNS": "uns",
    "GOST": "gost", "GB": "gb",
}

_VALID_ISO_GROUPS: frozenset[str] = frozenset({"P", "M", "K", "N", "S", "H", "O"})

# Module-level indexes — built once in _build_material_mapping_index().
# The hot path is dict lookup; build-time cost is O(447 × 13) ≈ 6k inserts.
_canonical_to_refs: dict[str, dict[str, str]] = {}
_canonical_to_raw: dict[str, dict[str, str]] = {}  # canonical → full CSV row
_iso_to_canonical: dict[str, str] = {}             # normalize(std_name) → canonical
_iso_group_map: dict[str, str] = {}                # canonical → "P"/"M"/"K"/...
_hardness_map: dict[str, dict[str, object]] = {}   # canonical → {hb, hrc, vdi}
_slang_to_canonical: dict[str, str] = {}           # normalize_ko(slang) → canonical
_slang_confidence: dict[str, float] = {}           # normalize_ko(slang) → float
_canonical_to_slangs: dict[str, list[str]] = {}    # canonical → [slang, ...]
_canonical_embeddings: dict[str, list[float]] = {} # canonical → embedding vec
_material_index_loaded: bool = False


def _normalize_std(s: str) -> str:
    """Standard-code normalization: strip whitespace, hyphens, underscores,
    dots; lower-case. "St 37-2" / "st37-2" / "St_37_2" / "ST.37.2" collapse
    to the same key. Used for cross-standard lookup where the input often
    arrives with regional spacing/punctuation quirks."""
    if not s:
        return ""
    out = []
    for ch in str(s):
        if ch in (" ", "-", "_", ".", "\t"):
            continue
        out.append(ch.lower())
    return "".join(out)


def _normalize_ko(s: str) -> str:
    """Korean-text normalization: collapse internal whitespace but keep
    Hangul syllables intact. Slang is mixed Korean+digits ("낙팔공",
    "스뎅304", "티육사") so digits and ASCII are preserved in original
    case for the slang table (case-insensitive map done via .lower())."""
    if not s:
        return ""
    collapsed = "".join(str(s).split())
    return collapsed.lower()


def _to_int(s: str) -> int | None:
    v = (s or "").strip()
    if not v or v == "-":
        return None
    try:
        return int(float(v))
    except (ValueError, TypeError):
        return None


def _load_iso_mapping_csv(path: Path) -> int:
    """Populate _canonical_to_refs / _iso_to_canonical / _iso_group_map /
    _hardness_map from iso_mapping.csv. Returns the entry count.

    The file may start with one or more `#`-prefixed comment lines (source
    attribution); these are stripped before DictReader sees them.
    Idempotent — repeated calls rebuild in place so tests can reload with
    a different CSV_PATH."""
    if not path.exists():
        return 0

    _canonical_to_refs.clear()
    _canonical_to_raw.clear()
    _iso_to_canonical.clear()
    _iso_group_map.clear()
    _hardness_map.clear()

    # utf-8-sig strips the BOM at file-start; # lines are filtered
    # manually because csv.DictReader has no native comment syntax.
    # Extra defense: some editors preserve / re-insert a BOM after the
    # leading `#` comment block, which after the filter surfaces as an
    # inline `\ufeff` on the new line-1 (= the CSV header). Strip any
    # leading BOM on the first surviving line so DictReader sees clean
    # ASCII column names.
    with open(path, encoding="utf-8-sig") as f:
        data_lines = [ln for ln in f if not ln.lstrip().startswith("#")]
    if data_lines and data_lines[0].startswith("\ufeff"):
        data_lines[0] = data_lines[0].lstrip("\ufeff")
    reader = csv.DictReader(data_lines)

    seen_canonicals: set[str] = set()
    count = 0
    for raw_row in reader:
        row = {k: (v or "").strip() for k, v in raw_row.items()}
        iso = row.get("LV1_ISO", "").upper()
        if iso not in _VALID_ISO_GROUPS:
            continue

        # Canonical name preference: JIS → AISI → DIN → EN → Material_No.
        # Diverges from VP (which prefers DIN) — Korean market operators type
        # "S45C" / "SUS304" / "SKD11" (JIS) far more often than "C45" /
        # "X5CrNi18-9" / "X155CrVMo121" (DIN). Keeping the Korean/Japanese
        # canonical means resolve_rich("S45C") returns status="exact"
        # instead of "cross_standard" via a DIN redirect, which the UI then
        # displays as "S45C" — the name the machinist actually used.
        canonical = ""
        for col in ("JIS", "AISI_ASTM_SAE", "DIN", "EN", "Material_No"):
            v = row.get(col, "")
            if v and v != "-":
                canonical = v
                break
        if not canonical:
            continue

        if canonical not in seen_canonicals:
            seen_canonicals.add(canonical)
            _canonical_to_raw[canonical] = row
            _iso_group_map[canonical] = iso
            _hardness_map[canonical] = {
                "hb": _to_int(row.get("HB", "")),
                "hrc": _to_int(row.get("HRC", "")),
                "vdi": _to_int(row.get("VDI3233_No", "")),
            }
            _canonical_to_refs[canonical] = {}
            count += 1

        # Harvest every standard column on every row that shares this
        # canonical — later rows may carry additional regional codes.
        refs = _canonical_to_refs[canonical]
        for col in _STD_COLUMNS:
            val = row.get(col, "")
            if not val or val == "-":
                continue
            short = _STD_COL_TO_KEY[col]
            refs.setdefault(short, val)
            # Index the normalized value → canonical. First writer wins so
            # the canonical picked above stays stable under reload.
            _iso_to_canonical.setdefault(_normalize_std(val), canonical)

        # Canonical itself is a lookup key (so resolve_rich("S45C") hits
        # exact regardless of which column provided the canonical).
        _iso_to_canonical.setdefault(_normalize_std(canonical), canonical)

    return count


def _load_slang_csv(path: Path) -> int:
    """Populate _slang_to_canonical / _slang_confidence / _canonical_to_slangs
    from slang_ko.csv. Returns the row count. Unknown canonicals (trade
    names not in the VP CSV's standard columns — NAK80 / Inconel 718 /
    Ti-6Al-4V — are still indexed. Their iso_group is sourced from the
    slang row's own `iso_group` column, and we stamp it into
    `_iso_group_map` so downstream treats the trade name as a first-class
    canonical (SCR fills material_tag from iso_group, affinity picks it
    up for scoring). This is the "Korean trade-name vocabulary" layer
    the VP dict-only approach couldn't express."""
    if not path.exists():
        return 0

    _slang_to_canonical.clear()
    _slang_confidence.clear()
    _canonical_to_slangs.clear()

    with open(path, encoding="utf-8-sig") as f:
        data_lines = [ln for ln in f if not ln.lstrip().startswith("#")]
    if data_lines and data_lines[0].startswith("\ufeff"):
        data_lines[0] = data_lines[0].lstrip("\ufeff")
    reader = csv.DictReader(data_lines)
    count = 0
    for row in reader:
        slang = (row.get("slang") or "").strip()
        canonical = (row.get("canonical_iso") or "").strip()
        if not slang or not canonical:
            continue
        conf_raw = (row.get("confidence") or "").strip()
        try:
            conf = float(conf_raw) if conf_raw else 1.0
        except ValueError:
            conf = 1.0
        key = _normalize_ko(slang)
        _slang_to_canonical.setdefault(key, canonical)
        _slang_confidence.setdefault(key, conf)
        _canonical_to_slangs.setdefault(canonical, []).append(slang)
        # Trade-name iso_group fallback. Skip when the canonical already
        # exists in _iso_group_map (the main CSV is authoritative). Only
        # stamp when the slang row supplies a valid ISO letter — malformed
        # rows never poison the map.
        iso_group_raw = (row.get("iso_group") or "").strip().upper()
        if iso_group_raw in _VALID_ISO_GROUPS and canonical not in _iso_group_map:
            _iso_group_map[canonical] = iso_group_raw
            # Surface the trade name as a direct query target so typing
            # "NAK80" or "Inconel 718" hits exact instead of falling to
            # fuzzy. cross_refs stays empty (no JIS/DIN/AISI synonyms
            # known); reverse_lookup degrades to {canonical, iso_group, slang_ko}.
            _canonical_to_refs.setdefault(canonical, {})
            _iso_to_canonical.setdefault(_normalize_std(canonical), canonical)
        count += 1
    return count


def _build_material_embeddings() -> None:
    """One-shot embedding of every canonical name so resolve_rich's final
    fallback tier can score novel phrasings against the known set. Skipped
    silently if the embedding call fails (missing API key, transient
    upstream error) — the prior tiers (exact/cross/slang/fuzzy) still work
    without embeddings, so the degradation is graceful."""
    if _canonical_embeddings or not _canonical_to_refs:
        return
    names = list(_canonical_to_refs.keys())
    try:
        vecs = _embed(names)
    except Exception:
        return
    for name, vec in zip(names, vecs):
        _canonical_embeddings[name] = vec


def _build_material_mapping_index() -> None:
    """Idempotent build of the MaterialMapping in-memory indexes. Resolved
    from `config.MATERIAL_CSV_PATH` / `MATERIAL_SLANG_PATH` so ops can
    swap in an extended CSV without code changes. `ARIA_MATERIAL_CSV` can
    be absolute or relative to the python-api cwd."""
    global _material_index_loaded
    try:
        from config import MATERIAL_CSV_PATH, MATERIAL_SLANG_PATH
    except ImportError:
        # config not importable (only possible in ad-hoc unit tests) —
        # fall through silently, resolve_rich will return no_match.
        _material_index_loaded = True
        return

    # Resolve paths relative to python-api directory (this file's parent).
    base = Path(__file__).resolve().parent
    csv_path = Path(MATERIAL_CSV_PATH)
    if not csv_path.is_absolute():
        csv_path = base / csv_path
    slang_path = Path(MATERIAL_SLANG_PATH)
    if not slang_path.is_absolute():
        slang_path = base / slang_path

    _load_iso_mapping_csv(csv_path)
    _load_slang_csv(slang_path)
    _build_material_embeddings()
    _material_index_loaded = True


@dataclass
class MaterialMatch:
    """Result of resolve_rich(). status encodes which tier fired; tiers
    are ordered exact → cross_standard → slang → fuzzy → embedding → no_match.
    `alternatives` is populated for fuzzy/embedding/no_match so the UI can
    surface "did you mean …?" disambiguation prompts."""
    status: Literal[
        "exact", "cross_standard", "slang", "fuzzy", "embedding", "no_match"
    ]
    canonical_iso: Optional[str] = None
    iso_group: Optional[str] = None           # P | M | K | N | S | H | O
    matched_via: str = ""                     # "jis" | "din" | "slang_ko" | "fuzzy" | "embedding" | ""
    confidence: float = 0.0
    alternatives: list[str] = field(default_factory=list)
    cross_refs: dict[str, str] = field(default_factory=dict)
    hardness: Optional[dict[str, object]] = None


def _find_nearest_digit_prefix(query: str, top_n: int) -> list[tuple[str, float]]:
    """VP's scoring: numeric substring match (+2.0 per digit) + alphabetic
    prefix match (+3.0). Cheap, runs over every canonical. Returns
    (canonical, score) sorted descending."""
    q = _normalize_std(query)
    if not q:
        return []
    # Split into alpha prefix + digit tail — real grade codes follow that
    # shape most of the time ("sus304", "skd11", "s45c" → "s45" + "c").
    alpha = ""
    digits = ""
    for ch in q:
        if ch.isdigit():
            digits += ch
        elif ch.isalpha() and not digits:
            alpha += ch
    scored: list[tuple[str, float]] = []
    for canonical in _canonical_to_refs:
        tgt = _normalize_std(canonical)
        score = 0.0
        if alpha and tgt.startswith(alpha):
            score += 3.0
        if digits:
            # Count leading digits shared by both strings — "30" vs "304"
            # gets partial credit (2 shared digits × 2.0 = 4.0).
            tgt_digits = "".join(ch for ch in tgt if ch.isdigit())
            common = 0
            for a, b in zip(digits, tgt_digits):
                if a == b:
                    common += 1
                else:
                    break
            score += common * 2.0
        if score > 0:
            scored.append((canonical, score))
    scored.sort(key=lambda t: t[1], reverse=True)
    return scored[:top_n]


def _find_nearest_lev(query: str, top_n: int) -> list[tuple[str, float]]:
    """Levenshtein ratio (via difflib) — a second opinion when the digit/
    prefix scorer misses. Catches typos that lose the digit prefix shape
    ("icomel 718" → Inconel 718). Returns (canonical, ratio) top_n."""
    if not query or not _canonical_to_refs:
        return []
    q = _normalize_std(query)
    scored: list[tuple[str, float]] = []
    for canonical in _canonical_to_refs:
        ratio = difflib.SequenceMatcher(
            None, q, _normalize_std(canonical), autojunk=False
        ).ratio()
        if ratio > 0:
            scored.append((canonical, ratio))
    scored.sort(key=lambda t: t[1], reverse=True)
    return scored[:top_n]


def find_nearest(query: str, top_n: int = 3) -> list[tuple[str, float]]:
    """Public fuzzy scorer. Merges the digit/prefix tier with the
    Levenshtein tier — each canonical's rank is the max of the two
    (after ratio normalization), so either signal can surface a near-match
    on its own. Returns (canonical, score∈[0,1]) sorted descending."""
    if not query or not _canonical_to_refs:
        return []
    dp = _find_nearest_digit_prefix(query, top_n * 2)
    lv = _find_nearest_lev(query, top_n * 2)
    # Normalize digit-prefix score to [0,1] via max-in-pool so a single
    # perfect match drives 1.0 while weaker matches stay proportional.
    dp_max = max((s for _, s in dp), default=0.0) or 1.0
    merged: dict[str, float] = {}
    for name, s in dp:
        merged[name] = max(merged.get(name, 0.0), s / dp_max)
    for name, r in lv:
        merged[name] = max(merged.get(name, 0.0), r)
    return sorted(merged.items(), key=lambda t: t[1], reverse=True)[:top_n]


def _embedding_nearest(query: str, top_n: int = 3) -> list[tuple[str, float]]:
    """Cosine-sim against the pre-computed canonical embeddings.
    Returns [(canonical, cosine), …] top_n. Empty list when embeddings
    weren't built (no API key at startup)."""
    if not query or not _canonical_embeddings:
        return []
    try:
        q_vec = _embed([query])[0]
    except Exception:
        return []
    scored = [
        (canonical, _cosine(q_vec, vec))
        for canonical, vec in _canonical_embeddings.items()
    ]
    scored.sort(key=lambda t: t[1], reverse=True)
    return scored[:top_n]


def resolve_rich(query: str) -> MaterialMatch:
    """Cross-standard + slang + fuzzy + embedding resolver. Returns a
    structured MaterialMatch regardless of outcome — callers inspect
    `.status` to decide how to proceed. Safe to call before the index is
    built; returns status="no_match" in that case.

    Match cascade (first hit wins, fastest tier first):
      1. exact — normalize(query) → canonical directly
      2. cross_standard — normalize(query) → standard alias → canonical
      3. slang — normalize_ko(query) → slang dict → canonical
      4. fuzzy — find_nearest with score ≥ MATERIAL_FUZZY_THRESHOLD
      5. embedding — cosine ≥ MATERIAL_EMBED_THRESHOLD
      6. no_match — alternatives populated from find_nearest
    """
    empty = MaterialMatch(status="no_match")
    if not query:
        return empty
    if not _material_index_loaded or not _canonical_to_refs:
        # Index not ready — return no_match but include find_nearest
        # alternatives if any exist so the caller can still suggest.
        empty.alternatives = [name for name, _ in find_nearest(query, 3)]
        return empty

    from config import MATERIAL_FUZZY_THRESHOLD, MATERIAL_EMBED_THRESHOLD

    q_raw = str(query).strip()
    q_std = _normalize_std(q_raw)
    q_ko = _normalize_ko(q_raw)

    # 1 & 2 — standard/cross-standard lookup. Distinguish exact vs cross
    # by checking whether the normalized query equals the canonical's own
    # normalized form. If yes → user typed the canonical itself; if no
    # → they typed a JIS/DIN/AISI equivalent and we resolved across.
    canonical = _iso_to_canonical.get(q_std)
    if canonical:
        status: Literal["exact", "cross_standard"] = (
            "exact" if _normalize_std(canonical) == q_std else "cross_standard"
        )
        matched_via = _which_standard(canonical, q_std) or "canonical"
        return MaterialMatch(
            status=status,
            canonical_iso=canonical,
            iso_group=_iso_group_map.get(canonical),
            matched_via=matched_via,
            confidence=1.0 if status == "exact" else 0.95,
            cross_refs=dict(_canonical_to_refs.get(canonical, {})),
            hardness=_hardness_map.get(canonical),
        )

    # 3 — Korean slang. slang_ko.csv is the SSOT; _slang_confidence lets
    # individual entries self-flag (e.g. phonetic variants at 0.9 while
    # canonical-form slang stays at 1.0).
    #
    # slang targets can be JIS/AISI aliases ("S45C") rather than the
    # canonical DIN form ("C45"), so we re-resolve the slang target
    # through _iso_to_canonical to recover the real canonical + its
    # iso_group / cross_refs / hardness. Falls back to the slang target
    # as-is when not in the standard index (unknown / manually-added).
    slang_hit = _slang_to_canonical.get(q_ko)
    if slang_hit:
        canonical_for_slang = _iso_to_canonical.get(_normalize_std(slang_hit), slang_hit)
        return MaterialMatch(
            status="slang",
            canonical_iso=canonical_for_slang,
            iso_group=_iso_group_map.get(canonical_for_slang),
            matched_via="slang_ko",
            confidence=_slang_confidence.get(q_ko, 1.0),
            cross_refs=dict(_canonical_to_refs.get(canonical_for_slang, {})),
            hardness=_hardness_map.get(canonical_for_slang),
        )

    # 4 — fuzzy. MATERIAL_FUZZY_THRESHOLD gates the top-1 score; below it
    # we still collect alternatives for disambiguation prompts downstream.
    nearest = find_nearest(q_raw, 3)
    if nearest and nearest[0][1] >= MATERIAL_FUZZY_THRESHOLD:
        top_name, top_score = nearest[0]
        return MaterialMatch(
            status="fuzzy",
            canonical_iso=top_name,
            iso_group=_iso_group_map.get(top_name),
            matched_via="fuzzy",
            confidence=min(float(top_score), 0.9),
            alternatives=[n for n, _ in nearest[1:]],
            cross_refs=dict(_canonical_to_refs.get(top_name, {})),
            hardness=_hardness_map.get(top_name),
        )

    # 5 — embedding cosine. Covers novel phrasings that miss every string
    # tier ("304 stainless steel", "inconel seven eighteen"). Only fires
    # if _build_material_embeddings succeeded at startup.
    emb = _embedding_nearest(q_raw, 3)
    if emb and emb[0][1] >= MATERIAL_EMBED_THRESHOLD:
        top_name, top_score = emb[0]
        return MaterialMatch(
            status="embedding",
            canonical_iso=top_name,
            iso_group=_iso_group_map.get(top_name),
            matched_via="embedding",
            confidence=float(top_score),
            alternatives=[n for n, _ in emb[1:]],
            cross_refs=dict(_canonical_to_refs.get(top_name, {})),
            hardness=_hardness_map.get(top_name),
        )

    # 6 — no match. Surface the best fuzzy guesses so the caller can
    # log / prompt / suggest without a second pass.
    alt_pool: list[str] = []
    if nearest:
        alt_pool.extend(n for n, _ in nearest[:3])
    if emb:
        alt_pool.extend(n for n, _ in emb[:3])
    # de-dupe preserving order
    seen: set[str] = set()
    alternatives = [n for n in alt_pool if not (n in seen or seen.add(n))][:3]
    return MaterialMatch(status="no_match", alternatives=alternatives)


def _which_standard(canonical: str, q_std: str) -> str | None:
    """Reverse-lookup helper — given a canonical and the normalized query
    that resolved to it, return which standard key produced the match
    ('jis', 'din', 'aisi', …). None when the match was via canonical
    itself. Used only to populate MaterialMatch.matched_via for tracing."""
    refs = _canonical_to_refs.get(canonical) or {}
    for short, val in refs.items():
        if _normalize_std(val) == q_std:
            return short
    return None


def reverse_lookup(canonical_iso: str) -> dict[str, list[str]]:
    """Given a canonical, return every synonym grouped by source: all 13
    standard codes + Korean slang. Unknown canonical → empty dict.
    Consumers can render a disambiguation UI or a "also known as …"
    footnote without issuing a second lookup.

    Accepts spacing/casing variants — "SUS 304" / "SUS304" / "sus 304"
    all normalize to the same canonical before the lookup so the caller
    doesn't have to remember which form the CSV carries.

    Shape:
      {
        "canonical": [canonical],
        "iso_group": [group_letter],
        "jis": ["S45C"], "din": ["C45"], "aisi": ["1045"], …,
        "slang_ko": ["사오시", "에스사오시", …],
      }
    """
    if not canonical_iso:
        return {}
    # Resolve through _iso_to_canonical so a query with stray spaces or
    # alternate casing still finds the canonical form the CSV used.
    resolved = _iso_to_canonical.get(_normalize_std(canonical_iso), canonical_iso)
    if resolved not in _canonical_to_refs:
        return {}
    out: dict[str, list[str]] = {"canonical": [resolved]}
    group = _iso_group_map.get(resolved)
    if group:
        out["iso_group"] = [group]
    for short, val in _canonical_to_refs[resolved].items():
        out[short] = [val]
    # Slang may be keyed on the un-spaced form while the canonical carries
    # a space ("SUS 304" in CSV, "SUS304" in slang_ko.csv). Look up both
    # shapes and merge — this is a small, bounded union.
    slangs: list[str] = []
    for key in (resolved, resolved.replace(" ", "")):
        got = _canonical_to_slangs.get(key)
        if got:
            slangs.extend(got)
    # de-dupe preserving first-seen order
    seen: set[str] = set()
    deduped = [s for s in slangs if not (s in seen or seen.add(s))]
    if deduped:
        out["slang_ko"] = deduped
    return out


def material_index_stats() -> dict[str, int]:
    """Debug introspection for /health detailed or ad-hoc shell use."""
    return {
        "canonicals": len(_canonical_to_refs),
        "standard_aliases": len(_iso_to_canonical),
        "slang_entries": len(_slang_to_canonical),
        "embeddings": len(_canonical_embeddings),
        "loaded": 1 if _material_index_loaded else 0,
    }
