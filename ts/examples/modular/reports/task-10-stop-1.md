Status: stopped

## Questions

### 1. What ratio fails the two `log-amortized` budgets: 4 or 16?

**Where.** `shapeModel.ts`, rule `ShapeCollectionWriter.log-amortized` (line 55):
"… bench.ts measures the time per operation at 100,000 shapes against 1,000,
**and fails above a ratio of 4**." `ShapeMessageProcessor.log-amortized`
(line 144) inherits that threshold: "bench.ts measures it as for
ShapeCollectionWriter.log-amortized."

`TASK.md` section 10: "Logarithmic growth gives a ratio of about 2 in the number
of steps, and linear growth about 100. Measured times grow more than the steps
do, because 100,000 shapes don't fit in the processor's caches and 1,000 do;
**ratios of 4 to 9 are what a logarithmic structure measures here**. Unlike the
frame budget, **a ratio above 16 is a failure**: print it and make `bench.ts`
exit with a nonzero status."

**What is inconsistent.** The two texts give different thresholds for the same
decision in the same output, and they disagree about the same band of values:
`TASK.md` calls 4 to 9 the normal measurement for a structure that meets the
budget, while `shapeModel.ts` says a ratio in that band fails the budget. No
reading satisfies both. The threshold is not a detail the spec leaves open: it
decides what `bench.ts` prints next to each pattern, whether `bench.ts` exits
nonzero, and what the Cost fields of `mapShapeCollection.ts` and
`shapeProcessor.ts` must state (they currently say "above 4 fails", which is
part of what this task rewrites).

**The readings.**

- **A — 4 governs** (`shapeModel.ts`): mark every ratio above 4 as exceeding the
  budget and exit nonzero; the Cost fields say "above 4 fails".
- **B — 16 governs** (`TASK.md` section 10): 4 to 9 is the expected range, mark
  and exit nonzero only above 16; the Cost fields say "above 16 fails" and that
  4 to 9 is what this structure measures.
- **C — both, at different severities**: print "exceeds the budget" above 4,
  because that is the rule's threshold, but exit nonzero only above 16, because
  `TASK.md` makes only that a failure and `rules.ts` says exceeding a `@budget`
  is "reported, not a test failure". The Cost fields would then have to state
  both numbers.

**A concrete case.** `npm run bench` on this machine measured the
`ShapeCollectionWriter.log-amortized` pattern "adds, each directly below the one
added before it" at a ratio of **5.71**, and "adds below random present shapes"
at **8.55** (full numbers below). Under A, five of the six writer patterns fail
and `bench.ts` exits 1 — which is what it does today. Under B, every pattern is
within the expected 4-to-9 band and `bench.ts` exits 0. Under C, the same five
patterns are printed as over budget but `bench.ts` exits 0. The three readings
differ in the script's exit status and in its printed verdicts on this very run,
so the choice cannot be deferred or hidden behind a constant.

**What I need to be told.** Which threshold `bench.ts` marks with, and which it
exits nonzero on. If the intended answer is 16, `shapeModel.ts`'s two
`log-amortized` rules need the same number, since they name `bench.ts` and its
failure threshold explicitly and are read-only here; I cannot bring the rule and
the script into agreement from inside this task.

### 2. Does "refresh the locator numbers" keep absolute times in those headers?

**Where.** `TASK.md` section 10: "Run `npm run bench` and record its numbers in
the Cost fields, as 'Measured numbers' describes, and **refresh the locator
numbers** in `listLocator.ts` and `quadTreeLocator.ts`." The "Rules for every
implementation" say: "**Measured numbers** in headers are ratios and crossover
points (for example '10x faster inRect at 1,000 shapes; faster from about 100'),
each naming the script that measures it. Absolute times depend on the machine
and belong in the script's output, not in headers."

