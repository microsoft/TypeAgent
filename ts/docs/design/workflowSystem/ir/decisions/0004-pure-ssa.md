# Pure SSA per namespace (decision 0004)

Status: **Adopted (v1).** Summarized in [../ir-v1.md](../ir-v1.md)
§3.2.1 ("v1 is pure SSA") and §8.17. This document is the long-form
case for the choice.

## Purpose

This is a **brief**, not a journal. It argues that pure SSA per
namespace is the right data-flow model for the IR, on the principles
([../../principles/design-principles.md](../../principles/design-principles.md))
and the §1.1 audience lens, against the realistic alternatives. It
is the document a future reviewer should read when:

- proposing a feature whose natural shape is in-place mutation
  (a `set` form, a `stateWrites`-style block, an "update X" reference);
- asking whether the verbosity of `iterateState` (no implicit
  carry-forward) is worth keeping;
- asking what the IR commits to vs. leaves open for parallelism,
  checkpointing, or other post-v1 work that depends on the data-flow
  model;
- asking whether `bind` could be dropped in favor of node-id
  references.

[../ir-v1.md](../ir-v1.md) §8.17 carries the short rationale and
links here. The mechanisms that implement the property
(hide-by-default `bind`, multiple-binders phi, centralized
`iterateState`, the snapshot-read rule for `state`, the dominator
pass) live in §3 and §4 of [../ir-v1.md](../ir-v1.md); the
discussion below treats them as implementation, not as motivation.

The argument is laid out as: state the property (§1); pick it from
among the candidate data-flow models (§2); make the case from three
angles - what the choice buys (§3), how it scores against the
principles (§4), how it lands across the audience populations (§5);
record what it costs (§6); walk the rejected alternatives in detail
(§7); record what the property does **not** buy so it is not asked
to do more than it should (§8); name the conditions that would force
a v2 reopening (§9).

---

## 1. The property

> **Every `$from` namespace is single-assignment within its frame.**
> Each name is bound at most once per frame and never mutated in place.
> What differs across namespaces is only the lifetime of the frame.
> Apparent "updates" - re-running a binding node on the next iteration,
> advancing `state` across `@iterate`, a handler firing - are not
> mutations; they are entries into a new frame that re-bind the name.

The frame model gives every `$from` discriminant a single-assignment
lifetime:

| `$from`             | Frame in which the name is bound exactly once                                |
| ------------------- | ---------------------------------------------------------------------------- |
| `constant`          | the run                                                                      |
| `input` (workflow)  | the run                                                                      |
| `input` (loop)      | one loop activation                                                          |
| `state`             | one iteration (frame transition = `@iterate`)                                |
| `scope`             | one execution of the binding node (in a loop body, re-framed each iteration) |
| `error` / `trigger` | one handler invocation                                                       |

---

## 2. Why this property and not another

The IR needs a data-flow model: a single set of rules that says,
for any reference at any program point, what value it sees and how
the validator proves the reference resolves. The candidate models
are well-known:

- **Imperative / mutable.** Names are storage; assignments mutate
  them in place; reads see the most recent assignment on the path
  taken. A `set X = ...` form, or a `stateWrites` block on
  individual nodes that mutates a `state` variable (the original
  v1 design; see §8.5 of [../ir-v1.md](../ir-v1.md)).
- **Functional / value-flow with no names.** Every node consumes
  immutable values and produces a new one; no concept of a named
  intermediate binding at all (everything is referenced by node id
  and path).
- **Pure SSA per namespace.** Each namespace is single-assignment
  within a frame; new frames are entered explicitly at declared
  boundaries; phi joins handle branch merges.

v1 picks pure SSA per namespace by judging the three candidates
against three requirements that the IR has already committed to
elsewhere:

1. **Single resolution rule.** P1 (every reference resolves) read
   together with the §1.1.1 engine row's "cheaply enough at
   validation time" asks the validator to resolve any reference
   with one rule, not a family of bespoke ordering or last-writer-
   wins rules. A growing family of construct-specific rules
   technically satisfies P1 but forfeits the "cheaply" half.
