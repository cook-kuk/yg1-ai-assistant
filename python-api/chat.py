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
from collections import Counter
from pathlib import Path
from typing import Any

from openai import OpenAI, AsyncOpenAI
from dotenv import load_dotenv

from config import (
    OPENAI_LIGHT_MODEL,
    OPENAI_STRONG_MODEL as _CFG_STRONG_MODEL,
    DUAL_COT_STRONG_THRESHOLD as _CFG_STRONG_THRESHOLD,
    DUAL_COT_PARTIAL_CHARS as _CFG_PARTIAL_CHARS,
    LIGHT_COT_TIMEOUT,
    STRONG_COT_DRAFT_TIMEOUT,
    STRONG_COT_VERIFY_TIMEOUT,
)
from patterns import (
    COMPARE_SIGNALS,
    WHY_SIGNALS,
    TROUBLE_SIGNALS,
    DISSAT_SIGNALS,
)

load_dotenv(Path(__file__).resolve().parent.parent / ".env")

# Back-compat alias — OPENAI_MODEL is the light-tier model id used by the
# SCR, light CoT, and verifier call sites. Canonical name now lives in
# config (OPENAI_LIGHT_MODEL).
OPENAI_MODEL = OPENAI_LIGHT_MODEL

_client: OpenAI | None = None
_aclient: AsyncOpenAI | None = None


def _get_client() -> OpenAI:
    global _client
    if _client is None:
        _client = OpenAI(api_key=os.environ.get("OPENAI_API_KEY"))
    return _client


def _get_aclient() -> AsyncOpenAI:
    """Async OpenAI client for the streaming Strong-CoT draft. Separate
    singleton from the sync one so a blocking light-path call doesn't
    contend with an in-flight stream."""
    global _aclient
    if _aclient is None:
        _aclient = AsyncOpenAI(api_key=os.environ.get("OPENAI_API_KEY"))
    return _aclient


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


def _derive_top_rationale(products: list[dict], intent: Any, reasoning: str) -> str:
    """Short, deterministic "why this product" line for the UI's xAI panel.

    Strong path: the caller already set a verified reasoning paragraph — reuse
    that if it mentions the top-1 EDP, else fall back to a template. Light
    path: always template, since the light prompt doesn't earn the cost of
    an LLM rationale and the spec fields alone tell most of the story.

    The template deliberately sticks to DB facts (brand / series / coating /
    flute count / material tag) and avoids any Vc/fz claim so we stay in
    principle 5 ("no made-up numbers")."""
    if not products:
        return ""
    top = products[0] if isinstance(products[0], dict) else {}
    edp = str(top.get("edp_no") or "").strip()
    if reasoning and edp and edp in reasoning:
        # Verifier mentioned the top-1 by code; trust the paragraph as-is.
        return reasoning.strip()[:600]
    brand = str(top.get("brand") or "").strip() or "이 시리즈"
    series = str(top.get("series") or "").strip()
    coating = str(top.get("coating") or "").strip()
    flutes_raw = top.get("flutes")
    try:
        flutes = int(float(flutes_raw)) if flutes_raw not in (None, "") else None
    except (TypeError, ValueError):
        flutes = None
    subtype = str(top.get("subtype") or "").strip()
    diameter = top.get("diameter")
    mat_tag = getattr(intent, "material_tag", None) if intent is not None else None
    wp = getattr(intent, "workpiece_name", None) if intent is not None else None

    bits: list[str] = []
    head = f"{brand}{' ' + series if series else ''}"
    bits.append(f"{head}{' (EDP ' + edp + ')' if edp else ''}는")
    if wp or mat_tag:
        target = wp or f"ISO {mat_tag}군"
        bits.append(f"{target} 가공에")
    else:
        bits.append("현재 조건에")
    body: list[str] = []
    if flutes:
        body.append(f"{flutes}날 구조")
    if subtype:
        body.append(f"{subtype} 형상")
    if coating:
        body.append(f"{coating} 코팅")
    if diameter:
        body.append(f"Ø{diameter}mm")
    if body:
        bits.append(", ".join(body) + "로 적합합니다.")
    else:
        bits.append("DB 수치 기준으로 부합합니다.")
    stock = top.get("total_stock")
    if isinstance(stock, (int, float)) and stock and stock > 0:
        bits.append(f"현재 재고 {int(stock)}개 확보 상태로 즉시 검토 가능합니다.")
    return " ".join(bits)


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


