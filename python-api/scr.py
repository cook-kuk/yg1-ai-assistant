"""SCR intent parser — OpenAI GPT-5-mini call returns structured JSON.

Model id is read from OPENAI_HAIKU_MODEL to match lib/llm/provider.ts's tier
convention (CLAUDE.md forbids renaming the legacy haiku/sonnet/opus tier
terms). Defaults to gpt-5.4-mini with reasoning_effort=low.

Brand vocabulary is sourced live from product_recommendation_mv so the
prompt always reflects the DB's distinct edp_brand_name set — no hardcoded
YG-1 brand list. Cached in-process after the first lookup.
"""

import os
import json
import re
import csv as csv_mod
from pathlib import Path

from openai import OpenAI
from dotenv import load_dotenv

from schemas import SCRIntent
from db import fetch_all

load_dotenv(Path(__file__).resolve().parent.parent / ".env")

OPENAI_MODEL = os.environ.get("OPENAI_HAIKU_MODEL", "gpt-5.4-mini")

_client: OpenAI | None = None


def _get_client() -> OpenAI:
    global _client
    if _client is None:
        _client = OpenAI(api_key=os.environ.get("OPENAI_API_KEY"))
    return _client


_BRAND_CACHE: list[str] | None = None


def _get_brands() -> list[str]:
    """DISTINCT edp_brand_name from the product MV, lazily cached in-process.
    Degrades to [] if the DB is unreachable so the service still answers."""
    global _BRAND_CACHE
    if _BRAND_CACHE is None:
        try:
            rows = fetch_all(
                "SELECT DISTINCT BTRIM(edp_brand_name) AS b "
                "FROM catalog_app.product_recommendation_mv "
                "WHERE edp_brand_name IS NOT NULL "
                "AND BTRIM(edp_brand_name) <> '' "
                "ORDER BY b"
            )
            _BRAND_CACHE = [r["b"] for r in rows]
        except Exception:
            _BRAND_CACHE = []
    return _BRAND_CACHE


# Generic English nouns that the fuzzy fallback would otherwise prefix-match
# to category-style brands ("tool" → "Tooling System", "mill" → "Milling
# Insert"). These are never brand references — they're the user describing
# what kind of cutter they want. Matched lowercased against the fuzzy-
# candidate regex below, so only ASCII terms need listing.
_BRAND_FUZZY_DENYLIST: set[str] = {
    "tool", "tools", "tooling",
    "mill", "mills", "milling",
    "insert", "inserts",
    "cutter", "cutters",
    "turning",
    "drill", "drills",
    "endmill", "endmills",
}


def _pre_resolve_brand(message: str) -> str | None:
    """Scan the raw message for a DB brand name and return the canonical
    form. Used as a fallback when the LLM returns brand=None.

    Matches in two stages:
      1) longest substring hit — canonical appears verbatim in message
         (e.g. "V7 PLUS" in "V7 PLUS 추천")
      2) uppercase/hyphen prefix — message has an abbreviation that is a
         unique prefix of a canonical (e.g. "ALU-CUT" → "ALU-CUT for
         Korean Market"). Ambiguous multi-match returns None.
    """
    if not message:
        return None
    brands = _get_brands()
    if not brands:
        return None
    msg_lc = message.lower()
    for b in sorted(brands, key=len, reverse=True):
        if len(b) >= 3 and b.lower() in msg_lc:
            return b
    # hyphen/digit-bearing uppercase tokens — the style most YG-1 brands use
    candidates = re.findall(r"[A-Za-z][A-Za-z0-9]*(?:-[A-Za-z0-9]+)+", message)
    for cand in candidates:
        if len(cand) < 3:
            continue
        prefix = cand.lower()
        matches = [b for b in brands if b.lower().startswith(prefix)]
        if len(matches) == 1:
            return matches[0]
    # Fuzzy fallback — handles single-word brand references and typos
    # (e.g. "TITANOX" → "TitaNox-Power" via unique prefix inside the fuzzy
    # resolver, "ALU-PWER" → "ALU-POWER" via Levenshtein). Only scans ASCII
    # brand-like tokens (≥4 chars); the resolver itself rejects noise.
    fuzzy_candidates = re.findall(r"[A-Za-z][A-Za-z0-9-]{3,}", message)
    for cand in fuzzy_candidates:
        if cand.lower() in _BRAND_FUZZY_DENYLIST:
            continue
        resolved = _resolve_brand(cand)
        if resolved:
            return resolved
    return None


# Canonical vocabularies for fuzzy resolve. Brand comes from the DB (see
# _get_brands); shank/coating are fixed per prompt schema.
_SHANK_CANONICAL: list[str] = [
    "Weldon",
    "Cylindrical",
    "Morse Taper",
    "Straight",
    "Flat",
    "Flat (YG-1 Standard)",
    "Flat (DIN 1835B)",
]

_COATING_CANONICAL: list[str] = [
    "TiAlN", "AlTiN", "AlCrN", "TiCN", "TiN", "DLC", "Diamond",
    "T-Coating", "Y-Coating", "X-Coating", "Z-Coating",
    "XC-Coating", "RCH-Coating", "Hardslick",
    "Bright Finish", "Uncoated",
]


def _levenshtein(a: str, b: str) -> int:
    """Plain iterative DP — O(len(a)*len(b)) with O(len(b)) memory. Adequate
    for 79-brand / 16-coating lookups; no dependency."""
    if len(a) < len(b):
        return _levenshtein(b, a)
    prev = list(range(len(b) + 1))
    for i, ca in enumerate(a):
        curr = [i + 1]
        for j, cb in enumerate(b):
            curr.append(min(prev[j + 1] + 1, curr[j] + 1, prev[j] + (ca != cb)))
        prev = curr
    return prev[-1]


