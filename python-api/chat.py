"""Chat-response generator — wraps GPT-5.4-mini (reuses OPENAI_API_KEY).

Composes a short Korean answer for the chat UI from:
  - the user's original message
  - extracted SCR intent (SCRIntent model)
  - ranked product candidates (from rank_candidates)
  - domain-knowledge hits (from rag.search_knowledge)
  - totalCount / relaxed_fields metadata

Returns a dict with {answer, reasoning, chips, refined_filters}. `answer` is
what the UI prints, `chips` are one-click refinement suggestions, and
`refined_filters` lets downstream re-run the search with the new filter set
(e.g. when the user asked for something unavailable and we relaxed a field).
"""
from __future__ import annotations

import json
import os
import re
from pathlib import Path
from typing import Any

from openai import OpenAI
from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parent.parent / ".env")

OPENAI_MODEL = os.environ.get("OPENAI_HAIKU_MODEL", "gpt-5.4-mini")

_client: OpenAI | None = None


def _get_client() -> OpenAI:
    global _client
    if _client is None:
        _client = OpenAI(api_key=os.environ.get("OPENAI_API_KEY"))
    return _client


SYSTEM_PROMPT = """너는 YG-1 절삭공구 영업 어시스턴트다. 절삭공구 전문가답게 친절하게 응대한다.

원칙:
1. "제품 없습니다"로 끝내지 마라. 0건은 유도 질문의 시작이다.
2. context에 [산업 지식]/[소재 지식]이 있으면 explanation과 followup을 활용해 자연스럽게 답하고 material_chips를 칩으로 제안해라.
3. context 없이 산업/소재 매핑을 추측하지 마라.
4. DB에 없는 직경/조건은 "가장 가까운 XX로 살펴보시겠어요?" 형태로 유도해라.
5. 존재하지 않는 제품 코드는 절대 언급하지 마라.
6. [meta].intent 에서 brand/subtype/coating 이 null 인데 [질문] 에 브랜드/형상/코팅처럼 보이는 단어(한글 음역 포함, 예: "크룩스 에스", "엑스파워", "모따기", "알크롬")가 있으면, "브랜드를 정확히 확인하지 못했습니다" 식으로 한 문장 먼저 덧붙이고, [facets] 의 해당 필드 상위 3~4개 값을 chips 로 제안해 유저가 한 번의 클릭으로 확정하도록 유도해라. 예: 유저 "크룩스 에스 구리" → intent.brand=null, material=N → "구리(N) 소재로 자주 쓰이는 브랜드 중에 찾으시는 게 있을까요?" → chips: 상위 브랜드 3~4개 + "전체 보기". [facets] 가 비어 있으면 top_products 의 distinct brand 에서 뽑아라. 임의의 브랜드명을 지어내지 마라.
7. 출처 표기 — answer 본문 안에서 근거 유형을 자연스럽게 밝힐 것. 확실한 정보(DB/카탈로그)와 추론을 문장 수준에서 구분해라. 근거 없이 단정하지 말 것.
   - **DB/카탈로그 기반**: "카탈로그 기준 234건 중…", "YG-1 제품 DB에 따르면…"
   - **도메인 지식** (troubleshooting/operation-guide/industry/material 등): "YG-1 가공 가이드에 따르면…"
   - **절삭조건 DB** (cutting_conditions 있을 때): "권장 절삭조건은 Vc=120m/min (YG-1 카탈로그 기준)"
   - **웹 검색** (knowledge type=web_search): "업계 일반적으로는…"으로 유도, 단정 금지
   - **LLM 추론**: "경험적으로…" / "일반적으로…" 로 표시

8. 재고 안내 — top_products 의 `stock_status` 가 있으면 1~2위 제품에 한해 자연스럽게 덧붙여라. "재고 N개 (창고 M곳)" 식으로 짧게. 규칙:
   - stock_status="instock" → "재고 여유 있음" 또는 "재고 {total_stock}개(창고 {warehouse_count}곳)"
   - stock_status="limited" → "재고 소량(남은 {total_stock}개)" — 결정 재촉 유도 가능
   - stock_status="outofstock" → "현재 재고 없음, 납기 확인 필요"
   - stock_status 가 null 이면 재고 언급 금지 (스냅샷 없는 제품에 확신 부여 금지).

9. [용어] 블록이 있으면 사용자가 용어 정의를 물은 것이다. definition_ko(없으면 definition_en)를 자연스러운 문장으로 옮기되, "YG-1 제공" 줄을 한 문장 덧붙여 YG-1이 해당 축을 어떻게 커버하는지 연결한다. 추천 제품을 나열하지 말 것(용어 답변이 우선).

10. [시리즈 프로파일] 블록이 있으면 사용자가 특정 시리즈의 스펙/범위를 물은 것이다. summary 문자열의 수치(직경/섕크/LOC/OAL/헬릭스/날수/재질)를 그대로 인용하고 description/feature가 있으면 한두 문장으로 요약. "정확한 스펙은 YG-1 시리즈 프로파일(series_profile_mv) 기준"이라고 출처를 명시할 것. EDP 추천 나열 금지 — 유저가 시리즈 자체를 물은 것.

11. [clarify] 블록이 있으면 그건 "DB 관점에서 지금 조건이 너무 느슨해 후보가 {candidate_count}개 남아있다"는 뜻이다.
   그대로 두고 top-10 추천만 주지 마라. 반드시 한 문장으로 "현재 {candidate_count}건 후보가 있어요 — DB에서 좁혀볼 수 있는 조건은 아래입니다" 식으로 설명하고, [clarify] 의 각 필드별 상위 값을 chips 로 제안해라.
   chip 레이블은 "{label}: {value}" 형식으로 간결하게 (예: "헬릭스각: 30", "직경공차: h7", "볼반경: 0.5"). 숫자 필드는 단위 없이 DB 원문 값 그대로.
   [clarify] 가 비어 있으면 (candidate_count 가 작으면) 이 원칙은 무시하고 기존 추천 원칙을 따른다.

12. [재고 요약] 블록이 있으면 answer 첫 문단 어딘가에 "조건에 맞는 {total}건 중 {in_stock}건({pct}%)이 재고 있음" 식으로 한 문장 포함해라.
   pct 가 0 이면 "즉시 출고 가능한 재고는 없어 납기 확인이 필요합니다" 로 전환. pct 가 100 이면 "모두 재고 확보" 식으로 간결하게. 숫자는 블록에 적힌 값 그대로 인용.

13. [절삭조건 참고범위] 블록이 있으면 **반드시** answer 마지막 줄에 한 문장으로 "YG-1 카탈로그 기준 Vc={vc_min}~{vc_max} m/min, fz={fz_min}~{fz_max} mm/tooth, RPM={n_min}~{n_max} 범위입니다 (YG-1 카탈로그 절삭조건표 {row_count}행 기준)" 형식으로 추가해라.
   범위가 넓더라도 생략하지 마라 — 유저가 "어디부터 시작할지" 감을 잡게 해 주는 게 목적이다. 값 일부가 null 이면 있는 항목만 인용. 숫자를 지어내지 말 것.

응답은 JSON: {"answer": "...", "reasoning": "...", "chips": [...], "refined_filters": null | {...}}"""


