# Module tooling: the interface-first procedure

This note describes the whole procedure as currently recommended, the files
and commands that support it, and the reasons behind each step. `method.md`
is the short version; this note is the full one.

## Goals

- **Shared understanding.** The human and the agents agree on the
  architecture through interfaces whose rules are exact enough to test.
- **Interchangeable parts.** Each interface can have several
  implementations. Every implementation passes the same contract suite, and
  its header says when to choose it.

## Roles

| Who | Does | Doesn't |
|---|---|---|
| Human | Agrees the design with the design agent. Decides every finding. | Write implementations |
| Design agent | Drafts interfaces, rules, specs, contract tests and adversaries with the human. Verifies the other agents' claims. Turns findings into fixes. | Write implementations |
| Challenge agent (1b) | Is fresh. Attacks a first-draft spec: contradictions, test gaps found with adversaries, undecided choices. | Write implementations |
| Implementation agent (2) | Is fresh. Writes the implementations in one round of `impl-specs.md`. | Change interfaces, rules, contracts or test wiring |

"Fresh" means the agent has no history with the design. It sees only the
files, so anything the files don't say, it can't know. That's the point:
it reads the spec the way a future implementer will.

## Files

| File | Holds |
|---|---|
| `events.ts`, `geometry.ts`, `color.ts`, `shape.ts`, `window.ts`, `view.ts`, `shapeView.ts`, `pointer.ts`, `ui.ts`, `chrome.ts`, `app.ts` | Interfaces, each with rules in the format below |
| `canvas.ts`, `dom.ts` | Platform subsets: the parts of the web canvas and DOM that web implementations may use. No rules; their meaning is the platform's |
| `platform/*.check.ts`, `platform/tsconfig.json` | Compile with the DOM library, and fail unless the browser's types fit the subsets. The rest of the repo compiles without it |
| `rules.ts` | The rule format, and the generic vocabulary of rule expressions: `old`, `implies`, `sameSet`, `deepEqual` and the like. Imports nothing |
| `<file>.vocab.ts` | The vocabulary of rule expressions about an interface file's domain: ghost state such as `indexed(locator)` and `painted(view, p)`, and reference functions such as `rectContains` and `over`. Each re-exports `rules.ts` and the vocabulary of the files its interface file imports, and imports nothing else |
| `testkit.ts` | Shared test helpers: fast-check seeding (`FC_SEED`), `prevDouble`, test shapes, and `coverage`, which checks that generators reach each input class |
| `eventkit.ts` | `Events`, an Emitter with `emit` and `listenerCount`, for test doubles |
| `uikit.ts` | `TreeRenderer`, a Renderer that keeps its tree and acts as its own fixture |
| `domkit.ts` | A recording DOM implementing `dom.ts`, which computes the semantic tree a browser would expose (the web renderer's WAI-ARIA mapping) and acts as a user |
| `chromekit.ts`, `appkit.ts` | The reference Chrome and App, written from the vocabulary |
| `driver.ts` | The scenario driver: finds controls by role and label, acts, taps the view, reads what it shows; assembled from any mix of real parts and doubles |
| `scenarios.ts` | Scenarios as data: named stories with exact steps and expectations, and the demo's options and window size |
| `scenario.contract.ts` | Runs each scenario by ID, and random sequences compared against the reference assembly |
| `scenariokit.ts` | The reference assembly: every part a test double |
| `shapeviewkit.ts`, `routerkit.ts`, `tapkit.ts` | The reference ShapeView, router and tap recognizer, one per file, so that each task can be kept from reading the reference for its own part |
| `modelkit.ts` | Test doubles for the shape model: `ListCollection` and `ListIndex`, so that contracts for things built on them depend on no generated implementation. Checked by `helpers.check.ts` |
| `viewkit.ts` | Test doubles for views: `RecordingContext` (a canvas context that computes what each point shows, and hands implementations a view of itself that allows only `DrawingContext`'s members), `ManualScheduler`, `ListLayer` and `testCircle`. Checked by `helpers.check.ts` |
| `observer-tables.md` | For each stateful interface, every call against every observer, with the rules that settle each cell |
| `<interface>.contract.ts` | A contract suite for each interface, a function taking a factory. Test names are rule IDs. `shape.contract.ts` holds the rules every Shape has, which each shape type's contract runs |
| `<impl>.test.ts` | Wires an implementation to its contract over test doubles, plus tests of behavior the spec decides for that implementation only |
| `<impl>.integration.test.ts` | Wires real implementations together; part of no task |
| `task.ts` | `npm run task`: turns spec sections into tasks with enforced information flow (`list`, `make`, `run`, `check`, `collect`, `lint`); see "Tasks" in `method.md` |
| `tasks.json`, `reports/` | Collected tasks: output hashes, token use, and each agent's report |
| `impl-specs.md` | What to build, round by round, and the rules every implementation follows |
| `adversaries/<RuleID>--<variant>.adversary.ts` | Deliberately wrong implementations, each run against a contract |
| `adversaries/_quadtree.ts`, `adversaries/_layer.ts`, `adversaries/_circle.ts`, `adversaries/_view.ts` | Configurable helper implementations that adversaries are built from |
| `adversaries/helpers.check.ts` | Runs every helper, with no bug switched on, against its contract |
| `adversaries.ts` | The runner behind `npm run adversaries` |
| `bench.ts` | Measurements behind the Cost and Choose when header fields |
| `method.md` | The procedure in brief |
| `catalog.ts`, `catalog.template.html` | The script behind `npm run catalog` and the page it fills in |
| `catalog.md`, `catalog.html` | Generated: the interface map with rule status, as a Mermaid diagram and as an interactive page |
| `summary.ts`, `summary.pdf` | The script behind `npm run summary`, and its output: one printable page of every interface's typed members, with extends shown in each heading |

### Commands

| Command | Checks | Time |
|---|---|---|
| `npm test` | Every contract and test passes | Seconds |
| `npm run typecheck` | No type errors | Seconds |
| `npm run adversaries` | The helpers pass cleanly, then every adversary fails the test named by its rule ID. `FC_SEED` picks the seed (default 1); `npm run adversaries -- <text>` runs only adversaries whose file names contain the text | About 5 minutes |
| `npm run bench` | Prints the measurements | Seconds |
| `npm run catalog` | Regenerates `catalog.md` and `catalog.html`: interfaces, extends and uses edges, and each rule's test status and adversary count | About 15 seconds |
| `npm run summary` | Regenerates `summary.pdf`. Doesn't run tests | Under a second |

### Dependencies

Ask before adding any dependency. `.npmrc` turns off install scripts,
requires releases at least 30 days old, saves exact versions and refuses
git dependencies. Implementations import no npm packages and no Node
built-ins; scripts may use Node built-ins.

## The rule format

`rules.ts` defines the format; this is a summary. A rule is a tag, a slug
and a one-line headline, optionally followed by indented lines that give
the rule as a TypeScript boolean expression in the vocabulary of `rules.ts`
and the interface file's `.vocab.ts`.

| Tag | Meaning |
|---|---|
| `@requires` | The caller's obligation |
| `@ensures` | The implementation's obligation |
| `@invariant` | Always true of a value |
| `@unchecked` | No test yet; the headline says why |

- A rule's ID comes from where it sits, for example
  `ShapeLocatorQueries.inRect.exact`. The test that checks it has that name. A
  rule inherited from another interface keeps its original ID, so a
  `Layer`'s contract runs tests named `ShapeLocatorQueries.inRect.exact`.
- A rule with an expression is tested by generating inputs. A rule with
  only a headline needs a hand-written test.
- **Outside the rules.** When a caller breaks a `@requires` rule, or passes
  a value that doesn't match its static type, behavior is unspecified. An
  implementation may throw, and says what it does under
  AdditionalSemantics.
- **Numbers are finite.** Every number in a value passed to or returned by
  an interface is finite; passing a non-finite one is outside the rules.
- **Rounding.** A rule that compares an implementation with a reference
  function means exact arithmetic, and its tests use inputs where
  floating-point arithmetic is exact or skip cases within rounding distance
  of a tie. A rule that relates an object's own methods to each other holds
  as actually computed, with no allowance.

## A round, step by step

Each round adds interfaces or implementations. A round runs phase 1, then
phase 1b if the spec is a first draft, then phase 2, then the review of
phase 2.

### Phase 1: Agree (human and design agent)

1. **Interfaces and rules.** Write or extend the interfaces. Give every
   obligation a rule, and an expression wherever one can be written.
2. **Vocabulary.** Add to the interface file's `.vocab.ts` any reference function the expressions
   need, or to `rules.ts` if it knows nothing of the domain. Keep them deliberately simple: they define meaning, not speed.
3. **Implementation spec.** Add a round to `impl-specs.md`. For each file,
   state the exports, imports, approach, **decided behavior** and what's
   **left to the implementer**. Everything an implementer would otherwise
   have to guess goes in one of those two lists.
4. **Contract tests.** Write a suite for each new interface, one test per
   rule ID. Generated inputs must include:
   - inputs on a coarse grid, so that ties and shared edges actually occur;
   - the same cases scaled, offset and off the binary grid, mixing very
     different scales in one object, because grid-exact inputs hide
     floating-point bugs;
   - boundaries: edges, ties, empty values, duplicates, the extremes that
     `@requires` rules allow.

   Random operation sequences use `size: "max"`. fast-check's default size
   caps generated arrays at about 10 elements, whatever `maxLength` says.

   **Measure what the generators reach.** Each contract has an input
   coverage test (`<Interface> input coverage`) that names its input classes
   (kinds of removal, empty shapes, coordinates beyond 2^53, a function
   subscribed twice, and so on) and fails if any class falls below a minimum
   share of generated sequences. Set each minimum at about half the share
   measured on a few seeds, and print the shares with `COVERAGE=1`.
5. **Observer table.** For each stateful interface, add a table to
   `observer-tables.md`: every call (including the observers themselves)
   against everything a caller can observe afterward. Each cell names the
   rules that settle it, or says why it is unspecified. An empty cell is a
   missing rule. "Nothing changes" counts as a rule and needs one.
6. **Seed adversaries.** Write an adversary for each way of being wrong that the
   design discussion has already raised, and one for each rule an observer
   table added.
7. **Check before handing off.** `npm test`, `npm run typecheck` and
   `npm run adversaries` pass, with existing implementations and every adversary
   behaving as expected.

### Phase 1b: Challenge (fresh agent, first drafts only)

Run 1b once, on the first draft of each new spec. Don't re-run it after
later edits to phase 1; the next implementation round checks those (see
"Why the procedure looks like this").

The challenge agent gets the files a phase-2 agent would get. Its only
implementation is a throwaway draft (the last item below). It looks for:

- **Contradictions.** For every caveat in a headline, such as "unspecified",
  "except" or "in any order", it tries to show that other rules already
  settle it. It checks every headline against its expression. Each claim
  comes with a concrete case evaluated using the vocabulary files.
- **Test gaps.** It writes adversaries: at least one for each rule, and one for
  each boundary. An adversary that escapes is a test gap, or a rule the tests
  don't actually enforce. It reports each escaped adversary with a suggested test.
- **Undecided choices.** Every choice an implementer would have to make that
  the spec doesn't settle.
- **Empty observer cells.** It checks each table in `observer-tables.md`
  against the interfaces: every call and every observer is listed, and every
  cell is settled by the rules it names.
- **Faults nobody imagined.** Before reading any contract test or adversary,
  it writes a quick implementation of each new interface from the
  interfaces and `impl-specs.md` alone, then runs the contracts against it.
  Each failure is either a real fault the tests catch, which becomes a
  adversary, or an ambiguity in the spec, which becomes a finding. The draft
  is then thrown away; it stays out of the repository.

**Watch the token budget.** Record the challenge agent's token use next to
its findings, as earlier 1b rounds did, and compare each task's cost with
what it found. The draft is the most expensive task; if it keeps costing
more than its findings are worth, narrow it to the interfaces most likely
to hide faults, or drop it.

Its adversaries are kept in `adversaries/`. Its output is one list of findings,
each marked as a **bug** in the spec or tests, a **decision** for the
human, or a **format** issue.

The human decides each item. The design agent applies the decisions,
strengthens the tests until every adversary is caught, and re-runs the checks
of phase 1 step 7.

### Phase 2: Generate (fresh agent)

The implementation agent writes the files named in the round of
`impl-specs.md`, following its rules for every implementation:

- Imports only the files listed. Interfaces come in with `import type`.
  No npm packages, and Node built-ins only in scripts.
- No dependency on `rules.ts` or the `.vocab.ts` files.
- A header on every file. An implementation's header has How, Choose when,
  Cost, AdditionalSemantics, Parts and Imports; a script's has How, Run and
  Imports.
- Measured numbers in headers are ratios and crossover points, each naming
  the script that measures it. Absolute times belong in the script's output.
- **Done** means `npm test` passes and `npm run typecheck` reports no
  errors. The agent doesn't change interfaces, `rules.ts`, the `.vocab.ts` files, contracts or test
  wiring. If a rule seems wrong or ambiguous, it says so in its report
  rather than working around it.

The report lists anything ambiguous or wrong, and anything the agent found
hard. Anything in it that 1b missed is evidence about how well 1b works.

### Review of phase 2 (human and design agent)

1. **Verify.** Re-run the tests, type-check and adversaries. Reproduce every
   claim in the report before acting on it.
2. **Classify** each finding as a bug, decision or format issue, as in 1b,
   and the human decides each one.
3. **Turn each bug into an adversary.** When a finding is a way an
   implementation could go wrong that the tests didn't catch (in round 2,
   two quadtree rounding mistakes), add it as a switch on a helper and a
   adversary file. Strengthen the tests until the adversary is caught on several
   seeds (`FC_SEED=1`, `2`, `3`). This keeps the challenge step's output
   growing without re-running 1b.
4. **Fix the spec.** Revise the rules, specs and tests. When a test fails
   for the simple reference implementation, suspect the rule before the
   implementation.
5. **Queue the next round.** Anything an implementation must change because
   of the fixes goes into the next round of `impl-specs.md`, for the next
   fresh implementation agent. The design agent doesn't edit
   implementations itself.

The next round's phase 2 is the check on the fixes: it implements against
the corrected spec, and its report shows whether the fixes held.

## Why the procedure looks like this

### Each kind of agent finds different problems

| Found by | Kinds of problem |
|---|---|
| Challenge agent (1b) | Weak tests (8 escaped adversaries in round 2), undecided choices |
| Implementation agent (2) | Rules that contradict each other, arithmetic hazards inside real code, file rules that don't fit |

- **Only 1b finds weak tests.** An implementer whose code passes has no
  reason to notice them. In round 1 the implementation agent made 13
  findings, and 8 test gaps remained that only adversaries exposed.
- **Implementers find contradictions more reliably.** They must satisfy
  every rule at once, so a contradiction stops them. A reviewer only has to
  notice it. In round 2 the `round-pen` contradiction, introduced while
  applying the 1b fixes, was found by the implementer.

### Re-running 1b versus implementation rounds

After phase-1 edits there were two ways to check them: re-run 1b on what
changed, or let the next implementation round find problems. The procedure
uses implementation rounds, run one after another:

- **1b once per new spec** catches the weak tests that only it finds.
- **Adversaries from every finding** carry 1b's kind of check forward without
  another 1b run.
- **The next round** shows whether the fixes worked, and its code is
  written against the final spec.

Two implementation agents working in parallel on the same spec were also
considered. While the contracts check exact results, comparing two
implementations adds little. It may still be worth trying where the spec
leaves real freedom, such as performance or internal design.

### What adversaries can't find

René Just, Darioush Jalali, Laura Inozemtseva, Michael D. Ernst, Reid
Holmes and Gordon Fraser, "Are Mutants a Valid Substitute for Real Faults
in Software Testing?", FSE 2014 (University of Washington, University of
Waterloo, University of Sheffield). Slides:
<https://homes.cs.washington.edu/~mernst/pubs/mutation-effectiveness-fse2014-slides.pdf>.
The steps in this section build on that study; acknowledge it wherever this
procedure is written up. The study compared 357
real faults with 230,000 mutants. Mutant detection tracked real-fault
detection for 73% of the faults, far better than statement coverage did.
For 10%, the mutation operator was missing or too weak; for 17%, no
mutation operator could represent the fault at all, typically because the
fault was added or changed logic, such as a special case that shouldn't
exist.

