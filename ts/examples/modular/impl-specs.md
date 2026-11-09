# Implementation specs: round 1

Each implementation satisfies an interface in the interface files
(`events.ts`, `geometry.ts`, `color.ts`, `shape.ts`, `window.ts`, `view.ts`,
`shapeView.ts`, `pointer.ts`, `ui.ts`, `chrome.ts` and `app.ts`), including
every rule (`@requires`, `@ensures`, `@invariant`) written there. Rule
expressions use the vocabulary in `rules.ts` and the `*.vocab.ts` files.

## Rules for every implementation

`task.ts` turns each numbered section with an **Imports** field into a
generation task, and enforces these rules rather than only stating them. A section's fields: **Outputs** (default: the
file in its heading; "(header only)" means only the leading comment may
change), **Imports** (the only files the outputs may import), and
**Binds** (`node` or `dom`; default neither, so only the ES2022 library),
and **Hidden** (files the task must not read, such as the reference
implementation of its own part; `task.ts` refuses to make a workspace
whose reads include one).

- **Imports:** only the files listed for that implementation. Use `import type`
  for interfaces. Relative imports use the `.ts` extension. No npm packages.
  Scripts (below) may also use Node built-ins (`node:*`); implementations
  may not.
- **No dependency on `rules.ts` or the `*.vocab.ts` files.** They hold
  reference definitions for tests. Implementations don't import them.
- **Header:** each file starts with a comment that has these fields:

  ```ts
  /**
   * <Name> implements <Interface>.
   *
   * How: <one or two sentences>
   * Choose when: <when to pick this implementation over others>
   * Cost: <time and allocation of the main operations>
   * AdditionalSemantics: <behavior allowed by the interface but not required by it, or "none">
   * Parts: <internal components that could become interfaces of their own, or "none">
   * Imports: <files imported>
   */
  ```

  A **script** is a file that npm runs and that implements no interface,
  such as a benchmark. Its header has these fields:

  ```ts
  /**
   * <Name> is a script: <what it is for>.
   *
   * How: <one or two sentences>
   * Run: <the npm command, and roughly how long it takes>
   * Imports: <files and Node built-ins imported>
   */
  ```

- **Measured numbers** in headers are ratios and crossover points (for
  example "10x faster inRect at 1,000 shapes; faster from about 100"), each
  naming the script that measures it. Absolute times depend on the machine
  and belong in the script's output, not in headers.

- **Done** means `npm test` passes and `npm run typecheck` reports no errors.
  Don't change the contract tests (`*.contract.ts`), the `*.test.ts` files,
  the interface files, `rules.ts` or the `*.vocab.ts` files. If a rule seems wrong or
  ambiguous, say so in your report and don't work around it.

## 1. `rectangleOps.ts`

- **Exports:** `export const rectangleOps: RectangleOps`
- **Imports:** `geometry.ts`
- **Contract:** `rectangleOps.contract.ts`

## 2. `inkStroke.ts`

- **Exports:** `export function makeInkStroke(fields: { points: readonly Point[]; thickness: number; color: Color }): InkStroke`
- **Imports:** `geometry.ts`, `color.ts`, `shape.ts`
- **Validation:** throws a `RangeError` when the fields break any `@invariant`
  of `InkStroke` or `Color`, or has a non-finite number (`rules.ts`).
- **Immutability:** the returned stroke can't be affected by later changes to
  the caller's `points` array or point objects.
- **Copying:** the stroke keeps only the declared fields: `x` and `y` of each
  point, and `r`, `g`, `b` and `a` of the color. Other properties are dropped.
- **Contract:** `inkStroke.contract.ts`

## 3. `listLocator.ts`

- **Exports:** `export class ListLocator implements ShapeLocator` with a
  constructor that takes no arguments.
- **Imports:** `geometry.ts`, `shape.ts`
- **Approach:** the simplest correct implementation. It's the reference that
  faster locators will be compared against, so clarity beats speed.
- **Contract:** `shapeLocator.contract.ts`

# Implementation specs: round 2

The rules for every implementation above still apply.

## 4. `quadTreeLocator.ts`

- **Exports:** `export class QuadTreeLocator implements ShapeLocator` with a
  constructor that takes no arguments.
- **Imports:** `geometry.ts`, `shape.ts`
- **Approach:** a quadtree over bounding boxes.
  - **Extent:** the root grows. It starts around the first shape added and
    doubles outward whenever a shape falls outside it. There's no fixed
    extent, because `ShapeLocator.any-extent` applies.
  - **Placement:** each shape is stored in exactly one node: the smallest
    cell that fully contains its bounding box.
  - **Tuning:** a cell splits when it holds more than 8 shapes, and the tree
    never goes deeper than 32 levels. These are fixed constants.
  - **Queries:** visit only cells whose region can overlap the query. Then
    give the final answer by asking each candidate shape (`intersects` or
    `contains`), so that results are exact.
  - **`removeMultiple`:** removes every listed ID first, then merges cells
    that became nearly empty, in one pass for the whole batch.
