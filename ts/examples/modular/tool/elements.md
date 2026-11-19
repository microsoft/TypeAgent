# The elements

What a project built with this method consists of. This is the first part
of the tool's definition; the workflows that create and check these
elements come next, in their own document.

Status: agreed by the human and the design agent on 2026-11-18, except
where a section says Open. Written to be read by people and to be held by
a docgent (`../docgent/plan.md`). Each element has a section with a
stable heading. Each section says what the element is, why it is that
way, where it appears in the circles example, and what is still open.
"Agreed" means the human agreed it; "Open" means it is not decided, and
an answer that says otherwise is wrong.

## Summary

- A [blueprint](#blueprint) is one interface, with its
  [imports and exports](#imports-and-exports), its [rules](#rules) and its
  [scenarios](#scenarios).
- A rule is a formal expression written in its [vocabulary](#vocabulary).
  A scenario is defined by its test case.
- The [test infrastructure](#test-infrastructure) checks the blueprint:
  contracts check rules, drivers play scenarios, and
  [adversaries](#adversaries) check the tests.
- A blueprint's [library](#library) holds its implementations, each
  passing the checks.
- A [module](#module) has one external blueprint and a set of internal
  blueprints that only the module can see. Modules nest: a nested
  module's external blueprint is one of its parent's internal
  blueprints.
- [Platform interfaces](#platform-interfaces) are imports whose
  implementation is outside the project.

## Blueprint

Status: agreed 2026-11-18.

**What it is.** One interface, with:
- its [imports and exports](#imports-and-exports): the other interfaces
  and types it uses and what it offers;
- its members;
- its [rules](#rules), each a formal statement about its members;
- its [scenarios](#scenarios), each defined by a test case.

The blueprint is the design. What checks it is the
[test infrastructure](#test-infrastructure), which is kept apart: the
design never imports or names it.

**Why one interface.** It is the smallest unit someone can agree,
implement, replace and check on its own. A rule that relates two
interfaces belongs to the interface whose member it constrains, and may
use what that interface imports.

**Why the design is kept apart from its checks.** The human agrees the
design. Much of the test infrastructure is the design agent's work, and an
implementer may not be shown all of it (see
[Visibility](#visibility-to-the-implementer)). Keeping them apart also
keeps harness words out of the design, so the people and agents who
agree on it share one vocabulary.

**In the example.** Interface files such as `shapeModel.ts` hold several
blueprints each: `ShapeCollection`, `ShapeCollectionWriter`,
`ShapeMessageProcessor` and others. A file is grouping, not a unit of the
method. `npm run catalog` lists every interface with its rules
(`catalog.md`).

## Imports and exports

Status: agreed 2026-11-18.

**What it is.** What a blueprint uses from other blueprints, from
[platform interfaces](#platform-interfaces) and from its own vocabulary,
and what it offers to others. An interface that extends another imports
it.

**Why it is an element.** Dependencies are what make substitution and
[information hiding](#module) checkable: a test of one
blueprint replaces each import with a double, and a module's boundary is
a rule about who may import what.

**In the example.** TypeScript imports between design files.
`catalog.ts`'s boundary check refuses a design file that imports
anything outside the design. Each implementation task lists the files it
may import, and `task.ts` lints the result against that list.

## Rules

Status: agreed 2026-11-18.

**What it is.** A statement about an interface's members, with a tag
that says whose obligation it is and when it holds:
- `@requires`: the caller's;
- `@ensures`: the implementation's, on return;
- `@invariant`: the implementation's, for one object, at all times;
- `@valid`: which values of a type are legal;
- `@abstract`: stated once, made testable by each interface that
  refines it;
- `@budget`: a cost, named by a complexity class with a measurement as
  its proxy;
- `@deferred`: a decided rule not yet in force, with when and how it
  will be.

Each rule has a slug, a one-line headline and, when it can be written, a
TypeScript boolean expression. The expression is the rule; the headline
is a gloss on it. A rule's ID is `Interface.member.slug`.

**Why formal.** A design whose statements are all formal can be checked
mechanically, and prose leaves room for readings that differ. Every
statement in a blueprint is a declaration, a rule expression or a test,
and prose only glosses one of them (`../method.md`, "The design").

**In the example.** Tagged comments in the interface files; the format
is in `../rules.ts`. Expressions are compiled (`../ruleGen.ts` writes
`../rules.gen.ts`, for `dataModel.ts` and `shapeModel.ts` so far) and
evaluated on the calls the tests make (`../ruleCheck.ts`).

**Open.** Rules in the other interface files are still headlines only;
compiling them is ongoing work. Whether some rules could be proved
rather than tested (with Lean or Dafny, say) is being investigated.

## Vocabulary

Status: agreed 2026-11-18.

**What it is.** The defined terms a blueprint's rule expressions use: TypeScript
functions over the interface and its history, such as `logged(p)`, the
operations a processor has reported applying. It is part of the rules,
just as test infrastructure is part of the tests: a rule's expression
means nothing without the terms it uses.

The rule language (`../rules.ts`) supplies the forms every vocabulary
builds on: `old(e)`, the value of `e` before the call; `history(o)`, the
calls made on `o`; `atEvent(i, e)`, the value of `e` when the call
emitted its `i`-th event.

**Why.** Terms let a rule read at the level the design is agreed at, and
each term is itself formal, so nothing is lost.

**In the example.** One `<name>.vocab.ts` per interface file, such as
`shapeModel.vocab.ts`.

## Scenarios

Status: agreed 2026-11-18.

**What it is.** A behavior of the blueprint, defined by a test case: the
steps and the expected effects, written as data in the design's terms.
The scenario's prose, if any, is a gloss. The [driver](#test-infrastructure)
that plays the case against an implementation is test infrastructure.

**Why defined by the test.** A scenario's prose is informal and can be
ambiguous; its test case is not. This makes scenarios symmetric with
rules:

| | The formal statement (design) | What runs it (test infrastructure) |
|---|---|---|
| Rule | its expression, in its vocabulary | a contract, which makes calls for the expression to judge |
| Scenario | its test case, as data | a driver, which plays the case |

**In the example.** `scenarios.ts` holds the circles app's scenarios as
data: actions, network steps, and effects on the visible canvas.
`driver.ts` and `scenariokit.ts` play them.

## Test infrastructure

Status: agreed 2026-11-18.

**What it is.** Everything that checks blueprints:
- **contracts**: tests that drive an implementation through calls, so
  that the rule expressions can judge each call;
- **drivers**: play scenarios against an implementation;
- **doubles**: stand-ins for a blueprint's imports, so one blueprint is
  tested alone;
- **references**: simple implementations used as a yardstick, for
  example to judge whether a test is fair;
- **[adversaries](#adversaries)**: deliberately wrong implementations,
  each of which the tests must catch.

A test's name is the ID of the rule or scenario it checks.

**In the example.** Contracts are `<name>.contract.ts`; references and
doubles are `*kit.ts`; adversaries are in `adversaries/`; `testkit.ts`
and `ruleCheck.ts` are shared.

## Adversaries

Status: agreed 2026-11-18.

**What it is.** An implementation with one real fault, named for the rule
it breaks (`<RuleID>--<variant>`). The tests must catch every adversary.
One that escapes means the tests are too weak for a real fault, and they
are strengthened; if the fault turns out not to be real, the adversary is
removed and the reason recorded.

**Why.** Tests that pass prove little unless they are known to fail on
faulty code. Adversaries check the tests the way the tests check
implementations.

**In the example.** `npm run adversaries` runs all of them (173 on
2026-11-16, none escaping) on several random seeds.

## Library

Status: agreed 2026-11-18.

**What it is.** A blueprint's implementations. Each passes the
blueprint's checks, so any one can replace another.

**Why.** Interchangeable parts are one of the method's goals, and two
independent implementations of one blueprint show where it leaves
something open (phase 3 in `../method.md`).

**In the example.** Implementations sit next to the interfaces
(`shapeProcessor.ts`, `mapShapeCollection.ts`); second runs for phase 3
are in `alternates/`. Each is written by a fresh agent, never by the
design agent.

## Platform interfaces

Status: agreed 2026-11-18.

**What it is.** An import whose implementation is outside the project,
such as the browser's canvas. The part of the platform a blueprint may
use is declared as an interface, which implementers see. The double that
stands in for it in tests, and the check that the declaration matches
the real platform's types, are test infrastructure.

**Why.** It limits what an implementation can use to what has been
agreed, and it makes the platform replaceable by a double in tests. The
same form fits any outside dependency, such as an npm package.

**In the example.** `canvas.ts` and `dom.ts`, checked against the real
browser types in `../platform/`.

## Module

Status: agreed 2026-11-18. Not yet built in the example or the tools.

**What it is.** One external blueprint and a set of internal blueprints.
Modules nest: a nested module's external blueprint is one of its
parent's internal blueprints, and its own internal blueprints stay
hidden inside it. The module's rules belong to its external blueprint:
- **Visibility.** An internal blueprint may be imported only by the
  module's other blueprints. Outside the module, only the external
  blueprint is visible.
- **Composition.** The module's implementation is its internal
  blueprints' implementations wired together. The external blueprint's
  scenarios define the module as a black box and are run against that
  wiring.

Both are to be checked mechanically, as design imports are checked
today.

**Why.** Information hiding: a module's insides can change, or be
reimplemented, without changing anything outside it. And a large system
stays reviewable one external blueprint at a time.

**In the example.** The circles app is in effect one module: its
scenarios in `scenarios.ts` treat it as a black box, and shapes, the
view, layout and event distribution are its internal blueprints. Nothing
yet marks or checks that boundary.

**The project.** The project itself is the outermost module, so every
blueprint belongs to some module. For the circles app, the app's
scenarios belong to the project's external blueprint.

## Visibility to the implementer

Status: Open. One experiment run (2026-11-18); see below.

**The question.** How much of a blueprint's checks a fresh implementing
agent should see.

**Today.** An implementing agent reads the interfaces, rules,
vocabulary, scenarios and the contracts, and runs the tests. It can't
read the adversaries or its own reference, and it can write only its
outputs.

**The design agent's proposal.** The agent sees the statements: rules
with their vocabulary, and scenario test cases. It may run the rule
checks but not read their code; a failing test carries its rule's ID,
which points back to the statement. The checks then work as a held-out
exam, and the agent can't code to the test.

**The experiment.** `node task.ts make <n> --tests runnable` denies the
agent reading the test infrastructure while `npm test` still runs it.
The first run, task 9.2 on Sonnet (`../experiments/visibility-1/`),
passed every check and its budgets, at $1.30, 30 turns and 10.7 minutes,
against $1.49 to $2.16, 25 to 36 turns and 11 to 16 minutes for four
earlier runs that could read the tests. The agent never tried to open a
test file. That is one run, on a spec already refined by earlier
attempts, so the question stays open; the next test is a task with a
fresh spec, run both ways.

## Not yet decided

- [Visibility to the implementer](#visibility-to-the-implementer).
- How modules are declared and checked: the [module](#module) section
  says what is agreed.
- Proof for some rules, as an alternative to testing (see [Rules](#rules)).
- The workflows: how a developer creates, agrees, implements, reviews
  and changes these elements. That is the next document.

## Decisions

- 2026-11-18: the elements as above. A blueprint is a single interface;
  its imports and exports are elements; vocabulary is part of the rules,
  as test infrastructure is part of the tests; scenarios are defined by
  their test cases; platform declarations are imports, and their doubles
  are test infrastructure; implementations form a blueprint's library;
  modules nest, and visibility and composition belong to the module's
  external blueprint.
- 2026-11-18: "module blueprint" replaced by module, an element of its
  own: one external blueprint and a set of internal blueprints. The
  method's elements are then blueprints and modules.
- 2026-11-18: the project is the outermost module.
- 2026-11-18: the developer workflow and its tools come before more work
  on the circles example, following feedback from experienced developers
  who want to try the method.
