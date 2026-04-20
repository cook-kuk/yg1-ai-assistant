"""Hallucination guard — two layers:

1. `scrub()` — token-level SKU-shape removal (legacy). Strips model
   numbers the LLM invents that pattern-match a SKU but aren't in the
   catalog.
2. `validate_response()` — claim-level evidence grounding (Phase 2+).
   Extracts factual claims from the answer, checks each against an
   EvidenceBundle (products + RAG snippets + catalog facts), and
   removes/annotates unsupported ones. Mode-configurable
   (strict/balanced/loose) via config.VALIDATOR_MODE.

Cache: known_brands / known_series are loaded once per process. Call
refresh_cache() in tests to reset.
"""

from __future__ import annotations

import json
import re
import time
from collections import defaultdict
from dataclasses import dataclass, field
from typing import Any, Literal, Optional


# ── SAFE_WORDS — never scrub these even if SKU-shaped ─────────────
SAFE_WORDS: set[str] = {
    # ISO material groups
    "P", "M", "K", "N", "S", "H", "O",
    # Coatings
    "TIALN", "ALTIN", "ALCRN", "TICN", "TIN", "DLC", "CBN", "PCD",
    "Y-COATING", "X-COATING", "Z-COATING", "XC-COATING", "RCH-COATING",
    # Material codes
    "SUS304", "SUS316", "SUS316L", "SUS420", "SUS630",
    "S45C", "S50C", "SM45C", "SCM415", "SCM440", "SKD11", "SKD61", "SKH51",
    "A6061", "A7075", "A5052", "A2024",
    "FC200", "FC250", "FC300", "FCD400", "FCD450", "FCD500",
    "TI6AL4V", "IN718", "IN625",
    # Tap tolerances
    "6H", "6G", "7H", "6HX", "4H", "5H",
    # Hardness
    "HRC", "HRB", "HV",
    # Thread specs
    "UNC", "UNF", "UNEF", "NPT", "BSPT", "BSP",
    # Common abbreviations
    "LOC", "OAL", "CL", "HSK", "BT", "CAT", "ER", "HSS", "MQL", "HPC",
    # Tool types
    "YG1", "YG-1",
}

# SKU-like token: letters+digits mix or A-Z{2+}-\d+ shapes.
# Matches things like "EM4010", "XP-50A", "YG-EM4010", "VX99".
# Deliberately broad; SAFE_WORDS + known-sets prune the false positives.
_SKU_RE = re.compile(r"\b[A-Z][A-Z0-9]*-?[A-Z0-9]*\d+[A-Z0-9-]*\b")

# Empty parens "( )" and runs of commas/spaces left over after removal.
_EMPTY_PAREN_RE = re.compile(r"\(\s*\)")
_MULTI_COMMA_RE = re.compile(r",\s*,+")
_MULTI_SPACE_RE = re.compile(r"[ \t]{2,}")


# ── known-set cache ─────────────────────────────────────────────────
from config import CACHE_TTL_SEC as _CACHE_TTL_SEC
_cache: dict[str, object] = {
    "brands": None,
    "series": None,
    "loaded_at": 0.0,
}


def _load_known() -> tuple[set[str], set[str]]:
    """Load {brand, series} from product MV. Empty sets if DB unreachable —
    in that degraded mode the guard falls back to SAFE_WORDS-only."""
    try:
        from db import fetch_all
        rows = fetch_all(
            """
            SELECT DISTINCT
              UPPER(BTRIM(edp_brand_name)) AS brand,
              UPPER(BTRIM(edp_series_name)) AS series
            FROM catalog_app.product_recommendation_mv
            WHERE edp_brand_name IS NOT NULL OR edp_series_name IS NOT NULL
            """
        )
    except Exception:
        return set(), set()

    brands: set[str] = set()
    series: set[str] = set()
    for r in rows:
        if r.get("brand"):
            brands.add(str(r["brand"]))
        if r.get("series"):
            series.add(str(r["series"]))
    return brands, series


def _ensure_cache() -> tuple[set[str], set[str]]:
    now = time.time()
    if (
        _cache["brands"] is None
        or _cache["series"] is None
        or now - float(_cache["loaded_at"]) > _CACHE_TTL_SEC  # type: ignore[arg-type]
    ):
        brands, series = _load_known()
        _cache["brands"] = brands
        _cache["series"] = series
        _cache["loaded_at"] = now
    return _cache["brands"], _cache["series"]  # type: ignore[return-value]


