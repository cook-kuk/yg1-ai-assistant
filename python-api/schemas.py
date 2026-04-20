from typing import Optional, List, Dict, Any
from pydantic import BaseModel, Field

from config import DEFAULT_PAGE_SIZE as _CFG_DEFAULT_PAGE_SIZE


class RecommendRequest(BaseModel):
    message: str = Field(..., min_length=1, max_length=2000)


class SCRIntent(BaseModel):
    intent: Optional[str] = None         # "recommendation" | "general_question" | "domain_knowledge"
    diameter: Optional[float] = None
    flute_count: Optional[int] = None
    material_tag: Optional[str] = None   # ISO group (P/M/K/N/S/H/O)
    workpiece_name: Optional[str] = None # Specific material (구리/알루미늄/인코넬/SUS304 ...) — UI 세부 피삭재
    tool_type: Optional[str] = None
    subtype: Optional[str] = None
    brand: Optional[str] = None
    coating: Optional[str] = None
    tool_material: Optional[str] = None  # CARBIDE / HSS / CBN / PCD / CERMET
    shank_type: Optional[str] = None     # Weldon / Cylindrical / Morse Taper / Straight
    # P0 additions — high-coverage dimensional/geometric fields the old parser
    # silently ignored. "45도 헬릭스" / "M8×1.25" / "R0.5" / "h7" all used to
    # get dropped at SCR; they now flow through to _build_where and _matches.
    helix_angle: Optional[float] = None      # milling_helix_angle (deg)
    point_angle: Optional[float] = None      # holemaking_point_angle (deg, drill tip)
    thread_pitch: Optional[float] = None     # threading_pitch (mm)
    thread_tpi: Optional[float] = None       # threading_tpi (inch threads)
    diameter_tolerance: Optional[str] = None # h6 / h7 / h8 — ILIKE against milling_diameter_tolerance
    ball_radius: Optional[float] = None      # milling_ball_radius (mm) — "R0.5 볼엔드밀"
    # P2 additions — per-query unit + inventory switch.
    unit_system: Optional[str] = None        # "Metric" | "Inch" — maps to edp_unit
    in_stock_only: Optional[bool] = None     # "재고 있는 것만" / "in stock"
    # Stock quantity bounds — "재고 200개 이상" → stock_min=200; "재고 50개
    # 이하" → stock_max=50. Distinct from in_stock_only (binary "any stock"),
    # which stays for the pure "있는 것만" case. Implemented via EXISTS +
    # total_stock >= / <= on product_inventory_summary_mv so the main MV
    # row count stays stable (no JOIN blow-up when a single EDP has many
    # warehouse rows).
    stock_min: Optional[int] = None
    stock_max: Optional[int] = None
    # P1 additions — series-scoped lookup + HRC-aware affinity.
    # series_name: user asked about a specific series family ("GMF52 스펙",
    # "V7 PLUS 헬릭스각"); chat path routes these to series_profile_mv
    # instead of the per-EDP recommender. Free text — we keyword-match
    # against series_profile_mv.series_name_variants downstream.
    series_name: Optional[str] = None
    # hardness_hrc: workpiece hardness in HRC. Picks up "HRC 58 가공",
    # "열처리강 55 로크웰" style phrasing so scoring.hrc_match_boost can
    # credit brands whose reference_profiles cover that range.
    hardness_hrc: Optional[float] = None
    # P2 additions — dimensional ranges the golden test used to skip
    # (overallLength / lengthOfCut / shankDiameter / cutting edge shape).
    # LLM picks up "날장 20 이상" / "전장 100 이하" / "샹크 8mm" and sends
    # min/max bounds that _build_where already knows how to consume.
    length_of_cut_min: Optional[float] = None    # milling_length_of_cut ≥ min
    length_of_cut_max: Optional[float] = None    # milling_length_of_cut ≤ max
    overall_length_min: Optional[float] = None   # milling_overall_length ≥ min
    overall_length_max: Optional[float] = None   # milling_overall_length ≤ max
    shank_diameter: Optional[float] = None       # exact shank dia; main.py expands to ±tol
    shank_diameter_min: Optional[float] = None
    shank_diameter_max: Optional[float] = None
    cutting_edge_shape: Optional[str] = None     # series_cutting_edge_shape (Square/Ball/Corner Radius/…)
    # Application / machining operation mode — distinct axis from subtype.
    # Side Milling / Roughing / Helical Interpolation / Slotting / Facing
    # / Profiling / Trochoidal / Die-Sinking. scoring._operation_score
    # substring-matches this against product.series_application_shape.
    application_shape: Optional[str] = None
    # Region / sales country. Korean ("한국/미국/유럽/아시아") or any-case
    # English ("usa", "EU", "us") — country_alias.canonicalize_country
    # normalizes to KOREA / AMERICA / EUROPE / ASIA before the SQL filter.
    country: Optional[str] = None
    # "Peek" lookup — the user points at a specific EDP ("UGMG34919 보여줘")
    # or series ("UGMG34 뭐에요?") while their filter session is still live.
    # When set, main.py runs an independent DB query that ignores
    # material_tag / stock / flute filters and attaches the result as
    # `reference_products` on the response. Filter session and ranked list
    # are untouched so the user can keep narrowing after the peek.
    reference_lookup: Optional[str] = None
    # MaterialMapping enrichment — populated by scr.parse_intent's
    # post-process when alias_resolver.resolve_rich matched the user's
    # workpiece_name to a cross-standard canonical. DB filtering still
    # uses material_tag (ISO group) since product_recommendation_mv
    # carries no concrete material column, but downstream response
    # composition can quote `material_canonical` in the "왜 이 제품" line.
    # cross_refs / hardness are NOT mirrored here — callers that need them
    # re-invoke resolve_rich(material_canonical) on demand, keeping the
    # SCRIntent DTO lean.
    material_canonical: Optional[str] = None
    # "Did you mean …?" pool. Populated when resolve_rich returned status
    # ∈ {fuzzy (low conf), no_match} so the LLM response composer can
    # surface a disambiguation prompt instead of silently falling back to
    # material_tag. None when confidence is high enough to skip suggesting.
    material_suggestions: Optional[List[str]] = None