def _fuzzy_resolve(
    raw: str | None,
    canonical: list[str],
    *,
    lev_max: int = 2,
    lev_min_target_len: int = 4,
) -> str | None:
    """Generic normalizer for small canonical vocabularies. Stages:
      1) exact
      2) case-insensitive
      3) unique case-insensitive prefix
      4) case-insensitive substring — prefer the longest (most specific) canonical
      5) Levenshtein ≤ lev_max (only when target is ≥ lev_min_target_len)
    Returns None on full miss so the caller can decide to fall back elsewhere.
    """
    if not raw or not canonical:
        return None
    target = raw.strip()
    if not target:
        return None
    target_lc = target.lower()

    # Tiebreak for multi-hit stages: prefer shortest (most general) canonical;
    # on equal length, prefer the form with more lowercase characters (i.e.
    # "TitaNox-Power" wins over its all-caps DB duplicate "TITANOX-POWER").
    def _pick(hits: list[str]) -> str:
        return min(hits, key=lambda c: (len(c), -sum(1 for ch in c if ch.islower())))

    # 1 exact
    for c in canonical:
        if c == target:
            return c
    # 2 case-insensitive exact
    for c in canonical:
        if c.lower() == target_lc:
            return c
    # 3 prefix — accept any hit, disambiguate via _pick. Keeping this over
    # "unique-only" lets "ALU-CUT" resolve even when the DB has
    # "ALU-CUT HPC" alongside; the shorter base form wins.
    prefix_hits = [c for c in canonical if c.lower().startswith(target_lc)]
    if prefix_hits:
        return _pick(prefix_hits)
    # 4 substring — target appears mid-canonical. Require the target to be
    # substantive relative to the canonical (≥5 chars AND ≥half its length)
    # so generic terms like "Flat" don't alias to "DREAM DRILLS-FLAT BOTTOM".
    if len(target_lc) >= 5:
        substr_hits = [
            c for c in canonical
            if target_lc in c.lower() and len(target_lc) * 2 >= len(c)
        ]
        if substr_hits:
            return _pick(substr_hits)
    # 5 Levenshtein — only when target is discriminative. "CBN"(3) fuzzed
    # against "TiN"/"DLC"/"PCD" would all come out within distance 2.
    if len(target_lc) >= lev_min_target_len:
        best = None
        best_dist = lev_max + 1
        for c in canonical:
            d = _levenshtein(target_lc, c.lower())
            if d < best_dist:
                best_dist = d
                best = c
        if best is not None:
            return best
    return None


def _resolve_brand(raw: str | None) -> str | None:
    """Map a free-form brand token the LLM emitted to the canonical DB value
    via exact → ci → prefix → substring → Levenshtein. Returns None on miss
    so the caller can fall through to message-scan (_pre_resolve_brand)."""
    return _fuzzy_resolve(raw, _get_brands())


def _resolve_shank(raw: str | None) -> str | None:
    """Normalize shank_type to canonical; falls through to None on miss."""
    return _fuzzy_resolve(raw, _SHANK_CANONICAL)


def _resolve_coating(raw: str | None) -> str | None:
    """Normalize coating to canonical; falls through to None on miss."""
    return _fuzzy_resolve(raw, _COATING_CANONICAL)


_MATERIAL_LOOKUP: dict[str, str] | None = None


def _normalize_code(value: str) -> str:
    """Alphanumeric-only lowercase key. Strips whitespace + Korean +
    punctuation so 'GB 규격 20' and 'GB 20' both collapse to 'gb20'."""
    return re.sub(r"[^a-z0-9]", "", value.lower())


# GB / SS columns store bare short numerics (e.g. "20", "1311") that would
# match unrelated numbers in messages. Prefixing the standard name restores
# specificity without requiring users to write a specific separator.
_COLUMN_PREFIX: dict[str, str] = {
    "GB": "gb",
    "SS": "ss",
}


def _build_material_lookup() -> dict[str, str]:
    """Load data/material_mapping_lv1_lv2_lv3.csv and return a dict of
    `normalized_code -> ISO_group` covering JIS / DIN / AISI·ASTM·SAE / SS /
    GB / UNE_IHA / Material_No columns. Cached in-process."""
    global _MATERIAL_LOOKUP
    if _MATERIAL_LOOKUP is not None:
        return _MATERIAL_LOOKUP

    csv_path = Path(__file__).resolve().parent / "data" / "material_mapping_lv1_lv2_lv3.csv"
    lookup: dict[str, str] = {}
    try:
        with open(csv_path, encoding="utf-8-sig") as f:
            for row in csv_mod.DictReader(f):
                iso = (row.get("LV1_ISO") or "").strip().upper()
                if iso not in {"P", "M", "K", "N", "S", "H", "O"}:
                    continue
                for col in ("JIS", "DIN", "AISI_ASTM_SAE", "SS", "GB", "UNE_IHA", "Material_No"):
                    val = (row.get(col) or "").strip()
                    if not val or val == "-":
                        continue
                    key = _normalize_code(val)
                    prefix = _COLUMN_PREFIX.get(col, "")
                    if prefix:
                        key = prefix + key
                    # Skip too-short keys (< 3 chars) — e.g. bare "D2" would
                    # be ambiguous with axis/coord labels in messages.
                    if len(key) < 3:
                        continue
                    # First writer wins — CSV column order (JIS first) lets
                    # canonical grade families beat regional lookalikes.
                    lookup.setdefault(key, iso)
    except FileNotFoundError:
        pass
    _MATERIAL_LOOKUP = lookup
    return _MATERIAL_LOOKUP


# Industry slang / Konglish shortcuts. Resolved before the CSV lookup so
# "스뎅 가공" hits M instantly without the regex dance. Keep the terms pure
# Korean / konglish — English aliases are already covered by the CSV file.
_MATERIAL_SLANG: dict[str, str] = {
    "스뎅": "M", "스댕": "M", "스텡": "M", "스텐": "M", "서스": "M",
    "에스유에스": "M", "수스": "M", "스텐레스": "M",
    "알미늄": "N", "두랄루민": "N", "놋쇠": "N",
    "인코": "S", "하스텔로이": "S",
    "초경강": "H", "열처리강": "H", "금형강": "H",
    "주물": "K", "회주철": "K", "덕타일": "K",
}


