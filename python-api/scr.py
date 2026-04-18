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
    return None


def _resolve_brand_alias(brand: str | None) -> str | None:
    """Map a free-form brand token the LLM emitted to the canonical DB value.
    1) exact case-insensitive hit wins,
    2) otherwise a unique prefix match is accepted (e.g. "ALU-CUT" →
       "ALU-CUT for Korean Market"),
    3) else return the original string unchanged.
    If multiple brands share the same prefix we bail out rather than guess."""
    if not brand:
        return brand
    brands = _get_brands()
    if not brands:
        return brand
    target = brand.strip()
    if not target:
        return brand
    target_lc = target.lower()
    # exact match
    for b in brands:
        if b.lower() == target_lc:
            return b
    # unique prefix match
    prefix_hits = [b for b in brands if b.lower().startswith(target_lc)]
    if len(prefix_hits) == 1:
        return prefix_hits[0]
    return brand


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


def _pre_resolve_material(message: str) -> str | None:
    """Fast dict-based material-code lookup. Scans the message for any known
    national-standard code (JIS/DIN/AISI/SS/GB/Material_No) and returns the
    ISO group (P/M/K/N/S/H/O) on first hit, or None.

    Used as a fallback *after* the LLM — so Korean aliases stay the model's
    job, and national codes stay Python's job."""
    if not message:
        return None
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
    """Render SYSTEM_PROMPT_TEMPLATE with live brand list interpolated in.
    Material-code resolution is handled by _pre_resolve_material() outside
    the prompt, keeping the template small (~10KB)."""
    global _PROMPT_CACHE
    if _PROMPT_CACHE is None:
        brands = ", ".join(_get_brands())
        _PROMPT_CACHE = SYSTEM_PROMPT_TEMPLATE.replace("«BRANDS»", brands)
    return _PROMPT_CACHE


SYSTEM_PROMPT_TEMPLATE = """너는 공작기계 절삭공구 추천 시스템의 의도 파서다.
사용자 발화에서 아래 필드를 추출해 **JSON only**로 답한다. 설명 금지.

스키마:
{
  "diameter": number|null,       // mm 단위 공구 직경
  "flute_count": integer|null,   // 날수
  "material_tag": string|null,   // ISO: P/M/K/N/S/H/O
  "tool_type": string|null,      // "Solid" | "Indexable_Tools"
  "subtype": string|null,        // "Ball" / "Square" / "Corner Radius" / "Taper" / "Chamfer" / "High-Feed" / "Roughing"
  "brand": string|null,          // 사용자 언급 브랜드
  "coating": string|null,        // 코팅명 (아래 canonical 값만 사용)
  "tool_material": string|null,  // "CARBIDE" / "HSS" / "CBN" / "PCD" / "CERMET"
  "shank_type": string|null      // "Weldon" / "Cylindrical" / "Morse Taper" / "Straight"
}

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

위 조건 중 하나라도 해당하는데 잘못 출력하면 오답이다.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
예시 입출력:

입력: "sus304 5날 스퀘어"
출력: {"diameter":null,"flute_count":5,"material_tag":"M","tool_type":"Solid","subtype":"Square","brand":null,"coating":null,"tool_material":null,"shank_type":null}

입력: "2날 볼 6mm"
출력: {"diameter":6,"flute_count":2,"material_tag":null,"tool_type":"Solid","subtype":"Ball","brand":null,"coating":null,"tool_material":null,"shank_type":null}

입력: "4G MILL 10mm DLC"
출력: {"diameter":10,"flute_count":null,"material_tag":null,"tool_type":"Solid","subtype":null,"brand":"4G MILL","coating":"DLC","tool_material":null,"shank_type":null}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

- 출력은 JSON 하나만. 설명 텍스트 · 마크다운 · 코드펜스 금지."""


def _extract_json(text: str) -> dict:
    m = re.search(r"\{.*\}", text, re.DOTALL)
    if not m:
        return {}
    try:
        return json.loads(m.group(0))
    except json.JSONDecodeError:
        return {}


def parse_intent(message: str) -> SCRIntent:
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
    return SCRIntent(
        diameter=data.get("diameter"),
        flute_count=data.get("flute_count"),
        material_tag=data.get("material_tag") or pre_material,
        tool_type=data.get("tool_type"),
        subtype=data.get("subtype"),
        brand=_resolve_brand_alias(data.get("brand")) or pre_brand,
        coating=data.get("coating"),
        tool_material=data.get("tool_material"),
        shank_type=data.get("shank_type"),
    )