Our adversaries play the part of the study's mutants, but they are
generated whole against a rule rather than made by changing an existing
implementation, which is why we don't call them mutants. They can
represent added logic, but they share the limit in another form: an adversary exists only for a fault someone
imagined, against a rule someone wrote. Three steps target what that
misses:

| Kind of fault | Step |
|---|---|
| Behavior no rule covers, including extra behavior | Observer tables (phase 1 step 5, checked in 1b) |
| Inputs the generators never reach | Input coverage tests (phase 1 step 4) |
| Faults nobody imagined | The throwaway draft in 1b |

Faults across components, and performance, remain outside adversaries: they are
`@unchecked` rules and bench budgets. A complete observer table also makes
a contract equivalent to comparing the implementation with a reference
model, which is why no separate differential test is needed.

### Lessons that shaped the steps

- **Grid-exact inputs hide floating-point bugs.** Every round so far found
  a rounding bug that coarse-grid tests missed. Hence phase 1 step 4's
  scaled, offset and off-grid inputs, mixed across scales.
- **An adversary's catch rate has to be measured.** The first version of the
  scaled ShapeLocator sequences missed both of round 2's rounding adversaries.
  One needed shapes at very different scales in one locator; the other
  needed the first shape far from the origin. Hence several seeds per new
  adversary.
