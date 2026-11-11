# Current state

As of 2026-11-10. The history of each round is under "Status" in
`moduleTooling.md`; this file says where things stand now and what has been
deferred.

## Where things stand

- **The data model** (2026-11-11; the last entry under "Status" in
  `moduleTooling.md`):
  - `dataModel.ts` and `shapeModel.ts` are interface files. A model's
    write side is held only by its processor; the message infrastructure
    enqueues and is the only caller of `process`; controllers hold the
    read side and a `LocalSend`.
  - The read-only `ShapeCollection` has the location queries, so the
    eraser asks the model. `ShapeId` is a string, made by the processor.
  - `RenderGroup`, `Scene`, `ItemId`, `DrawingGroup` and the old mutable
    `ShapeCollection` are gone. A view renders one model; drag and wet ink
    are view-only state; presence is deferred.
  - `frames.complete` and `frames.fraction-of-frame` are restated for
    sending and processing. `driver.ts` is the infrastructure for one
    client, and scenario actions are async.
  - The EventEmitter rules have their own contract
    (`eventEmitter.contract.ts`), run through the writer's change event.
  - Tasks 8, 9, 10 and 12 were rewritten; task 9 is `shapeProcessor.ts`.
  - `local.enqueue` returns the stamped operation, and the
    infrastructure's `localSend` sends it; there is no `outgoing` event.
- **Layout, events and the app were simplified** (2026-11-10; the last
  entry under "Status" in `moduleTooling.md`):
  - The platforms define their events. `layout.ts` (`LayoutObject`,
    `EventDistributor`) replaced `pointer.ts`, with a case-based
    contract, a reference part (`distributorkit.ts`) and 16 adversaries.
  - `View` takes no input. `TapSource` and `interactive` are gone, and
    a controller gets events through a distributor, with the view's
    surface as its target.
  - `chrome.ts`, `ui.ts` and `app.ts` were removed. An app's controls
    are the platform's. Its behavior is the scenarios, whose actions say
    what the user does and whose expectations are only what the drawing
    shows (the human's orientation: specify the controller–model and
    model–view relationships, not the means of control). Each platform
    writes an `AppFixture` (`scenario.contract.ts`). The test platform's
    is `driver.ts`, with the reference controller in `circleskit.ts`.
    `behavior.md` has the orientation, the files, how to add a behavior,
    and the open questions.
- **Renames and a prose review** (2026-11-10): `Layer` is `RenderGroup`
  (a group drawn together; stacking is the scene's order and z-order),
  `DrawingLayer` is `DrawingGroup`, `ShapeLayer` (task 9) is
  `ShapeGroup`, `Emitter` is `EventEmitter`, and `window.ts` is
  `frames.ts` (`RenderGroup`, `DrawingGroup` and `ShapeGroup` went with
  the data model, above). The prose above each interface now keeps only
  definitions, testable statements and advice useful to every
  implementer; rationale, navigation and usage advice went. `Exporter`
  was removed (no rules, no contract, no implementation). "Shapes are
  immutable values" became the rule `Shape.immutable`, with a test in
  `shape.contract.ts` and an adversary.
- **Phase 1 waits for the human's review** of rounds 4 and 6, and of
  round 5 as it now stands (scenarios only).
- **Phase 1b has not run on rounds 5 and 6.** It was deferred until the
  device context (the platform subsets) is discussed. When it runs, it
  challenges the blueprint only; `canvas.ts` and `dom.ts` are out of
  scope.
- **Rule tags:** `@requires`, `@ensures`, `@invariant` (state only),
  `@valid`, `@abstract` with `@refines`, `@budget`, and `@deferred` with
  `when:` and `how:`. The catalog refuses unknown tags and any rule that
  isn't accounted for.
- **Coordinate spaces** (`geometry.ts`): canonical, window and view.
  Layout objects and distributed events are in window coordinates.
- **Catalog:** 31 interfaces, 127 rules: 95 tested, 6 abstract, 1 budget,
  5 deferred, 20 caller obligations.
- **Phase 2 has not run.** `node task.ts list` shows the tasks and waves:
  - wave 1: tasks 8, 9, 11, 12, 16 and 19;
  - wave 2: task 10, which needs tasks 8 and 9.
- **Adversaries:** 139 in all, every one caught on seeds 1 to 3.
  `node adversaries/helpers.check.ts` passes 277 tests. A full run takes
  about 25 seconds per seed.
- **The EventDistributor observer table has one open row:** nothing says
  that reading `region` or calling `locate` leaves the registrations as
  they were (`observer-tables.md`). It's left for the human to decide.

## Expected failures until phase 2 runs

These failures are expected because phase 2 hasn't produced the parts yet.

- **`npm test`:** 69 tests, 56 pass, 13 fail.
  - Six test files can't find the modules phase 2 will write.
  - Seven tests fail because `rectangleOps.ts` doesn't have the carving
    operations yet; task 16 adds them. The seventh is
    `Rectangle.non-negative-size`, run on the carving results.
- **`npx tsc -p .`:** 7 TS2307 errors (missing modules), one TS2739
  (`rectangleOps.ts` lacks the new members), and two TS2352 in `bench.ts`,
  which still makes numeric `ShapeId`s; task 10 rewrites it.

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

- **Phase 1b** on the data model (round 4 as rewritten), and on rounds 5
  and 6 after the device-context discussion.
- **Phase 2:** rounds 3 to 6, wave 1 then wave 2.
- **The message infrastructure:** the interface that owns a processor,
  with `localSend` (`LocalSend` is its agreed part) and `OperationQueue`.
  `frames.processed-before-frame` is `@deferred` until it exists.
- **View-only state** such as drags and wet ink (`ShapeView.view-state`
  is `@deferred`); for now a ShapeView shows only the model.
- **Collaboration:** the protocol that sequences operations, snapshots
  (`MessageProcessor.snapshot` is `@deferred`), and presence for
  view-only state such as drags and wet ink.
- **A compiler for phase 1.** The checks now in `catalog.ts` (unknown
  tags, a test named by each rule's ID, abstract rules refined,
  deferred rules planned) belong in a compiler for the
  blueprint, run like `tsc`, with the catalog only presenting what it
  finds.
- **A demo page and its static server**, to be designed with the method.
- **The web circles app:** a platform fixture for the scenarios, with the
  DOM widgets it needs added to `dom.ts`, and a new recording document
  for them (`domkit.ts` went with the web renderer).
- **Checking the doubles against a real browser:** `RecordingContext` in
  `viewkit.ts`, and the new recording document once it exists. The
  typecheck shows the platform types fit the subsets, but not that the
  doubles behave like a browser.
- **More input:** keyboard events and focus (not positional, so not an
  EventDistributor's), and capture, which the distributor leaves to the
  platform. Other positional events need only the platform's event map.
- **Text measurement:** to size a new rectangle to its text, or to justify
  text in an existing rectangle.
- **A container for agent runs.** `task.ts` sandboxes with read-only
  workspaces, hashes and a bash gate hook. A real container can come later,
  as more tools for the method are built.
- **Open questions** at the end of `moduleTooling.md`.