class Candidate(BaseModel):
    edp_no: str
    brand: Optional[str] = None
    series: Optional[str] = None
    tool_type: Optional[str] = None
    subtype: Optional[str] = None
    diameter: Optional[str] = None
    flutes: Optional[str] = None
    material_tags: Optional[List[str]] = None
    coating: Optional[str] = None
    root_category: Optional[str] = None


class ScoredCandidate(BaseModel):
    edp_no: str
    score: float
    breakdown: Dict[str, float]


class RecommendResponse(BaseModel):
    filters: SCRIntent
    candidates: List[Candidate]
    scores: List[ScoredCandidate]
    answer: str
    route: str  # "deterministic" | "kg" | "llm"
    removed_tokens: List[str] = Field(default_factory=list)


class HealthResponse(BaseModel):
    status: str
    product_count: int


# ── /products + /filter-options ─────────────────────────────────────

class ManualFilters(BaseModel):
    """UI-form filter payload — mirrors SCRIntent plus a few extras the
    filter panel exposes that the LLM parser doesn't currently emit
    (purpose, machining_category, application_shape, country, coolant_hole)."""
    purpose: Optional[str] = None
    material_tag: Optional[str] = None
    workpiece_name: Optional[str] = None
    machining_category: Optional[str] = None
    application_shape: Optional[str] = None
    diameter: Optional[float] = None
    # Numeric range filters — any pair left unset means "no bound on that side".
    # Applied via `col ~ '^[0-9]+(\.[0-9]+)?$' AND col::numeric BETWEEN …` so
    # non-numeric rows (e.g. "10mm", "1/2") are excluded cleanly.
    diameter_min: Optional[float] = None
    diameter_max: Optional[float] = None
    overall_length_min: Optional[float] = None
    overall_length_max: Optional[float] = None
    length_of_cut_min: Optional[float] = None
    length_of_cut_max: Optional[float] = None
    shank_diameter_min: Optional[float] = None
    shank_diameter_max: Optional[float] = None
    flute_count_min: Optional[int] = None
    flute_count_max: Optional[int] = None
    country: Optional[str] = None
    subtype: Optional[str] = None
    flute_count: Optional[int] = None
    coating: Optional[str] = None
    brand: Optional[str] = None
    tool_material: Optional[str] = None
    shank_type: Optional[str] = None
    coolant_hole: Optional[str] = None
    # P0/P1 dimensional ranges — mirror the SCRIntent exact-value fields so
    # the UI filter bar can scope by range (e.g. helix 30–35°) without
    # needing an exact match.
    helix_angle_min: Optional[float] = None
    helix_angle_max: Optional[float] = None
    point_angle_min: Optional[float] = None
    point_angle_max: Optional[float] = None
    thread_pitch_min: Optional[float] = None
    thread_pitch_max: Optional[float] = None
    tpi_min: Optional[float] = None
    tpi_max: Optional[float] = None
    diameter_tolerance: Optional[str] = None   # h6 / h7 / h8 (text ILIKE)
    ball_radius_min: Optional[float] = None
    ball_radius_max: Optional[float] = None
    neck_diameter_min: Optional[float] = None
    neck_diameter_max: Optional[float] = None
    effective_length_min: Optional[float] = None
    effective_length_max: Optional[float] = None
    # Coolant-hole split out per-operation family — the MV stores three
    # separate columns and a single `coolant_hole` filter only hits milling.
    holemaking_coolant_hole: Optional[str] = None
    threading_coolant_hole: Optional[str] = None
    # P2 — unit + perf-oriented normalized brand.
    unit_system: Optional[str] = None          # Metric / Inch → edp_unit
    brand_norm: Optional[str] = None           # norm_brand equality (upper-cased canonical)
    # P3 — inventory gate. Enforced in search.py via JOIN against
    # product_inventory_summary_mv; the in-memory index path falls back to
    # the DB path when these are set since the index doesn't carry stock.
    in_stock_only: Optional[bool] = None
    # Explicit stock-quantity range (matches SCRIntent.stock_min/stock_max).
    stock_min: Optional[int] = None
    stock_max: Optional[int] = None
    warehouse: Optional[str] = None            # inventory_snapshot.warehouse_or_region ILIKE


