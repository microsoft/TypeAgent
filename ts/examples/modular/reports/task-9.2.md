Status: done

## Choices

- **Z-order bookkeeping (Approach, "Left to the implementer").** I keep, per
  present shape, a record of its add's `clientId`, `clientSeq` and `seq`
  (`-1` until acknowledged). These records sit in three linked lists so
  that both `add`'s placement and `clear`'s "shapes it knew" can be found
  directly rather than scanned: a global list of acknowledged, present adds
  in `seq` order (for `add-on-z`/`clear`'s `seq <= refSeq` side), a list per
  `clientId` in `clientSeq` order (for `clear`'s same-client,
  earlier-`clientSeq` side), and a list of this processor's own pending
  (unacknowledged) adds in `clientSeq` order, whose head is the "lowest
  pending shape" the spec says to track rather than search for. Recorded in
  the header's `How` and `Cost` fields.
- **`newShapeId`'s format.** Used exactly `` `${clientId}#${n}` `` with `n`
  from 0 per processor, as the spec's "Decided behavior" states; no choice
  left here.
- **Acknowledgments of `remove` and `clear`.** The spec says only an add's
  acknowledgment is described ("records its seq... applies nothing"); I
  apply the same rule uniformly to every operation type, since
  `MessageProcessor`'s rules (`once`, `ack-keeps-z`) are about any
  operation, not just adds. A remove or clear's own `seq` isn't needed
  again afterward (nothing later keys off a remove's or clear's `seq`), so
  its acknowledgment only advances `lastAppliedSeq` (used for the next
  local operation's `refSeq`) and otherwise does nothing.
- **Detecting an acknowledgment.** Any operation arriving on `remote` whose
  `clientId` equals this processor's own is treated as the acknowledgment
  of an operation this processor already applied from its local queue
  (never a fresh operation to apply), since a processor's own operations
  reach `remote` only as acknowledgments of what `local.enqueue` already
  queued. `AdditionalSemantics: none` for this, as it's just how the
  stated rule is read, not an addition to it.
- **Defensive copies.** `local.enqueue` and `remote.enqueue` each build a
  fresh object (cloning a `RemoveShapes`'s `ids` array) for the queue and a
  separate fresh clone for the returned value, so neither the queued
  operation nor the caller's own copy can be changed by anything done to
  the other afterward (`OperationSink.enqueue.own-copy`).

## Notes

- `shapeModel.contract.ts`'s `onlyMembers` check walks the model facet's own
  prototype chain, so `model` had to be a plain object literal (not a
  class instance) with exactly `ShapeCollection`'s members and no stored
  reference to the writer as a property; the writer is reached only
  through a closure variable captured in the constructor.
- The facet's object-literal methods rely on contextual typing from the
  `readonly model: ShapeCollection` field's declared type (as
  `shapewriterkit.ts`'s `readFacet` does) rather than explicit parameter
  types, which meant `geometry.ts` and `events.ts` never needed importing.
