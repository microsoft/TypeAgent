Status: reviewed

Phase 3b review of task 11's distinguishing tests, drafted by the design agent; the human decided each item. A was run 2 (Sonnet), B run 1 (Opus).

## Tests

- **freedom** The wording of the positive-radius message: the spec fixes RangeError, not the message.
- **freedom** The wording of the finite-number message.
- **freedom** Which rule a field set that breaks two is blamed on: the order of the checks, which both 2b reviews left open.
- **spec gap** **requeue: 11.2** A rectangle that is non-empty by its width but empty as computed (`x + width` rounds to `x`, as at x = 2^52, width 0.25). Sonnet and the reference say a circle around it intersects it, and Opus says not. The rules disagree: `Circle.exact-intersects` uses `isEmpty`, which looks at width and height, while `Shape.intersects.only-shared` and the Shape doc's "as actually computed" say no point is in such a rectangle. The same gap is in `RectangleOps.intersects`'s formula. Made: a rectangle is empty when it is empty as computed (`right(r) <= r.x || bottom(r) <= r.y`, the same as now for width or height 0), in `geometry.ts` and `isEmpty`; fixed cases in the circle, ink stroke and rectangle-operations contracts; adversaries that test emptiness by width. Losers: Sonnet's circle (11.2 goes back for another attempt), `testCircle` (the design agent fixes the kit), and `rectangleOps.ts`, whose fix joins held task 16, which rewrites that file. Opus's circle, the ink stroke and both locators already agree.
- **freedom** Opus freezes the circle, its center, color and box; Sonnet doesn't. The 2b review of task 11 recorded freezing as allowed, not required.
- **freedom** A plain object (Opus) or a class instance (Sonnet).
- **freedom** Sonnet's private `box` field is an own property; Opus has only the interface's members.
- **freedom** A `contains` detached from its circle works (Opus) or throws (Sonnet): the rules say nothing about detached methods.
- **freedom** How often `makeCircle` reads the caller's fields.

## Notes

- **nothing** The two agree on `contains`, the box and copying.
- **nothing** Why `intersects` agrees everywhere else: the agent's argument narrows the difference to the computed-emptiness guard.
- **spec fix** The gap in the rules: the same fix as the fourth test.
- **nothing** The freedoms behind the other tests.
- **spec fix** The `npm run check` scratch copies' `node_modules`: fixed in `task.ts` after 12.d reported it.
