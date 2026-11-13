Status: done

## Choices

- **Structure (Left to the implementer):** an implicit treap for the
  z-order — a balanced binary tree whose in-order traversal is the z-order,
  balanced by a random priority per node rather than by numeric order
  keys, with subtree sizes and parent links. `add` below a shape computes
  that shape's 0-based rank by walking parent links (`O(log n)`), splits
  the treap there, and merges the new node in; `remove` merges a node's
  children into its place and refreshes ancestor sizes; `compareZ`
  subtracts the two ranks. Recorded in the header's `Cost` and `Parts`
  fields. This avoids the renumbering trap the spec warns about (repeated
  adds into the same gap), since no operation depends on numeric labels at
  all — it costs the same whatever the pattern of adds, which is why the
  header says the cost holds "whatever the pattern of adds" without a
  separate case for bursts.
- **AdditionalSemantics (Left to the implementer):** none beyond the
  interface. `add` and `remove` don't validate `@requires` (new-id,
  below-present, in-range) themselves; violating them is outside the
  rules, as the spec says, so there is no extra thrown-error behavior to
  declare.
- **remove's locator call (Left to the implementer, "Approach"):** I call
  `locator.removeMultiple` once with the present, deduplicated IDs from
  the listed array, per the Approach text's mention of the locator's own
  cost and `ShapeLocator.removeMultiple`'s note that implementations may
  reorganize once for the whole batch.
- **Listener storage (Left to the implementer):** a plain array in
  registration order, appended on `on` and spliced at the last matching
  index on `off`, with `emitChange` iterating a shallow copy taken at the
  start of the emit — this gives the `order` and `snapshot` behavior
  `events.ts` asks for without needing anything beyond the array itself.

## Notes

- `shapeModel.contract.ts`'s writer suite (which this task's test wires)
  only exercises `ShapeCollectionWriter`, `ShapeCollection` and
  `ShapeLocatorQueries`/`EventEmitter` through those; it never calls
  `ShapeMessageProcessor`, so nothing here needed to reason about seq,
  clientSeq or acknowledgments — that's a different task's concern.
- The burst case in `mapShapeCollection.test.ts` (many adds in a row, each
  directly below the same shape or below the one just added) is exactly
  the case the spec's Approach text calls out as breaking a naive
  relabel-the-gap scheme. The treap sidesteps it structurally rather than
  needing special-case handling, which is worth knowing if this gets
  reimplemented with an order-maintenance key scheme instead: that
  scheme would need the amortized relabeling algorithm the spec alludes
  to (relabeling only a small range around a filled gap), not a simple
  binary-gap halving.