- **Decided behavior:**
  - `add` with an ID that is already indexed throws an `Error`, as
    `ListLocator` does.
  - One shape object may be indexed under several IDs.
  - An empty shape is indexed and can be removed, but no query finds it.
- **Left to the implementer:** root alignment, cell layout, depth after the
  root grows, the merge threshold, whether a single `remove` merges, and
  whether bounding boxes are cached. Describe the choices in How or
  AdditionalSemantics.
- **Contract:** `shapeLocator.contract.ts`, plus the duplicate-ID test in
  `quadTreeLocator.test.ts`.

## 5. `bench.ts`

- **Purpose:** gives real numbers for the "Choose when" and "Cost" header
  fields of both locators.
- **Imports:** `geometry.ts`, `shape.ts`, `listLocator.ts`, `quadTreeLocator.ts` and
  `inkStroke.ts`. No npm packages. Run with `npm run bench`; add that script
  to package.json.
- **Binds:** node
- **Measures:** for 100, 1,000 and 10,000 ink strokes scattered over a
  canvas, it times `ListLocator` and `QuadTreeLocator` on:
  - building the index
  - eraser-sized `inRect` queries
  - `atPoint` queries
  - a `removeMultiple` of 10% of the strokes

  Results are printed as a table.
- **Required:** a hand-written seeded random generator, so that runs repeat,
  and the median of repeated timings. Record the results in the Cost and
  Choose when fields of both `listLocator.ts` and `quadTreeLocator.ts`, as
  "Measured numbers" above describes. Editing `listLocator.ts`'s header is
  allowed for this; its code is not to change.
- **Left to the implementer:** canvas size, stroke shapes, eraser size, query
  counts, warm-up and table format.

## 6. Fix `inkStroke.ts`

The contract now tests Shape's implies-box rules with off-grid coordinates,
as computed (see the Shape and rules.ts headers). The round-1 `inkStroke.ts`
fails `Shape.contains.implies-box`. Fix it.

# Implementation specs: round 3

## 7. Bring headers up to date

The header rules changed after round 2: scripts have their own header, and
measured numbers are ratios and crossover points. Update the headers of
`bench.ts`, `listLocator.ts` and `quadTreeLocator.ts` to match. Change no
code. `bench.ts` may print whatever ratios the headers need.

# Implementation specs: round 4

The rules for every implementation above still apply. Round 4 builds the
view–model relationship: a collection and a layer that indexes its shapes
and emits change when it changes, a benchmark budget for model updates, a
circle, and a canvas view that draws circles.

## 8. `mapShapeCollection.ts`

- **Exports:** `export class MapShapeCollection<S extends Shape = Shape> implements ShapeCollection<S>`
  with a constructor that takes no arguments.
- **Imports:** `shape.ts`
- **Approach:** the simplest correct implementation that keeps these costs:
  `add`, `remove`, `get`, `size` and `compareZ` take constant time;
  `removeMultiple` takes time in proportion to the number of IDs listed;
  `forEach` in proportion to the number of shapes.
- **Left to the implementer:** how IDs are made, and how z-order is stored.
- **Contract:** `shapeCollection.contract.ts`, wired in
  `mapShapeCollection.test.ts`.

## 9. `shapeLayer.ts`

- **Exports:** `export class ShapeLayer<S extends Shape = Shape> implements Layer<S>`
  with the constructor `constructor(shapes: ShapeCollection<S>, locator: ShapeLocator)`,
  plus the edits `add(shape: S): ItemId`, `remove(id: ItemId): boolean` and
  `removeMultiple(ids: readonly ItemId[]): number`. With `S` as `Shape`
  it is a `DrawingLayer` (`shapeView.ts`), whose rules the edits follow.
  `on` and `off` come from `Emitter` (`events.ts`).
- **Imports:** `geometry.ts`, `shape.ts`, `view.ts`, `events.ts`, `shapeView.ts`
- **Approach:** a layer presenting `shapes`, with each shape as its own
  item and its own region. The edits change `shapes` and `locator`
  together, as `ShapeCollection`'s `add`, `remove` and `removeMultiple` do,
  and then emit change. Storage and z-order are delegated to `shapes`
  and queries to `locator`, using the collection's IDs as the locator's
  IDs. An item's ID is its shape's ID, converted with a cast. Both
  arguments start empty and belong to the layer from then on; anything else
  is outside the rules.
