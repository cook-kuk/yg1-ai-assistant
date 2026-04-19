import asyncio
import json as _json
import os
import re
from collections import Counter
from typing import Optional

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse

from schemas import (
    RecommendRequest,
    RecommendResponse,
    HealthResponse,
    Candidate,
    ScoredCandidate,
    SCRIntent,
    ManualFilters,
    ProductsRequest,
    ProductsResponse,
    ProductCard,
    ProductSummary,
    ProductsPageRequest,
    ProductsPageResponse,
    FilterOption,
    FilterOptionsRequest,
    FilterOptionsResponse,
    SourceAttribution,
)
from scr import parse_intent, _get_brands
from search import (
    search_products,
    product_count,
    product_count_filtered,
    get_filter_options,
)
from scoring import rank_candidates
from affinity import list_excellent_brands, get_affinity_rating
from scoring import SCORING_CONFIG as _SCORING_CONFIG
from guard import scrub
from rag import search_knowledge
from chat import generate_response
from product_index import (
    load_index,
    search_products_fast,
    index_size,
    get_filter_options_fast,
    count_products_fast,
    needs_db_path,
)
from clarify import suggest_clarifying_chips
from session import get_or_create as session_get_or_create, add_turn, carry_forward_intent
from scheduler import scheduler
from cutting import (
    get_cutting_conditions,
    get_conditions_for_products,
    get_cutting_range_for_material,
)
from series_profile import lookup as get_series_profile

app = FastAPI(title="cook-forge python-api", version="0.1.0")

