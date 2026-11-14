# Current state

As of 2026-11-10. The history of each round is under "Status" in
`moduleTooling.md`; this file says where things stand now and what has been
deferred.

## Where things stand

- **Phase 1b ran on round 4** (2026-11-11), and its findings are
  applied; see the last entry under "Status" in `moduleTooling.md`.
- **The data model** (2026-11-11; the entry before it under "Status" in
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
  - `OperationSink.enqueue` returns the operation as queued (for `local`,
    the stamped one), and the
    infrastructure's `localSend` sends it; there is no `outgoing` event.
- **Layout, events and the app were simplified** (2026-11-10; the last
  entry under "Status" in `moduleTooling.md`):
  - The platforms define their events. `layout.ts` (`LayoutObject`,
    `EventDistributor`) replaced `pointer.ts`, with a case-based
    contract, a reference (`distributorkit.ts`) and 16 adversaries.
  - `View` takes no input. `TapSource` and `interactive` are gone, and
    a controller gets events through a distributor, with the view's
    surface as its target.
  - `chrome.ts`, `ui.ts` and `app.ts` were removed. An app's controls
    are the platform's. Its behavior is the scenarios, whose actions say
    what the user does and whose expectations are only what the drawing
    shows (the human's orientation: specify the controller–model and
    model–view relationships, not the means of control). Each platform
    writes a `Driver` (`scenario.contract.ts`). The test platform's
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
- **Phase 1 waits for the human's review** of round 6, and of round 5 as
  it now stands (scenarios only). Round 4 was reviewed on 2026-11-11.
- **Phase 1b has not run on rounds 5 and 6.** It was deferred until the
  platform subsets are discussed. When it runs, it
  challenges the blueprint only; `canvas.ts` and `dom.ts` are out of
  scope.
- **Rule tags:** `@requires`, `@ensures`, `@invariant` (state only),
  `@valid`, `@abstract` with `@refines`, `@budget`, and `@deferred` with
  `when:` and `how:`. The catalog refuses unknown tags and any rule that
  isn't accounted for.
- **Coordinate spaces** (`geometry.ts`): canonical, window and view.
  Layout objects and distributed events are in window coordinates.
- **Catalog:** 30 interfaces, 133 rules: 98 tested, 6 abstract, 3 budgets,
  5 deferred, 21 caller obligations.
- **Phase 2 on round 4** (2026-11-12): tasks 8, 9, 11 and 12 finished
  with done reports, passed every check, and passed phase 2b; none
  stopped. Together they cost $8.72. Their reports and reviews are in
  `reports/`. Task 10 (the bench) is next; tasks 16 and 19 are held until
  round 6 is reviewed and has had 1b. `node task.ts list` shows the state.
- **Adversaries:** 155 in all, every one caught on seeds 1 to 3.
  `node adversaries/helpers.check.ts` passes 400 tests. A full run takes
  about 45 seconds per seed, nearly 40 of them for `helpers.check.ts`.
- **The EventDistributor observer table has one open row:** nothing says
  that reading `region` or calling `locate` leaves the registrations as
  they were (`observer-tables.md`). It's left for the human to decide.

- **Phase 3 on round 4** (2026-11-12): tasks 8, 9, 11 and 12 ran a second
  time on Sonnet, and a fresh agent per task wrote tests that tell the two
  runs apart. Of 20 tests, 17 were freedoms. The other three: a spec gap
  (emptiness is now computed, `geometry.ts`), and two contract gaps (the
  read facet may hold only `ShapeCollection`'s members; `bench.ts` measures
  clears that remove nothing). 2b of the reruns found one more
  (`Circle.disk` at the boundary). Every loser was rerun and is done. The
  reports and reviews are `reports/task-<n>.d.md` and `.d.review.md`;
  round 4 cost $47.40 at list prices over 20 attempts (`node task.ts
  costs`).

- **Round 5 review** (2026-11-13): scenarios now have a collaborator (a
  peer app, and network steps to hold and release operations), plus
  `tap-outside`; `Scenario.random` compares only points clear of edges;
  `frames.fraction-of-frame` is measured on the circles app's taps (ink is
  deferred). `behavior.md` lists the changes. 18 scenarios; the
  open questions wait on the discussion of the platform subsets.

