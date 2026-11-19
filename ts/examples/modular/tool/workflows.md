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
