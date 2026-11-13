Status: reviewed

Phase 3b review of task 8's distinguishing tests, drafted by the design agent; the human decided each item. A was run 1 (Opus, AVL), B run 2 (Sonnet, treap).

## Tests

- **freedom** The treap draws a random number per `add` and the AVL tree draws none. Both are allowed (`log-amortized` names a treap's priorities), and the test sees it only through the `Math` global, not the collection's interface.

## Notes

- **nothing** `compareZ`'s exact values agree, not just their signs.
- **nothing** The z-order and size agree after long random runs, bursts and chains.
- **nothing** The locator traffic agrees, call for call.
- **nothing** What the locator sees from inside `add` and `removeMultiple` agrees.
- **nothing** The change event agrees in every case tried.
- **nothing** One shape under two IDs, and shapes at the edge of `in-range`, agree.
- **nothing** Sonnet's `on` and `off` ignore the event name and keep one list. No typed call can tell, since `ShapeCollectionEvents` has one event. It would become a fault if a second event were added; the event-emitter contract would then need a second event name to catch it.
- **nothing** AVL is worst-case logarithmic and the treap is expected logarithmic (allowed); the treap also recurses, so its stack depth follows the tree's height.
- **nothing** Nothing shows which structure holds the z-order.

The report's paragraphs, outside its bullets: the `@requires` differences (Opus throws, Sonnet doesn't check) can't be shown by a valid test, as the 2b review of 8.2 predicted; the reference adapter indexes a shape in the locator before adding it to the z-order, while both runs index it after, and no rule fixes that order; and the scratch copies' `node_modules` is fixed in `task.ts`.
