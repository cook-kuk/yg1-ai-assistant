# Refine Future Work

Follow-ups deliberately descoped from #5 Step 2. Each is tracked here
instead of scattered TODO comments so the next iteration can pick them
up cleanly.

## 1. True fast-lane (SCR + DB + LLM skip)

**What Step 2 shipped**: `session.last_ranked` is persisted and
`refine_engine` emits structured chips + deterministic distribution.
However the main.py sync/stream paths still run the **full pipeline**
(SCR → search → rank → chat) on every turn — refine is a *projection*
layer, not a routing short-circuit yet.

**What's pending**:
- `_is_refine_turn(message, session, refine_chip_payload)` — detects
  refine intent via (a) structured payload on request (needs
  `ProductsRequest.refine_chip` field), or (b) `NARROW_PHRASES`-only
  match with session.last_ranked non-empty.
- `_extract_refine_spec(message, filters)` — NL narrowing → (field,
  value, mode) tuple. Easiest: reuse SCR parse_intent's field
  extractors on just the chip text.
- Fast-path bypass in main.py: `refine_in_memory(session.last_ranked,
  **spec)` → deterministic template answer → save_turn, skip LLM.
- Expected latency gain: p50 3× (drop 1.5-3s SCR + 3-8s LLM).

Blocker: NL refine detection precision. `NARROW_PHRASES` extension in
`patterns.py` catches "좁혀/만/빼고" but false-positives on "이 정도만
보여줘" style ambiguous phrasings. Needs a golden-set pass to tune
before wiring the bypass.

## 2. Undo / refine history stack

Intentionally dropped from Step 2 per Q3. Backend support is a
`refine_stack: list[dict]` field on Session (each entry `{field,
value, mode, timestamp}`). UI needs:
- "방금 추가한 조건 되돌리기" button on the latest AI message
- `POST /products/refine/undo {session_id}` endpoint (pops stack,
  re-computes last_ranked by replaying the filters bottom-up on the
  full pool — or caches each step's result).

Storage concern: N narrowing chips = N-snapshot retention. Memory
bound is (chips × cap × ~500 bytes). For typical sessions (<10
narrowings × 50 cap) that's 250KB; acceptable for in-proc. Redis
off-load becomes compelling when session count × stack depth ×
per-row size > 2GB (see §3).

## 3. Redis off-load for last_ranked

Current `_SESSIONS` dict lives in the Python worker process. Uvicorn
with multiple workers → sessions are worker-sticky; any rebalancer
(LB without session affinity, worker restart) loses the last_ranked
blob. For Step 2 scale this is acceptable; revisit when either:

- Active sessions > 10k concurrent at steady state
- Multi-worker deployment confirmed (sticky sessions unavailable)
- p99 session-miss rate > 5%

Shape: Redis HSET per session keyed on `{session_id}:last_ranked`,
JSON-serialized list[dict]. TTL mirrors `SESSION_TTL_SEC`.

## 4. Natural-language chip sunset

`ProductsResponse.chips: list[str]` predates structured `refine_chips`
and is currently kept in parallel for backward compat. Monitor click
telemetry: if structured chips drive > 95% of clicks after 2 weeks,
delete the NL path + LLM prompt section that asks for chip suggestions
(save ~200 tokens/turn on prompt cost).

Measurement plan: add `chip_type: "nl" | "refine" | "cta"` to the
click event, aggregate weekly. Decision threshold documented here so
ops doesn't need to re-derive it.

## 5. Embedding-based chip clustering

`build_refine_chips` currently groups by exact field value ("TiAlN"
vs "TiAlN+AlCr" as separate chips). When the catalog has many
near-duplicate coating / subtype labels, chips over-fragment.

Next step: cluster labels via `rag._cosine_sim` on their text embeddings
(already available via config.OPENAI_EMBED_MODEL). Cluster threshold
config-driven: `REFINE_CHIP_CLUSTER_COSINE = 0.88`.

Scope guardrail: apply only to `coating` / `subtype` fields where
label space is known-noisy. Skip numeric/list fields where semantics
are exact.

## 6. Cross-field chip UI

Python emits `{field: "subtype+flute_count", value: {subtype: "Square",
flute_count: "4"}}` when `include_cross=True`. Current frontend render
just shows the compound label via `stripCount` heuristic — doesn't
differentiate visually from single-field chips. Options:

- Dedicated row above single-field chips with a "조합 제안" header
- Badge variant (different color) so the user sees it's a compound
- Group icon on hover tooltip

Low urgency since cross chips are extra signal, not primary. Revisit
after usage data lands.

## 7. SCR refine-spec contract

Structured chip click currently sends `chip.label` (minus count) as a
natural-language turn. SCR re-parses → extracts filters → re-runs
pipeline. Works, but loses the "I meant this specific chip" signal.

Preferred long-term: frontend sends `{refine_chip: {field, value,
action}}` on the request body. `ProductsRequest` adds the optional
field; Python short-circuits SCR. This is the precondition for §1
(true fast-lane).

Estimated effort: 15 TypeScript lines (chip click → request payload)
+ 20 Python lines (request field → refine_engine call) + 10 test
lines. Total ~45 lines. Blocked only on the §1 fast-lane design.