def refresh_cache() -> None:
    _cache["brands"] = None
    _cache["series"] = None
    _cache["loaded_at"] = 0.0
    _cache["edps"] = None


def _get_valid_edps() -> set[str]:
    """Whitelist of every EDP number currently in the in-memory index.
    Any SKU-shaped token in an LLM answer that isn't in this set (and isn't
    SAFE_WORDS / a known brand / series) gets scrubbed.

    Cached alongside brand/series with the same TTL. If product_index is
    unavailable the set is empty and we fall back to the older
    brand+series check."""
    cached = _cache.get("edps")
    if isinstance(cached, set):
        return cached
    try:
        from product_index import load_index
        index = load_index()
        edps = {str(p["edp_no"]).upper() for p in index if p.get("edp_no")}
    except Exception:
        edps = set()
    _cache["edps"] = edps
    return edps


def _get_valid_edps_full() -> frozenset[str]:
    """Full-catalog EDP whitelist (not limited to the milling subset).
    Used so guard.scrub doesn't strip an authoritative edp like UGMG34919
    that lives outside the milling index. Lazy-delegated to product_index
    which owns the cache + TTL."""
    try:
        from product_index import get_valid_edps_full
        return get_valid_edps_full()
    except Exception:
        return frozenset()


def set_known(brands: set[str], series: set[str]) -> None:
    """Test hook: inject known sets directly and bypass DB load."""
    _cache["brands"] = {b.upper() for b in brands}
    _cache["series"] = {s.upper() for s in series}
    _cache["loaded_at"] = time.time()


def _is_safe(
    token: str,
    brands: set[str],
    series: set[str],
    extra: set[str],
) -> bool:
    up = token.upper()
    if up in SAFE_WORDS:
        return True
    if up in brands or up in series or up in extra:
        return True
    # EDP whitelist — every catalog product number is authoritative.
    # Full-catalog set first (drops milling-only bias); fall back to the
    # milling-limited set so pre-Phase-0 callers keep their behavior when
    # the full set is unavailable.
    if up in _get_valid_edps_full():
        return True
    if up in _get_valid_edps():
        return True
    # Substring match — DB brand/series values often include spaces or
    # subscripts (e.g. "V7 MILL-INOX") that the LLM drops, so we also
    # accept the bare token when it appears as a sub-token of a known name.
    for s in brands:
        if up in s:
            return True
    for s in series:
        if up in s:
            return True
    for s in extra:
        if up in s:
            return True
    return False


def scrub(text: str, extra_safe: Optional[set[str]] = None) -> tuple[str, list[str]]:
    """Remove SKU-shaped tokens not in {SAFE_WORDS ∪ known_brands ∪ known_series ∪ extra_safe}.
    Returns (cleaned_text, removed_tokens)."""
    if not text:
        return text, []

    brands, series = _ensure_cache()
    extra = {s.upper() for s in (extra_safe or set()) if s}
    removed: list[str] = []

    def _replace(match: re.Match[str]) -> str:
        token = match.group(0)
        if _is_safe(token, brands, series, extra):
            return token
        removed.append(token)
        return ""

    cleaned = _SKU_RE.sub(_replace, text)

    # tidy up
    cleaned = _EMPTY_PAREN_RE.sub("", cleaned)
    cleaned = _MULTI_COMMA_RE.sub(",", cleaned)
    cleaned = _MULTI_SPACE_RE.sub(" ", cleaned)
    cleaned = re.sub(r"\s+([,.!?])", r"\1", cleaned)
    cleaned = cleaned.strip()

    return cleaned, removed


# ══════════════════════════════════════════════════════════════════════
# Phase 2+: Evidence-grounded Response Validator
# ══════════════════════════════════════════════════════════════════════
# Data shapes ────────────────────────────────────────────────────────