**What is inconsistent.** The locator numbers now in those two headers are
absolute times, with the machine named: "For 100 / 1,000 / 10,000 strokes: build
0.008 / 0.025 / 0.36 ms …; eraser inRect 0.86 / 9.4 / 112 us per query …". That
is the form the Measured-numbers rule forbids, so "refresh" and "as 'Measured
numbers' describes" pull in opposite directions for the only numbers the task
names explicitly.

**The readings.**

- **A — update in place:** re-measure and replace the absolute times with this
  run's, keeping the headers' present form and detail.
- **B — restate as the rule requires:** drop the absolute times and the machine
  from both headers, leaving ratios and crossover points that name `bench.ts`
  (for example "QuadTreeLocator answers an eraser `inRect` about 3x faster at
  100 strokes, 15x at 1,000 and 12x at 10,000; ListLocator builds about 5 to 7x
  faster and bulk-removes 3 to 7x faster"), and let the absolute times live only
  in `npm run bench`'s output.

**A concrete case.** This run measured ListLocator's build at 100 / 1,000 /
10,000 strokes as 0.011 / 0.026 / 0.592 ms against the 0.008 / 0.025 / 0.36 ms
in the header, and its eraser `inRect` at 145.8 us per query at 10,000 against
the recorded 112. Under A those six numbers (and a dozen more) are rewritten and
the header still carries machine-dependent times; under B they disappear from
the header entirely and the ratio "15-60x slower at 10,000" becomes "12x slower
for `inRect`, 69x for `atPoint`". The headers differ in most of their Cost text
between the two readings.

**What I need to be told.** Whether the locator headers keep absolute times at
all. I lean to B, because the Measured-numbers rule is explicit and general and
section 10 ties the recording to it, but the collected headers were written the
other way, so I am not deciding it.

## What this attempt measured

`npm run typecheck` reports no errors. `npm run bench` runs and exits 1, on its
present threshold of 4. The run, on an Intel Core i9-14900KF, Windows 11
(10.0.26200), Node 26.13.0:

- `frames.fraction-of-frame`, with 10,000 ink strokes in the model: finishing a
  stroke 0.0018 ms, 0.004 of the 0.417 ms budget; an eraser move 0.0055 ms,
  0.013 of it. Neither is close to the budget.
- `ShapeCollectionWriter.log-amortized` ratios (100,000 against 1,000): adds
  below one shape 3.69; adds below the one added before 5.71; adds at the bottom
  4.79; adds below random shapes 8.55; removes mixed with adds 5.12; `compareZ`
  on random pairs 8.40.
- `ShapeMessageProcessor.log-amortized`: remote adds while a local add is
  pending, then local adds, 2.68.
- The locator table: ListLocator build 0.011 / 0.026 / 0.592 ms and
  QuadTreeLocator 0.052 / 0.185 / 3.906 ms at 100 / 1,000 / 10,000 strokes;
  eraser `inRect` 0.948 / 9.698 / 145.828 us against 0.315 / 0.653 / 12.386 us
  per query; `atPoint` 0.912 / 7.944 / 132.150 us against 0.346 / 0.523 / 1.922
  us; `removeMultiple` of 10% 0.002 / 0.007 / 0.042 ms against 0.006 / 0.022 /
  0.286 ms. The two locators agreed on every hit count.

Every ratio falls between the two candidate thresholds except the processor
pattern, so question 1 decides this run's verdict and exit status.

## State of the outputs

I changed nothing. `bench.ts` and the four headers are as this workspace was
made, so `bench.ts` still fails above 4 and the headers still say so; the
read-only files are untouched. The remaining work is small and all of it waits
on the two questions: the threshold constant and the printed and exit-status
wording in `bench.ts` (question 1), the Cost fields of `mapShapeCollection.ts`
and `shapeProcessor.ts`, which must state the threshold and this run's ratios
and fractions (question 1), and the Cost and Choose-when fields of
`listLocator.ts` and `quadTreeLocator.ts` (question 2).
