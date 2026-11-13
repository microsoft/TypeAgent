Status: done

## Choices

- **The model's circles: size, colour and layout.** One circle per cell of a
  100 x 100 grid over the 10,000 x 10,000 canvas (so 10,000 of them), each
  centred within 25 units of its cell's centre, with a radius drawn uniformly
  from 30 to 130 units, in five colours taken in turn. The radii reach past a
  cell on purpose: with smaller circles a tap found 1.01 circles on average and
  `compareZ` never had two to compare, so the measurement would not have been
  the one the spec names. At these radii a tap finds 2.32 circles. Recorded in
  `bench.ts`: the `cellCircle` constants (`JITTER`, `MIN_RADIUS`,
  `MAX_RADIUS`, `PALETTE`) with their comments, the `How` field of its header,
  and the line the `frames.fraction-of-frame` section prints, which states the
  layout and the average number of circles a tap finds.
- **The circle a tap draws.** Radius 80 units, one dark colour (the app's
  current pen). Recorded in `bench.ts` (`DRAW_RADIUS`, `DRAW_COLOR`) and in the
  printed line.
- **Where the taps land.** A drawing tap lands anywhere on the canvas; an
  erasing tap lands on the centre of one of the model's circles, which that
  circle contains, which is how "each timed tap lands on a circle" is met. Both
  sequences walk the canvas so that no two taps work the same cells. Recorded in
  `bench.ts`'s comments and in the printed line.
- **Putting the model back after each tap, untimed.** The spec fixes 10,000
  shapes in the model but doesn't say what the model holds after a tap, so each
  tap is undone outside the timed region: a drawing tap's circle is removed
  again, and an erasing tap's circle is added back under a fresh ID. Every timed
  tap therefore sees exactly 10,000 circles. Recorded in `bench.ts`'s comments
  and in the `How` field of its header.
- **How many taps, and which number is reported.** 101 timed taps after 20
  warm-up taps, and the median, as the two measurements that were removed used.
  Recorded in `bench.ts` (`TAPS`, `TAP_WARMUP`) and in the printed line.
- **The strokes the locator table uses.** Unchanged from the previous
  `bench.ts`: random walks of 2 to 40 points and thickness 1 to 8 on the
  10,000 x 10,000 canvas, a 20 x 20 eraser, 1,000 queries of each kind, and
  removal of a tenth of the IDs, under string `ShapeId`s, at 100, 1,000 and
  10,000 strokes. Recorded in the line the locator section prints and in the
  `Cost` fields of `listLocator.ts` and `quadTreeLocator.ts`.
- **An erasing tap that found no circle fails the run.** Like the existing check
  that a clear which should remove nothing removed nothing, a timed erasing tap
  that found nothing under it would be measuring a tap that erases nothing, not
  the tap the spec names, so `bench.ts` prints that and exits nonzero. It never
  triggered. Exceeding the frame budget itself is still only printed. Recorded
  in the `Run` field of `bench.ts`'s header.
- **The measured numbers are ranges over eight runs of the script** on one
  machine, whose CPU, OS and Node version the script prints with the absolute
  times. Recorded in the `Cost` fields of `mapShapeCollection.ts`,
  `shapeProcessor.ts`, `listLocator.ts` and `quadTreeLocator.ts`, each naming
  `bench.ts`.

## Notes

- `ShapeId` being a string needed no change to the locator measurements: they
  already built their IDs with `String(i + 1) as ShapeId`, so they use string
  IDs and are otherwise as they were.
- The two removed measurements were the only users of the swept-rectangle and
  per-cell-stroke helpers, which went with them. `inkStroke.ts` is still
  imported, because the locator table keeps its strokes and the log-amortized
  patterns still run over two-point strokes.
- `bench.ts` doesn't import `frames.ts`, although the task allows it:
  `frames.ts` declares only interfaces, and the budget is a number the script
  computes, `(1000 / 120) * 0.05` = 0.417 ms. The rule's ID appears in
  `bench.ts` as a plain string constant (`FRAME_RULE`) and is printed at the
  head of the section, which is what `npm run catalog` is described as looking
  for; `npm run catalog` isn't one of the commands this workspace can run, so I
  couldn't check it against the script's output.
- Both taps sit far inside the frame budget: a drawing tap at 0.5-0.8% of it
  and an erasing tap at 2.0-2.5%. The erasing tap costs about four times the
  drawing one, which is the `atPoint` on 10,000 circles plus the `compareZ`
  calls; the add, the remove and the processing of each operation and its
  acknowledgment are the cheap part.
- Nothing in the spec says whether the circles a tap erases should be able to
  overlap. I read "`compareZ` to find the top circle there" as meaning the
  measurement should have something for `compareZ` to decide, and chose radii
  accordingly; the layout is explicitly left to the implementer, and the output
  states both the layout and how many circles a tap finds, so the reading is
  visible in the numbers rather than hidden in them.
- The `log-amortized` ratios moved a little against the previous run's recorded
  ranges (for instance "adds, each directly below the one added before it" ran
  from 2.5 to 6.4 over eight runs, against the 3.2 to 6.0 recorded before), so
  the `Cost` fields of `mapShapeCollection.ts` and `shapeProcessor.ts` carry
  this machine's ranges. Every ratio stayed well under 16, and the clear pattern
  stayed below 1, as a clear that walks only what it removes should.
