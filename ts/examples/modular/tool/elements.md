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
  history generators drive calls for the rules to judge, drivers play
  scenarios, and
  [adversaries](#adversaries) check the tests.
- A blueprint's [library](#library) holds its implementations, each
  passing the checks.
- A [module](#module) has one external blueprint and a set of internal
  blueprints that only the module can see. Modules nest: a nested
  module's external blueprint is one of its parent's internal
  blueprints.
- A module defines an [archetype](#archetype): the design that every
  implementation of it shares.
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
- `@initially`: whoever makes the object's, true of every instance
  before its first call;
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

**Instances, not creation.** Rules speak of all instances of an
interface, never of how one is made. A rule written as an arrow function
holds for every instance of its parameter's type: `new-ids` is a rule
about every pair of processors. `@initially` says what holds of every
instance before its first call, whether a constructor, a factory or a
caller that supplies its parts made it. How instances are made belongs to
the [library](#library) and to a module's wiring, not to the design:
each implementation in the library says how it is made, which is an
agreement between the library and the test infrastructure. A meaningful
creation parameter is exposed as a member; a relation to a supplied part
is a member or a scenario; limits on how many instances may exist are
rules over pairs of instances. (Agreed 2026-11-18.)

Creation becomes part of the design only when a module is made from
outside the project, as a published package is, or for the outermost
module's entry point. Then the external blueprint includes a maker
interface (`make(...)` returning the external interface), with rules like
any other member; obtaining the first maker is one binding per program,
done by the host outside the design.

**Why formal.** A design whose statements are all formal can be checked
mechanically, and prose leaves room for readings that differ. Every
statement in a blueprint is a declaration, a rule expression or a test,
and prose only glosses one of them (`../method.md`, "The design").

**Checking prose against the rules.** Prose in a blueprint makes claims:
a rule's headline, a doc comment, a sentence in the brief or in a task.
A prover can ask whether the rules entail each one. Stating the claim
formally is where ambiguity shows: a sentence with two readings gets
both, and each is tried. A claim then ends up entailed (a theorem, which
needs no rule of its own), not entailed (a gap, with a counterexample),
contradicted, ambiguous (the rules settle which reading the design
means, and the prose is rewritten to say it), or unchecked (outside what
the prover can state, such as timing or "one user in one process"). The
prose isn't removed; it becomes checked prose with its formal statement
beside it. Those statuses are bookkeeping for the agents. The human sees
the consequences: an allowed or forbidden scenario, a counterexample to
judge, a law that holds, in a view of small surface area
(`workflows.md`, "The fast loop"). (Agreed 2026-11-19.)

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
each term is itself formal, so nothing is lost. A module's vocabulary is
part of what it offers: other modules' rules are written in it, rather
than each module reinventing its terms (agreed 2026-11-18).

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
| Rule | its expression, in its vocabulary | a history generator, which makes calls for the expression to judge |
| Scenario | its test case, as data | a driver, which plays the case |

**The general form** (agreed 2026-11-18). A scenario is a sequence of
steps, each one either:
- a call on the external interface of a named instance (scenarios may
  use several, such as two clients), with its expected result and events
  written as expressions in the vocabulary; or
- a step on a double of one of the module's imports: the environment,
  such as a network that holds or releases messages.

A scenario is **allowed** or **forbidden** (agreed 2026-11-19). An
allowed scenario is a history the rules must accept and implementations
must play; a forbidden one is a history the rules must reject, such as a
model holding a shape no add made. The consequences the human agrees to
are kept as scenarios of both kinds.

**Written in a functional subset of TypeScript** (agreed 2026-11-19). A
scenario is a function of its instances: `scenario(id, kind, headline,
play, where?)`, where `play`'s parameters are the instances, typed by the
interface each is used as. Its body is `const` declarations and
expression statements; every other arrow function has an expression
body. Expressions are names in scope, literals, property reads,
arithmetic, comparisons, logical operators and `?:`, and calls on the
instances, the vocabulary and the array built-ins (`map`, `forEach`,
`every` and the like). No assignment, loops or `if`, so the only effects
are calls on the instances. `expect(e)` states an expected effect. `check`
enforces the subset with a parser. TypeScript rather than a pseudo-code
because it typechecks against the interfaces and shares the rules'
expression language; the same text is played on an implementation and
judged without one. Views render it compactly for the human, such as one
line of calls and an arrow to what is expected.

**Parameterized scenarios** (agreed 2026-11-19). Parameters after the
instances are values the scenario holds for every choice of, like a rule
written as an arrow function; `where` limits them. Values are generated
from their types. A scenario with no such parameters is the exact case.
For example, the undo list's "every change can be undone, back to the
empty list" is a scenario over every list of texts.

**Judged or played** (agreed 2026-11-19). An expectation written in the
vocabulary, about what the interfaces expose, can be **judged** without
an implementation. One about pixels or timing, which is outside logic,
can only be **played** against implementations, in a slow loop.

**How judging works** (agreed 2026-11-19). Rules read state such as
`old(this.past)`, which a scenario's expectations don't give in full, so
judging needs a witness: a state at each step that meets the
expectations. The witness is detail for the AI and belongs to the
checking side, not the design. For a scenario over many values it has to
be computed, so it comes from a reference, a small model written for
checking. The scenario is played on the references with every rule
checked on every call:
- **Allowed:** if the references break no rule and every expectation
  holds, their states are a witness that the rules allow the scenario.
  This is sound, and it needs no phase 2 implementation. It rests on the
  reference, which is itself checked against the rules as it plays.
- **Forbidden:** one witness that breaks a rule proves nothing, since
  another might not. Showing that no witness satisfies the rules is
  entailment, so a forbidden scenario is proved (phase 1p) and until
  then is reported as unproved. A theorem with the scenario's ID
  (dashes as underscores) proves it, as a test with a rule's ID checks
  the rule. Evaluation still catches one fault
  fast: if the references play a forbidden scenario without breaking a
  rule, the rules allow it.
- A scenario that breaks a `@requires` rule is outside the rules, and a
  reference that breaks a rule is a fault of the reference; both are
  reported.

The method can then supply one driver for every project. For now
everything is an interface: services reached by REST or RPC are
interfaces too, and the message passing is an encoding of the calls.
Steps of other kinds, for projects that aren't built from interfaces,
are left until a project needs them.

**In the example.** `scenarios.ts` holds the circles app's scenarios as
data: actions, network steps, and effects on the visible canvas.
`driver.ts` and `scenariokit.ts` play them. They become calls on the
app's external interface, in the subset, once that interface is agreed;
until then their expectations are about pixels, so they are played, not
judged. `../undo/scenarios.ts` is written in the subset, and `typearc
check` judges it on `../undo/listkit.ts`.

## Placeholder blueprints

Status: agreed 2026-11-18. None written yet.

**What it is.** A blueprint whose design is left to the implementer, but
which states the obligations any design of it must meet. It names the
interface and gives its rules, and may leave its members open.

**Why.** Rules elsewhere can need a part nobody has designed: the
`MessageProcessor` rules `formed-now` and `infrastructure-only` speak of
a controller, which has no interface. A placeholder makes that part, and
what it owes the rest, explicit, instead of leaving it to prose.

**Like a type parameter, but more.** A module with a placeholder is
generic in it, the way `Box<T extends Bound>` is generic in `T`. Each
implementation fills the hole with its own design, as an instantiation
supplies a type, and the placeholder's rules are the bound that every
filling must meet. A bound on a type parameter can only be a type,
though, and it sits in one place. A placeholder's obligations are rules
and scenarios, they can relate the hole to other blueprints in the
module (`formed-now` relates the controller to the processor), and the
hole can be a whole part whose members the implementer designs.

**Why holes can have more structure here.** Type parameters stay simple
partly because people have to keep track of every place a parameter is
used and what each use requires. A richer hole has more of these
correspondences: every rule and scenario that mentions it. AI helps the
human team keep track of them, and the checks confirm that each filling
meets them.

**In the example.** The first is to be a `Controller` placeholder in
circles, for the part that turns a user's input into operations.

## Test infrastructure

Status: agreed 2026-11-18.

**What it is.** Everything that checks blueprints:
- **history generators**: make histories of calls on an implementation,
  each call satisfying its `@requires` rules, so that the rule
  expressions can judge every call. A failing history is shrunk to the
  shortest one that breaks the rule, which reads as a scenario. A
  generator never defines or judges a rule: the expressions do. Where
  random calls rarely reach a boundary, hand-written code may bias the
  calls toward it;
- **drivers**: play scenarios against an implementation;
- **doubles**: stand-ins for a blueprint's imports, so one blueprint is
  tested alone;
- **references**: simple implementations used as a yardstick, for
  example to judge whether a test is fair;
- **[adversaries](#adversaries)**: deliberately wrong implementations,
  each of which the tests must catch.

A test's name is the ID of the rule or scenario it checks.

**In the example.** History generators are the `<name>.contract.ts`
files, under their old name, "contracts", which was dropped because it
reads as design by contract (whose contracts are our rules). They also
judge and, for rules with only a headline, define rules; that is the
legacy case, and it ends as those rules get expressions. `typearc
check` requires an expression for every rule it evaluates. The tool's
generic history generator is `cli/histories.ts`: it needs no
hand-written file. It reads the members and their parameter types,
keeps only calls whose `@requires` holds, and fails a check if some
rule is never evaluated. A number parameter that a `@requires` rule
bounds, such as `0 <= index && index < this.length`, is chosen in the
range the rule allows in the current state; each such call falls in one
of the range's categories (its only position, low edge, high edge or
middle), and a check fails if some category is never reached. Other
arguments that break a `@requires` rule are replaced by small numbers
that keep it. Histories are up to 100 calls long. `typearc check` runs it on the references and on each
adversary; `typearc test` on the library. References and doubles are
`*kit.ts`; adversaries are in `adversaries/`; `testkit.ts`
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

**How a module is declared.** In plain TypeScript, with no new syntax
and no runtime values:
- **A module is a directory,** as it is in ECMAScript and Node.
  Subdirectories are nested modules. The project's root directory is the
  outermost module.
- **Its `index.ts` is its external blueprint:** type-only exports of one
  interface and of every type its members' signatures reach,
  transitively, and nothing else. Those defined in the module are part
  of its external blueprint, rules included: `ShapeMessageProcessor`'s
  `model` is a `ShapeCollection`, so the collection's rules are visible
  outside too. Those defined elsewhere come from the modules it imports.
  It also exports the vocabulary its rules are written in: those exports
  are values, the only values an index may export, because they are
  part of the design and other modules' rules build on them.

  ```ts
  // shapes/index.ts
  export type { ShapeMessageProcessor, ShapeOp, ShapeId } from "./shapeModel.ts";
  ```
- **Everything else in the directory is internal.** A design file outside
  the directory may import only its `index.ts`, as a package's `exports`
  map restricts what Node lets others import.

Both rules (an index holds only type-only exports; imports from outside
go through the index) are to be checked mechanically, as design imports
are checked today. TypeScript namespaces are not used.

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

## Archetype

Status: agreed 2026-11-19. A concept, not a separate element.

**What it is.** The design a [module](#module) defines: its external
blueprint and the internal blueprints it composes, with their rules and
scenarios, which every implementation of the module shares. Humans and
agents agree on the archetype, and the checks confirm that each
implementation is a faithful instance of it. As in Campbell's *The Hero
with a Thousand Faces*, there is one story and many tellings: the module
is the story, its internal blueprints are the roles in it, its scenarios
are the plot, and each implementation is one telling.

**What belongs to it.** The internal structure does. A module's
implementation is its internal blueprints' implementations wired
together, so every instance has the same parts. Where the design leaves
structure to the implementer, it says so with a
[placeholder blueprint](#placeholder-blueprints), a part the archetype
requires but doesn't specify. Nested modules are archetypes within the
archetype; the project, the outermost module, is the whole.

**Why the term.** It names what the method is for: a shared
understanding, among the humans and agents on a team, of a design that
holds whichever implementation is used. It also says where things
belong. Proofs in phase 1p are about the archetype, since they need only
the rules and the vocabulary; phase 3 compares two instances of it, and
the freedoms it finds are where the archetype lets instances differ.

**Not (yet).** An archetype is not a file or a template. Reusing one
archetype across projects, as a catalog of designs, isn't part of the
method today.

## Visibility to the implementer

Status: Open. One experiment run (2026-11-18); see below.

**The question.** How much of a blueprint's checks a fresh implementing
agent should see.

**Today.** An implementing agent reads the interfaces, rules,
vocabulary, scenarios and the history generators, and runs the tests. It can't
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
- The checks for modules aren't built, and the circles files aren't yet
  divided into modules.
- Proof for some rules, as an alternative to testing (see [Rules](#rules)).
- The workflows: how a developer creates, agrees, implements, reviews
  and changes these elements. That is the next document, and the next
  session's priority.
- Errors and failure: how a rule states what a call does when it fails.
  Deferred, as a large topic of its own.

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
- 2026-11-18: a module is a directory whose `index.ts` exports, type-only,
  one interface and the types its signatures need; subdirectories nest.
  No module syntax, namespaces or runtime values.
- 2026-11-18: a module's external blueprint is one interface plus every
  type its signatures reach, transitively, rules included; and the
  outermost module, the app, gets an external interface of its own
  (its members and rules to be agreed).
- 2026-11-18: a module's index exports its vocabulary as values, the only
  values it may export; rule functions are part of a module's value.
- 2026-11-18: creation stays out of the design, except for modules made
  from outside the project, whose external blueprint then has a maker
  interface.
- 2026-11-18: a scenario's steps are calls on named instances' external
  interfaces, and steps on the doubles of the module's imports;
  interfaces only, for now.
- 2026-11-18: a budget's complexity class holds for every call in every
  state; its workloads only measure it (`within` in `rules.ts`).
- 2026-11-18: placeholder blueprints state the obligations of a part
  whose design is left to the implementer. Every "Decided behavior" item
  in a task spec cites a rule, or moves to "Left to the implementer",
  enforced by `task.ts lint` (to be built). The circles files stay flat
  until the tool exists. Errors are deferred.
- 2026-11-18: rules speak of instances, not creation: arrow-function
  rules quantify over all instances, and `@initially` (new) says what
  holds before an instance's first call. No factory types in the design.
- 2026-11-18: the developer workflow and its tools come before more work
  on the circles example, following feedback from experienced developers
  who want to try the method.
- 2026-11-19: a module defines an archetype, the design every
  implementation of it shares, internal structure included. A concept,
  not an element; a blueprint is not an archetype. Placeholder
  blueprints are like type parameters, with rules and scenarios as their
  bounds; holes can have more structure because AI helps the team track
  the correspondences.
- 2026-11-19: scenarios are allowed or forbidden; both are checked by
  evaluating rules on their histories. The workflows add one concept,
  the proposed change (`workflows.md`).
- 2026-11-19: scenarios are written in a functional subset of TypeScript,
  enforced by a parser, and rendered compactly in views. They may have
  parameters with a where condition. Expectations are judged or played.
  Allowed scenarios are judged on references, as witnesses; forbidden
  ones are proved, and are unproved until then. This corrects the
  earlier entry: evaluation alone can't show that a scenario is
  forbidden.
- 2026-11-19: prose is checked against the rules by asking whether they
  entail it; each claim gets a status (entailed, gap, contradicted,
  ambiguous, unchecked) for the agents, and the human sees consequences.
- 2026-11-19: "contract" is renamed "history generator": test
  infrastructure that makes histories of calls satisfying `@requires`,
  for the rules to judge. It never defines or judges a rule. The circles
  `.contract.ts` files keep their name until circles moves onto the tool.
