Status: done

## Choices

Everything the spec decided is implemented as written; these are the open
details I settled.

- **Class layout and names.** Fields for the model, context and scheduler;
  one stored `onChange` arrow so `dispose` removes that exact listener; a
  `disposed` flag that `frame` and `dispose` both check; a private
  `fillCircle` helper for the four context calls; a module-level `isCircle`
  type guard and a module-level `identity` viewport constant. Recorded in
  the header's How and Parts (none: the helpers are too small to be
  interfaces of their own).
- **`viewport` reads as one shared object.** The getter returns the same
  frozen-by-convention `identity` value every time rather than a fresh
  object per read, since a Viewport is an immutable value. Recorded under
  AdditionalSemantics.
- **Every set of `viewport` is ignored**, with no validation of the value
  and no throw: the identity because setting it does nothing, any other
  value because it is outside the rules for now. The spec decided to ignore
  both; that there is also no error is recorded under AdditionalSemantics.
- **Non-circle shapes are skipped** rather than drawn, reported or thrown
  on. `ShapeView.circles-only` makes them the caller's responsibility, so
  the behavior is mine to pick; skipping keeps `frame` total. Recorded under
  AdditionalSemantics.
- **No caching or culling.** `ShapeView` allows caching a shape's drawing by
  ShapeId, and nothing requires culling; each frame redraws every circle,
  including circles wholly off the surface, and keeps nothing between
  frames. Recorded under AdditionalSemantics and Cost.
- **The canvas size is read each frame**, so `clearRect(0, 0, width, height)`
  covers a canvas that was resized since the last frame. Recorded under
  AdditionalSemantics.
- **`fillStyle` is set before `beginPath`** for each circle ("set first" in
  the spec), and the number is interpolated with no rounding or formatting,
  so an alpha like 1/3 keeps its full precision. The decided behavior fixes
  the string's form; the order of the two calls is not observable through
  the recording context.
- **Viewport registrations are kept in an `unknown[]`, oldest first**, so
  `off` removes the most recent registration of a listener
  (`EventEmitter.removes-one`) and `on` keeps duplicates. There is no emit
  path, because `viewport` is never emitted yet. Recorded under
  AdditionalSemantics.
- **No measured numbers** in the header: this task has no benchmark script,
  and Cost states only the shape of the work (one clearRect plus four calls
  per circle).

## Notes

- `color.ts` is not among this task's imports, and it doesn't need to be:
  `Circle.color`'s type arrives through `shape.ts`, and destructuring
  `{ r, g, b, a }` needs no named type. Nothing had to be restated.
- `view.ts` and `events.ts` are listed as allowed imports but aren't
  needed: `ShapeView` already extends `View` and `EventEmitter`, so the
  `on`/`off` and `viewport` signatures come from `shapeView.ts`. The lint
  rejects a header `Imports` field that lists a file the source doesn't
  import, so the header lists only the six files actually imported.
- `erasableSyntaxOnly` rules out constructor parameter properties, so the
  three constructor arguments are assigned in the body.
- The generic `on`/`off` signatures can't push a
  `(...args: ViewEvents[E]) => void` into a typed list without a cast while
  `E` is still generic. `eventkit.ts` solves this with an `unknown[]` and a
  cast at the boundary; I used the same shape, which also keeps the cast out
  of anything to do with `canvas.ts`.
- `TASK.md` points at `method.md` for how `canvas.ts` is a platform subset.
  That file isn't in the workspace, and nothing depended on it: `canvas.ts`'s
  own header and the `restrict` proxy in `viewkit.ts` say what the rule
  amounts to in practice (use only the six listed members, no casts).
- The scenarios pass with the view drawing in surface coordinates: the
  fixture gives the recording context the drawing's size and the reference
  app converts window points to view points before sending operations, so
  the identity viewport is all the view needs.