class ProductsRequest(BaseModel):
    message: Optional[str] = None
    filters: Optional[ManualFilters] = None
    session_id: Optional[str] = None


class FilterOption(BaseModel):
    """One selectable value in the live filter-toggle UI."""
    value: str
    count: int


class FilterOptionsRequest(BaseModel):
    field: str                        # which field to enumerate
    current_filters: ManualFilters    # applied filter context


class FilterOptionsResponse(BaseModel):
    field: str
    options: List[FilterOption]
    total_with_current_filters: int


class ProductCard(BaseModel):
    """Detail card — shown for top ranks."""
    edp_no: str
    brand: Optional[str] = None
    series: Optional[str] = None
    tool_type: Optional[str] = None
    subtype: Optional[str] = None
    diameter: Optional[str] = None
    flutes: Optional[str] = None
    coating: Optional[str] = None
    material_tags: Optional[List[str]] = None
    description: Optional[str] = None
    feature: Optional[str] = None
    oal: Optional[str] = None
    loc: Optional[str] = None
    helix_angle: Optional[str] = None
    coolant_hole: Optional[str] = None
    shank_type: Optional[str] = None
    # Raw DB unit for this row (Metric/METRIC/Inch/INCH). The frontend adapter
    # converts inch-stored numerics (diameter / loc / oal / shank_dia / ball
    # radius) to mm before rendering so "3" never shows as "3mm" when the row
    # actually means "3 인치".
    edp_unit: Optional[str] = None
    shank_dia: Optional[str] = None          # milling_shank_dia (text, may be "1/2" inch)
    ball_radius: Optional[str] = None        # milling_ball_radius (text, e.g. "R.125")
    neck_diameter: Optional[str] = None      # milling_neck_diameter
    effective_length: Optional[str] = None   # milling_effective_length
    # Additional detail rows the CandidateCard spec table shows — all raw
    # DB text so the frontend's parseNumericMm can apply unit conversion.
    tool_material: Optional[str] = None      # milling/holemaking/threading_tool_material (first non-empty)
    diameter_tolerance: Optional[str] = None # milling_diameter_tolerance (e.g. "h7")
    taper_angle: Optional[str] = None        # milling_taper_angle (deg)
    point_angle: Optional[str] = None        # holemaking_point_angle (deg)
    thread_pitch: Optional[str] = None       # threading_pitch (mm)
    cutting_conditions: Optional[List[Dict[str, Any]]] = None
    # Inventory summary — populated from product_inventory_summary_mv via the
    # correlated subquery in SELECT_COLS. NULL means "no snapshot row" (not
    # the same as stock_status='outofstock'), so keep all three optional.
    total_stock: Optional[int] = None
    warehouse_count: Optional[int] = None
    stock_status: Optional[str] = None   # "instock" | "limited" | "outofstock"
    # xAI narrative — short paragraph explaining "왜 이 제품이 최적인가".
    # Populated only on the top-1 card so the UI's ScoreBreakdownPanel has
    # something to quote verbatim; the rest stay None. Strong CoT reuses
    # its verifier output; Light CoT falls back to a deterministic template.
    rationale: Optional[str] = None
    # Human-facing match-reason chips ("소재 N군 적합", "형상 Square 일치").
    # Derived server-side so every candidate surfaces the same evidence the
    # scorer actually rewarded — cheaper than re-deriving in the UI.
    matched_fields: Optional[List[str]] = None
    # Brand × workpiece affinity tier. "EXCELLENT" (≥80) / "GOOD" (40..79)
    # / "FAIR" (10..39) / None below. Drives the card's rating badge.
    material_rating: Optional[str] = None
    score: float
    score_breakdown: Dict[str, float]