@dataclass
class EvidenceBundle:
    """Ground truth for answer-level fact checking.

    products       — ranked candidates the CoT prompt already saw (dict per row)
    knowledge_by_type — RAG snippets grouped by `type` for fast citation lookup
    cutting_range  — Vc/fz/RPM aggregate from the YG-1 chart
    catalog_facts  — {brands, series, edps_full} re-using the guard cache
    """
    products: list[dict] = field(default_factory=list)
    knowledge_by_type: dict[str, list[dict]] = field(default_factory=dict)
    cutting_range: dict = field(default_factory=dict)
    catalog_facts: dict = field(default_factory=dict)

    @classmethod
    def from_chat_state(
        cls,
        ranked: Any,
        knowledge: list[dict] | None,
        cutting_range: dict | None = None,
    ) -> "EvidenceBundle":
        """Build from main.py's ranked + knowledge locals (same scope that
        scrub() operates in). `ranked` can be `list[tuple(dict, score, breakdown)]`
        (sync path) or `list[dict]` already flattened (stream path cleanup)."""
        products: list[dict] = []
        for item in (ranked or []):
            if isinstance(item, tuple) and item and isinstance(item[0], dict):
                products.append(item[0])
            elif isinstance(item, dict):
                products.append(item)
        kb_by_type: dict[str, list[dict]] = defaultdict(list)
        for k in (knowledge or []):
            if not isinstance(k, dict):
                continue
            kb_by_type[str(k.get("type") or "unknown")].append(k)
        # Re-use guard caches — full EDP set first (Phase 0 addition) so
        # non-milling EDPs stay authoritative.
        brands, series = _ensure_cache()
        try:
            edps_full = _get_valid_edps_full()
        except Exception:
            edps_full = frozenset()
        catalog_facts = {
            "brands": brands,
            "series": series,
            "edps_full": edps_full,
        }
        return cls(
            products=products,
            knowledge_by_type=dict(kb_by_type),
            cutting_range=dict(cutting_range or {}),
            catalog_facts=catalog_facts,
        )

    def schema_fields(self) -> list[str]:
        """Runtime field list for the claim-extractor prompt. Derived from
        the first product so the LLM sees the actual keys it needs to
        ground against (never a hand-maintained template)."""
        if not self.products:
            # Knowledge-only responses still benefit from a minimal schema.
            return ["text", "type"]
        # Drop private/provenance keys; keep stable order so prompt caching
        # doesn't churn across requests.
        keys = {k for k in self.products[0].keys() if not k.startswith("_")}
        return sorted(keys)

    def has_product_field(
        self,
        field_name: Optional[str],
        value: Any,
        tolerance: float = 0.01,
    ) -> Optional[int]:
        """Return index of the first product whose `field_name` equals
        `value`. Numeric comparison uses relative tolerance; string
        comparison is case-insensitive trimmed. None → no match (or
        field/value missing)."""
        if not field_name or value is None:
            return None
        for i, p in enumerate(self.products):
            actual = p.get(field_name)
            if actual is None:
                continue
            if isinstance(value, (int, float)) and _is_numeric(actual):
                try:
                    av = float(actual)
                except (TypeError, ValueError):
                    continue
                denom = max(abs(av), abs(float(value)), 1e-9)
                if abs(av - float(value)) / denom <= tolerance:
                    return i
            else:
                if str(actual).strip().lower() == str(value).strip().lower():
                    return i
        return None

    def has_numeric_match(
        self,
        value: Optional[float],
        field_hint: Optional[str] = None,
        tolerance: float = 0.01,
    ) -> Optional[str]:
        """Search every product for a numeric field matching `value`. With
        `field_hint` only that column is checked. Returns an evidence_ref
        string like 'products[2].diameter' when found."""
        if value is None:
            return None
        try:
            v = float(value)
        except (TypeError, ValueError):
            return None
        # Field-hinted — use has_product_field for a single lookup.
        if field_hint:
            idx = self.has_product_field(field_hint, v, tolerance=tolerance)
            if idx is not None:
                return f"products[{idx}].{field_hint}"
            # cutting_range fallback when field_hint is a known Vc/fz key.
            cr_val = self.cutting_range.get(field_hint)
            if cr_val is not None and _is_numeric(cr_val):
                try:
                    if abs(float(cr_val) - v) / max(abs(v), 1e-9) <= tolerance:
                        return f"cutting_range.{field_hint}"
                except (TypeError, ValueError):
                    pass
            return None
        # No hint — scan every numeric product field.
        for i, p in enumerate(self.products):
            for k, actual in p.items():
                if k.startswith("_") or not _is_numeric(actual):
                    continue
                try:
                    av = float(actual)
                except (TypeError, ValueError):
                    continue
                if abs(av - v) / max(abs(av), abs(v), 1e-9) <= tolerance:
                    return f"products[{i}].{k}"
        # cutting_range last-resort — covers Vc/fz/RPM claims with no field hint.
        for k, cv in self.cutting_range.items():
            if not _is_numeric(cv):
                continue
            try:
                if abs(float(cv) - v) / max(abs(v), 1e-9) <= tolerance:
                    return f"cutting_range.{k}"
            except (TypeError, ValueError):
                continue
        return None

    def has_rag_mention(
        self,
        text: str,
        sim_threshold: float = 0.75,
    ) -> Optional[tuple[str, int]]:
        """Return (type, index) when any RAG snippet semantically overlaps
        with `text`. Cheap substring pre-filter, full cosine fallback via
        rag._cosine_sim. None on miss or when the embedding API is
        unreachable (validator then downgrades to 'unsupported' — safe
        default)."""
        if not text or not self.knowledge_by_type:
            return None
        t_low = str(text).strip().lower()
        if not t_low:
            return None
        # Stage 1: cheap substring probe on the snippet text fields.
        for kb_type, items in self.knowledge_by_type.items():
            for i, item in enumerate(items):
                blob = _snippet_blob(item)
                if not blob:
                    continue
                if t_low in blob or blob in t_low:
                    return (kb_type, i)
        # Stage 2: embedding cosine. Lazy import — only runs on miss so
        # well-formed answers pay zero embedding cost.
        try:
            from rag import _cosine_sim  # type: ignore
            import openai
            client = _get_embed_client()
            if client is None:
                return None
            from config import OPENAI_EMBED_MODEL
            resp = client.embeddings.create(
                input=[text],
                model=OPENAI_EMBED_MODEL,
            )
            q_vec = resp.data[0].embedding
        except Exception:
            return None
        best: tuple[str, int, float] | None = None
        for kb_type, items in self.knowledge_by_type.items():
            for i, item in enumerate(items):
                vec = item.get("_embedding")
                if not isinstance(vec, list):
                    continue
                sim = _cosine_sim(q_vec, vec)
                if sim >= sim_threshold and (best is None or sim > best[2]):
                    best = (kb_type, i, sim)
        return (best[0], best[1]) if best else None


