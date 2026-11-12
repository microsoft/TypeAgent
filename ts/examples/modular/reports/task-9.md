Status: done

## Choices

- **The two queues are plain arrays, taken local-first.** `process` swaps the
  local queue out, applies it, swaps the remote queue out, applies it, and
  repeats until both are empty. Local-first is what the spec leaves open;
  the repeat means `process` settles only with both queues empty even if a
  change listener enqueues during it. Header: AdditionalSemantics (and the
  comment in `process`).
- **`process` applies everything synchronously, before the promise it
  returns settles.** It is an `async` method with no `await`, so it schedules
  nothing (`MessageProcessor.passive`). Header: AdditionalSemantics.
- **How each shape's add is kept:** one `AddRecord` per present shape
  (`id`, `clientId`, `clientSeq`, `seq`), in `present` by ID, and in two
  doubly linked chains: `ackedFirst`/`ackedLast`, the acknowledged adds by
  `seq`, and one chain per client (`byClient`) of that client's present adds
  by `clientSeq`. Header: How, Cost (state is one record per present shape),
  Parts.
- **The lowest shape of a pending local add is a pointer, `pendingFirst`,
  not a search.** This client's pending adds are the top of the z-order in
  `clientSeq` order, so the pointer moves to the record's `later` when that
  shape is removed or its add is acknowledged, and is set when the first
  pending add is applied. Header: How ("placing a remote add ... touch only
  the records they concern").
- **A clear walks only what it removes.** The acknowledged adds are a
  contiguous bottom part of the z-order in `seq` order, so the adds a clear
  knew are the prefix of the acknowledged chain with `seq <= refSeq`, plus
  the prefix of the clear's own client's chain with `clientSeq <
  op.clientSeq`; every record either walk visits is removed, so the walk is
  at most twice the shapes removed. Header: Cost.
- **Acknowledgments are recognized by `clientId` alone, then matched by
  `clientSeq`.** By `MessageProcessor.unique-identity`, a remote operation
  with this processor's `clientId` is the acknowledgment of this client's
  operation with that `clientSeq`. Header: AdditionalSemantics.
- **A seq is recorded only for an acknowledged add whose shape is still
  present** (`ownPending`), because nothing else can observe one: only adds
  decide z-order, and only an add's seq decides what a clear knew. Header:
  AdditionalSemantics.
- **A clear calls the writer's `remove` even when its list is empty**, so
  there is one code path; the writer emits nothing for a call that changes
  nothing. Header: AdditionalSemantics.
- **`model` is one `WriterFacet` instance made in the constructor**, a class
  with only `ShapeCollection`'s members, whose `on` and `off` return `this`.
  Header: Parts.
- **Both `enqueue`s copy the operation twice**: `local.enqueue` queues the
  stamped operation and returns a copy, `remote.enqueue` queues a copy and
  returns another, so neither the caller's object nor the queued one can
  change what the caller holds. `ids` arrays are copied too; nothing else in
  an operation is ever written. Header: Cost ("apart from copying the
  operation"), AdditionalSemantics.

## Notes

- `ShapeProcessor` is not generic in the shape type: the spec gives the
  constructor as `(clientId: string, writer: ShapeCollectionWriter)`, so the
  class takes the default `Shape` on both the writer and the model. A
  generic parameter would still accept `RefShapeWriter` and
  `MapShapeCollection`, but it would change the signature the spec states.
- That the acknowledged adds form a contiguous bottom part of the z-order,
  sorted by `seq`, is what makes the clear walk and the `pendingFirst`
  pointer work. No file says it; it follows from `compareOrder`
  (shapeModel.vocab.ts), `MessageProcessor.remote-seq` and the fact that a
  local add is acknowledged with a seq greater than every seq already
  applied, so an acknowledgment moves nothing and the add lands at the top
  of the acknowledged chain.
- The order of the queues is less free than "left to the implementer"
  suggests. Taking the remote queue first breaks
  `ShapeMessageProcessor.remove-listed` and `kept`, not only the
  acknowledgment rule the task names: a remote remove or clear can be
  delivered in the same call as the acknowledgment of a local add it knew,
  and if the local add has not been applied yet, the remove is applied to a
  shape that is not there and the add that follows it survives. Local-first
  settles this for every such operation, not just acknowledgments.
- `deepEqual` (rules.ts) compares own keys as a set, so the order in which a
  stamped operation's fields are written doesn't matter to
  `OperationSink.enqueue.own-copy`.
- `ShapeCollectionWriter.log-amortized` and
  `ShapeMessageProcessor.log-amortized` name `bench.ts`, which is not in
  this task's folder, so the header's Cost field states the work per
  operation rather than measured ratios.
- The processor relies on `MessageProcessor.not-reentrant` only for
  efficiency, not correctness: nothing it does during `process` reads a
  queue it has already swapped out, and the loop picks up anything enqueued
  by a change listener.
