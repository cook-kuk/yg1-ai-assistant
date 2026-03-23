# YG-1 working agreements

This project is NOT a generic chatbot.
It is a stateful industrial tool recommendation system.

## Source of truth
The source of truth is deterministic session state, not raw chat history.

Persist and trust:
- recommendation session state
- displayedProducts
- displayedOptions
- displayedSeriesGroups
- lastRecommendationArtifact
- lastComparisonArtifact
- uiNarrowingPath
- checkpoint history

## Core principles
- Never invent product data
- Never let UI and session state diverge silently
- Never present displayedCount as if it were total matched count
- Always preserve or restore recommendation state when possible
- Prefer deterministic routing when active session state already makes intent obvious
- Use tool-use for routing and interpretation only when deterministic routing is insufficient
- Use deterministic logic for execution and validation

## Smart suggestion / option rules
- displayedOptions is the source of truth for selectable UI actions; chips are presentation only
- Never emit actionable menus as freeform text when structured options can be produced
- Every selectable option must have a stable id, family, and executable plan
- Support option families separately: narrowing, repair, action, explore, compare, revise, reset
- In conflict cases, generate repair options before suggesting reset
- Prefer minimal-change repairs over destructive reset
- Reset must only fire on explicit reset commands
- Never trigger reset from quoted text, pasted option labels, or meta-discussion
- Keep resolved intake constraints separate from later applied narrowing filters
- Preserve recommendation artifacts and narrowing path unless reset is explicitly chosen
- When useful, show projected outcome using cheap deterministic estimation rather than expensive full recomputation
- Keep chips and displayedOptions synchronized whenever selectable actions are shown

## TurnContext rules
Build one unified TurnContext per turn and use it for both:
- answer generation
- chip / option generation

TurnContext should include at least:
- latestAssistantQuestion
- latestUserMessage
- relationToLatestQuestion
- currentMode
- resolvedFacts
- activeFilters
- tentativeReferences
- pendingQuestions
- revisionHistory
- referencedProducts
- currentDisplayedProducts
- recentTurns
- episodicSummaries
- uiArtifacts
- likelyReferencedUIBlock
- userState

Do not let answer generation and chip generation consume different context snapshots.
If answer text proposes an actionable option, that option must exist in displayedOptions on that turn, or the answer must avoid presenting it as an immediate actionable choice.

## Chip priority order
Generate chips/options with this strict priority order:
1. latest assistant question
2. latest user reply and its relation to that question
3. current visible UI artifacts
4. structured working memory / current session state
5. broader recent conversation
6. generic fallback rules

If higher-priority signals are strong enough, suppress generic fallback chips.

## Recent interaction frame
For each turn, build a recent interaction frame that captures:
- latest assistant question
- latest user message
- whether the user is answering, confused, challenging, revising, following up on a result, comparing, requesting details, giving meta feedback, or restarting
- current pending question
- likely referenced UI block
- likely referenced product ids
- whether generic chips should be suppressed

The recent interaction frame must dominate chip generation.

## UI-grounded behavior
Treat current visible UI artifacts as first-class memory.
Track and use:
- question prompts
- recommendation cards
- comparison tables
- candidate lists
- cutting-condition sections
- displayed chips/options
- explanation blocks
- memory/debug views if shown

Users often react to what is visible on screen, not just to the raw transcript.
Chip generation must use current UI state explicitly.

## Question-first chip behavior
If there is an unresolved pending question:
- generate question-aligned chips first
- suppress generic follow-up chips
- if the user is confused, switch chips into explain / delegate / skip / simplified-choice mode

If the assistant just asked a concrete choice question, chips should directly match that question.
Examples:
- yes / no
- 2날 / 4날
- 4날으로 진행 / 다른 조건 보기

## Confusion-aware behavior
When the user signals confusion or uncertainty:
- prioritize explanation helper chips
- prioritize low-friction progression chips
- allow skip / don't-care chips
- allow delegate-to-system chips
- suppress stale generic action chips