def _pre_resolve_material(message: str) -> str | None:
    """Fast dict-based material-code lookup. Scans the message for any known
    national-standard code (JIS/DIN/AISI/SS/GB/Material_No) and returns the
    ISO group (P/M/K/N/S/H/O) on first hit, or None.

    Used as a fallback *after* the LLM — so Korean aliases stay the model's
    job, and national codes stay Python's job.

    Resolution order:
      1) hand-curated Korean slang (cheapest, strongest signal)
      2) public.material_aliases DB — 2.6k aliases, authoritative for
         multi-language grade codes (St 37-2, 16MnCr5, SM490YA …)
      3) CSV national-code lookup (CSV SSOT, subset of DB but narrower
         matching semantics — kept as final fallback when the DB load
         failed at init or an alias isn't in the DB set yet)."""
    if not message:
        return None
    # Industry slang first — cheap O(1) per term, covers the "스뎅/서스/알미늄"
    # shortcuts that the CSV-normalized lookup can't see.
    msg_lc = message.lower()
    for term, iso in _MATERIAL_SLANG.items():
        if term in msg_lc:
            return iso
    # DB aliases next — covers ~2.6k standardized grade codes across JIS/DIN/
    # AISI/SS/GB and more. init_resolver() warms the cache at server startup;
    # if that failed for any reason the helper returns None and we fall
    # through to the CSV path.
    try:
        from alias_resolver import find_material_iso_in_text
        db_hit = find_material_iso_in_text(message)
        if db_hit:
            return db_hit
    except Exception:
        pass
    lookup = _build_material_lookup()
    if not lookup:
        return None
    # Same alphanumeric-only normalization as keys — so "GB 규격 20",
    # "GB 20", "GB20" all collapse to "gb20".
    msg_norm = _normalize_code(message)
    if not msg_norm:
        return None
    # Longer codes first so "sm490ya" beats "sm490" if both existed.
    for code in sorted(lookup, key=len, reverse=True):
        if code in msg_norm:
            return lookup[code]
    return None


_PROMPT_CACHE: str | None = None


def reset_prompt_cache() -> None:
    """Drop the rendered-prompt cache so the next call re-reads brands and
    material lookup. Useful in tests or after DB/CSV updates."""
    global _PROMPT_CACHE, _BRAND_CACHE, _MATERIAL_LOOKUP
    _PROMPT_CACHE = None
    _BRAND_CACHE = None
    _MATERIAL_LOOKUP = None


def _system_prompt() -> str:
    """Render SYSTEM_PROMPT_TEMPLATE with live brand list interpolated in,
    then append any persisted few-shot examples. Brand substitution is
    cached (stable per process); few-shots re-read on each call since they
    can change at runtime when add_few_shot() is invoked."""
    global _PROMPT_CACHE
    if _PROMPT_CACHE is None:
        brands = ", ".join(_get_brands())
        _PROMPT_CACHE = SYSTEM_PROMPT_TEMPLATE.replace("«BRANDS»", brands)
    try:
        from few_shot import render_prompt_suffix
        suffix = render_prompt_suffix()
    except Exception:
        suffix = ""
    return _PROMPT_CACHE + suffix


