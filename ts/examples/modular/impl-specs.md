# Implementation specs: round 1

Each implementation satisfies an interface in the interface files
(`events.ts`, `geometry.ts`, `color.ts`, `shape.ts`, `dataModel.ts`,
`shapeModel.ts`, `frames.ts`, `view.ts`, `shapeView.ts` and `layout.ts`),
including
every rule (`@requires`, `@ensures`, `@invariant`, `@valid`, `@abstract`,
`@budget`, `@deferred`) written there. `@budget` and `@deferred` rules bind
the implementation like any other: a budget is measured instead of tested,
and a deferred rule will be tested as its `how:` line says once its
`when:` holds. Rule expressions use the vocabulary in `rules.ts` and the
`*.vocab.ts` files.

## Rules for every implementation

`task.ts` turns each numbered section with an **Imports** field into a
generation task, and enforces these rules rather than only stating them. A section's fields: **Outputs** (default: the
file in its heading; "(header only)" means only the leading comment may
change), **Imports** (the only files the outputs may import), and
**Binds** (`node` or `dom`; default neither, so only the ES2022 library),
**Hidden** (files the task must not read, such as the reference
implementation of its own part; `task.ts` refuses to make a workspace
whose reads include one), and **Held** (why the task may not run yet,
such as a round the human hasn't reviewed; `task.ts` leaves it out of the
waves and refuses to make it, and only the human removes the field).

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
  the interface files, `rules.ts` or the `*.vocab.ts` files.
- **Decide only what the spec leaves open.** That is anything under "Left
  to the implementer", and details no rule or spec text addresses. Never
  decide what the spec means: when a rule or spec text can be read more
  than one way, conflicts with another, or leaves out something the
  implementation must get right, stop, list every such question you can
  find in the task, and report them instead of finishing. `TASK.md` gives
  the report's form.

## 1. `rectangleOps.ts`

- **Exports:** `export const rectangleOps: RectangleOps`
- **Imports:** `geometry.ts`
- **Contract:** `rectangleOps.contract.ts`

## 2. `inkStroke.ts`

- **Exports:** `export function makeInkStroke(fields: { points: readonly Point[]; thickness: number; color: Color }): InkStroke`
- **Imports:** `geometry.ts`, `color.ts`, `shape.ts`
- **Validation:** throws a `RangeError` when the fields break any `@valid` rule
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
model–view relationship: a shape collection writer that indexes its
shapes, the processor that is the only thing that changes it, a benchmark
budget for model updates, a circle, and a canvas view that draws circles.

## 8. `mapShapeCollection.ts`

- **Exports:** `export class MapShapeCollection<S extends Shape = Shape> implements ShapeCollectionWriter<S>`
  with the constructor `constructor(locator: ShapeLocator)`.
- **Hidden:** `shapewriterkit.ts`, `adversaries/_shapeModel.ts`
- **Imports:** `geometry.ts`, `shape.ts`, `shapeModel.ts`, `events.ts`
- **Approach:** keep the shapes in a map by ID, and their z-order in a
  structure that adds directly below a present shape in amortized
  logarithmic time whatever the pattern of adds: a balanced tree in
  z-order with subtree sizes and parent links (as a merge tree is), or
  order-maintenance keys that relabel only a small range around a gap
  that has filled. Renumbering every key when a gap fills breaks the
  cost: remote adds arriving under one pending local add fill the same
  gap again and again. Index each present shape in `locator` under its
  ID, and answer `inRect` and `atPoint` with the locator's queries. The
  locator starts empty and belongs to the collection from then on;
  anything else is outside the rules.
- **Costs** (`ShapeCollectionWriter.log-amortized`): `get` and `size` take
  constant time; `add` and `compareZ` amortized logarithmic time;
  `remove` amortized logarithmic time per ID listed, plus the locator's;
  `forEach` time in proportion to the number of shapes.
- **Decided behavior:**
  - `add` has the locator's `in-range` requirement, as its own rule says,
    so it need not handle a locator that rejects a shape.
  - `on` and `off` follow `events.ts`; change is emitted as
    `ShapeCollectionWriter.notifies` says. A listener that throws is
    outside the rules.