def _extract_json(text: str) -> dict:
    m = re.search(r"\{.*\}", text, re.DOTALL)
    if not m:
        return {}
    try:
        return json.loads(m.group(0))
    except json.JSONDecodeError:
        return {}


def _summarize_intent(intent) -> dict:
    """Pick just the fields that matter for the prompt — avoids dumping
    pydantic internals and keeps the context small."""
    if intent is None:
        return {}
    getv = getattr
    return {
        "diameter": getv(intent, "diameter", None),
        "flute_count": getv(intent, "flute_count", None),
        "material_tag": getv(intent, "material_tag", None),
        "subtype": getv(intent, "subtype", None),
        "brand": getv(intent, "brand", None),
        "coating": getv(intent, "coating", None),
        "tool_type": getv(intent, "tool_type", None),
        "tool_material": getv(intent, "tool_material", None),
        "shank_type": getv(intent, "shank_type", None),
    }


def _stock_status_for_prompt(total_stock) -> str | None:
    """Mirror main._derive_stock_status so the prompt sees the same buckets
    the UI card does. Kept here (not imported) to avoid a chat→main cycle."""
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


def _summarize_products(products: list[dict], limit: int = 5) -> list[dict]:
    """Compact product preview for the prompt — drops heavy fields like
    description/feature and keeps only what distinguishes candidates."""
    out: list[dict] = []
    for p in (products or [])[:limit]:
        if not isinstance(p, dict):
            continue
        total_stock = p.get("total_stock")
        status = p.get("stock_status") or _stock_status_for_prompt(total_stock)
        out.append({
            "edp_no": p.get("edp_no"),
            "brand": p.get("brand"),
            "series": p.get("series"),
            "subtype": p.get("subtype"),
            "diameter": p.get("diameter"),
            "flutes": p.get("flutes"),
            "coating": p.get("coating"),
            # Inventory fields — principle 8 tells the LLM to quote these
            # verbatim on the top-ranked card when available. Omitted keys
            # leave it silent, which is what we want for stale rows.
            "total_stock": total_stock,
            "warehouse_count": p.get("warehouse_count"),
            "stock_status": status,
            "score": p.get("score"),
        })
    return out


