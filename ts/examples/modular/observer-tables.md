# Observer tables

For each stateful interface, every call (rows) against everything a caller
can observe afterward (columns). Each cell names the rules that settle it,
or says why it is left unspecified. A cell with neither is a missing rule:
behavior no adversary would be written for, because adversaries are written per
rule. Phase 1 fills these tables, and phase 1b checks them (see
`moduleTooling.md`).

"Others" means shapes or IDs other than the ones the call names. Rule IDs
leave out the interface name when it is the table's own.

## ShapeCollection

| Call | get | size | forEach (entries, order) | compareZ | Returns |
|---|---|---|---|---|---|
| `add` | `add.gettable` for the new shape; `add.others-kept` for others; `get-agrees` for unknown IDs | `size` | `add.others-kept`, `add.on-top`, `z-order` | `add.on-top`, `z-order` | `add.fresh-id` |
| `remove` | `remove.gone`; `remove.others-kept`; `get-agrees` for unknown IDs | `size` | `remove.others-kept` | `z-order` | `remove.result` |
| `removeMultiple` | `removeMultiple.gone`; others by `removeMultiple.same-as-remove` | `size` | `removeMultiple.same-as-remove` | `z-order` | `removeMultiple.count` |
| `get`, `size`, `forEach`, `compareZ` | `observers-read-only` | `observers-read-only` | `observers-read-only` | `observers-read-only` | `get-agrees`, `size`, `z-order`, `compareZ.zero-iff-same`, `compareZ.antisymmetric` |

Unspecified on purpose: `compareZ` on an ID that isn't present
(`compareZ.present` is a `@requires`), and a `forEach` visitor that changes
the collection.

## ShapeLocatorQueries and ShapeLocator

| Call | inRect, atPoint results | Earlier `out` arrays | Returns |
|---|---|---|---|
| `add` | `ShapeLocatorQueries.*.exact` (through `indexed`); `add.indexed` | `ShapeLocatorQueries.no-retain` | nothing |
| `remove` | `ShapeLocatorQueries.*.exact`; `remove.gone` | `ShapeLocatorQueries.no-retain` | `remove.result` |
| `removeMultiple` | `ShapeLocatorQueries.*.exact`; `removeMultiple.same-as-remove` | `ShapeLocatorQueries.no-retain` | `removeMultiple.count` |
| `inRect`, `atPoint` | `ShapeLocatorQueries.read-only` | `ShapeLocatorQueries.*.append`, `ShapeLocatorQueries.no-retain` | `ShapeLocatorQueries.*.count`, `*.once`, `*.exact` |

Unspecified on purpose: `add` with an ID that is already indexed
(`add.new-id`), and shapes outside ±1e300 (`add.in-range`).

## RenderGroup

A RenderGroup (`view.ts`) is read-only: its changes come from edits to its
source. Its table has those edits as calls, as the contract's fixture makes
them, and the group's own observers, `on` and `off`. The EventEmitter rules
(`events.ts`) are checked through the group's change event.

| Call | get, size, forEach, compareZ | inRect, atPoint results | Earlier `out` arrays | Listener calls | Returns |
|---|---|---|---|---|---|
| An edit that changes the items | `size`, `z-order`, `get-agrees`, `stable`, `no-reuse` | `*.exact` over `regions` | `no-retain` | `notifies`, `EventEmitter.on.notified`, `EventEmitter.off.removes-one`, `EventEmitter.order`, `EventEmitter.snapshot` | deferred† |
| An edit that changes nothing | `read-only`\* | `*.exact` | `no-retain` | `quiet` | deferred† |
| `get`, `size`, `forEach`, `compareZ` | `read-only`, `compareZ.zero-iff-same`, `compareZ.antisymmetric` | `read-only` | `no-retain` | `quiet` | `get-agrees`, `size`, `z-order`, `compareZ.*` |
| `inRect`, `atPoint` | `read-only` | `read-only`; results by `*.exact`, `*.once`, `*.count` | `*.append`, `no-retain` | `quiet` | `*.count` |
| `on`, `off` | `read-only` | `read-only` | `no-retain` | `EventEmitter.on.notified`, `EventEmitter.off.removes-one`, `quiet` | `this`, by type |

\* An edit that changes nothing leaves the items as they were by
definition; `read-only` covers reads made by listeners during an edit.

† Edits belong to the source, not the group, so what they return is the
source's business. For `ShapeGroup` they follow `ShapeCollection`'s rules,
which the conversion contract below will check.

Unspecified on purpose: a listener that changes the source while it is
being called, or throws. A listener that adds or removes listeners is
covered by `EventEmitter.snapshot`. Not yet covered: whether the
group's items are the right ones for its source. That belongs to a
conversion contract between a source and its group, which is deferred; for
`ShapeGroup` the fixture's edits are checked only as far as the group
shows them.

## ShapeView

A ShapeView (`shapeView.ts`) is checked with its View rules (`view.ts`).
Its observables are what its surface shows (`painted`), its frame requests
(through a `ManualScheduler`), and its listeners on the scene's groups.
Rule IDs without a prefix are `View`'s.

| Call | What the surface shows | Frame requests | Listeners on groups | Returns |
|---|---|---|---|---|
| Creating the view | unspecified until the first frame | `ShapeView.first-frame` | one listener per group (`one-listener`) | — |
| A group change | `group-change` (unchanged until a frame) | `group-change` | `one-listener` | — |
| `frame()` | `ShapeView.frame.paints` | `idle` | `one-listener` | nothing |
| Reading `scene`, `viewport` | `read-only` | `read-only` | `read-only` | `viewport` is the identity, by the ShapeView doc§ |
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