- **Decided behavior:** `add` has the locator's `in-range` requirement: a
  shape whose bounding box goes beyond ±1e300 is outside the rules, so the
  layer need not handle a locator that rejects one after the collection has
  taken it.
  A listener that throws is outside the rules too (see `events.ts`).
- **Left to the implementer:** nothing beyond the storage layout. If you
  find a choice the rules leave open, describe it under
  AdditionalSemantics.
- **Contract:** `layer.contract.ts`, wired in `shapeLayer.test.ts` over the
  test doubles in `modelkit.ts`. `shapeLayer.integration.test.ts`, which is
  not part of this task, runs it over `MapShapeCollection` with both
  `ListLocator` and `QuadTreeLocator`. The contract checks
  the layer, not the edits: that `add` puts the shape on top and the
  removals follow `ShapeCollection`'s rules is part of the approach above,
  and is checked only as far as the layer shows it.

## 10. A budget for model updates in `bench.ts`

- **Outputs:** `bench.ts`, `shapeLayer.ts` (header only)
- **Imports:** `geometry.ts`, `shape.ts`, `view.ts`, `listLocator.ts`,
  `quadTreeLocator.ts`, `inkStroke.ts`, `mapShapeCollection.ts`,
  `shapeLayer.ts`, and Node built-ins
- **Binds:** node

Each input event updates the model completely, within a small fraction of a
frame (the module rule `fraction-of-frame` in `window.ts`). Add a measurement to
`bench.ts` that checks the budget: **a pen move's model update takes under
5% of a 120 Hz frame (about 0.42 ms)**, with 10,000 strokes in the document
layer. Measure, using `ShapeLayer` over `MapShapeCollection` and
`QuadTreeLocator`:

- **Drawing:** one pen move, which appends one small stroke chunk to a
  wet-ink layer and replaces a tail layer's one shape (`remove` then
  `add`; there is no replace edit).
- **Erasing:** one eraser move, which runs an `inRect` query for the
  eraser's swept rectangle on the document layer, followed by a
  `removeMultiple` of what it hit.

The budget is per move, not per operation: time each move as a whole, and
print its median time as a fraction of the budget, marking any move that
exceeds it. Record the results in the Cost fields as "Measured numbers"
describes. Exceeding the budget isn't a test failure; report it.

- **Left to the implementer:** the shapes used for the chunks, the tail and
  the eraser, and how the 10,000 strokes are laid out, as long as they are
  stated in the output.

## 11. `circle.ts`

- **Exports:** `export function makeCircle(fields: { center: Point; radius: number; color: Color }): Circle`
- **Imports:** `geometry.ts`, `color.ts`, `shape.ts`
- **Validation:** throws a `RangeError` when the fields break
  `Circle.positive-radius` or an `@invariant` of `Color`, or have a
  non-finite number (`rules.ts`).
- **Copying:** the circle keeps its own copies of `center` (x and y only)
  and `color` (r, g, b and a only), so later changes to the caller's
  objects don't reach it.
- **Decided behavior:** `kind` is `"circle"`. `boundingBox()` returns the
  same rectangle every time.
- **Left to the implementer:** how `intersects` finds the nearest point,
  as long as an exact touch is decided by `contains`, as the rule says.
- **Contract:** `circle.contract.ts`, wired in `circle.test.ts`.

## 12. `canvasShapeView.ts`

- **Exports:** `export class CanvasShapeView implements ShapeView` with the
  constructor `constructor(scene: Scene<Shape>, context: DrawingContext, scheduler: FrameScheduler, taps: TapSource)`.
- **Hidden:** `shapeviewkit.ts`, `scenariokit.ts`
- **Imports:** `geometry.ts`, `shape.ts`, `view.ts`, `window.ts`,
  `shapeView.ts`, `canvas.ts`, `events.ts`. `canvas.ts` is a platform
  subset (see `method.md`): use only its members, with no casts. The tests
  pass a context that throws on any other member.
- **Approach:** in the constructor, add one change listener to each layer
  of the scene, add one tap listener to `taps`, and request a frame. The
  change listener requests a frame and does nothing else. The tap listener
  emits `tap` with the same point while the view is interactive and not
  disposed, and does nothing otherwise. `frame()` clears the whole canvas with one `clearRect`,
  then draws the layers bottom to top, and each layer's items in `forEach`
  order. It finds items with `forEach`, not queries, since without a
  viewport the whole scene is visible.
