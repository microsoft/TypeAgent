Status: done

## Tests

- **a local remove applies the IDs it was given when it was enqueued** Two
  local adds are applied, then a local remove is enqueued with an `ids` array
  holding the first shape's ID, and the caller pushes the second shape's ID
  onto that array before `process`. A removes one shape: its
  `local.enqueue` stamps the content into a new operation whose `ids` is a
  fresh copy (`[...content.ids]`), so the queued operation is the
  processor's own down to its arrays. B removes both: it stamps with
  `{ ...content, ... }`, so the queued operation keeps the caller's array
  and the remove applies whatever that array holds at `process` time. The
  spec text that bears on it is the approach's "Both follow
  `OperationSink.enqueue.own-copy`" and "`local.enqueue` stamps the
  operation, queues it, and returns a copy". `OperationSink.enqueue.own-copy`
  itself is written about the *returned* operation ("The returned operation is
  the caller's own ... nothing the receiver does later ... changes it"), and
  both implementations satisfy that direction; no rule states the converse,
  that the queued operation is unaffected by what the *caller* does later.
  So the rules arguably leave this open, even though the approach text says
  both enqueues follow own-copy and `Operation`'s fields (and
  `RemoveShapes.ids`) are declared `readonly`.
- **a remote remove applies the IDs it was given when it was enqueued** The
  same difference on the other sink, and in B it comes from a different
  line. Two remote adds from `peer` are applied, then a remote remove is
  enqueued and the caller pushes a second ID onto its `ids` array before
  `process`. A removes one shape: `remote.enqueue` queues `copyOp(op)` and
  returns a copy of that. B removes both: `remote.enqueue` pushes the
  caller's operation object itself onto the remote queue (only the return
  value is a copy). Same spec text as above, with the same caveat: the
  approach says `remote.enqueue` follows `own-copy`, but the rule as
  written only constrains the returned operation.
- **applied reports the very object the remote queue was given** A remote
  clear from a client that knew nothing is enqueued and a listener records
  what `applied` carries. In B the logged operation is `===` the object
  passed to `remote.enqueue` (it is the queued object); in A it is a
  distinct, equal copy. `OperationLogging.logOperations` and
  `MessageProcessor.process.logs-each` say a remote operation is reported
  "as it was enqueued", and the task-9 approach repeats "a remote one as it
  was enqueued"; neither says whether that means the same object or an equal
  one, so this is open. Nothing a conforming caller can observe about
  *values* differs; only object identity does.
- **the stamped operation keeps the property order of the content it was made from**
  The content is written `{ shape, id, type: "add" }` and the stamped
  operation `local.enqueue` returns is inspected with
  `Object.keys`. B keeps the content's order and appends the stamps
  (`{ ...content, clientId, clientSeq, refSeq, seq }`), so the keys are
  `shape, id, type, clientId, clientSeq, refSeq, seq`. A rebuilds the
  operation per type (`{ type: "add", id, shape, ...marks }`), so `type`
  comes first whatever order the content had. No rule fixes property order:
  `MessageProcessor.stamps` says only which fields are stamped and with
  what. This is a difference in something the spec leaves open.
- **the read facet carries ShapeCollection's members as its own properties**
  B builds `model` as an object literal, so all eight of
  `collectionMembers` are its own properties; A builds it from a class, so
  the members are inherited from the prototype and the facet has no own
  property at all (its writer is a JavaScript `#private` field, which is not
  a property). `ShapeMessageProcessor.read-facet` requires only that `model`
  have "only `ShapeCollection`'s members, own or inherited" (`onlyMembers`
  in shapeModel.vocab.ts), which both satisfy; whether they are own or
  inherited is explicitly left open, so this is an open difference.