- **Tests have rules too.** `add.indexed` was first written so that it
  failed for `ListLocator`: a rectangle can be non-empty by its width and
  still contain nothing once `x + width` rounds back to `x`. The rule was
  restated, not the implementation changed.
- **Helpers must be correct before their adversaries mean anything.** The 1b
  agent's quadtree helper itself had a rounding bug. `npm run adversaries` now
  refuses to run unless every helper passes its contract cleanly.
- **A harness can hide a fault by how it watches.** In round 4, the
  reference subscriber queried the layer during every add, which masked a
  query that changed the layer; and it never unsubscribed, so a layer with
  no subscriptions was never tested. Both were found by adversaries that
  escaped for the wrong reason.
- **Generated sequences must be as long as they look.** In round 4, two
  listener adversaries escaped on seed 1 because fast-check's default size kept
  sequences to about 10 operations. Hence `size: "max"` in step 4.

## Status

- **Round 1:** `rectangleOps.ts`, `inkStroke.ts`, `listLocator.ts`. Done.
- **Round 2:** `quadTreeLocator.ts`, `bench.ts`, the `inkStroke.ts` fix.
  Done. 47 tests pass; 28 adversaries, all caught on seeds 1, 2 and 3.
- **Round 3:** queued in `impl-specs.md` section 7: bring the headers of
  `bench.ts`, `listLocator.ts` and `quadTreeLocator.ts` up to the new
  header rules.
