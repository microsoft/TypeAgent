# Pilot: every rule in shapeModel.ts formal

Status: draft for the human's review, 2026-11-13. Nothing here is in a
design file yet. Follows the principles in `vocabulary-proposal.md`.

## What the pilot found before writing anything

- **Ghost functions are defined by prose.** `applied()` (dataModel.vocab.ts)
  and `indexed()` (shape.vocab.ts) are `declare function`s with no body.
  Their meaning is a doc comment saying "as tracked by the test harness":
  the design depends on the harness, and the blocklist missed it
  ("harness" isn't on it).
- **Prose in doc comments states requirements no rule states.**
  `forEach`'s doc says "visit must not change the collection", which is
  a `@requires` in all but name.
- **Some rules claim more than can be observed.** `ack-keeps-z` and
  `one-change` speak of each operation, but `process` applies a batch,
  and from outside only the whole call is visible. The contract checks
  them only when a batch is all acknowledgments or a single operation.
  A formal statement can say only what is observable, so these need a
  decision (below).

## Proposed primitives (rule language, rules.ts)

Today the rule language has one temporal form, `old(e)`. The pilot needs
two more, and replaces every ghost function with functions of one
primitive, the history.

1. **`history(o)`**: the calls made on o so far, in order, the current
   call last. It is the only ghost state. It is what an observer outside o
   can record, so it needs no prose definition:

   ```ts
   /** One call made on an object, as seen from outside it. */
   export interface Call {
     /** The member called, such as "add", or "local.enqueue" for a member of a member. */
     readonly member: string;
     readonly args: readonly unknown[];
     /** The return value; for an async call, the value its promise settled with. */
     readonly result: unknown;
     /** The events the object emitted during the call, in order. */
     readonly emitted: readonly { readonly event: string; readonly args: readonly unknown[] }[];
   }
   export declare function history(o: object): readonly Call[];
   ```

2. **`atEvent(i, e)`**: the value of e when the current call emitted its
   i-th event (from 0). Rewritten by the rule tooling, like `old`.

3. **Timing of `@invariant`.** An invariant holds after every call *and
   whenever the object emits an event*. This is how "every observer and
   query already shows it" becomes formal: a listener sees an object
   whose invariants hold.

The ghost functions become ordinary vocabulary, defined from the history:

```ts
/** The events the current call emitted. */
export const emitted = (o: object): readonly string[] =>
  history(o).at(-1)!.emitted.map((e) => e.event);

/** The operations p has applied: each enqueued operation once process has
    settled after it, with the seq of its acknowledgment if one was enqueued. */
export function applied<TOp extends Operation>(p: MessageProcessor<never, TOp>): readonly TOp[] { ... }

/** The shapes a locator's queries are about: those added and not since removed. */
export function indexed(q: ShapeLocatorQueries): ReadonlyMap<ShapeId, Shape> { ... }

/** The IDs newShapeId has returned, from any processor. */
export declare function issued(): readonly ShapeId[];   // see "Open" 3
```

`applied` and `indexed` get full bodies written over `history(o)`: pure
functions, in the restricted subset, that a prover can read.

## Each rule, with its formal statement

Rules that already have an expression are unchanged and not listed. The
headline stays as the gloss, and the gloss references the rule by its ID.

**ShapeCollection.read-only** (ensures, applies to calls of
ShapeCollection's members, own or inherited)
```ts
deepEqual(entries(this), old(entries(this))) && emitted(this).length === 0
```
Gloss: "Reading changes nothing and emits nothing." The headline's list of
members becomes a rule-language fact: an interface's `@ensures` applies to
calls of that interface's members. The writer's `add` isn't one, so the
rule doesn't apply to it.

**ShapeCollection.forEach.no-change** (new requires, from the doc comment)
```ts
history(this).at(-1)!.nested.every((c) => !writes.includes(c.member))
```
Needs `nested`: the calls made on the object while the current call was in
progress. Alternative: drop it and let `read-only` be the whole story,
since visiting can only reach the read side. **Decision wanted.**

**ShapeCollection.compareZ.present** (requires)
```ts
ids(this).includes(a) && ids(this).includes(b)
```

**ShapeCollection.compareZ.zero-iff-same**
```ts
(result === 0) === (a === b)
```

**ShapeCollection.compareZ.antisymmetric**
```ts
Math.sign(result) === -Math.sign(this.compareZ(b, a))
```

**ShapeCollectionWriter.notifies**
```ts
deepEqual(entries(this), old(entries(this)))
  ? emitted(this).length === 0
  : deepEqual(emitted(this), ["change"]) && deepEqual(atEvent(0, entries(this)), entries(this))
```
Queries at the event are covered by the invariant timing above.

**ShapeCollectionWriter.add.new-id** (requires)
```ts
!ids(this).includes(id)
```

**ShapeCollectionWriter.add.below-present** (requires)
```ts
below === undefined || ids(this).includes(below)
```

**ShapeMessageProcessor.fresh-add-id** (requires)
```ts
(op: AddShape) => applied(this).includes(op) ?
  issued().includes(op.id) && applied(this).filter(isAdd).filter((a) => a.id === op.id).length === 1 : true
```

**ShapeMessageProcessor.in-range** (requires)
```ts
applied(this).filter(isAdd).every((a) => inRange(a.shape.boundingBox(), 1e300))
```

**ShapeMessageProcessor.newShapeId.new-ids**
```ts
!old(issued()).includes(result)
```

**ShapeMessageProcessor.ack-keeps-z** and **one-change**: these need a
decision (below). If restated on what is observable, over the operations
the current process call applied (`newly(this)`, defined from the
history):
```ts
// ack-keeps-z
newly(this).every((op) => isAckOf(this, op))
  ? deepEqual(entries(this.model), old(entries(this.model))) && emitted(this.model).length === 0
  : emitted(this.model).length <= newly(this).filter((op) => !isAckOf(this, op)).length
// one-change
emitted(this.model).length === changesIn(old(applied(this)), newly(this))
```
`changesIn(before, ops)` counts the operations in ops that change
`shapesAfter` when appended one at a time. For a batch, that relies on the
order within the batch, which isn't observable, so `one-change` holds
only up to that order. With an observation member (option b), both rules
become exact per operation.

**The two `@budget log-amortized` rules**
```ts
perOp(100_000) / perOp(1_000) <= 16
```
`perOp(n)` is a measurement: the mean time of the rule's operations at n
shapes. Its workload ("whatever the pattern of adds") is the open part;
the bench's choice of workloads moves into the design as a list.

**Rationale moved out.** The budget's "(cache misses at 100,000 shapes put
a logarithmic structure at 4 to 9; linear growth gives about 100)" and the
treap example go to the decisions record.

## Decisions (2026-11-13)

- **1 agreed:** `history`, `atEvent`, and `@invariant` holding at events.
- **2 agreed, option (b):** an observation member, in an interface of its
  own, reports each operation as it is applied; `ack-keeps-z` and
  `one-change` stay per operation and become exact. The principle behind
  it is recorded in `vocabulary-proposal.md` (principle 5: observability
  is design).
- **3 agreed:** `forEach.no-change` becomes a `@requires`; the history
  records nested calls.
- **4 agreed, option (b):** `new-ids` is a rule over two processors:
  `unique(returned(this))`, and for any processor q with a different
  clientId, `disjoint(returned(this), returned(q))`. `fresh-add-id`
  covers only this processor's local adds. Deferred: a **collaboration
  session**. ClientIds are unique within a session; between sessions,
  only the last snapshot defines the data. This is where ID uniqueness
  across reloads belongs, and it subsumes the deferred `snapshot` rule.
  To be written as a `@deferred` rule with its when and how.
- **5 agreed, option 1:** a budget's formal statement is
  `growth(w, 1_000, 100_000) <= 16` for each workload w in a named list
  in the design, measured as mean time per operation. More broadly,
  performance measurements are more pragmatic than other tests: a
  budget's complexity class ("logarithmic") carries weight beyond its
  threshold. So the class is part of the statement, not a gloss. It is a
  declared symbol with its mathematical meaning, the measurement is its
  proxy, and an implementation that passes the proxy with an algorithm
  outside the class still breaks the rule (found in 2b review).

## Results (2026-11-13)

Done, not committed:

- **Rule expressions are now compiled and evaluated.** Before the pilot,
  nothing evaluated them: the catalog kept each one as a string, and each
  contract restated it by hand (`rules.ts` said `old` was "rewritten by
  the rule tooling", but no such tooling existed). Now:
  - `ruleGen.ts` compiles the rules of `shapeModel.ts` into
    `rules.gen.ts`, rewriting `old` and `atEvent`, so tsc checks every
    expression against the interfaces and vocabulary.
    `npm run typecheck` fails when the file is stale.
  - `ruleCheck.ts` wraps an object in a proxy that records its history
    (`history` in `rules.ts`) and evaluates the rules that apply to each
    call; it checks invariants at each event too.
- **The contracts now drive the calls; the rules decide pass or fail.**
  These hand-written checks were removed:
  - writer: `add.placed`, `remove.removed`, `notifies`;
  - collection: `read-only`, `size`, `z-order`, `get-agrees`,
    `compareZ.zero-iff-same`, `compareZ.antisymmetric`;
  - processor: `read-facet`, `add-on-z`, `kept`, `remove-listed`,
    `clear-known`, `new-ids`.

  The test's own `@requires` (such as `add.new-id`, `fresh-add-id`, and
  `forEach.no-change`) are checked too, and throw if the test breaks one.
- **Vocabulary:**
  - `applied` is now defined from the history, not by "tracked by the test
    harness".
  - New words: `history`, `Call`, `atEvent`, `emitted`, `nested`,
    `returned`, `disjoint`, `Complexity` and `within` in `rules.ts`;
    `newIds`, `localAdds`, `writerWorkloads` and `processorWorkloads` in
    `shapeModel.vocab.ts`.
- **`dataModel.ts`:** `@deferred session` replaces `@deferred snapshot`.
- **Two adversaries were renamed for the rules that now catch them:**
  - `notifies--index-after-emit` is now `ShapeLocatorQueries.inRect.exact--index-after-emit`:
    a listener's query during the change is wrong.
  - `ShapeLocatorQueries.read-only--query-moves-found` is now
    `ShapeCollection.read-only--query-moves-found`: `atPoint` is one of
    ShapeCollection's members.

  Both faults are real and still caught; only the rule that catches them
  changed.
- **Checks:**
  - 410 tests, with the same 9 known failures (`rectangleOps` and
    `rectDistributor`, waiting on held task 16).
  - 169 adversaries, none escaped, on seeds 1, 2 and 3.
  - The catalog writes (136 rules).

Still to do in this file:

- `ack-keeps-z` and `one-change` keep their hand-written checks until the
  observation interface (below) is agreed.
- The budgets' workloads are named in the design, and `bench.ts`'s
  patterns are typed by those names and refuse to run if one is
  unmeasured (done). What each workload does is still defined only in
  `bench.ts`; budgets are pragmatic, so that may be enough.
- `ShapeCollection`'s doc says in prose that `indexed(this)` is the shapes
  `forEach` visits. That belongs to `shape.ts`, whose rules are next.

## The observation interface: agreed and done (2026-11-13)

- **Decided:** every MessageProcessor logs, written as a separate
  interface (`OperationLogging<TOp>` in `dataModel.ts`, which
  `MessageProcessor` extends), with one member named `logOperations`.
- **Rules:**
  - New: `MessageProcessor.process.logs-each`.
  - `MessageProcessor.local-order` and `remote-order` went from
    `@abstract` to `@ensures` with expressions, so their `@refines` lines
    in `shapeModel.ts` are gone.
  - `ShapeMessageProcessor.ack-keeps-z` and `one-change` have exact
    per-operation expressions (vocabulary: `logged`, `queuedSince`,
    `sameOps`, `isAckOf` and `steps` in `dataModel.vocab.ts`).
  - `once` and `atomic` stay `@abstract`, refined by those two.
- **Test code:** the reference processor and both adversary helpers log.
  Four new adversaries are caught on seeds 1 to 3: `logs-each--log-skips-acks`,
  `local-order--local-lifo`, `remote-order--remote-lifo` and
  `one-change--logs-before-apply`. The hand-written per-operation checks
  are gone, so every rule in `shapeModel.ts` is now judged by its
  expression.
- **Task 9 requeued** (`reports/task-9.respec-1.md`) and rerun. Its second
  run, 9.2, and the distinguishing workspace 9.d predate the log.
- **Gap:** `logOperations` isn't run through the EventEmitter contract,
  which needs an event emitted synchronously, while `process` may apply
  asynchronously.

## Proposal: the observation interface (as first proposed)

```ts
/** What a processor's operations log reports: each operation as it is applied. */
export type OperationLogEvents<TOp extends Operation> = { applied: [op: TOp] };

// On MessageProcessor (dataModel.ts):
/**
 * Reports each operation as it is applied, for logging, debugging,
 * testing and analysis.
 *
 * @ensures each-applied  Emits applied once for each operation applied from either queue, an acknowledgment included, in the order applied; an acknowledgment's op has its assigned seq.
 * @ensures after-effect  applied is emitted after the operation's whole effect is in the model and the model has emitted its change events for it.
 */
readonly log: EventEmitter<OperationLogEvents<TOp>>;
```

With it, a `process` call's `emitted` interleaves `model.change` and
`log.applied` events in order, and the per-operation rules become exact
expressions. For example, `one-change`: between one `log.applied` event
and the next, the model emits `change` once if that operation changed
the shapes, and not at all otherwise. Both sides are `atEvent` values, so
no per-operation state is hidden. It also lets the `@abstract` rules
`local-order`, `remote-order`, `once` and `atomic` be stated once for
every processor in `dataModel.ts`, rather than only through refinement.

Cost: `shapeProcessor.ts` is a phase 2 output, so adding a member means
requeuing its task (your go-ahead). The references, doubles and
adversary helpers are test code, and I'd update them.

Questions:
- Is `log` a member of MessageProcessor (every processor reports), or of
  a separate interface a processor may also implement?
- The name: `log`, `trace` or `operations`?

## Decisions wanted (as first asked)

1. **The primitives:** `history`, `atEvent`, and `@invariant` holding at
   events. With them, `old`-style operators number two, and ghost state is
   one function.
2. **Per-operation rules** (`ack-keeps-z`, `one-change`, and through
   `@refines` the abstract `once` and `atomic`):
   - (a) restate them on what a `process` call shows, as above; or
   - (b) add an observation member, in an interface of its own (allowed
     for members that exist for rules), that reports each operation as
     it is applied, so the rules hold per operation exactly.

   I'd choose (b). The rules as you agreed them are per operation, and
   (a) quietly weakens them.
3. **`forEach.no-change`:** a new `@requires` with `nested` calls in the
   history, or drop it.
4. **`issued()`:** a ghost across processors. Either the history of every
   processor (a "world" history), or a requires on the infrastructure.
5. **Budgets:** whether `perOp` and a named list of workloads belong in
   the design.

## What the pilot cost (so far)

- New rule-language primitives: 3 (`history`, `atEvent`, invariant timing).
- New vocabulary: `emitted`, `newly`, `isAckOf`, `changesIn`, `perOp`,
  `issued`, and bodies for `applied` and `indexed`.
- Rules given a statement: 15 of 15 in shapeModel.ts, two of them pending
  decision 2.
- Readability: the expressions are short except `fresh-add-id` and the
  two per-operation rules. The glosses carry them.