- **A formal design** (2026-11-13). The principles are agreed and in
  `method.md` ("The design"): every design statement is formal (a
  declaration, a rule's expression, or a test); prose is only a gloss;
  the human agrees each new or changed interface, member, rule or
  scenario, and terms are derived from those; observability is design;
  budgets name a complexity class, with a measurement standing in for it.
  The reasoning is in `moduleTooling.md` ("Why the design is formal");
  what is still pending is in `vocabulary-proposal.md`.
- **Rule expressions are compiled and evaluated** (the pilot,
  `pilot-shapeModel.md`). Before this, nothing evaluated them: contracts
  restated each by hand. `node ruleGen.ts` compiles the rules of
  `dataModel.ts` and `shapeModel.ts` into `rules.gen.ts` (tsc checks
  every expression); `ruleCheck.ts` records each object's history and
  evaluates the rules that apply to each call. `rules.ts` gained
  `history`, `atEvent`, `nested`, `emitted`, `Complexity` and `within`.
  Every rule in `shapeModel.ts` now has an expression, and its contracts
  only drive calls.
- **The operation log.** `OperationLogging` (`dataModel.ts`), which
  `MessageProcessor` extends, adds `logOperations`, which reports each
  operation as it is applied. With it, `one-change` and `ack-keeps-z` are
  exact, `local-order` and `remote-order` are `@ensures` with
  expressions, and `process.logs-each` is new. Task 9 was rerun for it
  (done, reviewed). `processorWorkloads` gained "remote removes of random
  present shapes" after review found a Sonnet run (9.2) whose removes
  were linear: a ratio of 28.4 against the limit of 16, not measured by
  any workload.
- **Task 9.2 is collected and awaits review** (2b). Its earlier attempt
  was sent back (`reports/task-9.2.review-3.md`); one run was wasted on a
  stale workspace ($2.77, in `design-costs.json`). The new attempt
  ($1.51) passes every check. A quick test of removes (1,000 against
  100,000 shapes) gives a ratio of 11.8: inside the limit of 16, but far
  above task 9's 1.5 and the 4 to 9 a logarithmic structure measures, so
  the review should read its remove path before accepting it. Then
  requeue and rerun 9.d, and review it (3b).
- **Catalog:** 31 interfaces, 137 rules. **Adversaries:** 173, none
  escaped on seeds 1 to 3. **Tests:** 422, with the 9 expected failures
  below.
- **Costs:** `costs.md` has the measured figures, the Ultra calibration
  (all work to date about 6% of a week; a week's capacity is roughly
  $1,600 at list prices, which is not a cost) and the whack-a-mole
  estimate. Human time is recorded from 2026-11-13 in `design-costs.json`.
- **The docgent** (`docgent/`): an agent that replaces a document. The
  plan, a phase 1 proposal for its tools (questions open), and a draft
  gold Q&A (16 items, plus 7 held back in `qa/holdout.md`, which
  whoever writes its instructions must not see). Its first reader is a
  colleague who works on the business around the method; we supply only
  what is possible and what it costs.

## Next session

1. Review 9.2 (read its remove path), then 9.d as above, and commit.
2. Step 0 for the docgent: a `project.json` per project, so the tooling
   serves circles and `docgent/` (interface lists are hardcoded in
   `task.ts`, `catalog.ts` and `ruleGen.ts`; `ruleCheck.ts` must take each
   project's compiled rules instead of importing circles').
3. The docgent's phase 1 (`docgent/phase1-proposal.md`, three questions)
   and the human's edits to the gold Q&A.
4. Later: assess extracting an existing repository into a blueprint (the
   colleague's question); compile `shape.ts`'s rules next.

## Expected failures until phase 2 finishes

These failures are expected because phase 2 hasn't produced the parts yet.

- **`npm test`:** 9 failing tests, all for parts not yet written or rewritten.
  - `rectDistributor.test.ts` can't find the module task 19 will write.
  - Seven tests fail on `rectangleOps.ts`: six because it doesn't have the
    carving operations yet (task 16 adds them; one of the six is
    `Rectangle.non-negative-size`, run on the carving results), and
    `RectangleOps.intersects.nonzero-area`, because emptiness is now
    computed (phase 3, task 11) and task 16 also makes that change.
- **`npx tsc -p .`:** one TS2307 error (`rectDistributor.ts`) and one TS2739
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

- **Phase 1b** on rounds 5 and 6, after the discussion of the platform subsets.
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
- **The web circles app:** a platform driver for the scenarios, with the
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