SYSTEM_PROMPT_TEMPLATE = """너는 공작기계 절삭공구 추천 시스템의 의도 파서다.
사용자 발화에서 아래 필드를 추출해 **JSON only**로 답한다. 설명 금지.

스키마:
{
  "intent": string,              // "recommendation" | "general_question" | "domain_knowledge" (필수)
  "diameter": number|null,       // mm 단위 공구 직경
  "flute_count": integer|null,   // 날수
  "material_tag": string|null,   // ISO 그룹: P/M/K/N/S/H/O
  "workpiece_name": string|null, // 구체 피삭재명 (구리/알루미늄/티타늄/인코넬/SUS304 ...). material_tag와 함께 나와야 함.
  "tool_type": string|null,      // "Solid" | "Indexable_Tools"
  "subtype": string|null,        // "Ball" / "Square" / "Corner Radius" / "Taper" / "Chamfer" / "High-Feed" / "Roughing"
  "brand": string|null,          // 사용자 언급 브랜드
  "coating": string|null,        // 코팅명 (아래 canonical 값만 사용)
  "tool_material": string|null,  // "CARBIDE" / "HSS" / "CBN" / "PCD" / "CERMET"
  "shank_type": string|null,     // "Weldon" / "Cylindrical" / "Morse Taper" / "Straight"
  "helix_angle": number|null,    // milling 헬릭스각 (도). "45도 헬릭스", "30° helix"
  "point_angle": number|null,    // drill 선단각 (도). "135도 선단각", "118° point"
  "thread_pitch": number|null,   // tap/thread 피치 (mm). "M8×1.25" → 1.25
  "thread_tpi": number|null,     // inch tap TPI. "1/4-20 UNC" → 20
  "diameter_tolerance": string|null, // "h6"/"h7"/"h8" 등 공차 등급
  "ball_radius": number|null,    // 볼엔드밀 반경 (mm). "R0.5", "R 0.3"
  "unit_system": string|null,    // "Metric" | "Inch"
  "in_stock_only": boolean|null, // "재고 있는 것만" / "in stock"
  "series_name": string|null,    // "GMF52", "V7 PLUS", "X-POWER" 등 시리즈/패밀리 자체를 묻는 경우. 스펙·범위·라인업 질문에서 추출.
  "hardness_hrc": number|null,   // 경도 HRC 수치. "HRC 58 가공용", "로크웰 55", "55HRC" → 55
  "length_of_cut_min": number|null,   // 날장(LOC) 하한 mm. "날장 20 이상" → 20
  "length_of_cut_max": number|null,   // 날장 상한 mm. "날장 30 이하" → 30
  "overall_length_min": number|null,  // 전장(OAL) 하한 mm. "전장 80 이상" → 80
  "overall_length_max": number|null,  // 전장 상한 mm. "전장 100 이하" → 100
  "shank_diameter": number|null,      // 샹크 직경 정확 값 mm. "샹크 8mm", "shank 6"
  "shank_diameter_min": number|null,  // 샹크 하한 mm
  "shank_diameter_max": number|null,  // 샹크 상한 mm
  "cutting_edge_shape": string|null   // 절삭날 형상. "Square"/"Ball"/"Corner Radius"/"Taper"/"Chamfer" — subtype과 같은 값; subtype을 쓰면 이 필드는 null.
}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
intent 판별 (반드시 포함):

- "recommendation"     → 제품 추천·검색·필터링·비교 요청. 소재·직경·브랜드·날수 등 구체적 조건 언급.
- "general_question"   → 절삭공구와 **무관한** 질문 (프로그래밍, 수학, 일반 상식, 잡담 등).
                          이 경우 나머지 필터 필드는 전부 null.
- "domain_knowledge"   → 절삭공구 관련이지만 **특정 제품 검색이 아닌** 질문
                          (떨림 원인, 코팅 비교, 가공 팁, 소재 특성, 용도 분류 등).
                          이 경우 나머지 필터 필드는 전부 null.

예시:
  "0.1 + 0.2 == 0.3?"         → intent="general_question", 나머지 전부 null
  "파이썬 리스트 뒤집는 법"    → intent="general_question", 나머지 전부 null
  "떨림이 심해"                → intent="domain_knowledge", 나머지 전부 null
  "Ball이랑 Square 차이가 뭐야" → intent="domain_knowledge", 나머지 전부 null
  "항공용 tool 추천"           → intent="domain_knowledge", 나머지 전부 null (항공용은 DB 필터가 아님)
  "TiAlN 코팅 특징 설명해줘"   → intent="domain_knowledge", 나머지 전부 null
  "수스 10mm 4날"              → intent="recommendation", material_tag="M", workpiece_name="스테인리스강", diameter=10, flute_count=4
  "CRX-S 알루미늄용 추천"      → intent="recommendation", brand="CRX-S", material_tag="N", workpiece_name="알루미늄"
  "GMF52 시리즈 직경 범위"     → intent="domain_knowledge", series_name="GMF52", 나머지 null (시리즈 자체 스펙 질문)
  "V7 PLUS 헬릭스 몇 도?"      → intent="domain_knowledge", series_name="V7 PLUS"
  "HRC 58 경화강 엔드밀"       → intent="recommendation", material_tag="H", workpiece_name="경화강", hardness_hrc=58
  "55 HRC 가공용 4날"          → intent="recommendation", hardness_hrc=55, flute_count=4
  "날장 20 이상 수스 10mm"     → intent="recommendation", length_of_cut_min=20, material_tag="M", diameter=10
  "전장 100 이하 4날"          → intent="recommendation", overall_length_max=100, flute_count=4
  "LOC 15~25 구리"             → intent="recommendation", length_of_cut_min=15, length_of_cut_max=25, workpiece_name="구리", material_tag="N"
  "샹크 8mm 6mm 4날"           → intent="recommendation", shank_diameter=8, diameter=6, flute_count=4
  "샹크 6~12mm 알루미늄"       → intent="recommendation", shank_diameter_min=6, shank_diameter_max=12, material_tag="N", workpiece_name="알루미늄"
  "볼 절삭날 형상"             → intent="domain_knowledge", cutting_edge_shape="Ball"
  "Corner Radius 4날 10mm"     → intent="recommendation", cutting_edge_shape="Corner Radius", flute_count=4, diameter=10

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
구체 피삭재 (workpiece_name) vs ISO 그룹 (material_tag) — 반드시 **둘 다** 채울 것:

material_tag 는 ISO 7계 그룹(P/M/K/N/S/H/O) 한 글자. 같은 N군이어도 구리냐 알루미늄이냐에
따라 추천 브랜드가 완전히 달라지므로, 사용자가 **구체 재료명**을 말하면 workpiece_name
에도 함께 넣는다. canonical 값(아래 목록) 우선, 없으면 사용자 표기 그대로.

비철(N):  구리 / 알루미늄 / 황동 / 청동 / 마그네슘 / 두랄루민
내열(S):  티타늄 / 인코넬 / 하스텔로이 / 모넬 / 스텔라이트 / 니모닉 / 와스팔로이 / 내열합금
스테(M):  스테인리스 / 스테인리스강 / SUS304 / SUS316 / SUS316L / SUS420 / SUS630 / 17-4PH / duplex / inox
강(P):   탄소강 / 합금강 / 구조용강 / 공구강 / S45C / S50C / SM45C / SCM415 / SCM440
주철(K): 주철 / 회주철 / 구상흑연주철 / 가단주철 / FC200 / FCD400 / 덕타일
경화(H): 경화강 / 열처리강 / 고경도강 / 금형강 / SKD11 / SKD61 / HPM / STAVAX / H13 / D2
기타(O): CFRP / GFRP / 복합재 / 아크릴 / 플라스틱 / 그라파이트 / 흑연 / 세라믹

예시:
  "구리 10mm 추천"            → workpiece_name="구리", material_tag="N"
  "SUS304 4날"                → workpiece_name="SUS304", material_tag="M"
  "인코넬 황삭"               → workpiece_name="인코넬", material_tag="S"
  "S45C 6mm"                  → workpiece_name="S45C", material_tag="P"
  "수스 10mm"                 → workpiece_name="스테인리스강", material_tag="M"  (축약은 canonical 로 정규화)
  "알루미늄 SUS304 혼합"      → workpiece_name="알루미늄", material_tag="N"    (**먼저** 언급된 것 우선)
  "금속 가공"                 → workpiece_name=null, material_tag=null         (추상 표현은 null)

규칙:
  - material_tag 만 채우고 workpiece_name 을 null 로 두지 말 것. 구체 이름이 있으면 둘 다 채움.
  - 반대로, 구체 이름이 없고 ISO 만 유추 가능한 경우는 material_tag 만 채우고 workpiece_name=null 허용.
    (예: "피삭재 N군 공구" → material_tag="N", workpiece_name=null)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
ISO 재질 그룹 매핑 (material_tag):

P = 일반강 / 강종
  탄소강 · carbon steel · S45C · S50C · SM45C · SK3 · SK5
  합금강 · alloy steel · SCM415 · SCM440 · SNCM439 · SUJ2
  구조용강 · 공구강 · tool steel · SKD11(P) · 크롬몰리 · CrMo

M = 스테인리스
  스테인리스 · 스테인리스강 · 스텐 · 스뎅 · 수스
  SUS · SUS304 · SUS316 · SUS316L · SUS420 · SUS630
  STS · STS304 · stainless · inox · 17-4PH · duplex

K = 주철
  주철 · cast iron · 회주철 · 구상흑연주철 · 가단주철
  FC · FC200 · FC250 · FCD · FCD400 · FCD450 · 덕타일 · ductile

N = 비철
  알루미늄 · 알미늄 · aluminum · aluminium · 두랄루민 · duralumin
  A2024 · A5052 · A6061 · A7075
  구리 · copper · 황동 · brass · 청동 · bronze · Cu
  마그네슘 · magnesium · AZ31 · AZ91

S = 내열/티타늄
  티타늄 · titanium · Ti6Al4V · Ti
  인코넬 · inconel · IN718 · IN625 · Inco 718
  하스텔로이 · hastelloy · monel · stellite · nimonic · waspaloy
  내열합금 · 초내열 · heat-resistant · HRSA · nickel alloy · 니켈합금

H = 경화강
  경화강 · 열처리강 · hardened · 고경도 · 고경도강
  HRC45 · HRC50 · HRC55 · HRC60 · HRC65 (HRC40 이상)
  금형강 · mold steel · die steel
  P20 · NAK80 · STAVAX · HPM · SKD11 · SKD61 · SKH51 · H13 · D2

O = 기타
  CFRP · GFRP · KFRP · 복합재 · honeycomb · 허니컴
  아크릴 · acrylic · 플라스틱 · plastic
  그라파이트 · graphite · 흑연 · 세라믹 · ceramic · sialon · Si3N4

※ 국가별 규격 코드(JIS / DIN / AISI·ASTM·SAE / SS / GB / Material_No) 는
   Python 쪽에서 material_mapping CSV 로 직접 처리한다. 모르면 null 로 둘 것 —
   후처리에서 채워 넣는다.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
공구 형상 (subtype) — 날 끝 형태. 아래 canonical 값만 사용:

Ball           ← 볼 · 볼노즈 · 볼엔드밀 · 볼 엔드밀 · ball · ballnose · ball nose · ball end mill
Square         ← 스퀘어 · 스퀘어엔드밀 · 평엔드밀 · 플랫 · 플랫엔드밀 · flat · square · flat end mill · square end mill
Corner Radius  ← 코너R · 코너r · 코너 레디우스 · 코너레디우스 · 코너 반경 · 코너반경 · 라디우스 · radius · corner radius
Taper          ← 테이퍼 · 테이퍼엔드밀 · taper · taper end mill
Chamfer        ← 챔퍼 · chamfer · 모따기 · 면취
High-Feed      ← 하이피드 · 하이 피드 · high-feed · high feed · 고이송
Roughing       ← 황삭 · 황삭엔드밀 · 러핑 · roughing · rough

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
공구 형태 (tool_type):

Solid            ← 엔드밀 · 드릴 · 탭 · 리머 · end mill · endmill · drill · tap · tapping · reamer
                   (절삭날이 일체형인 솔리드 공구 전체)
Indexable_Tools  ← 인덱서블 · indexable · 인서트 · insert · 페이스밀 · face mill · 보링바

"엔드밀"만 언급되면 tool_type="Solid", subtype=null.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
공구 재질 (tool_material) — DB canonical 값만 출력:

CARBIDE  ← 초경 · 초경합금 · 카바이드 · carbide · cemented carbide · tungsten carbide · 텅스텐 카바이드
HSS      ← 고속도강 · 하이스 · high speed steel · HSS · HSS-CO · HSS-E · HSS-EX · HSS-PM · SUPER-HSS · Premium HSS
CBN      ← CBN · 씨비엔 · 큐빅 보론 · cubic boron nitride
PCD      ← PCD · 다이아몬드 · diamond · polycrystalline diamond · 폴리크리스탈 다이아몬드
CERMET   ← 서멧 · cermet

※ tool_material 은 **공구 본체의 소재** (피삭재 material_tag 와 구분). 둘 다 나올 수 있음.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
YG-1 브랜드 목록 (brand) — DB(product_recommendation_mv.edp_brand_name) 에 실재하는 값.
사용자가 아래 중 하나를 언급하면 brand 필드에 반드시 넣을 것:

«BRANDS»

하이픈/공백 변형(`CRX S` ↔ `CRX-S`, `TITANOX-POWER` ↔ `TitaNox-Power`)은 원문 표기 그대로 출력.

※ 주의 — 일반 명사는 브랜드가 아니다:
  "tool" · "Tool" · "공구" · "엔드밀" · "드릴" · "인서트" 같은 일반 명사는 **절대** brand 로 넣지 말 것.
  brand 에는 반드시 위 «BRANDS» 목록에 있는 값만 넣는다.
  예: "항공용 tool 추천" → brand=null (※ "tool" 을 "Tooling System" 으로 매핑하지 말 것)
      "엔드밀 추천"     → brand=null
      "인서트 필요해"   → brand=null
  "Milling Insert", "ADKT Cutter", "Morse Taper Shank Drills", "Tooling System", "Turning" 같은
  카테고리성 브랜드는 사용자가 **명시적으로 해당 이름을 그대로** 언급한 경우에만 brand 로 넣는다.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
샹크 타입 (shank_type) — 공구 자루 형태:

Weldon       ← 웰돈 · 웰던 · weldon
Cylindrical  ← 원통 · 실린더 · 실린더 샹크 · cylindrical · 원형 샹크
Morse Taper  ← 모스 테이퍼 · 모스테이퍼 · morse taper · MT
Straight     ← 스트레이트 · 일직선 · straight shank
Flat         ← 플랫 · 플랫 샹크 · flat · Flat (YG-1 Standard) · Flat (DIN 1835B)
             (메시지에 위 괄호 포함 풀네임이 나오면 괄호 포함 원문 그대로 출력)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
코팅 (coating) — DB canonical 값만 출력. **코팅 표현이 있으면 반드시 채울 것, null 금지**:

TiAlN · AlTiN · AlCrN · TiCN · TiN · DLC · Diamond
T-Coating · Y-Coating · X-Coating · Z-Coating · XC-Coating · RCH-Coating · Hardslick
Bright Finish · Uncoated

한글 · 축약 변형 매핑:
  티알엔 → TiAlN
  알틴 · 알티엔 → AlTiN
  알크롬 · 와이코팅 · Y코팅 → Y-Coating  (= AlCrN)
  티씨엔 · 씨코팅 · C코팅 → TiCN
  티엔 → TiN
  엑스코팅 · X코팅 · X-coating → X-Coating  (= TiAlN 계열)
  티코팅 · T코팅 · T-coating → T-Coating
  지코팅 · Z코팅 · Z-coating → Z-Coating
  디엘씨 · 다이아몬드라이크카본 · dlc → DLC
  브라이트 · bright · bright finish · 무코팅 · 코팅없음 → Bright Finish (코팅없음·무코팅·Uncoated 는 Uncoated)
  하드슬릭 · hardslick → Hardslick

규칙: "T코팅" "T-Coating" "Bright" "브라이트" "DLC" 처럼 코팅을 명시하는 표현이 조금이라도 있으면 coating 필드는 반드시 canonical 값으로 채운다. 모르겠으면 null 이 아니라 가장 가까운 canonical 선택.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
숫자 파싱:

직경 (diameter, mm):
  "10mm" · "10 mm" · "φ10" · "ø10" · "Φ10" · "D10" · "파이10" · "10파이" · "직경 10" · "지름 10" → 10
  공구 맥락에서 숫자만 있으면 diameter 로.
  한글 수사: 한/두/세/네/다섯/여섯/일곱/여덟/아홉/열 파이 = 1~10

날수 (flute_count) — **절대 놓치지 말 것. 숫자가 "날" 바로 앞에 있으면 반드시 추출**:
  "4날" · "4 날" · "4F" · "4f" · "4 flute" · "4플루트" · "날수 4" · "4낭"(오타) → 4
  한글 수사: 한날/두날/세날/네날/다섯날 = 1~5
  영문 수사: one flute / two flute / three flute / four flute / five flute / six flute → 1~6

  실제 예시:
    "sus304 5날 스퀘어"        → flute_count=5
    "2날 볼"                   → flute_count=2
    "three flute"              → flute_count=3
    "4mm 2F 엔드밀"            → flute_count=2
    "6날 스테인리스"           → flute_count=6
    "phi 16 Radius, 4날"       → flute_count=4

  규칙: 메시지 어디든 [숫자]+[날|F|f|flute|플루트] 패턴이 보이면 flute_count 는 절대 null 이 아니다.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
치수·각도·나사 스펙 추출 (P0/P1 필드):

헬릭스각 (helix_angle, 도):
  "45도 헬릭스" · "30° helix" · "헬릭스 45°" · "35 deg helix" → 숫자만 추출
  "하이 헬릭스" · "low helix" 같은 형용사만 있으면 null.

선단각 / 포인트각 (point_angle, 도):
  "135도 선단각" · "118° point" · "point angle 140" · "선단각 130도" → 숫자만 추출

나사 피치 (thread_pitch, mm):
  "M8×1.25" → 1.25
  "M6x1.0" / "M6*1.0" / "피치 1.5" / "pitch 1.25mm" / "P=1.25" → 숫자만

TPI (thread_tpi):
  "1/4-20 UNC" → 20
  "20 TPI" / "TPI 24" / "20 UNF" → 숫자만
  UNC/UNF/BSP/G 등 규격 이름 자체는 무시하고 숫자만 추출.

직경공차 (diameter_tolerance):
  "h7" · "h8" · "h6" · "H7" · "H8" — 알파벳+숫자 페어를 원문 그대로 (대문자 H·h 구분 유지).
  "±0.01" 같은 값만 있으면 null.

볼반경 (ball_radius, mm):
  "R0.5" · "R 0.3" · "R=1.0" · "볼반경 0.5" · "ball radius 0.2" → 숫자만
  "R1/2" 같은 분수는 mm로 변환 (R 1/2 → 12.7).
  반경 언급 없이 "Ball" 만 있으면 ball_radius=null, subtype="Ball" 만 채움.

단위계 (unit_system):
  "인치", "inch", "imperial" → "Inch"
  "미터", "메트릭", "metric", "mm 기준" → "Metric"
  둘 다 언급 없으면 null.

재고 한정 (in_stock_only, boolean):
  "재고 있는 것만" · "재고있는거만" · "stock 있는거" · "in stock" · "available now" · "당장 되는 거" → true
  "재고 없어도 돼" · "all products" 등은 false 또는 null.
  언급 없으면 null (false 아님).

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
부정 조건 처리 (반드시 준수):

유저가 아래 키워드와 함께 브랜드/코팅/형상/재질을 언급하면, 해당 값은 **검색에서 제외할 항목**이지
검색 조건이 아니다. 해당 필드를 필터에 넣지 말고 **null 로** 반환하라.

부정 키워드: "말고" · "제외" · "빼고" · "아닌" · "아니고" · "없이" · "제외하고"
             · "필요 없" · "원치 않" · "원하지 않" · "안 써" · "싫어"
             · "no" · "not" · "except" · "without"

예시:
  "CRX-S 말고 TiAlN 코팅"       → brand=null, coating="TiAlN"
  "V7 PLUS no, DLC yes"         → brand=null, coating="DLC"
  "4G MILL 말고 X-Coating"      → brand=null, coating="X-Coating"
  "ALU-CUT 제외하고 추천"       → brand=null
  "TiAlN 빼고 DLC로 해줘"       → coating="DLC"  (TiAlN 은 제외 대상)
  "스퀘어 말고 볼"              → subtype="Ball"  (스퀘어는 제외 대상)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
규칙:
- 매핑 표에 없는 재질/형상 표현은 null.
- 확실하지 않은 필드는 null (추측 금지).

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
추출 체크리스트 — JSON 출력 전에 반드시 확인:

1. 메시지에 숫자+날/F/f/flute 패턴이 있는가? → 있으면 flute_count 필수
2. 메시지에 숫자+mm/파이/phi/직경 패턴이 있는가? → 있으면 diameter 필수
3. 메시지에 코팅 관련 단어가 있는가? → 있으면 coating 필수
4. 메시지에 소재 관련 단어가 있는가? → 있으면 material_tag 필수
5. "말고/제외/빼고/아닌/not/except/no" 뒤에 나오는 브랜드/코팅은 제외 대상이다 → 해당 필드를 null로 둘 것. "X 말고"에서 X를 brand에 넣으면 오답.
6. 분수 인치 → mm 자동 환산: 1/4인치=6.35, 1/2인치=12.7, 1/8인치=3.175, 3/8인치=9.525, 3/4인치=19.05
7. 숫자+도/°/deg 패턴이 헬릭스/helix 근처면 helix_angle, 선단/point 근처면 point_angle.
8. M숫자×숫자 또는 "M6x1.0" 패턴이면 diameter=첫 숫자(6), thread_pitch=둘째 숫자(1.0).
9. "R숫자" 패턴 + 볼/ball 맥락이면 ball_radius. 단독 R 만 있고 볼 맥락 없으면 subtype="Corner Radius" 우선.
10. "h7"/"h8"/"h6"/"H7" 문자열이 메시지에 있으면 diameter_tolerance 필수.
11. "재고", "stock", "in stock", "available" 언급 → in_stock_only=true.
12. "인치/inch/imperial" → unit_system="Inch", "메트릭/metric" → unit_system="Metric".

위 조건 중 하나라도 해당하는데 잘못 출력하면 오답이다.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
예시 입출력:

입력: "sus304 5날 스퀘어"
출력: {"intent":"recommendation","diameter":null,"flute_count":5,"material_tag":"M","workpiece_name":"SUS304","tool_type":"Solid","subtype":"Square","brand":null,"coating":null,"tool_material":null,"shank_type":null}

입력: "2날 볼 6mm"
출력: {"intent":"recommendation","diameter":6,"flute_count":2,"material_tag":null,"workpiece_name":null,"tool_type":"Solid","subtype":"Ball","brand":null,"coating":null,"tool_material":null,"shank_type":null}

입력: "4G MILL 10mm DLC 구리"
출력: {"intent":"recommendation","diameter":10,"flute_count":null,"material_tag":"N","workpiece_name":"구리","tool_type":"Solid","subtype":null,"brand":"4G MILL","coating":"DLC","tool_material":null,"shank_type":null}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

- 출력은 JSON 하나만. 설명 텍스트 · 마크다운 · 코드펜스 금지."""