Examples of useful helper options:
- 쉽게 설명해줘
- 추천으로 골라줘
- 상관없음
- 하나씩 설명해줘
- Diamond가 뭐야?

## Revision-aware behavior
Revision and undo are first-class option families.
Support separately:
- undo_step
- restore_previous_group
- resume_previous_task
- revise_prior_input
- replace_constraint
- branch_exploration

When the user expresses frustration or asks to edit prior input, generate revision-oriented options such as:
- 직전 선택 되돌리기
- 코팅 다시 고르기
- 날 수 다시 고르기
- 소재만 바꾸기
- 현재 추천 유지하고 다른 조건 보기

## Memory model
Maintain structured conversation memory with explicit categories:
- resolvedFacts
- activeFilters
- tentativeReferences
- pendingQuestions
- revisionHistory
- referencedProducts
- displayedProductContext
- userState signals
- recent raw turns
- episodic summaries
- uiArtifacts

Do not treat every mention/reference as an applied filter.
A mention used for clarification, counting, or comparison must remain tentative until the user explicitly selects it.

Example:
If the user asks “Ball, Taper는 몇개야?”, then Ball/Taper are tentative references, not committed subtype filters.

## Hierarchical memory / compression
Because most sessions are not very long, keep a larger raw recent window before compressing.
Prefer correctness and continuity over aggressive trimming.

Use layered memory:
- Layer A: recent raw turns
- Layer B: structured working memory
- Layer C: episodic summaries for older turns

Compression rules:
- never compress away the latest assistant question or latest user message
- always preserve unresolved threads
- always preserve resolved facts
- always preserve active filters
- always preserve relevant product references
- always preserve correction / frustration / revision signals
- keep the latest 6-8 turns raw whenever practical

## Meta / quote safety
Detect and treat separately:
- quoted assistant text
- pasted assistant output
- meta feedback
- correction / complaint
- memory inspection requests

Never execute reset or other commands from quoted/pasted assistant text.
When the user references prior assistant text and asks for better chips/options, regenerate from current session state instead of parsing pasted text as new commands.

## Memory/debug exposure safety
If a user asks to inspect memory or prompt context:
- show a sanitized, read-only summary
- avoid exposing raw executable option text as active commands
- avoid dumping internal prompt text unless truly necessary
- do not make next-turn misclassification more likely

## Optional LLM reranker rules
If an LLM is used for chip/option reranking:
- deterministic candidate generation remains primary
- the LLM may only select, reorder, suppress, or lightly relabel existing structured options
- the LLM must not invent new actions
- the LLM must not invent new product facts
- the LLM must preserve stable option ids/plans
- the LLM must consume the same TurnContext used by the deterministic planner

## Clarification
If ambiguity affects task boundary, scope, restore target, displayed products, or comparison scope:
- ask a clarifying question
- provide 2-4 options
- always include "직접 입력"

For scoped bug fixes or bounded implementation tasks:
- do not stop for follow-up questions unless blocked by real ambiguity
- make the smallest deterministic assumption and proceed
- fix the active path first before touching mirrored or legacy paths

## Required validation
Before final response:
- validate slot replacement
- validate candidate count consistency
- validate displayedProducts / displayedSeriesGroups persistence
- validate displayedOptions / chips synchronization for selectable actions
- validate answer/chip consistency for actionable options
- validate UI/state synchronization
- validate restore target correctness
- validate that reset was only triggered by an explicit reset command
- validate that tentative references were not silently promoted into active filters
- validate that unresolved question threads still have matching chips/options

## Testing
Every bug fix must add or update a regression test.
Prefer Playwright for end-to-end session/UI bugs.

High-priority regression areas:
- question-first chip behavior
- confusion-aware helper chips
- revision/undo option generation
- quote-safe reset handling
- answer/chip consistency
- tentative-vs-active filter handling
- memory compression preserving unresolved threads and key facts