def _build_context_blocks(knowledge: list[dict] | None) -> str:
    """Render knowledge hits as readable [산업 지식] / [소재 지식] / [웹검색]
    blocks. The prompt explicitly instructs the model to consume these
    sections, so keep the field labels literal and stable."""
    if not knowledge:
        return "(no domain knowledge)"
    blocks: list[str] = []
    for item in knowledge:
        k_type = item.get("type") or ""
        d = item.get("data") or {}
        if k_type == "industry_guide":
            blocks.append(
                f"[산업 지식] {d.get('industry_ko','')}\n"
                f"explanation: {d.get('explanation_ko','')}\n"
                f"followup: {d.get('followup_template_ko','')}\n"
                f"material_chips: {d.get('material_chips_ko',[])}\n"
                f"yg1_hint: {d.get('yg1_recommendation_hint','')}"
            )
        elif k_type == "material_guide":
            coatings = d.get("recommended_coating") or []
            blocks.append(
                f"[소재 지식] {d.get('material_ko','')} (ISO {d.get('iso_group','')})\n"
                f"explanation: {d.get('explanation_ko','')}\n"
                f"Vc: {d.get('cutting_speed_range','')}\n"
                f"coating: {', '.join(coatings)}\n"
                f"yg1_hint: {d.get('yg1_recommendation_hint','')}"
            )
        elif k_type == "glossary":
            # public.glossary_terms — term definitions the chat path quotes
            # directly for "플루트가 뭐야?" style questions.
            blocks.append(
                f"[용어] {d.get('term','')}\n"
                f"설명: {(d.get('definition_ko') or d.get('definition_en') or '')[:500]}\n"
                f"YG-1 제공: {(d.get('yg1_offering') or '')[:300]}"
            )
        elif k_type == "series_profile":
            # catalog_app.series_profile_mv — one-line summary + raw range
            # fields so the LLM can cite precise numbers instead of guessing.
            blocks.append(
                f"[시리즈 프로파일] {d.get('series_name','')} (brand: {d.get('brand','')})\n"
                f"summary: {d.get('summary','')}\n"
                f"description: {(d.get('description') or '')[:200]}\n"
                f"feature: {(d.get('feature') or '')[:200]}"
            )
        elif k_type == "web_search":
            blocks.append(
                f"[웹검색] {d.get('title','')}\n{d.get('content','')[:300]}"
            )
        else:
            # Legacy domain-knowledge items (troubleshooting etc.) — compact.
            blocks.append(f"[{k_type}] {json.dumps(d, ensure_ascii=False)[:300]}")
    return "\n\n".join(blocks)


