Status: reviewed

Phase 2b review of task 9's second attempt (`shapeProcessor.ts`, Opus), sent back by phase 3 (`reports/task-9.d.review.md`) because its facet kept the writer in a property. Drafted by the design agent; no item needed the human's decision.

## Choices

- **open** One record per present shape, in an acknowledged chain and a chain per client: as in the first attempt.
- **open** A pointer to the lowest pending local add, advanced along the client chain.
- **open** Pending operations in two arrays, local first, repeating until both are empty, as task 9 decides.
- **open** The facet is a separate class, now with the writer in a `#writer` field, which isn't a property.
- **open** An acknowledgment matched by clientId and clientSeq.
- **open** A clear with nothing to remove still calls `remove` with an empty list, which emits nothing.
- **open** `process` does all its work synchronously.
- **open** Copies down to the arrays on both queues.

## Notes

- **nothing** The measured numbers in the Cost field are stale until task 10 runs again, which phase 3 has already requeued.
- **spec fix** A TypeScript `private` field fails `onlyMembers` while a JavaScript `#` field passes, which the rule's text doesn't make obvious. `onlyMembers`'s doc comment now says so.
- **nothing** The facet needs no import of `events.ts`.
