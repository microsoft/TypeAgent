Status: done

This run started from the `shapeProcessor.ts` the workspace was seeded with,
which failed one contract rule, `ShapeMessageProcessor.read-facet`: its
read-only facet was a class with a `private readonly writer` field, and that
is an ordinary own property at run time, so `onlyMembers(model,
collectionMembers)` (shapeModel.vocab.ts) saw a property beyond
`ShapeCollection`'s members. The facet now keeps the writer in a private
field, `#writer`, which is not a property at all, so the facet's own and
inherited properties are exactly `get`, `size`, `forEach`, `compareZ`,
`inRect`, `atPoint`, `on` and `off`, and nothing it exposes shows that it
holds a writer. Nothing else about the implementation changed, and the header
records the facet's private field under Parts.

`npm test` passes (47 tests, 0 failures: the MessageProcessor and
ShapeMessageProcessor contracts over `RefShapeWriter`, and the scenarios with
doubles for every other part), and `npm run typecheck` reports no errors.

## Choices

- **How the adds of present shapes are kept** ("Left to the implementer"):
  one `AddRecord` per present shape in a `Map` by `ShapeId`, holding the
  add's `clientId`, `clientSeq` and the `seq` its acknowledgment gave it,
  linked into two doubly-linked chains: the acknowledged adds in `seq` order
  (`ackedFirst`/`ackedLast`), and, per client, that client's present adds in
  `clientSeq` order (`byClient`). A clear then walks only records it removes
  (the `seq <= refSeq` prefix of the acknowledged chain, and the clear's own
  client's earlier adds), at most twice each, and no record it keeps.
  Recorded in How, Cost and Parts.
- **How the lowest pending local shape is kept**: a single `pendingFirst`
  pointer, plus `ownPending` by `clientSeq`, so a remote add reads the ID to
  pass as `below` without searching, and an acknowledgment or a removal
  advances the pointer along the client chain (the acknowledged adds of this
  client are a `clientSeq` prefix of that chain, by
  `MessageProcessor.client-order` and local operations being applied in
  enqueue order). Recorded in How and Cost.
- **How pending operations are kept** ("Left to the implementer"): two
  arrays, and `process` takes the whole local array, applies it, then takes
  the whole remote array and applies it, repeating until both are empty. This
  is one way to realize the decided "local queue first, then the remote queue,
  and repeats"; recorded in AdditionalSemantics.
- **The read-only facet is a separate class**, one per processor, built in the
  constructor, delegating every member to the writer and returning itself
  from `on` and `off`. Recorded in Parts (with the private field) and How.
- **A remote operation whose `clientId` is this processor's is taken as the
  acknowledgment of the local operation with that `clientSeq`**, and a `seq`
  is recorded only when that add's shape is still present (nothing else can
  observe one; `unique-identity` makes the match unambiguous). Recorded in
  AdditionalSemantics.
- **A clear with nothing to remove still calls the writer's `remove`**, with
  an empty list, which changes nothing and so emits nothing. Recorded in
  AdditionalSemantics.
- **`process` applies everything before the promise it returns settles** (it
  does no awaiting). Recorded in AdditionalSemantics.
- **Copies are made down to the arrays**: `local.enqueue` and
  `remote.enqueue` return a fresh object, and a `remove`'s `ids` array is
  copied, so `OperationSink.enqueue.own-copy` holds even against a caller
  that mutates what it passed or what it got back. Recorded in How (the queued
  operation is the processor's own copy) and in the comment on `copyOp`.

## Notes

- The seeded file's Cost field carries measured numbers from `bench.ts`
  (`ShapeMessageProcessor.log-amortized`, `frames.fraction-of-frame`). This
  task's workspace has no `bench.ts` and no `npm run bench`, so I could not
  re-measure them; I left them as they came, since the only change here —
  moving the facet's writer into a private field — is a change of property
  visibility, not of any operation's work. They should be re-measured in a
  round that includes the benchmark.
- What the read-facet rule costs an implementation is not obvious from its
  text: "model has only `ShapeCollection`'s members, own or inherited" reads
  as a statement about reachability, but `onlyMembers` enforces it over
  `Reflect.ownKeys` along the prototype chain, so a TypeScript `private`
  field fails it while a JavaScript `#` field passes. The contract's failure
  message ("a property beyond ShapeCollection's members (writer)") says which
  property, which is what made the cause clear.
- `ShapeCollectionEvents` and the `ShapeCollection` members the facet
  forwards come from `shapeModel.ts`, `shape.ts` and `geometry.ts`, so the
  implementation never imports `events.ts` even though the task allows it;
  the header's Imports field lists only what is imported, as the lint checks.
