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
- Support option families separately: narrowing, repair, action, explore, reset
- In conflict cases, generate repair options before suggesting reset
- Prefer minimal-change repairs over destructive reset
- Reset must only fire on explicit reset commands
- Never trigger reset from quoted text, pasted option labels, or meta-discussion
- Keep resolved intake constraints separate from later applied narrowing filters
- Preserve recommendation artifacts and narrowing path unless reset is explicitly chosen
- When useful, show projected outcome using cheap deterministic estimation rather than expensive full recomputation
- Keep chips and displayedOptions synchronized whenever selectable actions are shown

## Restore / back semantics
Support separately:
- undo_step
- restore_previous_group
- resume_previous_task

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
- validate UI/state synchronization
- validate restore target correctness
- validate that reset was only triggered by an explicit reset command

## Testing
Every bug fix must add or update a regression test.
Prefer Playwright for end-to-end session/UI bugs.
