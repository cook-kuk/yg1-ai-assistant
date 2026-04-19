"""Tunable magic numbers + environment-backed settings — single source
of truth.

Mirrors the TypeScript side's `lib/config.ts` convention (env override
with a typed default via `envNum`). Any file in python-api that hard-
coded a threshold / TTL / model id / retry count should import from here
instead so ops can retune without reading the full codebase.

Everything is read at import time; call `reload_env()` in tests only.
"""
from __future__ import annotations

import os

# ── env helpers ──────────────────────────────────────────────────────


def envNum(name: str, default: int | float) -> float:
    """Parse an env var as number with fallback. Float return so the
    caller can narrow to int where appropriate."""
    raw = os.environ.get(name)
    if raw is None or raw.strip() == "":
        return default
    try:
        return float(raw)
    except (TypeError, ValueError):
        return default


def envInt(name: str, default: int) -> int:
    return int(envNum(name, default))


def envStr(name: str, default: str) -> str:
    v = os.environ.get(name)
    return v if v is not None and v.strip() != "" else default


def envBool(name: str, default: bool = False) -> bool:
    """True when the env var is set to a truthy string (true/1/yes), else
    the supplied default. Unset is treated as default so tests that clear
    the env cleanly revert to the documented behavior."""
    raw = os.environ.get(name)
    if raw is None or raw.strip() == "":
        return default
    return raw.strip().lower() in ("true", "1", "yes", "on")


# ── OpenAI model IDs ─────────────────────────────────────────────────
# CLAUDE.md: provider.ts 의 tier naming (haiku/sonnet/opus) 은 건드리지
# 말 것. env var 이름도 그 관례를 따른다.
OPENAI_LIGHT_MODEL = envStr("OPENAI_HAIKU_MODEL", "gpt-5.4-mini")
OPENAI_STRONG_MODEL = envStr("OPENAI_SONNET_MODEL", "gpt-5.4")
OPENAI_EMBED_MODEL = envStr("OPENAI_EMBED_MODEL", "text-embedding-3-small")

# ── Session store ────────────────────────────────────────────────────
SESSION_TTL_SEC = int(envNum("SESSION_TTL_SEC", 60 * 60))          # 1 hour idle
SESSION_CLEANUP_INTERVAL_SEC = int(envNum("SESSION_CLEANUP_INTERVAL_SEC", 5 * 60))

# ── Search / ranking / pagination ────────────────────────────────────
# How many detailed ProductCards /products returns per response.
TOP_K = envInt("ARIA_TOP_K", 10)
# EDPs persisted on session.previous_products for anaphoric narrow.
PREVIOUS_PRODUCTS_CAP = envInt("ARIA_PREV_PRODUCTS_CAP", 50)
# Top-N fed to xAI narrative generation.
XAI_NARRATIVE_TOP = envInt("ARIA_XAI_TOP", 3)
# Hard cap for search_products_fast — well past the deduped index size
# so full-catalog passes aren't truncated.
SEARCH_LIMIT = envInt("ARIA_SEARCH_LIMIT", 125_000)
# Series-profile lookup cap (narrower than product search).
SERIES_QUERY_LIMIT = envInt("ARIA_SERIES_LIMIT", 200)
# Candidate-panel page-size server-side fallbacks.
DEFAULT_PAGE_SIZE = envInt("ARIA_PAGE_SIZE", 20)
MAX_PAGE_SIZE = envInt("ARIA_MAX_PAGE_SIZE", 100)

# ── ProductIndex ─────────────────────────────────────────────────────
PRODUCT_INDEX_REFRESH_SEC = envInt("ARIA_INDEX_REFRESH", 2 * 60 * 60)  # 2h
DIAMETER_TOLERANCE = envNum("ARIA_DIA_TOLERANCE", 0.10)  # ±10 %

# ── Health endpoint ─────────────────────────────────────────────────
# Default minimal (alive only) so k8s / ELB liveness probes don't hit
# the DB on every poll. Flip to true when you want uptime + row count
# in the response (dev dashboard / manual debugging).
HEALTH_DETAILED = envBool("ARIA_HEALTH_DETAILED", False)

# ── LLM timeouts (seconds) ──────────────────────────────────────────
SCR_TIMEOUT = envNum("ARIA_SCR_TIMEOUT", 30.0)
LIGHT_COT_TIMEOUT = envNum("ARIA_LIGHT_COT_TIMEOUT", 30.0)
STRONG_COT_DRAFT_TIMEOUT = envNum("ARIA_STRONG_DRAFT_TIMEOUT", 45.0)
STRONG_COT_VERIFY_TIMEOUT = envNum("ARIA_STRONG_VERIFY_TIMEOUT", 20.0)

