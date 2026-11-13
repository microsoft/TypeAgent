Status: reviewed

Phase 2b review of task 9's second run, second attempt (`alternates/shapeProcessor.run-2.ts`, Sonnet), sent back by phase 3 (`reports/task-9.d.review.md`) because a clear cost time in proportion to the shapes present. Drafted by the design agent; no item needed the human's decision. With this file in place of `shapeProcessor.ts`, `npm run bench` measures the clear pattern at 0.89 (148 before) and exits 0.

## Choices

- **open** Three linked lists of add records (acknowledged by seq, per client by clientSeq, and this client's pending adds), so a clear walks only what it removes.
- **open** `newShapeId` as decided.
- **open** Acknowledgments of removes and clears only advance the last applied seq.
- **open** An acknowledgment is any remote operation with this processor's clientId, matched in order: correct under `MessageProcessor.client-order`, as the review of its first attempt decided.
- **open** Copies for the queue and for the caller.

## Notes

- **nothing** The facet is an object literal that reaches the writer through a closure, as `read-facet` now requires.
- **nothing** Contextual typing spared the imports of `geometry.ts` and `events.ts`.