- **Round 4:** phase 1 in progress, on the view–model relationship.
  - Drafted: `ShapeLocatorQueries` and `Layer` (with `subscribe`) in
    `geometry.ts`; in `window.ts`, the event-driven timing model and
    `FrameScheduler` taking a handler per request; in `view.ts`, `Scene`
    and the frame-driven `View`; contracts for `ShapeCollection` and `Layer`; observer tables for
    the three stateful interfaces, which added three read-only rules; input
    coverage tests in all three stateful contracts; 30 seed adversaries, all
    caught on seeds 1, 2 and 3; and a bench budget for model updates.
  - Removed: `Flushable` and `FlushPolicy`. Each event now updates the
    model completely, so nothing is ever pending.
  - Split by what depends on Shape. `geometry.ts` keeps the shape data:
    `ShapeCollection` (a collection of shapes) and `ShapeLocator`, which
    stay separate, so pairing them is the owner's choice. `view.ts` has a
    read-only `Layer<T>` over `ItemId` that presents any data model,
    `Scene<T>`, `View<T>` and `Exporter<T, Out>`.
    `ShapeLayer` (impl-specs section 9) presents a collection and its
    locator as a layer.
  - Split the data side by topic: `geometry.ts` keeps points, rectangles
    and viewports; `color.ts` has `Color`; `shape.ts` has `Shape`,
    `InkStroke`, `ShapeCollection` and the locators. The rule format and
    the finite-numbers convention moved to `rules.ts`, which imports
    nothing; `spec.ts` keeps the domain vocabulary and re-exports it.
  - Connecting views to shapes (phase 1 done, for review): `Circle` in
    `shape.ts`; `shapeView.ts`, a bridge that imports `shape.ts` and
    `view.ts`, with `ShapeView` (circles only, identity viewport, no input)
    and `DrawingContext`. `ItemRenderer` was removed: a view for a data model
    draws its own items. The demo page and its static server are deferred,
    to be designed with the method. Added: `circle.contract.ts` and
    `shapeView.contract.ts`, whose fixture reports what each point of the
    surface shows, so the contract doesn't depend on the surface; test
    doubles in `viewkit.ts`; `View.read-only`, from the ShapeView observer
    table; implementation specs 11 (`circle.ts`) and 12
    (`canvasShapeView.ts`); and 20 seed adversaries, all caught. The generic
    Shape rules moved to `shape.contract.ts`. `tsconfig.json` now checks
    `adversaries/` too.
  - Events: every producer now uses `Emitter` (`events.ts`), Node's
    `EventEmitter` cut down to `on` and `off`, with Node's behavior: a
    listener registered twice is called twice, `off` removes the most
    recent registration, and an emit calls the listeners registered when it
    started. `Layer` emits `change`; `View` emits `viewport` and has
    `dispose()`, and `View.one-listener` requires exactly one listener per
    layer until then. `subscribe` is gone, and its adversaries became Emitter
    adversaries, three of them new. `ShapeView` no longer names a drawing
    surface; the canvas's `DrawingContext` moved to `canvas.ts`.
  - Platform subsets: `canvas.ts` is a slice of the web canvas, not part of
    the blueprint, with principles in `method.md`. `npm run typecheck` also
    compiles `platform/` with the DOM library, which fails unless the
    browser's context types fit `DrawingContext`. `RecordingContext.context`
    throws on any member outside it. The catalog no longer lists it.
  - Enforced tasks (`task.ts`, "Tasks" in `method.md`): `spec.ts` split into
    one `.vocab.ts` per interface file, so a test's closure stays within
    its interface's; `modelkit.ts` doubles, with shapeLayer wired to them
    and an integration test for the real pieces; tasks 8, 9, 11 and 12 form
    wave 1, task 10 wave 2. The new lint found four stale header Imports
    fields (from the shape and color split), now fixed.
  - The circles app (phase 1 done, for review): `ui.ts` (semantic trees,
    `Renderer`), `chrome.ts` (`Chrome`, the headless controls, with exact
    layout and text), `app.ts` (the wiring), `TapSource` in `window.ts` and
    taps on `View`, `DrawingLayer` in `shapeView.ts`, and the platform
    subset `dom.ts`. Contracts for each, scenarios with a driver that runs
    on any assembly, observer tables, implementation specs 13 to 15, and 56
    new adversaries, all caught: 19 for Chrome, 10 for the web renderer, 10
    for App, 5 for view taps, 3 for DrawingLayer, and 9 wiring adversaries,
    each caught by the scenario it is named after. Two candidate
    adversaries turned out not to be faults: copying a circle's center is
    makeCircle's job, and a driver that ran frames only when reading what
    the view shows hid a view that never clears.
  - Layout and mouse routing (phase 1 done, for review): layout by
    carving, with `cut`, `splitHoriz`, `splitVert`, `inset` and `place` on
    `RectangleOps`, splits by the largest-remainder method, each defined by
    a reference function; `controls()` rewritten with them (identical trees
    on 2,000 random cases). `pointer.ts`: regions are Emitters, and routing
    only picks which region emits: the innermost region with a listener,
    no bubbling, capture from a press to its release, points in the
    region's own coordinates. `TapRecognizer` turns a region's presses into
    the TapSource a view takes, so View didn't change. `SemanticNode` gained
    `disjoint`, so native hit testing agrees with routing. Scenarios tap
    through the window. 32 new adversaries, all caught: 10 for the carving
    operations, 13 for the router, 8 for the recognizer, and a wiring one
    that leaves points in window coordinates. Keyboard, focus, other
    buttons, touch, drag and drop, and overlays are left for later.
    Checking what each task reads found four tasks that could read the
    reference for their own part through the scenario wiring. The
    references are now one per file, those tasks wire their scenarios
    without their own reference, and a **Hidden** field in impl-specs.md
    makes `task.ts` refuse a workspace that would read one.
  - Phase 1b ran on the split (about 140k tokens: draft about 10%,
    contradictions 30%, adversaries 40%, undecided choices and observer cells
    10% each). It made 15 findings and 25 adversaries, 6 of which escaped:
    `z-order` checked only neighbouring items, `same-as-remove` compared
    shapes but not IDs, `ShapeLocatorQueries.read-only` re-ran only one
    query, and `Layer.notifies` covered only `forEach` and the queries.
    The draft passed every contract at once and found no fault; it surfaced
    two undecided choices (a rejected shape, a throwing subscriber), both
    now outside the rules. Next time, narrow the draft to interfaces with
    real design freedom.
  - Phase 2 then runs rounds 3 and 4 together.

