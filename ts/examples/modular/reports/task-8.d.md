Status: done

## Tests

- **add draws no random number** A keeps its z-order in an AVL tree, balanced by
  the shape of the tree alone, and draws no random numbers at all; B keeps its
  z-order in a treap and draws one priority from `Math.random` per `add`, so
  twenty-one valid adds draw twenty-one numbers. The test counts the draws
  while a fixed run of adds goes through, handing back the real random number
  each time, so neither implementation behaves differently for being watched.
  Nothing in the spec decides this: `ShapeCollectionWriter.log-amortized`
  names a treap's priorities as an allowed source of randomness ("expected
  over the implementation's own random choices, as in a treap"), and the
  Approach and "Left to the implementer" leave the choice of structure open,
  so both are within the rules. Said plainly, because it matters for how much
  this test is worth: it is the one difference I could show without breaking a
  `@requires`, and it is observed through the `Math` global, not through the
  collection's interface. The collection reports nothing different either way.

## Notes

**What I probed and found identical.** I read both implementations, then wrote
27 probes over the interfaces, each a fixed case, and ran them as A, as B and
as the reference. Every one agreed on A and B exactly; they are not in the
final file because a test that passes on both is not allowed there. They
covered:

- `compareZ`'s exact returned value, not just its sign, for adds on top, adds
  below a present shape, chains and bursts, and for a shape against itself:
  both return the difference of the two shapes' positions, bottom-up, exactly.
- z-order and `size` after 4,000 random adds and removes against a list kept
  beside the collection; after 8,000 adds all directly below one shape; after
  8,000 adds each below the one added before it; after removing two thirds of
  a 1,000-shape collection; and after removing a whole 3,000-shape collection
  in one call with repeats and an absent ID.
- the locator traffic, through a locator that logs every call: both index each
  added shape once under its ID, call `removeMultiple` exactly once per
  `remove` that removes something, pass it the removed IDs once each in the
  order `remove` listed them, skip it entirely when nothing is removed, never
  call single `remove`, and pass queries and their `out` arrays straight
  through with the count.
- what the locator can see of the collection from inside `add` and
  `removeMultiple`: both have already finished the z-order change, so `get`,
  `size`, `forEach`, `compareZ`, `inRect` and `atPoint` all show it.
- the change event: one per changing call and none otherwise; the listeners
  of the moment the emit started, in registration order, so that one added
  during an emit isn't called and one removed during it still is; a listener
  registered twice called twice and `off` removing one registration; `off`
  with nothing registered; 1,000 listeners in order; listeners called with no
  arguments; `on` and `off` returning the collection; a listener seeing the
  finished collection; and a listener that adds or removes during the event
  (both nest the same way).
- one shape object added under two IDs, and shapes at the edge of `add`'s
  `in-range` limit (a box from -1e300 to 1e300, and an empty box at 1e300).

**Differences I found but did not test, because a test for them would have to
break a `@requires`.** Both guard the same three call sites, differently:
`add` with an ID that is present, `add` with a `below` that is not present,
and `compareZ` with an ID that is not present. A checks each and throws an
`Error` naming the offending ID, and its header promises this
("AdditionalSemantics: a call that breaks a `@requires` rule throws an Error
rather than corrupting the collection"). B checks nothing: the two latter
calls reach `undefined` and fail with a `TypeError` from inside its treap,
and `add` with a present ID quietly puts a second node in the z-order under
that ID and overwrites the map entry, leaving a shape `forEach` visits that
`get` can't reach. The spec puts all three outside the rules, so this is
freedom, and the task rules out showing it; I note it because the two
implementations are as far apart here as they are close everywhere else.

**Differences that are real but invisible through this interface.**

- `on` and `off`: A keeps one list per event name; B ignores the `event`
  argument and keeps a single list. `ShapeCollectionEvents` has exactly one
  event (`change`), so no typed call can tell them apart. If a second event
  were ever added to that map, B would call `change`'s listeners for it, and
  `off` for either name would remove a registration of the other.
- The cost guarantee behind `log-amortized`: A's AVL tree is logarithmic in
  the worst case for every pattern of adds, while B's treap is logarithmic in
  expectation over its own priorities, which is what the rule allows. B's
  `merge` and `split` recurse, so its stack depth is proportional to the
  tree's height, where A's operations are all iterative. Both hold the budget;
  the difference is in what a bad run could cost, which no rule and no test
  here reaches.
- Nothing is observable about which structure holds the z-order: the position
  differences `compareZ` returns are exact in both, so even the magnitudes,
  which the rules leave open ("Negative if a is below b, positive if above"),
  match.

**One thing the reference does that neither implementation does.** The
reference `mapShapeCollection.ts` calls `locator.add` *before* it puts the
shape in the z-order; A and B both index the shape after. A locator can see
this, since it is called in the middle: two of my probes (kept out of the
final file, since they tell the reference from both implementations rather
than A from B) failed only on the reference. No rule fixes this order —
`ShapeCollectionWriter.notifies` constrains only the change event, and
`ShapeLocator.add`'s rules say nothing about the caller's own state — so the
reference is within the rules too. It is worth knowing that the reference
sits on one side of a choice both generated runs made the other way.

**The workspace's own `npm run check`.** It always reports three compile
failures ("Cannot find type definition file for 'node'", "Unknown compiler
option 'erasableSyntaxOnly'"), one per variant, whatever the test file holds.
`runVariants` links each scratch copy's `node_modules` to
`join(repo, "node_modules")`, and `repo` is the directory of the running
`task.ts`, which inside a workspace is `<workspace>/.task`, where there is no
`node_modules`; so the link dangles, the scratch copies compile with some
other `tsc` and without `@types/node`. Collecting from the repo passes a real
`repo`, so this should not appear there. `npm run typecheck`, which runs in
the workspace itself, passes. The same dangling link means a test file in a
workspace may not import anything from `node_modules` if it is to run at all:
my first attempt imported `TestBox` from `testkit.ts`, which imports
`fast-check`, and every test failed to load as A, as B and as the reference.
That is why this file defines its own shape and uses no `fast-check`.
