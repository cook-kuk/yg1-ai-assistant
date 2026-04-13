# TODO

## Ambiguity Guard Expansion

- Extend ambiguity-first handling beyond order quantity vs stock quantity and fieldless measurement phrases.
- Principle: if the user gives vague or partial information and multiple interpretations can change task scope, displayed products, or applied filters, ask a clarification question instead of silently assigning a field.
- Keep this structural, not sentence hardcoding.

Current follow-up targets:

- Delivery vs stock:
  Inputs like `이번 주 안에`, `빨리 받아야`, `즉납 가능한 것` should distinguish lead time from stock availability.
- Total quantity vs per-spec quantity:
  Inputs like `200개씩`, `규격별로 100개`, `총 500개` should not collapse into one stock/order filter.
- Inventory scope:
  Inputs like `국내 재고만`, `한국 창고 기준`, `전체 재고` should distinguish warehouse scope from global stock.
- Unitless or underspecified numeric inputs:
  Inputs like `10 이상`, `30도`, `100` should ask what field/unit/basis the number refers to unless the context already disambiguates it.
- Ambiguous measurement families:
  Continue expanding `mm`, angle, pitch, corner-R, and similar shared numeric patterns so explicit cues execute deterministically and fieldless cues ask first.

Implementation notes:

- Reuse shared ambiguity detectors and resolver validation gates.
- Apply the same rule consistently across deterministic SCR, KG extraction, pending-question parsing, general-chat routing, and resolver validation.
- Every ambiguity bug fix must add a regression test.
