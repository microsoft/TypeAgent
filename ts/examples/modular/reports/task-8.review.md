Status: reviewed

Phase 2b review of task 8 (`mapShapeCollection.ts`), drafted by the design agent; the human decided each item.

## Choices

- **open** An AVL tree with subtree sizes and parent links: one of the structures the spec allows, logarithmic in the worst case.
- **open** `compareZ` as the difference of two ranks.
- **open** One node object per shape, shared by the map and the tree.
- **open** Throwing on a call that breaks a `@requires`, declared under AdditionalSemantics as `rules.ts` asks.
- **open** `remove` passes only the removed IDs to the locator, and skips it when nothing was removed.
- **open** The order of steps inside a changing call, with the emit last as `notifies` requires.
- **open** The listener registry's layout: `events.ts` fixes the behavior.
- **open** `forEach` with an explicit stack.

## Notes

- **nothing** The bursts decided the structure: as intended.
- **decision** Whether `ShapeCollection.read-only` forbids changing internal state while reading, as a splay tree would during `compareZ`. Decided by the human: no. The rule is about the shapes, and the costs, not the rule, are what rule out a self-adjusting structure that reorganizes on reads.
- **nothing** `compareZ` may throw on an absent ID, but `get` must return undefined: the rules say so.
- **nothing** Checking `new-id` before calling the locator: an ordering inside the implementation.
- **nothing** Two casts at registration: a TypeScript limit with generic event maps.