# Korean-word → digit for flute counts. The LLM sometimes misses these so
# we normalize the message BEFORE sending it to the model. Regex-only
# because "두날" ↔ "2날" is a deterministic token rewrite — no ambiguity.
_KR_FLUTE_RE = re.compile(r"(한|두|세|네|다섯|여섯|일곱|여덟)\s*날")
_KR_NUM: dict[str, str] = {
    "한": "1", "두": "2", "세": "3", "네": "4",
    "다섯": "5", "여섯": "6", "일곱": "7", "여덟": "8",
}


def _normalize_korean(msg: str) -> str:
    def _repl(m: re.Match) -> str:
        return _KR_NUM.get(m.group(1), m.group(1)) + "날"
    return _KR_FLUTE_RE.sub(_repl, msg)


def _extract_json(text: str) -> dict:
    m = re.search(r"\{.*\}", text, re.DOTALL)
    if not m:
        return {}
    try:
        return json.loads(m.group(0))
    except json.JSONDecodeError:
        return {}


# Korean negation cues appear AFTER the excluded term ("CRX-S 말고 …"), so
# only the token that precedes the cue should be nulled. English cues appear
# BEFORE the excluded term ("no DLC"), so the token that follows the cue is
# the excluded one. Splitting the two direction classes prevents "말고" from
# wrongly excluding the term that comes *after* it (the user's actual pick).
_NEG_CUE_KR_AFTER = re.compile(
    r"(말고|제외|빼고|아닌|아니고|없이|제외하고|필요\s*없|원치\s*않|원하지\s*않|안\s*써|싫어)",
)
_NEG_CUE_EN_BEFORE = re.compile(
    r"(\bno\b|\bnot\b|\bexcept\b|\bwithout\b)",
    re.IGNORECASE,
)


