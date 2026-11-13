Status: reviewed

Phase 2b review of task 10's fifth attempt (`bench.ts`), sent back when `frames.fraction-of-frame` became one input event's operations, measured on the circles app's taps (behavior.md, 2026-11-13). Drafted by the design agent; no item needed the human's decision.

## Choices

- **open** 10,000 circles, one per grid cell, radii 30 to 130 so taps find overlapping circles (2.32 on average).
- **open** A drawing tap's circle: radius 80, one color.
- **open** Drawing taps anywhere; erasing taps on a circle's center.
- **open** Each tap undone untimed, so every tap sees 10,000 circles.
- **open** The median of 101 taps after 20 warm-ups.
- **open** The locator table's strokes, unchanged.
- **open** An erasing tap that finds nothing fails the run.
- **open** Measured numbers as ranges over eight runs.

## Notes

- **nothing** The locator measurements already used string IDs.
- **nothing** The removed ink measurements took their helpers with them; `inkStroke.ts` stays for the locator table.
- **nothing** `frames.ts` declares only interfaces, so the script doesn't import it; `npm run catalog`, run in the repo, still finds the budget.
- **nothing** Both taps are far inside the budget; erasing costs about four times drawing, mostly `atPoint` and `compareZ`.
- **nothing** Overlapping circles, so `compareZ` has something to decide: the layout is the implementer's, and the output states it.
- **nothing** The ratios moved within their ranges; all under 16, and the clear pattern below 1.
