Status: done

## Tests

- **local add calls the writer with no below argument** A applies a local add
  with `writer.add(op.id, op.shape)`, leaving `below` out; B always passes it,
  as `undefined`, so the writer sees three arguments. Nothing decides this:
  `ShapeCollectionWriter.add` puts the shape "on top when below is undefined",
  which is also what an absent argument gives, so the two calls have the same
  effect. Open; passes on A. (The reference passes it too, so it fails there.)

- **local remove hands the writer the content's own ids array** A stamps a
  local operation by spreading the content (`{ ...content, clientId, ... }`),
  so the queued operation shares the caller's `ids` array, and `process` hands
  that very array to `writer.remove`; B builds the operation field by field
  with `ids: [...content.ids]`, so the writer gets a copy. The test compares
  identity only, and never changes an operation. `OperationSink.enqueue.own-copy`
  is about the operation enqueue *returns* (both return a copy with its own
  array), not about the one that is queued, so no rule decides who owns the
  array the writer sees: open. Passes on A.

- **remote remove hands the writer the enqueued operation's ids array** The
  same lack of copying at the other sink, and a step further: A queues the
  caller's operation object itself (`remoteQueue.push(op)`) and returns a copy
  of it, so the writer is later given the caller's own `ids` array; B queues a
  copy and returns a copy of that. Decided by nothing, for the reason above,
  though it is what `own-copy` is written to prevent one step later: open.
  Passes on A.

- **local enqueue keeps a property the operation type does not declare**
  Because A spreads the content, a field the operation's type doesn't declare
  (here `origin`) survives into the stamped operation A returns — the one the
  infrastructure sends to collaborators; B rebuilds the operation from `type`,
  the fields its own kind declares and the stamps, and drops it.
  `MessageProcessor.stamps` says which fields are added and `OperationContent`
  which are removed; neither says what becomes of fields outside the type.
  Open; passes on A.

- **a clear lists what it removes in the order the adds were applied** Both
  remove exactly the shapes whose adds the clear knew, in one `remove` call
  with the same set of IDs, but in different orders: A lists them in the order
  it applied their adds (its map's insertion order), B lists the acknowledged
  adds its `refSeq` covers first, in `seq` order, and then the clearing
  client's own adds that are still pending, in `clientSeq` order. In the test
  a local add is applied, then a remote add is placed under it, then a clear
  knows both: A lists mine then theirs, B theirs then mine. The order is open:
  `ShapeCollectionWriter.remove` ignores it ("repeats and absent IDs are
  ignored", the result is a set), and `clear-known` names a set too. Passes on
  A; the reference lists them bottom to top in z-order, which is theirs then
  mine, so it fails as B does.

- **the read facet has no own property beyond the collection's members** A's
  `model` is an object whose own properties are exactly `ShapeCollection`'s
  members; B's is an instance of a facet class that keeps the writer in an own
  property, so `Object.keys(model)` lists `writer` and whoever holds the facet
  can reach the write side through it and call `add` and `remove`. The spec
  text decides it: "`model` is a read-only facet of the writer: an object with
  only `ShapeCollection`'s members, delegating to the writer ... Never the
  writer itself", and that is what `ShapeMessageProcessor.read-facet` is for
  ("so whoever holds it can't change the shapes through it") — though the
  rule's own expression tests only `!("add" in this.model)` and
  `!("remove" in this.model)`, which B's facet satisfies. Passes on A.

- **a clear that removes nothing does not cost more as shapes pile up** A's
  clear copies every present add into an array and filters it
  (`[...this.addInfo].filter(...)`), so it costs time in proportion to the
  shapes present even when it removes none; B reads a prefix of its chain of
  acknowledged adds and the clearing client's own chain, so a clear that knows
  nothing costs a constant. With 4000 clears that know nothing, going from 20
  present shapes to 2000 leaves B's time about where it was and multiplies A's
  by orders of magnitude; the test fails A at a twentyfold margin.
  `ShapeMessageProcessor.log-amortized` decides it: "process takes amortized
  logarithmic time per operation, plus time in proportion to the shapes a
  clear removes". Passes on B; the reference fails it too, since its clear
  walks the writer's shapes with `forEach`.

## Notes

**How the tests look at the writer.** Four tests pass the processor a
`SpyWriter`, a subclass of `RefShapeWriter` that records the arguments of each
`add` and `remove` and then calls the reference writer. The writer is an
interface the processor is handed, so its calls are part of what the
interfaces show. The spy deviates from `RefShapeWriter` in one way: a `remove`
of an empty list returns 0 without scanning, which is the same result with no
event, so it still meets `@ensures removed`. That keeps the writer's own
linear scan from hiding the processor's cost in the last test.

**Valid uses.** Every add's ID comes from the `newShapeId` of the client that
made the add — a second `ShapeProcessor` with the other client's ID mints the
remote ones, and `new-ids` keeps those from colliding with ours
(`fresh-add-id`). Remote operations carry assigned, increasing `seq`s with
`refSeq < seq` (`remote-seq`, `ref-seq-range`), each client's arrive in
`clientSeq` order (`client-order`), and no two share an identity
(`unique-identity`). Nothing enqueues or calls `process` while a `process`
call is pending (`not-reentrant`), and no operation is changed after it is
enqueued, which is why the two copy tests compare array identity instead of
mutating an array the caller still holds.

**Differences found and not given a test of their own.**

- The missing copies also show through mutation: with A, pushing an ID onto an
  array that was passed to `local.enqueue` or `remote.enqueue` changes what a
  later `process` removes; with B it changes nothing. That is the same
  difference as the two identity tests, and it needs an operation to be changed
  after it is enqueued, which the spec's "Operations are never changed" rules
  out, so it shows nothing the identity tests don't.
- A's facet carries its members as own properties and B's on a prototype
  (`Object.getPrototypeOf`, `constructor.name`): the same object-literal
  against class difference the facet test already shows.
- `process` drains the queues differently — A shifts each queue until it is
  empty, B swaps the array out and iterates the snapshot — so a local
  operation enqueued while `process` ran would be applied before the remote
  queue by A and after it by B. Only reentrancy could show it, and
  `not-reentrant` forbids that.

**Where they agree.** I found no valid sequence of operations on which the two
differ in the model: the z-order and contents, which shapes a clear removes
(the set, not the order), which `seq`s are recorded, the number of writer calls
per operation and the `change` events that follow, `newShapeId`, and the
`refSeq` stamped on local operations all coincide. In particular their very
different bookkeeping of pending adds (A keeps a FIFO of its own
unacknowledged add IDs, B two linked chains per client) always yields the same
`below` for a remote add; and A matches an acknowledgment to an add by its ID
where B matches by `clientSeq`, which `fresh-add-id` (no ID is reused) and
`client-order` (acknowledgments arrive in order) keep from differing.

**`npm run check` in this workspace.** Each test passes on exactly one of A
and B, as the printed results show. The three scratch copies the check makes
can't be compiled there, for a reason outside this task: `check-here` links
each scratch's `node_modules` to `<workspace>/.task/node_modules`, which does
not exist (`task.ts` takes its repo directory from its own location), so in a
scratch copy `npx tsc` finds neither `@types/node` nor a TypeScript new enough
for `erasableSyntaxOnly`. `npm run typecheck`, which compiles the tests
against the reference in the workspace itself, passes. The tests do run in the
scratch copies because they import no package: that is also why the shape they
add is a local `UnitBox` built on `geometry.vocab.ts` rather than `testkit.ts`'s
`TestBox` — `testkit.ts` imports `fast-check`, which a scratch copy can't
resolve, and the whole test file then reports nothing at all.