def _summarize_facets(available_filters: dict | None, top_n: int = 4) -> str:
    """Compact `[facets]` block — per field, top-N values by count. Used by
    the brand-clarification principle so the LLM proposes real DB values
    instead of inventing names. Returns empty string when nothing to show."""
    if not available_filters:
        return ""
    lines: list[str] = []
    for field in ("brand", "subtype", "coating"):
        opts = available_filters.get(field) or []
        if not opts:
            continue
        # opts items may be dicts or pydantic FilterOption — normalize either.
        pairs: list[tuple[str, int]] = []
        for o in opts:
            if hasattr(o, "value") and hasattr(o, "count"):
                pairs.append((str(o.value), int(o.count)))
            elif isinstance(o, dict) and "value" in o:
                pairs.append((str(o["value"]), int(o.get("count", 0))))
        pairs.sort(key=lambda x: x[1], reverse=True)
        preview = ", ".join(f"{v}({c})" for v, c in pairs[:top_n])
        lines.append(f"{field}: {preview}")
    return "\n".join(lines)


def _format_stock_summary_block(summary: dict | None) -> str:
    """Render the [재고 요약] block consumed by principle 12. Returns "" when
    the caller has no meaningful summary (no candidates)."""
    if not summary:
        return ""
    total = summary.get("total") or 0
    if total <= 0:
        return ""
    in_stock = int(summary.get("in_stock") or 0)
    pct = int(summary.get("pct") or 0)
    return f"total={total}, in_stock={in_stock}, pct={pct}"


def _format_cutting_range_block(cr: dict | None) -> str:
    """Render the [절삭조건 참고범위] block consumed by principle 13. Skips
    null fields so the model doesn't hallucinate bounds the CSV didn't cover."""
    if not cr:
        return ""
    bits: list[str] = []
    vc_min, vc_max = cr.get("vc_min"), cr.get("vc_max")
    fz_min, fz_max = cr.get("fz_min"), cr.get("fz_max")
    n_min, n_max = cr.get("n_min"), cr.get("n_max")
    if vc_min is not None and vc_max is not None:
        bits.append(f"Vc: {vc_min}~{vc_max} m/min")
    if fz_min is not None and fz_max is not None:
        bits.append(f"fz: {fz_min}~{fz_max} mm/tooth")
    if n_min is not None and n_max is not None:
        bits.append(f"RPM: {n_min}~{n_max}")
    if not bits:
        return ""
    row_count = cr.get("row_count")
    source = cr.get("source") or "YG-1 카탈로그 절삭조건표"
    footer = f"출처: {source}"
    if row_count:
        footer += f" ({row_count}행 집계)"
    return "\n".join(bits + [footer])