- **Left to the implementer:** which of those structures, or another,
  as long as the costs hold.
- **Contract:** `shapeModel.contract.ts` (`shapeCollectionWriterContract`,
  which also runs `eventEmitter.contract.ts` on the change event), wired in
  `mapShapeCollection.test.ts` over `ListIndex` (`modelkit.ts`).
  `shapeModel.integration.test.ts`, which is not part of this task, runs it
  over `ListLocator` and `QuadTreeLocator`.

## 9. `shapeProcessor.ts`

- **Exports:** `export class ShapeProcessor implements ShapeMessageProcessor`
  with the constructor `constructor(clientId: string, writer: ShapeCollectionWriter)`.
- **Hidden:** `shapeprocessorkit.ts`, `scenariokit.ts`, `adversaries/_shapeModel.ts`
- **Imports:** `geometry.ts`, `shape.ts`, `dataModel.ts`, `shapeModel.ts`, `events.ts`
- **Approach:**
  - `local.enqueue` stamps the operation (`MessageProcessor.stamps`),
    queues it, and returns a copy. `remote.enqueue` queues the operation and
    returns a copy of it. Both follow `OperationSink.enqueue.own-copy`, and
    neither applies anything.
  - `process` applies what is queued, through the writer, and is the only
    thing that calls the writer's `add` and `remove`.
  - A local add goes on top. A remote add goes directly below the lowest
    shape of a pending local add, or on top if none is pending: the order
    `ShapeMessageProcessor` describes comes to this. Keep track of that
    lowest pending shape rather than searching for it. A remove calls the
    writer's `remove` once with the listed IDs. A clear removes, in one
    call, the present shapes whose adds it knew.
  - The acknowledgment of a local operation records its seq in the
    processor's own state, and applies nothing. Operations are never
    changed.
  - `model` is a read-only facet of the writer: an object with only
    `ShapeCollection`'s members, delegating to the writer. Its `on` and
    `off` return the facet itself, not what the writer's return
    (`ShapeMessageProcessor.read-facet`). Never the writer itself.
  - The writer starts empty and belongs to the processor from then on.
- **Decided behavior:**
  - `newShapeId` returns `` `${clientId}#${n}` ``, with n counting from 0
    on each processor. The counter follows the last `#`, so IDs from
    different clientIds never collide, whatever characters they contain.
  - `process` never schedules itself, and nothing else in the class does
    (`MessageProcessor.passive`).
  - `process` applies the local queue first, then the remote queue, and
    repeats until both are empty. So a local operation is always applied
    before its acknowledgment, which can only be enqueued after it.
- **Costs** (`ShapeMessageProcessor.log-amortized`): `process` takes
  amortized logarithmic time per operation, plus time in proportion to
  the shapes a clear removes; `local.enqueue`, `remote.enqueue` and
  `newShapeId` take constant time, apart from copying the operation.
- **Left to the implementer:** how pending operations and each shape's add
  are kept.
- **Contract:** `shapeModel.contract.ts` (`shapeMessageProcessorContract`,
  which also runs `messageProcessor.contract.ts`), wired in
  `shapeProcessor.test.ts` over `RefShapeWriter` (`shapewriterkit.ts`). The
  same file runs the scenarios (`scenarios.ts`) with this processor and
  test doubles for every other part. `shapeModel.integration.test.ts`, which
  is not part of this task, runs it over `MapShapeCollection`.

## 10. A budget for model updates in `bench.ts`

- **Outputs:** `bench.ts`, `mapShapeCollection.ts` (header only), `shapeProcessor.ts` (header only)
- **Imports:** `geometry.ts`, `shape.ts`, `dataModel.ts`, `shapeModel.ts`,
  `listLocator.ts`, `quadTreeLocator.ts`, `inkStroke.ts`,
  `mapShapeCollection.ts`, `shapeProcessor.ts`, and Node built-ins
- **Binds:** node

