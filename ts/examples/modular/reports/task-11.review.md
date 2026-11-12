Status: reviewed

Phase 2b review of task 11 (`circle.ts`), drafted by the design agent; the human decided each item.

## Choices

- **open** How `intersects` finds the nearest point: the spec leaves it to the implementer.
- **adopt** The strict comparison on an excluded edge. It isn't a free choice: `Circle.exact-intersects` ("an exact touch is decided by `contains`") requires it, but the contract skips ties, so nothing tests it. Spec fix: add the agent's case to `circle.contract.ts` as a fixed case of `Circle.exact-intersects` (center (0, 0), radius 2.5, r = { x: -5, y: 2, width: 3.5, height: 1 }: false).
- **open** Deriving the box's excluded edges from the box itself.
- **open** Validation order and messages: all throw RangeError, as decided; the order shows only in the message.
- **open** Freezing: stronger than `Shape.immutable` asks, and allowed.
- **adopt** `boundingBox` returns the same object every call. Task 11 now says so ("the same object every time").
- **open** A TypeError for fields of the wrong static type: outside the rules.
- **open** A closure rather than a class.

## Notes

- **nothing** `Math.hypot` matching `distToPolyline`: a sound way to meet `Circle.disk` as computed.
- **nothing** `2 * radius` matching `inflate`: likewise.
- **nothing** A disagreement between `intersects` and `contains` within one rounding step of a tie: the Shape doc already settles it ("A shape's methods agree with one another as actually computed").
- **nothing** The radius has no upper bound: a circle that overflows breaks `ShapeLocator.add`'s `in-range`, not a rule of `makeCircle`.
- **nothing** `makeCircle.copying` enforces exactly the keys x, y and r, g, b, a: what "x and y only" means.
