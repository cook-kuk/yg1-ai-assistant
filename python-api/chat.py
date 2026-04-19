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

8. [clarify] 블록이 있으면 그건 "DB 관점에서 지금 조건이 너무 느슨해 후보가 {candidate_count}개 남아있다"는 뜻이다.
   그대로 두고 top-10 추천만 주지 마라. 반드시 한 문장으로 "현재 {candidate_count}건 후보가 있어요 — DB에서 좁혀볼 수 있는 조건은 아래입니다" 식으로 설명하고, [clarify] 의 각 필드별 상위 값을 chips 로 제안해라.
   chip 레이블은 "{label}: {value}" 형식으로 간결하게 (예: "헬릭스각: 30", "직경공차: h7", "볼반경: 0.5"). 숫자 필드는 단위 없이 DB 원문 값 그대로.
   [clarify] 가 비어 있으면 (candidate_count 가 작으면) 이 원칙은 무시하고 기존 추천 원칙을 따른다.

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


def _summarize_products(products: list[dict], limit: int = 5) -> list[dict]:
    """Compact product preview for the prompt — drops heavy fields like
    description/feature and keeps only what distinguishes candidates."""
    out: list[dict] = []
    for p in (products or [])[:limit]:
        if not isinstance(p, dict):
            continue
        out.append({
            "edp_no": p.get("edp_no"),
            "brand": p.get("brand"),
            "series": p.get("series"),
            "subtype": p.get("subtype"),
            "diameter": p.get("diameter"),
            "flutes": p.get("flutes"),
            "coating": p.get("coating"),
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


def generate_response(
    message: str,
    intent: Any,
    products: list[dict],
    knowledge: list[dict],
    total_count: int,
    relaxed_fields: list[str] | None = None,
    available_filters: dict | None = None,
    clarify: dict | None = None,
) -> dict:
    """Compose the chat reply. The system prompt is intentionally short
    (6 principles) — heavy lifting is delegated to the `[context]` block
    the user message carries.

    The top-product summary + intent/count/relaxed metadata ride along so
    the model still has concrete candidates to quote, but the domain
    taxonomy (industry→material, material→coating) stays in the JSON KB.
    `available_filters` feeds the [facets] block so principle 6 (brand
    clarification) can propose real DB values as chips.

    `clarify` is the output of clarify.suggest_clarifying_chips — a DB-backed
    summary of which unspecified fields are most-differentiating under the
    current filters. When present it triggers the clarification principle:
    "유저 조건이 느슨해서 후보가 많으면, 가장 분기되는 필드를 되물어봐라."
    """
    intent_summary = _summarize_intent(intent)
    product_summary = _summarize_products(products or [])
    context_str = _build_context_blocks(knowledge)
    facets_str = _summarize_facets(available_filters)

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
