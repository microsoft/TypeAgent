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

## Layer

A Layer (`view.ts`) is read-only: its changes come from edits to its
source. Its table has those edits as calls, as the contract's fixture makes
them, and the layer's own observers, `on` and `off`. The Emitter rules
(`events.ts`) are checked through the layer's change event.

| Call | get, size, forEach, compareZ | inRect, atPoint results | Earlier `out` arrays | Listener calls | Returns |
|---|---|---|---|---|---|
| An edit that changes the items | `size`, `z-order`, `get-agrees`, `stable`, `no-reuse` | `*.exact` over `regions` | `no-retain` | `notifies`, `Emitter.on.notified`, `Emitter.off.removes-one`, `Emitter.order`, `Emitter.snapshot` | deferred† |
| An edit that changes nothing | `read-only`\* | `*.exact` | `no-retain` | `quiet` | deferred† |
| `get`, `size`, `forEach`, `compareZ` | `read-only`, `compareZ.zero-iff-same`, `compareZ.antisymmetric` | `read-only` | `no-retain` | `quiet` | `get-agrees`, `size`, `z-order`, `compareZ.*` |
| `inRect`, `atPoint` | `read-only` | `read-only`; results by `*.exact`, `*.once`, `*.count` | `*.append`, `no-retain` | `quiet` | `*.count` |
| `on`, `off` | `read-only` | `read-only` | `no-retain` | `Emitter.on.notified`, `Emitter.off.removes-one`, `quiet` | `this`, by type |

\* An edit that changes nothing leaves the items as they were by
definition; `read-only` covers reads made by listeners during an edit.

† Edits belong to the source, not the layer, so what they return is the
source's business. For `ShapeLayer` they follow `ShapeCollection`'s rules,
which the conversion contract below will check.

Unspecified on purpose: a listener that changes the source while it is
being called, or throws. A listener that adds or removes listeners is
covered by `Emitter.snapshot`. Not yet covered: whether the
layer's items are the right ones for its source. That belongs to a
conversion contract between a source and its layer, which is deferred; for
`ShapeLayer` the fixture's edits are checked only as far as the layer
shows them.

## ShapeView

A ShapeView (`shapeView.ts`) is checked with its View rules (`view.ts`).
Its observables are what its surface shows (`painted`), its frame requests
(through a `ManualScheduler`), and its listeners on the scene's layers.
Rule IDs without a prefix are `View`'s.

| Call | What the surface shows | Frame requests | Listeners on layers | Returns |
|---|---|---|---|---|
| Creating the view | unspecified until the first frame | `ShapeView.first-frame` | one listener per layer (`one-listener`) | — |
| A layer change | `layer-change` (unchanged until a frame) | `layer-change` | `one-listener` | — |
| `frame()` | `ShapeView.frame.paints` | `idle` | `one-listener` | nothing |
| Reading `scene`, `viewport`, `interactive` | `read-only` | `read-only` | `read-only` | `viewport` is the identity, by the ShapeView doc§ |
| `dispose()`, and anything after it | `dispose.inert` | `dispose.detaches` | `dispose.detaches` | nothing |
| Setting `viewport` | outside the rules for ShapeView | outside the rules | outside the rules | — |
| Setting `interactive` | no input yet, so nothing to observe | — | — | — |
| `on`, `off` (viewport) | — | — | — | the Emitter rules apply; `viewport` is never emitted yet |

§ No test reads the viewport's value; the identity is stated in prose.

Unspecified on purpose: what the surface shows before the first frame,
and how a view draws (only the result at each point is a rule). Not yet
covered: viewports other than the identity, input, and shape kinds other
than Circle.

## Chrome

A Chrome (`chrome.ts`) is checked with `chrome.contract.ts`. Its
observables are its state, its layer's items, the changes it emits, its
listeners on the layer, and what `present` returns. Rule IDs without a
prefix are `Chrome`'s.

| Call | State | Layer | Emits change | Listeners on layer | Returns |
|---|---|---|---|---|---|
| Making a chrome | `starts` | unchanged | — | `one-listener` | — |
| `dispatch` that acts (mode, color, radius) | `dispatch.mode`, `dispatch.color`, `dispatch.radius` | unchanged (`dispatch.ignores` covers the rest) | `emits` | `one-listener` | nothing |
| `dispatch` of clear | count follows (`counts`) | `dispatch.clear` | `emits` | `one-listener` | nothing |
| `dispatch` that doesn't act | `dispatch.ignores` | `dispatch.ignores` | `dispatch.ignores` | `one-listener` | nothing |
| `tap` in draw mode | count follows (`counts`) | `tap.draws` | `emits` | `one-listener` | nothing |
| `tap` in erase mode | count follows (`counts`) | `tap.erases` | `emits` | `one-listener` | nothing |
| A change to the layer from elsewhere | `counts` | — | `emits` | `one-listener` | — |
| `present` | `present.pure` | `present.pure` | `present.pure` | unchanged | `present.exact`, and the SemanticNode invariants |
| Reading `state` | unchanged | unchanged | none | unchanged | a value (`state.snapshot`) |
| `dispose()`, and anything after it | no longer followed | `dispose.detaches` (only edits from elsewhere) | `dispose.detaches` | `dispose.detaches` | nothing |
| `on`, `off` | — | — | — | — | the Emitter rules apply |

