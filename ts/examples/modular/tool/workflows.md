# The workflows

How a team of humans and agents builds the [elements](elements.md) of a
project: how a design moves from discussion to an agreed, checked
blueprint, and from there to implementations. Why the method looks like
this is in [motivation.md](motivation.md).

Status: draft, 2026-11-19. Sections say Agreed (the human agreed it in
discussion) or Proposed (the design agent's draft, not yet agreed).
Written to be read by people and held by a docgent, like `elements.md`.

## Summary

- The workflows are organized around the human's
  [inner loop](#the-inner-loop): the time from a design decision to
  feedback on it should approach zero.
- Workflows are operations on elements. They add one concept of their
  own, the [proposed change](#proposed-changes): a change to elements,
  not yet applied.
- [Roles](#roles) are functions, not people. Each has its own tools, and
  each restriction on a role is enforced, not only stated.
- In the [fast loop](#the-fast-loop), the human and the design agent
  propose changes and agree on them by agreeing on their consequences,
  checked in seconds.
- [Slow loops](#slow-loops) (checking, challenge, generation,
  distinguishing, and their reviews) run in the background and propose
  changes as they go, not only at the end.
- The human picks how [views](#views) are shown.
- Auxiliary workflows build on the main one:
  [vibe coding](#auxiliary-workflow-vibe-coding),
  [extraction](#auxiliary-workflow-extraction),
  [debugging](#auxiliary-workflow-debugging),
  [refactoring](#auxiliary-workflow-refactoring) and
  [porting](#auxiliary-workflow-porting).

## The inner loop

Status: Agreed 2026-11-19.

Human attention is the scarce resource (see
[motivation.md](motivation.md)). The workflows aim to keep the human in
flow at the level of the design: the system keeps offering proposed
changes, views and explanations of the right number and size, and each
proposed change gets some feedback immediately.

There are two kinds of loop:
- **The fast loop** runs around the human. Everything in it answers in
  seconds: proofs, rule compilation, type and boundary checks, and rule
  expressions evaluated on scenarios.
- **Slow loops** take minutes to hours: writing tests, challenge runs,
  implementation runs, comparing implementations. They run in the
  background and never block the fast loop.

**Incremental.** A slow loop doesn't hold its results until it ends. The
design agent reads its reports as they arrive and turns them into
proposed changes of the right size while the loop keeps running.

## Proposed changes

Status: Agreed 2026-11-19.

Elements are what exists; workflows are operations on them. The one
concept the workflows add is the **proposed change**: a change to
elements that hasn't been applied. It may add, change or remove a
member, a rule, a scenario, a placeholder, or a module's structure.
Everything else a workflow needs is an element, is computed from
elements, or is a record of who did what:

| What a workflow needs | What it is |
|---|---|
| a question | a proposed change, or several alternative changes when there's a choice |
| the options | the alternative changes |
| the consequences | scenarios (allowed and forbidden) and proofs attached to the change: elements |
| where it came from | who proposed it, from what discussion or report: a record |
| agreed | the change is applied to the blueprint |
| checked, implemented | computed from the test infrastructure and the library, not stored |

A member, rule or scenario is therefore either in the agreed blueprint
or part of a pending proposed change. The pending changes are the
human's queue, like open pull requests, and agreeing to one is merging
it. Git may hold them directly, as branches or patches against the
design files (Proposed).

## Roles

Status: Agreed 2026-11-19, except the tools, which are Proposed.

A role is a function. One person or agent may hold several roles, and
several may hold one; the workflows don't change shape when the team
grows. Every proposed change is agreed or rejected by one accountable
human.

| Role | Does | Doesn't |
|---|---|---|
| Human designer | Brings intent and experience; proposes changes; agrees or rejects every change; starts each slow loop | Write implementations |
| Design agent | Proposes changes; formalizes discussion; attaches consequences; runs fast checks; turns slow-loop reports into proposed changes | Write implementations or (beyond the split line) test infrastructure |
| Checking agent | Writes the test infrastructure for the agreed blueprint: contracts, doubles, references, adversaries; reports where it read a rule or scenario differently | Change the design |
| Challenge agent (1b) | Is fresh; attacks a draft design: contradictions, gaps, undecided choices | Write implementations |
| Prover (1p) | Proves properties of the rules in Lean; may be the design agent | Change the design |
| Implementation agent (2) | Is fresh; implements blueprints from the design | Change the design or the checks |
| Distinguishing agents (3) | Are fresh; implement twice, then find where the two differ | Change the design |
| Coordinator ([vibe coding](#auxiliary-workflow-vibe-coding)) | Agrees or rejects proposed changes for the human; escalates to the human what the escalation rule says | Edit the design; propose changes |

**The split line** (Agreed). Which kinds of test infrastructure the
design agent may also write is a project setting. Early or small
projects may let the design agent write contracts; later, all of it goes
to the checking agent. The enforcement follows the setting, so moving
the line changes no workflow. The line is chosen to keep design
throughput up (see [Measurements](#measurements)).

**Why a separate checking agent.** It reads the design independently of
the design agent, so a rule or scenario that two readers understand
differently shows up as a proposed change rather than as a test that
encodes one reading.

**Tools of the design agent** (Agreed 2026-11-19). It has no general
shell, no network, and no writes outside the design:

| Tool | Does |
|---|---|
| read | design files, the catalog, reports, pending proposed changes |
| edit design | interfaces, rules, vocabulary, scenarios, module indexes, within a proposed change |
| check | typecheck, rule compilation, boundary and purity checks, catalog, Lean, rules on scenarios |
| propose | open a proposed change with its consequences, or alternatives; withdraw one |
| show | a view of part of the design, in the human's chosen form |
| launch | start a slow loop; asks the human each time |
| progress | read a running loop's reports as they arrive |

The other roles' tools are to be written the same way.

## Enforcement

Status: Agreed 2026-11-19.

Every restriction above has a mechanical check.

1. **Stage 1, now: permissions and hooks.** A setup step (like
   `task.ts make`) writes each role's Claude Code settings. Writes are
   allowed only to the role's paths, using the design/harness test
   `task.ts` already has; the shell is limited to an allowlist of
   checks; `launch` is behind a permission prompt, so starting a slow
   loop is the human's call by construction. A hook before each write
   refuses content outside the role. A hook after each write runs the
   fast checks and returns their results, so enforcement and the inner
   loop are one mechanism.
2. **Stage 2, later: a server of design tools.** Edits become
   operations on elements (add a member, a rule, a scenario), each
   validated before it touches a file.

**What counts as design** is checked by content, not only by path:
- an interface file holds declarations and tagged rules only;
- a module's `index.ts` holds type-only exports and its vocabulary;
- design files import only design files (checked today by the catalog);
- vocabulary functions are pure: no mutation, no classes, no I/O;
- implementations don't import vocabulary; test infrastructure may. A
  reference function in the vocabulary can't become an implementation
  by import.

## The fast loop

Status: Agreed 2026-11-19.

1. **Discuss.** The human and the design agent talk about a blueprint
   informally. Either may propose a member, a rule or a scenario,
   including one the other hasn't raised.
2. **Formalize, naming the readings.** The design agent writes the
   proposed change formally. Turning prose into an expression is where a
   reading gets chosen silently, so where the prose allows more than one
   reading, the agent proposes each as an alternative change, with
   scenarios that tell them apart.
3. **Attach consequences.** The design agent attaches what the change
   implies: scenarios it allows and forbids, derivations it proves,
   counterexamples ("these rules allow a shape no add made; intended?").
4. **Agree.** The human agrees or rejects the consequences. Agreement on
   consequences is agreement: the human can't agree to a consequence they
   don't follow, and the agent shows its reading by what it derives. An
   agreed change is applied, consequences included.
5. **Check fast.** The fast checks run after every edit, and their
   results come back in seconds.

**Scenarios are allowed or forbidden.** Rules judge a history of calls,
so a consequence is a call history with its results: a scenario. An
allowed scenario is one the rules must accept and implementations must
play; a forbidden one is a history the rules must reject. Both are
checked in seconds by evaluating the rule expressions on the history,
with no implementation; allowed ones are also played against
implementations later. This adds one field to the scenario's general
form in `elements.md` and no new element.

## Slow loops

Status: Agreed 2026-11-19.

Each runs in the background, started by the human, and proposes changes
as it goes. The design agent reads its reports as they arrive.

| Loop | Runs | Proposes changes from |
|---|---|---|
| Checking | on the agreed blueprint | adversaries that escape; rules or scenarios the checking agent read differently |
| Challenge (1b) | on a draft design | contradictions, gaps, undecided choices |
| Prove (1p) | on rules | counterexamples, which become forbidden scenarios or adversaries |
| Generate (2), with its review (2b) | per task | where the implementer had to choose; problems the review finds |
| Distinguish (3), with its review (3b) | per task, two runs | freedoms: where the design lets implementations differ |

The reviews, 2b and 3b, stay phases. They run alongside their loops and
report incrementally, so a finding reaches the human as a proposed
change while the runs continue.

## Views

Status: Agreed 2026-11-19 (the human's choice of form), Proposed (what is
shown).

Each human picks the default form: an HTML view in a VS Code panel or a
browser tab, or text with links to those views. Every view is built
from the same data, so both forms are always available.

What views show is mostly relationships, since shared understanding is
about how the parts of a design fit together:
- rules and the members and vocabulary they use;
- rule to rule: derives, conflicts, determines;
- imports and module structure;
- placeholders and every rule that mentions them;
- coverage: rules to tests to adversaries;
- proposed changes and what they would affect.

A view shows the neighborhood of the proposed change at hand, not the
whole design.

## Changing an agreed blueprint

Status: Agreed 2026-11-19.

A change goes through the fast loop like any proposed change. When it
is applied:
- members, rules and scenarios that depend on what changed (through the
  relationships above) are shown to the human, who may propose further
  changes;
- the checking agent updates the tests, and adversaries are rerun;
- each implementation in the library is rechecked. One that now fails
  leads to a proposed change of its own: reimplement it, or revisit the
  change.

## Auxiliary workflow: vibe coding

Status: Agreed 2026-11-19, except where marked Proposed or Possible.

**What it is.** A developer works the way vibe coding works today: they
describe what they want in prose and expect an implementation. A
**coordinator** agent takes the human designer's place in the main
workflow. It agrees or rejects the design agent's proposed changes,
including those from the slow loops (1b, 2b, 3), and decides which to
escalate to the developer. Everything else is the main workflow: the
proposed changes, their scenarios, the record of who decided, the
checks.

**Why.** The workflow still produces blueprints that correspond to the
implementations, and every design decision is an applied change with a
record ("decided by the coordinator for the developer") instead of a
choice buried in generated code. A mentor, architect or other leader
can later join as a human designer, review the coordinator's decisions
in the main workflow, reverse any of them as a proposed change, and
help the developer from a shared understanding of the design.

**The escalation rule.** There is an escalation rule: it says which
proposed changes the coordinator brings to the developer rather than
deciding itself. The coordinator may override it in either direction,
deciding one the rule would escalate or escalating one it wouldn't, and
each override is recorded. Possible rules, to be chosen by experiment
or by the developer:
- escalate a change whose alternatives differ on the outermost module's
  scenarios, which are what the developer can see; a choice that changes
  only internal blueprints stays with the coordinator;
- escalate a change to the outermost module's interface or to the
  modules' structure;
- escalate anything the developer's prose doesn't cover; when the
  coordinator decides one anyway, it records the decision as an
  assumption.

**The coordinator** (Agreed 2026-11-19). It is separate from the design agent,
with its own context, so that approval isn't the proposer approving
itself. Its tools are read, agree or reject, and escalate; it can't edit
the design. Escalated choices are shown to the developer as behavior,
such as two scenarios played side by side, rather than as rules, unless
the developer asks to see the blueprint.

**The profile** (Proposed). The full workflow pays for several
independent readings of the design, and each costs agent runs and
waiting. A profile is a setting, like the split line, that says how
many of those readings to buy and where. Vibe coding may use a lighter
one, but robustness matters most in this workflow, more than cost or
speed (Agreed 2026-11-19): the profile is lightened only where a loop
doesn't buy robustness.

| Knob | Full | Lighter | Given up |
|---|---|---|---|
| Distinguish (3) | every task: two implementations and a distinguishing run, about three times a task's cost | only where freedoms matter: the outermost module, concurrency and ordering | freedoms in the skipped modules |
| Challenge (1b) | every draft | once per module, on its first draft | gaps added by later revisions |
| Adversaries | several variants per rule, seeds 1 to 3 | one per rule while iterating, all seeds at milestones | test weaknesses found later |
| Prove (1p) | consistency and determinacy where rules translate | the outermost module, or rules about history and ordering | gaps in the other modules |
| Models | the strongest everywhere | a cheaper model for the checking agent and implementers; the design agent and coordinator keep the strongest | more failed runs and retries |
| Granularity | fine-grained blueprints | fewer, larger modules, with less overhead per task | coarser parts to review and replace |

- **The floor.** Every profile keeps what hypothesis 2 says produces
  robustness: blueprints with formal rules and scenarios, contracts, at
  least one adversary per rule, and the fast checks. Without these the
  workflow is vibe coding with extra steps.
- **Adaptive.** A profile starts light and turns on the heavier loops
  for one module when it shows a signal of weakness: the checking agent
  read a rule differently, an adversary escaped, an implementation
  needed retries, or the coordinator overrode the escalation rule. The
  budget goes where ambiguity has shown up, as the human's attention
  does in the main workflow.
- **Chosen by experiment.** The test of hypothesis 2 runs the same prose
  three ways: the full profile, the light profile, and a coding agent
  working from the prose directly. That shows how much robustness each
  loop buys. A loop that buys robustness stays, whatever it costs; cost
  and time are recorded, and the independent developer's threshold in
  `../costs.md` (rarely reaching a weekly limit on a $100 to $200 a
  month plan) is a secondary target.

**Hypotheses, to test.**
1. **The design is useful to others.** A mentor who joins later can
   understand the design and help the developer. Measured by how many of
   the coordinator's decisions the mentor reverses, and how long the
   review takes.
2. **The discipline gives more robust implementations.** Requiring the
   design to pass through the blueprint's formal language, with rules,
   scenarios, adversaries and comparison of implementations, should
   give fewer bugs than going straight from prose to code. The test:
   give the same few paragraphs to this workflow and, separately, to a
   coding agent that implements them directly, then compare quality.
   Possible measures: failures on acceptance tests written from the
   prose by an agent that sees neither implementation; bugs found by a
   blind review; and the defects introduced when each implementation
   takes the same later change request. Cost and time are recorded for
   each, against the estimate in `../costs.md`. The same experiment
   chooses [the profile](#auxiliary-workflow-vibe-coding), by running
   the workflow with both the full and the light profile.

## Auxiliary workflow: extraction

Status: Agreed 2026-11-19 as a workflow to support; how is to be
investigated, together, as a major task of its own.

**What it is.** Taking an existing code base and inducing modules and
blueprints from it. Many developers will want to see how much design
discipline they can bring to code they already have.

**How it fits.** Extraction leads into the main workflow. The design
agent proposes modules and blueprints; human designers and the design
agent then work out whether they are a reasonable representation of
what the code base actually does. This will need extraction tooling and
a good deal of visualization, and will be difficult but high value.
Once the main workflow has settled the main questions of how to
represent the code, developers of every experience level can work with
it, including through the [vibe-coding workflow](#auxiliary-workflow-vibe-coding).

**One check comes for free** (Agreed 2026-11-19). The existing code is the first
implementation in each extracted blueprint's library. The blueprint's
rules and scenarios must hold for it, and its contracts must pass on it,
which tests mechanically whether the extraction describes the code. The
code's existing tests are candidates for scenarios. Where the code
breaks a rule the designers want, the rule stays and the failure
becomes a proposed change to the implementation.

## Auxiliary workflow: debugging

Status: Agreed 2026-11-19, except where marked Proposed. As important as
design itself, and the most common workflow after it.

**The principle.** Reasoning deductively to find a bug is rarely useful
for more than a short time: humans and agents both have difficulty
tracing paths in their heads. It is far better to ask what we don't
know, and what would help us reason about the bug, and then to add
that to the system's design. An observable added to the design stays:
it helps with later bugs, and has the other uses of observables, such
as auditing. So debugging and design form a loop: observations help
debugging, and debugging adds observables to the design. This is the
principle "observability is design" in `../method.md`, applied to bugs.

**The design organizes what debugging gathers.** Logs, traces and other
observations can be shown along the design's structure: by module,
blueprint, member and rule. This makes the design extremely helpful in
visualizing what debugging gathers, so a developer sees a failure in
the terms the design was agreed in.

**Rules say whose bug it is** (Agreed 2026-11-19). An implementation that
records the calls at module boundaries turns a failing run into a
history, and the rule expressions judge it afterward. A broken
`@requires` blames the caller; a broken `@ensures` or `@invariant`, the
implementation; a broken `@initially`, whoever made the instance. That
points to one blueprint, one rule and one call, often before anyone
reads the code, and it works on failures from the field.

**The steps** (Agreed 2026-11-19, as an illustration, not a prescription).
1. **Reproduce** the failure, ideally as a recorded history: a
   scenario.
2. **Judge** it with the rules, a fast check.
3. **Triage** it:
   - no rule breaks: the design allows it, so a rule is missing; propose
     the rule, and keep the history as a forbidden scenario;
   - a rule breaks that the tests should have caught: strengthen them,
     with an adversary for the fault;
   - a rule breaks in an implementation that wasn't checked, or the
     fault is outside the design: fix the implementation, the wiring or
     the platform interface.
4. **Fix, and keep the scenario,** so the bug can't return unnoticed.
5. **Keep what helped.** Observables added to find the bug are proposed
   as changes to the design.

## Auxiliary workflow: refactoring

Status: Agreed 2026-11-19 as a workflow worth recording, less common
than debugging, with the description below.

- **Inside an implementation:** the blueprint doesn't change, so its
  checks show whether behavior is preserved. This is where the method
  saves the most.
- **Of the design:** splitting or merging modules, moving rules,
  changing internal blueprints. The external blueprint's rules and
  scenarios must be preserved. That is phase 1p's refinement obligation:
  prove the new internal design still meets the old external rules, and
  check that the outer scenarios still pass. Each step is an ordinary
  proposed change carrying that obligation.

## Auxiliary workflow: porting

Status: Agreed 2026-11-19, except where marked Proposed. A major value
proposition of the method.

**What it is.** Making an implementation of an existing design for
another platform, such as an iOS implementation of a web app. A porting
agent follows the design completely, and also copies choices the source
implementation made that the design leaves open, such as how the
controls look, so the implementations feel like one product.

**Shared choices become part of a new design.** The choices to copy are
found the way phase 3 finds freedoms, by comparing the source
implementation with the design. The human (or the coordinator) decides
which should be common, and those become part of a new design that the
implementations share. A shared choice is stated without naming a
platform ("one choice among a few options, all visible") so each
platform can meet it in its own way.

**Checking another language** (Agreed 2026-11-19). The rules are
TypeScript expressions; a port may be in Swift or Kotlin. Two ways, both
useful:
- **Recorded histories.** The port records its calls at module
  boundaries, the TypeScript rules judge those histories, and scenarios
  drive the port through its interfaces as messages (the scenario form
  already treats calls as encodable). The checks aren't translated, so
  no new reading is added, and the histories are the same observables
  debugging uses.
- **Translated tests.** The tests are translated into the port's own
  language, so they run natively. A translation is a new reading, which
  the adversaries, translated too, help keep honest.

Whether implementations must provide recorded histories is deferred
until test porting has been explored.

**Shared choices as scenarios** (deferred 2026-11-19, until further work on examples informs it). Whether the new design
of shared choices can be just added scenarios: the original design,
plus allowed and forbidden scenarios that state the choices in terms of
what a user does and sees, with no new rules.

## Measurements

Status: Agreed 2026-11-19.

- Human hours per session (`../design-costs.json`).
- Time from a proposed change to its first fast-check result.
- Time from agreement to a contract with its adversaries caught.

If the first grows, the [split line](#roles) moves. The second may be
slow; it is off the human's loop.

## Not yet decided

- The tools of roles other than the design agent.
- Where pending proposed changes live (git branches or patches, or
  something else), and how a view lists them.
- What views show (above).
- Which escalation rule the vibe-coding workflow uses by default.
- How extraction works: its tooling, its views, and how designers judge
  whether an extraction represents the code.
- Recorded histories at module boundaries: their form, and whether
  implementations must provide them. Deferred until test porting is
  explored.
- Whether a design of shared choices (for porting) can be covered by
  added scenarios. Deferred until further work on examples informs it.
- Errors and failure (deferred in `elements.md`).

## Decisions

- 2026-11-19: the inner loop organizes the workflows; slow loops propose
  changes incrementally, and the reviews 2b and 3b run alongside their
  loops.
- 2026-11-19: agreement is agreement on consequences; agents may propose
  changes, not only ask questions.
- 2026-11-19: workflows are operations on elements, with one concept of
  their own, the proposed change. Questions, options and readings are
  alternative changes; consequences are scenarios and proofs; where a
  change came from is a record; whether something is checked or
  implemented is computed.
- 2026-11-19: scenarios are allowed or forbidden, and both are checked by
  evaluating rules on their histories.
- 2026-11-19: each human chooses the default form of views, HTML or text
  with links.
- 2026-11-19: test infrastructure is written by a checking agent; the
  design agent writes the design and proofs. Which test infrastructure
  the design agent may also write (the split line) is a setting, chosen
  so design throughput doesn't drop.
- 2026-11-19: the design agent's tools, and enforcement by permissions
  and hooks first, a server of design tools later.
- 2026-11-19: vocabulary functions are pure; implementations don't
  import vocabulary, test infrastructure may.
- 2026-11-19: vibe coding is an auxiliary workflow in which a
  coordinator agent agrees or rejects proposed changes for the human.
  There is an escalation rule, which the coordinator may override, with
  each override recorded; which rule is still open. Robustness matters
  most in this workflow, more than cost or speed. Two hypotheses are
  recorded for testing: the design helps a later mentor, and the
  discipline gives more robust implementations than prose straight to
  code.
- 2026-11-19: extraction (inducing modules and blueprints from an
  existing code base) is an auxiliary workflow that leads into the main
  one and then into vibe coding. How to do it is a major task to
  investigate together. The existing code is the first implementation
  in each extracted blueprint's library, so its contracts must pass on
  it; existing tests are candidates for scenarios; where the code breaks
  a rule the designers want, the rule stays and the failure becomes a
  proposed change to the implementation.
- 2026-11-19: debugging is an auxiliary workflow, as important as design.
  Deduction is used only briefly; instead, ask what we don't know and add
  observables to the design, where they help later bugs and auditing.
  The design's structure organizes what debugging gathers, such as logs.
- 2026-11-19: refactoring is a workflow worth recording, less common than
  debugging.
- 2026-11-19: porting is a major value proposition. The port follows the
  design completely and copies the source implementation's choices
  where they should be common; shared choices become part of a new
  design that the implementations share. Other languages are checked
  through recorded histories or translated tests; requiring recorded
  histories is deferred until test porting is explored.
- 2026-11-19: blame from rules, and the debugging steps as an
  illustration, not a prescription.