def _is_brand_excluded(message: str, brand: str) -> bool:
    """True when `brand` is positioned as the excluded term in the message.
    Checks two direction patterns:
      KR: "<brand> 말고 …"  — cue comes within 15 chars AFTER brand.
      EN: "no/not <brand>"  — cue comes within 15 chars BEFORE brand.
    """
    if not message or not brand:
        return False
    msg_lc = message.lower()
    b_lc = brand.lower()
    variants = {
        b_lc,
        b_lc.replace("-", " "),
        b_lc.replace(" ", "-"),
        b_lc.replace(" ", "").replace("-", ""),
    }
    # Covers resolver-expanded forms — the LLM (or _pre_resolve_brand) can
    # emit a long alias like "ALU-CUT for Korean Market" for a message that
    # only says "ALU-CUT 말고 …". Adding the leading token lets negation
    # still trigger. Safe because proximity (15-char window around the cue)
    # prevents spurious matches on unrelated short tokens.
    first_token = b_lc.split(" ", 1)[0]
    if first_token and first_token != b_lc:
        variants.add(first_token)
    for variant in variants:
        pos = msg_lc.find(variant)
        if pos < 0:
            continue
        # KR — cue AFTER the brand
        tail = msg_lc[pos + len(variant): pos + len(variant) + 15]
        if _NEG_CUE_KR_AFTER.search(tail):
            return True
        # EN — cue BEFORE the brand
        head = msg_lc[max(0, pos - 15): pos]
        if _NEG_CUE_EN_BEFORE.search(head):
            return True
    return False