class ProductSummary(BaseModel):
    """Compact row — shown in the "see more" list."""
    edp_no: str
    brand: Optional[str] = None
    series: Optional[str] = None
    diameter: Optional[str] = None
    flutes: Optional[str] = None
    coating: Optional[str] = None
    stock_status: Optional[str] = None
    material_rating: Optional[str] = None
    score: float


class RefineChip(BaseModel):
    """Structured refine-chip payload. Emitted in parallel with the
    legacy natural-language `chips: list[str]` so the frontend can
    upgrade-in-place (prefer structured when present, fall back to NL).

    action values:
      narrow  — intersect ranked with rows matching (field, value)
      drop    — remove rows matching (field, value)
      broaden — relax the current filter on `field` (re-runs full search)

    `value` is `Any` because cross-field chips carry a dict
    `{field1: val1, field2: val2}` while single-field chips carry a
    scalar. Frontend discriminator: `chip.field.includes("+")` →
    cross-field payload.
    """
    field: str
    value: Any
    label: str
    count: int
    action: str = "narrow"


class ValidatorWarning(BaseModel):
    """One evidence-grounding decision emitted by guard.validate_response.

    Emitted for every extracted factual claim, regardless of action —
    'passed' entries let the UI show "검증됨" badges for grounded claims
    if desired, 'removed' / 'annotated' entries drive the cleaned-text
    diff. Serialized into ProductsResponse.validator_warnings as plain
    dicts so the frontend can display without introducing another
    shared-type dependency.
    """
    category: str              # numeric | categorical | citation | existential
    claim_text: str
    evidence_ref: Optional[str] = None  # "products[2].diameter" | "knowledge.material_guide[0]" | None
    action: str                # removed | annotated | passed
    confidence: float = 0.0
    span: List[int] = Field(default_factory=list)  # [start, end]


class SourceAttribution(BaseModel):
    """Per-stage evidence — lets the UI surface *why* an answer was
    produced this way and with what confidence."""
    type: str       # internal_db | domain_knowledge | llm_reasoning | web_search | web_search+llm | cutting_conditions
    detail: str
    confidence: str  # high | medium | low


