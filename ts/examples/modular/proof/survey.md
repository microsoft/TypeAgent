# Survey: which rules could be stated in Lean 4

## Method

I read `rules.ts`, each interface file and its vocabulary, and classified
every rule tagged `@requires`, `@ensures`, `@invariant`, `@initially`,
`@valid` or `@abstract` by what a Lean statement of it would need. Where a
rule has an expression I classified the expression; where it has only a
headline I classified what an expression would have to say. Three choices
shape the result. First, methods of the object under test that a rule does
not define (such as `s.intersects(r)` inside `ShapeLocatorQueries.inRect.exact`,
or `compareZ`) are uninterpreted function symbols, so a rule that only
relates their results is T even when the method computes on floats. Second,
vocabulary functions defined by float arithmetic (`isEmpty`, `rectContains`,
`inRange`, `distToPolyline`, `cutRect` and the like) make a rule F, because
the rule's meaning depends on their definitions. Third, listeners, targets
and shapes that rules only store and compare for equality (never inspect)
are opaque atoms with decidable equality, so registration rules are T; rules
whose point is which object comes back (`result === this`), mutation of a
caller's object, aliasing, prototypes or `this` binding are I. Under a
strict reading that treats every `===` on a function or object as identity,
`EventEmitter.on.notified`, `EventEmitter.off.removes-one`,
`EventDistributor.on.registers` and `EventDistributor.off.removes-one` would
move from T to I. F rules split further: some need only real numbers
(marked "reals"), while others hold "as actually computed" and need an
IEEE-754 model (marked "IEEE"). No file has an `@initially` rule yet.
`canvas.ts` and `dom.ts` are platform subsets with no rules.

## Counts

| File | T | F | I | X | Total | @budget | @deferred |
|---|---|---|---|---|---|---|---|
| events.ts | 4 | 0 | 2 | 0 | 6 | 0 | 0 |
| geometry.ts | 1 | 14 | 1 | 0 | 16 | 0 | 0 |
| color.ts | 1 | 1 | 0 | 0 | 2 | 0 | 0 |
| shape.ts | 17 | 16 | 2 | 0 | 35 | 0 | 0 |
| dataModel.ts | 17 | 0 | 2 | 2 | 21 | 0 | 2 |
| shapeModel.ts | 20 | 2 | 2 | 0 | 24 | 2 | 0 |
| frames.ts | 1 | 0 | 0 | 3 | 4 | 1 | 1 |
| view.ts | 3 | 0 | 0 | 5 | 8 | 0 | 2 |
| shapeView.ts | 1 | 0 | 0 | 2 | 3 | 0 | 1 |
| layout.ts | 4 | 4 | 2 | 0 | 10 | 0 | 0 |
| canvas.ts | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| dom.ts | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| **All** | **69** | **37** | **11** | **12** | **129** | **3** | **6** |

## Rules by file

### events.ts

- `EventEmitter.order`: T. Listener calls follow the registration list's order.
- `EventEmitter.snapshot`: T. Calls the registration list as it was at emit start.
- `EventEmitter.on.returns-this`: I. `result === this`: which object is returned.
- `EventEmitter.on.notified`: T. Call count equals registration count; listeners as atoms.
- `EventEmitter.off.returns-this`: I. `result === this`: which object is returned.
- `EventEmitter.off.removes-one`: T. Remove last matching element of a list; listeners as atoms.

### geometry.ts