def _is_numeric(v: Any) -> bool:
    if v is None:
        return False
    if isinstance(v, (int, float)) and not isinstance(v, bool):
        return True
    if isinstance(v, str):
        return bool(re.fullmatch(r"-?\d+(?:\.\d+)?", v.strip()))
    return False


def _snippet_blob(item: dict) -> str:
    """Flatten a knowledge-snippet dict into a single lowercase string
    for substring matching. Handles the multiple shapes rag.py emits
    (direct text, nested .data.* fields, web_search .snippet)."""
    if not item:
        return ""
    parts: list[str] = []
    for key in ("text", "snippet", "title"):
        v = item.get(key)
        if isinstance(v, str):
            parts.append(v)
    data = item.get("data")
    if isinstance(data, dict):
        for v in data.values():
            if isinstance(v, str):
                parts.append(v)
            elif isinstance(v, list):
                parts.extend(x for x in v if isinstance(x, str))
    return " ".join(parts).lower()


def _get_embed_client():
    """Reuse chat._get_client — same OpenAI key, connection pool."""
    try:
        from chat import _get_client
        return _get_client()
    except Exception:
        return None


# ── Claim + Grounding result ───────────────────────────────────────

@dataclass
class Claim:
    text: str
    span: tuple[int, int]
    type: str  # numeric | categorical | citation | existential | domain_knowledge
    subject: str
    payload: dict
    grounding_required: bool


@dataclass
class GroundingResult:
    status: str  # grounded | contradicted | unsupported
    evidence_ref: Optional[str]
    confidence: float


# ── Claim extraction ───────────────────────────────────────────────

