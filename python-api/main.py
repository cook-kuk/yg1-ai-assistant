import asyncio
import json as _json
import os
import re
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
from guard import scrub
from rag import search_knowledge
from chat import generate_response
from product_index import (
    load_index,
    search_products_fast,
    index_size,
    get_filter_options_fast,
    count_products_fast,
)
from session import get_or_create as session_get_or_create, add_turn, carry_forward_intent
from scheduler import scheduler
from cutting import get_cutting_conditions, get_conditions_for_products

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


def _build_answer(intent, ranked: list) -> str:
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
    return (
        f"{head} 조건으로 {len(ranked)}건 추천합니다. "
        f"1위: {top.get('brand') or '-'} / {top.get('series') or '-'} (EDP {top['edp_no']})."
    )


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
        "tool_type": intent.tool_type,
        "subtype": intent.subtype,
        "brand": intent.brand,
        "coating": intent.coating,
        "tool_material": intent.tool_material,
        "shank_type": intent.shank_type,
    }
    if filters:
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
        ):
            v = getattr(filters, fld)
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
    )


@app.post("/products", response_model=ProductsResponse)
def products(req: ProductsRequest) -> ProductsResponse:
    if not req.message and not req.filters:
        return _empty_products_response(req.session_id)

    # 0. Session handling — carry the prior filter context forward so
    #    "이 중에서 4날" on turn 2 still remembers material+diameter.
    session = session_get_or_create(req.session_id)

    # 1. Resolve intent — manual filters win, optional LLM fills the gaps.
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
            try:
                llm_intent = parse_intent(req.message)
                for field in intent.__class__.model_fields:
                    if getattr(intent, field) is None and getattr(llm_intent, field) is not None:
                        setattr(intent, field, getattr(llm_intent, field))
                route = "manual+llm"
            except Exception:
                # LLM failure is non-fatal when manual filters are provided.
                pass
    else:
        intent = parse_intent(req.message or "")
        route = "llm"

    # Process exclusions BEFORE carry_forward, so that when the user says
    # "JET-POWER 필요 없어요" we (a) drop it from session state and (b) don't
    # let carry_forward re-populate intent.brand from the stale carried value.
    if req.message:
        _apply_brand_exclusions(session, intent, _detect_excluded_brands(req.message))

    # Fill unset intent fields from the session's carried context so
    # abbreviated follow-ups still know the material/diameter from turn 1.
    carry_forward_intent(session, intent)

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
        knowledge: list[dict] = []
        if intent_value == "domain_knowledge" and req.message:
            try:
                knowledge = search_knowledge(req.message, top_k=3)
            except Exception:
                knowledge = []
        answer_text = ""
        chips: list[str] = []
        if req.message:
            try:
                chat_result = generate_response(
                    message=req.message,
                    intent=intent,
                    products=[],
                    knowledge=knowledge,
                    total_count=0,
                    relaxed_fields=None,
                    available_filters=None,
                )
                answer_text = chat_result.get("answer") or ""
                chips = chat_result.get("chips") or []
            except Exception:
                answer_text = (
                    "도메인 지식을 찾지 못했습니다."
                    if intent_value == "domain_knowledge"
                    else "죄송합니다, 해당 질문에 답변하기 어렵습니다."
                )
        sources.append(SourceAttribution(
            type="domain_knowledge" if intent_value == "domain_knowledge" else "llm_reasoning",
            detail=(
                f"도메인 지식 {len(knowledge)}건 + CoT 응답"
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
        }
        if req.filters:
            for fld in (
                "machining_category", "application_shape", "country", "coolant_hole",
                "diameter_min", "diameter_max",
                "overall_length_min", "overall_length_max",
                "length_of_cut_min", "length_of_cut_max",
                "shank_diameter_min", "shank_diameter_max",
                "flute_count_min", "flute_count_max",
            ):
                v = getattr(req.filters, fld)
                if v is not None:
                    base[fld] = v
        return base

    def _run_search() -> list[dict]:
        return search_products_fast(_build_filters(), limit=125_000)

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
    for c, s, b in ranked[:10]:
        edp = str(c.get("edp_no") or "")
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

    # 5. Answer generation.
    #    - Natural-language message → RAG lookup + GPT-5.4-mini (CoT).
    #    - Manual-only request → deterministic template (no LLM round-trip).
    chips: list[str] = []
    knowledge: list[dict] = []
    if req.message:
        try:
            knowledge = search_knowledge(req.message, top_k=3)
        except Exception:
            knowledge = []
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
        try:
            chat_result = generate_response(
                message=req.message,
                intent=intent,
                products=[c for c, _, _ in ranked[:10]],
                knowledge=knowledge,
                total_count=len(ranked),
                relaxed_fields=relaxed_fields or None,
                available_filters=available or None,
            )
            raw_answer = chat_result.get("answer") or _build_answer(intent, ranked)
            chips = chat_result.get("chips") or []
        except Exception:
            raw_answer = _build_answer(intent, ranked)
        # CoT attribution — note if web search contributed.
        has_web = any(s.type == "web_search" for s in sources)
        sources.append(SourceAttribution(
            type="web_search+llm" if has_web else "llm_reasoning",
            detail="웹 검색 결과 + GPT-5.4-mini 추론" if has_web
            else "GPT-5.4-mini CoT 추론" + (" (도메인 지식 주입)" if knowledge else ""),
            confidence="medium" if has_web else ("high" if knowledge else "medium"),
        ))
    else:
        raw_answer = _build_answer(intent, ranked)

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

        # 1. intent
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
                try:
                    llm_intent = await asyncio.to_thread(parse_intent, req.message)
                    for field in intent.__class__.model_fields:
                        if getattr(intent, field) is None and getattr(llm_intent, field) is not None:
                            setattr(intent, field, getattr(llm_intent, field))
                    route = "manual+llm"
                except Exception:
                    pass
        else:
            intent = await asyncio.to_thread(parse_intent, req.message or "")
            route = "llm"

        # Mirror /products: handle brand exclusions before carry_forward so
        # the carried filter doesn't override a fresh "X 필요 없어요".
        if req.message:
            _apply_brand_exclusions(session, intent, _detect_excluded_brands(req.message))

        carry_forward_intent(session, intent)

        yield f"event: filters\ndata: {_json.dumps({'filters': intent.model_dump(), 'route': route, 'session_id': session.session_id}, ensure_ascii=False)}\n\n"

        # Intent-based routing — general_question / domain_knowledge skip the
        # search + rank path entirely. The client should key UI off
        # filters.filters.intent from the event above. See /products sync
        # endpoint for rationale.
        intent_value = (getattr(intent, "intent", None) or "recommendation")
        if intent_value in ("general_question", "domain_knowledge"):
            knowledge = []
            if intent_value == "domain_knowledge" and req.message:
                try:
                    knowledge = await asyncio.to_thread(search_knowledge, req.message, 3)
                except Exception:
                    knowledge = []
            if req.message:
                try:
                    chat_result = await asyncio.to_thread(
                        generate_response,
                        req.message, intent, [], knowledge, 0, None, None,
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
            }
            if req.filters:
                for fld in (
                    "machining_category", "application_shape", "country", "coolant_hole",
                    "diameter_min", "diameter_max",
                    "overall_length_min", "overall_length_max",
                    "length_of_cut_min", "length_of_cut_max",
                    "shank_diameter_min", "shank_diameter_max",
                    "flute_count_min", "flute_count_max",
                ):
                    v = getattr(req.filters, fld)
                    if v is not None:
                        filters[fld] = v
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

        top10_payload = []
        for c, s, b in ranked[:10]:
            top10_payload.append({
                "edp_no": c.get("edp_no"),
                "brand": c.get("brand"),
                "series": c.get("series"),
                "subtype": c.get("subtype"),
                "diameter": c.get("diameter"),
                "flutes": c.get("flutes"),
                "coating": c.get("coating"),
                "score": s,
                "score_breakdown": b,
            })
        yield (
            f"event: products\ndata: "
            f"{_json.dumps({'count': len(ranked), 'top10': top10_payload, 'broadened': broadened}, ensure_ascii=False)}\n\n"
        )

        # 3. CoT answer
        if req.message:
            try:
                knowledge = await asyncio.to_thread(search_knowledge, req.message, 3)
            except Exception:
                knowledge = []
            try:
                chat_result = await asyncio.to_thread(
                    generate_response,
                    req.message, intent,
                    [c for c, _, _ in ranked[:10]],
                    knowledge,
                    len(ranked),
                    None,
                )
            except Exception:
                chat_result = {"answer": _build_answer(intent, ranked), "chips": [], "reasoning": "", "refined_filters": None}
        else:
            chat_result = {"answer": _build_answer(intent, ranked), "chips": [], "reasoning": "", "refined_filters": None}

        yield f"event: answer\ndata: {_json.dumps(chat_result, ensure_ascii=False)}\n\n"

        # Persist the turn so subsequent stream calls keep state.
        edp_list = [c.get("edp_no") for c, _, _ in ranked[:50] if c.get("edp_no")]
        add_turn(
            session, role="user",
            message=req.message or "(manual filters)",
            intent=intent.model_dump(),
            products=edp_list,
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