# Browser-direct calls (no Next.js proxy in front) — allow the Next.js origin
# to hit /products, /products/stream, /filter-options. CORS_ALLOW_ORIGINS is a
# comma-separated list; "*" opens it up for dev.
_cors_raw = os.environ.get("CORS_ALLOW_ORIGINS", "*").strip()
_cors_origins = ["*"] if _cors_raw == "*" else [o.strip() for o in _cors_raw.split(",") if o.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins,
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
async def _warm_index() -> None:
    """Pull product_recommendation_mv into memory so /products skips DB
    on every request. Failure is non-fatal — downstream falls back to DB."""
    try:
        load_index()
    except Exception:
        pass


@app.on_event("startup")
async def _init_alias_resolver() -> None:
    """Embed each field's canonical set once at boot so parse_intent() only
    pays for the query embedding per request. Failure is non-fatal — the
    fuzzy resolver still works without embeddings."""
    try:
        from alias_resolver import init_resolver
        init_resolver()
    except Exception:
        pass


@app.on_event("startup")
async def _start_scheduler() -> None:
    """Kick off the background pipeline thread (product-index refresh,
    session sweep, few-shot backup). Idempotent — safe across reloads."""
    scheduler.start()


@app.get("/pipeline/status")
def pipeline_status() -> dict:
    """Introspection endpoint — last-run epoch and status tag per job."""
    return scheduler.status()


@app.get("/cutting-conditions")
def cutting_conditions_api(
    brand: Optional[str] = None,
    series: Optional[str] = None,
    iso: Optional[str] = None,
    workpiece: Optional[str] = None,
    limit: int = 20,
) -> list[dict]:
    """Browse the cutting-condition chart (Vc / Fz / RPM / Feed / Ap / Ae)
    filtered by any of brand / series / ISO group / workpiece name."""
    return get_cutting_conditions(
        brand=brand, series=series, iso=iso, workpiece=workpiece, limit=limit,
    )


@app.get("/health", response_model=HealthResponse)
def health() -> HealthResponse:
    try:
        n = product_count()
    except Exception as e:
        raise HTTPException(status_code=503, detail=f"db unreachable: {e}") from e
    return HealthResponse(status="ok", product_count=n)


def _derive_stock_status(total_stock) -> Optional[str]:
    """NULL = snapshot missing → no status (frontend hides the badge).
    0 = outofstock, 1–4 = limited, 5+ = instock. Thresholds are intentionally
    conservative: the snapshot is up to 24h old, so "limited" is a truer
    signal than claiming fresh stock at single digits."""
    if total_stock is None:
        return None
    try:
        n = int(total_stock)
    except (TypeError, ValueError):
        return None
    if n <= 0:
        return "outofstock"
    if n < 5:
        return "limited"
    return "instock"


def _coerce_int(v) -> Optional[int]:
    if v is None:
        return None
    try:
        return int(v)
    except (TypeError, ValueError):
        return None


def _series_profile_chips(ranked: list, max_chips: int = 3) -> list[str]:
    """Top-N 시리즈 프로파일 요약 chip. ranked 상위 10위 안에서 동일 시리즈가
    반복되면 그 시리즈의 직경/날수 범위 (series_profile_mv) 를 한 줄 chip 으로
    선제 노출해, 유저가 직접 필터 바를 뒤적이지 않아도 "이 시리즈는 8-20mm,
    2/3/4날 커버한다" 는 사실을 한눈에 볼 수 있게 한다.

    미리-알리는 정보 블록 A. Empty 리스트 반환 = 노출할 시리즈가 없다는 뜻
    (top-10 이 완전 고유 series 로만 구성됐거나 MV 캐시 미스)."""
    if not ranked:
        return []
    names = [c.get("series") for c, _, _ in ranked[:10] if c.get("series")]
    if not names:
        return []
    out: list[str] = []
    seen: set[str] = set()
    for series_name, _count in Counter(names).most_common(max_chips):
        profile = get_series_profile(series_name)
        if not profile:
            continue
        display = profile.get("series_name") or series_name
        if display in seen:
            continue
        seen.add(display)
        d_min = profile.get("diameter_min")
        d_max = profile.get("diameter_max")
        flutes = profile.get("flute_counts") or []
        parts: list[str] = []
        if d_min is not None and d_max is not None:
            if d_min == d_max:
                parts.append(f"직경 {d_min:g}mm")
            else:
                parts.append(f"직경 {d_min:g}-{d_max:g}mm")
        if flutes:
            parts.append("/".join(str(int(f)) for f in flutes) + "날")
        if parts:
            out.append(f"{display}: " + ", ".join(parts))
    return out


def _stock_summary_from_ranked(ranked: list) -> Optional[dict]:
    """{in_stock, total, pct} — 현 후보군 중 즉시 출고 가능한 비율.
    total_stock 이 None(스냅샷 없음) 또는 0 이면 분자에 포함하지 않는다.
    분모는 ranked 전체. total=0 이면 None 반환 (후보 자체가 없는 상황에서
    재고 문구를 띄우는 건 무의미)."""
    total = len(ranked)
    if total == 0:
        return None
    in_stock = 0
    for c, _, _ in ranked:
        try:
            qty = int(c.get("total_stock") or 0)
        except (TypeError, ValueError):
            qty = 0
        if qty > 0:
            in_stock += 1
    pct = round(in_stock / total * 100) if total else 0
    return {"in_stock": in_stock, "total": total, "pct": pct}


def _build_answer(intent, ranked: list, cutting_range: dict | None = None) -> str:
    if not ranked:
        return "조건에 맞는 제품을 찾지 못했습니다."
    parts = []
    if intent.diameter:
        parts.append(f"직경 {intent.diameter}mm")
    if intent.flute_count:
        parts.append(f"{intent.flute_count}날")
    if intent.material_tag:
        parts.append(f"소재군 {intent.material_tag}")
    if intent.subtype:
        parts.append(intent.subtype)
    head = ", ".join(parts) if parts else "요청"
    top = ranked[0][0]
    body = (
        f"{head} 조건으로 {len(ranked)}건 추천합니다. "
        f"1위: {top.get('brand') or '-'} / {top.get('series') or '-'} (EDP {top['edp_no']})."
    )
    # When CoT falls back to this template, preserve the principle-13 Vc/fz/RPM
    # line so RPM/절삭조건 questions don't silently lose the numbers the user
    # asked for.
    if cutting_range and cutting_range.get("row_count"):
        body += (
            f" YG-1 카탈로그 기준 Vc={cutting_range.get('vc_min')}~{cutting_range.get('vc_max')} m/min, "
            f"fz={cutting_range.get('fz_min')}~{cutting_range.get('fz_max')} mm/tooth, "
            f"RPM={cutting_range.get('n_min')}~{cutting_range.get('n_max')} 범위입니다 "
            f"(YG-1 카탈로그 절삭조건표 {cutting_range['row_count']}행 기준)."
        )
    return body


# The UI bar chart reads a `score_breakdown_max` dict keyed the same way
# as each card's score_breakdown. Pre-materialized from SCORING_CONFIG so
# we don't recompute per response — the scorer's weight table is the SSOT.
SCORE_BREAKDOWN_MAX: dict[str, float] = {
    "diameter": float(_SCORING_CONFIG["diameter"]),
    "flutes": float(_SCORING_CONFIG["flutes"]),
    "material": float(_SCORING_CONFIG["material"]),
    "shape": float(_SCORING_CONFIG["subtype"]),
    "coating": float(_SCORING_CONFIG["coating"]),
    "operation": float(_SCORING_CONFIG.get("operation", 0)),
    "affinity": float(_SCORING_CONFIG["affinity_excellent"]),
    "flagship": float(_SCORING_CONFIG["flagship_boost"]),
    "material_pref": float(_SCORING_CONFIG["material_pref"]),
    "stock": float(_SCORING_CONFIG["stock_boost"]),
    "hrc_match": float(_SCORING_CONFIG["hrc_match"]),
    "specialty": float(_SCORING_CONFIG.get("specialty", 0)),
}


def _derive_matched_fields(card: dict, intent) -> list[str]:
    """Generate match-reason chips for the UI ("소재 N군 적합", "형상 Square
    일치") from the scored row dict + SCR intent. Mirrors the legacy
    hybrid-retrieval.ts logic (lines 763–775) so the Python path surfaces
    the same evidence breadcrumbs the legacy UI trained its users on.

    Conservative: only emit a chip when both sides are non-null and the
    match is exact/substring — no chip for "coating unspecified" etc."""
    if not isinstance(card, dict):
        return []
    out: list[str] = []
    dia = card.get("diameter")
    intent_dia = getattr(intent, "diameter", None) if intent is not None else None
    if dia and intent_dia:
        try:
            if abs(float(dia) - float(intent_dia)) < 0.5:
                out.append(f"직경 {intent_dia}mm 일치")
        except (TypeError, ValueError):
            pass
    flutes = card.get("flutes")
    intent_flutes = getattr(intent, "flute_count", None) if intent is not None else None
    if flutes and intent_flutes:
        try:
            if int(float(flutes)) == int(intent_flutes):
                out.append(f"{intent_flutes}날 일치")
        except (TypeError, ValueError):
            pass
    tags = card.get("material_tags") or []
    intent_tag = getattr(intent, "material_tag", None) if intent is not None else None
    if intent_tag and tags and intent_tag in tags:
        out.append(f"소재 {intent_tag}군 적합")
    subtype = card.get("subtype")
    intent_subtype = getattr(intent, "subtype", None) if intent is not None else None
    if intent_subtype and subtype and str(intent_subtype).lower() in str(subtype).lower():
        out.append(f"형상 {subtype} 일치")
    coating = card.get("coating")
    intent_coating = getattr(intent, "coating", None) if intent is not None else None
    if intent_coating and coating and str(intent_coating).lower() in str(coating).lower():
        out.append(f"코팅 {coating} 일치")
    brand = card.get("brand")
    intent_brand = getattr(intent, "brand", None) if intent is not None else None
    if intent_brand and brand and str(intent_brand).lower() in str(brand).lower():
        out.append(f"브랜드 {brand} 일치")
    return out[:5]


def _route_intent(message: str):
    """Single-tier SCR pipeline — the LLM parser handles everything.
    Returns (intent, route_label)."""
    return parse_intent(message), "llm"


@app.post("/recommend", response_model=RecommendResponse)
def recommend(req: RecommendRequest) -> RecommendResponse:
    intent, route = _route_intent(req.message)

    rows = search_products(
        diameter=intent.diameter,
        flute_count=intent.flute_count,
        material_tag=intent.material_tag,
        tool_type=intent.tool_type,
        subtype=intent.subtype,
        brand=intent.brand,
        coating=intent.coating,
        tool_material=intent.tool_material,
        shank_type=intent.shank_type,
        limit=200,
    )

    ranked = rank_candidates(rows, intent, top_k=5)

    candidates = [
        Candidate(
            edp_no=c["edp_no"],
            brand=c.get("brand"),
            series=c.get("series"),
            tool_type=c.get("tool_type"),
            subtype=c.get("subtype"),
            diameter=c.get("diameter"),
            flutes=c.get("flutes"),
            material_tags=c.get("material_tags"),
            coating=c.get("coating"),
            root_category=c.get("root_category"),
        )
        for c, _, _ in ranked
    ]
    scores = [
        ScoredCandidate(edp_no=c["edp_no"], score=s, breakdown=b)
        for c, s, b in ranked
    ]

    raw_answer = _build_answer(intent, ranked)
    extra_safe: set[str] = set()
    for c, _, _ in ranked:
        for key in ("edp_no", "brand", "series"):
            val = c.get(key)
            if val:
                extra_safe.add(str(val))
    cleaned_answer, removed = scrub(raw_answer, extra_safe=extra_safe)

    return RecommendResponse(
        filters=intent,
        candidates=candidates,
        scores=scores,
        answer=cleaned_answer,
        route=route,
        removed_tokens=removed,
    )


# ── /products — full-catalog filter + rank + toggle UI ─────────────────

_TOGGLE_FIELDS = [
    "subtype", "material_tag", "coating", "brand",
    "flute_count", "shank_type", "tool_material", "coolant_hole",
]


def _filters_to_dict(filters: ManualFilters | None, intent: SCRIntent) -> dict:
    """Flatten the intent + optional manual overlay into a plain filter dict
    for search_products / product_count_filtered / get_filter_options."""
    base = {
        "diameter": intent.diameter,
        "flute_count": intent.flute_count,
        "material_tag": intent.material_tag,
        "workpiece_name": intent.workpiece_name,
        "tool_type": intent.tool_type,
        "subtype": intent.subtype,
        "brand": intent.brand,
        "coating": intent.coating,
        "tool_material": intent.tool_material,
        "shank_type": intent.shank_type,
        # P0/P2 fields the LLM may now emit (helix/point/pitch/tpi/tolerance/
        # ball_radius/unit_system/in_stock_only) travel as plain intent keys
        # so search._build_where sees them without special plumbing.
        "helix_angle": getattr(intent, "helix_angle", None),
        "point_angle": getattr(intent, "point_angle", None),
        "thread_pitch": getattr(intent, "thread_pitch", None),
        "thread_tpi": getattr(intent, "thread_tpi", None),
        "diameter_tolerance": getattr(intent, "diameter_tolerance", None),
        "ball_radius": getattr(intent, "ball_radius", None),
        "unit_system": getattr(intent, "unit_system", None),
        "in_stock_only": getattr(intent, "in_stock_only", None),
        # P2 — dimensional ranges the LLM now emits directly. search._build_where
        # already recognizes these keys (via ManualFilters), so exposing them
        # from the SCR side is a pure pass-through.
        "length_of_cut_min": getattr(intent, "length_of_cut_min", None),
        "length_of_cut_max": getattr(intent, "length_of_cut_max", None),
        "overall_length_min": getattr(intent, "overall_length_min", None),
        "overall_length_max": getattr(intent, "overall_length_max", None),
        "shank_diameter_min": getattr(intent, "shank_diameter_min", None),
        "shank_diameter_max": getattr(intent, "shank_diameter_max", None),
    }
    # Exact shank_diameter → ±0.2mm range. Shank dia is a fit tolerance, not
    # a selection target; h5/h6 tolerance classes keep actual values within
    # ±0.015mm of nominal, but catalog rows sometimes round ("8.0" vs "8"),
    # so ±0.2 absorbs that noise without leaking neighbors (6/10 are the
    # next standard stops). Skip if min/max already set.
    shank_exact = getattr(intent, "shank_diameter", None)
    if shank_exact is not None and base.get("shank_diameter_min") is None and base.get("shank_diameter_max") is None:
        base["shank_diameter_min"] = shank_exact - 0.2
        base["shank_diameter_max"] = shank_exact + 0.2
    # cutting_edge_shape is the same MV column as subtype
    # (series_cutting_edge_shape). Treat the SCR split as a rename: if
    # the parser emitted cutting_edge_shape without also filling subtype,
    # surface it through the subtype filter so search._build_where's
    # existing ILIKE clause picks it up.
    ces = getattr(intent, "cutting_edge_shape", None)
    if ces and not base.get("subtype"):
        base["subtype"] = ces
    if filters:
        if filters.workpiece_name is not None:
            base["workpiece_name"] = filters.workpiece_name
        if filters.machining_category is not None:
            base["machining_category"] = filters.machining_category
        if filters.application_shape is not None:
            base["application_shape"] = filters.application_shape
        if filters.country is not None:
            base["country"] = filters.country
        if filters.coolant_hole is not None:
            base["coolant_hole"] = filters.coolant_hole
        for fld in (
            "diameter_min", "diameter_max",
            "overall_length_min", "overall_length_max",
            "length_of_cut_min", "length_of_cut_max",
            "shank_diameter_min", "shank_diameter_max",
            "flute_count_min", "flute_count_max",
            # P0/P1 range filters the UI can set independently of the LLM.
            "helix_angle_min", "helix_angle_max",
            "point_angle_min", "point_angle_max",
            "thread_pitch_min", "thread_pitch_max",
            "tpi_min", "tpi_max",
            "diameter_tolerance",
            "ball_radius_min", "ball_radius_max",
            "neck_diameter_min", "neck_diameter_max",
            "effective_length_min", "effective_length_max",
            "holemaking_coolant_hole", "threading_coolant_hole",
            # P2/P3
            "unit_system", "brand_norm",
            "in_stock_only", "warehouse",
        ):
            v = getattr(filters, fld, None)
            if v is not None:
                base[fld] = v
    return base


# Negation cues that signal "I don't want this brand" — broader than scr.py's
# prompt rule 5 (말고/제외/빼고/아닌/not/except/no) because users paraphrase a
# lot. When a brand canonical appears within ~30 chars of one of these cues
# we treat it as an exclusion even if the LLM extracted it as intent.brand.
_NEG_BRAND_RE = re.compile(
    r"(필요\s*없|빼\s*줘|빼고|제외|원치\s*않|원하지\s*않|"
    r"안\s*써|안\s*해|이미\s*(샀|구매|있)|말고|별로|싫)",
)


# Anaphoric phrases that explicitly point at the prior result set. Only when
# the message contains one of these — OR the new intent adds a field that
# wasn't already carried — do we restrict the next search to the last turn's
# top-products. Without this guard, vague follow-ups ("전체 보기", "의료 기기
# 만들거에요") would permanently cap the candidate pool at the first turn's
# top 50. See regression that surfaced as "후보 53개" in 2026-04-19 QA.
_NARROW_PHRASES = (
    "이 중에서", "이 중", "그 중에서", "그 중", "그중",
    "여기서", "여기 중", "여기에서",
    "저 중에서", "저 중",
    "이거 중", "이중에",
    "in this", "from these",
)


def _force_recommendation_on_followup(intent, message: Optional[str], session) -> None:
    """When the user says "이 중에서 …" / "여기서 …" / "from these …" and the
    session has a non-empty product set from a prior turn, the intent parser
    sometimes misroutes to general_question / domain_knowledge (especially on
    language switches mid-session, e.g. EN turn → KR anaphoric follow-up).

    That misroute makes the endpoint skip search entirely and return 0 results
    with a generic LLM reply — even though the user is clearly pointing at the
    last shown candidates. This guard overrides the parser's decision for that
    specific pattern: carry the previous turn's filters forward as a
    recommendation turn.
    """
    if not message or not session:
        return
    prev_products = getattr(session, "previous_products", None) or []
    if not prev_products:
        return
    lower = message.lower()
    if not any(phrase in lower for phrase in _NARROW_PHRASES):
        return
    current = getattr(intent, "intent", None)
    if current in (None, "", "recommendation"):
        return
    try:
        intent.intent = "recommendation"
    except Exception:
        # Pydantic model immutability — swallow and let downstream default-
        # branch handle it. In practice SCRIntent permits mutation.
        pass


def _should_narrow_by_previous(message: Optional[str], intent, session) -> bool:
    """Decide whether to intersect the new search with session.previous_products.

    Narrow on either:
      1. Explicit anaphor — the user said "이 중에서 …" pointing back at the
         last shown set.
      2. Drill-down intent — the new turn added a filter field that wasn't
         already carried in session.current_filters (e.g., adding flute_count
         after a material-only turn).

    Otherwise (empty intent, vague greeting, topic switch) skip the narrow
    and let the new search stand on its own. current_filters still carry
    forward via carry_forward_intent, so "Inconel" context survives, but the
    50-tool cap from `previous_products` doesn't get inherited silently.
    """
    if message:
        lower = message.lower()
        for phrase in _NARROW_PHRASES:
            if phrase in lower:
                return True
    carried = session.current_filters or {}
    try:
        intent_dict = intent.model_dump()
    except AttributeError:
        return False
    for field, value in intent_dict.items():
        if value is None:
            continue
        if carried.get(field) is None:
            return True
    return False


def _auto_inject_excellent_brand(intent, message: Optional[str]) -> None:
    """Fast-path brand auto-injection (TS phase 4+5 port).

    Condition:
      * intent.intent == 'recommendation' (parser classified as product search)
      * intent.brand is empty (user didn't name a brand)
      * intent has workpiece_name or a non-ferrous/heat-resistant ISO tag
      * at least one EXCELLENT (score ≥ 80) brand exists for that key
      * no excluded brand on the user's message overlaps our pick

    Effect: mutate intent.brand to the top EXCELLENT candidate so the
    downstream search treats it as a hard filter. The /products relax loop
    will back this off if combined with other filters it returns 0 rows —
    so aggressive injection is safe, never a dead-end.

    Non-ferrous gating (N / S) mirrors TS Phase 5: for 'P/M/K/H' the
    EXCELLENT-brand list is broad enough that hard-filtering hurts recall.
    Workpiece-name presence overrides this gate — if the user named a
    specific material we trust them to want the specialist brand."""
    if getattr(intent, "intent", None) != "recommendation":
        return
    if intent.brand:
        return
    wp_name = getattr(intent, "workpiece_name", None)
    if not wp_name:
        return
    # Strict gate — only inject when the workpiece name canonicalizes to a
    # DB key (ALUMINUM / COPPER / TITANIUM) so non-ferrous/heat-resistant
    # specialist brands surface. SUS304 / 탄소강 / 주철 / 고경도강 all
    # return None from canonicalize_workpiece_key and fall through to the
    # generic ranker — avoids over-filtering ferrous queries where the
    # EXCELLENT-brand list isn't precise enough to hard-filter on.
    from affinity import canonicalize_workpiece_key
    if not canonicalize_workpiece_key(wp_name):
        return
    picks = list_excellent_brands(workpiece_name=wp_name, material_tag=None)
    if not picks:
        return
    excluded = set()
    if message:
        excluded = {b.lower() for b in _detect_excluded_brands(message)}
    for brand in picks:
        if brand.lower() in excluded:
            continue
        intent.brand = brand
        return


def _detect_excluded_brands(message: str) -> list[str]:
    """Return DB-canonical brand names the user is trying to exclude. Uses a
    small neighborhood window (30 chars after a brand mention) to confirm the
    negation cue applies to THAT brand rather than being elsewhere in the
    sentence. Noop when the message has no cue or the DB brand list is empty."""
    if not message or not _NEG_BRAND_RE.search(message):
        return []
    brands = _get_brands()
    if not brands:
        return []
    msg_lc = message.lower()
    excluded: list[str] = []
    # Longer canonicals first so "ALU-POWER HPC" claims the match before
    # "ALU-POWER" inside the same mention.
    for b in sorted(brands, key=len, reverse=True):
        if len(b) < 3:
            continue
        b_lc = b.lower()
        pos = msg_lc.find(b_lc)
        if pos < 0:
            continue
        # Context window: 5 chars before the brand through 30 chars after it.
        window = msg_lc[max(0, pos - 5): pos + len(b_lc) + 30]
        if _NEG_BRAND_RE.search(window):
            excluded.append(b)
    return excluded


def _apply_brand_exclusions(session, intent, excluded_brands: list[str]) -> None:
    """Hard-override: drop excluded brands from both intent and session state.
    Without this, `carry_forward_intent` would happily repopulate intent.brand
    from the carried-forward filter after the LLM correctly set it to null."""
    if not excluded_brands:
        return
    excluded_lc = {b.lower() for b in excluded_brands}
    current_intent_brand = getattr(intent, "brand", None)
    if current_intent_brand and current_intent_brand.lower() in excluded_lc:
        intent.brand = None
    carried = session.current_filters.get("brand")
    if carried and carried.lower() in excluded_lc:
        del session.current_filters["brand"]


def _empty_products_response(session_id: str | None = None) -> ProductsResponse:
    """Graceful 200 for callers that hit /products with neither message nor
    filters — e.g. a fresh page mount before the user has said anything.
    Beats the old 400 which surfaced as a scary "Python API error" banner."""
    session = session_get_or_create(session_id)
    return ProductsResponse(
        text="검색 조건이 없습니다. 메시지를 입력하거나 필터를 선택해 주세요.",
        chips=[],
        products=[],
        allProducts=[],
        appliedFilters={},
        totalCount=0,
        route="empty",
        availableFilters=None,
        session_id=session.session_id,
        broadened=False,
        sources=[],
        score_breakdown_max=SCORE_BREAKDOWN_MAX,
    )


@app.post("/products", response_model=ProductsResponse)
async def products(req: ProductsRequest) -> ProductsResponse:
    if not req.message and not req.filters:
        return _empty_products_response(req.session_id)

    # 0. Session handling — carry the prior filter context forward so
    #    "이 중에서 4날" on turn 2 still remembers material+diameter.
    session = session_get_or_create(req.session_id)

    # RAG knowledge fetched alongside SCR below — kept in outer scope so
    # the recommendation branch reuses it instead of refetching.
    knowledge: list[dict] = []

    # 1. Resolve intent — manual filters win, optional LLM fills the gaps.
    #    When a message is present, fan out parse_intent + search_knowledge in
    #    parallel so the ~2-3s SCR call and the ~1s RAG lookup overlap.
    if req.filters:
        intent = SCRIntent(
            diameter=req.filters.diameter,
            material_tag=req.filters.material_tag,
            subtype=req.filters.subtype,
            flute_count=req.filters.flute_count,
            coating=req.filters.coating,
            brand=req.filters.brand,
            tool_type=req.filters.machining_category,
            tool_material=req.filters.tool_material,
            shank_type=req.filters.shank_type,
        )
        route = "manual"
        if req.message:
            # Pass session so parse_intent can (a) resolve demonstratives via
            # the last 2 user turns and (b) pick adaptive few-shot exemplars
            # keyed on the multi-turn signature rather than the bare query.
            llm_task = asyncio.to_thread(parse_intent, req.message, session)
            rag_task = asyncio.to_thread(search_knowledge, req.message, 3)
            llm_res, rag_res = await asyncio.gather(llm_task, rag_task, return_exceptions=True)
            if not isinstance(llm_res, BaseException):
                for field in intent.__class__.model_fields:
                    if getattr(intent, field) is None and getattr(llm_res, field) is not None:
                        setattr(intent, field, getattr(llm_res, field))
                route = "manual+llm"
            if not isinstance(rag_res, BaseException):
                knowledge = rag_res or []
    elif req.message:
        intent_task = asyncio.to_thread(parse_intent, req.message, session)
        rag_task = asyncio.to_thread(search_knowledge, req.message, 3)
        intent_res, rag_res = await asyncio.gather(intent_task, rag_task, return_exceptions=True)
        if isinstance(intent_res, BaseException):
            # SCR timeout/failure: degrade gracefully with an empty intent so
            # the user gets a response instead of a 502. carry_forward will
            # still pull session context; 0 results route to clarification.
            intent = SCRIntent()
            route = "llm_fallback"
        else:
            intent = intent_res
            route = "llm"
        knowledge = [] if isinstance(rag_res, BaseException) else (rag_res or [])
    else:
        return _empty_products_response(req.session_id)

    # Process exclusions BEFORE carry_forward, so that when the user says
    # "JET-POWER 필요 없어요" we (a) drop it from session state and (b) don't
    # let carry_forward re-populate intent.brand from the stale carried value.
    if req.message:
        _apply_brand_exclusions(session, intent, _detect_excluded_brands(req.message))

    # Fill unset intent fields from the session's carried context so
    # abbreviated follow-ups still know the material/diameter from turn 1.
    carry_forward_intent(session, intent)

    # Anaphoric follow-up override — "이 중에서 …" after a result-bearing turn
    # is always a recommendation narrow, even when the parser misroutes the
    # message to general/domain (common on mid-session language switches).
    _force_recommendation_on_followup(intent, req.message, session)

    # Brand affinity auto-inject (TS Phase 4+5 port). When the user specified
    # a material (구리/알루미늄/티타늄 or ISO) but NO brand, surface the
    # EXCELLENT-tier brand for that material as a hard filter — else a
    # commodity brand can outrank the specialist one on diameter/flute match
    # alone. Non-ferrous-only so we don't over-constrain steel queries where
    # the EXCELLENT-brand list is broader. Skipped when the user negated a
    # brand elsewhere in the message (that's a user choice, not ours to
    # override). Relax loop below will back it off if the injected brand
    # returns 0 hits against the user's other filters.
    _auto_inject_excellent_brand(intent, req.message)

    # Source-attribution log. Each stage appends a record the UI can show.
    sources: list[SourceAttribution] = [
        SourceAttribution(
            type="llm_reasoning" if route.startswith("llm") else "internal_db",
            detail=f"SCR intent 파싱 ({route})",
            confidence="high",
        )
    ]

    # 1.5. Intent-based routing. general_question / domain_knowledge queries
    # have nothing to search against — the LLM parser classified them as
    # off-catalog, so we skip the DB hit and go straight to the chat layer
    # (with RAG knowledge injected for domain_knowledge). This keeps
    # "0.1+0.2==0.3?" from dragging the whole filter pipeline along and stops
    # "떨림이 심해 ㅠ" from surfacing arbitrary products just because the user
    # opened with it.
    intent_value = (getattr(intent, "intent", None) or "recommendation")
    if intent_value in ("general_question", "domain_knowledge"):
        # Knowledge was already fetched in parallel with parse_intent above.
        # General-question prompts deliberately drop it so off-topic CoT
        # doesn't get derailed by unrelated cutting tips.
        effective_knowledge = knowledge if intent_value == "domain_knowledge" else []
        answer_text = ""
        chips: list[str] = []
        chat_result_skip: dict = {}
        if req.message:
            try:
                chat_result_skip = await asyncio.to_thread(
                    generate_response,
                    req.message, intent, [], effective_knowledge,
                    0, None, None, None, None, None,
                    session,
                    req.filters.model_dump() if req.filters else None,
                )
                answer_text = chat_result_skip.get("answer") or ""
                chips = chat_result_skip.get("chips") or []
            except Exception:
                answer_text = (
                    "도메인 지식을 찾지 못했습니다."
                    if intent_value == "domain_knowledge"
                    else "죄송합니다, 해당 질문에 답변하기 어렵습니다."
                )
        sources.append(SourceAttribution(
            type="domain_knowledge" if intent_value == "domain_knowledge" else "llm_reasoning",
            detail=(
                f"도메인 지식 {len(effective_knowledge)}건 + CoT 응답"
                if intent_value == "domain_knowledge"
                else "카탈로그 외 질문 — CoT 응답"
            ),
            confidence="medium",
        ))
        intent_dict_skip = {
            "intent": intent.intent,
            "diameter": intent.diameter,
            "flute_count": intent.flute_count,
            "material_tag": intent.material_tag,
            "workpiece_name": intent.workpiece_name,
            "subtype": intent.subtype,
            "brand": intent.brand,
            "coating": intent.coating,
            "tool_type": intent.tool_type,
            "tool_material": intent.tool_material,
            "shank_type": intent.shank_type,
        }
        add_turn(
            session,
            role="user",
            message=req.message or "(manual filters)",
            intent=intent_dict_skip,
            products=[],
        )
        # Persist the assistant turn so build_conversation_memory has both
        # sides of this exchange when the next request arrives.
        if answer_text:
            add_turn(
                session,
                role="assistant",
                message=answer_text,
                intent=intent_dict_skip,
                products=[],
                total_count=0,
                answer_preview=answer_text,
            )
        return ProductsResponse(
            text=answer_text,
            chips=chips,
            products=[],
            allProducts=[],
            appliedFilters={},
            totalCount=0,
            route=intent_value,
            availableFilters=None,
            session_id=session.session_id,
            broadened=False,
            sources=sources,
            cot_level=chat_result_skip.get("cot_level"),
            verified=chat_result_skip.get("verified"),
            score_breakdown_max=SCORE_BREAKDOWN_MAX,
        )

    # 2. Fetch (whole candidate set). Uses the in-memory index so /products
    #    skips the DB on every request. Closure lets the 0-hit relax loop
    #    rebuild the filter dict from the mutated intent cheaply.
    def _build_filters() -> dict:
        base: dict = {
            "diameter": intent.diameter,
            "flute_count": intent.flute_count,
            "material_tag": intent.material_tag,
            "tool_type": intent.tool_type,
            "subtype": intent.subtype,
            "brand": intent.brand,
            "coating": intent.coating,
            "tool_material": intent.tool_material,
            "shank_type": intent.shank_type,
            # P0/P2 intent keys the LLM can now emit.
            "helix_angle": getattr(intent, "helix_angle", None),
            "point_angle": getattr(intent, "point_angle", None),
            "thread_pitch": getattr(intent, "thread_pitch", None),
            "thread_tpi": getattr(intent, "thread_tpi", None),
            "diameter_tolerance": getattr(intent, "diameter_tolerance", None),
            "ball_radius": getattr(intent, "ball_radius", None),
            "unit_system": getattr(intent, "unit_system", None),
            "in_stock_only": getattr(intent, "in_stock_only", None),
        }
        if req.filters:
            for fld in (
                "machining_category", "application_shape", "country", "coolant_hole",
                "diameter_min", "diameter_max",
                "overall_length_min", "overall_length_max",
                "length_of_cut_min", "length_of_cut_max",
                "shank_diameter_min", "shank_diameter_max",
                "flute_count_min", "flute_count_max",
                # P0/P1 UI ranges.
                "helix_angle_min", "helix_angle_max",
                "point_angle_min", "point_angle_max",
                "thread_pitch_min", "thread_pitch_max",
                "tpi_min", "tpi_max",
                "diameter_tolerance",
                "ball_radius_min", "ball_radius_max",
                "neck_diameter_min", "neck_diameter_max",
                "effective_length_min", "effective_length_max",
                "holemaking_coolant_hole", "threading_coolant_hole",
                "unit_system", "brand_norm",
                "in_stock_only", "warehouse",
            ):
                v = getattr(req.filters, fld, None)
                if v is not None:
                    base[fld] = v
        return base

    def _run_search() -> list[dict]:
        filt = _build_filters()
        # Inventory gates (in_stock_only / warehouse) can't be satisfied by
        # the in-memory index — no stock rows on it. Route those queries to
        # the DB path so EXISTS subqueries against inventory_summary and
        # inventory_snapshot fire.
        if needs_db_path(filt):
            return search_products(
                **{k: v for k, v in filt.items()
                   if k in search_products.__code__.co_varnames},
                limit=125_000,
            )
        return search_products_fast(filt, limit=125_000)

    rows = _run_search()
    sources.append(SourceAttribution(
        type="internal_db",
        detail=f"product_recommendation_mv 인메모리 index에서 {len(rows)}건 검색",
        confidence="high",
    ))

    # 2.2 Follow-up narrow: restrict the new search to the last turn's top
    # products — but ONLY when the user signaled a drill-down (anaphoric
    # phrase or an added-field intent). Vague/broad follow-ups skip this
    # and operate on the full catalog; see _should_narrow_by_previous for
    # the guard rules. Empty narrow still falls through with broadened=True.
    broadened = False
    if (
        session.previous_products
        and rows
        and _should_narrow_by_previous(req.message, intent, session)
    ):
        prev_set = set(session.previous_products)
        narrowed = [r for r in rows if r.get("edp_no") in prev_set]
        if narrowed:
            rows = narrowed
            route = f"{route}+narrowed"
        else:
            broadened = True

    # 2.5 Zero-hit relax: progressively null out less-essential fields until
    # something comes back. Runs for both NL queries and manual filter forms
    # — a manual over-constraint (e.g. Inconel + 3-flute + Chamfer + DLC)
    # returning nothing is as useless as a mis-parsed intent.
    relaxed_fields: list[str] = []
    if len(rows) == 0:
        _RELAX_ORDER = [
            "coating", "shank_type", "tool_material",
            "flute_count", "subtype", "brand",
        ]
        for field in _RELAX_ORDER:
            if getattr(intent, field, None) is None:
                continue
            setattr(intent, field, None)
            relaxed_fields.append(field)
            rows = _run_search()
            if rows:
                break

    if relaxed_fields:
        sources.append(SourceAttribution(
            type="llm_reasoning",
            detail=f"조건 완화: {relaxed_fields} 제거 후 재검색",
            confidence="medium",
        ))
    if broadened:
        sources.append(SourceAttribution(
            type="internal_db",
            detail="이전 턴 결과와 호환 불가 → 전역 카탈로그로 확장",
            confidence="medium",
        ))

    ranked = rank_candidates(rows, intent, top_k=len(rows) or 1)

    # 3. Build response product lists. Cutting conditions are pulled in a
    #    single bulk call so each ProductCard ships with its recommended
    #    Vc/Fz/RPM rows without the UI needing a second round-trip.
    top10_raw = [c for c, _, _ in ranked[:10]]
    try:
        conditions_map = get_conditions_for_products(top10_raw, iso=intent.material_tag)
    except Exception:
        conditions_map = {}
    if any(edp in conditions_map for edp in [str(c.get("edp_no") or "") for c in top10_raw]):
        sources.append(SourceAttribution(
            type="cutting_conditions",
            detail="merged_all_fixed.csv (18,908건 절삭조건 DB)",
            confidence="high",
        ))

    top10: list[ProductCard] = []
    # `chat_result` is generated further down (after the CoT round-trip),
    # so rationale gets patched post-hoc below. matched_fields can be set
    # inline since the scorer has everything it needs.
    for c, s, b in ranked[:10]:
        edp = str(c.get("edp_no") or "")
        stock_qty = _coerce_int(c.get("total_stock"))
        top10.append(ProductCard(
            edp_no=c["edp_no"],
            brand=c.get("brand"),
            series=c.get("series"),
            tool_type=c.get("tool_type"),
            subtype=c.get("subtype"),
            diameter=c.get("diameter"),
            flutes=c.get("flutes"),
            coating=c.get("coating"),
            material_tags=c.get("material_tags"),
            description=c.get("series_description"),
            feature=c.get("series_feature"),
            oal=c.get("milling_overall_length"),
            loc=c.get("milling_length_of_cut"),
            helix_angle=c.get("milling_helix_angle"),
            coolant_hole=c.get("milling_coolant_hole"),
            shank_type=c.get("search_shank_type"),
            cutting_conditions=conditions_map.get(edp) or None,
            total_stock=stock_qty,
            warehouse_count=_coerce_int(c.get("warehouse_count")),
            stock_status=_derive_stock_status(stock_qty),
            matched_fields=_derive_matched_fields(c, intent) or None,
            material_rating=get_affinity_rating(
                c.get("brand"),
                workpiece_name=getattr(intent, "workpiece_name", None),
                material_tag=getattr(intent, "material_tag", None),
            ),
            score=s,
            score_breakdown=b,
        ))

    all_prods: list[ProductSummary] = [
        ProductSummary(
            edp_no=c["edp_no"],
            brand=c.get("brand"),
            series=c.get("series"),
            diameter=c.get("diameter"),
            flutes=c.get("flutes"),
            coating=c.get("coating"),
            stock_status=_derive_stock_status(_coerce_int(c.get("total_stock"))),
            material_rating=get_affinity_rating(
                c.get("brand"),
                workpiece_name=getattr(intent, "workpiece_name", None),
                material_tag=getattr(intent, "material_tag", None),
            ),
            score=s,
        )
        for c, s, _ in ranked
    ]

    # 4. Live-toggle facets — in-memory GROUP BY, no DB per-field round-trip.
    filter_dict = _filters_to_dict(req.filters, intent)
    available: dict[str, list[FilterOption]] = {}
    for f in _TOGGLE_FIELDS:
        try:
            opts = get_filter_options_fast(f, filter_dict)
        except Exception:
            opts = []
        if opts:
            available[f] = [FilterOption(value=o["value"], count=o["count"]) for o in opts]

    # 4.5 Pre-guidance blocks — compute BEFORE the CoT so the prompt can
    # quote concrete aggregates (principles 12/13) instead of hedging.
    # series_chips : 반복되는 시리즈의 직경/날수 범위 (series_profile_mv)
    # stock_summary: 후보 중 즉시 출고 가능 비율
    # cutting_range: material_tag + 직경 기준 Vc/fz/RPM 분포 (YG-1 카탈로그)
    series_chips = _series_profile_chips(ranked)
    stock_summary = _stock_summary_from_ranked(ranked)
    try:
        cutting_range = get_cutting_range_for_material(
            getattr(intent, "material_tag", None),
            getattr(intent, "diameter", None),
        )
    except Exception:
        cutting_range = None

    if stock_summary:
        sources.append(SourceAttribution(
            type="internal_db",
            detail=f"product_inventory_summary_mv: {stock_summary['in_stock']}/{stock_summary['total']}건 재고 ({stock_summary['pct']}%)",
            confidence="high",
        ))
    if cutting_range and cutting_range.get("row_count"):
        sources.append(SourceAttribution(
            type="cutting_conditions",
            detail=f"ISO {intent.material_tag} 기준 조건표 {cutting_range['row_count']}행 집계",
            confidence="high",
        ))

    # 5. Answer generation.
    #    - Natural-language message → RAG lookup + GPT-5.4-mini (CoT).
    #    - Manual-only request → deterministic template (no LLM round-trip).
    # Hoisted above the branch so the manual-only path (no req.message) still
    # has them defined when the response uses cot_level / verified / chips.
    chips: list[str] = []
    chat_result: dict = {}
    if req.message:
        # `knowledge` was already fetched in parallel with parse_intent at the
        # top of the handler — reuse it here instead of issuing a second call.
        for k in knowledge:
            k_type = k.get("type") or ""
            data = k.get("data") or {}
            if k_type == "web_search":
                sources.append(SourceAttribution(
                    type="web_search",
                    detail=f"Tavily: {data.get('title','')[:70]} ({data.get('url','')})",
                    confidence="medium",
                ))
            else:
                # Pull a human-readable label from whichever title-ish field
                # the entry exposes (troubleshooting=symptom, industry=…etc.)
                label = (
                    data.get("symptom") or data.get("material") or data.get("operation")
                    or data.get("coating_name") or data.get("industry") or data.get("question")
                    or data.get("series") or ""
                )
                sources.append(SourceAttribution(
                    type="domain_knowledge",
                    detail=f"{k_type}: {str(label)[:60]}",
                    confidence="high",
                ))
        # Clarification chips — DB-backed scan of the most-differentiating
        # unspecified fields under the current filters. Runs only when the
        # candidate pool is big enough that narrowing is actually useful.
        try:
            clarify_payload = await asyncio.to_thread(suggest_clarifying_chips, filter_dict)
        except Exception:
            clarify_payload = None
        try:
            chat_result = await asyncio.to_thread(
                generate_response,
                req.message,
                intent,
                [c for c, _, _ in ranked[:10]],
                knowledge,
                len(ranked),
                relaxed_fields or None,
                available or None,
                clarify_payload,
                stock_summary,
                cutting_range,
                session,
                req.filters.model_dump() if req.filters else None,
            )
            raw_answer = chat_result.get("answer") or _build_answer(intent, ranked, cutting_range)
            chips = chat_result.get("chips") or []
        except Exception:
            raw_answer = _build_answer(intent, ranked, cutting_range)
        # Patch the #1 card's rationale post-CoT. Kept here (not inside the
        # try/except) so Light/Strong paths both feed the xAI panel.
        if top10 and isinstance(chat_result, dict):
            top10[0].rationale = chat_result.get("rationale") or top10[0].rationale
        # CoT attribution — note if web search contributed.
        has_web = any(s.type == "web_search" for s in sources)
        sources.append(SourceAttribution(
            type="web_search+llm" if has_web else "llm_reasoning",
            detail="웹 검색 결과 + GPT-5.4-mini 추론" if has_web
            else "GPT-5.4-mini CoT 추론" + (" (도메인 지식 주입)" if knowledge else ""),
            confidence="medium" if has_web else ("high" if knowledge else "medium"),
        ))
    else:
        raw_answer = _build_answer(intent, ranked, cutting_range)

    extra_safe: set[str] = set()
    for c, _, _ in ranked[:10]:
        for key in ("edp_no", "brand", "series"):
            val = c.get(key)
            if val:
                extra_safe.add(str(val))
    cleaned_answer, _removed = scrub(raw_answer, extra_safe=extra_safe)

    # Persist the turn so the next follow-up can narrow/carry state.
    edp_list = [c.get("edp_no") for c, _, _ in ranked[:50] if c.get("edp_no")]
    intent_dict = {
        "intent": intent.intent,
        "diameter": intent.diameter,
        "flute_count": intent.flute_count,
        "material_tag": intent.material_tag,
        "workpiece_name": intent.workpiece_name,
        "subtype": intent.subtype,
        "brand": intent.brand,
        "coating": intent.coating,
        "tool_type": intent.tool_type,
        "tool_material": intent.tool_material,
        "shank_type": intent.shank_type,
    }
    add_turn(
        session,
        role="user",
        message=req.message or "(manual filters)",
        intent=intent_dict,
        products=edp_list,
    )
    # Persist the assistant turn too so build_conversation_memory can render
    # both sides of this exchange ([대화 히스토리]) on the next request.
    if cleaned_answer:
        add_turn(
            session,
            role="assistant",
            message=cleaned_answer,
            intent=intent_dict,
            products=edp_list,
            total_count=len(ranked),
            answer_preview=cleaned_answer,
            top_products=[c for c, _, _ in ranked[:3]],
        )

    # Prepend series-profile chips so the UI surfaces "이 시리즈는 N-Mmm,
    # 2/3/4날" as the first hint set, before the LLM's clarification chips.
    # De-dup against whatever the LLM emitted to avoid double-chips on the
    # same series label.
    if series_chips:
        existing = set(chips)
        chips = series_chips + [c for c in chips if c not in series_chips and c not in existing]

    return ProductsResponse(
        text=cleaned_answer,
        chips=chips,
        products=top10,
        allProducts=all_prods,
        appliedFilters={k: v for k, v in filter_dict.items() if v is not None},
        totalCount=len(ranked),
        route=route,
        availableFilters=available or None,
        session_id=session.session_id,
        broadened=broadened,
        sources=sources,
        stock_summary=stock_summary,
        cutting_range=cutting_range,
        cot_level=(chat_result.get("cot_level") if isinstance(chat_result, dict) else None),
        verified=(chat_result.get("verified") if isinstance(chat_result, dict) else None),
        score_breakdown_max=SCORE_BREAKDOWN_MAX,
    )


@app.post("/products/page", response_model=ProductsPageResponse)
def products_page(req: ProductsPageRequest) -> ProductsPageResponse:
    """Candidate-panel pagination. Replays the session's last intent through
    search + rank, slices [page*pageSize..+pageSize], and returns detailed
    ProductCards for that window. No LLM, no chat — pure re-rank + slice so
    "다음 페이지" stays sub-second.

    Session must already exist (minted by a prior /products or /products/stream
    call); otherwise 404 — pagination with no context has no intent to replay.
    """
    from session import _SESSIONS  # local import to avoid top-level coupling

    with threading_lock():
        session = _SESSIONS.get(req.session_id)
    if session is None:
        raise HTTPException(status_code=404, detail=f"session '{req.session_id}' not found or expired")

    page = max(0, int(req.page))
    page_size = max(1, min(int(req.pageSize), 100))

    filters = dict(session.current_filters)
    rows = search_products_fast(filters, limit=125_000)

    # No narrow-by-previous-products here — current_filters already encodes
    # whatever the last turn narrowed down to (carry_forward_intent merges
    # each turn's intent). Narrowing again by previous_products would cap
    # pagination at the top-50 from the last turn, so users clicking "다음
    # 20개" could only ever see 50 items even when the universe is 78k.

    ranked = rank_candidates(rows, SCRIntent(**{
        k: v for k, v in filters.items() if k in SCRIntent.model_fields
    }), top_k=len(rows) or 1)

    total = len(ranked)
    total_pages = max((total + page_size - 1) // page_size, 1)
    start = page * page_size
    end = start + page_size
    slice_ = ranked[start:end]

    slice_raw = [c for c, _, _ in slice_]
    try:
        conditions_map = get_conditions_for_products(
            slice_raw, iso=filters.get("material_tag"),
        )
    except Exception:
        conditions_map = {}

    products: list[ProductCard] = []
    for c, s, b in slice_:
        edp = str(c.get("edp_no") or "")
        stock_qty = _coerce_int(c.get("total_stock"))
        products.append(ProductCard(
            edp_no=c["edp_no"],
            brand=c.get("brand"),
            series=c.get("series"),
            tool_type=c.get("tool_type"),
            subtype=c.get("subtype"),
            diameter=c.get("diameter"),
            flutes=c.get("flutes"),
            coating=c.get("coating"),
            material_tags=c.get("material_tags"),
            description=c.get("series_description"),
            feature=c.get("series_feature"),
            oal=c.get("milling_overall_length"),
            loc=c.get("milling_length_of_cut"),
            helix_angle=c.get("milling_helix_angle"),
            coolant_hole=c.get("milling_coolant_hole"),
            shank_type=c.get("search_shank_type"),
            cutting_conditions=conditions_map.get(edp) or None,
            total_stock=stock_qty,
            warehouse_count=_coerce_int(c.get("warehouse_count")),
            stock_status=_derive_stock_status(stock_qty),
            matched_fields=_derive_matched_fields(c, intent) or None,
            material_rating=get_affinity_rating(
                c.get("brand"),
                workpiece_name=getattr(intent, "workpiece_name", None),
                material_tag=getattr(intent, "material_tag", None),
            ),
            score=s,
            score_breakdown=b,
        ))

    return ProductsPageResponse(
        products=products,
        totalCount=total,
        page=page,
        pageSize=page_size,
        totalPages=total_pages,
        session_id=session.session_id,
        appliedFilters={k: v for k, v in filters.items() if v is not None},
    )


def threading_lock():
    """Re-export session._LOCK as a context manager. Kept local so the lock
    plumbing doesn't leak into main's public surface."""
    from session import _LOCK
    return _LOCK


@app.post("/products/stream")
async def products_stream(req: ProductsRequest):
    """SSE variant of /products — streams three progress events so the
    client can paint UI before the LLM answer finishes:
      `filters`  (≤ 2s)  — applied intent dict
      `products` (+1 ms) — top-10 cards + total count
      `answer`   (+2–4 s) — CoT text + chips
      `done`     terminator
    /products (sync) is unchanged; reuse the same logic under to_thread so
    the event loop doesn't block on LLM calls."""
    if not req.message and not req.filters:
        # Mirror /products behavior: graceful empty state over 400. The SSE
        # variant has no single JSON return, so we emit one synthetic frame
        # and close. Clients that track events still see a clean stream.
        empty = _empty_products_response(req.session_id)

        async def _empty_stream():
            yield f"event: answer\ndata: {_json.dumps({'answer': empty.text, 'chips': [], 'reasoning': '', 'refined_filters': None}, ensure_ascii=False)}\n\n"
            yield "event: done\ndata: {}\n\n"

        return StreamingResponse(_empty_stream(), media_type="text/event-stream")

    async def generate():
        session = session_get_or_create(req.session_id)

        # Knowledge comes back from a parallel RAG lookup — hoisted above the
        # intent-routing block so recommendation/domain branches share it.
        knowledge: list[dict] = []

        # 1. intent + RAG in parallel — overlap the ~2-3s SCR with the ~1s RAG.
        if req.filters:
            intent = SCRIntent(
                diameter=req.filters.diameter,
                material_tag=req.filters.material_tag,
                workpiece_name=req.filters.workpiece_name,
                subtype=req.filters.subtype,
                flute_count=req.filters.flute_count,
                coating=req.filters.coating,
                brand=req.filters.brand,
                tool_type=req.filters.machining_category,
                tool_material=req.filters.tool_material,
                shank_type=req.filters.shank_type,
            )
            route = "manual"
            if req.message:
                llm_task = asyncio.to_thread(parse_intent, req.message, session)
                rag_task = asyncio.to_thread(search_knowledge, req.message, 3)
                llm_res, rag_res = await asyncio.gather(llm_task, rag_task, return_exceptions=True)
                if not isinstance(llm_res, BaseException):
                    for field in intent.__class__.model_fields:
                        if getattr(intent, field) is None and getattr(llm_res, field) is not None:
                            setattr(intent, field, getattr(llm_res, field))
                    route = "manual+llm"
                if not isinstance(rag_res, BaseException):
                    knowledge = rag_res or []
        else:
            intent_task = asyncio.to_thread(parse_intent, req.message or "", session)
            rag_task = asyncio.to_thread(search_knowledge, req.message or "", 3)
            intent_res, rag_res = await asyncio.gather(intent_task, rag_task, return_exceptions=True)
            if isinstance(intent_res, BaseException):
                # SCR timeout/failure: degrade to empty intent rather than
                # retry (the retry in the old code just hung a second time).
                intent = SCRIntent()
            else:
                intent = intent_res
            knowledge = [] if isinstance(rag_res, BaseException) else (rag_res or [])
            route = "llm"

        # Mirror /products: handle brand exclusions before carry_forward so
        # the carried filter doesn't override a fresh "X 필요 없어요".
        if req.message:
            _apply_brand_exclusions(session, intent, _detect_excluded_brands(req.message))

        carry_forward_intent(session, intent)

        # Anaphoric follow-up override — see sync /products for rationale.
        _force_recommendation_on_followup(intent, req.message, session)

        # Same auto-inject as sync /products — stream path must emit the same
        # EXCELLENT brand for 구리/알루미늄/티타늄 queries so the UI sees
        # CRX-S / ALU-CUT / TitaNox-Power in the filters event, not null.
        _auto_inject_excellent_brand(intent, req.message)

        yield f"event: filters\ndata: {_json.dumps({'filters': intent.model_dump(), 'route': route, 'session_id': session.session_id}, ensure_ascii=False)}\n\n"

        # Intent-based routing — general_question / domain_knowledge skip the
        # search + rank path entirely. The client should key UI off
        # filters.filters.intent from the event above. See /products sync
        # endpoint for rationale.
        intent_value = (getattr(intent, "intent", None) or "recommendation")
        if intent_value in ("general_question", "domain_knowledge"):
            # Knowledge was already fetched in parallel with parse_intent above.
            # Drop it for general_question so off-topic CoT stays clean.
            effective_knowledge = knowledge if intent_value == "domain_knowledge" else []
            if req.message:
                try:
                    chat_result = await asyncio.to_thread(
                        generate_response,
                        req.message, intent, [], effective_knowledge,
                        0, None, None, None, None, None,
                        session,
                        req.filters.model_dump() if req.filters else None,
                    )
                except Exception:
                    chat_result = {
                        "answer": (
                            "도메인 지식을 찾지 못했습니다."
                            if intent_value == "domain_knowledge"
                            else "죄송합니다, 해당 질문에 답변하기 어렵습니다."
                        ),
                        "chips": [],
                        "reasoning": "",
                        "refined_filters": None,
                    }
            else:
                chat_result = {"answer": "", "chips": [], "reasoning": "", "refined_filters": None}
            yield f"event: answer\ndata: {_json.dumps(chat_result, ensure_ascii=False)}\n\n"
            add_turn(
                session, role="user",
                message=req.message or "(manual filters)",
                intent=intent.model_dump(),
                products=[],
            )
            ans = (chat_result or {}).get("answer") or ""
            if ans:
                add_turn(
                    session, role="assistant",
                    message=ans,
                    intent=intent.model_dump(),
                    products=[],
                    total_count=0,
                    answer_preview=ans,
                )
            yield "event: done\ndata: {}\n\n"
            return

        # 2. search + rank
        def _search_and_rank():
            filters = {
                "diameter": intent.diameter,
                "flute_count": intent.flute_count,
                "material_tag": intent.material_tag,
                "tool_type": intent.tool_type,
                "subtype": intent.subtype,
                "brand": intent.brand,
                "coating": intent.coating,
                "tool_material": intent.tool_material,
                "shank_type": intent.shank_type,
                "helix_angle": getattr(intent, "helix_angle", None),
                "point_angle": getattr(intent, "point_angle", None),
                "thread_pitch": getattr(intent, "thread_pitch", None),
                "thread_tpi": getattr(intent, "thread_tpi", None),
                "diameter_tolerance": getattr(intent, "diameter_tolerance", None),
                "ball_radius": getattr(intent, "ball_radius", None),
                "unit_system": getattr(intent, "unit_system", None),
                "in_stock_only": getattr(intent, "in_stock_only", None),
            }
            if req.filters:
                for fld in (
                    "machining_category", "application_shape", "country", "coolant_hole",
                    "diameter_min", "diameter_max",
                    "overall_length_min", "overall_length_max",
                    "length_of_cut_min", "length_of_cut_max",
                    "shank_diameter_min", "shank_diameter_max",
                    "flute_count_min", "flute_count_max",
                    "helix_angle_min", "helix_angle_max",
                    "point_angle_min", "point_angle_max",
                    "thread_pitch_min", "thread_pitch_max",
                    "tpi_min", "tpi_max",
                    "diameter_tolerance",
                    "ball_radius_min", "ball_radius_max",
                    "neck_diameter_min", "neck_diameter_max",
                    "effective_length_min", "effective_length_max",
                    "holemaking_coolant_hole", "threading_coolant_hole",
                    "unit_system", "brand_norm",
                    "in_stock_only", "warehouse",
                ):
                    v = getattr(req.filters, fld, None)
                    if v is not None:
                        filters[fld] = v
            if needs_db_path(filters):
                rows = search_products(
                    **{k: v for k, v in filters.items()
                       if k in search_products.__code__.co_varnames},
                    limit=125_000,
                )
            else:
                rows = search_products_fast(filters, limit=125_000)
            # Follow-up narrow + relax — only when the user signaled a
            # drill-down (anaphor or added-field intent). See the sync
            # /products endpoint for the same guard.
            broadened_local = False
            if (
                session.previous_products
                and rows
                and _should_narrow_by_previous(req.message, intent, session)
            ):
                prev_set = set(session.previous_products)
                narrowed = [r for r in rows if r.get("edp_no") in prev_set]
                if narrowed:
                    rows = narrowed
                else:
                    broadened_local = True
            return rows, broadened_local

        rows, broadened = await asyncio.to_thread(_search_and_rank)
        ranked = await asyncio.to_thread(rank_candidates, rows, intent, len(rows) or 1)

        # Pre-guidance blocks — same A/B/C set the sync /products endpoint
        # builds. Computed here so the products event ships them too and the
        # CoT prompt can quote concrete aggregates (principles 12/13).
        series_chips_stream = _series_profile_chips(ranked)
        stock_summary_stream = _stock_summary_from_ranked(ranked)
        try:
            cutting_range_stream = get_cutting_range_for_material(
                getattr(intent, "material_tag", None),
                getattr(intent, "diameter", None),
            )
        except Exception:
            cutting_range_stream = None

        top10_payload = []
        for c, s, b in ranked[:10]:
            stock_qty_stream = _coerce_int(c.get("total_stock"))
            top10_payload.append({
                "edp_no": c.get("edp_no"),
                "brand": c.get("brand"),
                "series": c.get("series"),
                "tool_type": c.get("tool_type"),
                "subtype": c.get("subtype"),
                "diameter": c.get("diameter"),
                "flutes": c.get("flutes"),
                "coating": c.get("coating"),
                "material_tags": c.get("material_tags"),
                "description": c.get("series_description"),
                "feature": c.get("series_feature"),
                "oal": c.get("milling_overall_length"),
                "loc": c.get("milling_length_of_cut"),
                "helix_angle": c.get("milling_helix_angle"),
                "coolant_hole": c.get("milling_coolant_hole"),
                "shank_type": c.get("search_shank_type"),
                "total_stock": stock_qty_stream,
                "warehouse_count": _coerce_int(c.get("warehouse_count")),
                "stock_status": _derive_stock_status(stock_qty_stream),
                "matched_fields": _derive_matched_fields(c, intent) or None,
                "material_rating": get_affinity_rating(
                    c.get("brand"),
                    workpiece_name=getattr(intent, "workpiece_name", None),
                    material_tag=getattr(intent, "material_tag", None),
                ),
                "score": s,
                "score_breakdown": b,
            })
        yield (
            f"event: products\ndata: "
            f"{_json.dumps({'count': len(ranked), 'top10': top10_payload, 'broadened': broadened, 'series_chips': series_chips_stream, 'stock_summary': stock_summary_stream, 'cutting_range': cutting_range_stream, 'score_breakdown_max': SCORE_BREAKDOWN_MAX}, ensure_ascii=False)}\n\n"
        )

        # 3. CoT answer — `knowledge` is already populated from the parallel
        # RAG fetch at the top of this coroutine. Strong-CoT queries relay
        # intermediate `thinking` / `partial_answer` events before the
        # final `answer`; Light stays single-shot.
        chat_result: dict = {
            "answer": _build_answer(intent, ranked),
            "chips": [],
            "reasoning": "",
            "refined_filters": None,
        }
        if req.message:
            stream_filter_dict = _filters_to_dict(req.filters, intent)
            try:
                clarify_payload_stream = await asyncio.to_thread(
                    suggest_clarifying_chips, stream_filter_dict,
                )
            except Exception:
                clarify_payload_stream = None

            from chat import _assess_cot_level, stream_strong_cot
            cot_level_stream = _assess_cot_level(
                req.message, intent,
                [c for c, _, _ in ranked[:10]],
                knowledge, len(ranked), None,
            )
            req_filters_dump = req.filters.model_dump() if req.filters else None

            def _merge_series_chips(payload: dict) -> dict:
                if not series_chips_stream:
                    return payload
                existing = payload.get("chips") or []
                seen = set(existing)
                payload["chips"] = series_chips_stream + [
                    c for c in existing
                    if c not in series_chips_stream and c not in seen
                ]
                return payload

            if cot_level_stream == "strong":
                try:
                    async for ev_type, payload in stream_strong_cot(
                        req.message, intent,
                        [c for c, _, _ in ranked[:10]],
                        knowledge, len(ranked), None, None,
                        clarify_payload_stream,
                        stock_summary_stream, cutting_range_stream,
                        session, req_filters_dump,
                    ):
                        if ev_type == "answer":
                            chat_result = _merge_series_chips(payload)
                            yield f"event: answer\ndata: {_json.dumps(chat_result, ensure_ascii=False)}\n\n"
                        else:
                            yield f"event: {ev_type}\ndata: {_json.dumps(payload, ensure_ascii=False)}\n\n"
                except Exception:
                    chat_result = _merge_series_chips({
                        "answer": _build_answer(intent, ranked),
                        "chips": [], "reasoning": "", "refined_filters": None,
                        "cot_level": "light",
                    })
                    yield f"event: answer\ndata: {_json.dumps(chat_result, ensure_ascii=False)}\n\n"
            else:
                try:
                    chat_result = await asyncio.to_thread(
                        generate_response,
                        req.message, intent,
                        [c for c, _, _ in ranked[:10]],
                        knowledge,
                        len(ranked),
                        None,
                        None,
                        clarify_payload_stream,
                        stock_summary_stream,
                        cutting_range_stream,
                        session,
                        req_filters_dump,
                    )
                except Exception:
                    chat_result = {"answer": _build_answer(intent, ranked), "chips": [], "reasoning": "", "refined_filters": None}
                chat_result = _merge_series_chips(chat_result)
                yield f"event: answer\ndata: {_json.dumps(chat_result, ensure_ascii=False)}\n\n"
        else:
            # No user message — deterministic answer, no CoT round-trip.
            if series_chips_stream:
                chat_result["chips"] = list(series_chips_stream)
            yield f"event: answer\ndata: {_json.dumps(chat_result, ensure_ascii=False)}\n\n"

        # Persist the turn so subsequent stream calls keep state.
        edp_list = [c.get("edp_no") for c, _, _ in ranked[:50] if c.get("edp_no")]
        intent_dump = intent.model_dump()
        add_turn(
            session, role="user",
            message=req.message or "(manual filters)",
            intent=intent_dump,
            products=edp_list,
        )
        ans_stream = (chat_result or {}).get("answer") or ""
        if ans_stream:
            add_turn(
                session, role="assistant",
                message=ans_stream,
                intent=intent_dump,
                products=edp_list,
                total_count=len(ranked),
                answer_preview=ans_stream,
                top_products=[c for c, _, _ in ranked[:3]],
            )

        yield "event: done\ndata: {}\n\n"

    return StreamingResponse(generate(), media_type="text/event-stream")


@app.post("/filter-options", response_model=FilterOptionsResponse)
def filter_options(req: FilterOptionsRequest) -> FilterOptionsResponse:
    """Live toggle UI hook — returns selectable values + per-value counts for
    a single field, given the currently applied filter context."""
    # Synthesize a SCRIntent-shaped dict from the manual filters (tool_type
    # maps to machining_category so sibling filters stay consistent with
    # /products' internal flattening).
    current: dict = {
        "diameter": req.current_filters.diameter,
        "flute_count": req.current_filters.flute_count,
        "material_tag": req.current_filters.material_tag,
        "subtype": req.current_filters.subtype,
        "brand": req.current_filters.brand,
        "coating": req.current_filters.coating,
        "tool_type": req.current_filters.machining_category,
        "shank_type": req.current_filters.shank_type,
        "tool_material": req.current_filters.tool_material,
        "machining_category": req.current_filters.machining_category,
        "application_shape": req.current_filters.application_shape,
        "country": req.current_filters.country,
        "coolant_hole": req.current_filters.coolant_hole,
        "diameter_min": req.current_filters.diameter_min,
        "diameter_max": req.current_filters.diameter_max,
        "overall_length_min": req.current_filters.overall_length_min,
        "overall_length_max": req.current_filters.overall_length_max,
        "length_of_cut_min": req.current_filters.length_of_cut_min,
        "length_of_cut_max": req.current_filters.length_of_cut_max,
        "shank_diameter_min": req.current_filters.shank_diameter_min,
        "shank_diameter_max": req.current_filters.shank_diameter_max,
        "flute_count_min": req.current_filters.flute_count_min,
        "flute_count_max": req.current_filters.flute_count_max,
    }
    try:
        opts = get_filter_options_fast(req.field, current)
        total = count_products_fast(current)
    except Exception:
        # Fallback to DB path if the index isn't ready yet.
        opts = get_filter_options(req.field, current)
        total = product_count_filtered(current)
    return FilterOptionsResponse(
        field=req.field,
        options=[FilterOption(value=o["value"], count=o["count"]) for o in opts],
        total_with_current_filters=total,
    )