def _build_conversation_memory_safe(session: Any) -> str:
    """Wrap session.build_conversation_memory with a session→None guard and
    graceful import fallback. Returns "" when the session has no history
    or the helper import fails, so the CoT prompt stays well-formed even
    when the caller forgot to pass a session (e.g. /recommend path).

    NOTE: Retained for any caller that still wants the stringified block;
    the chat CoT path now uses `_raw_history_messages` + the messages[]
    array instead. Both remain available."""
    if session is None:
        return ""
    try:
        from session import build_conversation_memory
        return build_conversation_memory(session) or ""
    except Exception:
        return ""


def _raw_history_messages(session: Any, max_turns: int | None = None) -> list[dict]:
    """Return the last `max_turns` turns in Anthropic/OpenAI messages[]
    shape — [{role, content}, …] — for prepending to the CoT call.
    No summarization, no reformatting. Falls back to [] when the session
    is None or the helper import fails, so the prompt stays well-formed.

    `max_turns` defaults to config.MEMORY_MAX_TURNS when omitted — callers
    that need a different window can override explicitly."""
    if session is None:
        return []
    if max_turns is None:
        from config import MEMORY_MAX_TURNS
        max_turns = MEMORY_MAX_TURNS
    try:
        from session import format_history_for_llm
        return format_history_for_llm(session, max_turns=max_turns)
    except Exception:
        return []