def _extract_claims(answer: str, evidence: EvidenceBundle) -> list[Claim]:
    """LLM-based claim extraction. Strict Pydantic schema via
    `beta.chat.completions.parse`; falls back to JSON-object mode if the
    provider rejects the schema or the SDK raises. Returns an empty
    list on any hard failure — caller treats that as "nothing to
    validate" (conservative; don't block the answer)."""
    try:
        from config import (
            VALIDATOR_LLM_MIN_CHARS,
            VALIDATOR_LLM_MODEL,
            VALIDATOR_EXTRACTOR_PROMPT,
        )
    except Exception:
        return []
    if not answer or len(answer) < VALIDATOR_LLM_MIN_CHARS:
        return []
    fields_list = ", ".join(evidence.schema_fields()) or "(no product context)"
    system_prompt = VALIDATOR_EXTRACTOR_PROMPT.format(fields=fields_list)

    client = _get_embed_client()  # same OpenAI client used for embeddings
    if client is None:
        return []

    # Strict schema path via Pydantic.
    try:
        from pydantic import BaseModel, ConfigDict

        class _ClaimModel(BaseModel):
            model_config = ConfigDict(extra="ignore")
            text: str
            type: Literal[
                "numeric", "categorical", "citation", "existential", "domain_knowledge"
            ]
            subject: str = ""
            payload: dict = {}
            grounding_required: bool = True
            span: list[int] = []

        class _ClaimList(BaseModel):
            claims: list[_ClaimModel]

        resp = client.beta.chat.completions.parse(
            model=VALIDATOR_LLM_MODEL,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": answer},
            ],
            response_format=_ClaimList,
            temperature=0,
        )
        parsed = resp.choices[0].message.parsed
        if parsed is None:
            return []
        return _finalize_claims(parsed.claims, answer)
    except Exception:
        pass  # fall through to json_object fallback

    # Fallback: legacy response_format.
    try:
        resp = client.chat.completions.create(
            model=VALIDATOR_LLM_MODEL,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": answer},
            ],
            response_format={"type": "json_object"},
            temperature=0,
        )
        raw = resp.choices[0].message.content or "{}"
        data = json.loads(raw)
    except Exception:
        return []
    items = data.get("claims") if isinstance(data, dict) else None
    if not isinstance(items, list):
        return []
    return _finalize_claims(items, answer)


def _finalize_claims(raw_items: list, answer: str) -> list[Claim]:
    """Normalize + span-validate the LLM output. Items whose reported
    span doesn't match the answer text are rebuilt via `answer.find(text)`
    so downstream `_apply_removals` never slices the wrong range."""
    out: list[Claim] = []
    for item in raw_items:
        text = getattr(item, "text", None) if not isinstance(item, dict) else item.get("text")
        ctype = getattr(item, "type", None) if not isinstance(item, dict) else item.get("type")
        subject = getattr(item, "subject", "") if not isinstance(item, dict) else item.get("subject", "")
        payload = getattr(item, "payload", {}) if not isinstance(item, dict) else item.get("payload", {})
        grounding_required = (
            getattr(item, "grounding_required", True)
            if not isinstance(item, dict)
            else item.get("grounding_required", True)
        )
        raw_span = getattr(item, "span", None) if not isinstance(item, dict) else item.get("span")
        if not isinstance(text, str) or not text.strip():
            continue
        if ctype not in ("numeric", "categorical", "citation", "existential", "domain_knowledge"):
            continue
        span = _resolve_span(answer, text, raw_span)
        if span is None:
            continue  # span mismatch + no fallback → skip the claim
        out.append(Claim(
            text=text,
            span=span,
            type=str(ctype),
            subject=str(subject or ""),
            payload=payload if isinstance(payload, dict) else {},
            grounding_required=bool(grounding_required),
        ))
    return out


def _resolve_span(answer: str, text: str, raw_span: Any) -> Optional[tuple[int, int]]:
    """Verify the LLM-reported span; rebuild via substring search on
    mismatch. None when the text isn't locatable in the answer."""
    if isinstance(raw_span, (list, tuple)) and len(raw_span) == 2:
        try:
            s, e = int(raw_span[0]), int(raw_span[1])
            if 0 <= s < e <= len(answer) and answer[s:e] == text:
                return (s, e)
        except (TypeError, ValueError):
            pass
    idx = answer.find(text)
    if idx < 0:
        return None
    return (idx, idx + len(text))


def _extract_claims_lightweight(answer: str) -> list[Claim]:
    """Rule-based claim extractor used when the Strong verifier already
    ran (verified=True) — skips the LLM call and only surfaces citation
    claims (the one category the verifier doesn't check). Detection
    phrases come from patterns.FAKE_CITATION_PHRASES (SSOT)."""
    try:
        from patterns import FAKE_CITATION_PHRASES
    except Exception:
        return []
    if not answer:
        return []
    out: list[Claim] = []
    a_low = answer.lower()
    for phrase in FAKE_CITATION_PHRASES:
        p_low = phrase.lower()
        start = 0
        while True:
            idx = a_low.find(p_low, start)
            if idx < 0:
                break
            # Expand to the containing sentence so removal is clean.
            sent_s, sent_e = _expand_to_sentence(answer, idx, idx + len(phrase))
            out.append(Claim(
                text=answer[sent_s:sent_e],
                span=(sent_s, sent_e),
                type="citation",
                subject="",
                payload={"source": phrase},
                grounding_required=True,
            ))
            start = idx + len(phrase)
    return out


