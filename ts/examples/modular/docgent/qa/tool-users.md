# Gold Q&A: developers trying the tool (development set)

The reader is an experienced developer who wants to try the method on a
project of their own. Answers are technical and exact, cite their
sources, and say plainly when something is not decided or not built.

Status: draft by the design agent, 2026-11-18, for the human to edit and
agree. Format as in `gold.md`. Sources are relative to
`ts/examples/modular`. A held-back set for this audience is still to be
written, by someone other than whoever writes the docgent's instructions.

## el-01: What is a blueprint?

- **Kind:** fact
- **Gold answer:** One interface with its imports and exports, its
  members, its rules (each a formal TypeScript expression in a defined
  vocabulary, with a one-line headline as a gloss), and its scenarios
  (each defined by a test case). It is the design; the tests that check
  it are kept apart.
- **Key points:** a single interface; imports and exports; rules as
  expressions; scenarios defined by test cases; tests are not part of
  the blueprint.
- **Must not claim:** that a blueprint is a file, or a document.
- **Sources:** `tool/elements.md` (Blueprint).

## el-02: Is the vocabulary part of the design or of the tests?

- **Kind:** fact
- **Gold answer:** The design. The vocabulary's terms are what rule
  expressions are written in, so they are part of the rules, just as
  test infrastructure is part of the tests.
- **Key points:** part of the rules; expressions use it; contrast with
  test infrastructure.
- **Must not claim:** that it is a test helper.
- **Sources:** `tool/elements.md` (Vocabulary).

## el-03: Why is a scenario defined by its test rather than its description?

- **Kind:** why
- **Gold answer:** Prose is informal and can be read more than one way;
  a test case can't. So the scenario's steps and expected effects,
  written as data in the design's terms, are the definition, and any
  prose glosses it. The driver that plays the case is test
  infrastructure. This mirrors rules, whose expression is the statement
  and whose contract is what runs it.
- **Key points:** prose is ambiguous; the test case is the definition;
  driver is infrastructure; symmetric with rules.
- **Must not claim:** that scenarios are written in prose with tests as
  examples.
- **Sources:** `tool/elements.md` (Scenarios), `method.md` (The design).

## el-04: What is an adversary, and what happens when one isn't caught?

- **Kind:** fact
- **Gold answer:** A deliberately wrong implementation with one real
  fault, named for the rule it breaks. The tests must catch it. If one
  escapes, the tests are strengthened; if the fault turns out not to be
  real, the adversary is removed and the reason recorded.
- **Key points:** one real fault; named by rule; must be caught;
  escape means stronger tests, or removal with a reason.
- **Must not claim:** that adversaries test implementations.
- **Sources:** `tool/elements.md` (Adversaries), `CLAUDE.md`
  (Constraints).

## el-05: How does a module hide its internals?

- **Kind:** fact
- **Gold answer:** A module has one external blueprint and a set of
  internal blueprints. Only the external blueprint is visible outside;
  an internal blueprint may be imported only by the module's other
  blueprints. The module's implementation is its internal blueprints'
  implementations wired together, and the external blueprint's
  scenarios test that wiring as a black box. Modules nest: a nested
  module's external blueprint is one of its parent's internal
  blueprints. This is agreed but not yet built or checked by the tools.
- **Key points:** one external blueprint plus internal ones; import
  visibility; composition tested by the external scenarios; nesting;
  not yet built.
- **Must not claim:** that the tools enforce module boundaries today;
  that a module is a kind of blueprint.
- **Sources:** `tool/elements.md` (Module).

## el-06: How do I use a browser API or an npm package from a blueprint?

- **Kind:** cross
- **Gold answer:** Declare the part you use as a platform interface: an
  import whose implementation is outside the project. Implementers see
  that declaration and may use only what it declares. In tests a double
  stands in for it, and a check confirms the declaration matches the
  real types; both are test infrastructure. The example does this for
  the canvas and the DOM. npm packages fit the same form, but none is
  used yet, and implementations in the example import no packages.
- **Key points:** declared subset as an import; implementers limited to
  it; double and type check are infrastructure; canvas and DOM as the
  example; packages not yet tried.
- **Must not claim:** that npm packages are supported today.
- **Sources:** `tool/elements.md` (Platform interfaces), `CLAUDE.md`
  (Constraints).

## el-07: Will the implementing agent see my tests?

- **Kind:** trap
- **Gold answer:** Not decided. Today an implementing agent reads the
  contracts and runs them, but can't read adversaries or its own
  reference. The design agent has proposed that it see only the
  statements (rules and scenario test cases) and run the checks without
  reading them. One experiment run that way passed every check at no
  extra cost, but one run on a well-refined spec doesn't settle it.
- **Key points:** open; what happens today; the proposal; one
  experiment, its result, and why it isn't enough.
- **Must not claim:** either answer as decided.
- **Sources:** `tool/elements.md` (Visibility to the implementer).

## el-08: Can I have several implementations of one blueprint?

- **Kind:** fact
- **Gold answer:** Yes: they form the blueprint's library, and each must
  pass the same checks, so any can replace another. Two independent
  implementations are also how the method finds what a blueprint leaves
  open (phase 3).
- **Key points:** library; same checks; interchangeable; phase 3.
- **Must not claim:** that the design agent writes implementations.
- **Sources:** `tool/elements.md` (Library), `method.md` (3).

## el-09: Is a file a blueprint?

- **Kind:** trap
- **Gold answer:** No. A blueprint is one interface. In the example an
  interface file usually holds several blueprints (`shapeModel.ts` holds
  the collection, its writer, the processor and others); the file is
  only grouping.
- **Key points:** one interface; files group several; an example.
- **Must not claim:** one blueprint per file.
- **Sources:** `tool/elements.md` (Blueprint).
