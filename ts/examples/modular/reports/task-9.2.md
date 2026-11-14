Status: done

## Choices

- **newShapeId format**: `` `${clientId}#${n}` `` with `n` a per-instance
  counter starting at 0, incremented on every call (header: Cost field).
  This is literally what "Decided behavior" specifies, not a choice, but
  noting it here since it's the only state `newShapeId` keeps.

- **How pending adds and each shape's add are kept** (left to the
  implementer): one `AddNode` per currently-present shape, holding its
  `clientId`, `clientSeq` and `seq` (-1 while unacknowledged). Each node is
  linked into two doubly linked lists:
  - a per-`clientId` list, in `clientSeq` order (append-only as that
    client's adds are applied/arrive; needed for `knew`'s own-client
    clause and, for this client's own list, for tracking which add is
    "the lowest pending local add").
  - one global list, in `seq` order, holding every acknowledged add from
    any client (append-only, since every remote delivery's `seq` is
    greater than the last, including this client's own acknowledgments);
    needed for `knew`'s refSeq clause.
  Both lists support O(1) removal of an arbitrary node (by direct link
  manipulation, via a `Map<ShapeId, AddNode>`), so forgetting a removed
  shape's add, acknowledging a pending add, and finding the lowest still-
  pending local add are all O(1), and a `clear` walks only the prefixes of
  these two lists it actually removes (bounded by the shapes removed, not
  by shapes present). Documented as "Parts" in the header.

- **Queue representation**: `local`/`remote` are plain arrays, drained with
  `shift()` in `process`. Queue length is bounded by operations enqueued
  between `process` calls, not by shapes present, so this doesn't conflict
  with the no-time-proportional-to-shapes-present budget.

- **Recognizing an acknowledgment**: any operation arriving on `remote`
  whose `clientId` equals this processor's own is treated as the
  acknowledgment of an already-applied local operation (per
  `unique-identity`, no other operation can share that pairing), so only
  bookkeeping happens (recording the seq, and for an add, retiring it from
  the pending-local-adds tracking) — never a writer call. This generalizes
  the spec's "acknowledgment of a local operation" text, which illustrates
  it for adds, to remove and clear as well, consistent with "process never
  schedules itself" and "operations are never changed".

- **`AdditionalSemantics: none`**: I didn't find any behavior to add beyond
  what the rules require.

## Notes

- Working out `ShapeMessageProcessor.clear-known`'s exact removal set took
  the most care. `knew(op, other)` has two clauses (`other` acknowledged
  with `seq <= op.refSeq`, or same client with smaller `clientSeq`), and
  for a *remote* clear from another client X, X's own earlier add can
  satisfy the second clause while failing the first (if X formed the add
  and the clear in the same burst, before its own add's acknowledgment
  came back to X, the add's eventual seq can land after X's clear's
  refSeq). I convinced myself this is still answerable in O(shapes
  removed) time because `client-order` guarantees X's earlier add always
  reaches this processor's `remote` queue (and gets applied) before X's
  clear does, so by the time the clear is processed, X's qualifying adds
  already sit in X's per-client list, in clientSeq order, as a prefix.
  Running the global-seq scan first and the per-client scan second avoids
  double-removing (and double-counting towards the single `writer.remove`
  call) a shape that both scans would otherwise name.
- Checked, by hand-tracing a few sequences of local/remote adds and acks,
  that always placing a remote add directly below the *current* lowest
  pending local add (never searching for it) keeps the writer's physical
  order equal to `compareOrder`'s sort at every point, including right
  after an acknowledgment moves the pending/acknowledged boundary without
  touching the writer (`ack-keeps-z`).
- `npm test`, `npm run typecheck` and `npm run check` (apart from the
  then-missing `REPORT.md`) all pass.
