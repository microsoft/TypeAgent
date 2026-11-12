Status: reviewed

Phase 2b review of task 9 (`shapeProcessor.ts`), drafted by the design agent; the human decided each item.

## Choices

- **adopt** `process` takes the local queue first, and repeats until both queues are empty. The spec left the order open with too loose a condition: taking the remote queue first is correct only if a local operation whose acknowledgment arrives first is applied when its acknowledgment is, and otherwise a remote remove or clear delivered in the same call misses it. Spec fix: task 9 decides local-first; the shapeModel.ts doc states the condition any other order must meet.
- **open** `process` does all its work synchronously, scheduling nothing.
- **open** One record per present shape, in an acknowledged chain and a chain per client.
- **open** A pointer to the lowest pending local add, as task 9 asks.
- **open** A clear walks only the two prefixes it removes.
- **open** An acknowledgment is recognized by `clientId`, then matched by `clientSeq`: `unique-identity` makes that exact.
- **open** A seq is recorded only for an acknowledged add whose shape is present.
- **open** A clear calls the writer's `remove` even with an empty list: the writer emits nothing for it.
- **open** The facet is a class whose `on` and `off` return it.
- **open** Both enqueues copy the operation, `ids` included.

## Notes

- **nothing** `ShapeProcessor` isn't generic in the shape type: the spec's constructor isn't.
- **spec fix** The acknowledged adds always form a contiguous bottom part of the z-order, in seq order; the pointer and the clear's walk rely on it. Add it to the z-order paragraph of `ShapeMessageProcessor` in `shapeModel.ts`.
- **spec fix** The order of the queues: the same fix as the first choice.
- **nothing** `deepEqual` ignores key order.
- **nothing** The `log-amortized` budgets are measured in task 10, not here.
- **nothing** Relying on `not-reentrant` only for efficiency is allowed.
