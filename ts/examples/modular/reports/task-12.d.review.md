Status: reviewed

Phase 3b review of task 12's distinguishing tests, drafted by the design agent; the human decided each item. A was run 2 (Sonnet), B run 1 (Opus).

## Tests

- **freedom** `fillStyle` set before `beginPath` (Opus, the reference) or between `arc` and `fill` (Sonnet). The decided behavior, "`beginPath()`, one `arc(...)`, then `fill()`, with `fillStyle` set first", allows both readings, and both paint the same pixels. Spec fix (made): task 12 says "with `fillStyle` set, at any point before that `fill()`", which states what matters and settles the ambiguity without requiring either order.
- **freedom** `viewport` returns one shared identity object (Opus) or a new one each read (Sonnet): predicted by the 2b review of 12.2. The rules constrain the value, not the object.
- **freedom** A second `dispose` calls the model's `off` again (Sonnet) or returns at once (Opus). The extra `off` changes no registration, so `View.dispose.idempotent` holds either way, as the contract checks it.

## Notes

- **nothing** Everything else it could reach through the interfaces agrees.
- **nothing** The shared identity object is also shared between views: the same freedom.
- **spec fix** `npm run check` in the workspace linked its scratch copies to a `node_modules` that doesn't exist, so `tsc` failed for all three variants. Fixed in `task.ts`: the scratch copies use the workspace's own link. The results are unaffected: collect, run from the repo, compiled and ran all three.