- **the operation log keeps its registrations out of its own properties**
  A's `logOperations` holds its listeners in a JavaScript `#private` field,
  so the object has no own properties; B's holds them in a TypeScript
  `private` field, which is an ordinary own property (`lists`) at run time.
  No rule constrains `logOperations`' property surface — `read-facet`'s
  `onlyMembers` is about `model` only — so this one is entirely open. It is
  the same kind of difference as the facet test above, but on a different
  object and from an independent choice in each implementation.
- **the read facet's on still works when it is called apart from the facet**
  `p.model.on` is read into a variable and then called. B's facet is an
  object literal whose `on` returns the captured `facet`, so the detached
  call registers the listener and returns `model`. A's facet is a class
  instance whose `on` reaches `this.#writer`, so a detached call throws a
  `TypeError`. `read-facet` fixes only what `this.model.on(...)` returns, so
  the behavior of a detached call is open. This shares its root cause with
  "the read facet carries ShapeCollection's members as its own properties"
  (class instance versus object literal with closures); it is a separate
  observation, not a separate decision.

## Notes

- **What I could not tell apart.** On every *semantic* question the spec
  settles, A and B agreed in everything I could construct: the z-order a
  remote add lands in (including the `below` argument the writer receives
  after an acknowledgment or after the lowest pending add is removed), what
  a clear removes and in what order it lists the IDs in its single
  `remove` call, that a clear removing nothing still calls `remove` with an
  empty list, that an acknowledgment applies nothing and emits `applied`,
  the order `applied` reports a batch in, the stamps (both count `clientSeq`
  from 0 and both take `refSeq` from the last applied remote seq), the
  `newShapeId` strings, and the number and order of writer calls. I checked
  this with two probe tests over a recording writer (a subclass of
  `RefShapeWriter` that logged every `add` and `remove` with its arguments)
  driving a mixed run: a pending local add, a remote add below it, a second
  pending local add, the acknowledgment of the first, another remote add, a
  local remove, and a remote clear that knew shapes by both halves of
  `knew`. Both implementations produced exactly the same call sequence, so
  the probes told them apart on nothing and are not in the final file. The
  six real differences are all at the edges the rules leave open: when a
  copy is taken, and what the objects handed out look like.
- **Where the structural difference comes from.** A keeps its pending and
  acknowledged adds in two chains of records with an insertion-sorted
  per-client chain; B keeps the same information in two doubly linked lists
  pushed at the tail. Those orders can only diverge if one client's adds are
  applied out of `clientSeq` order, which `MessageProcessor.client-order`
  (and applying the local queue in enqueue order) rules out, so I could not
  turn the difference into a test without breaking a `@requires`.
- **What I did not test, on purpose.** A's `process` takes the whole local
  queue as a snapshot and then the whole remote queue, repeating; B's drains
  each queue with `shift` in a loop. The two differ only if something is
  enqueued *during* `process` (B would apply a newly enqueued local
  operation before the remote queue, A after it), and
  `MessageProcessor.not-reentrant` forbids enqueuing while a `process` call
  is pending, so such a test would show nothing about the spec. The same
  goes for A's doing its bookkeeping before the writer call and B's after:
  the only way to look in between is from a `change` listener, which cannot
  enqueue either.
- **The reference.** The reference (`shapeprocessorkit.ts`) keeps the
  caller's operation on both queues, so it fails both "IDs as they were when
  it was enqueued" tests, and it builds the stamped operation by spreading
  the content into a literal, so it passes the identity, property-order and
  own-property tests; it fails the detached-`on` test, because its
  `readFacet` returns `this` from a method shorthand, which is `undefined`
  in a detached call. It also failed the mixed-run probe, for a reason that
  tells A and B apart from it rather than from each other: the reference
  stamps its first local operation with `clientSeq` 1 (`++this.clientSeq`)
  while A and B both count from 0, so the acknowledgment the probe built for
  `clientSeq` 0 matched no pending operation there. `MessageProcessor.stamps`
  asks only for "a clientSeq greater than any earlier local operation's", so
  where the count starts is open too — but A and B make the same choice, so
  no test here can be about it.