_SENTENCE_BREAKS = re.compile(r"(?<=[.!?。])\s|(?<=[.!?。])$|\n")


def _expand_to_sentence(answer: str, start: int, end: int) -> tuple[int, int]:
    """Grow (start, end) to the nearest sentence boundary on each side.
    Used so citation removal doesn't leave dangling fragments."""
    # Backward search
    s = start
    while s > 0:
        if answer[s - 1] in ".!?。\n":
            break
        s -= 1
    # Forward search
    e = end
    while e < len(answer):
        if answer[e] in ".!?。\n":
            e += 1
            break
        e += 1
    return s, e


# ── Grounding check ────────────────────────────────────────────────

def _check_grounding(claim: Claim, evidence: EvidenceBundle) -> GroundingResult:
    """Dispatch per claim.type. Never calls LLM — pure lookup against
    the evidence bundle."""
    if not claim.grounding_required:
        return GroundingResult("grounded", None, 1.0)
    try:
        from config import (
            VALIDATOR_NUMERIC_TOLERANCE,
            VALIDATOR_SEMANTIC_THRESHOLD,
        )
    except Exception:
        VALIDATOR_NUMERIC_TOLERANCE = 0.01
        VALIDATOR_SEMANTIC_THRESHOLD = 0.75

    if claim.type == "numeric":
        value = claim.payload.get("value")
        field_hint = claim.payload.get("field")
        ref = evidence.has_numeric_match(
            value, field_hint=field_hint, tolerance=VALIDATOR_NUMERIC_TOLERANCE
        )
        return GroundingResult(
            "grounded" if ref else "unsupported",
            ref,
            1.0 if ref else 0.0,
        )

    if claim.type == "categorical":
        field_name = claim.payload.get("field")
        value = claim.payload.get("value")
        idx = evidence.has_product_field(field_name, value)
        if idx is not None:
            return GroundingResult("grounded", f"products[{idx}].{field_name}", 1.0)
        return GroundingResult("unsupported", None, 0.0)

    if claim.type == "citation":
        source_hint = claim.payload.get("source") or claim.text
        hit = evidence.has_rag_mention(source_hint, sim_threshold=VALIDATOR_SEMANTIC_THRESHOLD)
        if hit:
            return GroundingResult("grounded", f"knowledge.{hit[0]}[{hit[1]}]", 1.0)
        return GroundingResult("unsupported", None, 0.0)

    if claim.type == "existential":
        subject = claim.subject or ""
        # "product:EDP" subject → look up that product's existence.
        if subject.startswith("product:"):
            edp = subject.split(":", 1)[1].strip().upper()
            for i, p in enumerate(evidence.products):
                if str(p.get("edp_no") or "").upper() == edp:
                    return GroundingResult("grounded", f"products[{i}]", 1.0)
            # Also check the full catalog EDP set — Phase 0 edge case
            # where a non-milling EDP is mentioned.
            if edp in evidence.catalog_facts.get("edps_full", frozenset()):
                return GroundingResult("grounded", "catalog_facts.edps_full", 0.8)
            return GroundingResult("unsupported", None, 0.0)
        # Brand / series existential — catalog_facts membership.
        if subject.startswith("brand:"):
            b = subject.split(":", 1)[1].strip().upper()
            return GroundingResult(
                "grounded" if b in evidence.catalog_facts.get("brands", frozenset()) else "unsupported",
                "catalog_facts.brands" if b in evidence.catalog_facts.get("brands", frozenset()) else None,
                1.0 if b in evidence.catalog_facts.get("brands", frozenset()) else 0.0,
            )
        # Generic existential (stock / availability / status) — look for any
        # product field the payload.field names.
        field_name = claim.payload.get("field")
        if field_name:
            for i, p in enumerate(evidence.products):
                if p.get(field_name) is not None:
                    return GroundingResult("grounded", f"products[{i}].{field_name}", 0.8)
        return GroundingResult("unsupported", None, 0.0)

    return GroundingResult("unsupported", None, 0.0)


