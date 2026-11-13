Status: done

## Tests

- **zero radius: the exact wording of the positive-radius message** Both
  throw a `RangeError` for `{ radius: 0 }`, as the spec's Validation line
  says, but they word it differently: A says
  `Circle.positive-radius: radius must be greater than 0`, B says
  `Circle.positive-radius: the radius must be greater than 0`. The test
  asserts A's wording. No rule decides this: the spec fixes the error class
  and nothing about the message, so this is a freedom both runs used
  differently. (Their `Color.rgb-range` and `Color.alpha-range` messages are
  character for character identical, so only two of the four messages
  differ.)

- **a non-finite center: the exact wording of the finite-number message**
  The same freedom for the other message that differs: for
  `{ center: { x: NaN, y: 0 } }` both report the non-finite-number rule, A as
  `every number in the fields must be finite` and B as
  `every number must be finite`. The test asserts A's wording. Decided by no
  rule; the spec's Validation line only names `rules.ts` and `RangeError`.

- **a non-finite color channel is reported as the same rule as an out-of-range one**
  This is the order of the checks, not their wording. A
  tests finiteness of every number first, then `Circle.positive-radius`,
  then Color's range rules; B tests `Circle.positive-radius`, then Color's
  range rules, then finiteness. So for `{ color: { r: NaN } }`, which breaks
  both `Color.rgb-range` and the finite-number rule, A blames the finite
  rule and B blames `Color.rgb-range` — the same message it gives for
  `r: 256`. The test compares the two messages instead of matching either
  one, so it depends on the order and not on the wording; it passes on B.
  The spec leaves this order open: it lists the three grounds for a
  `RangeError` in one sentence and never says which to report when fields
  break more than one. The sets of accepted and rejected field sets are
  identical in A and B, so the order is the only visible part of this.