## Acknowledgments

- The observer tables, input coverage tests and throwaway draft respond to
  Just et al., "Are Adversaries a Valid Substitute for Real Faults in Software
  Testing?", FSE 2014 (see "What adversaries can't find" for the reference and
  slides).

## Open questions

- A `LooseQuadTreeLocator`, suggested by `inRect`'s cost for shapes that
  straddle cell lines, as a possible later round.
- Parallel implementation rounds for specs with performance or design
  freedom.
- The two `@unchecked` rules on `Shape` (`boundingBox.exact`,
  `intersects.only-shared`), which each shape type covers with its own rule.
- Deferred tooling: a standard bundle of files for phase-2 agents. The
  catalog (`npm run catalog`) now covers interfaces and rule coverage;
  implementations are not on its map yet.
- Eleven value invariants have no test named by their ID (`Rectangle`,
  `Color`, `InkStroke`, `Circle`, `Viewport`, `ChromeOptions` and
  `AppParts`). The `InkStroke`, `Circle` and `Color` ones are covered by
  `makeInkStroke.validation` and `makeCircle.validation` under other
  names. The `ChromeOptions` and `AppParts` ones describe what a caller
  passes, so breaking them is outside the rules; a chrome or app could
  check them and throw, which would make them testable.
- Translucent wet ink drawn as chunks blends twice where chunks overlap,
  whether drawn incrementally or not. Options include a layer opacity, with
  each chunk drawn opaque, or a view that draws the layer's coverage with
  max blending.