# ── Few-shot pool ────────────────────────────────────────────────────
FEW_SHOT_MAX_SHOTS = envInt("FEW_SHOT_MAX_SHOTS", 20)       # file cap
FEW_SHOT_PROMPT_SHOTS = envInt("FEW_SHOT_PROMPT_SHOTS", 5)  # surfaced in prompt

# ── Dual CoT (chat.py) ───────────────────────────────────────────────
DUAL_COT_STRONG_THRESHOLD = envInt("DUAL_COT_STRONG_THRESHOLD", 3)
DUAL_COT_PARTIAL_CHARS = envInt("DUAL_COT_PARTIAL_CHARS", 50)

# ── Conversation memory window ───────────────────────────────────────
# Default 3 turns (down from 6) — raw messages[] passthrough on Strong
# CoT's draft+verify+retry chain ballooned token cost 3× for follow-up
# queries at 6, which surfaced as a latency regression. 3 still covers
# the "직전 턴 반영" use case. Override via MEMORY_MAX_TURNS env.
MEMORY_MAX_TURNS = envInt("MEMORY_MAX_TURNS", 3)

# ── Golden test harness retry ────────────────────────────────────────
GOLDEN_RETRY_STATUS: set[int] = {429, 500, 502, 503, 504}
GOLDEN_MAX_RETRIES = envInt("GOLDEN_MAX_RETRIES", 3)
GOLDEN_BASE_BACKOFF_SEC = envNum("GOLDEN_BASE_BACKOFF_SEC", 1.0)
GOLDEN_INTER_CASE_SLEEP_SEC = envNum("GOLDEN_INTER_CASE_SLEEP_SEC", 0.3)

# ── Negation proximity window (scr.py) ───────────────────────────────
# Chars of context around a brand mention that still count as the same
# negation clause. 15 gives us typical trailing "말고 …" while staying
# short enough to dodge unrelated negations elsewhere in the sentence.
NEGATION_PROXIMITY_CHARS = envInt("NEGATION_PROXIMITY_CHARS", 15)

# ── Shared cache TTL (affinity / glossary / guard / series_profile) ──
# In-process caches that hydrate once on first read and refresh after
# TTL expires. 1h hits a reasonable balance between staleness and
# avoiding per-request DB hits; override via ARIA_CACHE_TTL_SEC.
CACHE_TTL_SEC = envNum("ARIA_CACHE_TTL_SEC", 3600.0)

# ── Affinity tier thresholds (affinity.py / scoring.py) ──────────────
# DB scores are 0..100 (iso_group rows rescaled). ≥80 EXCELLENT,
# 40..79 GOOD, 10..39 FAIR, below 10 no boost. Matches the TS side
# in lib/data/repos/brand-material-affinity-repo.ts.
AFFINITY_EXCELLENT_THRESHOLD = envNum("ARIA_AFFINITY_EXCELLENT", 80.0)
AFFINITY_GOOD_THRESHOLD = envNum("ARIA_AFFINITY_GOOD", 40.0)
AFFINITY_FAIR_THRESHOLD = envNum("ARIA_AFFINITY_FAIR", 10.0)

# ── Scheduler tick ──────────────────────────────────────────────────
# Scheduler daemon poll interval. 60s is long enough to avoid busy-loop
# CPU but short enough that a newly-due task fires within a minute.
SCHEDULER_TICK_SEC = envNum("ARIA_SCHEDULER_TICK_SEC", 60.0)

# ── Clarify (DB-backed clarification chips) ─────────────────────────
# Below this candidate count, no clarification chips are suggested —
# the ranked list is already short enough that the user doesn't need
# narrowing prompts. MAX_FIELDS caps how many chip groups to surface.
CLARIFY_MIN_CANDIDATES = envInt("ARIA_CLARIFY_MIN_CANDIDATES", 30)
CLARIFY_MAX_FIELDS = envInt("ARIA_CLARIFY_MAX_FIELDS", 2)

# ── SCR fuzzy resolver (scr._fuzzy_resolve) ─────────────────────────
# Edit-distance cap and minimum target length for Levenshtein matching.
# 2 is generous enough for single-typo brand names ("CRXS" → "CRX S")
# but tight enough to avoid false-matching unrelated short tokens.
FUZZY_LEV_MAX = envInt("ARIA_FUZZY_LEV_MAX", 2)
FUZZY_LEV_MIN_TARGET_LEN = envInt("ARIA_FUZZY_LEV_MIN_TARGET", 4)