2. **Splice safety.** P4 (parts understood without the whole) and
   §1.2's splice-safety statement commit the IR to fragments that
   compose without rename passes. A data-flow model that lets an
   inserted node silently shadow an existing binding takes that
   commitment back.
3. **No upfront execution-order commitment.** §2.2 defers
   parallelism and checkpointing to post-v1. A data-flow model
   that pins write-visibility order before the engine has a say
   reopens the §2.2 deferral as a breaking change.

The **imperative model** fails (1): a reference's value depends on
which writes ran on the path taken, so the validator needs
ordering reasoning. It fails (2): any inserted `set X = ...`
silently shadows an existing binding. It fails (3): write
visibility order has to be specified before the engine can be
asked to parallelize.

The **pure-functional model** passes (1), (2), and (3), but loses
the affordance of named intermediate bindings: the DSL story
(let-bindings lowering to a recognizable IR shape) and the
hide-by-default `bind` control both lose their target. §7.4
records the detail.

**Pure SSA per namespace** passes all three and keeps named
bindings. §3, §4, §5 below walk the consequences, the principle
audit, and the audience lens; this section's job is only to say
which model was chosen and why the other two were not.

The **mechanisms** that express pure SSA in this IR are catalogued
in [../ir-v1.md](../ir-v1.md):

- **Hide-by-default `bind`** (decision 0001 / §8.15): the
  named-binding half of SSA, plus the visibility control SSA on
  its own does not provide.
- **Multiple binders, one name** (§3.3): the phi half of SSA,
  applied to the `scope` namespace.
- **Centralized `iterateState`** (§8.5 / §3.7.1): the frame
  transition for the `state` namespace, with the same phi mechanism
  reused for path-dependent next-iteration values.
- **Snapshot-read rule for `state`** (§3.7.1): the per-frame
  single-value-per-name guarantee, made observable in the
  iteration model.
- **Dominator pass** (§4.1 pass 6): the textbook SSA dominance
  check.

These mechanisms are the IR's surface for the property: where it
is enforced and where it is observable to authors and readers. The
property is not derivable from any one of them in isolation; each
one preserves it, and removing any one (see the §7 alternatives)
would break it. They are listed here as implementation, not as
motivation; the case for the property itself is in §3, §4, §5
below.

---

## 3. Why this matters

Five concrete consequences justify writing the property down rather
than treating it as a happy accident.

### 3.1 Validator falls out of textbook SSA

The dominator pass (§4.1 pass 6 of [../ir-v1.md](../ir-v1.md)) and the
multiple-binders join (§3.3) are the standard SSA dominance and phi
rules, applied per namespace. No bespoke "no-race", "last-writer-
wins", or write-ordering rules are needed.

§8.5 records what happens when this invariant is broken: the per-node
`stateWrites` design forced a dedicated no-race rule (because more
than one body node could write the same state variable on
non-overlapping paths, so the validator had to verify the writes did
not race) and _still_ admitted unobservable dead writes (because reads
saw the start-of-iteration snapshot, so a write later overwritten by
another path was simply discarded). Pure SSA removes the whole class
of question by removing the writes.

### 3.2 No observable mid-frame state

