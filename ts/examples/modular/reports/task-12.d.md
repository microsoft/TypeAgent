Status: done

## Tests

- **fillStyle is set before beginPath for each circle** A draws a circle as
  `beginPath()`, `arc(...)`, then sets `fillStyle`, then `fill()`; B (and the
  reference) sets `fillStyle` first and then `beginPath()`, `arc(...)`,
  `fill()`. The test gives the view its own `DrawingContext` (canvas.ts) that
  records the name of each call, fillStyle's setter included, and compares the
  whole sequence for a two-circle model. The spec's Decided behavior says each
  circle is drawn as "`beginPath()`, one `arc(...)`, then `fill()`, with
  `fillStyle` set first", which is what B does; A's reading is that `fillStyle`
  is set before the `fill()` that uses it, which the same sentence also allows,
  so the text decides this only under the first reading. Nothing in
  shapeView.ts or view.ts fixes the order, and `RecordingContext`
  (viewkit.ts) reads `fillStyle` only inside `fill()`, so the contract can't
  see the difference either way.
- **viewport reads as the same object every time** A's getter builds a fresh
  `{ scale: 1, rotation: 0, tx: 0, ty: 0 }` on each read, so two reads are
  different objects; B returns one module-level identity value, the same object
  every time (as the reference does). The test reads `view.viewport` twice and
  compares the two results with `===`. No rule decides this: `Viewport`
  (geometry.ts) is an immutable value with readonly fields, the spec says only
  that `viewport` "always reads as the identity", and `View.read-only` and
  `Viewport.positive-scale` constrain the value, not the object. This is a
  freedom the spec leaves open.
- **a second dispose calls the model's off no further time** A's `dispose()`
  has no guard, so a second call calls `model.off("change", listener)` again;
  B returns at once when already disposed, so `off` is called once in all. The
  test wraps the model in a `ShapeCollection` that counts the `off` calls it
  gets, disposes twice, and checks the count is 1 after each. The rules don't
  settle it: `View.dispose.idempotent` says calling it again "does nothing: it
  doesn't throw, and changes no listener, frame request or drawing", and A's
  extra call changes no registration because `EventEmitter.off` "does nothing
  if it has none", so A keeps the rule as shapeView.contract.ts checks it
  (listener counts) while still making a call B doesn't. Whether "does nothing"
  forbids the call itself is left open.

## Notes

- Those are all the behavioral differences I found. The two implementations
  agree on everything else I could reach through the interfaces: one change
  listener added in the constructor and one `requestFrame(this)`, in that
  order; a change listener that only requests a frame; one
  `clearRect(0, 0, canvas.width, canvas.height)` per frame with the size read
  each frame; shapes found with `forEach` and drawn in its order; one
  `beginPath`/`arc(center.x, center.y, radius, 0, 2 * Math.PI)`/`fill` per
  circle with the same `` `rgba(${r}, ${g}, ${b}, ${a})` `` string; every set
  of `viewport` ignored; `on` and `off` that register and remove the most
  recent registration and return `this` for an event that is never emitted;
  non-circle shapes skipped; and `frame()` inert after `dispose()`, including a
  frame requested before it.
- The viewport difference has a second face I did not make a separate test
  for, since it is the same code difference: B's identity object is shared by
  every view, so `viewA.viewport === viewB.viewport` for two views on
  different models, while A's reads are always distinct objects.
- `npm run check` exits 1 in this workspace for a reason outside
  distinguish.test.ts: in each scratch copy it makes, `npx --no-install tsc -p
  tsconfig.json` reports `TS2688: Cannot find type definition file for 'node'`
  and `TS5023: Unknown compiler option 'erasableSyntaxOnly'`. Both come from
  the read-only `tsconfig.json` (`types: ["node"]`, `erasableSyntaxOnly`) being
  compiled from a temporary directory, where the junctioned `node_modules`
  resolves a different TypeScript and no `@types/node`; the same three errors
  appear for the reference, for A and for B, and no error is attributed to
  distinguish.test.ts. `npm run typecheck`, which compiles the tests against
  the reference in the workspace itself, passes. The three tests ran in all
  three variants, with the results `npm run check` printed:
  `A FAIL  B pass  reference pass` for each, so each tells A and B apart.
