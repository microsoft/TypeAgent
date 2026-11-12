Status: done

## Choices

- **The z-order structure: an AVL tree whose nodes are the map's values**, with
  subtree sizes and parent links. The spec left the choice open ("Left to the
  implementer: which of those structures, or another, as long as the costs
  hold"). AVL insert and delete are logarithmic in the worst case, not only
  amortized, and nothing about them depends on the pattern of adds, so the long
  runs of adds directly below one shape (the contract's bursts) cost the same as
  any other adds. Recorded in the header's **How** and **Cost**.
- **`compareZ` as the difference of two ranks**, where a node's rank is the
  number of shapes below it, computed from the subtree sizes on the path to the
  root through the parent links. That makes it logarithmic and gives
  `zero-iff-same` and `antisymmetric` for free, since distinct nodes have
  distinct ranks. Recorded in the header's **How** and **Cost**.
- **One node object per shape, shared between the map and the tree.** `get` is
  one map lookup and `size` is the map's size, both constant time; a removal
  relinks the successor's node object into the removed node's place rather than
  copying fields between nodes, so the IDs the map holds keep pointing at the
  right nodes. Data layout, so recorded only as the header's **Cost** and
  **Parts**.
- **Breaking a `@requires` rule throws an `Error`**: `add` with an ID that is
  already present or a `below` that is not, and `compareZ` with an ID that is
  not present. `rules.ts` says such a call is outside the rules and that an
  implementation "may throw, and declares what it does under
  AdditionalSemantics"; throwing before anything is written keeps the collection
  and the locator consistent. Recorded in the header's **AdditionalSemantics**.
- **`remove` calls `locator.removeMultiple` once, with the IDs it actually
  removed, and not at all when it removed nothing.** `ShapeLocator.removeMultiple`
  ignores repeats and absent IDs, so passing `listed` straight through would also
  be correct; passing the removed IDs keeps the locator's share of the cost
  proportional to what changed, and skipping the call when nothing changed goes
  with emitting no change event. Recorded in the header's **AdditionalSemantics**.
- **The order of the steps inside a changing call**: tree, then map, then
  locator, then emit. `ShapeCollectionWriter.notifies` fixes only that the emit
  comes last, after the change is complete; the rest is free, and this order
  means the locator is never touched for a call that throws. Recorded in the
  header's **How** (the locator is the collection's) and
  **AdditionalSemantics**.
- **The listener registry: a map from event name to an array of registrations.**
  `on` pushes, `off` splices the last matching entry, and an emit iterates a copy
  of the array. `events.ts` fixes the behavior (one registration per `on`, `off`
  removes the most recent, an emit uses the snapshot it started with); the layout
  is mine. Recorded in the header's **Parts**.
- **`forEach` walks the tree with an explicit stack**, not recursion, so a deep
  tree can't exhaust the call stack. Its allocation is in the header's **Cost**.

## Notes

- The contract's bursts are the decisive input: `writerOps` generates runs of 64
  to 100 adds that all go directly below one shape, or each below the shape just
  added, and the spec calls out exactly this case ("remote adds arriving under
  one pending local add fill the same gap again and again"). With a balanced tree
  the hundredth add of a burst is the same work as any other add, so no gap or
  relabelling budget enters the implementation at all.
- `ShapeCollection`'s `read-only` rule is about the shapes, and the contract
  checks it as `deepEqual(entries(c), list)` with no change event. A structure
  that reorganizes itself while being read, such as a splay tree, would pass that
  check while still mutating during `compareZ`, and nothing here says whether
  that is allowed. The question doesn't arise for an AVL tree, whose reads touch
  nothing, which is one more reason I chose it over an amortized self-adjusting
  structure.
- `compareZ`'s `present` rule leaves absent IDs unspecified, and the contract
  only ever compares IDs that `forEach` just visited, so throwing costs nothing
  there. `ShapeCollection.get-agrees`, by contrast, does probe absent and removed
  IDs, so `get` must return `undefined` for them rather than throw; the two
  members differ, and the rules do say so, but it is easy to miss.
- `ListIndex.add` throws when an ID is already indexed, so `add`'s own `new-id`
  check has to come before the locator call. Nothing required the checks in that
  order, but with the locator as the only other holder of IDs it is the only
  order that leaves the two in step.
- `ShapeCollectionEvents` has one event, so the internal listener type is
  `() => void`; `on` and `off` must still carry `events.ts`'s generic signature,
  and TypeScript can't see that `ShapeCollectionEvents[E]` is `[]` for the only
  `E` the constraint admits. One cast at each registration bridges that, which is
  why the two casts are there and why they are safe.
