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


SYSTEM_PROMPT = """너는 YG-1 절삭공구 추천 AI다. 엔드밀·드릴·탭 등 공구 선정 전문가.

역할:
- 사용자 의도(추출된 intent) + 후보 제품 + 도메인 지식을 종합해 자연스러운 한국어 답변 생성
- 도메인 지식이 제공되면 답변에 녹여 근거로 활용 (예: 떨림 원인, 소재별 코팅 추천)
- 추천 이유는 제품 속성(직경·날수·코팅·소재 적합도) 근거로 간결히

JSON 출력 스키마:
{
  "answer":   string,            // UI에 보일 본문 (한국어, 3~5줄, 마크다운 금지)
  "reasoning": string,           // 이 선택의 논리 (짧게 1~2줄, 내부 로깅용)
  "chips":    string[],          // 후속 클릭 제안 (3~5개, 예: "2날로 보기", "TiAlN만", "국내 재고만")
  "refined_filters": object|null // 비어있거나, {field: value} 형태로 이완·교체할 필터
}

규칙:
- 제품 수가 0이면 relaxed_fields 로 완화 제안
- 도메인 지식이 주어지면 핵심 bullet 1개만 인용하고 답변에 자연스럽게 녹일 것
- chips 는 명령형이 아닌 선택지 ("Square 형상만", "6mm 이상")
- **출력은 JSON 하나만, 마크다운/코드펜스 금지**"""


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


def generate_response(
    message: str,
    intent: Any,
    products: list[dict],
    knowledge: list[dict],
    total_count: int,
    relaxed_fields: list[str] | None = None,
) -> dict:
    """Compose the chat reply. Returns dict with keys answer/reasoning/
    chips/refined_filters. Keys default to safe values if the LLM fails."""
    payload = {
        "user_message": message,
        "intent": _summarize_intent(intent),
        "total_count": total_count,
        "relaxed_fields": relaxed_fields or [],
        "top_products": _summarize_products(products or []),
        "domain_knowledge": knowledge or [],
    }
    user_turn = json.dumps(payload, ensure_ascii=False)

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