- `Rectangle.non-negative-size`: F. Comparison of width and height with 0 (reals).
- `Viewport.positive-scale`: F. Comparison of scale with 0 (reals).
- `RectangleOps.no-mutation`: I. Arguments' objects unchanged: mutation of caller's objects.
- `RectangleOps.contains.half-open`: F. Sums and comparisons of coordinates as computed (IEEE).
- `RectangleOps.intersects.nonzero-area`: F. Sums and comparisons of coordinates as computed (IEEE).
- `RectangleOps.intersects.symmetric`: T. Boolean equality of two calls of one uninterpreted function.
- `RectangleOps.cut.non-negative`: F. Comparison of size with 0 (reals).
- `RectangleOps.cut.exact`: F. Equality with `cutRect`, defined by float arithmetic.
- `RectangleOps.splitHoriz.weights`: F. Weights compared with 0 (reals).
- `RectangleOps.splitHoriz.exact`: F. Largest-remainder apportionment over non-integer widths.
- `RectangleOps.splitVert.weights`: F. Weights compared with 0 (reals).
- `RectangleOps.splitVert.exact`: F. Largest-remainder apportionment over non-integer heights.
- `RectangleOps.inset.non-negative`: F. Comparison of d with 0 (reals).
- `RectangleOps.inset.exact`: F. Equality with `insetRect`, defined by float arithmetic.
- `RectangleOps.place.non-negative`: F. Comparison of size fields with 0 (reals).
- `RectangleOps.place.exact`: F. `placeRect` centers with rounding down.

### color.ts

- `Color.rgb-range`: T. Integers 0 to 255; a refinement type such as `Fin 256`.
- `Color.alpha-range`: F. Alpha is a fraction between 0 and 1 (reals).

### shape.ts

- `Shape.immutable`: I. Data fields, nested ones included, never mutated.
- `Shape.deterministic`: T. Equal arguments give equal results across the history.
- `Shape.boundingBox.exact`: F. Exact extents of each geometry (IEEE).
- `Shape.intersects.empty-rect`: F. `isEmpty` compares computed sums.
- `Shape.intersects.implies-box`: F. `rectIntersects` on the computed box (IEEE).
- `Shape.intersects.witness`: F. Quantifies over real points with `rectContains`.
- `Shape.intersects.only-shared`: F. Shared point of shape and rectangle in the plane.
- `Shape.contains.implies-box`: F. `rectContains` on the computed box (IEEE).
- `InkStroke.has-points`: T. Sequence length at least 1.
- `InkStroke.min-thickness`: F. Thickness compared with 1 (reals).
- `InkStroke.box`: F. `inflate(extents(...))` with halved thickness (IEEE).
- `InkStroke.round-pen`: F. Distance to a polyline, with square roots (IEEE).
- `InkStroke.exact-intersects`: F. Distance from polyline to rectangle (IEEE).
- `Circle.positive-radius`: F. Radius compared with 0 (reals).
- `Circle.box`: F. `inflate(extents(...))` by the radius (IEEE).
- `Circle.disk`: F. Distance from the center, with square roots (IEEE).
- `Circle.exact-intersects`: F. Distance from point to rectangle (IEEE).
- `ShapeLocatorQueries.no-retain`: I. No reference to `out` kept: aliasing.
- `ShapeLocatorQueries.read-only`: T. The indexed map is unchanged by queries.
- `ShapeLocatorQueries.inRect.exact`: T. Set equality with a filter by uninterpreted `intersects`.
- `ShapeLocatorQueries.inRect.once`: T. Appended suffix has no duplicates.
- `ShapeLocatorQueries.inRect.append`: T. Prefix of `out` unchanged.
- `ShapeLocatorQueries.inRect.count`: T. Result equals length difference.
- `ShapeLocatorQueries.atPoint.exact`: T. Set equality with a filter by uninterpreted `contains`.
- `ShapeLocatorQueries.atPoint.once`: T. Appended suffix has no duplicates.
- `ShapeLocatorQueries.atPoint.append`: T. Prefix of `out` unchanged.
- `ShapeLocatorQueries.atPoint.count`: T. Result equals length difference.
- `ShapeLocator.any-extent`: F. Accepts every shape whose box passes float `inRange`.
- `ShapeLocator.add.new-id`: T. ID not in the indexed map's keys.
- `ShapeLocator.add.in-range`: F. `inRange` bounds a float bounding box.
- `ShapeLocator.add.indexed`: T. Implication over uninterpreted `intersects` and a count.
- `ShapeLocator.remove.result`: T. Result is old membership of the ID.
- `ShapeLocator.remove.gone`: T. No later query reports the ID until re-added.
- `ShapeLocator.removeMultiple.count`: T. Result equals the change in map size.
- `ShapeLocator.removeMultiple.same-as-remove`: T. Equals a fold of `remove` over the IDs.

