# Observer tables

For each stateful interface, every call (rows) against everything a caller
can observe afterward (columns). Each cell names the rules that settle it,
or says why it is left unspecified. A cell with neither is a missing rule:
behavior no adversary would be written for, because adversaries are written per
rule. Phase 1 fills these tables, and phase 1b checks them (see
`moduleTooling.md`).

"Others" means shapes or IDs other than the ones the call names. Rule IDs
leave out the interface name when it is the table's own.

## ShapeCollectionWriter and ShapeCollection

The writer (`shapeModel.ts`) is the collection's only mutator, held by its
processor. `ShapeCollection`, the read side, is the writer without `add`
and `remove`; its own rows are the last one. The queries are about the
present shapes (`indexed(this)` is what `forEach` visits), so the
`ShapeLocatorQueries` rules apply to them. The EventEmitter rules
(`events.ts`) are checked through the change event. Rule IDs without a
prefix are `ShapeCollectionWriter`'s; `SC.` is `ShapeCollection`, `SLQ.`
is `ShapeLocatorQueries`.

| Call | get, size, forEach, compareZ | inRect, atPoint results | Earlier `out` arrays | Change listeners | Returns |
|---|---|---|---|---|---|
| `add` | `add.placed`; `SC.size`, `SC.z-order`, `SC.get-agrees` | `SLQ.*.exact` | `SLQ.no-retain` | `notifies`; `EventEmitter.*` | nothing |
| `remove` | `remove.removed`; `SC.size`, `SC.z-order`, `SC.get-agrees` | `SLQ.*.exact` | `SLQ.no-retain` | `notifies` (none if nothing was removed) | `remove.removed` |
| `get`, `size`, `forEach`, `compareZ`, `inRect`, `atPoint`, `on`, `off` | `SC.read-only` | `SC.read-only`, `SLQ.read-only` | `SLQ.*.append`, `SLQ.no-retain` | `SC.read-only` (emits nothing); `on`, `off` by `EventEmitter.*` | `SC.get-agrees`, `SC.size`, `SC.z-order`, `SC.compareZ.*`, `SLQ.*.count`, `SLQ.*.once`, `SLQ.*.exact`; `this` for `on` and `off`, by type |

Unspecified on purpose: `add` with an ID that is present (`add.new-id`),
below a shape that isn't (`add.below-present`), or with a shape outside
±1e300 (`add.in-range`); `compareZ` on an ID that isn't present
(`SC.compareZ.present`); a `forEach` visitor or a change listener that
changes the collection, or throws.

## ShapeLocatorQueries and ShapeLocator

| Call | inRect, atPoint results | Earlier `out` arrays | Returns |
|---|---|---|---|
| `add` | `ShapeLocatorQueries.*.exact` (through `indexed`); `add.indexed` | `ShapeLocatorQueries.no-retain` | nothing |
| `remove` | `ShapeLocatorQueries.*.exact`; `remove.gone` | `ShapeLocatorQueries.no-retain` | `remove.result` |
| `removeMultiple` | `ShapeLocatorQueries.*.exact`; `removeMultiple.same-as-remove` | `ShapeLocatorQueries.no-retain` | `removeMultiple.count` |
| `inRect`, `atPoint` | `ShapeLocatorQueries.read-only` | `ShapeLocatorQueries.*.append`, `ShapeLocatorQueries.no-retain` | `ShapeLocatorQueries.*.count`, `*.once`, `*.exact` |

Unspecified on purpose: `add` with an ID that is already indexed
(`add.new-id`), and shapes outside ±1e300 (`add.in-range`).

## MessageProcessor and ShapeMessageProcessor

A processor (`dataModel.ts`) is checked by playing clients against a fake
sequencer (`messageProcessor.contract.ts`). Its observables are the model
(its shapes and their order), the model's change events, and the
operations `local.enqueue` returns. Operations leave the processor only as
that return value, so no other call can send one. Rule IDs without a prefix are
`MessageProcessor`'s; `SMP.` is `ShapeMessageProcessor`.

| Call | Model | Model change events | Returns |
|---|---|---|---|---|
| `local.enqueue` | `enqueue-defers`, `sole-writer` (unchanged until `process`) | `enqueue-defers` (none) | the stamped operation: `stamps`, `Operation.*`, `LocalQueue.enqueue.own-copy` |
| `remote.enqueue` | `enqueue-defers`, `sole-writer` | `enqueue-defers` | nothing |
| `process` | `SMP.add-on-z`, `SMP.kept`, `SMP.remove-listed`, `SMP.clear-known`, `SMP.ack-keeps-z`; `converges` across clients | `SMP.one-change`, `SMP.ack-keeps-z` | settles once the queues are empty (by its doc) |
| `newShapeId` | `sole-writer` | `sole-writer` | `SMP.new-ids` |
| Reading `model` | `sole-writer`, `SC.read-only` | `sole-writer` | `SMP.read-facet` |
| Nothing (time passing) | `passive` | `passive` | — |

