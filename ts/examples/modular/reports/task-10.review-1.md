Status: reviewed

Phase 2b review of task 10 (`bench.ts`), drafted by the design agent; the human decided each item.

## Choices

- **open** One stroke per cell of a 100 x 100 grid, at a seeded random point in the cell.
- **open** Strokes are random walks of 2 to 20 points, thickness 1 to 8.
- **open** The eraser is a round pen of diameter 20, and its swept rectangle comes from a two-point stroke.
- **open** Every eraser move starts on a stroke, so each move erases something.
- **open** The timed region runs from the controller's first call to the end of `process`; building the stroke and the rectangle, and putting the model back, are untimed.
- **open** Sample counts: the median of 101 moves after 20 warm-ups; batches of 1,000, the median of 5 runs after 1 warm-up.
- **open** The log-amortized patterns hold short two-point strokes.
- **reading** "Adds at the bottom" read as each add becoming the new bottom, and the second pattern starting below the top shape. Settled in its favor: task 10 now says so.
- **reading** "Removes mixed with adds" read as alternating one add on top with one remove, each counted as one operation. Settled in its favor: task 10 now says so.
- **open** The stand-in infrastructure delivers a second client's adds from another `ShapeProcessor`.
- **open** Collections are filled untimed: straight adds for the writer patterns, acknowledged local adds for the processor.
- **respecify** Exit status: nonzero when a ratio exceeds 4. Measured, five writer patterns ran 4.9 to 8.4 on an AVL tree, which is logarithmic by construction; the excess is cache misses at 100,000 shapes. Decided by the human: the threshold is 16, which still fails linear growth (about 100) by a wide margin.
- **open** The header is in the script form.
- **open** String IDs for the locator measurements are `String(i + 1)`.

## Notes

- **spec fix** `bench.ts` was never run: the workspace allowed only `npm test`, `npm run typecheck` and `npm run check`. `task.ts` now allows `npm run bench` to a task that writes `bench.ts`, and task 10 asks for the run's numbers in the Cost fields, with `listLocator.ts` and `quadTreeLocator.ts` added as header-only outputs.
- **spec fix** Cache effects can push a ratio above 4: the same fix as the exit status. Task 10 now explains that ratios of 4 to 9 are expected.
- **nothing** Putting the model back after an eraser move needs fresh IDs from `newShapeId`: `fresh-add-id` requires it.
- **nothing** Most eraser moves would hit nothing with strokes spread out: handled by starting each move on a stroke.
- **spec fix** `frames.ts` wasn't in the workspace. Task 10 now lists it in Imports.
- **nothing** One pattern list for the two `log-amortized` rules, printed under each rule's ID.
- **nothing** A checksum keeps the timed loops from being optimized away.