Each input event's operations are sent, and processed, within a small
fraction of a frame (the `@budget` rule `frames.fraction-of-frame` in
`frames.ts`). Add a measurement to `bench.ts` that checks the budget:
**sending and processing a move's operations takes under 5% of a 120 Hz
frame (about 0.42 ms)**, with 10,000 strokes in the model. Label the
printed results with the rule's ID, `frames.fraction-of-frame`;
`npm run catalog` looks for that ID in `bench.ts` to show the budget as
measured.

Measure with a `ShapeProcessor` over a `MapShapeCollection` over a
`QuadTreeLocator`, and a stand-in for the message infrastructure written
in `bench.ts`: it sends with `local.enqueue`, gives the operation that
returns the next seq and enqueues it on `remote` as its acknowledgment, and
calls `process`. Time, as a whole:

- **Finishing a stroke:** sending an add of one stroke, then processing
  until the add and its acknowledgment are applied.
- **An eraser move:** an `inRect` query on the model for the eraser's swept
  rectangle, sending a remove of what it hit, then processing until the
  remove and its acknowledgment are applied.

Ink still being drawn is the view's alone (`view.ts`), so a pen move
before the stroke ends sends nothing and isn't measured.

Print each measurement's median time as a fraction of the budget, marking
any that exceeds it. Record the results in the Cost fields as "Measured
numbers" describes. Exceeding the frame budget isn't a test failure;
report it.

Also measure the two `log-amortized` budgets in `shapeModel.ts`, labeled
with their IDs, `ShapeCollectionWriter.log-amortized` and
`ShapeMessageProcessor.log-amortized`. For each pattern below, time a
batch of operations on a `MapShapeCollection` (over `QuadTreeLocator`)
holding 1,000 shapes, and on one holding 100,000, and print the time per
operation at 100,000 divided by the time at 1,000:

- adds, each directly below the same shape;
- adds, each directly below the one added before it;
- adds at the bottom;
- adds below random present shapes;
- removes of random present shapes, mixed with adds;
- `compareZ` on random pairs;
- through a `ShapeProcessor` with the stand-in infrastructure: remote
  adds arriving while one local add is pending, then local adds.

Logarithmic growth gives a ratio of about 2, and linear growth about 100.
Unlike the frame budget, a ratio above 4 is a failure: print it and make
`bench.ts` exit with a nonzero status.

`ShapeId` is now a string (`shape.ts`); the locator measurements must use
string IDs too, and otherwise stay as they are.

- **Left to the implementer:** the shapes used for the strokes and the
  eraser, and how the 10,000 strokes are laid out, as long as they are
  stated in the output.

## 11. `circle.ts`

- **Exports:** `export function makeCircle(fields: { center: Point; radius: number; color: Color }): Circle`
- **Imports:** `geometry.ts`, `color.ts`, `shape.ts`
- **Validation:** throws a `RangeError` when the fields break
  `Circle.positive-radius` or a `@valid` rule of `Color`, or have a
  non-finite number (`rules.ts`).
- **Copying:** the circle keeps its own copies of `center` (x and y only)
  and `color` (r, g, b and a only), so later changes to the caller's
  objects don't reach it.
- **Decided behavior:** `kind` is `"circle"`. `boundingBox()` returns the
  same object every time.
- **Left to the implementer:** how `intersects` finds the nearest point,
  as long as an exact touch is decided by `contains`, as the rule says.
- **Contract:** `circle.contract.ts`, wired in `circle.test.ts`.

## 12. `canvasShapeView.ts`

- **Exports:** `export class CanvasShapeView implements ShapeView` with the
  constructor `constructor(model: ShapeCollection, context: DrawingContext, scheduler: FrameScheduler)`.
- **Hidden:** `shapeviewkit.ts`, `scenariokit.ts`, `adversaries/_view.ts`
- **Imports:** `geometry.ts`, `shape.ts`, `shapeModel.ts`, `view.ts`,
  `frames.ts`, `shapeView.ts`, `canvas.ts`, `events.ts`. `canvas.ts` is a
  platform subset: the members of a browser canvas that this view may
  use. Use only the members it declares, with no casts. The tests pass a
  context that throws on any other member.