Unspecified on purpose: operations that break `formed-now`, `remote-seq`,
`unique-identity`, `SMP.fresh-add-id` or `SMP.in-range`; and calls from
anything but the message infrastructure (`infrastructure-only`).

## ShapeView

A ShapeView (`shapeView.ts`) is checked with its View rules (`view.ts`).
Its observables are what its surface shows (`painted`), its frame requests
(through a `ManualScheduler`), and its listeners on the model.
Rule IDs without a prefix are `View`'s.

| Call | What the surface shows | Frame requests | Listeners on the model | Returns |
|---|---|---|---|---|
| Creating the view | unspecified until the first frame | `ShapeView.first-frame` | `one-listener` | — |
| A model change | `model-change` (unchanged until a frame) | `model-change` | `one-listener` | — |
| `frame()` | `ShapeView.frame.paints` | `idle` | `one-listener` | nothing |
| Reading `model`, `viewport` | `read-only` | `read-only` | `read-only` | `viewport` is the identity, by the ShapeView doc§ |
| `dispose()`, and anything after it | `dispose.inert` | `dispose.detaches` | `dispose.detaches` | nothing |
| Setting `viewport` | outside the rules for ShapeView | outside the rules | outside the rules | — |
| `on`, `off` (viewport) | — | — | — | the EventEmitter rules apply; `viewport` is never emitted yet |

§ No test reads the viewport's value; the identity is stated in prose.

Unspecified on purpose: what the surface shows before the first frame,
and how a view draws (only the result at each point is a rule). Not yet
covered: viewports other than the identity, and shape kinds other than
Circle. A view takes no input (`view.ts`).

## EventDistributor

An EventDistributor (`layout.ts`) is observed through which listeners an
event reaches, in what order, and what `distribute` returns. Rule IDs
without a prefix are `EventDistributor`'s.

| Call | Which listeners a later event reaches | What distribute returns |
|---|---|---|
| `on` | `on.registers` | `distribute.reports` |
| `off` | `off.removes-one` | `distribute.reports` |
| `distribute` | `distribute.innermost`, `distribute.only-enclosed`; registrations changed by its listeners, `snapshot` | `distribute.reports` |
| Changing a target's `region` | `live-regions` | `live-regions` |
| Calling `distribute` detached | `distribute.detached` | `distribute.detached` |
| Reading `region`, calling `locate` | no rule | no rule |

Not yet covered: the bottom row. Nothing says that reading `region` or
calling `locate` leaves the registrations as they were.

## What the tables found

Drawing these tables for round 4 found three empty cells, all in the
bottom rows: nothing said that observers (`get`, `forEach` and the rest),
queries, or subscribing leave the state unchanged. They became
`ShapeCollection.observers-read-only`, `ShapeLocatorQueries.read-only` and
`Layer.read-only` (then named `Layer.subscriptions-separate`), each with a
adversary. Two earlier gaps,
`get-agrees` and `others-kept`, were also cells of these tables.

When Layer moved to `view.ts` and became read-only, the layer's
read-only cells merged into one rule, `Layer.read-only`, and the table
showed two cells that caching views rely on and no rule covered: an ID
keeping its item (`Layer.stable`) and IDs not coming back
(`Layer.no-reuse`). Both have adversaries.

The second phase 1b challenge found that `Layer.notifies` named only
`forEach` and the queries, though a listener may call any observer. It
now says every observer and query, and the reference listener uses them
all. The Returns column was missing from the Layer table; its edit rows
wait for the conversion contract.

Drawing the ShapeView table found one empty cell: nothing said that
reading a view's properties leaves it unchanged. It became
`View.read-only`, with an adversary whose `viewport` getter requests a frame.

The ShapeView table also left the listener column open for layer changes
and frames: a view that added a listener on every change would have
passed. It became `View.one-listener`, with two adversaries: one listening
twice from the start, one adding a listener on each change.

The chrome, renderer and app tables found three things. A renderer that
re-presents a slider while the user drags it would fire input on its own
render; that became `Renderer.render.quiet`. A state read before a change
could change with it; that became `Chrome.state.snapshot`. And the
renderer's widget column needed a rule for focus and drags to survive a
render, which became `Renderer.stable`.

The chrome, renderer, app, router and tap recognizer tables went with
those interfaces in round 7. The router's table found an empty row: nothing said where a press goes
when no region receives its down. It became `RootRegion.uncaptured`: the
press belongs to no region, and its moves and up go nowhere.

The EventDistributor table found one empty row: reading `region` and
calling `locate` (above). It is left open for the human's decision.
