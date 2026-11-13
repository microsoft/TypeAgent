Status: reviewed

Phase 2b review of task 12's second run (`alternates/canvasShapeView.run-2.ts`, Sonnet), drafted by the design agent; the human decided each item.

## Choices

- **open** `viewport` returns a new identity object on each read, where the first run returns one shared object. The spec fixes the value, not the object's identity, so phase 3 should classify that difference as a freedom.
- **open** Shapes other than circles are skipped: `circles-only` is the caller's obligation.
- **open** Viewport listeners kept in a list, `off` removing the most recent.
- **open** Every set of `viewport` is ignored, as decided.

## Notes

- **nothing** The recording context enforces the drawing recipe.
- **nothing** `erasableSyntaxOnly` rules out parameter properties.
- **spec fix** The lint reads a header's `Imports:` field from one line only, so a wrapped field reports a missing import. Made: `task.ts` reads the field's continuation lines too.
