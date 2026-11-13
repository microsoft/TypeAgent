Status: done

`npm test` passes, `npm run typecheck` reports no errors, and `npm run bench`
exits 0. Four runs of `npm run bench` on an Intel Core i9-14900KF, Windows 11,
Node v26.13.0 gave the numbers now in the Cost fields.

What the budgets measured, over those four runs:

- `frames.fraction-of-frame`: finishing a stroke takes 0.4-0.5% of the budget
  (5% of a 120 Hz frame, 0.417 ms), an eraser move 1.7-2.1%. Both are inside
  it; nothing was marked over budget.
- `ShapeCollectionWriter.log-amortized`: 2.6-5.9 (adds below one shape),
  3.2-6.0 (adds below the one added before), 3.1-6.3 (adds at the bottom),
  5.2-8.9 (adds below random shapes), 4.3-6.2 (removes mixed with adds),
  8.4-10.1 (compareZ). All below the limit of 16.
- `ShapeMessageProcessor.log-amortized`: 2.6-2.8 (remote adds while one local
  add is pending, then local adds), 0.5-0.8 (remote clears that remove
  nothing). Both below 16.

The eight patterns are those the spec lists, in its order. Seven of them, the
frame-budget section and the locator table were already in `bench.ts`; this
attempt added the eighth pattern (the remote clears that remove nothing) and
restated every measured number from this run's four runs.

## Choices

Every choice below is in `bench.ts`, a script, so its header has How, Run and
Imports rather than AdditionalSemantics and Cost; where a choice is a number
the output has to state, it is printed with the measurement, as the field names
say and as the spec asks for the shapes and the layout.

- **The model's 10,000 strokes** are ink strokes of 2 to 20 points and
  thickness 1 to 8, each a random walk a few units per step, one per cell of a
  100 x 100 grid over the 10,000 x 10,000 canvas, placed within the first 60%
  of its cell. Recorded in bench.ts's How and printed above the frame-budget
  table.
- **The stroke a move finishes** is one more such stroke, at
  `((i * 131) % (CANVAS - 200)) + 100, ((i * 71) % (CANVAS - 200)) + 100` so
  that no two moves work the same cells. Printed above the table.
- **The eraser** is a round pen of diameter 20 dragged 15 units right and 10
  down from the first point of a model stroke, so that every move erases; its
  swept rectangle is the bounding box of a two-point stroke of that thickness.
  Recorded in bench.ts's How and printed with the average hits per move (1.06).
- **Putting the model back** after each timed move, untimed: the finished
  stroke is removed again, and what the eraser erased is added back under fresh
  IDs, so every timed move sees 10,000 shapes. Recorded in bench.ts's How.
- **Sample counts**: 101 timed moves after 20 warm-up moves, median; the
  locator table is the median of 9 runs after 2; each log-amortized pattern is
  the median of 5 runs after 1, over batches of 1,000 operations. All printed.
- **The clear pattern's client** is the stand-in's peer processor: it stamps
  each clear, so the clear's refSeq is the peer's -1 (it has applied no remote
  operation), and it makes no adds in this pattern, so the clear knows none of
  the shapes present and all of them stay. Recorded on `Infra.deliverClear` and
  printed above the processor table.
- **One clear counts as one operation**, and a batch delivers all 1,000 clears
  and then calls `process` once, as the adds pattern does. Printed as the
  batch size; the pattern's row gives the time per operation.
- **A clear that removes something fails the run** (nonzero exit), beside the
  ratio above 16 and the locators disagreeing on hit counts: it would mean the
  row measures a clear that removes shapes, not one that removes none.
  Recorded in bench.ts's Run field.
- **The ratio patterns' shapes** are two-point strokes of thickness 2 scattered
  over the canvas, from one pool built before the clock starts. Printed above
  the ratio tables.
- **Repeatability**: every random choice comes from a seeded mulberry32
  generator, and a checksum of the results the timed loops would throw away is
  printed so the work can't be optimized away. Recorded in bench.ts's How.
- **Restating the locators' numbers**: `listLocator.ts` and
  `quadTreeLocator.ts` keep their ratios and crossovers in Cost and Choose
  when, each naming `npm run bench (bench.ts)` and giving the range over this
  run's four runs, with the absolute times and the machine left to the script's
  output. The crossover is still that QuadTreeLocator is ahead on queries at
  every size measured, from 100 strokes up, and behind on build and
  removeMultiple at every size, with no crossover up to 10,000.

## Notes

- `bench.ts` arrived with the frame-budget section, the locator table and seven
  of the eight log-amortized patterns in place, so the work was the clear
  pattern plus fresh numbers. The spec's sentence that the locators' Cost
  fields "now give absolute times and name the machine" no longer describes
  them: they already read as ratios naming `bench.ts`. I took the instruction
  as it is meant -- Cost holds ratios and crossovers from this run, absolutes
  stay in the output -- and refreshed the ranges, since nothing turns on which
  of the two readings applies.
- The clears' ratio is below 1 (0.5-0.8): a clear that knows nothing walks none
  of the processor's records, so it costs the same at 100,000 shapes as at
  1,000, and what is left is noise. The time per operation at 1,000 is both
  higher and more variable (0.11-0.18 us against 0.095-0.098 us at 100,000);
  the batch at 1,000 follows a fill of only 1,000 adds, so less of the enqueue
  path has been through the JIT's higher tiers when the clock starts. The
  budget asks for time in proportion to the shapes a clear removes rather than
  to the shapes present, and a flat measurement is what that predicts.
- The writer ratios move a lot between runs at these batch sizes: "adds below
  one shape" measured 2.59 to 5.85 across the four runs, and "adds at the
  bottom" 3.12 to 6.27, which is why the Cost fields give ranges. compareZ is
  consistently the highest (8.4-10.1): it is the cheapest operation at 1,000
  shapes (0.13-0.14 us), so the cache misses at 100,000 are almost all of its
  cost.
- The whole run takes 9 to 10 seconds, most of it the six fills of 100,000
  shapes the two processor patterns need; the clear pattern added about 2
  seconds, and bench.ts's Run field now says about 15 seconds to leave room for
  a slower machine.
- One thing none of these files states: whether a peer's operations may be
  stamped by a second `ShapeProcessor` that never processes its own queue. The
  stand-in does that (it is how `deliverAdd` already got a stamped remote add),
  and it is sound here because `MessageProcessor.stamps` fixes what enqueue
  returns and `passive` says nothing is applied until `process` is called, so
  the peer's untouched queues can't change what the target sees.
