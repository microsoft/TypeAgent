# Method

Work alternates between agreeing on a design and generating code from it.
The full procedure, with its reasons, is in `moduleTooling.md`.

## 1. Agree (human and agent)

- **Interfaces** in `events.ts`, `geometry.ts`, `color.ts`, `shape.ts`, `dataModel.ts`, `shapeModel.ts`, `frames.ts`, `view.ts`, `shapeView.ts` and `layout.ts`, with rules in the format described in `rules.ts`.
- **Members for tests are allowed.** When a rule can't be checked without seeing more, add the member or event that shows it rather than weakening the rule. Put it on its own small interface that the main one extends, where feasible. Better still, a return value that production code uses too: `LocalQueue.enqueue` in `dataModel.ts` returns the stamped operation, which the infrastructure sends and the tests check, where an earlier draft had an event for tests.
- **Platform subsets**, such as `canvas.ts` and `dom.ts`, only where an implementation needs a test double for its platform (see below).
- **Implementation specs** in `impl-specs.md`.
- **A contract suite** for each interface (`<interface>.contract.ts`). Each test is named after the rule ID it checks. Each suite has an input coverage test that fails if its generators stop reaching an input class.
- **An observer table** for each stateful interface (`observer-tables.md`): every call against everything observable afterward, each cell settled by a rule.
- **Scenarios** for whole features (`scenarios.ts`): named stories, as data, of what a user does and what the core visual then shows, with exact positions. An action says what the user does, not which control does it. They run through a fixture each platform writes, which does the actions with its own controls (`AppFixture` in `scenario.contract.ts`; the test platform's is `driver.ts`), so the same scenarios run on any platform and any mix of real parts and test doubles. Every scenario must pass on the reference assembly, which checks it against the rules. Wiring adversaries, each one wrong part among reference parts, are named after the scenario that must catch them.

### Platform subsets

An interface such as `canvas.ts` is a slice of one platform's API that an
implementation may use. It is not part of the blueprint, which holds for
every platform.

- **It needs a reason.** Either a test double stands in for a surface that
  is costly to observe, or the subset deliberately limits implementations to
  what every target platform offers. Otherwise, test against the platform.
- **It copies the platform.** Same names, signatures and types, so the
  platform's own object fits it with no adapter. A check compiled with the
  platform's types (`platform/`) proves that it fits.
- **It has no rules of its own.** Its meaning is the platform's. The test
  double is our model of that meaning, and its fidelity is an assumption,
  to be checked once against the real platform.
- **Implementations use nothing outside it.** The rest of the repo compiles
  without the platform's types, and the double hands implementations a
  view of itself that throws on any other member. An implementation that
  needs more fails its tests: add the member to the subset and the double.
- **It grows on demand,** when an implementation spec decides to use a
  member. There is no cross-platform drawing API until a second platform
  exists; portable behavior belongs in the blueprint, observed through
  ghosts such as `painted`.

Phase 1b challenges the blueprint; platform subsets are out of its scope.

## 1b. Challenge (a fresh agent)

A new agent that has no history with the design gets the same files as the
phase-2 agent. Its only implementation is a throwaway draft. Its job is to
find problems in what phase 1 produced:

- **Contradictions.** For every caveat in a headline, such as "unspecified",
  "except" or "in any order", try to show that other rules already settle
  it. Check every headline against its expression. Support each claim with a
  concrete case evaluated using the vocabulary files.
- **Test gaps.** Write adversaries: deliberately wrong implementations. Write at
  least one for each rule, and one for each boundary (edges, ties, empty
  inputs, duplicates, extreme coordinates). An adversary that escapes is a test
  gap, or a rule that the tests don't actually enforce.
- **Undecided choices.** List every choice an implementer would have to make
  that the spec doesn't settle.
- **Empty observer cells.** Check every observer table against the
  interfaces.
- **Faults nobody imagined.** Before reading the contract tests or adversaries,
  write a quick implementation from the interfaces and specs alone, run the
  contracts on it, and report each failure as a real fault (which becomes a
  adversary) or a spec ambiguity. Then discard the draft.

Record the agent's token use next to its findings, and weigh each task's
cost against what it found.

**Adversaries are kept.** An adversary is a deliberately wrong
implementation, written against one rule to show whether the tests catch
it. Mutation testing changes an existing implementation; an adversary is
generated whole, usually before any real implementation exists, hence the
name. Each one is a file named
`adversaries/<RuleID>--<variant>.adversary.ts`. The file runs a contract
suite against the wrong implementation. It may wrap an existing
implementation or build on the reference functions in the vocabulary
files. `npm run adversaries` checks that every adversary fails the test
named `<RuleID>`. An escaped adversary is reported as a finding, together
with a suggested new test.

**Output:** a single list of findings. Each one is marked as a *bug* in the
spec or tests, a *decision* for the human, or a *format* issue. The human
decides each item, and phase 1 is revised before phase 2 starts.

## 2. Generate (a fresh agent)

A new agent writes the implementations named in `impl-specs.md`, one task
at a time. It imports only the agreed interfaces. Done means `npm test`
passes and `npm run typecheck` reports no errors.

### Tasks

Every restriction on a task is enforced, not only stated, so that the
system's information flow can be reasoned about. `task.ts` does this.

- **A task is a spec section** with an **Imports** field. Its **Outputs**
  are what it may write; **Binds** names the platform types it compiles
  against (`node`, `dom`), and by default there are none.
- **Implementations depend only on interfaces.** What one needs from another
  comes in through its constructor, and pieces are put together only in
  wiring: tests, scripts, pages. Each contract is wired to test doubles
  (`modelkit.ts`, `viewkit.ts`), so one task's tests never depend on
  another generated implementation. `*.integration.test.ts` files wire the
  real ones together, outside any task.
- **Waves.** A task waits only for pending tasks whose outputs it reads.
  `npm run task list` prints the waves; each wave can run in parallel.
- **What it reads** is computed: the type-import closure of its imports,
  its test wiring and that wiring's closure, and `TASK.md` (the shared
  rules and its section). A section's **Hidden** files, such as the
  reference implementation of its own part, must not be among them:
  `npm run task list` flags any that are, and `make` refuses. `npm run task make <n>` puts exactly those in a
  workspace outside the repo, read-only and hashed.
- **What it can do** is limited by a policy beside the workspace. The agent
  has file tools that read only inside the workspace and write only its
  outputs and `REPORT.md`, and Bash only for `npm test`, `npm run
  typecheck` and `npm run check`. `npm run task run <n>` starts it.
- **What its code can reach** is checked before that code runs. `npm test`
  in a workspace lints the outputs first: only the listed imports, `import
  type` for interfaces, a header Imports field that matches, and no `any`,
  `globalThis`, `eval`, `Function`, `require`, dynamic `import()`,
  `import.meta` or `declare`. Outputs compile with only the ES2022 library
  plus what the task binds.
- **Collecting.** `npm run task collect <n>` repeats every check against
  the hashes kept outside the workspace, confirms the repo hasn't changed
  under the task, copies the outputs in, and records them, the report and
  the agent's token use in `tasks.json`. `npm run typecheck` lints every
  collected output in the repo the same way.

The policy relies on Claude Code's own enforcement of its file tools. On
native Windows there is no sandbox for processes, which is why only our
tests and linted outputs ever run.

Its report lists anything ambiguous or wrong. **This report measures phase
1b:** anything it finds that 1b missed is evidence about how well 1b works.