- **Approach:** in the constructor, add one change listener to the model,
  and request a frame. The change listener requests a frame and does
  nothing else. `frame()` clears the whole canvas with one `clearRect`,
  then draws the model's shapes in `forEach` order, bottom to top. It
  finds shapes with `forEach`, not queries, since without a viewport the
  whole model is visible.
- **Decided behavior:**
  - Each circle is drawn as `beginPath()`, one `arc(center.x, center.y, radius, 0, 2 * Math.PI)`,
    then `fill()`, with `fillStyle` set first to
    `` `rgba(${r}, ${g}, ${b}, ${a})` `` from the circle's color. The
    recording context in `viewkit.ts` accepts only this form.
  - `viewport` always reads as the identity, `{ scale: 1, rotation: 0, tx: 0, ty: 0 }`.
    Setting it to the identity does nothing (`View.viewport.set-equal`);
    setting another value is outside the rules for now, so ignore it too.
  - `on` and `off` for the `viewport` event follow `events.ts`;
    `viewport` is never emitted yet.
  - `dispose()` removes the listener from the model. After it, `frame()`
    returns at once, including a frame requested before dispose, and
    nothing is emitted.
- **Left to the implementer:** nothing beyond the layout of the class. If
  you find a choice the rules leave open, describe it under
  AdditionalSemantics.
- **Contract:** `shapeView.contract.ts`, wired in `canvasShapeView.test.ts`
  with a `RecordingContext` from `viewkit.ts` as the surface. The same file
  runs the scenarios (`scenarios.ts`) with this view and test doubles for
  every other part.

# Round 5: the circles app

The app's controls are each platform's own, and its behavior is the
scenarios in `scenarios.ts`: what the user does, and what the drawing then
shows. Each platform writes a fixture (`AppFixture` in
`scenario.contract.ts`) that does the scenarios' actions with its controls.
On the test platform (`driver.ts`) the controls are methods, and the
reference app (`circleskit.ts`) is a controller that gets taps from an
EventDistributor with the view's surface as their target. A controller
holds the model's read side and a `LocalSend` (`dataModel.ts`); the
fixture is the message infrastructure, and the only caller of `process`. No task yet: the
web app waits until the DOM subset (`dom.ts`) is revisited. The earlier
chrome, renderer and wiring tasks (13 to 15) were removed with `chrome.ts`,
`ui.ts` and `app.ts`.

# Round 6: layout and event distribution

Layout carves rectangles (`RectangleOps` in `geometry.ts`); a parent places
layout objects (`layout.ts`) with them. An EventDistributor passes each of
a platform's positional events to the innermost target registered for it.
The router and tap recognizer tasks (17 and 18) were removed with
`pointer.ts`.

## 16. Carving in `rectangleOps.ts`

- **Held:** until round 6 is reviewed and has had phase 1b
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

## 19. `rectDistributor.ts`

- **Held:** until round 6 is reviewed and has had phase 1b
- **Exports:** `export class RectDistributor<M> implements EventDistributor<M>`
  with the constructor `constructor(region: Rectangle, locate: (event: M[keyof M]) => Point)`.
- **Hidden:** `distributorkit.ts`, `scenariokit.ts`, `adversaries/_distributor.ts`
- **Imports:** `geometry.ts`, `layout.ts`
- **Approach:** keep the registrations in a list, in the order made. On
  `distribute`, take the registrations for the event's name as they are
  at the start, find the targets among them, other than `except`, whose
  regions contain the event's point (half-open, as `Rectangle` says), pick
  the one whose region lies within all the others', and call its
  listeners in registration order.
- **Decided behavior:**
  - `distribute` is a property holding an arrow function, so that it works
    detached (`EventDistributor.distribute.detached`).
  - `off` searches from the most recent registration.
  - The requirements (`within`, `nested-or-disjoint`) aren't checked.
- **Left to the implementer:** nothing beyond the layout of the class.
- **Contract:** `eventDistributor.contract.ts`, wired in
  `rectDistributor.test.ts`.