# ── Few-shot nearest neighbor (few_shot.select_adaptive_examples) ───
# How many embedding-cosine-ranked exemplars to keep. Separate from
# FEW_SHOT_PROMPT_SHOTS which counts exemplars actually surfaced in the
# prompt (different pipeline stage, different tuning pressure).
FEW_SHOT_NEAREST_K = envInt("FEW_SHOT_NEAREST_K", 3)

# ── RAG retrieval (rag.search_knowledge*) ───────────────────────────
# Nearest-neighbor rank cap for every flavor of knowledge retrieval
# (keyword / semantic / web / unified). Different pool from few-shot;
# kept separate so ops can tune them independently.
RAG_TOP_K = envInt("ARIA_RAG_TOP_K", 3)

# ── Cutting-condition chart lookups ─────────────────────────────────
# Row cap for the general chart browser and per-product attach step.
CUTTING_DEFAULT_LIMIT = envInt("ARIA_CUTTING_DEFAULT_LIMIT", 20)
CUTTING_PER_PRODUCT_LIMIT = envInt("ARIA_CUTTING_PER_PRODUCT_LIMIT", 5)

# ── Raw conversation history window (session.format_history_for_llm) ─
# Distinct from MEMORY_MAX_TURNS (which gates the text-summary block
# rendered by build_conversation_memory). This governs raw messages[]
# pass-through for the OpenAI-compatible chat input.
HISTORY_MAX_TURNS = envInt("ARIA_HISTORY_MAX_TURNS", 6)

# ── Filter options facet cap (product_index.get_filter_options_fast) ─
# Per-field distinct-value count before truncation in the filter UI.
FILTER_OPTION_LIMIT = envInt("ARIA_FILTER_OPTION_LIMIT", 50)

# ── Default per-call cap for search.search_products ─────────────────
# Distinct from SEARCH_LIMIT (hard in-memory index bound). This is the
# per-request slice the DB path returns when the caller didn't override.
SEARCH_DEFAULT_LIMIT = envInt("ARIA_SEARCH_DEFAULT_LIMIT", 5000)

# ── Dual CoT complexity signals (chat._assess_cot_level) ────────────
# Sub-scores layered into the Strong-CoT routing decision. Threshold
# tweaks should stay here so ops can dial the Strong-rate up/down
# without recompiling the assessor.
COT_FILLED_MANY_THRESHOLD = envInt("ARIA_COT_FILLED_MANY", 4)
COT_FILLED_LONG_THRESHOLD = envInt("ARIA_COT_FILLED_LONG", 3)
COT_LONG_MSG_CHARS = envInt("ARIA_COT_LONG_MSG_CHARS", 50)
COT_KNOWLEDGE_MIN = envInt("ARIA_COT_KNOWLEDGE_MIN", 2)


def reload_env() -> None:
    """Re-read env. Intended for tests that monkeypatch envs mid-process."""
    globals().update(
        OPENAI_LIGHT_MODEL=envStr("OPENAI_HAIKU_MODEL", "gpt-5.4-mini"),
        OPENAI_STRONG_MODEL=envStr("OPENAI_SONNET_MODEL", "gpt-5.4"),
        OPENAI_EMBED_MODEL=envStr("OPENAI_EMBED_MODEL", "text-embedding-3-small"),
        SESSION_TTL_SEC=int(envNum("SESSION_TTL_SEC", 60 * 60)),
        SESSION_CLEANUP_INTERVAL_SEC=int(envNum("SESSION_CLEANUP_INTERVAL_SEC", 5 * 60)),
        FEW_SHOT_MAX_SHOTS=envInt("FEW_SHOT_MAX_SHOTS", 20),
        FEW_SHOT_PROMPT_SHOTS=envInt("FEW_SHOT_PROMPT_SHOTS", 5),
        DUAL_COT_STRONG_THRESHOLD=envInt("DUAL_COT_STRONG_THRESHOLD", 3),
        DUAL_COT_PARTIAL_CHARS=envInt("DUAL_COT_PARTIAL_CHARS", 50),
        MEMORY_MAX_TURNS=envInt("MEMORY_MAX_TURNS", 3),
        GOLDEN_MAX_RETRIES=envInt("GOLDEN_MAX_RETRIES", 3),
        GOLDEN_BASE_BACKOFF_SEC=envNum("GOLDEN_BASE_BACKOFF_SEC", 1.0),
        GOLDEN_INTER_CASE_SLEEP_SEC=envNum("GOLDEN_INTER_CASE_SLEEP_SEC", 0.3),
        NEGATION_PROXIMITY_CHARS=envInt("NEGATION_PROXIMITY_CHARS", 15),
    )
