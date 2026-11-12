Status: done

## Choices

- **How `intersects` finds the nearest point** (the explicit "left to the
  implementer" item; header *How* and the comment on `intersects`). It
  intersects the bounding box with `r` into one half-open overlap rectangle,
  clamps the center to each axis of that overlap, and compares
  `Math.hypot` of the two axis distances with the radius. An empty overlap
  returns false, which is exactly `rectIntersects(this.boundingBox(), r)`
  being false, so `Shape.intersects.implies-box` and `empty-rect` hold by
  construction rather than as separate checks.
- **Strict comparison on an unreached edge** (header *How*; same comment). A
  clamp that lands on the overlap's excluded right or bottom edge gives a
  distance the region never actually reaches, so on those axes the comparison
  with the radius is `<` rather than `<=`. This is what makes "an exact touch
  is decided by `contains`" come out right in the cases the contract's fixed
  touches don't cover: for the circle at the origin with radius 2.5 and
  `r = { x: -5, y: 2, width: 3.5, height: 1 }`, the overlap with the box is
  not empty, and `r`'s nearest point to the center is `(-1.5, 2)` at distance
  exactly 2.5 — on `r`'s excluded right edge, so no point satisfies both
  `contains` and `rectContains(r, ...)` and `intersects` is false. A
  non-strict comparison would say true there. The contract skips that case (it
  is a tie), so the choice is not forced by a test.
- **Deriving the box's excluded edges from the box itself** (header *How*).
  `boxRight` is `box.x + box.width`, not `cx + radius`; off the half grid those
  differ by a rounding step, and the rules' `right()` and `bottom()` use the
  former, so the methods agree with the returned rectangle as computed.
- **Validation order and messages** (header *AdditionalSemantics*): radius,
  then color, then finiteness, each with a `RangeError` naming the rule. All
  three throw the same class, so the order is only visible in the message.
- **Freezing** (header *AdditionalSemantics*): the circle, its center, its
  color and its bounding box are frozen, which is a stronger guarantee than
  `Shape.immutable` asks for but cannot be observed except by a caller trying
  to write.
- **`boundingBox` object identity** (header *Cost* and *AdditionalSemantics*):
  the box is computed once and the same object is returned every call, which
  satisfies "returns the same rectangle every time" in both readings available.
- **Behavior outside the rules** (header *AdditionalSemantics*): fields of the
  wrong static type, such as a missing `center`, throw a `TypeError` from the
  field reads, not a `RangeError`.
- **Data layout** (header *How*, *Parts*): a closure, not a class. The box and
  its two derived edges stay out of the object's own properties, so the field
  snapshot `Shape.immutable` takes with `JSON.stringify` is just `kind`,
  `center`, `radius` and `color`.

## Notes

- `Math.hypot` is not an incidental choice: `distToPolyline` in
  `geometry.vocab.ts` computes a one-point polyline's distance with exactly
  that call, so `contains` agrees with `Circle.disk` bit for bit instead of
  within a tolerance. Squaring instead (`dx * dx + dy * dy <= radius * radius`)
  would round differently and `Circle.disk` holds "as computed".
- Likewise `width` is `2 * radius` rather than `radius + radius`, matching
  `inflate`'s `r.width + 2 * d` with `r.width === 0`.
- `Shape.intersects.witness` is checked with no tie skipping, so `intersects`
  has to be consistent with `contains` as computed, not just in exact
  arithmetic. It is, for the inputs the contract generates: on the half grid
  every squared distance is a multiple of 0.25, so a distance that exceeds the
  radius exceeds it by far more than a rounding step, and `Math.hypot` cannot
  round it down onto the radius. In full generality the two could in principle
  disagree within one ulp of a tie, because `intersects` reasons about a real
  region while `contains` is asked about a particular double; nothing in these
  files says which of the two wins there, and no rule or test reaches it.
- The spec does not bound the radius, and nothing here needs it to: `2 * radius`
  overflows to `Infinity` only above about 9e307, and such a circle would break
  `ShapeLocator.add`'s `in-range` precondition rather than any rule of
  `makeCircle`. I left the radius unbounded above and do not check for the
  overflow.
- `makeCircle.copying` passes `{ x: 1, y: 2, z: 3 }` and a color with a `name`
  property, and the assertion uses `deepEqual`, which compares key counts. So
  "keeps its own copies of `center` (x and y only)" is enforced as "has exactly
  those keys", not merely "has at least those values" — a spread copy would
  fail.