def _generate_light_cot(
    message: str,
    intent: Any,
    products: list[dict],
    knowledge: list[dict],
    total_count: int,
    relaxed_fields: list[str] | None = None,
    available_filters: dict | None = None,
    clarify: dict | None = None,
    stock_summary: dict | None = None,
    cutting_range: dict | None = None,
) -> dict:
    """Fast-path composer — gpt-5.4-mini @ reasoning_effort=low. Used for
    the bulk of /products traffic where the answer is a straightforward
    quote of DB data + knowledge. Keeps the 13 principles, no extra
    verification pass. generate_response() is the public entry point.
    """
    intent_summary = _summarize_intent(intent)
    product_summary = _summarize_products(products or [])
    context_str = _build_context_blocks(knowledge)
    facets_str = _summarize_facets(available_filters)
    stock_block = _format_stock_summary_block(stock_summary)
    cutting_block = _format_cutting_range_block(cutting_range)

    meta_lines = [
        f"total_count: {total_count}",
    ]
    if relaxed_fields:
        meta_lines.append(f"relaxed_fields: {relaxed_fields}")
    if intent_summary:
        meta_lines.append(f"intent: {json.dumps(intent_summary, ensure_ascii=False)}")
    if product_summary:
        meta_lines.append(f"top_products: {json.dumps(product_summary, ensure_ascii=False)}")
    meta_block = "\n".join(meta_lines)

    parts = [f"[context]\n{context_str}", f"[meta]\n{meta_block}"]
    if facets_str:
        parts.append(f"[facets]\n{facets_str}")
    if clarify and clarify.get("groups"):
        from clarify import format_chips_for_prompt
        clarify_str = format_chips_for_prompt(clarify)
        if clarify_str:
            parts.append(f"[clarify]\n{clarify_str}")
    if stock_block:
        parts.append(f"[재고 요약]\n{stock_block}")
    if cutting_block:
        parts.append(f"[절삭조건 참고범위]\n{cutting_block}")
    parts.append(f"[질문]\n{message}")
    user_turn = "\n\n".join(parts)

    client = _get_client()
    resp = client.chat.completions.create(
        model=OPENAI_MODEL,
        messages=[
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": user_turn},
        ],
        response_format={"type": "json_object"},
        reasoning_effort="low",
    )
    text = resp.choices[0].message.content or ""
    data = _extract_json(text)

    # Principle 6 asks the LLM to suggest real DB values as chips. When it
    # returns structured objects ({"label","type","value"}) the frontend —
    # which expects plain strings — would render the Python repr verbatim.
    # Pull out the display label (label → value → str(x)) so the wire type
    # is always list[str].
    raw_chips = data.get("chips") or []
    chips: list[str] = []
    for c in raw_chips:
        if not c:
            continue
        if isinstance(c, dict):
            label = c.get("label") or c.get("value")
            if label:
                chips.append(str(label))
        elif isinstance(c, str):
            chips.append(c)
        else:
            chips.append(str(c))

    return {
        "answer": str(data.get("answer") or ""),
        "reasoning": str(data.get("reasoning") or ""),
        "chips": chips,
        "refined_filters": data.get("refined_filters") or None,
    }


# ── Dual CoT ────────────────────────────────────────────────────────────
#
# Two chat paths:
#   light  — gpt-5.4-mini, reasoning_effort=low. Default for /products.
#   strong — gpt-5.4, reasoning_effort=medium + self-verify pass. Takes
#            roughly 2–4× as long but we want it when the answer has a
#            correctness tax: zero results, material-S/H queries, compare
#            / why / troubleshooting asks, dissatisfaction follow-ups.
#
# _assess_cot_level is deliberately signal-based, not keyword-matched on
# whole phrases. Each signal adds to a score; once we cross the threshold
# we escalate. New signals can be added without reshuffling the existing
# logic. Threshold tuned on ~12 query families; conservative enough that
# casual "수스 10mm 4날" stays on the light path.

# Env-override for the strong model so ops can swap in another Opus-tier
# variant without code change. Kept separate from OPENAI_HAIKU_MODEL (the
# light-path ID, read at module load into OPENAI_MODEL).
OPENAI_STRONG_MODEL = os.environ.get("OPENAI_SONNET_MODEL", "gpt-5.4")

_COMPARE_SIGNALS = ("비교", "차이", "뭐가 나아", "어떤 게", "vs", "장단점", "둘 중", "어느 게")
_WHY_SIGNALS = ("왜", "이유", "근거", "어째서", "왜냐", "because")
_TROUBLE_SIGNALS = (
    "떨림", "파손", "수명", "마모", "채터", "진동",
    "깨짐", "부러", "문제", "안 돼", "안돼", "이상", "불량",
)
_DISSAT_SIGNALS = ("아니", "그거 말고", "다시", "다른 거", "다른거", "안 맞", "안맞", "틀렸", "말고")

