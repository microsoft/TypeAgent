Status: done

## Choices

Everything here is "Left to the implementer: how pending operations and
each shape's add are kept" (the only thing the spec leaves open for this
task); each choice is recorded in `shapeProcessor.ts`'s header.

- **How pending operations are kept (Parts, How).** The local and remote
  queues are plain arrays, drained FIFO. Besides the writer, I keep: an
  `addInfo` map from shape ID to its add's `{clientId, clientSeq, seq}`
  (`seq` is `-1` while the add is this client's own and still pending);
  `globalAcked`, the present acknowledged shapes sorted ascending by
  `seq` (the acknowledged, bottom part of the z-order); `remoteClientAdds`,
  each remote client's present shapes sorted ascending by `clientSeq`; and
  `pendingLocalAdds`, this client's own present pending adds in applied
  order (so its first element is "the lowest shape of a pending local
  add" the spec asks to track rather than search for).

- **Finding what a clear knew, within the log-amortized budget
  (`ShapeMessageProcessor.log-amortized`).** The budget's own workloads
  include "remote clears that remove nothing, from a client that knew no
  shape", and the rule says *process* must stay logarithmic per operation
  even then, so a clear can't scan every present shape to find zero
  matches. I use: a client's own `seq` grows with its `clientSeq` (each
  client's operations are sequenced, and so acknowledged, in `clientSeq`
  order), so within one client's `remoteClientAdds` entry, both "`seq` at
  most the clear's `refSeq`" (knew, directly) and "`clientSeq` less than
  the clear's" (knew, as the client's own earlier operation) are each a
  prefix of the same `clientSeq`-ordered list; their union is the longer
  prefix. Shapes from other clients can only be known through the first
  condition, found as a prefix of `globalAcked` by `refSeq`. A client's
  own pending (never-yet-acknowledged) adds exist only in this
  processor's own `pendingLocalAdds`, since every other client's
  operations arrive already sequenced; for this client's own clear, that
  whole list is known (every pending add is already applied, so has a
  smaller `clientSeq` than the clear just formed from the same local
  queue). This finds and removes exactly what a clear knows in time
  logarithmic in the number of shapes, plus linear in the number removed,
  with no full scan.
  I treated this as something the spec requires rather than a free choice
  (the budget's workload fixes it), but the specific structures
  (`globalAcked`, `remoteClientAdds`, `pendingLocalAdds`) are my design.

- **Calling the writer's `remove` for an empty clear.** When a clear knows
  no shape, I don't call `writer.remove([])` at all (rather than calling
  it with an empty array). Either is consistent with the rules
  (`ShapeCollectionWriter.notifies` doesn't require a call, only that one
  that changes nothing emits nothing); I chose not to call it since
  nothing is being removed.

- **`logOperations`.** Implemented with a small private `Emitter` class
  (Node's `on`/`off`/snapshot-on-emit semantics), reimplemented locally
  since this task can't import `eventkit.ts`; it matches that file's
  `Events` class, which the rest of the repo already relies on for the
  same semantics.

- **`model`.** A plain object literal with exactly `ShapeCollection`'s
  members, built the same way `shapewriterkit.ts`'s `readFacet` does
  (which I could read but not import), so `on`/`off` return the facet
  itself.

- **IDs.** `newShapeId` returns `` `${clientId}#${n}` `` as the spec's
  "Decided behavior" section already fixes; `n` is a counter starting at
  0, held per instance.

## Notes

- The hardest part was seeing that, for a single client, `seq` and
  `clientSeq` grow together (because a client's own operations are
  delivered to everyone, including itself, in `clientSeq` order, and
  `seq` is assigned in delivery order): that's what lets "knew by refSeq"
  and "knew as the author's own earlier operation" collapse into one
  prefix search per clear, instead of a structure keyed on both fields at
  once. Nothing in the files here states this directly; I derived it from
  `dataModel.ts`'s `client-order` and `remote-seq` requirements together.
- I verified the design against the budget by reasoning through
  `shapeModel.vocab.ts`'s `processorWorkloads` by hand (no bench script is
  part of this task's outputs), rather than measuring; `npm test` and
  `npm run check` both pass, including the random-run suites in
  `messageProcessor.contract.ts` and `shapeModel.contract.ts` and the
  scenario and `frames.complete` suites in `scenario.contract.ts`.
