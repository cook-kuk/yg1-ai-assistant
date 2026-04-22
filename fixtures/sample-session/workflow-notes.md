# Sample Workflow Notes

Scenario:

- User asks for a 10 mm, 4-flute stainless finishing recommendation.
- System returns a narrowed list.
- UI shows one active series group and two displayed products.

What this placeholder is meant to demonstrate:

- `displayedProducts` is the UI-facing shortlist.
- `lastRecommendationArtifact` can contain a wider candidate pool than the current displayed list.
- `displayedSeriesGroups` and `uiNarrowingPath` must stay aligned with the visible narrowing UI.
- Restore actions should use preserved state instead of rebuilding from chat text alone.

Checks contributors should make when changing the recommendation flow:

1. Slot replacement does not corrupt the displayed shortlist.
2. Displayed candidate counts remain internally consistent.
3. UI and persisted session state stay synchronized.
4. Restore targets recover the right group or task boundary.
