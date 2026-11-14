# Proposal: a design made only of formal statements

Status: the principles were agreed on 2026-11-13 and are now in
`method.md` ("The design"), with the agent's conduct on new statements
(proposal 6 below). Revised the same day: the human agrees to new or
changed interfaces, members, rules and scenarios, and the terms are
derived from them. The reasoning is in `moduleTooling.md` ("Why the
design is formal"). This file keeps what is still pending: proposals 2,
3, 4, 5 and 7, the open points, and the proof investigation.

## Where the design stands (2026-11-13)

- **Compiled:** every rule with an expression in `dataModel.ts` and
  `shapeModel.ts`, and every rule in `shapeModel.ts` has one (the pilot,
  `pilot-shapeModel.md`). Their contracts no longer restate expressions.
- **Not yet:** the other interface files. Before the pilot, roughly 45 of
  84 `@ensures`, 13 of 22 `@requires`, all 3 `@budget` and 1 of 4
  `@invariant` rules across the design had no expression.
- **Other prose in design files:**
  - The meaning of the network steps (hold, release, sync) is a comment
    in `scenarios.ts`, implemented only in the test driver.
  - Header comments (`scenarios.ts`, vocabulary files) gloss no single
    statement.
  - Headlines, doc comments and scenario `story` strings gloss a
    statement but don't all reference it.
  - `ShapeCollection`'s doc says in prose that `indexed(this)` is the
    shapes `forEach` visits; it belongs to `shape.ts`'s rules.

## Proposals

1. **Give every rule a formal statement.** Done for `shapeModel.ts`; the
   other interface files follow, one at a time, each added to `ruleGen.ts`.
   - An expression where practical. This needs vocabulary for events and
     changes (for example `emits(call, "change")`, `unchanged(call)`) and
     for measurements (`perOp(100_000) / perOp(1_000) <= 16`). Each new
     word is a design decision.
   - Otherwise a defining test. The rule names it, and it is written in
     design vocabulary only (see 3).
   - `@abstract` rules either get an expression over an abstract model, or
     are defined as exactly what their `@refines` say.
   - With expressions throughout, a contract shrinks to input generators
     and a generic evaluator, so the harness can't quietly define what a
     rule means. The adversaries still check the generators.

2. **Check glosses mechanically.** The catalog refuses:
   - prose in a design file that isn't attached to a formal statement;
   - a gloss that names a symbol not declared in a design file;
   - any retired term (kept in a short retired list with its replacement,
     such as "device context" → "platform subsets"), in every file.

   It also generates the list of design terms from the declarations,
   replacing the hand-written glossary and the `harnessWords` blocklist.
   Whether a gloss says the same thing as its statement can't be checked
   mechanically; that is item 5.

3. **Split defining tests from the harness.** A test that defines a rule or
   a scenario is design: it uses only design symbols and imports only
   design files. The harness supplies what such a test is run with
   (generators, wiring, the test driver for each platform).
   - For scenarios, the definition is the scenario data plus a design-level
     meaning of each step. The network steps become a design function,
     say `sequenced(sent, netSteps)`, and the test driver must use it. How
     each platform performs an action stays in the harness; actions are
     primitives whose meaning the scenarios fix.
   - Open: where the line falls in `scenario.contract.ts`, whose `Driver`
     interface is the boundary between the two.

4. **Separate documents for each layer.** The design is read from the
   catalog (generated from design files only) and a design-only
   `behavior.md` (the scenarios' intent as glosses, decisions, open
   questions). The harness is described in `moduleTooling.md` and a
   harness part of `STATE.md`.

5. **A comprehension check in phase 1b.** A fresh agent gets only the
   design files. It lists every symbol it can't understand from them,
   reports each gloss that disagrees with its statement, and answers a few
   questions about the design (for example, what happens when a remote add
   arrives while a local add is pending).

6. **How the agent talks to the human.** Agreed 2026-11-13; now in
   `method.md`, phase 1.

7. **A design directory, later and only if leaks continue.** Moving design
   files into `design/` puts the boundary in the file system. It is the
   most invasive step: the lint, `task.ts` workspaces and every import
   assume a flat directory.

## Relating tests to expressions (to investigate)

A rule's expression and a test can both be formal yet disagree, and a test
can check less than its rule says. We want to relate them with proof
techniques, either directly (a TypeScript test to a TypeScript expression)
or through an intermediate predicate-calculus form that both convert to
or compare with. Candidates to evaluate:

- a restricted, pure TypeScript subset for expressions, vocabulary and
  defining tests, with a mechanical translator to the intermediate form.
  The translator is the trust gap, so it should be small;
- Lean 4 as the checker, with agents writing proofs that Lean's kernel
  checks;
- Dafny as the intermediate form, verified, then compiled to JavaScript
  for the runtime checks;
- an SMT solver (Z3, cvc5) for equivalence and implication between
  first-order predicates. Floats and quantifiers are the known
  difficulties.

Other proof targets the same machinery would serve: `@refines` claims (a
concrete rule implies the abstract one), consistency of a rule set, and
properties of vocabulary functions.

### Survey (2026-11-13, by an agent from web sources; not yet tried here)

- **Translators from TypeScript exist, as previews.**
  - LemmaScript (github.com/midspiral/lemmascript): TS with
    `//@ requires/ensures` comments compiles to Dafny, or to Lean 4 through
    Velvet. The generated file can always be regenerated, and only proof
    additions are allowed on top of it, so an agent can't weaken a
    statement. It also has a check of natural-language contracts against
    their formal specs. It is a "tech preview".
  - Thales (github.com/jessealama/thales): a strict TS subset compiles to
    Lean 4, with floats as 12 stated axioms. It has one release.
  - ESVerify (a TS-like subset checked with Z3) looks unmaintained.
- **Lean 4 is the suggested target.**
  - A small kernel checks every proof.
  - Plausible tests a theorem and finds counterexamples before anyone
    writes a proof.
  - `grind` and lean-smt give automation without trusting the solver.
  - Agents prove about 70% of easy and 49% of hard software specs
    (FVSpec, Galois, 2026).
- **Dafny** compiles to JavaScript but has no TypeScript target. Its
  runtime types would need adapters, and the rules would stop being the
  TypeScript the human reads.
- **SMT** works well without quantifiers. With unbounded `every`/`some`,
  and especially with floats, solvers often return "unknown".
- **Property tests as formulas.** `fc.property(arbs, body)` reads as
  `∀ x ∈ dom(arbs). body`, when the generators are pure combinators and
  the body is in the subset. FVSpec turned 25–35% of real Python property
  tests into Lean theorems with agents.
- **Traces.** A trace as data (a list of calls and the events each
  emitted) makes "emits change once" an ordinary pure predicate. TLA+ or
  Quint isn't needed at this level.
- **Keeping the translator trustworthy:**
  - translate one construct at a time, with no optimization;
  - run the translated Lean definitions on the same fast-check inputs as
    the TypeScript and compare the results;
  - keep every semantic choice (number type, `undefined`, `deepEqual`)
    in one prelude.
- **Floats.** Prove the geometry rules over the reals, labeled as
  idealized, and keep the tests as the authority on float behavior.

## Recommended order

1. Give the remaining interface files formal statements, one file at a
   time, starting with `shape.ts` (whose query rules `ShapeCollection`
   already relies on).
2. Proposal 2, so that no term enters the design except through an agreed
   statement, checked mechanically.
3. Proposal 3 with the scenarios, then 4.
4. Proposal 5 when phase 1b next runs (rounds 5 and 6).
5. A small proof experiment on one `@refines` claim, from the survey.
6. Proposal 7 waits.

## Open points

- Where the boundary between a defining scenario test and the test driver
  falls.
- How a gloss references its statement where position already implies it
  (a rule's headline sits on its own tag line): whether position counts.
- Whether the platform subsets are design. Under principle 1 they are
  formal declarations implementations depend on, so this proposal treats
  them as design; `canvas.ts` says otherwise.
- Whether harness identifiers should carry a mark beyond file names.