### dataModel.ts

- `Operation.seq-range`: T. Integer is -1 or non-negative.
- `Operation.client-seq-range`: T. Non-negative integer.
- `Operation.ref-seq-range`: T. Integer bounds relating refSeq to seq.
- `MessageProcessor.formed-now`: X. "Same synchronous turn" is a scheduling notion.
- `MessageProcessor.infrastructure-only`: X. Who calls is not recorded in the call history.
- `MessageProcessor.remote-seq`: T. Remote seqs strictly increase along the history.
- `MessageProcessor.unique-identity`: T. Pairs (clientId, clientSeq) unique except acknowledgments.
- `MessageProcessor.client-order`: T. Each client's remote operations sorted by clientSeq.
- `MessageProcessor.not-reentrant`: T. No enqueue or process between process start and settle.
- `MessageProcessor.items-unchanged`: I. `given` equals `args`: caller did not mutate.
- `MessageProcessor.stamps`: T. Stamped fields defined from earlier history entries.
- `MessageProcessor.sole-writer`: T. Model state changes only inside process calls.
- `MessageProcessor.passive`: T. No process call nested in other calls.
- `MessageProcessor.enqueue-defers`: T. enqueue leaves model state and events unchanged.
- `MessageProcessor.local-order`: T. Logged local operations sorted by clientSeq.
- `MessageProcessor.remote-order`: T. Logged remote operations sorted by seq.
- `MessageProcessor.once`: T. Each identity applied once; acknowledgment only sets seq.
- `MessageProcessor.atomic`: T. Change events follow the full effect, via `atEvent`.
- `MessageProcessor.converges`: T. Equal remote sequences give equal model states.
- `MessageProcessor.process.logs-each`: T. Logged multiset equals queued multiset (`sameOps`).
- `OperationSink.enqueue.own-copy`: I. Returned object is the caller's own, not shared.

### shapeModel.ts

- `ShapeCollection.size`: T. Size equals length of the visited ID list.
- `ShapeCollection.z-order`: T. ID list strictly sorted by uninterpreted `compareZ`.
- `ShapeCollection.get-agrees`: I. `this.get(i) === s`: same shape object.
- `ShapeCollection.read-only`: T. Entries unchanged and no events emitted.
- `ShapeCollection.forEach.no-change`: T. Nested calls' member names lie in a fixed list.
- `ShapeCollection.compareZ.present`: T. Both IDs in the visited list.
- `ShapeCollection.compareZ.zero-iff-same`: T. Zero exactly when the string IDs are equal.
- `ShapeCollection.compareZ.antisymmetric`: T. Sign flips when arguments swap; signs as integers.
- `ShapeCollectionWriter.notifies`: T. One change event exactly when entries differ.
- `ShapeCollectionWriter.add.new-id`: T. ID not in the visited list.
- `ShapeCollectionWriter.add.below-present`: T. Optional ID present in the list.
- `ShapeCollectionWriter.add.in-range`: F. `inRange` bounds a float bounding box.
- `ShapeCollectionWriter.add.placed`: T. List insertion before `below`, or append.
- `ShapeCollectionWriter.remove.removed`: T. List filter, and count from sizes.
- `ShapeMessageProcessor.fresh-add-id`: T. Local add IDs come from `newIds` and are unique.
- `ShapeMessageProcessor.in-range`: F. `inRange` bounds each added shape's float box.
- `ShapeMessageProcessor.new-ids`: T. Unique IDs, disjoint across clientIds.
- `ShapeMessageProcessor.read-facet`: I. Own and prototype properties; `on` returns the model.
- `ShapeMessageProcessor.add-on-z`: T. Model order sorted by `compareOrder` on integers.
- `ShapeMessageProcessor.kept`: T. Each unremoved add's shape present under its ID.
- `ShapeMessageProcessor.remove-listed`: T. Listed IDs absent from the model.
- `ShapeMessageProcessor.clear-known`: T. No present ID's add known by an applied clear.
- `ShapeMessageProcessor.ack-keeps-z`: T. Acknowledgment steps leave entries unchanged, emit nothing.
- `ShapeMessageProcessor.one-change`: T. Per-step change counts and states, from events and `atEvent`.