def _build_ui_context(
    intent: Any,
    req_filters: dict | None,
    available_filters: dict | None,
    products: list[dict] | None,
    total_count: int,
    relaxed_fields: list[str] | None,
) -> str:
    """Full UI-state dump. Replaces the old 9-field `_summarize_intent`
    block so the CoT sees the *exact* same state the user has on screen:
      A) ManualFilters that the user toggled in the filter bar
      B) SCR fields the LLM pulled from the natural-language message
      C) range-slider values (anything ending in _min / _max)
      D) live result summary — total_count, relaxed_fields
      E) top10 stock breakdown (in-stock / total)
      F) top10 brand distribution (Counter most_common(5))
      G) top10 score high/low
      H) one-click narrow hints from availableFilters (top 3 per field)

    Principle 6/11 and the new 12/13 all reference signals that used to live
    across multiple blocks — keeping them in a single [UI 컨텍스트] block lets
    the model cross-reference "이 유저는 diameter_min=8 을 토글한 채 '코팅 좋
    은 거' 라고 물었다" without hunting around the prompt.

    Returns "" when nothing is informative — caller skips the block entirely."""
    lines: list[str] = []
    _RANGE_SUFFIXES = ("_min", "_max")

    # A + C — ManualFilters (user-toggled), split scalar vs range for clarity.
    user_scalar: list[str] = []
    user_range: list[str] = []
    if req_filters:
        for key in sorted(req_filters):
            val = req_filters.get(key)
            if val is None or val == "" or val is False:
                continue
            if any(key.endswith(s) for s in _RANGE_SUFFIXES):
                user_range.append(f"  {key}: {val}")
            else:
                user_scalar.append(f"  {key}: {val}")
    if user_scalar:
        lines.append("[유저가 설정한 필터 (토글/선택)]")
        lines.extend(user_scalar)
    if user_range:
        if lines:
            lines.append("")
        lines.append("[범위 필터 (슬라이더)]")
        lines.extend(user_range)

    # B — SCR intent fields the LLM extracted this turn.
    llm_fields = (
        "diameter", "flute_count", "material_tag", "workpiece_name",
        "subtype", "brand", "coating", "tool_material", "shank_type",
        "helix_angle", "point_angle", "thread_pitch", "thread_tpi",
        "diameter_tolerance", "ball_radius",
        "length_of_cut_min", "length_of_cut_max",
        "overall_length_min", "overall_length_max",
        "shank_diameter", "shank_diameter_min", "shank_diameter_max",
        "hardness_hrc", "series_name", "cutting_edge_shape",
        "unit_system", "in_stock_only",
    )
    llm_active: list[str] = []
    for f in llm_fields:
        v = getattr(intent, f, None)
        if v is not None:
            llm_active.append(f"  {f}: {v}")
    if llm_active:
        if lines:
            lines.append("")
        lines.append("[AI가 자연어에서 추출한 필터]")
        lines.extend(llm_active)

    # D + E + F + G — result roll-up over the top-10 ranked cards.
    result_lines: list[str] = [f"  총 {total_count}건 매칭"]
    if relaxed_fields:
        result_lines.append(f"  ⚠ 조건 완화됨: {', '.join(relaxed_fields)}")
    if products:
        in_stock = 0
        brand_counter: Counter = Counter()
        score_vals: list[float] = []
        for p in products[:10]:
            if not isinstance(p, dict):
                continue
            try:
                if int(p.get("total_stock") or 0) > 0:
                    in_stock += 1
            except (TypeError, ValueError):
                pass
            s = p.get("score")
            if s is not None:
                try:
                    score_vals.append(float(s))
                except (TypeError, ValueError):
                    pass
            b = p.get("brand")
            if b:
                brand_counter[str(b)] += 1
        top_n = min(len(products), 10)
        result_lines.append(f"  top{top_n} 재고 있는 제품: {in_stock}/{top_n}건")
        if brand_counter:
            preview = ", ".join(
                f"{b}({c}건)" for b, c in brand_counter.most_common(5)
            )
            result_lines.append(f"  브랜드 분포: {preview}")
        if score_vals:
            result_lines.append(
                f"  스코어: 최고 {max(score_vals):.1f} / 최저 {min(score_vals):.1f}"
            )
    if lines:
        lines.append("")
    lines.append("[검색 결과 요약]")
    lines.extend(result_lines)

    # H — one-click narrow hints (top-3 values per facet field).
    if available_filters:
        field_hints: list[str] = []
        for field, opts in available_filters.items():
            if not opts or not isinstance(opts, list) or len(opts) <= 1:
                continue
            pairs: list[tuple[str, int]] = []
            for o in opts[:3]:
                if hasattr(o, "value") and hasattr(o, "count"):
                    pairs.append((str(o.value), int(o.count)))
                elif isinstance(o, dict) and "value" in o:
                    pairs.append((str(o["value"]), int(o.get("count", 0))))
            if pairs:
                preview = ", ".join(f"{v}({c}건)" for v, c in pairs)
                field_hints.append(f"  {field}: {preview}")
        if field_hints:
            lines.append("")
            lines.append("[유저가 추가로 좁힐 수 있는 필터]")
            lines.extend(field_hints)

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
    session: Any = None,
    req_filters: dict | None = None,
) -> dict:
    """Fast-path composer — gpt-5.4-mini @ reasoning_effort=low. Used for
    the bulk of /products traffic where the answer is a straightforward
    quote of DB data + knowledge. Keeps the 13 principles, no extra
    verification pass. generate_response() is the public entry point.

    `session` feeds build_conversation_memory so the model sees the last
    N turns (user question + AI preview + filter deltas). `req_filters`
    is the raw ManualFilters dict so [UI 컨텍스트] can label toggle-state
    distinctly from SCR-extracted intent.
    """
    product_summary = _summarize_products(products or [])
    context_str = _build_context_blocks(knowledge)
    facets_str = _summarize_facets(available_filters)
    stock_block = _format_stock_summary_block(stock_summary)
    cutting_block = _format_cutting_range_block(cutting_range)
    ui_context = _build_ui_context(
        intent, req_filters, available_filters, products, total_count, relaxed_fields,
    )

    # [meta] is now the "LLM-only needs this" slice — top_products (for
    # principle 8 stock rules) and relaxed_fields. Multi-turn memory rides
    # as raw messages[] below, not as a stringified block.
    meta_lines = [f"total_count: {total_count}"]
    if relaxed_fields:
        meta_lines.append(f"relaxed_fields: {relaxed_fields}")
    if product_summary:
        meta_lines.append(f"top_products: {json.dumps(product_summary, ensure_ascii=False)}")
    meta_block = "\n".join(meta_lines)

    parts = [f"[context]\n{context_str}", f"[meta]\n{meta_block}"]
    if ui_context:
        parts.append(f"[UI 컨텍스트]\n{ui_context}")
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

    # Prepend raw conversation history as literal messages[] entries —
    # Anthropic/OpenAI convention. No summarization, no "[대화 히스토리]"
    # text block. Bounded by max_turns=6 to keep token cost flat.
    history_msgs = _raw_history_messages(session)

    client = _get_client()
    resp = client.chat.completions.create(
        model=OPENAI_MODEL,
        messages=(
            [{"role": "system", "content": SYSTEM_PROMPT}]
            + history_msgs
            + [{"role": "user", "content": user_turn}]
        ),
        response_format={"type": "json_object"},
        reasoning_effort="low",
        # Light path is the hot path — `reasoning_effort=low` usually finishes
        # in 5–10 s, but an occasional stall was blowing past the client's
        # 60 s budget and returning as -1 in the stress test. 30 s is a soft
        # ceiling that still lets the normal case through comfortably.
        timeout=LIGHT_COT_TIMEOUT,
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
# Module-local aliases to the SSOT values (config.py + patterns.py).
# Retained with the underscore-prefixed names so the rest of the file's
# assessment logic stays untouched.
OPENAI_STRONG_MODEL = _CFG_STRONG_MODEL

_COMPARE_SIGNALS = COMPARE_SIGNALS
_WHY_SIGNALS = WHY_SIGNALS
_TROUBLE_SIGNALS = TROUBLE_SIGNALS
_DISSAT_SIGNALS = DISSAT_SIGNALS

_STRONG_THRESHOLD = _CFG_STRONG_THRESHOLD


def _session_has_prior(session: Any) -> bool:
    """True iff the session carries at least one prior turn. Used to gate
    signals (dissat / 0건) that are only meaningful as *follow-up* cues —
    on a fresh turn-1 they over-escalate and burn latency for nothing."""
    if session is None:
        return False
    turns = getattr(session, "turns", None)
    return bool(turns)


def _assess_cot_level(
    message: str,
    intent: Any,
    products: list,
    knowledge: list,
    total_count: int,
    relaxed_fields: list | None,
    session: Any = None,
) -> str:
    """Return "strong" when the composite signal score crosses
    _STRONG_THRESHOLD, else "light". Signals are orthogonal — compare+why
    can co-occur and add independently.

    `session` (optional) lets two signals stay gated to follow-up turns
    only: (1) the 0건 escalation skips for short fresh queries where the
    user just hasn't given enough detail yet; (2) DISSAT needs a prior
    turn to be meaningful ("아니" on turn-1 is noise, not a complaint)."""
    if not message:
        return "light"

    msg = message.lower()
    score = 0
    reasons: list[str] = []
    has_prior = _session_has_prior(session)

    # Signal weights tuned so each "primary" signal (compare / why /
    # trouble / S·H material / dissat / 0건) crosses _STRONG_THRESHOLD=3
    # on its own, while pure spec queries ("수스 10mm 4날") that only
    # raise the "filter-richness" booster stay on light.

    # Signal 1 — uncertainty in the result set. Gated off for short,
    # fresh queries (no prior turn + ≤15 chars) because those are usually
    # the user warming up ("sus", "10mm") — they don't need Strong, they
    # need carry_forward to catch more context on the next turn.
    is_fresh_short = (not has_prior) and len(message) <= 15
    if total_count == 0 and not is_fresh_short:
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
    # to reconsider; the extra reasoning pays for itself. Requires a prior
    # turn to exist; otherwise "아니 ..." on turn-1 is likely just speech
    # noise ("아니 그게 아니고 sus로 …") and escalation burns latency.
    if has_prior and any(k in msg for k in _DISSAT_SIGNALS):
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
    session: Any = None,
    req_filters: dict | None = None,
) -> dict:
    """Two-pass composer — gpt-5.4 drafts with reasoning_effort=medium,
    then gpt-5.4-mini verifies the draft against the [매칭 제품] ground
    truth and corrects any hallucinated specs. Falls back to the light
    path on any exception so a single bad request can't block the UI.

    `session` + `req_filters` let the Strong path cross-reference the prior
    turns + current UI toggle state (same rationale as the light path)."""
    product_summary = _summarize_products(products or [], limit=10)
    context_str = _build_context_blocks(knowledge)
    facets_str = _summarize_facets(available_filters)
    stock_block = _format_stock_summary_block(stock_summary)
    cutting_block = _format_cutting_range_block(cutting_range)
    product_ground_truth = _strong_product_block(products or [], limit=10)
    ui_context = _build_ui_context(
        intent, req_filters, available_filters, products, total_count, relaxed_fields,
    )

    meta_lines = [f"total_count: {total_count}"]
    if relaxed_fields:
        meta_lines.append(f"relaxed_fields: {relaxed_fields}")
    if product_summary:
        meta_lines.append(f"top_products: {json.dumps(product_summary, ensure_ascii=False)}")
    meta_block = "\n".join(meta_lines)

    parts = [f"[context]\n{context_str}", f"[meta]\n{meta_block}"]
    if ui_context:
        parts.append(f"[UI 컨텍스트]\n{ui_context}")
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

    # Raw messages[] history — same convention as the light path.
    history_msgs = _raw_history_messages(session)

    client = _get_client()
    try:
        draft_resp = client.chat.completions.create(
            model=OPENAI_STRONG_MODEL,
            messages=(
                [{"role": "system", "content": STRONG_SYSTEM_PROMPT}]
                + history_msgs
                + [{"role": "user", "content": user_turn}]
            ),
            response_format={"type": "json_object"},
            reasoning_effort="medium",
            # Hard cap — the UI's 60s client budget leaves no room for a
            # silent stall here. On timeout the except below drops to light,
            # which still returns a usable answer instead of -1/HTTP error.
            timeout=STRONG_COT_DRAFT_TIMEOUT,
        )
        draft_text = draft_resp.choices[0].message.content or ""
    except Exception:
        # Strong path failed at the draft step — downgrade silently.
        result = _generate_light_cot(
            message, intent, products, knowledge, total_count,
            relaxed_fields, available_filters, clarify,
            stock_summary, cutting_range,
            session, req_filters,
        )
        result["cot_level"] = "light"
        return result

    # Self-verify — mini model rechecks the draft against the ground-truth
    # product block. Only commits corrections it can defend; otherwise
    # returns the draft unchanged.
    #
    # The rubric is intentionally narrow — style/tone/ordering changes are
    # NOT correction triggers, which used to flip verified=False on clean
    # drafts and rewrite them needlessly. Only factual mismatches against
    # [매칭 제품] (invented product names, wrong specs, bogus stock) flip
    # verified=False.
    verify_system = (
        "당신은 YG-1 카탈로그 사실검증자입니다.\n\n"
        "검증 기준 (이것만 체크):\n"
        "1. 초안에 언급된 제품명/시리즈가 [매칭 제품]에 실제로 있는가?\n"
        "2. 직경/날수/코팅 수치가 [매칭 제품]과 일치하는가?\n"
        "3. 재고 수량이 [매칭 제품]과 일치하는가?\n"
        "4. [매칭 제품]에 없는 제품을 지어냈는가?\n\n"
        "판정:\n"
        "- verified=true : 위 4개에서 사실 오류 없음. 표현/어투 차이는 오류 아님.\n"
        "- verified=false: 사실과 다른 수치/제품명 있음. corrections 에 구체적으로 명시.\n\n"
        "중요: 표현 다듬기, 어투 변경, 문장 순서 조정은 수정 사유가 아닙니다. "
        "사실 오류 없으면 반드시 verified=true + answer 는 초안 그대로 반환. "
        "제품 근거 이상의 과도한 단정은 '카탈로그 확인 필요' 로 완화하되, 그 완화가 필요하지 않으면 건드리지 마세요.\n\n"
        "출력은 {answer, chips, verified, corrections} JSON."
    )
    verify_user = (
        f"[초안]\n{draft_text}\n\n"
        f"[매칭 제품]\n{product_ground_truth or '(없음)'}\n\n"
        f"[meta]\n{meta_block}"
    )
    verified_flag: bool | None = None
    try:
        verify_resp = client.chat.completions.create(
            model=OPENAI_MODEL,
            messages=[
                {"role": "system", "content": verify_system},
                {"role": "user", "content": verify_user},
            ],
            response_format={"type": "json_object"},
            reasoning_effort="low",
            # Verifier is the smaller model with less reasoning budget — 20s
            # is plenty. Draft already passed, so a verify stall is the only
            # remaining slow path.
            timeout=STRONG_COT_VERIFY_TIMEOUT,
        )
        verified = _extract_json(verify_resp.choices[0].message.content or "")
        # Only trust the verifier if it returned an answer; otherwise keep
        # the draft so a bad verifier pass doesn't discard good output.
        if verified.get("answer"):
            data = verified
            # verifier reports its own verified bool — coerce to Python bool
            # (some runs return the string "true"/"false").
            v = verified.get("verified")
            if isinstance(v, bool):
                verified_flag = v
            elif isinstance(v, str):
                verified_flag = v.strip().lower() == "true"
        else:
            data = _extract_json(draft_text)
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
        "verified": verified_flag,
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
    session: Any = None,
    req_filters: dict | None = None,
) -> dict:
    """Public entry point — dispatches to light/strong CoT based on
    _assess_cot_level. Always tags the result dict with cot_level so
    callers can forward it to ProductsResponse.

    `session` + `req_filters` are forwarded into both CoT paths so every
    chat turn sees the same [대화 히스토리] + [UI 컨텍스트] state. Both
    default to None, which keeps /recommend (stateless) callers working
    without a session store."""
    level = _assess_cot_level(
        message, intent, products or [], knowledge or [], total_count, relaxed_fields,
        session=session,
    )
    if level == "strong":
        result = _generate_strong_cot(
            message, intent, products, knowledge, total_count,
            relaxed_fields, available_filters, clarify,
            stock_summary, cutting_range,
            session, req_filters,
        )
        result.setdefault("cot_level", "strong")
        # Re-use the Strong verifier's reasoning paragraph as the top-1
        # rationale — it was already produced against ground-truth products,
        # so the UI's "왜 이 제품이 최적인가" block has verified content.
        if not result.get("rationale"):
            result["rationale"] = _derive_top_rationale(
                products or [], intent, result.get("reasoning") or "",
            )
        return result
    result = _generate_light_cot(
        message, intent, products, knowledge, total_count,
        relaxed_fields, available_filters, clarify,
        stock_summary, cutting_range,
        session, req_filters,
    )
    result["cot_level"] = "light"
    result["rationale"] = _derive_top_rationale(products or [], intent, result.get("reasoning") or "")
    return result