- **Decided behavior:**
  - Each circle is drawn as `beginPath()`, one `arc(center.x, center.y, radius, 0, 2 * Math.PI)`,
    then `fill()`, with `fillStyle` set first to
    `` `rgba(${r}, ${g}, ${b}, ${a})` `` from the circle's color. The
    recording context in `viewkit.ts` accepts only this form.
  - `viewport` always reads as the identity, `{ scale: 1, rotation: 0, tx: 0, ty: 0 }`.
    Setting it is outside the rules for now; ignore the value.
  - `interactive` starts `false`; it only gates taps.
  - `on` and `off` for the `viewport` and `tap` events follow `events.ts`;
    `viewport` is never emitted yet.
  - `dispose()` removes the listener from every layer and from `taps`.
    After it, `frame()` returns at once, including a frame requested before
    dispose, and nothing is emitted.
- **Left to the implementer:** nothing beyond the layout of the class. If
  you find a choice the rules leave open, describe it under
  AdditionalSemantics.
- **Contract:** `shapeView.contract.ts`, wired in `canvasShapeView.test.ts`
  with a `RecordingContext` from `viewkit.ts` as the surface. The same file
  runs the scenarios (`scenarios.ts`) with this view and test doubles for
  every other part.

# Round 5: the circles app

The controls around a ShapeView, as a platform-neutral model, a web
renderer, and the wiring between them (`ui.ts`, `chrome.ts`, `app.ts`). Each
task's tests use test doubles for every other part, and run the scenarios
in `scenarios.ts` through a driver (`driver.ts`); `app.integration.test.ts`
runs them with every real part once all exist.

## 13. `chromeModel.ts`

- **Exports:** `export class ChromeModel implements Chrome` with the
  constructor `constructor(layer: DrawingLayer, options: ChromeOptions, makeCircle: MakeCircle)`.
- **Hidden:** `chromekit.ts`, `scenariokit.ts`
- **Imports:** `geometry.ts`, `color.ts`, `shape.ts`, `view.ts`,
  `shapeView.ts`, `events.ts`, `ui.ts`, `chrome.ts`
- **Approach:** the state is a plain value, replaced on each change. One
  change listener on the layer sets the count from the layer's size.
  Every change of state goes through one function that compares the new
  state with the old, field by field, and emits change only if they
  differ. `dispatch` decides whether an event acts by looking its key up in
  the controls for the current state, as `present` returns them for the
  minimum size, so that enabled and role come from one place.
- **Decided behavior:**
  - Erasing finds the items at the point with `atPoint` and removes the
    one that `compareZ` puts on top.
  - Clear is one `removeMultiple` of every item's ID, in `forEach` order.
  - `state` returns a new object each time.
- **Left to the implementer:** nothing beyond the layout of the class.
- **Contract:** `chrome.contract.ts`, and the scenarios, wired in
  `chromeModel.test.ts`.

## 14. `webRenderer.ts`

- **Exports:** `export class WebRenderer implements Renderer` with the
  constructor `constructor(document: DomDocument, container: DomElement)`,
  plus `elementFor(key: string): DomElement | undefined`, which returns the
  element presenting the node with that key while it is presented, so the
  page can put the view's canvas in the view-host.
- **Hidden:** `adversaries/_webRenderer.ts`
- **Imports:** `geometry.ts`, `events.ts`, `ui.ts`, `dom.ts`. `dom.ts` is a
  platform subset (see `method.md`): use only its members, with no casts.
  The tests use a recording document that implements only those members.
- **Approach:** keep a map from key to element. A render walks the tree,
  reuses the element for a key whose role is unchanged, makes one
  otherwise, and sets the element's attributes and properties from the
  node. Elements whose keys are gone are dropped.
- **Decided behavior:** each node is presented with these elements, so
  that a browser's accessibility tree exposes the node (WAI-ARIA):

  | Role | Element | Label | State |
  |---|---|---|---|
  | group, toolbar, radio-group, view-host | `div` with `role` `group`, `toolbar`, `radiogroup` or `region` | `aria-label` | `aria-disabled="true"` when disabled, otherwise absent |
  | text | `div` with `role` `status` | `aria-label`; the value is its text content | as for `div`s above |
  | button | `button` | its text content | the `disabled` property |
  | radio | `button` with `role` `radio` | its text content | `aria-checked` `"true"` or `"false"`; the `disabled` property |
  | slider | `input` with `type` `range` and `min`, `max` and `step` attributes; the value through the `value` property | `aria-label` | the `disabled` property |

  - Every element gets `data-key` set to its node's key, and style
    `position: absolute` with `left`, `top`, `width` and `height` in `px`,
    relative to its parent node's bounds; the root's are relative to the
    container.
  - The root element is the container's only child. A container's child
    elements are its child nodes' elements in order; the child list is
    replaced only when that list of elements changes, so that a render
    that changes nothing touches no child list. A view-host's children are
    left alone: the page puts the canvas there.
  - Buttons and radios report `click`; sliders report `input`, with the
    value `Number(element.value)`. A handler looks the node up in the tree
    last rendered and emits only as the Renderer rules say.
  - `dispose()` empties the container and drops the map.
