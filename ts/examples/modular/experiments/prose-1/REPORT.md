Status: done

## Choices

- **Queue draining order (How).** `process()` drains the whole local queue
  before touching the remote queue. This is one of the interleavings the
  spec allows ("whatever the interleaving of their local and remote
  queues"), and it means a local operation is always applied before any
  remote acknowledgment of it can be seen, so the "Order of the queues"
  scenario in shapeModel.ts (apply the local operation when its
  acknowledgment comes, as acknowledged) never has to re-apply anything:
  an acknowledgment is always of an already-applied local operation.

- **newShapeId's format (Left to the implementer).** IDs are
  `` `${clientId}#${n}` `` for an increasing counter `n`, cast to `ShapeId`.
  This keeps IDs from different clients disjoint as long as clientIds
  themselves are distinct, which is all `new-ids` needs.

- **Data layout for `knew` (Left to the implementer, Cost).** To keep
  `add` and `remove` at the writer's own cost plus O(1) bookkeeping, and to
  keep a `clear` that knows nothing cheap (the only clear workload
  `ShapeMessageProcessor.log-amortized` measures), the processor tracks,
  per present shape, the add that placed it (clientId, clientSeq, seq), and
  keeps those grouped by clientId in clientSeq order for the "same client,
  smaller clientSeq" half of `knew`. The "acknowledged with seq ≤ refSeq"
  half is checked by scanning the present shapes, skipped entirely when
  refSeq is -1. This is only O(1) on the measured (empty) clear workload;
  a clear that actually knows many shapes scans the present shapes, which
  is not one of the measured workloads.

- **IDs no longer present.** When a shape is removed (by `remove` or
  `clear`), its bookkeeping entry is deleted, but it is left in place in
  the per-client list (lazily skipped later via a presence check) rather
  than spliced out, since removal is the workload this budget measures and
  a map delete is cheaper than a splice.

## Notes

- `shapeModel.ts`'s ordering paragraph ("Order of the queues") describes a
  consequence of a particular interleaving choice (remote-before-matching-
  local), not a requirement on every implementation; choosing to drain
  local first avoids that case rather than handling it.
- `erasableSyntaxOnly` in both tsconfigs rules out parameter-property
  constructor shorthand, so constructor fields are assigned in the body.
