"""Multi-turn fresh-request detector — port of yg1's dialogue_manager.

The core problem this solves:

  Turn 1: "Morse Taper 드릴 보여줘"           → shank=Morse Taper, tool=drill
  Turn 2: "구리 10mm 추천해줘"                → user clearly pivoted
  Current behavior: carry_forward_intent silently inherits shank=Morse Taper
  from turn 1, so turn 2 now searches for copper 10mm WITH Morse Taper shank
  — zero results, or worse, wrong suggestions.

This module classifies whether the incoming turn reads as a *standalone new
question* (so we should drop prior filter state) vs. a *refinement/follow-up*
(so carry_forward is correct). Signal sources:

  1. Recommend-verb + fresh anchor     — "추천해줘" + material/brand/series
  2. Defining-slot swap vs. prior      — prior material=P, current=M
  3. Multi-anchor query (≥ 3 slots)    — clearly a full new spec

Anti-signals that force us to treat the turn as a refinement:
  - Explicit follow-up phrase ("이 중에서", "그 중에", …)
  - user typed only modifier attributes (coating alone, "4날만" alone)

The heavy-weight slot-filling / clarification UX from yg1 is deliberately
not ported — cook-forge already has `clarify.suggest_clarifying_chips` which
uses entropy-over-DB-facets (a data-driven approach that's strictly better
than yg1's hard-coded slot priority for a chat-first product).
"""
from __future__ import annotations

import re
from typing import Any, Optional

from patterns import FRESH_REQUEST_VERBS, FOLLOWUP_HINTS

# ── Vocabulary ────────────────────────────────────────────────────────
# FRESH_REQUEST_VERBS / FOLLOWUP_HINTS moved to patterns.py — same values,
# aliased under the module-local names so the classifier below reads the
# way it did before.
_FRESH_REQUEST_VERBS = FRESH_REQUEST_VERBS
_FOLLOWUP_HINTS = FOLLOWUP_HINTS

# "Query-anchor" SCRIntent fields. Any one of these is a strong signal
# that the current turn is a standalone recommendation request. Three or
# more anchors in a single turn is multi-anchor → always fresh.
_ANCHOR_SLOTS: tuple[str, ...] = (
    "material_tag", "workpiece_name", "tool_type", "brand", "subtype",
    "series_name", "coating", "shank_type", "diameter",
    "flute_count", "cutting_edge_shape",
)

# Defining slots — when one of these appears in both current AND prior and
# the values differ, the user has pivoted. Swap on any of these = fresh.
_DEFINING_SLOTS: tuple[str, ...] = (
    "material_tag", "workpiece_name", "brand", "series_name", "tool_type",
)


def _norm(value: Any) -> str:
    if value is None:
        return ""
    return str(value).strip().lower()


def _intent_to_dict(intent: Any) -> dict:
    """Handle both Pydantic SCRIntent and plain dict uniformly."""
    if intent is None:
        return {}
    if hasattr(intent, "model_dump"):
        try:
            return intent.model_dump()
        except Exception:
            pass
    if isinstance(intent, dict):
        return dict(intent)
    out: dict = {}
    for slot in _ANCHOR_SLOTS + ("raw", "normalized"):
        out[slot] = getattr(intent, slot, None)
    return out


def _count_anchors(intent_dict: dict) -> int:
    n = 0
    for slot in _ANCHOR_SLOTS:
        v = intent_dict.get(slot)
        if v is None:
            continue
        if isinstance(v, str) and not v.strip():
            continue
        n += 1
    return n