- **Left to the implementer:** nothing beyond the layout of the class.
- **Contract:** `ui.contract.ts`, the scenarios, and a test of the child
  lists, wired in `webRenderer.test.ts` with the recording document from
  `domkit.ts`.

## 15. `connectApp.ts`

- **Exports:** `export function connectApp(parts: AppParts): App`
- **Hidden:** `appkit.ts`, `scenariokit.ts`
- **Imports:** `geometry.ts`, `ui.ts`, `chrome.ts`, `shapeView.ts`, `app.ts`
- **Approach:** render the chrome's controls, make the view interactive,
  then add the three listeners. `dispose` removes them, then disposes the
  chrome, the view and the renderer, in that order.
- **Left to the implementer:** nothing beyond the layout of the code.
- **Contract:** `app.contract.ts`, and the scenarios, wired in
  `connectApp.test.ts`.

# Round 6: layout by carving, and mouse routing

Layout carves rectangles (`RectangleOps` in `geometry.ts`), and mouse input
is routed to nested regions carved the same way (`pointer.ts`). The
scenarios now tap the view through the window: the driver delivers a press
to the root region at the view's offset, the view-host's region routes it
to a tap recognizer, and the recognizer gives the view its taps.

## 16. Carving in `rectangleOps.ts`

- **Outputs:** `rectangleOps.ts`
- **Imports:** `geometry.ts`
- **Approach:** add `cut`, `splitHoriz`, `splitVert`, `inset` and `place`
  to the existing `rectangleOps`, keeping `contains` and `intersects` as
  they are. Each new operation is defined exactly by its reference
  function in `geometry.vocab.ts`; write it directly, without importing
  that file.
- **Decided behavior:** the largest-remainder method for splits, as the
  `RectangleOps` doc describes: shares rounded down, whole leftover units
  one each to the shares with the largest fractional parts (earlier first
  on ties), and any fraction of a unit to the last share.
- **Left to the implementer:** nothing beyond the layout of the code.
  Update the header's How and Cost.
- **Contract:** `rectangleOps.contract.ts`, wired in `rectangleOps.test.ts`.

## 17. `regionRouter.ts`

- **Exports:** `export class RegionRouter implements RootRegion` with the
  constructor `constructor(width: number, height: number)`.
- **Hidden:** `routerkit.ts`, `scenariokit.ts`
- **Imports:** `geometry.ts`, `events.ts`, `pointer.ts`
- **Approach:** a tree of region objects, each with its bounds, its
  parent, its children in the order added, its listeners per kind, and
  whether it was removed. The root keeps whether a press is in progress
  and which region captured it. A delivered event with no press in
  progress walks down from the root, at each level into the child that
  contains the point (half-open, as `Rectangle` says), and goes to the
  deepest region on that path with a listener for its kind.
- **Decided behavior:**
  - Child regions are instances of a class private to the file; only the
    root is exported.
  - Emitting follows `events.ts`: a snapshot of the listeners, in the order
    registered.
  - `add` and `remove` don't check their requirements.
- **Left to the implementer:** nothing beyond the layout of the code.
- **Contract:** `pointer.contract.ts`, and the scenarios, wired in
  `regionRouter.test.ts`.

## 18. `tapRecognizer.ts`

- **Exports:** `export class RegionTaps implements TapRecognizer` with the
  constructor `constructor(region: Region, slop: number)`.
- **Hidden:** `tapkit.ts`, `scenariokit.ts`
- **Imports:** `geometry.ts`, `events.ts`, `window.ts`, `pointer.ts`
- **Approach:** listen to the region's down, move and up. A down starts a
  candidate tap at its point; a move farther than the slop from it
  cancels the candidate; an up within the slop of it, with the candidate
  still standing, emits tap with the down's point.
- **Decided behavior:** the slop is in the region's units and compared
  with the straight-line distance, inclusive: exactly the slop away still
  counts. The composition root uses a slop of 4 (`tapSlop` in
  `driver.ts`).
- **Left to the implementer:** nothing beyond the layout of the class.
- **Contract:** `tapRecognizer.contract.ts`, and the scenarios, wired in
  `tapRecognizer.test.ts`.