_STRONG_THRESHOLD = int(os.environ.get("DUAL_COT_STRONG_THRESHOLD", "3"))


def _assess_cot_level(
    message: str,
    intent: Any,
    products: list,
    knowledge: list,
    total_count: int,
    relaxed_fields: list | None,
) -> str:
    """Return "strong" when the composite signal score crosses
    _STRONG_THRESHOLD, else "light". Signals are orthogonal — compare+why
    can co-occur and add independently."""
    if not message:
        return "light"

    msg = message.lower()
    score = 0
    reasons: list[str] = []

    # Signal weights tuned so each "primary" signal (compare / why /
    # trouble / S·H material / dissat / 0건) crosses _STRONG_THRESHOLD=3
    # on its own, while pure spec queries ("수스 10mm 4날") that only
    # raise the "filter-richness" booster stay on light.

    # Signal 1 — uncertainty in the result set.
    if total_count == 0:
        score += 3
        reasons.append("0건")
    if relaxed_fields:
        score += 2
        reasons.append(f"relaxed={relaxed_fields}")

    # Signal 2 — material difficulty. Titanium/Inconel (S) and hardened
    # steel (H) carry the largest coating/geometry tradeoff surface;
    # worth a Strong answer even when nothing else is complex.
    mat = getattr(intent, "material_tag", None)
    if mat in ("S", "H"):
        score += 3
        reasons.append(f"mat={mat}")

    # Signal 3 — user intent complexity.
    if any(k in msg for k in _COMPARE_SIGNALS):
        score += 3
        reasons.append("compare")
    if any(k in msg for k in _WHY_SIGNALS):
        score += 3
        reasons.append("why")

    # Signal 4 — troubleshooting. Cause analysis + alternative suggestion
    # is exactly the kind of answer Strong is designed for.
    if any(k in msg for k in _TROUBLE_SIGNALS):
        score += 3
        reasons.append("trouble")

    # Signal 5 — many-constraint queries (booster, never primary). More
    # filled slots → more tradeoffs to reason across, but by itself this
    # shouldn't force Strong for a routine "4-slot" query.
    filled = sum(1 for f in (
        "diameter", "flute_count", "material_tag", "subtype",
        "brand", "coating", "tool_material", "shank_type",
    ) if getattr(intent, f, None) is not None)
    if filled >= 4:
        score += 1
        reasons.append(f"filters={filled}")
    if len(msg) > 50 and filled >= 3:
        score += 1
        reasons.append("long+filters")

    # Signal 6 — knowledge depth booster.
    if knowledge and len(knowledge) >= 2:
        score += 1
        reasons.append(f"knowledge={len(knowledge)}")

    # Signal 7 — dissatisfaction in a follow-up turn. User is asking us
    # to reconsider; the extra reasoning pays for itself.
    if any(k in msg for k in _DISSAT_SIGNALS):
        score += 3
        reasons.append("dissat")

    level = "strong" if score >= _STRONG_THRESHOLD else "light"
    return level


def _strong_product_block(products: list[dict], limit: int = 10) -> str:
    """Structured, single-line-per-row product dump used as ground truth
    in the Strong prompt + verifier. Uses the actual DB column aliases
    produced by search.SELECT_COLS (brand/series/subtype/diameter/flutes/
    coating/total_stock) so the verifier can exact-match."""
    if not products:
        return ""
    rows: list[str] = []
    for i, p in enumerate(products[:limit], 1):
        if not isinstance(p, dict):
            continue
        stock = p.get("total_stock")
        stock_s = "재고없음/null" if stock is None else f"재고={stock}"
        rows.append(
            f"  #{i} EDP={p.get('edp_no','?')} | brand={p.get('brand','-')} | "
            f"series={p.get('series','-')} | {p.get('subtype','-')} | "
            f"Ø{p.get('diameter','-')}mm | {p.get('flutes','-')}날 | "
            f"coating={p.get('coating','-')} | {stock_s}"
        )
    return "\n".join(rows)


