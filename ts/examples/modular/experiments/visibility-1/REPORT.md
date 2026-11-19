Status: done

## Choices

- **Internal bookkeeping structures.** The spec leaves "how pending
  operations and each shape's add are kept" to the implementer. I keep:
  a `Map<clientId, Set<ShapeId>>` of currently present shapes by the
  client whose add made them (for a clear's own-client knowledge); a
  doubly linked list of acknowledged adds in seq order (for a clear's
  refSeq knowledge, walked only as far as it removes); and a doubly
  linked list of this processor's own still-pending adds, oldest first
  (whose front is the "lowest pending shape" the approach describes).
  A `Map<ShapeId, PresentAdd>` ties a shape's bookkeeping together so
  remove and clear can update all of it in O(1) per shape they actually
  remove. Recorded under `Parts` and `How` in the header.
- **`process`'s queue draining.** The approach says process "applies the
  local queue first, then the remote queue, and repeats until both are
  empty." Since nothing can enqueue while process runs
  (`MessageProcessor.not-reentrant`), one pass over each queue already
  drains it, so I implemented it as one pass rather than a literal
  repeat-until-empty loop (noted with a short comment at the call site).
- **`local`/`remote` as plain objects.** `OperationSink` has only one
  member, so I implemented `local` and `remote` as object literals
  closing over the processor's private state rather than as classes.
- **`logOperations` and the `model` facet's private state.** Node's
  `EventEmitter` behavior for `logOperations` is implemented as a small
  generic class (`SimpleEventEmitter`), and the `model` facet as a
  class (`ShapeCollectionFacet`) holding the writer in a true `#private`
  field (not a TypeScript `private` field), per shapeModel.vocab.ts's
  note that a TS `private` field would be a visible own property and
  break `ShapeMessageProcessor.read-facet`'s `onlyMembers` check.
- **`newShapeId`'s counter.** A single number field starting at 0,
  incremented on every call, formatted as `` `${clientId}#${n}` ``.

## Notes

- The key fact that makes the whole design cheap: every client's own
  operations are applied (locally or remotely) in strictly increasing
  clientSeq order, everywhere (`MessageProcessor.client-order` plus
  `local-order`/`remote-order`). That means, at the moment a clear from
  client C is applied, every currently-present shape added by C must
  already have a smaller clientSeq than the clear's — so `knew`'s
  same-client case reduces to "all of C's currently-present shapes,"
  no clientSeq comparison needed. Seeing this took re-deriving it from
  dataModel.ts and shapeModel.vocab.ts's `knew`/`compareOrder`, since
  the Approach section only states the resulting z-order rule, not why
  it holds.
- Likewise, any operation arriving on `remote` already has an assigned
  seq (`MessageProcessor.remote-seq`), including the acknowledgment of
  one of this processor's own operations; the only way to tell an
  acknowledgment apart from a genuinely new remote operation is that
  its `clientId` equals this processor's own (since a processor's
  clientId is otherwise never seen on its own remote queue). That one
  check drives all of `#applyRemote`.
- `shapeModel.vocab.ts`'s `onlyMembers` only special-cases the key
  `"constructor"`, and only on prototypes above the object itself; a
  class's own instance fields (even JS `#private` ones don't appear at
  all) must otherwise be free of anything outside `collectionMembers`.
  That's what ruled out a TypeScript `private` field for the facet's
  writer reference.
