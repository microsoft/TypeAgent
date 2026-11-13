Status: reviewed

Phase 2b review of task 8's second run (`alternates/mapShapeCollection.run-2.ts`, Sonnet), drafted by the design agent; the human decided each item.

## Choices

- **adopt** An implicit treap: logarithmic in *expected* time over its own random priorities, whatever the pattern of adds, where `ShapeCollectionWriter.log-amortized` says *amortized*. This was close to a reading the agent should have stopped on. Since no pattern of adds can make the treap slow, the human decided the spec accepts it. Spec fix (made): the rule and task 8 say "amortized or expected (over the implementation's own random choices) logarithmic time, whatever the pattern of adds".
- **open** No checks of `@requires` in `add` and `remove`: calls that break them are outside the rules. The first run throws instead; phase 3 should classify that difference as a freedom.
- **open** `remove` passes the present IDs, without duplicates, to `removeMultiple` once.
- **open** Listeners in an array, copied at the start of each emit.

## Notes

- **nothing** The writer contract doesn't involve the processor.
- **nothing** The treap handles bursts without special cases.
