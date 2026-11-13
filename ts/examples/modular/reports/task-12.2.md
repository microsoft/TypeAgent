Status: done

## Choices

- **Viewport identity object.** `view.ts` says `viewport` always reads as the
  identity. I return a fresh `{ scale: 1, rotation: 0, tx: 0, ty: 0 }` object
  from the getter on each read, rather than sharing one object, so nothing
  outside the view could mutate a shared instance and change what a later
  read reports. Recorded as `AdditionalSemantics`.
- **Non-circle shapes.** `shapeView.ts`'s `circles-only` requirement says
  every shape in the model is a Circle; the spec doesn't say what `frame()`
  should do if that's ever violated. I skip any shape whose `kind` isn't
  `"circle"` rather than drawing or throwing, narrowing with a `kind`-based
  type guard (`isCircle`). Recorded as `AdditionalSemantics`.
- **Viewport listener bookkeeping.** `on`/`off` for `"viewport"` are
  specified to "follow events.ts", and `viewport` is never emitted. I still
  keep a real listener list and implement `off` as removing the most recent
  registration (events.ts's `removes-one`), even though nothing in this task
  ever emits `viewport`, so the methods are correct per the EventEmitter
  contract rather than stubs. Recorded as `AdditionalSemantics`.
- **Setter for `viewport`.** The spec says setting the identity does nothing,
  and setting any other value is "outside the rules for now, so ignore it
  too." I implemented this as an unconditional no-op setter (no comparison,
  no frame request, no emit, for any input), since both branches the spec
  describes end the same way.

## Notes

- `canvasShapeView.test.ts` wires the contract with a `RecordingContext`
  that throws if the view touches any `DrawingContext` member other than
  `canvas`, `fillStyle`, `clearRect`, `beginPath`, `arc` and `fill`, and
  only accepts full-circle `arc` calls and `rgba(...)` fill styles, so the
  "Decided behavior" drawing recipe in the task is enforced mechanically,
  not just by convention.
- `tsconfig.impl.json` has `erasableSyntaxOnly` enabled, which rejects
  TypeScript constructor parameter properties (`constructor(private readonly
  x: T)`); fields must be declared and assigned in the constructor body
  instead.
- The header's `Imports:` field is checked by `.task/task.ts`'s linter
  against the file's actual imports and must be on one line; wrapping it
  across multiple comment lines made the check report a missing entry even
  though the file was listed.