# ── Action dispatch ────────────────────────────────────────────────

def _decide_action(
    status: str,
    claim_type: str,
    mode: str,
) -> str:
    """Map (grounding status, claim type, mode) → action.

    strict   : unsupported → removed (all types)
    balanced : numeric/citation unsupported → removed, existential/categorical → annotated
    loose    : unsupported → annotated (warnings only)
    contradicted → removed regardless of mode
    grounded → passed
    """
    if status == "grounded":
        return "passed"
    if status == "contradicted":
        return "removed"
    # unsupported ↓
    if mode == "strict":
        return "removed"
    if mode == "loose":
        return "annotated"
    # balanced — remove concrete fabrications, annotate existential/categorical
    if claim_type in ("numeric", "citation"):
        return "removed"
    return "annotated"


def _apply_removals(answer: str, spans: list[tuple[int, int]]) -> str:
    """Slice out each span; process back-to-front so indices remain valid.
    Normalizes stray double-spaces / dangling punctuation left behind."""
    if not spans:
        return answer
    sorted_spans = sorted(set(spans), key=lambda s: s[0], reverse=True)
    out = answer
    for s, e in sorted_spans:
        if 0 <= s < e <= len(out):
            out = out[:s] + out[e:]
    # tidy whitespace around removals
    out = _EMPTY_PAREN_RE.sub("", out)
    out = _MULTI_COMMA_RE.sub(",", out)
    out = _MULTI_SPACE_RE.sub(" ", out)
    out = re.sub(r"\s+([,.!?])", r"\1", out)
    out = re.sub(r"\n{3,}", "\n\n", out)
    return out.strip()


# ── Public entry point ─────────────────────────────────────────────

def validate_response(
    answer: str,
    *,
    evidence: EvidenceBundle,
    mode: str = "balanced",
    skip_product_extraction: bool = False,
) -> tuple[str, list[dict]]:
    """Evidence-ground every factual claim in `answer`. Returns
    (cleaned_answer, warnings) where warnings is a list of dicts shaped
    to match `schemas.ValidatorWarning` (plain dicts so main.py can
    JSON-serialize without pydantic round-trips).

    mode ∈ {strict, balanced, loose}. See _decide_action.

    skip_product_extraction — set True when the Strong CoT verifier has
    already cross-checked the answer against the product ground truth
    (verifier handles numeric/categorical/existential). In that mode we
    only run the rule-based citation detector + citation grounding,
    saving one LLM call per request. RAG citation is the one category
    the verifier doesn't touch, so we can't drop it even on the
    lightweight path.
    """
    if not answer:
        return "", []
    mode = mode if mode in ("strict", "balanced", "loose") else "balanced"

    if skip_product_extraction:
        claims = _extract_claims_lightweight(answer)
    else:
        claims = _extract_claims(answer, evidence)
    # Always run the lightweight citation pass too — covers fake-citation
    # patterns the LLM extractor might miss (e.g. the canned "공식 정보
    # 기반 AI 추론" filler that LLMs emit at paragraph boundaries).
    if not skip_product_extraction:
        seen_spans = {c.span for c in claims}
        for extra in _extract_claims_lightweight(answer):
            if extra.span not in seen_spans:
                claims.append(extra)

    warnings: list[dict] = []
    removals: list[tuple[int, int]] = []
    # Deduplicate by (span, action, category) — citation-phrase detection
    # can flag the same sentence via multiple overlapping patterns
    # ("공식 정보 기반" + "공식 정보 기반 AI 추론") and LLM extractor can
    # also re-emit the same span. Collapsing here keeps ProductsResponse.
    # validator_warnings from inflating UI counts.
    seen: set[tuple[int, int, str, str]] = set()
    for claim in claims:
        result = _check_grounding(claim, evidence)
        action = _decide_action(result.status, claim.type, mode)
        category = claim.type if claim.type != "domain_knowledge" else "existential"
        key = (claim.span[0], claim.span[1], action, category)
        if key in seen:
            if action == "removed":
                removals.append(claim.span)
            continue
        seen.add(key)
        warnings.append({
            "category": category,
            "claim_text": claim.text,
            "evidence_ref": result.evidence_ref,
            "action": action,
            "confidence": float(result.confidence),
            "span": [claim.span[0], claim.span[1]],
        })
        if action == "removed":
            removals.append(claim.span)

    cleaned = _apply_removals(answer, removals)
    return cleaned, warnings