- A conversion contract between a source and the layer that presents it:
  that the layer's items, IDs and regions are the right ones for the
  source. The Layer contract checks the layer on its own, so for
  `ShapeLayer` the edits are checked only as far as the layer shows them.
  It should also require that an item's region never changes while its ID
  stays the same; otherwise caching by ID silently breaks.
- Snapshots for collaboration: caching a collection and its locator in a
  snapshot favors persistent (structure-sharing) or copy-on-write versions
  of both, which would change `ShapeLocator`'s mutating `add` and `remove`.
- Checking `RecordingContext` against a real canvas once, for example by
  comparing pixels away from circle edges in the demo page.
- Checking `domkit.ts` against a real browser once: that its semantic tree
  matches the browser's accessibility tree for the web renderer's
  elements, and that clicks on disabled buttons, range snapping and the
  value property's dirty flag behave as it assumes.
- The demo page and its static server, to be designed with the method:
  the composition root that makes the real parts for a browser window and
  connects them.
- A recording view and scheduler, which would let the `@unchecked` rules
  on `View` and in the `window.ts` header be tested.
- An editing interface in model terms (for example a stroke builder with
  `begin`, `extend` and `end` that edits layers), if editing logic such as
  smoothing and chunking should be shared across platforms. `Tool` and
  `PointerSample` were removed because input events are platform-specific.
