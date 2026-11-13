Status: reviewed

Phase 2b review of task 10's fourth attempt (`bench.ts`), sent back by phase 3 (`reports/task-9.d.review.md`) for a clear pattern. Drafted by the design agent; no item needed the human's decision.

## Choices

- **open** The model's 10,000 strokes and their layout, as before.
- **open** Where each finished stroke goes.
- **open** The eraser, as before.
- **open** Putting the model back, untimed.
- **open** Sample counts.
- **open** The clear pattern's client is the stand-in's peer processor, so each clear's refSeq is -1 and it knows none of the shapes.
- **open** One clear is one operation, with one `process` per batch.
- **open** A clear that removes something fails the run, so the row can't silently measure something else.
- **open** The ratio patterns' shapes.
- **open** Seeded randomness and a checksum.
- **open** The locators' Cost fields as ranges of ratios and crossovers.

## Notes

- **spec fix** Task 10's sentence that the locator headers "now give absolute times" was stale after the last attempt restated them. Task 10 now says only what the Cost fields hold.
- **nothing** The clear ratio is below 1, as a clear that walks no records predicts. Swapping in 9.2's current processor, whose clear walks every shape, measures 148 and fails, so the pattern catches the fault phase 3 found.
- **nothing** Writer ratios vary between runs, so the Cost fields give ranges.
- **nothing** The run takes about 10 seconds.
- **nothing** Stamping a peer's operations with a second processor that never processes is sound: `stamps` fixes what enqueue returns, and `passive` says nothing is applied until `process` is called.