# ── Strong-path SSE streaming ───────────────────────────────────────────
#
# stream_strong_cot is the async counterpart to _generate_strong_cot.
# Instead of one blocking call it yields (event_type, payload) tuples so
# the /products/stream endpoint can relay progress to the UI:
#
#   ("thinking", {step, total_steps, status, cot_level})
#   ("partial_answer", {text, status})      — emitted every ~50 chars
#   ("answer", {answer, chips, reasoning, cot_level, verified, ...})
#
# Draft step uses AsyncOpenAI with stream=True so the UI can "type" the
# draft in real time; verify step is synchronous (short + JSON-mode). If
# the draft stream fails mid-way we downgrade to the light path via a
# to_thread call — callers still get exactly one ("answer", …) tuple.


def _build_strong_user_turn(
    message: str,
    intent: Any,
    products: list[dict],
    knowledge: list[dict],
    total_count: int,
    relaxed_fields: list[str] | None,
    available_filters: dict | None,
    clarify: dict | None,
    stock_summary: dict | None,
    cutting_range: dict | None,
    session: Any = None,
    req_filters: dict | None = None,
) -> tuple[str, str]:
    """Return (user_turn, product_ground_truth). Extracted so both the
    sync Strong path and the streaming variant assemble the exact same
    prompt — otherwise the verifier's ground-truth block could drift
    from what the drafter saw."""
    product_summary = _summarize_products(products or [], limit=10)
    context_str = _build_context_blocks(knowledge)
    facets_str = _summarize_facets(available_filters)
    stock_block = _format_stock_summary_block(stock_summary)
    cutting_block = _format_cutting_range_block(cutting_range)
    product_ground_truth = _strong_product_block(products or [], limit=10)
    ui_context = _build_ui_context(
        intent, req_filters, available_filters, products, total_count, relaxed_fields,
    )

    meta_lines = [f"total_count: {total_count}"]
    if relaxed_fields:
        meta_lines.append(f"relaxed_fields: {relaxed_fields}")
    if product_summary:
        meta_lines.append(f"top_products: {json.dumps(product_summary, ensure_ascii=False)}")
    meta_block = "\n".join(meta_lines)

    parts = [f"[context]\n{context_str}", f"[meta]\n{meta_block}"]
    if ui_context:
        parts.append(f"[UI 컨텍스트]\n{ui_context}")
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
    return "\n\n".join(parts), product_ground_truth