def detect_fresh_request(
    message: Optional[str],
    current_intent: Any,
    prior_filters: Optional[dict],
) -> Optional[str]:
    """Classify whether the current turn is a FRESH product query.

    Arguments:
      message        — raw user utterance (for phrase-level hints)
      current_intent — the SCRIntent just parsed for this turn
      prior_filters  — session.current_filters (dict) from the last turn,
                       or None on first turn

    Returns a short reason string when fresh (for logging), or None when the
    turn should merge with prior context (i.e. normal carry_forward applies).
    """
    raw = _norm(message)
    if not raw:
        return None

    # Hard anti-signal: explicit follow-up phrase wins over any fresh signal.
    if any(hint in raw for hint in _FOLLOWUP_HINTS):
        return None

    cur = _intent_to_dict(current_intent)
    cur_anchor_count = _count_anchors(cur)

    # 1. Recommend-verb + any fresh anchor → classic "X 추천해줘" case.
    if cur_anchor_count >= 1 and any(v in raw for v in _FRESH_REQUEST_VERBS):
        return "verb+anchor"

    # 2-5. Slot swap vs. prior — if the user named a value that *conflicts*
    # with prior state, they've pivoted. Compared case-insensitively.
    if prior_filters:
        for slot in _DEFINING_SLOTS:
            c = cur.get(slot)
            p = prior_filters.get(slot)
            if c is None or p is None:
                continue
            if _norm(c) and _norm(p) and _norm(c) != _norm(p):
                return f"{slot}-swap"

    # 6. Multi-anchor standalone query — ≥ 3 explicit anchors says "this
    # stands on its own" regardless of prior context.
    if cur_anchor_count >= 3:
        return f"multi-anchor({cur_anchor_count})"

    return None


# ── Session-level helpers ─────────────────────────────────────────────

_BRAND_RESET_BLOCKLIST = ("brand",)  # reserved — future: brand-only swap shouldn't clear geometry


def reset_session_for_fresh(session: Any) -> None:
    """Drop prior filter state + previous_products so carry_forward has
    nothing to inherit for this turn. The session object is kept alive
    (dialogue history is preserved for conversation memory rendering) —
    we only clear the *filter* carry-forward and the EDP narrowing set."""
    if session is None:
        return
    try:
        if hasattr(session, "current_filters"):
            session.current_filters = {}
        if hasattr(session, "previous_products"):
            session.previous_products = []
    except Exception:
        # Never let a reset bubble up and fail the request.
        pass


# ── Recognizability check (lighter port of yg1's is_unrecognizable) ───
# Used by the chat layer to decide whether to apologize + ask vs. just run
# the recommend pipeline on a sparse intent. cook-forge's clarify.py
# already handles the "too many candidates" facet prompt, so we only use
# this for the "zero-signal gibberish" case.
_ACTIONABLE_SLOTS: tuple[str, ...] = (
    "material_tag", "workpiece_name", "tool_type", "brand", "series_name",
    "subtype", "coating", "shank_type", "tool_material",
    "diameter", "flute_count", "helix_angle", "point_angle",
    "thread_pitch", "thread_tpi", "ball_radius", "corner_radius",
    "length_of_cut_min", "length_of_cut_max",
    "overall_length_min", "overall_length_max",
    "shank_diameter", "shank_diameter_min", "shank_diameter_max",
    "hardness_hrc", "cutting_edge_shape",
    "unit_system", "in_stock_only",
)

# Material-standard codes the SCR can't resolve should still be treated as
# actionable — the user clearly wants a material lookup and the recommend
# path's zero-match branch gives a better answer than "I don't understand".
_MATERIAL_CODE_PATTERNS: tuple[re.Pattern, ...] = (
    re.compile(r"\b(?:ss|din|jis|aisi|sae|astm|en|bs|afnor|uns|gost|gb)\s*\S+", re.I),
    re.compile(r"\b\d\.\d{3,4}\b"),                     # W.Nr "1.0037"
    re.compile(r"\b[A-Z]{1,3}\d{2,}(?:-\d+)?(?:[A-Z]?\d*)?\b"),  # "SCM440", "Al6061"
)


def looks_like_material_code(raw: Optional[str]) -> bool:
    q = (raw or "").strip()
    if not q:
        return False
    for pat in _MATERIAL_CODE_PATTERNS:
        if pat.search(q):
            return True
    return False


def has_actionable_signal(intent: Any, message: Optional[str]) -> bool:
    """True when the intent carries *any* recognizable filter or when the
    message at least looks like a material code. Used to short-circuit the
    recommend pipeline on true-zero-signal utterances (so we can show an
    "I didn't understand" note instead of a random catalog slice)."""
    cur = _intent_to_dict(intent)
    for slot in _ACTIONABLE_SLOTS:
        v = cur.get(slot)
        if v is None:
            continue
        if isinstance(v, str) and not v.strip():
            continue
        if isinstance(v, (list, tuple)) and not v:
            continue
        if v is False:
            continue
        return True
    return looks_like_material_code(message)