def _embed_resolve(field: str, raw: str | None, threshold: float = 0.75) -> str | None:
    """Thin wrapper around alias_resolver.resolve with import-time safety:
    if the module or embedding API is unavailable we fail quiet and return
    None so the fuzzy result (or the raw LLM value) wins."""
    if not raw:
        return None
    try:
        from alias_resolver import resolve
        return resolve(field, raw, threshold=threshold)
    except Exception:
        return None


def parse_intent(message: str) -> SCRIntent:
    # Preprocess Korean-word flute counts into digits so the LLM always
    # sees "2날" regardless of how the user spelled it ("두날"/"두 날"/"2날").
    message = _normalize_korean(message)
    # Pre-resolve national-standard material codes deterministically;
    # the LLM fills in Korean aliases on its side. If the LLM returns
    # material_tag=null, we fall back to this pre-resolution.
    pre_material = _pre_resolve_material(message)
    # Same pattern for brands — the LLM often leaves brand=null when the
    # message only contains a brand abbreviation. Scanning DB brands
    # directly covers that gap.
    pre_brand = _pre_resolve_brand(message)
    client = _get_client()
    resp = client.chat.completions.create(
        model=OPENAI_MODEL,
        messages=[
            {"role": "system", "content": _system_prompt()},
            {"role": "user", "content": message},
        ],
        response_format={"type": "json_object"},
        reasoning_effort="low",
        # NOTE: gpt-5.4-mini rejects custom temperature — only default (1) allowed.
    )
    text = resp.choices[0].message.content or ""
    data = _extract_json(text)

    # Fuzzy (fast path) — handles exact/ci/prefix/substring/Levenshtein.
    raw_brand = data.get("brand")
    raw_subtype = data.get("subtype")
    raw_coating = data.get("coating")

    # Negation gate BEFORE alias expansion: if the raw LLM value is clearly
    # excluded in the message ("ALU-CUT 말고 …"), null it now so the aliaser
    # can't expand a ghost brand ("ALU-CUT" → "ALU-CUT for Korean Market")
    # and defeat the post-resolution negation check — which searches for the
    # expanded string that no longer appears verbatim in the message.
    if raw_brand and _is_brand_excluded(message, raw_brand):
        raw_brand = None
    if raw_coating and _is_brand_excluded(message, raw_coating):
        raw_coating = None

    resolved_brand = _resolve_brand(raw_brand)
    resolved_coating = _resolve_coating(raw_coating)

    # Embedding (slow path) — only runs when fuzzy couldn't map the LLM's
    # raw emission to a canonical value. Covers cases the string-match
    # chain can't (e.g. Korean transliteration "크룩스 에스" → "CRX-S").
    if raw_brand and not resolved_brand:
        resolved_brand = _embed_resolve("brand", raw_brand)
    if raw_coating and not resolved_coating:
        resolved_coating = _embed_resolve("coating", raw_coating)
    # Subtype has no fuzzy layer — let embedding normalize the LLM output
    # directly so DB-canonical values like "Square End Mill" vs "Square"
    # stay consistent with the search path.
    resolved_subtype = raw_subtype
    if raw_subtype:
        hit = _embed_resolve("subtype", raw_subtype)
        if hit:
            resolved_subtype = hit

    # Negation sweep — if the LLM emitted a brand that the user was clearly
    # excluding ("CRX-S 말고 …"), drop it. Same for coating.
    final_brand = resolved_brand or pre_brand
    if final_brand and _is_brand_excluded(message, final_brand):
        final_brand = None
    final_coating = resolved_coating
    if final_coating and _is_brand_excluded(message, final_coating):
        final_coating = None

    def _as_float(v):
        try:
            return float(v) if v is not None else None
        except (TypeError, ValueError):
            return None

    def _as_bool(v):
        if isinstance(v, bool):
            return v
        if isinstance(v, str):
            s = v.strip().lower()
            if s in ("true", "yes", "on", "1"):
                return True
            if s in ("false", "no", "off", "0"):
                return False
        return None

    return SCRIntent(
        intent=data.get("intent") or "recommendation",
        diameter=data.get("diameter"),
        flute_count=data.get("flute_count"),
        material_tag=data.get("material_tag") or pre_material,
        workpiece_name=data.get("workpiece_name"),
        tool_type=data.get("tool_type"),
        subtype=resolved_subtype,
        brand=final_brand,
        coating=final_coating,
        tool_material=data.get("tool_material"),
        shank_type=_resolve_shank(data.get("shank_type")),
        helix_angle=_as_float(data.get("helix_angle")),
        point_angle=_as_float(data.get("point_angle")),
        thread_pitch=_as_float(data.get("thread_pitch")),
        thread_tpi=_as_float(data.get("thread_tpi")),
        diameter_tolerance=(data.get("diameter_tolerance") or None) or None,
        ball_radius=_as_float(data.get("ball_radius")),
        unit_system=(data.get("unit_system") or None) or None,
        in_stock_only=_as_bool(data.get("in_stock_only")),
        series_name=(data.get("series_name") or None) or None,
        hardness_hrc=_as_float(data.get("hardness_hrc")),
        length_of_cut_min=_as_float(data.get("length_of_cut_min")),
        length_of_cut_max=_as_float(data.get("length_of_cut_max")),
        overall_length_min=_as_float(data.get("overall_length_min")),
        overall_length_max=_as_float(data.get("overall_length_max")),
        shank_diameter=_as_float(data.get("shank_diameter")),
        shank_diameter_min=_as_float(data.get("shank_diameter_min")),
        shank_diameter_max=_as_float(data.get("shank_diameter_max")),
        cutting_edge_shape=(data.get("cutting_edge_shape") or None) or None,
    )