class ProductsResponse(BaseModel):
    text: str
    purpose: str = "recommendation"
    chips: List[str] = Field(default_factory=list)
    isComplete: bool = True
    products: List[ProductCard]
    allProducts: List[ProductSummary]
    appliedFilters: Dict[str, Any]
    totalCount: int
    route: str
    availableFilters: Optional[Dict[str, List[FilterOption]]] = None
    session_id: str
    broadened: bool = False  # True when follow-up narrow hit 0 and we used the global set
    sources: List[SourceAttribution] = Field(default_factory=list)
    # Evidence-grounded validator output. Empty = either the answer was
    # short enough to skip LLM claim extraction (< VALIDATOR_LLM_MIN_CHARS)
    # or every claim verified. Each entry carries span info so the UI
    # can surface "일부 미검증 내용이 정정됨" badges for the removed /
    # annotated claims while keeping grounded claims unmarked.
    validator_warnings: List[ValidatorWarning] = Field(default_factory=list)
    # Step 2 #5 — structured refine chips. Empty on fresh-search turns;
    # populated by refine_engine.build_refine_chips when the turn was
    # an in-memory refine or when distributions could produce count-
    # bearing options. UI prefers these over `chips: list[str]` when
    # non-empty. Each entry maps to schemas.RefineChip.
    refine_chips: List[RefineChip] = Field(default_factory=list)
    # Pre-guidance blocks surfaced alongside the product list so the UI /
    # CoT can quote concrete aggregates without an extra round-trip.
    # stock_summary: {in_stock, total, pct} — fraction of today's candidate
    # pool that ships now. cutting_range: {vc_min/max, fz_min/max, n_min/max,
    # row_count, source} — Vc/Fz/RPM bounds from the YG-1 condition chart for
    # the parsed material_tag (+ optional diameter window). Both are None
    # when the data isn't available, which the frontend treats as hide-chip.
    stock_summary: Optional[Dict[str, Any]] = None
    cutting_range: Optional[Dict[str, Any]] = None
    # Dual CoT surfacing — "light" (gpt-5.4-mini, low-effort) is the default;
    # chat._assess_cot_level escalates to "strong" (gpt-5.4, medium reasoning
    # + self-verify) when the answer carries a correctness tax: compare /
    # why / troubleshooting / 0-result / S·H material / dissatisfaction
    # follow-up. Exposed so the UI can render a "deep-reasoning" badge and
    # tests can assert the branch fired.
    cot_level: Optional[str] = None
    # True when the Strong CoT verifier accepted the draft without correction,
    # False if the mini verifier rewrote fields, None on Light or on any
    # verifier/draft exception. Paired with cot_level so the UI can show
    # "심층 분석 + 검증 완료" only when both signals line up.
    verified: Optional[bool] = None
    # Per-axis max values for ProductCard.score_breakdown. Shared across
    # all candidates in the response (every card scores against the same
    # weight table), so shipped once at response level — the UI adapter
    # merges this with each card's flat score dict to render the bar chart
    # without hard-coded magic numbers.
    score_breakdown_max: Optional[Dict[str, float]] = None
    # "Peek" cards — populated when intent.reference_lookup matched an EDP
    # or series. These bypass the current filter session entirely, so the
    # UI renders them in a separate "조회한 상품" section below the main
    # ranked list. Empty list when no peek was requested.
    reference_products: List[ProductCard] = Field(default_factory=list)
    reference_query: Optional[str] = None  # echo back the matched token (e.g. "UGMG34919")
    # Filters the caller set that target MV columns currently missing from
    # product_recommendation_mv. Populated by search.collect_dropped_filter_warnings.
    # Non-empty means "we silently ignored these fields" — the UI should
    # surface a one-liner so the user knows their 74k result wasn't really
    # narrowed by e.g. 선단각 / thread pitch. Empty on the happy path.
    dropped_filters: List[Dict[str, str]] = Field(default_factory=list)


class ProductsPageRequest(BaseModel):
    """Candidate-panel pagination — replays the last intent attached to the
    session and returns a detailed page slice. No LLM round-trip."""
    session_id: str
    page: int = 0
    pageSize: int = _CFG_DEFAULT_PAGE_SIZE


class ProductsPageResponse(BaseModel):
    products: List[ProductCard]
    totalCount: int
    page: int
    pageSize: int
    totalPages: int
    session_id: str
    appliedFilters: Dict[str, Any] = Field(default_factory=dict)
