Status: reviewed

Phase 2b review of task 12 (`canvasShapeView.ts`), drafted by the design agent; the human decided each item.

## Choices

- **open** Class layout and names.
- **open** `viewport` reads as one shared identity object.
- **open** Every set of `viewport` is ignored without an error: the spec decided to ignore it.
- **open** Shapes other than circles are skipped: `ShapeView.circles-only` is the caller's obligation, so this is outside the rules.
- **open** No caching or culling: allowed, not required.
- **open** The canvas size is read each frame.
- **open** `fillStyle` set before `beginPath`, with full precision: the form was decided; the precision is what the alpha-1/3 test colors check.
- **open** Viewport listeners kept in a list, oldest first.
- **open** No measured numbers: this task has no benchmark.

## Notes

- **nothing** `color.ts` isn't needed: the color's type arrives through `shape.ts`.
- **nothing** `view.ts` and `events.ts` are allowed but not needed: an allowed import may go unused.
- **nothing** `erasableSyntaxOnly` rules out parameter properties: the conventions say so.
- **nothing** One cast for the generic `on` and `off`, as `eventkit.ts` does.
- **spec fix** Task 12 says to see `method.md` for platform subsets, but the task can't read `method.md`. State the rule in task 12 itself: use only the members `canvas.ts` declares, with no casts; the tests pass a context that throws on any other member.
- **nothing** Drawing in surface coordinates works because the reference app converts window points to view points: as specified.
