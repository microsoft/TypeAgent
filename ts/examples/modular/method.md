# Method

Work alternates between agreeing on a design and generating code from it.
The full procedure, with its reasons, is in `moduleTooling.md`.

## 1. Agree (human and agent)

- **Interfaces** in `events.ts`, `geometry.ts`, `color.ts`, `shape.ts`, `dataModel.ts`, `shapeModel.ts`, `frames.ts`, `view.ts`, `shapeView.ts` and `layout.ts`, with rules in the format described in `rules.ts`.
- **Members for tests are allowed.** When a rule can't be checked without seeing more, add the member or event that shows it rather than weakening the rule. Put it on its own small interface that the main one extends, where feasible. Better still, a return value that production code uses too: `OperationSink.enqueue` in `dataModel.ts` returns the stamped operation, which the infrastructure sends and the tests check, where an earlier draft had an event for tests.
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

**Phase 2 doesn't interpret the spec.** The agent decides only what the
spec leaves open: anything under "Left to the implementer", and details
no rule or spec text addresses. When it would have to decide what a rule
or spec text means, because it is ambiguous, inconsistent or silent on
something the implementation must get right, it stops. It lists every
such question in the task and finishes with a stopped report instead of
code.

**So phase 2 iterates.** A stopped report goes back to phase 1: the human
settles each question, and the design agent puts the answer in the spec,
with tests and adversaries where it adds a rule. Then the task is made
again and run by a fresh agent, which never sees the earlier attempt.
`task.ts` keeps each stopped report as `reports/task-<n>-stop-<k>.md`, and
`npm run task list` shows how often a task has stopped. A task is done
when an attempt finishes with a done report and passes its checks.

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

A report starts with `Status: done` or `Status: stopped`, and `task.ts`
checks its form: a done report lists its choices and has no questions; a
stopped report lists its questions, and its outputs are not collected.
What `task.ts` can't check is whether a listed choice was really a
reading of the spec; the review does that, and such a choice counts as a
stop. **Stopped reports measure phase 1b:** each question 1b missed is
evidence about how well 1b works.

## 2b. Review each done report (human and design agent)

A done task is collected, so its code is in the repo and the integration
tests run on it, but it isn't done until the human and the design agent
have reviewed its report. The question is what the attempt shows the spec
should say.

- **Each choice** in the report's Choices gets a disposition:

| Disposition | Meaning | What follows |
|---|---|---|
| **open** | A detail of this implementation; others may differ | Nothing |
| **adopt** | The spec takes the choice as decided | It goes into the spec: decided behavior if it binds only this task, a rule if it binds every implementation (with a test, and an adversary for the other choice) |
| **respecify** | The spec decides differently, or adds a requirement the choice doesn't meet | Spec change and tests; the task goes back for another attempt |
| **reading** | The choice was an interpretation: a missed stop | Settled in the spec; if the agent read it otherwise, as respecify |

- **Each note** in its Notes leads to a **spec fix**, a **decision** for
  the human, or **nothing**.
- **The review is a file,** `reports/task-<n>.review.md`. It starts with
  `Status: reviewed`, and has a Choices and a Notes section with one bullet
  per bullet of the report, in order, each starting with its disposition in
  bold and giving the reason.
- **`npm run task review <n>`** checks that form and records the review.
  With no respecify or reading, the task is done. Otherwise the review is
  kept as `reports/task-<n>.review-<k>.md` and the task goes back for
  another attempt by a fresh agent; its collected outputs stay until one
  replaces them.
- **A task that waits for its review blocks the tasks that read its
  outputs,** as a held task does, so no task builds on code whose spec is
  about to change.

## 3. Distinguish (two fresh agents, then a third)

Phase 3 measures how well the spec pins down the implementations. If two
implementations that both finished phase 2 from the same spec can be told
apart by a valid test written against the interfaces, the spec leaves
that behavior open. Phase 3b decides whether it meant to.

- **A second run.** `npm run task make <n>.2`, then `npm run task run
  <n>.2 --model <m>`, runs the task again with a fresh agent and the same
  `TASK.md`, on a different model from the first run so that the two
  implementations are as independent as we can make them. It needs the
  first run done, and never sees its output. It stops, is collected and
  is reviewed (2b) like any run, until it is done. Its output goes to
  `alternates/<file>.run-2.ts`, outside the wiring.
- **A reference adapter,** `<file>.ref.ts`, written by the design agent:
  the task's exports, exactly, over the reference part. `refs.test.ts`
  runs the task's contracts on it.
- **The distinguishing agent.** `npm run task make <n>.d` puts both
  implementations in a workspace as `a/<file>` and `b/<file>`, in an order
  chosen at random and recorded only outside it, with the reference
  adapter as `<file>`. A fresh agent (`npm run task run <n>.d`) reads both
  and writes `distinguish.test.ts`: top-level tests, each passing on one
  of A and B and failing on the other. Its report lists each test, what
  differs, and the spec text it thinks decides it.
- **Enforced.** The tests compile against the reference adapter, so they
  use only the interfaces and the spec's exports. The lint holds them to
  the workspace's files, Node built-ins and fast-check. `check` runs every
  test as A, as B and as the reference, and fails any test that passes or
  fails on both. A test that breaks a `@requires` would tell them apart
  trivially; the reference's result and the review catch those.
- **Collecting** keeps the tests as `distinguish/task-<n>.distinguish.ts`,
  the report as `reports/task-<n>.d.md`, and in `tasks.json` which run was
  A, and each test's result as A, B and the reference.

## 3b. Review the distinguishing tests (human and design agent)

The review, `reports/task-<n>.d.review.md`, has a Tests section with one
bullet per test and a Notes section, as in 2b:

| Finding | Meaning | What follows |
|---|---|---|
| **freedom** | The difference is in something the spec leaves open | Nothing; it should match a choice 2b marked open in one of the two reports, and if neither report listed it, that report was incomplete |
| **spec gap** | The difference is in behavior the spec meant to decide | Phase 1: a rule or decided behavior, a contract test, and an adversary from the implementation that loses; the loser goes back for another attempt |
| **contract gap** | One implementation breaks an existing rule no contract caught | Phase 1: a stronger contract and an adversary; that implementation goes back for another attempt |

Spec gaps and contract gaps per task, against the task's rule count, are
the measure. Freedoms show how much the spec leaves to the implementer.