Not covered: how a chrome behaves when its layer holds shapes that aren't
circles, or when its options break their invariants; both are outside the
rules.

## Renderer

A Renderer (`ui.ts`) is checked with `ui.contract.ts` through a fixture that
reads the platform's widgets and acts as the user. Rule IDs without a
prefix are `Renderer`'s.

| Call or action | What the platform presents | Input emitted | Widgets |
|---|---|---|---|
| Making a renderer | nothing (`starts-empty`) | — | — |
| `render(tree)` | `render.presents` | none (`render.quiet`) | kept for keys whose role is unchanged (`stable`) |
| The user activates an enabled button, or an enabled radio that isn't selected | unchanged until the next render | `reports` | unchanged |
| The user sets an enabled slider | the slider shows the value until the next render | `reports` | unchanged |
| Any other action (disabled, selected radio, other roles, unknown key) | unchanged | none (`silent`) | unchanged |
| `dispose()`, and anything after it | nothing (`dispose.removes`) | none (`dispose.removes`) | — |
| `on`, `off` | — | the Emitter rules apply | — |

Between a slider drag and the next render, the platform shows the user's
value, which may differ from the tree's. The rules don't say what is
presented then; only the next render's result is a rule.

## App

An App (`app.ts`) is checked with `app.contract.ts`, and the circles app as
a whole with the scenarios (`scenarios.ts`). The Scenarios column names the
scenarios that exercise each row through a driver. Rule IDs without a
prefix are `App`'s.

| Event | Renderer's tree | Chrome calls | View | Listeners | Parts disposed | Scenarios |
|---|---|---|---|---|---|---|
| Connecting | the chrome's controls (`starts`) | `present` | interactive (`starts`) | one each (`one-listener`) | none | `starts` |
| The chrome emits change | the chrome's new controls (`renders`) | `present` | — | unchanged | none | `draw-one`, `clear`, `erase-misses` |
| The renderer emits input | follows through the chrome (`renders`) | `dispatch` (`forwards-input`) | — | unchanged | none | `color-and-radius`, `erase-disables-drawing-controls`, `clear-in-erase-mode` |
| The view emits tap | follows through the chrome (`renders`) | `tap` (`forwards-taps`) | — | unchanged | none | `draw-one`, `erase-top-of-overlap`, `draw-after-erase-is-on-top` |
| `dispose()`, twice | unchanged; the renderer is disposed | none afterward | disposed | removed (`dispose.detaches`) | each once, chrome, view, renderer (`dispose.detaches`) | — |

## RootRegion and Region

A router (`pointer.ts`) is checked with `pointer.contract.ts`, which keeps
its own model of the regions in window coordinates. The observables are
which regions emit each delivered event, with what point and time, and each
region's bounds. Rule IDs without a prefix are `RootRegion`'s.

| Call | Which region receives | Point and time | Regions |
|---|---|---|---|
| `deliver` with no press in progress | `innermost-listener` | `local` | unchanged |
| `deliver` during a press its down's receiver captured | `capture` | `local` | unchanged |
| `deliver` during a press after the captor was removed | none (`released-capture`) | — | unchanged |
| `deliver` during a press no region received | none (`uncaptured`) | — | unchanged |
| `add(rect)` | — | — | a new child with bounds `rect` (`Region.add.adds`) |
| `remove()` | none for it or under it, from then on (`Region.remove.detaches`) | — | gone from its parent's children |
| `on`, `off` | change who qualifies as a listener | — | — |

Outside the rules: a down delivered during a press, `add` that breaks its
requirements, and removing the root.

## TapRecognizer

A TapRecognizer (`pointer.ts`) is checked with `tapRecognizer.contract.ts`,
on a region nested in a reference root. The observables are the taps it
emits and its listeners on the region.

| Event on its region | Taps emitted | Listeners on the region |
|---|---|---|
| A press that stays within the slop | one, at the down's point, at the up (`taps`) | `one-listener` |
| A press that wanders past the slop, even if it comes back | none (`only-taps`) | `one-listener` |
| A press that starts outside the region | none: the region never receives it (`only-taps`) | `one-listener` |
| A hover move, or an up with no press | none (`only-taps`) | `one-listener` |
| `dispose()`, and anything after it | none (`dispose.detaches`) | none (`dispose.detaches`) |

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

The router's table found an empty row: nothing said where a press goes
when no region receives its down. It became `RootRegion.uncaptured`: the
press belongs to no region, and its moves and up go nowhere.
