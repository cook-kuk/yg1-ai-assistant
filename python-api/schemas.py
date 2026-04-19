from typing import Optional, List, Dict, Any
from pydantic import BaseModel, Field


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
    cutting_conditions: Optional[List[Dict[str, Any]]] = None
    # Inventory summary — populated from product_inventory_summary_mv via the
    # correlated subquery in SELECT_COLS. NULL means "no snapshot row" (not
    # the same as stock_status='outofstock'), so keep all three optional.
    total_stock: Optional[int] = None
    warehouse_count: Optional[int] = None
    stock_status: Optional[str] = None   # "instock" | "limited" | "outofstock"
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
    score: float


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


class ProductsPageRequest(BaseModel):
    """Candidate-panel pagination — replays the last intent attached to the
    session and returns a detailed page slice. No LLM round-trip."""
    session_id: str
    page: int = 0
    pageSize: int = 20


class ProductsPageResponse(BaseModel):
    products: List[ProductCard]
    totalCount: int
    page: int
    pageSize: int
    totalPages: int
    session_id: str
    appliedFilters: Dict[str, Any] = Field(default_factory=dict)