# Strong-path system prompt. Holds all 13 operating principles from
# SYSTEM_PROMPT by reference — the Strong model is expected to apply them
# with tighter self-checking, so we add two extra rails: every product
# claim must resolve to the [매칭 제품] block; comparisons must surface
# both sides' pros/cons.
STRONG_SYSTEM_PROMPT = SYSTEM_PROMPT + """

━━━ Strong-path 추가 규칙 (이 원칙을 "반드시" 지킬 것) ━━━
S1. [매칭 제품] 블록에 없는 EDP/브랜드/시리즈/스펙을 인용하지 말 것. 빈 값이면 "카탈로그 확인 필요"로 명시.
S2. 비교 질문은 양쪽 장단점을 각각 제시 (한쪽만 편들지 말 것). 기준은 DB 수치/도메인지식에서 뽑을 것.
S3. 0건 또는 relaxed_fields 있을 때, "어느 조건을 얼마로 완화하면 N건 나옵니다" 식으로 구체적 대안 한 가지 이상 제시.
S4. 트러블슈팅은 원인 가설 → 확인 질문 → 대안 제품 순서로 구조화. 원인 추측에 "일반적으로"/"경험상" 표지 필수.
S5. 숫자(Vc/fz/RPM/HRC/직경/재고 등)는 전달받은 context 값만 사용. 새 숫자를 지어내지 말 것."""


