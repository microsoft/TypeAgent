Status: reviewed

Phase 3b review of task 9's distinguishing tests, drafted by the design agent; the human decided each item. A was run 2 (Sonnet), B run 1 (Opus).

## Tests

- **freedom** A local add calls the writer with `below` absent (Sonnet) or `undefined` (Opus): the same effect.
- **freedom** The queued local remove shares the caller's `ids` array (Sonnet) or a copy (Opus). `own-copy` covers the operation `enqueue` returns, and operations are never changed, so nothing can tell except identity.
- **freedom** The same for the remote queue.
- **freedom** A property outside the operation's type survives into the stamped operation (Sonnet) or is dropped (Opus). The type keeps callers from adding one except by widening; the rules don't say what happens to it.
- **freedom** A clear lists the IDs it removes in a different order: the writer treats the list as a set.
- **contract gap** **requeue: 9** Opus's read facet is a class instance that keeps the writer in an own property, so whoever holds `model` can reach `add` and `remove` through `model.writer`. Task 9's text forbids it ("an object with only `ShapeCollection`'s members ... never the writer itself"), but `ShapeMessageProcessor.read-facet`'s expression checks only that `model` has no `add` or `remove`. Made: the rule and its contract test check that every own property of `model`, and every property along its prototype chain short of `Object.prototype`, is a `ShapeCollection` member (`onlyMembers` in `shapeModel.vocab.ts`), with the adversary `ShapeMessageProcessor.read-facet--facet-keeps-writer`. Task 9 (Opus, run 1) goes back for another attempt.
- **contract gap** **requeue: 9.2, 10** Sonnet's clear copies and filters every present shape, so a clear that removes nothing costs time in proportion to the shapes present. `ShapeMessageProcessor.log-amortized` allows only "time in proportion to the shapes a clear removes", but `bench.ts` measures no clear. Made: task 10 adds a pattern, remote clears that remove nothing while all the shapes stay, and goes back for another attempt; 9.2 (Sonnet) goes back for another attempt. The reference walks every shape too, but it isn't held to the budgets.

## Notes

- **nothing** The missing copies also show when an enqueued array is changed, which "operations are never changed" rules out: the identity tests already show it.
- **nothing** Own properties against a prototype in the facet: the same difference as the facet test.
- **nothing** The two drain the queues differently, which only reentrancy could show, and `not-reentrant` forbids it.

The report's paragraphs, outside its bullets: a spy writer is a valid way to observe the processor; every test keeps the processor's requirements, including `client-order`; the two agree on the model for every valid sequence tried; and the scratch copies' `node_modules`, which kept `testkit.ts`'s fast-check import from loading there, is fixed in `task.ts`.