### frames.ts

- `frames.complete`: X. About what frames show and handler timing.
- `FrameScheduler.requestFrame.merged`: X. Display refresh ticks are outside the call history.
- `FrameScheduler.requestFrame.not-synchronous`: T. No `frame` call nested inside `requestFrame`.
- `FrameScheduler.requestFrame.next-frame`: X. Which display frame runs it; T if ticks entered the trace.

### view.ts

- `View.model-change`: X. "Draws nothing until frame()" is about rendering.
- `View.idle`: X. "Nothing it shows changes" is about rendering.
- `View.one-listener`: T. The model's registration count is exactly one.
- `View.read-only`: X. Includes "what it shows", which is rendering.
- `View.viewport.set-equal`: T. Equal value gives no frame request and no events.
- `View.dispose.idempotent`: X. Includes "changes no drawing", which is rendering.
- `View.dispose.detaches`: T. No registrations on the model; no later requests.
- `View.dispose.inert`: X. "Draws nothing" is about rendering.

### shapeView.ts

- `ShapeView.circles-only`: T. Count of kind "circle" entries equals size.
- `ShapeView.first-frame`: X. Creation and frame scheduling are outside the call history.
- `ShapeView.frame.paints`: X. Painted pixels are rendering; also needs F (distances, compositing).

### layout.ts

- `EventDistributor.within`: F. Rectangle containment over coordinates (reals).
- `EventDistributor.nested-or-disjoint`: F. Disjointness and strict containment of rectangles (reals).
- `EventDistributor.live-regions`: I. Reads each target's mutable region at call time.
- `EventDistributor.snapshot`: T. Calls the registration list as it was at start.
- `EventDistributor.on.registers`: T. Appends one registration; targets and listeners as atoms.
- `EventDistributor.off.removes-one`: T. Remove last matching triple from a list.
- `EventDistributor.distribute.innermost`: F. Innermost region containing the located point.
- `EventDistributor.distribute.only-enclosed`: F. No region contains the located point.
- `EventDistributor.distribute.reports`: T. Result is whether some listener was called.
- `EventDistributor.distribute.detached`: I. JavaScript `this` binding of a detached method.

### canvas.ts, dom.ts

No rules. Their meaning is the platform's.

## Candidates for a first Lean pilot

These T rules are the best starting points for proving properties of the
design rather than of an implementation.

1. `ShapeMessageProcessor.add-on-z`, with `Operation.seq-range`,
   `MessageProcessor.unique-identity` and `MessageProcessor.stamps`: proving
   that `compareOrder` is a strict total order on the applied adds shows the
   z-order rule can be satisfied at all, since `isStrictlySorted` needs it.
2. `ShapeMessageProcessor.kept`, `remove-listed`, `clear-known` and
   `add-on-z` together: proving they force the model to equal
   `shapesAfter(applied(this))` would show the rules determine the model
   uniquely, or would expose a gap such as a shape with no add.
3. `MessageProcessor.converges`: proving it follows from the four rules above
   plus `client-order` and `remote-seq` would make convergence a theorem of
   the shape rules instead of a separately tested claim.
4. `ShapeMessageProcessor.ack-keeps-z` refining `MessageProcessor.once`: the
   `@refines` link claims an entailment, and Lean can check it directly.
5. `ShapeCollection.z-order` with `compareZ.zero-iff-same` and
   `compareZ.antisymmetric`: a small consistency check that the three rules
   on one uninterpreted comparator can hold together.
6. `ShapeCollectionWriter.notifies` against `ShapeMessageProcessor.one-change`:
   the processor applies operations through the writer, so the two event
   rules must agree, and proving it checks the layering.
7. `ShapeLocatorQueries.inRect.append`, `once` and `count`: a warm-up on
   list suffixes, showing `count` follows from `append` and the new length.
8. `ShapeLocator.removeMultiple.same-as-remove` with `removeMultiple.count`
   and `remove.result`: proving `count` follows from the fold over `remove`
   is a short induction that exercises history-based rules.
