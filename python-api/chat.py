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


def generate_response(
    message: str,
    intent: Any,
    products: list[dict],
    knowledge: list[dict],
    total_count: int,
    relaxed_fields: list[str] | None = None,
) -> dict:
    """Compose the chat reply. The system prompt is intentionally short
    (5 principles) — heavy lifting is delegated to the `[context]` block
    the user message carries.

    The top-product summary + intent/count/relaxed metadata ride along so
    the model still has concrete candidates to quote, but the domain
    taxonomy (industry→material, material→coating) stays in the JSON KB."""
    intent_summary = _summarize_intent(intent)
    product_summary = _summarize_products(products or [])
    context_str = _build_context_blocks(knowledge)

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

    user_turn = (
        f"[context]\n{context_str}\n\n"
        f"[meta]\n{meta_block}\n\n"
        f"[질문]\n{message}"
    )

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

    return {
        "answer": str(data.get("answer") or ""),
        "reasoning": str(data.get("reasoning") or ""),
        "chips": [str(c) for c in (data.get("chips") or []) if c],
        "refined_filters": data.get("refined_filters") or None,
    }