def _normalize_chips_list(raw) -> list[str]:
    """Chips wire-type is list[str]. Normalize the LLM's loose output
    (strings, {label,value} dicts, …) so the frontend never has to."""
    out: list[str] = []
    for c in (raw or []):
        if not c:
            continue
        if isinstance(c, dict):
            label = c.get("label") or c.get("value")
            if label:
                out.append(str(label))
        elif isinstance(c, str):
            out.append(c)
        else:
            out.append(str(c))
    return out


# Chunk-emit cadence for the partial_answer SSE frame — SSOT in config.
_PARTIAL_CHUNK_CHARS = _CFG_PARTIAL_CHARS


async def stream_strong_cot(
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
    session: Any = None,
    req_filters: dict | None = None,
):
    """Async generator yielding (event_type, payload) tuples for the SSE
    relay. Yields exactly one ("answer", ...) as its terminal frame,
    even when the draft/verify steps fail (via light-path fallback).
    """
    import asyncio

    user_turn, product_ground_truth = _build_strong_user_turn(
        message, intent, products, knowledge, total_count,
        relaxed_fields, available_filters, clarify,
        stock_summary, cutting_range, session, req_filters,
    )

    # Step 1 — announce deep-reasoning kickoff. Client renders a stage
    # badge so the user knows the ~30-50s wait is deliberate.
    yield ("thinking", {
        "step": 1, "total_steps": 3,
        "status": "심층 분석 시작 (Strong CoT)",
        "cot_level": "strong",
    })

    # Step 2 — draft streaming.
    yield ("thinking", {
        "step": 2, "total_steps": 3,
        "status": "🔍 전문가 수준으로 분석 중...",
        "cot_level": "strong",
    })

    aclient = _get_aclient()
    partial = ""
    last_emit = 0
    draft_ok = False
    # Raw messages[] history — same convention as sync strong path.
    history_msgs = _raw_history_messages(session)
    try:
        stream = await aclient.chat.completions.create(
            model=OPENAI_STRONG_MODEL,
            messages=(
                [{"role": "system", "content": STRONG_SYSTEM_PROMPT}]
                + history_msgs
                + [{"role": "user", "content": user_turn}]
            ),
            response_format={"type": "json_object"},
            reasoning_effort="medium",
            stream=True,
            # Stream init stall guard — if the model never starts emitting
            # within 45s, drop to light fallback (below) so the SSE client
            # sees a real `answer` frame rather than a hung connection.
            timeout=STRONG_COT_DRAFT_TIMEOUT,
        )
        async for chunk in stream:
            choices = getattr(chunk, "choices", None) or []
            if not choices:
                continue
            delta = getattr(choices[0], "delta", None)
            content = getattr(delta, "content", None) if delta else None
            if not content:
                continue
            partial += content
            if len(partial) - last_emit >= _PARTIAL_CHUNK_CHARS:
                last_emit = len(partial)
                yield ("partial_answer", {
                    "text": partial,
                    "status": "분석 중...",
                })
        draft_ok = bool(partial)
    except Exception:
        draft_ok = False

    if not draft_ok:
        # Draft stream failed — drop to the light path so the UI still
        # gets a real answer. Caller only sees one terminal "answer".
        fallback = await asyncio.to_thread(
            _generate_light_cot,
            message, intent, products, knowledge, total_count,
            relaxed_fields, available_filters, clarify,
            stock_summary, cutting_range,
            session, req_filters,
        )
        fallback["cot_level"] = "light"
        fallback["verified"] = None
        yield ("answer", fallback)
        return

    # Step 3 — fact-verification.
    yield ("thinking", {
        "step": 3, "total_steps": 3,
        "status": "✅ 사실 관계 검증 중...",
        "cot_level": "strong",
    })

    verify_system = (
        "당신은 YG-1 카탈로그 사실검증자입니다.\n\n"
        "검증 기준 (이것만 체크):\n"
        "1. 초안에 언급된 제품명/시리즈가 [매칭 제품]에 실제로 있는가?\n"
        "2. 직경/날수/코팅 수치가 [매칭 제품]과 일치하는가?\n"
        "3. 재고 수량이 [매칭 제품]과 일치하는가?\n"
        "4. [매칭 제품]에 없는 제품을 지어냈는가?\n\n"
        "판정:\n"
        "- verified=true : 위 4개에서 사실 오류 없음. 표현/어투 차이는 오류 아님.\n"
        "- verified=false: 사실과 다른 수치/제품명 있음. corrections 에 구체적으로 명시.\n\n"
        "중요: 표현 다듬기, 어투 변경, 문장 순서 조정은 수정 사유가 아닙니다. "
        "사실 오류 없으면 반드시 verified=true + answer 는 초안 그대로 반환. "
        "제품 근거 이상의 과도한 단정만 '카탈로그 확인 필요' 로 완화하고, 아닐 경우 건드리지 마세요.\n\n"
        "출력은 {answer, chips, verified, corrections} JSON."
    )
    verify_user = (
        f"[초안]\n{partial}\n\n"
        f"[매칭 제품]\n{product_ground_truth or '(없음)'}"
    )
    verified_flag: bool | None = None

    def _run_verify() -> dict:
        sync_client = _get_client()
        resp = sync_client.chat.completions.create(
            model=OPENAI_MODEL,
            messages=[
                {"role": "system", "content": verify_system},
                {"role": "user", "content": verify_user},
            ],
            response_format={"type": "json_object"},
            reasoning_effort="low",
            timeout=STRONG_COT_VERIFY_TIMEOUT,
        )
        return _extract_json(resp.choices[0].message.content or "")

    try:
        verified = await asyncio.to_thread(_run_verify)
    except Exception:
        verified = {}

    if verified.get("answer"):
        data = verified
        v = verified.get("verified")
        if isinstance(v, bool):
            verified_flag = v
        elif isinstance(v, str):
            verified_flag = v.strip().lower() == "true"
    else:
        data = _extract_json(partial) or {"answer": partial, "chips": []}

    yield ("answer", {
        "answer": str(data.get("answer") or partial),
        "reasoning": str(data.get("reasoning") or data.get("corrections") or ""),
        "chips": _normalize_chips_list(data.get("chips")),
        "refined_filters": data.get("refined_filters") or None,
        "cot_level": "strong",
        "verified": verified_flag,
    })
