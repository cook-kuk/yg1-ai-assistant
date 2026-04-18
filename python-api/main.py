from fastapi import FastAPI, HTTPException

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
    FilterOption,
    FilterOptionsRequest,
    FilterOptionsResponse,
)
from scr import parse_intent
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

app = FastAPI(title="cook-forge python-api", version="0.1.0")


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


@app.post("/products", response_model=ProductsResponse)
def products(req: ProductsRequest) -> ProductsResponse:
    if not req.message and not req.filters:
        raise HTTPException(status_code=400, detail="message 또는 filters 중 하나는 필요합니다")

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

    # 2. Fetch (whole candidate set). Wrapped so the 0-hit relax loop can
    #    re-run with a progressively looser intent without duplicating kwargs.
    def _run_search() -> list[dict]:
        return search_products(
            diameter=intent.diameter,
            flute_count=intent.flute_count,
            material_tag=intent.material_tag,
            tool_type=intent.tool_type,
            subtype=intent.subtype,
            brand=intent.brand,
            coating=intent.coating,
            tool_material=intent.tool_material,
            shank_type=intent.shank_type,
            machining_category=req.filters.machining_category if req.filters else None,
            application_shape=req.filters.application_shape if req.filters else None,
            country=req.filters.country if req.filters else None,
            coolant_hole=req.filters.coolant_hole if req.filters else None,
            diameter_min=req.filters.diameter_min if req.filters else None,
            diameter_max=req.filters.diameter_max if req.filters else None,
            overall_length_min=req.filters.overall_length_min if req.filters else None,
            overall_length_max=req.filters.overall_length_max if req.filters else None,
            length_of_cut_min=req.filters.length_of_cut_min if req.filters else None,
            length_of_cut_max=req.filters.length_of_cut_max if req.filters else None,
            shank_diameter_min=req.filters.shank_diameter_min if req.filters else None,
            shank_diameter_max=req.filters.shank_diameter_max if req.filters else None,
            flute_count_min=req.filters.flute_count_min if req.filters else None,
            flute_count_max=req.filters.flute_count_max if req.filters else None,
            limit=5000,
        )

    rows = _run_search()

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

    ranked = rank_candidates(rows, intent, top_k=len(rows) or 1)

    # 3. Build response product lists.
    top10: list[ProductCard] = []
    for c, s, b in ranked[:10]:
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

    # 4. Live-toggle facets.
    filter_dict = _filters_to_dict(req.filters, intent)
    available: dict[str, list[FilterOption]] = {}
    for f in _TOGGLE_FIELDS:
        try:
            opts = get_filter_options(f, filter_dict)
        except Exception:
            opts = []
        if opts:
            available[f] = [FilterOption(value=o["value"], count=o["count"]) for o in opts]

    # 5. Answer generation.
    #    - Natural-language message → RAG lookup + GPT-5.4-mini (CoT).
    #    - Manual-only request → deterministic template (no LLM round-trip).
    chips: list[str] = []
    if req.message:
        try:
            knowledge = search_knowledge(req.message, top_k=3)
        except Exception:
            knowledge = []
        try:
            chat_result = generate_response(
                message=req.message,
                intent=intent,
                products=[c for c, _, _ in ranked[:10]],
                knowledge=knowledge,
                total_count=len(ranked),
                relaxed_fields=relaxed_fields or None,
            )
            raw_answer = chat_result.get("answer") or _build_answer(intent, ranked)
            chips = chat_result.get("chips") or []
        except Exception:
            raw_answer = _build_answer(intent, ranked)
    else:
        raw_answer = _build_answer(intent, ranked)

    extra_safe: set[str] = set()
    for c, _, _ in ranked[:10]:
        for key in ("edp_no", "brand", "series"):
            val = c.get(key)
            if val:
                extra_safe.add(str(val))
    cleaned_answer, _removed = scrub(raw_answer, extra_safe=extra_safe)

    return ProductsResponse(
        text=cleaned_answer,
        chips=chips,
        products=top10,
        allProducts=all_prods,
        appliedFilters={k: v for k, v in filter_dict.items() if v is not None},
        totalCount=len(ranked),
        route=route,
        availableFilters=available or None,
    )


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
    opts = get_filter_options(req.field, current)
    total = product_count_filtered(current)
    return FilterOptionsResponse(
        field=req.field,
        options=[FilterOption(value=o["value"], count=o["count"]) for o in opts],
        total_with_current_filters=total,
    )