def _generate_strong_cot(
    message: str,
    intent: Any,
    products: list[dict],
    knowledge: list[dict],
    total_count: int,
    relaxed_fields: list[str] | None = None,
    available_filters: dict | None = None,
    clarify: dict | None = None,
    stock_summary: dict | None = None,
    cutting_range: dict | None = None,
) -> dict:
    """Two-pass composer — gpt-5.4 drafts with reasoning_effort=medium,
    then gpt-5.4-mini verifies the draft against the [매칭 제품] ground
    truth and corrects any hallucinated specs. Falls back to the light
    path on any exception so a single bad request can't block the UI."""
    intent_summary = _summarize_intent(intent)
    product_summary = _summarize_products(products or [], limit=10)
    context_str = _build_context_blocks(knowledge)
    facets_str = _summarize_facets(available_filters)
    stock_block = _format_stock_summary_block(stock_summary)
    cutting_block = _format_cutting_range_block(cutting_range)
    product_ground_truth = _strong_product_block(products or [], limit=10)

    meta_lines = [f"total_count: {total_count}"]
    if relaxed_fields:
        meta_lines.append(f"relaxed_fields: {relaxed_fields}")
    if intent_summary:
        meta_lines.append(f"intent: {json.dumps(intent_summary, ensure_ascii=False)}")
    if product_summary:
        meta_lines.append(f"top_products: {json.dumps(product_summary, ensure_ascii=False)}")
    meta_block = "\n".join(meta_lines)

    parts = [f"[context]\n{context_str}", f"[meta]\n{meta_block}"]
    if product_ground_truth:
        parts.append(f"[매칭 제품 (ground truth — 여기 없는 건 인용 금지)]\n{product_ground_truth}")
    if facets_str:
        parts.append(f"[facets]\n{facets_str}")
    if clarify and clarify.get("groups"):
        from clarify import format_chips_for_prompt
        clarify_str = format_chips_for_prompt(clarify)
        if clarify_str:
            parts.append(f"[clarify]\n{clarify_str}")
    if stock_block:
        parts.append(f"[재고 요약]\n{stock_block}")
    if cutting_block:
        parts.append(f"[절삭조건 참고범위]\n{cutting_block}")
    parts.append(f"[질문]\n{message}")
    user_turn = "\n\n".join(parts)

    client = _get_client()
    try:
        draft_resp = client.chat.completions.create(
            model=OPENAI_STRONG_MODEL,
            messages=[
                {"role": "system", "content": STRONG_SYSTEM_PROMPT},
                {"role": "user", "content": user_turn},
            ],
            response_format={"type": "json_object"},
            reasoning_effort="medium",
        )
        draft_text = draft_resp.choices[0].message.content or ""
    except Exception:
        # Strong path failed at the draft step — downgrade silently.
        result = _generate_light_cot(
            message, intent, products, knowledge, total_count,
            relaxed_fields, available_filters, clarify,
            stock_summary, cutting_range,
        )
        result["cot_level"] = "light"
        return result

    # Self-verify — mini model rechecks the draft against the ground-truth
    # product block. Only commits corrections it can defend; otherwise
    # returns the draft unchanged.
    verify_system = (
        "당신은 YG-1 카탈로그 사실검증자입니다. [초안]이 [매칭 제품]과 "
        "[meta]를 벗어나 수치·제품명·재고를 지어냈는지 검사하세요. "
        "제품 근거 이상의 과도한 단정은 '카탈로그 확인 필요'로 완화하세요. "
        "출력은 {answer,chips,verified,corrections} JSON. answer/chips는 "
        "교정 후 최종값, verified=false면 corrections에 무엇을 바꿨는지 "
        "한 줄로 쓰세요."
    )
    verify_user = (
        f"[초안]\n{draft_text}\n\n"
        f"[매칭 제품]\n{product_ground_truth or '(없음)'}\n\n"
        f"[meta]\n{meta_block}"
    )
    try:
        verify_resp = client.chat.completions.create(
            model=OPENAI_MODEL,
            messages=[
                {"role": "system", "content": verify_system},
                {"role": "user", "content": verify_user},
            ],
            response_format={"type": "json_object"},
            reasoning_effort="low",
        )
        verified = _extract_json(verify_resp.choices[0].message.content or "")
        # Only trust the verifier if it returned an answer; otherwise keep
        # the draft so a bad verifier pass doesn't discard good output.
        data = verified if verified.get("answer") else _extract_json(draft_text)
    except Exception:
        data = _extract_json(draft_text)

    raw_chips = data.get("chips") or []
    chips: list[str] = []
    for c in raw_chips:
        if not c:
            continue
        if isinstance(c, dict):
            label = c.get("label") or c.get("value")
            if label:
                chips.append(str(label))
        elif isinstance(c, str):
            chips.append(c)
        else:
            chips.append(str(c))

    return {
        "answer": str(data.get("answer") or ""),
        "reasoning": str(data.get("reasoning") or data.get("corrections") or ""),
        "chips": chips,
        "refined_filters": data.get("refined_filters") or None,
    }


def generate_response(
    message: str,
    intent: Any,
    products: list[dict],
    knowledge: list[dict],
    total_count: int,
    relaxed_fields: list[str] | None = None,
    available_filters: dict | None = None,
    clarify: dict | None = None,
    stock_summary: dict | None = None,
    cutting_range: dict | None = None,
) -> dict:
    """Public entry point — dispatches to light/strong CoT based on
    _assess_cot_level. Always tags the result dict with cot_level so
    callers can forward it to ProductsResponse."""
    level = _assess_cot_level(
        message, intent, products or [], knowledge or [], total_count, relaxed_fields,
    )
    if level == "strong":
        result = _generate_strong_cot(
            message, intent, products, knowledge, total_count,
            relaxed_fields, available_filters, clarify,
            stock_summary, cutting_range,
        )
        result.setdefault("cot_level", "strong")
        return result
    result = _generate_light_cot(
        message, intent, products, knowledge, total_count,
        relaxed_fields, available_filters, clarify,
        stock_summary, cutting_range,
    )
    result["cot_level"] = "light"
    return result
