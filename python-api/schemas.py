from typing import Optional, List, Dict, Any
from pydantic import BaseModel, Field


class RecommendRequest(BaseModel):
    message: str = Field(..., min_length=1, max_length=2000)


class SCRIntent(BaseModel):
    diameter: Optional[float] = None
    flute_count: Optional[int] = None
    material_tag: Optional[str] = None
    tool_type: Optional[str] = None
    subtype: Optional[str] = None
    brand: Optional[str] = None
    coating: Optional[str] = None
    tool_material: Optional[str] = None  # CARBIDE / HSS / CBN / PCD / CERMET
    shank_type: Optional[str] = None     # Weldon / Cylindrical / Morse Taper / Straight


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
    score: float


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