A reader at any program point sees one value per name in scope. The
§3.7.1 snapshot rule for `state` ("reads in iteration `i` see
iteration-`i-1`'s `iterateState` result") is then a consequence of the
property, not a special case to remember. Same for `scope`: a node's
bound output is the value it returned, not the value it returned then
overwrote, then returned again.

This is the property that lets a debugger or auditor answer "what was
X here?" with a single deterministic value rather than "depends on
which writes ran in which order."

### 3.3 Engine implementation latitude

With no in-place mutation, the engine has a wide menu of
implementation strategies that are all observably equivalent:

- Re-execute a deterministic node on demand instead of caching it.
- Memoize a node's output and re-use it across handler retries.
- Persist a per-frame snapshot for resumption (post-v1 checkpointing).
- Schedule independent DDG branches in parallel (post-v1 parallelism).

The IR makes no commitment to which strategy an engine picks. The
parallelism question (§2.2 of [../ir-v1.md](../ir-v1.md)) is deferred
to post-v1 _precisely because_ the SSA shape leaves the door open
without prescribing. An IR built on an imperative model would have
to commit upfront: "writes are visible in this order"; reopening
parallelism later would be a breaking change.

### 3.4 Splice safety (P4)

Inserting or removing a node never silently overwrites someone else's
value. The worst case is a missing binder, which the dominator pass
catches statically with a localized error (§4.3). This is the property
that makes DSL fragments compose without rename passes (§1.2 splice
safety in [../ir-v1.md](../ir-v1.md)).

The contrast with imperative models is sharp: in a model where a node
can `set X = ...`, a fragment that contains such a set silently
shadows whatever other fragment was already binding `X`. The author
finds out at runtime when the value they expected isn't there. SSA
turns "silent shadowing" into "validator error at the right
coordinate."

### 3.5 Hide-by-default `bind` is the matching half

Pure SSA is "single def"; hide-by-default (§8.15 of
[../ir-v1.md](../ir-v1.md), full analysis in
[0001-bound-outputs.md](0001-bound-outputs.md)) is "addressable only
when the author opts in." Together they give the author full control
over both _when_ a name is bound and _whether_ it is visible at all.
This is what makes the IR a usable codegen target for a DSL with
let-bindings, lexical scope, and explicit return values: each DSL
construct lowers to a `bind` decision plus an SSA-compatible
reference, with no need for the DSL to invent its own renaming or
liveness analysis.

---

## 4. Match against principles

| Principle                               | Match                                                                                                                                                                                                                                                                                                                                           | Where the alignment lives |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------- |
| P1 (every reference resolves)           | Generative. SSA gives the validator its most powerful tool: dominance + phi as the single resolution rule. The contrapositive (§8.5 Alt A) is informative: per-node `stateWrites` wanted to be P1-correct but had to invent its own non-SSA rule and still leaked dead writes. SSA is what makes P1 cheap.                                      |
| P2 (no hidden flow)                     | By construction. Single def per frame means every value has one declared producer. The "apparent updates are new frames" reframing is exactly what removes hidden flow from looks-like-mutation patterns (`state` advancing, body re-running).                                                                                                  |
| P3 (structural patterns over topology)  | Indirect alignment. SSA per se is a data property, but "iteration is a frame transition at `@iterate` that re-binds names" is the data-side complement of "iteration is a structural sentinel, not a back-edge." Both forbid the implicit/topological version of the same thing.                                                                |
| P4 (parts understood without the whole) | Strong fit. Splice safety (§3.4 above). The worst splice failure is "missing binder," which is local and caught statically.                                                                                                                                                                                                                     |
| P5 (no surprise defaults)               | Strong fit, with a visible cost. The SSA constraint is what forces `iterateState` to restate every variable (no implicit carry-forward) and forces §3.3 phi to require a binder on every reaching path. Both look like "extra typing" but are P5 wins: the alternative is silent default values. The cost lands on codegen per §1.1, not on P5. |

No principle is in tension with the property. The closest thing to
friction is the verbosity, which §1.2 ("verbose by design") and
§1.1.2 (codegen pays the tax) already absorb.

---

## 5. Match against the audience lens (§1.1)

| Population                            | Effect                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Engine, validator, runtime (dominant) | Net win. The validator gets textbook SSA passes instead of bespoke rules - precisely the "cheaply enough at validation time" requirement of the §1.1.1 engine row. The engine gets implementation latitude (§3.3 above) without any of those choices being IR-observable. The "no observable mid-frame state" property is the engine's freedom-to-implement guarantee.                                                                    |
| Debugger, reviewer, auditor (human)   | Net win as a side effect. Single def per frame means "where did this value come from?" has one answer per frame - the locality property the §1.1.1 human row asks for. Frame-coordinate runtime errors map cleanly to a name, not to a write-ordering question.                                                                                                                                                                           |
| Visualizer / linter / static analyzer | Net win. Standard SSA literature applies to the IR directly; tools do not need to learn a custom write-ordering or last-writer-wins model.                                                                                                                                                                                                                                                                                                |
| DSL / codegen (primary writer)        | Trade. Codegen pays the verbosity tax (§1.1.2 LLM-via-DSL row, §1.2). It gets back: one way to express each construct (no implicit-vs-explicit choice), splice safety (§1.1.2 codegen requirement), and no need to reason about ordering when emitting. Net positive given the §1.1 "v1 picks the engine" rule.                                                                                                                           |
| LLM-direct-to-IR (fallback)           | Trade, slight cost. The LLM does have to emit a binder on every reaching path and a complete `iterateState` instead of relying on defaults. But pure SSA also makes the rejection signal local: any missing binder is caught by the dominator pass with a precise coordinate, which is exactly what the §1.1.2 LLM-direct row asks for ("locally validatable, so a bad emission can be rejected and retried"). The fallback stays viable. |
| Hand author (edge case)               | Cost. Verbosity. §1.1.2 already accepts this.                                                                                                                                                                                                                                                                                                                                                                                             |

Pattern: every reader population is a net win; every writer population
pays verbosity and gets back validator precision and splice safety.
This is the same shape as schema redundancy (§8.16), reference
encoding (§8.2), branch model (§8.3), and bound outputs (§8.15) - the
canonical §1.1.3 pattern of "writer asked for X, engine needed
something specific, writer pays via tooling." The §1.1.3 tension
table in [../ir-v1.md](../ir-v1.md) carries the corresponding row
("Mutable state / implicit carry-forward").

---

## 6. Costs accepted

### 6.1 Verbosity at frame boundaries

`iterateState` must restate every state variable on every iteration
boundary (§3.7.1, no implicit carry-forward). The §3.3 phi requires a
binder of the shared name on every reaching path. These are P5 (no
surprise defaults) and land on codegen per §1.1, not on the IR's
one-time-author cost story.

The trade is: a state variable that "stays the same across an
iteration" still gets an explicit `{ "$from": "state", "name": "<S>" }`
entry. This is the natural place a more-permissive design would let
the author omit the entry and have the previous value carry forward.
v1 rejects that for the standard P5 reason (an omitted entry is
ambiguous: did the author mean "carry forward" or "I forgot"?). The
worked example in §6.3 of [../ir-v1.md](../ir-v1.md) shows the
resulting shape; it reads cleanly.

### 6.2 No "natural" mutable accumulator

Patterns that read like "update X each iteration" must be expressed
as "compute next-X from current X in `iterateState`." For an
accumulator that grows by one element per iteration, this is the
difference between `acc.push(x)` (imperative) and `iterateState.acc =
{ next: { ...current, last: x } }` (SSA). The trade is local
readability for a globally simpler validator and engine model.

If accumulator patterns become common enough that the verbosity is a
real friction point, the resolution is **not** to weaken the SSA
property. It is to introduce a new namespace with its own frame rules
(see §7 Alt C below) so the SSA invariant for the existing
namespaces stays intact. This move is the variance lens applied (IR
§1.3 / §10): a different behavioral rule earns its own concept rather
than relaxing an existing concept's rule into a context-dependent one.

Both costs above are paid by codegen and by the LLM-direct-to-IR
fallback. §5 records why that audience distribution is the right
one under the §1.1 lens.

---

## 7. Alternatives considered

### 7.1 Alt A: per-node `stateWrites`

The original v1 design had each body task carry an optional
`stateWrites: { <var>: <reference> }` block; the loop's state was
mutated by whichever writes ran on the path that reached `@iterate`.

**Rejected.** Full analysis in §8.5 of [../ir-v1.md](../ir-v1.md). The
short version: it forced a no-race validation rule across multiple
writers, admitted dominance-ordered "dead writes" that were
unobservable under snapshot reads, and required branches that target
`@iterate` directly to either disallow that or carry state-write
declarations (compromising the pure-control-flow story for branches).
Centralizing on the loop removes all three problems and reuses the
existing multiple-binders phi (§3.3) for path-dependent next state.

### 7.2 Alt B: every node id is implicitly a name

The previous draft of the IR (before
[0001-bound-outputs.md](0001-bound-outputs.md)) made every node's
output addressable under its node id, with no `bind` switch.

**Rejected.** Full analysis in [0001-bound-outputs.md](0001-bound-outputs.md)
and §8.15 of [../ir-v1.md](../ir-v1.md). This is not literally an SSA
violation (each node still produced one value per execution), but it
eliminates the author's ability to mark a value as not-for-export,
which is the hide-by-default counterpart to single-assignment that
the SSA framing relies on. Without it, splice safety is gone (any
node id can be silently shadowed by a refactor that introduces a new
node with the same id), and engine liveness analysis has to assume
every output is potentially live until scope end.

### 7.3 Alt C: an explicit "rebind" or "update" form

A mechanism that mutates an existing name in place: `update X =
<reference>` or similar. Different from `stateWrites` in that it
would be a general feature (could update `scope` or `state`), not a
loop-specific mechanism.

**Rejected.** Would require a new validator pass to track ordering
("which update wins when two are reachable on the same path?") and
would re-introduce the dead-write question §8.5 closed (an update
overwritten by a later one on the same path produces a value no read
ever sees, but the IR contains the write). It also breaks the §3.4
reference-form story: today a reference is a pure read; introducing
an update form means some occurrences of a name are reads and some
are writes, and the validator has to discriminate.

If post-v1 wants mutable accumulators, the natural shape is **a new
namespace with its own frame rules**, not a carve-out in any existing
namespace. For example, a hypothetical `accumulator` namespace whose
frame is "the loop body across all iterations" and whose only
mutation operator is "append" (commutative, so no ordering question)
would preserve SSA for the other five namespaces while giving
authors the natural pattern. That work is post-v1; the SSA framing is
what makes it land cleanly when it does, because adding a namespace
does not perturb any existing one.

### 7.4 Alt D: pure functional / no named bindings at all

Drop the `scope` namespace entirely; every reference targets a node
by id and a path. SSA in the limit (every value has exactly one
producer), but without phi and without the affordance of named
intermediate values.

**Rejected for v1, not seriously considered.** Records the limit case
for completeness. The `scope` namespace pays for itself in three
ways the pure-functional model loses:

1. Diamond merges (§3.3 multiple binders) need a name to merge under;
   the pure-functional model would have to introduce a join-node kind
   or a "select" form to do the same job, neither of which is
   simpler than `bind`.
2. Hide-by-default (`bind` opt-in) is not expressible in the
   pure-functional model, because there is no "name" to omit.
3. The DSL story (§1.1) wants let-bindings to lower to something
   recognizable; `bind` is that something. Without it, a let-binding
   in the DSL has nothing to lower to except an anonymous CFG label
   plus a side table mapping label-to-DSL-name, which is the same
   information `bind` carries explicitly.

The pure-functional model is recorded here so a future reviewer
asking "why don't we just go full SSA with no names?" finds the
question already answered.

---

## 8. What the property does not do

It is worth being explicit about what pure SSA per namespace is
**not** doing, to avoid future arguments that mistake correlation
for causation.

- **It does not deliver parallelism.** SSA is a precondition for the
  engine to be allowed to parallelize independent DDG branches
  without changing program meaning, but v1 does not parallelize and
  the §2.2 deferral is on its own merits. SSA keeps the door open;
  it does not walk through it.
- **It does not deliver checkpointing.** Same shape: a per-frame
  snapshot is a natural object to persist for resumption, but
  checkpointing has its own design surface (§2.2) and its own
  open questions (frame granularity, schema evolution across
  resume). SSA makes the snapshot well-defined; it does not make
  resume free.
- **It does not deliver determinism.** A workflow that calls a
  non-deterministic task is non-deterministic regardless of how
  data flows around inside the IR. SSA constrains the IR's data
  model, not the tasks the IR composes.
- **It does not eliminate side effects.** Tasks may have side effects
  (write a row to a database, send an email). The `next` edge is
  load-bearing for ordering side effects (§3.2.2 v1 limitation).
  Pure SSA is about declared values, not about effects.

These are recorded because each one is the kind of property a
reviewer might attribute to "we went SSA" and then build a follow-up
argument on. The follow-ups are valid; the attribution is not.

---

## 9. Triggers to revisit

The pure SSA property is foundational; revisiting it is a
v2 question, not a v1 patch. The triggers below are what would
move it onto a v2 design agenda.

| Trigger                                                                                                                                                                     | What it would cost to retreat                                                                                                                                                                                                                                              |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Real workloads have mostly accumulator-shaped state (append, count, max-of) and the verbose `iterateState` rewrite is a measured codegen-output-size or LLM-token problem.  | Cheap if addressed by Alt C (new namespace with append-only / commutative semantics): existing namespaces keep SSA, the new namespace has its own validator rules. Expensive if addressed by relaxing existing namespaces: every §8 decision that depended on SSA reopens. |
| Engine wants to introduce parallelism as a declared IR construct (§2.2) and finds the SSA property insufficient (e.g., needs explicit fork/join nodes that produce values). | Likely additive: parallelism nodes are new node kinds, their value semantics still per-frame SSA. The reopen would be on §3 (new node kinds), not on the SSA property itself.                                                                                              |
| Checkpointing / resume work (§2.2) finds that the per-frame snapshot is the wrong granularity and wants a sub-frame or cross-frame model.                                   | Reopens §3.7.1 (frame transitions), not the SSA property as such. The frame _model_ is what's at stake; the single-assignment _within_ a frame is independent.                                                                                                             |
| A DSL discovers it cannot lower a common construct (e.g., recursive functions, mutable closures) without faking SSA in a way that the IR's verbosity tax becomes hostile.   | Likely reopens hide-by-default `bind` (decision 0001) before SSA itself: the affordance the DSL probably wants is a different visibility/scoping model, not literally mutation. SSA stays.                                                                                 |

If the trigger fires and SSA does need to weaken, the design move is
likely **scope-narrowing** rather than abandonment: keep SSA for
`constant`/`input`/`scope`/`state`, allow some new namespace to be
non-SSA. Abandoning SSA across the board would invalidate every §8
decision listed in §3 above; the cost is high enough that the
trigger has to be very strong.

---

## 10. Cross-references

- §3.2.1 of [../ir-v1.md](../ir-v1.md): the "v1 is pure SSA" paragraph
  and the namespace lifetime table.
- §3.3 of [../ir-v1.md](../ir-v1.md): multiple-binders phi rule.
- §3.7.1 of [../ir-v1.md](../ir-v1.md): `iterateState`, snapshot-read
  rule, no implicit carry-forward.
- §4.1 pass 6 of [../ir-v1.md](../ir-v1.md): dominator pass (the
  textbook SSA dominance check).
- §8.5 of [../ir-v1.md](../ir-v1.md): per-node `stateWrites`
  rejection (Alt A).
- §8.15 of [../ir-v1.md](../ir-v1.md) and
  [0001-bound-outputs.md](0001-bound-outputs.md): hide-by-default
  `bind` (Alt B).
- §8.17 of [../ir-v1.md](../ir-v1.md): the short-form rationale.
- §1.1.3 of [../ir-v1.md](../ir-v1.md): the tension row.
- §10 of [../ir-v1.md](../ir-v1.md): the audience-lens closure row.
- §2.2 of [../ir-v1.md](../ir-v1.md): post-v1 work that depends on
  the SSA shape (parallelism, checkpointing).
