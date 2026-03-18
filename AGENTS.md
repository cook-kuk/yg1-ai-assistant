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
- Use tool-use for routing and interpretation
- Use deterministic logic for execution and validation

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

## Required validation
Before final response:
- validate slot replacement
- validate candidate count consistency
- validate displayedProducts / displayedSeriesGroups persistence
- validate UI/state synchronization
- validate restore target correctness

## Testing
Every bug fix must add or update a regression test.
Prefer Playwright for end-to-end session/UI bugs.