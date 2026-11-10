# Current state

As of 2026-11-09. The history of each round is under "Status" in
`moduleTooling.md`; this file says where things stand now and what has been
deferred.

## Where things stand

- **Phase 1 is done for rounds 4, 5 and 6**, waiting for the human's review:
  - round 4: the view–model relationship;
  - round 5: the circles app (`ui.ts`, `chrome.ts`, `app.ts`, `dom.ts`);
  - round 6: layout by carving and mouse routing (`pointer.ts`).
- **Phase 1b has not run on rounds 5 and 6.** The human deferred it until
  they've discussed the role of the device context (the platform subsets).
  When it runs, it challenges the blueprint only; `canvas.ts` and `dom.ts`
  are out of scope.
- **Rule tags were revised** after a review of how rules are specified
  (see round 4 under "Status" in `moduleTooling.md`). `@invariant` now
  means a state invariant only; the new `@valid` marks which values are
  legal members of a type. The two `AppParts` rules became `@requires` on
  `App`.
- **Coordinate spaces are named.** `geometry.ts` lists them (canonical,
  window, region-local, view); each use of Point or Rectangle says which.
  New rule `View.tap-coordinates` (`@requires`) states what the tap path
  relied on.
- **`@unchecked` was reviewed.** Five of the ten are now tested: the
  three `FrameScheduler` rules (`frameScheduler.contract.ts`, run on
  `ManualScheduler`), `View.viewport.set-equal`, and `window.complete`
  (checked by the driver after every action). The two `Shape` rules each
  shape type refines are now `@abstract`: `InkStroke` and `Circle` name
  their refining rules with `@refines`, and the catalog refuses to write
  if an extending interface lacks one or its rule isn't tested.
  `window.fraction-of-frame` is now `@budget`, measured by `bench.ts`
  rather than tested; the catalog shows it as not measured yet until task
  10 adds the measurement, labeled with the rule's ID. The two viewport
  rules waiting for a non-identity viewport are now `@deferred`, each with
  a `when:` and a `how:` line; the catalog refuses to write if either is
  missing, or once a test has the rule's ID. The `@unchecked` tag is gone; every rule is tested, refined, measured or deferred, and the catalog refuses unknown tags.
  The catalog now shows rules in a file's header, such as `window.ts`'s.
- **Catalog:** 171 rules: 146 tested, 2 abstract, 1 budget, 2 deferred,
  20 caller obligations.
- **Phase 2 has not run.** `node task.ts list` shows the tasks and waves:
  - wave 1: tasks 8, 9, 11 to 18;
  - wave 2: task 10, which needs task 9.
- **Adversaries:** 205 in all.
  - Seed 1: all caught (the full set rerun after the rule-tag revision;
    the five `@unchecked`-review adversaries checked on seeds 1 to 3).
  - Seeds 2 and 3: only `TapRecognizer.taps--slop-strict` escaped. A
    focused property for presses ending exactly at the slop now catches it
    on seeds 1 to 5.
  - The full set hasn't been rerun on seeds 2 and 3 since that fix. Only
    the 8 recognizer adversaries use the changed test.
  - `node adversaries/helpers.check.ts` passes 312 tests.

## Expected failures until phase 2 runs

These failures are expected because phase 2 hasn't produced the parts yet.

- **`npm test`:** 73 tests, 55 pass, 18 fail.
  - Eleven test files can't find the modules phase 2 will write.
  - Seven tests fail because `rectangleOps.ts` doesn't have the carving
    operations yet; task 16 adds them. The seventh is
    `Rectangle.non-negative-size`, run on the carving results.
- **`npx tsc -p .`:** 20 TS2307 errors (missing modules) and one TS2739
  (`rectangleOps.ts` lacks the new members).

Anything else failing is a real problem.

## Moving into the TypeAgent repo

For now this directory is excluded from the monorepo's tooling:

- **pnpm workspace.** `ts/pnpm-workspace.yaml` has `!examples/modular`, so
  a `pnpm install` at `ts/` leaves it alone. Install here with npm, under
  this directory's `.npmrc`.
- **Prettier.** `ts/.prettierignore` lists `examples/modular`, so the
  repo's formatting check doesn't reformat the 4-space files.

Bringing it into line with the repo (pnpm, Prettier's defaults) is a later
decision.
- **Catalog.** The copy has a "Catalog improvements" commit that changes
  `catalog.template.html` and `catalog.html`. The original directory
  doesn't have it.

## Deferred

- **Phase 1b** on rounds 5 and 6, after the device-context discussion.
- **Phase 2:** rounds 3 to 6, wave 1 then wave 2.
- **A compiler for phase 1.** The checks now in `catalog.ts` (unknown
  tags, a test named by each rule's ID, abstract rules refined,
  deferred rules planned) belong in a compiler for the
  blueprint, run like `tsc`, with the catalog only presenting what it
  finds.
- **A demo page and its static server**, to be designed with the method.
- **Checking the doubles against a real browser:** `domkit.ts`
  (`RecordingElement`, `RecordingDocument`) and `RecordingContext` in
  `viewkit.ts`. The typecheck shows the platform types fit the subsets, but
  not that the doubles behave like a browser.
- **More input:** keyboard events, focus, other mouse buttons, touch, drag
  and drop, and overlays. Round 6 covers mouse presses, moves and hover
  only.
- **Text measurement:** to size a new rectangle to its text, or to justify
  text in an existing rectangle.
- **A container for agent runs.** `task.ts` sandboxes with read-only
  workspaces, hashes and a bash gate hook. A real container can come later,
  as more tools for the method are built.
- **Open questions** at the end of `moduleTooling.md`.
