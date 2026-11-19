# Proofs about the design

Status: pilot, 2026-11-18. Lean 4.36.0 (core only, no Mathlib), installed
through elan outside the repository. Check with:

    lean proof/DataModel.lean

## Why

A test checks a rule on the calls it makes, and an adversary checks that
those calls reach the states where a fault shows. Neither says anything
about whether the rules themselves are consistent, or whether a statement
in a gloss or a task's text follows from them. Proofs about the design do:
they need the rules and the vocabulary, not an implementation.

## What `DataModel.lean` proves

Each rule and vocabulary function it uses is translated by hand, with its
source in a comment.

1. **A derivation in task 9's text holds.** "A client's seqs grow with
   its clientSeqs" follows from `MessageProcessor.client-order` and
   `remote-seq` (`seqs_grow_with_clientSeqs`).
2. **`remote-order`'s gloss holds.** "In the order they were enqueued,
   which is seq order" follows from `remote-seq`
   (`remote_order_is_seq_order`).
3. **`local-order`, `remote-order` and `process.logs-each` are
   consistent.** For every queue the requirements allow, the log that
   applies the local operations and then the remote ones satisfies all
   three, and so does the remote-first log (`consistent_local_first`,
   `consistent_remote_first`). So these rules leave the order of the
   queues open, which is now a theorem rather than a reading.

## What `ShapeModel.lean` proves

Whether `ShapeMessageProcessor`'s rules about what is present (`kept`,
`remove-listed`, `clear-known`, `add-on-z`) determine the model.

1. **As written, they don't** (`rules_allow_a_stray_shape`). A model
   holding a shape that no applied add made satisfies all four: each
   speaks only of shapes that adds made. With nothing applied, both the
   empty model and a one-shape model satisfy them.
2. **With one more rule, they do** (`rules_determine_model`). Adding
   `only-applied` (every present shape's ID has an applied add), any two
   models that satisfy the rules are equal, order included. The proof
   needs only that `compareOrder` is irreflexive and asymmetric.

**What the tests do today** (checked 2026-11-18 with a temporary probe, a
reference processor that adds one stray shape in its first `process`):
34 of the contract's tests fail, but every failure is the same
`TypeError`. `add-on-z`'s expression uses `addOf(applied(this), id)!`,
which is undefined for the stray shape, so `compareOrder` reads `.seq` of
`undefined`. The fault is noticed by the expression crashing, not by any
rule saying the shape shouldn't be there; and a stray shape present
before the first `process` (a writer that doesn't start empty) is checked
by nothing.

## How the translation went

The rule expressions are side-effect-free TypeScript over lists, and they
translated almost one for one: `isStrictlySorted` is `List.Pairwise`,
`sameOps` is `List.Perm` on keys, `filter` is `List.filter`. Every proof
was short and passed on the first try.

Translating forced each partial expression to be read one way or
another. `!` (TypeScript's non-null assertion) makes a rule crash where it
doesn't apply, and that is how the gap above stayed hidden: a rule
expression should be total, saying true or false in every state.

Two `@requires` rules, `remote-seq` and `client-order`, have no
expression yet. Their Lean definitions here (`RemoteSeq`, `ClientOrder`)
are drafts of what the expressions would say, for the human to agree.

## The survey

`survey.md` classifies 129 rules: 69 translate directly (integers,
strings, lists, maps, the history, quantifiers), 37 need a model of
floating-point numbers (mostly geometry and shape), 11 need a model of
object identity, and 12 are outside logic (timing, rendering, the
platform). It lists candidates for the next proofs: whether the shape
processor's rules determine its model uniquely, and `converges` derived
from the other rules rather than tested.