- **intersects a rectangle whose right edge rounds down to its left edge**
  A real geometric disagreement, and the only one I found. With
  `center = (2^52, 0)`, `radius = 4` and
  `r = { x: 2^52, y: -0.5, width: 0.25, height: 1 }`, `r.width` is 0.25 but
  `r.x + r.width` rounds back to `r.x`, so `isEmpty(r)` is false while r's
  computed extent is empty. A guards with the pair of half-open overlap
  tests `box.x < right(r) && r.x < right(box)` (per axis), which r passes,
  then measures the distance to r, gets 0, and answers true. B first builds
  the overlap rectangle, `left = max(box.x, r.x)`, `right = min(right(box),
  right(r))`, and demands `left < right`; here both are `2^52`, so B answers
  false before measuring. `Circle.exact-intersects` decides it as written:
  `implies(!isEmpty(r) && distPolylineToRect([this.center], r) <
  this.radius, this.intersects(r))`, and the test asserts each clause of
  that antecedent with the vocabulary's own functions before asking
  `intersects`. By that rule A is right and B breaks it; the reference
  (`viewkit.ts`'s `testCircle`) agrees with A. The disagreement is one-sided:
  B's guard implies A's, and on every rectangle whose extent is non-empty as
  computed the two answer alike, ties included — see the Notes.

- **the circle, its center, its color and its bounding box are frozen**
  B freezes the returned object, its `center`, its `color` and the rectangle
  `boundingBox()` returns, and records this in its header; A freezes
  nothing, so `Object.isFrozen` is false for all four. The test asserts
  frozen, so it passes on B. No rule decides it: `Shape.immutable` says the
  data fields "keep the values they had when it was made" and the spec's
  Copying line is about the caller's objects; neither asks for, nor forbids,
  enforcement by freezing. A's fields are writable in practice, which is a
  way to break `Shape.immutable` that B denies, but a caller that does that
  is already outside the interface.

- **the circle is a plain object, not an instance of a class** B returns an
  object literal, so its prototype is `Object.prototype`; A returns an
  instance of a private class, so its prototype is that class's. Nothing in
  the spec or the interfaces fixes this — an implementer's choice of data
  layout — but it is visible through the value the interface hands back.

- **the circle has no own property beyond the interface's members** A's
  class keeps its precomputed bounding box in a `private` field, which is
  `private` only to the compiler: `box` is an own enumerable property of
  every circle A makes, so it shows up in `Object.keys` (and in
  `JSON.stringify`) beside `kind`, `center`, `radius` and `color`. B closes
  over its box instead, so its own properties are exactly the interface's
  seven members. The test allows only those seven names and so passes on B.
  Decided by no rule; `Circle` and `Shape` say what a circle has, not what
  it may not have.

- **contains still works when it is called apart from the circle** A's
  `contains` is a class method that reads `this.box`, so calling it on its
  own — `const contains = c.contains; contains(p)` — throws a `TypeError`;
  B's is a closure over its fields, so it keeps working. The test calls the
  extracted function and so passes on B. This is the behavioral side of the
  previous two tests' difference (class versus closure). The rules say
  nothing about it: `Shape.contains` is declared as a method, and whether a
  method survives being detached is outside what the spec fixes, so I count
  this as a freedom rather than as anything either run got wrong.

- **makeCircle reads the caller's center.x exactly once** With a `Point`
  whose `x` is an accessor that counts its reads and returns 3 — still a
  `Point`, and still immutable from the callee's side — B reads `center.x`
  once and A reads it twice (once in its finiteness check, once when
  copying). Both build the same circle. The test asserts one read, so it
  passes on B; the reference also reads twice. How often an implementation
  reads the fields it was handed is not something the spec or the rules fix;
  the Copying line only requires that later changes to the caller's objects
  not reach the circle, which both honor.

## Notes

- **What the two agree on.** `contains` is the same computation in both
  (half-open bounding box, then `Math.hypot(...) <= radius`), `boundingBox`
  returns the same rectangle values and the same object on every call in
  both, `kind` is `"circle"` in both, both copy `center` to x and y and
  `color` to r, g, b and a and drop anything else, and both accept and
  reject exactly the same field sets with a `RangeError` — only the message
  and the order of blame differ. I found no case where they disagree about
  `contains`.

- **Why `intersects` agrees almost everywhere.** A clamps the center to r
  and compares the distance with the radius, breaking an exact tie with
  `contains(nearest)` plus r's own excluded edges; B clamps the center into
  the overlap of the bounding box and r and turns the comparison strict when
  the clamp lands on the overlap's excluded right or bottom edge. The
  clamped distances are the same double in every case: on each axis the
  clamp is at `r.x`, at the center, or at `right(r)` for both, because the
  center always lies strictly inside the box's own range. The tie rules also
  coincide: B's `cx < right` fails exactly when A's nearest point sits on
  r's excluded right edge, and A's extra `contains(nearest)` test can only
  fail for a nearest point on the box's excluded edges, which its guard has
  already rejected. What is left is the guard itself: A's two comparisons per
  axis assume both rectangles are non-empty as computed, while B's
  `left < right` re-derives it. So they differ only on a rectangle (or a
  bounding box) that is non-empty by its width and height yet empty once
  `x + width` is rounded — the case the fourth test uses. The mirror case,
  a box with a radius so small beside a center so large that
  `box.x + box.width === box.x` (for example `center.x = 2^52`,
  `radius = 2^-30`), is the same difference in A's favor and I did not add a
  second test for it.

- **A gap worth reporting, not just a difference.** The fourth test's
  rectangle shows the rules pulling two ways. `Circle.exact-intersects`
  makes the answer true, because `isEmpty` looks at `width` and
  `distPolylineToRect` measures to the closed rectangle. But `Shape` says a
  shape's methods "agree with one another as actually computed, rounding
  included", and `Shape.intersects.only-shared` says a shape intersects r
  "only when some point is in both" — and no point is in that r as computed,
  since `rectContains(r, p)` is false for every p when `right(r) === r.x`.
  So A satisfies the refining rule and breaks the abstract one, B the other
  way around, and the contract suite catches neither: its generated
  rectangles come from `testkit.ts`'s small grid, where no edge is absorbed.
  Either `isEmpty` should be the computed test (`right(r) <= r.x ||
  bottom(r) <= r.y`), or `Circle.exact-intersects` should be stated for
  rectangles that are non-empty as computed, and the contract should carry a
  fixed case like this one.

- **Which freedoms these differences come from.** Four messages' wording and
  the order the checks run in (tests 1 to 3); whether the result is frozen
  (test 5); class with a precomputed field versus closures over it (tests 6
  to 8, one choice seen three ways); and how often the caller's fields are
  read (test 9). Only test 4 turns on a rule.

- **Running the checks here.** `npm run typecheck`, which is the compile
  against the reference `circle.ts`, passes. `npm run check` prints all nine
  tests as `A pass B FAIL` or `A FAIL B pass`, and then reports the same two
  errors for the reference, A and B — `Cannot find type definition file for
  'node'` and `Unknown compiler option 'erasableSyntaxOnly'` — in the
  scratch copies it compiles. Those come from the scratch copy's
  `node_modules` junction being built from the directory the script runs in
  (`.task` inside the workspace, which has none), so `npx` picks up an older
  `tsc` without the repo's `@types/node`; the same compile succeeds through
  `npm run typecheck` in the workspace itself. Nothing in
  `distinguish.test.ts` can change it, and the collector, which runs from
  the repo, should not see it.
