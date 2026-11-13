Status: done

## Choices

- **Validation order** (header: no AdditionalSemantics recorded, since the
  interface doesn't specify which rule is checked first and the contract
  only requires a `RangeError`): `makeCircle` checks finiteness of every
  field first, then `Circle.positive-radius`, then `Color.rgb-range`, then
  `Color.alpha-range`. The spec names all four but not an order, and the
  test only checks that each bad case throws `RangeError`, not a message,
  so any order satisfies it.
- **Error messages**: each `RangeError` names the rule it enforces, purely
  for diagnostics; nothing in the spec or tests constrains the message
  text, so this isn't recorded as AdditionalSemantics (it isn't behavior
  callers can rely on).
- **`intersects`'s algorithm** (left to the implementer by name): it
  rejects `r` unless `r` shares a point with the cached `boundingBox()`,
  using the same half-open, nonzero-area rule `RectangleOps.intersects`
  states; this is a hard prefilter, not an optimization, because it's the
  only way to satisfy `Shape.intersects.implies-box` once rounding is
  considered (see Notes). Past that gate, it clamps the center into `r`
  to get the closest point, compares the distance to `radius`, and only
  when that distance ties `radius` exactly (as computed) does it fall
  back to asking `contains()` on the clamped point, additionally checking
  that the point is also within `r`'s own half-open edges. This is how an
  exact touch ends up decided by `contains()`, as the spec requires,
  while non-tie cases resolve by the distance comparison alone.
- **`boundingBox()` caching**: the rectangle is built once in the
  constructor and stored in a private field, returned by reference every
  call, matching the decided "same object every time" behavior. Recorded
  under AdditionalSemantics in the header, since the `Shape` interface
  doesn't require object identity across calls, only value equality.
- **Internal layout**: a private `CircleImpl` class backs `makeCircle`;
  `containsXY(x, y)` is a private helper taking raw coordinates so that
  `intersects`'s tie-break can reuse `contains`'s exact logic without
  allocating a `Point`. Noted under Parts as "none" in the header, since
  this is an implementation detail, not something that could stand as its
  own interface.

## Notes

- The hardest part was `intersects` at points where the circle's extreme
  point rounds to exactly the rectangle's edge. An early version computed
  only the clamped-point distance and returned true whenever it was
  strictly less than `radius`, reasoning that strict inequality always
  leaves room for a nearby witness point inside the true (half-open) `r`.
  That reasoning fails when the clamped point sits exactly on a
  coordinate shared with the circle's own cached `boundingBox()`'s
  excluded edge, computed via a different arithmetic path that doesn't
  round the same way as a direct `center + radius`: `circle.contract.ts`'s
  "rounded" case (center 0.4, radius 0.71) relies on exactly this, where
  `boundingBox().x + boundingBox().width` as computed is below the
  "true" `center.x + radius`, so a naive clamp-and-compare finds a point
  just past the box's own edge that still measures strictly less than
  `radius` away. Nothing outside `shape.ts`'s own invariant ("contains and
  intersects never reach outside the rectangle that boundingBox returns")
  says this must be rejected before the distance check; I only found it
  by running the suite and tracing why `Shape.intersects.implies-box`'s
  property test failed on a similarly rounding-sensitive case. Adding the
  box-overlap prefilter, using the box's own cached, as-computed edges
  (not a freshly recomputed `center ± radius`), fixed both failures at
  once, since any witness point must lie in the box by `contains`'s own
  implies-box rule, so rejecting `r` when it shares no point with the box
  can never discard a real intersection.
