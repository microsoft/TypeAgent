# Workflow IR - v0.1

Status: Adopted (v0.1). Authoritative.

**Terminology.** Throughout this document, the **workflow IR** (or just
"the IR") is the JSON workflow artifact that the engine consumes. Earlier
drafts use "spec" for the same thing; the rename separates the artifact
from this design document, which is _about_ the IR but is not itself an
IR. See §1.1 for the audience consequences.

This document is a clean-room design of the workflow IR, derived **only** from
[design-principles.md](../principles/design-principles.md). It deliberately ignores any
pre-existing decisions, schemas, or implementations in the repo so that the
design follows the principles end-to-end without inheriting prior assumptions.

The design is presented top-down: first the meta-design style, then v1 scope,
then the IR schema, validation, execution semantics, and worked examples.
Open design choices and the alternatives considered are recorded at the end for
review.

---

## 1. Meta-design pattern

The design is shaped by one **lens** (§1.1) and three **style choices**
(§1.2-1.4) that fall out of applying that lens to the principles. The
lens names the audience the IR serves and the trade-off the design
resolves; the three style choices are what the lens picks when it
collides with specific principles. They are listed up front so reviewers
can see the basis on which every concrete decision below was made. New
design questions should walk this section in order: locate the relevant
audience tension in §1.1, then check which of §1.2-1.4 the principle in
play already converts that tension into.

### 1.1 Audience and the sufficiency-vs-convenience balance

**Note on terminology.** Throughout §1.1, "writers" and "readers" name
the mechanical systems that produce or consume the IR (codegen,
engine, validator, analyzers), not human authors. Humans review and
debug the IR but do not author it; authoring is the DSL's job. The
audience for this design document itself is treated separately in
§1.1.4.

The first job of the IR is to carry **sufficient information for the
engine to execute the workflow correctly and with acceptable
performance**. "Sufficient" means: every dispatch decision, every type
check, every value the engine needs to release or keep alive, every
recovery path, is determinable from the IR alone, without inference
from outside context. "Acceptable performance" means: the engine can
make those determinations cheaply (no global re-walks, no expensive
analyses at dispatch time), and analysis tools can do the same.

Sufficiency and analysis cost are the hard constraints. There is no
unmediated writer in the steady state: the IR's writers are mechanical
(codegen lowering from a DSL) or out of scope for v1 authoring (an LLM
or human writing the DSL itself). Convenience pressures from those
out-of-scope authors land on the DSL surface, not on the IR. When a
decision forces a trade-off between "easier for codegen to emit /
easier for a human to read" and "engine has what it needs (cheaply)",
v1 picks the engine. The "verbose by design" tax in §1.2 is the most
visible consequence; it is paid in codegen output size and in human
review burden, not in LLM token cost. The tensions in §1.1.3 collect
the rest.

Two secondary reader populations sit alongside the engine: humans
reviewing or debugging a workflow, and third-party analysis tools. For
v1, the engine's sufficiency requirement is the dominant force; the
human and tool requirements are mostly satisfied as side effects of
satisfying the engine (explicit references give humans navigability;
declared schemas give analyzers a contract). Where they pull in
different directions, §1.1.3 calls it out.

v1 commits to the **compile-target role**: the IR is what codegen
emits and one engine consumes, and the IR is permitted to co-evolve
with both. The IR may also become the source for **other downstream
consumers** later: a different workflow engine, a native-code
compiler, a transpiler to a different workflow format, a portable
distribution artifact, or something we have not thought of yet. v1
does not commit to any of these specific futures, but several v1
decisions (JSON encoding, top-level `version` field, inline schemas,
self-containment, the §5.7 conformance bar) are made the way they are
to keep those doors open at low cost. When future v1 decisions arise,
"does this help codegen and the engine?" is the active question;
"does this needlessly close off a plausible second consumer?" is the
veto question.

Decisions throughout this document (verbosity, explicitness, schema
redundancy, the conformance bar in §5.7, the choice of JSON in §8.14)
are calibrated for the populations that interact with the **IR
artifact**, not for whoever happens to read this design document.
Keeping those two audiences straight is why the artifact is called "the
IR" everywhere below; the audience for this document is treated
separately in §1.1.4.

#### 1.1.1 Reader populations

| Population                          | Coverage           | What they MUST be able to do                                                                                                                    | Forces                                                                                                                               |
| ----------------------------------- | ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Engine, validator, runtime          | Reads every IR     | Determine every dispatch, type check, value lifetime, and recovery edge from the IR alone, cheaply enough to do at validation or dispatch time. | Explicitness in §3-§5; static dominator and liveness (§4.1, §5.7 SHOULD); total `default` (§8.3); the conformance MUST list in §5.7. |
| Debugger, reviewer, auditor (human) | Reads specific IRs | Locate a node, follow its references, map a runtime error coordinate back to a source position, diff a change without re-reading the whole IR.  | Stable IDs, locality (§4.3 localizable errors), observability hooks (§5.6).                                                          |
| Visualizer, linter, static analyzer | Reads programmatic | Walk the IR without knowing the engine's internal model; resolve names; identify node kinds and reference targets without parsing context.      | `kind` discriminant (P5), `types`/`$ref` sharing (§3.1.1), self-describing structure.                                                |

The three populations are bundled in the human row because v1 ships one
mechanism set (locality + IDs + error coordinates) that serves all
three. They diverge later - a debugger needs runtime-state-to-IR
mapping that a reviewer does not, an auditor needs provenance that a
debugger does not - and may split into separate rows if those needs
acquire dedicated mechanisms.

#### 1.1.2 Writer populations

| Population                      | What they emit                          | What they need from the IR surface                                                                                                                                                                                                                                                                                      | Status                                                                 |
| ------------------------------- | --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| DSL or codegen tool             | Whole IRs from a higher-level surface   | Coverage of the lowering targets it needs (§3 schema, §3.9 grammar) and stability of the surface it lowers into (§10, revisit-triggers).                                                                                                                                                                                | Primary writer                                                         |
| LLM via DSL (with retry/repair) | DSL fragments that codegen lowers to IR | Lowering-contract clarity at any given IR snapshot. Direct IR requirements are mediated by codegen (see the DSL row above); during v1 co-evolution each IR snapshot needs to be cleanly lowerable so the DSL grammar can be re-derived as the IR moves. Long-term IR stability is a v2 concern (§10, revisit-triggers). | Not an IR writer (writes DSL); IR is produced by the codegen row above |
| LLM direct to IR                | IRs or fragments from a prompt          | Locally validatable nodes (so a bad emission can be rejected and retried), schema-complete with no implicit context, no whitespace or ordering significance.                                                                                                                                                            | Fallback / bootstrap                                                   |
| Hand author                     | Edits, demos, fragments                 | The same as LLM-direct, plus tolerance for verbosity it cannot avoid.                                                                                                                                                                                                                                                   | Edge case                                                              |

The LLM row is split because the two configurations have different IR
requirements. **LLM via DSL** is the steady-state primary path for
producing IR once a DSL exists, but the LLM in this configuration does
not write IR at all: it writes DSL, and codegen produces the IR (the
DSL row above). The LLM emits a small grammar it can be reliably
prompted on, codegen owns the verbose-by-design tax (§1.2) once instead
of at every emission, and many wrong programs become unrepresentable in
the DSL grammar instead of caught later by IR validation. **LLM direct
to IR** is the bootstrap path (used before any DSL exists) and the
escape hatch (used when the DSL does not cover something). It stays
viable only because the IR is locally validatable with no implicit
context - those properties cannot be dropped just because a DSL appears,
or the escape hatch closes.

Hand-authoring an IR by writing JSON directly is **not** a primary use
case. It is acknowledged as an edge case (small fixes, demos, no DSL
handy), and §1.2's "verbose by design" tax is paid on the assumption
that the DSL, codegen, or LLM layer absorbs the authoring cost.

The DSL configuration adds back one cost the IR-direct path avoids: a
source map between DSL position and IR position, so runtime errors
(which arrive in IR coordinates) can be reported against the DSL the
LLM or human actually wrote. That cost lands on the DSL toolchain, not
on the IR.

The DSL configuration also substitutes a different writer force on the
IR: **codegen as a mechanical writer**. Codegen wants one way to
express each construct (no IR-level sugar to choose between),
splice-safe scopes (so DSL fragments compose without renaming or path
rewriting), and ideally no IR shapes that have no DSL analogue (so
coverage stays meaningful). Those pulls are mostly aligned with §1.2
(no sugar) and §1.4 (boundary closure), so they reinforce existing
style choices rather than create new ones. Codegen coverage staying
well below 100 % of IR shapes for an extended period is itself a
revisit signal - see [revisit-triggers.md](revisit-triggers.md) row 7.

If a DSL never materializes and hand-authoring or LLM-direct-to-IR
becomes the dominant write path, several v1 trade-offs become
candidates for revisiting - see
[revisit-triggers.md](revisit-triggers.md) rows 1, 5, 6.

#### 1.1.3 Tensions and resolutions

The audience model resolves real tensions. The pattern is consistent:
when reader and writer pull in different directions, v1 picks the
reader and expects writer tooling to absorb the difference. The
following are the largest:

| Tension                                | Writer pull                                                        | Engine sufficiency / cost                                                                                                                                                                                        | v1 resolution                                                                                                                                                                   | Where                |
| -------------------------------------- | ------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------- |
| Schema redundancy on task nodes        | Omit, inherit                                                      | Static drift check needs both sides at validation time; runtime dispatch needs schemas without registry lookup.                                                                                                  | Required, drift-checked                                                                                                                                                         | §8.16, decision 0003 |
| Reference encoding (string vs. object) | String shorthand                                                   | Engine needs source kind, name, and path without a parser; analyzers need uniform structural access.                                                                                                             | Object form                                                                                                                                                                     | §8.2                 |
| IR encoding format                     | YAML for terseness                                                 | Engine needs a strict, ambiguity-free parse; LLM emitters need no whitespace traps.                                                                                                                              | JSON                                                                                                                                                                            | §8.14                |
| Branch model                           | Predicate `if/else`                                                | Engine needs total dispatch with no expression evaluator on the hot path.                                                                                                                                        | Discriminant switch with required `default`; arms are `WorkflowScope`s ([decision 0010](decisions/0010-finish-workflow-scope-unification.md)).                                  | §8.3                 |
| Bound outputs                          | Implicit publication                                               | Engine needs a static liveness signal to free unreferenced values immediately (§5.7 SHOULD).                                                                                                                     | Hide-by-default `bind` switch                                                                                                                                                   | §8.15, decision 0001 |
| Mutable state / implicit carry-forward | Less verbose `iterateState`; "natural" update syntax               | Validator and engine want a single-assignment-per-frame model so dominance + phi (textbook SSA) are the only data-flow rules; in-place mutation forces bespoke ordering rules and forecloses parallelism.        | Pure SSA per namespace; codegen restates state at each iteration boundary.                                                                                                      | §8.17, decision 0004 |
| Loop termination                       | Implicit re-entry / explicit `@iterate` / `@exit` sentinels        | Engine needs a single, locally validatable rule for "when does an iteration end" without reserving target ids.                                                                                                   | Body is a plain `WorkflowScope`; the loop's `continueWhen` reference decides each iteration's fate ([decision 0010](decisions/0010-finish-workflow-scope-unification.md)).      | §8.4                 |
| Verbosity tax in the LLM era           | Codegen output size; human review/diff burden when reading IR cold | Engine needs the verbose, explicit, locally validatable form regardless of who writes it.                                                                                                                        | Build a DSL when authors are LLM or human; codegen pays the tax once per change rather than per emission. IR remains emittable so the LLM-direct fallback in §1.1.2 stays open. | §1.1.2 LLM rows      |
| Forced sequencing of independent tasks | Mark independent tasks as parallel or unordered                    | v1 has no parallel construct and no side-effect declarations; the engine sequences along `next` chains. Every pair of independent tasks must be threaded in an arbitrary order that looks meaningful but is not. | Accept the over-sequencing; readers and reviewers carry the cost. Post-v1 side-effect / capability declarations will close the gap (§3.2.2).                                    | §3.2.2               |

Each row is "writer asked for X, engine needed something specific to do
its job correctly or cheaply, writer pays the cost via tooling." The §8
entries above carry the per-decision analysis. §1.2-1.4 are the same
pattern crystallized into reusable style choices: when a future decision
matches the shape of one of those three, the resolution is already
named and need not be re-derived.

#### 1.1.4 Audience for this design document

The design document targets a narrower audience than the IR: engine
implementers building one of the reader populations above, design
reviewers checking the IR against the principles, and DSL, codegen, or
LLM-prompt authors deciding what to lower to. They are not the
audience for the IR; they are the audience for the design that produced
it. When this document says "the reader" without qualification, it
means a reader of the IR, not a reader of this document.

### 1.2 Explicit IR, no sugar

The IR is the contract between two mechanical layers: codegen on the
producing side and the engine (plus validator, analyzers, debugger) on
the consuming side. Both layers benefit from one way to say each
thing; neither benefits from sugar. Humans read the IR for review and
debugging but do not author it - the DSL absorbs that role. So every
node kind, every edge, every reference is written out. Authoring
sugar (DSLs, templates, generated IRs) is out of scope for the IR and
lives at a different layer.

- Lens application: §1.1 + P2/P3/P5. The engine cannot dispatch,
  validate, or release values from inferred structure - it needs every
  reference, edge, and kind stated. Codegen, as the only mechanical
  writer, also has no use for sugar; multiple equivalent encodings
  would just force codegen to choose and force readers to handle both.
- Drives: P2 (no hidden flow), P3 (no inferred structure), P5 (no
  surprise defaults).
- Consequence: the IR will look verbose. That is intentional, and the
  verbosity is paid by codegen output and human review, not by an LLM
  emission loop.

### 1.3 Structural minimalism

§1.3 is two related but distinct sub-lenses, both bearing on what the
IR's surface looks like. They are stated together because they share
the "concept = behavioral rule" measurement, but they can point in
opposite directions and a decision that invokes "§1.3" should say
which sub-lens it is leaning on.

**§1.3.1 Minimization.** The schema introduces the **fewest concepts**
that satisfy P1-P5. New node types, fields, and constructs only appear
when there is a scenario in design-principles.md that none of the
existing concepts can express without violating a principle. This is
the discipline noted at the top of design-principles.md (the
unnumbered minimization rule).

- Lens application: this one is principle-driven first - the minimization
  rule on top of P1-P5 already demands it. §1.1 reinforces rather than
  generates: fewer concepts mean less for the engine and analyzers to
  implement, and writer convenience is neutral-to-favorable, so there is
  no audience tension to overrule.
- Measurement: a concept is a **behavioral rule**, not a surface label.
  The six `$from` discriminants count as one concept (named state
  container with path-projected reads) parameterized by frame lifetime
  and visibility, because they all obey the single rule of §3.2.1
  (single assignment within a frame). A single label whose semantics
  depend on context counts as two concepts: the per-node `stateWrites`
  design rejected in §8.5 is the worked example - one keyword carried
  both a write op and an implicit no-race rule, which made it two
  concepts wearing one name. The test for an extension is "does it
  add a behavioral rule existing concepts do not already cover?" not
  "does it add a name?"
- Speculative-extension test: a concept proposed for "future uniformity"
  with no current scenario that needs it fails §1.3.1. Future-proofing
  is exactly the cost minimization tells you not to pay until forced.

**§1.3.2 Uniformity (P3's representation-surface axis).** P3 states
that IR structure corresponds to computational structure on three
axes: control flow, data publication, and representation surface.
The third axis says: **the same surface form means the same thing
wherever it appears, and distinct behavioral rules have distinct
surface forms.** Counting concepts as behavioral rules constrains
the surface bijectively: two surface forms that obey one rule are a
collapse candidate (merge them to one form); one surface form that
obeys two rules in different contexts is a split candidate (give
each rule its own form). The pre-revision loop `outputs` map vs.
workflow `output` reference (§8.10 Alt C) and the `bind: true`
shorthand (§8.15 "Removed sugar") are the worked examples of the
collapse direction; per-node `stateWrites` is the worked example of
the split direction. The variance test is symmetric: count behavioral
rules, count surface forms, and check they match. The §10 variance
lens uses this test.

Because §1.3.2 is grounded in P3, it is a principle-level
requirement, not a style preference. But it can conflict with
§1.3.1: P3 (via §1.3.2) generates pressure to add concepts that
close surface ambiguities or ensure future-stable bijections;
minimization (§1.3.1) generates counter-pressure to defer those
concepts until a scenario forces them. This is the same shape as
every other P3-vs.-minimization tension in the design (MapNode
deferred, expressions decided ([decision 0006](decisions/0006-no-expressions-in-ir.md)),
per-scope constants deferred).
Decision 0007 (G-K1.a vs. G-K1.b) is the worked example for
the representation-surface axis specifically.

**Tension between §1.3.1 and §1.3.2.** When a single rule already
covers a situation, both sub-lenses agree (collapse the surfaces).
When extending the rule's _reservation surface_ to cover possible
future rules of the same family, they disagree: §1.3.2 (P3) prefers
the wider reservation (one rule the reader learns once and never
relearns when family members are added); §1.3.1 (minimization) rejects
the wider reservation (it is paying for concepts that do not yet
exist). This is the characteristic P3-vs.-minimization tension. A
decision that hits it should name both sub-lenses and explain which is
weighted heavier and why - not silently invoke "§1.3" as if it
delivered a single verdict. Decision 0007 (`$literal` and the
`$`-prefix reservation) is the worked example.

**Concrete consequence (both sub-lenses).** v1 has exactly three node
kinds (`task`, `branch`, `loop`) and one template model for reference
positions (§3.4, with `$from` and `$literal` as the two
engine-recognized forms). Error
recovery is an `onError` edge to a task node (the engine injects two
input fields when dispatching via that edge; see §3.8); it is not a
separate node kind. Every additional concept proposed during the
design review is measured against §1.3.1 first; if it survives, the
surface form is then checked against §1.3.2.

**Multiplicative cost at use sites.** Minimization decisions are
individually cheap but combine multiplicatively. A4 G3 is the worked
example: "no predicate branches" (§8.3) + "no expressions"
([decision 0006](decisions/0006-no-expressions-in-ir.md)) means a
single `i + 1 < len(repos)` check requires four standard-library
task nodes and one branch node. Neither decision alone causes this;
the product does. This cost is acceptable for v1 (the DSL hides it),
but each new minimization deferral should be evaluated against the
existing set, not in isolation.

### 1.4 Boundary closure

Each scope (the workflow itself, each loop body) is **closed**: it declares its
inputs, its outputs, and the set of names visible inside. No name inside a
scope refers to anything outside it except through that scope's declared
inputs.

- Lens application: §1.1 + P4. The engine needs each scope analyzable in
  isolation so that dominator, liveness, and type-compatibility costs stay
  scope-local instead of growing with whole-IR size. Reviewers get local
  reasoning as the same side effect.
- Drives: P4 (parts understood without the whole).
- Concrete consequence: loop bodies are sub-IRs with the same shape as the
  top-level workflow. The validator and executor treat them uniformly.

---

## 2. v1 scope

### 2.1 In scope for v1

| Area                  | v1 covers                                                                                                                                                                |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Node kinds            | `task`, `branch`, `loop`                                                                                                                                                 |
| Data references       | Static refs to: workflow inputs, declared constants, node outputs, loop state                                                                                            |
| Reference modality    | Required and optional references                                                                                                                                         |
| Type compatibility    | Structural subtyping over JSON Schema-described types                                                                                                                    |
| Control flow          | Explicit `next` per node; natural completion (`next: null` or absent) terminates the enclosing scope                                                                     |
| Branching             | Discriminant-based switch with exhaustive cases and required `default`; arms are `WorkflowScope`s ([decision 0010](decisions/0010-finish-workflow-scope-unification.md)) |
| Loops                 | Single-entry loop construct with declared state, declared boundary I/O, max-iteration cap; termination via `continueWhen` reference                                      |
| Error handling        | Per-node `onError` edge to a task node; engine injects `error`/`trigger` input fields (§3.8); uncaught errors propagate and fail the run                                 |
| Validation            | Static: dominator, type compatibility, scope closure, exhaustiveness, termination (every scope reaches natural completion)                                               |
| Observability surface | `nodeStarted` / `nodeCompleted` / `nodeFailed` events per node, including loop iterations                                                                                |

### 2.2 Out of scope for v1 (post-v1)

| Area                                   | Why deferred                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Sub-workflow calls                     | P3 scenario 24 explicitly marks this "future". Adds a node kind; defer until v1 stabilizes.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| Side-effect / capability declarations  | Called out as "expanding the boundary" in the principles; useful but additive. v1 keeps tasks fully opaque. **Planned closure of the v1 control-flow ambiguity** noted in §3.2.2: once tasks declare effects, the validator can warn on `next` edges that carry neither data nor effect-ordering.                                                                                                                                                                                                                                                                                                                 |
| Parallelism / concurrency annotations  | Whether parallelism is _declared_ in the IR (an explicit `parallel` construct authored or lowered from the DSL) or _derived_ opportunistically by the engine (from the DDG and `next`) is deferred. v1 commits to neither and specifies sequential execution along `next` chains (§5.7); both options remain open as additive post-v1 work, and no v1 IR shape decision forecloses either. The §3.2.2 v1-limitation (`next` edges are load-bearing-by-assumption while tasks are opaque) is one of the questions a parallelism decision will need to resolve, jointly with the side-effect/capability work above. |
| IR versioning, checkpointing, resume   | Explicitly out of scope per design-principles.md ("Out of scope for v1" section).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Authoring sugar / DSL                  | Per the IR principle. Belongs in a separate layer.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Schema migration / evolution           | Same rationale as versioning.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Computed / dynamic reference targets   | P1 scenario 8: ruled out by design; expressed via branch + decision tree.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| External-state side channels           | P2 scenarios 16-17: deliberately invisible to the IR in v1.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| Cross-loop shared mutable state        | P4 scenario 34: forced into explicit boundary wiring; no global state.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Reusable recovery tasks across scopes  | P4 scenario 35: each scope owns its `onError` recovery tasks in v1. (Pre-revision drafts called these "handlers"; v1 collapsed the kind into `task` per §3.8 and §8.7.)                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Explicit `block` scope                 | A run-once scope kind (sibling of loop body) that can carry a single `onError` over a region of nodes. Closes the "multi-statement try" gap cheaply by reusing the existing scope contract. Sketch in [future/block-scope.md](future/block-scope.md).                                                                                                                                                                                                                                                                                                                                                             |
| Edge-scoped `bind` reads               | A fifth `$from` namespace (`"edge"`) that resolves against the unique CFG predecessor, expressing one-step producer/consumer handoffs without widening visibility to the full scope. Read-side switch only; producer's `bind` is unchanged. Sketch in [future/edge-scoped-bind.md](future/edge-scoped-bind.md).                                                                                                                                                                                                                                                                                                   |
| Streaming / partial outputs from tasks | Tasks are "input in, output out" per the principles' boundary statement.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| User-interaction / suspend-resume      | Not mentioned in principles; out of v1.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Dynamic task registry                  | v1 assumes the registry is static across a single engine load (§5.7 MUST 7); the load-time drift check (§4.1 pass 3) rules out `TaskNotFound` and `TaskContractDrift` before execution begins. Allowing the registry to mutate under a running workflow opens a runtime failure class that v1 deliberately does not specify, since the failure-routing question (`onError`? whole-workflow abort? pinned task version?) is dangerous to get wrong and pulls in versioning and resume concerns also deferred from v1. Door is open: the static-registry decision is additive to revisit.                           |

---

## 3. IR schema

The IR is a JSON document. Every example in this document is JSON.

### 3.1 Top-level workflow

```jsonc
{
  "kind": "workflow",
  "name": "string identifier",
  "version": "1",                 // IR schema version, not workflow version
  "inputSchema":  { /* JSON Schema for workflow input */ },
  "outputSchema": { /* JSON Schema for workflow output */ },
  "types": {
    "<typeName>": { /* JSON Schema; referenced as { "$ref": "#/types/<typeName>" } */ }
  },
  "constants": {
    "<constantName>": {
      "schema": { /* JSON Schema */ },
      "value":  /* concrete value, must validate against schema */
    }
  },
  "nodes": {
    "<nodeId>": { /* node object, see 3.3 */ }
  },
  "entry": "<nodeId>",            // single entry node
  "output": { /* reference object that yields workflow output */ }
}
```

Required fields: `kind`, `name`, `version`, `inputSchema`, `outputSchema`,
`nodes`, `entry`, `output`. `types` and `constants` are optional.

Note on naming. Three fields travel together on every value-producing
scope and on every value-producing node: `output` is the **value**
(a reference object, resolved at scope or node exit), `outputSchema`
is the **type** (a JSON Schema the resolved value must satisfy), and
`bind` (on a node) is the **outer-scope name** the value is published
under. The workflow root has the first two and is itself the outer
scope, so it has no `bind`. The same triple appears on `loop` nodes
and, mirrored on the input side, on `task` nodes
(`inputs` + `inputSchema`).

#### 3.1.1 Shared schemas (`types`)

Any JSON Schema field in the IR (`inputSchema`, `outputSchema`,
`selectorSchema`, `state[*].schema`, `constants[*].schema`, and nested
positions inside any of these) may be replaced by a reference to a
named entry in the workflow's `types` block:

```jsonc
"outputSchema": { "$ref": "#/types/FetchedDoc" }
```

Rules:

- The only legal `$ref` form in v1 is `"#/types/<typeName>"`. Remote URIs,
  pointer escapes outside `#/types/`, and recursive type definitions are
  rejected by the validator.
- `types` entries may themselves use `$ref` to other `types` entries, as long
  as the resulting graph is acyclic.
- `types` is purely an authoring/validation affordance. It does not introduce
  a new data-reference form (the `$from` family is unchanged) and it has no
  runtime effect beyond schema validation.

Motivation: many shapes (a task's `outputSchema` and downstream consumers'
`inputSchema`, or a branch's `selectorSchema` and the producing task's enum
field) appear in two or more places. Naming them once lets the
validator treat ref-equal positions as compatible by identity (a fast
path for pass 4.2 - this is the §1.1 "acceptable performance"
requirement), lets codegen emit the canonical shape once instead of
repeating it, and gives reviewers a single site to read when a shape
changes (P4 local reasoning).

### 3.2 Names and scopes

- `nodes` is a map; the key is the node's id within its scope.
- A scope is the top-level workflow or the body of a `loop` node.
- Node ids are unique within their scope. Different scopes may reuse ids; refs
  always resolve within the scope of the referencing node (P4 boundary
  closure).
- A node id is a CFG label. It does **not** by itself make the node's output
  addressable from other nodes. Outputs become addressable only by binding
  them to a scope variable (see `bind` in section 3.3 and the `scope`
  namespace below).

#### 3.2.1 Scoping rules

This subsection consolidates the scoping model used throughout the IR. It
introduces no new mechanism; it states the rules that the rest of the design
already follows.

**Scopes.** There are exactly two kinds of scope in v1:

1. The **workflow scope** (the top-level document).
2. A **body scope** (the `body` of a `loop` node).

Every node belongs to exactly one scope. A scope owns its `nodes` map and its
own `entry` node. Scopes nest: a loop's body scope is nested inside the scope
that contains the loop node.

**v1 is pure SSA.** Every `$from` namespace is single-assignment within its
**frame**: each name is bound at most once per frame and never mutated in
place. What differs across namespaces is only the lifetime of the frame.
Apparent "updates" - re-running a binding node on the next iteration,
advancing `state` across the iteration boundary - are not mutations; they are entries
into a new frame that re-binds the name. The §3.3 multiple-binders rule and
the §4.1 pass 6 dominator check are the standard SSA join (phi) and
dominance constraint applied per namespace.

**Namespaces.** Within a scope, names are partitioned into disjoint
namespaces, one per `$from` discriminant. All four namespaces are
scope-wide.

| `$from`      | Declared at                                                             | Visible in                    | Frame (single-assignment lifetime)                                                                                    |
| ------------ | ----------------------------------------------------------------------- | ----------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `"input"`    | Workflow `inputSchema` typing the run input, or a loop's `inputs` block | The scope it belongs to       | Workflow input: the run. Loop `inputs`: evaluated once per loop activation, stable thereafter.                        |
| `"constant"` | Workflow root `constants`                                               | Every scope                   | The run.                                                                                                              |
| `"scope"`    | A node's `bind` field publishes the node's output                       | The scope the node belongs to | One execution of the binding node. In a loop body, re-bound each iteration.                                           |
| `"state"`    | The enclosing loop's `state` block                                      | That loop's body scope        | One iteration. Frame transition is body completion with `continueWhen` true, which evaluates `iterateState` (§3.7.1). |

A task node dispatched via an `onError` edge additionally receives two
engine-injected input fields named `error` and `trigger` before its
`inputs` block is resolved (see §3.8). These fields are part of the
recovery node's `inputSchema` and are read with `$from: "input"` like
any other input field; they are not a `$from` namespace because they
are never declared at any reference site. The collapse of the previous
handler-local `error` and `trigger` discriminants into ordinary
engine-injected input fields is recorded in §8.7.

Because the namespaces are disjoint, the same name may appear in more than one
of them without conflict. For example, a workflow may have an input field
`x`, a constant `x`, and a node that binds its output as `x` in the same
scope; a reference always names which namespace it reads from via `$from`.
The validator does not warn on cross-namespace name reuse, but tools may.

**The `scope` namespace is hide-by-default.** A node's output is **not**
addressable from other nodes unless the node declares `bind: "<name>"`.
Nodes that do not bind execute normally; their outputs simply have no name
in the scope and cannot be referenced. This is the central data-visibility
rule of v1: **bind to share, omit to hide.**

Rationale and analysis: see [decisions/0001-bound-outputs.md](decisions/0001-bound-outputs.md).

**Cross-scope visibility.** The only name a body scope can read from outside
itself is a workflow-root `constant`. All other outer data must enter the body
through one of the loop's two declared boundary mechanisms:

- The loop's `inputs` block, which the body reads as `$from: "input"`.
- The loop's `state` block, whose `initial` references resolve in the outer
  scope and whose values the body reads as `$from: "state"`.

Body nodes cannot reference outer-scope `scope` variables, outer-scope
`input` fields, or another loop's `state`. This is the **scope closure**
property (P4) and is enforced by validation pass 5.

**No sentinels.** v1 has no reserved CFG target tokens. Iteration is
expressed by the enclosing loop's `continueWhen` reference resolved at
body natural completion (§3.7); exit is just natural completion of a
scope. (Earlier drafts reserved `@iterate` / `@exit`; that design was
retracted by [decision 0010](decisions/0010-finish-workflow-scope-unification.md);
see §8.4.)

**Forward note (post-v1, nested loops).** When loops may contain loops, an
inner body's only outer-data channels remain its own loop's `inputs`, its
own `state`, and workflow-root `constants`. An inner body cannot read an
outer loop's `state` directly; if it needs that data, the outer loop's
state value must be threaded down via the inner loop's declared `inputs` or
mirrored into the inner loop's own `state`. This preserves scope closure at
every level. The decision is recorded here so it doesn't have to be
re-litigated when nested loops land.

#### 3.2.2 Two graphs, one validator

Every IR encodes **two distinct graphs over the same node set**:

1. The **control-flow graph (CFG).** Edges come from `next` (task,
   loop), branch `cases` and `default`, and `onError`. The CFG says
   _when_ a node runs. Sub-scopes (loop bodies, branch arms, fork
   branches, forkMap bodies) have their own nested CFGs joined at the
   enclosing node's natural completion; the enclosing loop's
   `continueWhen` decides whether body completion returns to
   `body.entry` or exits the loop (§3.7).
2. The **data-dependency graph (DDG).** Edges come from reference objects
   (`$from: "scope"` and, transitively, `$from: "state"`). The DDG says
   _which values a node consumes from where_. Only nodes that `bind` their
   output appear as DDG sources; unbound nodes contribute to the CFG only.

The two graphs are related but not identical. The validator enforces a single
directional invariant: for every DDG edge `A -> B` (B references A's bound
output), A must dominate B in the CFG of B's scope. In words, **every
declared data dependency implies a control-flow constraint**, but the CFG
may carry additional `next` edges that no data dependency requires.

This separation is deliberate. It lets:

- **Branches stay pure control-flow constructs.** A branch produces no
  value and contributes a CFG edge with no DDG counterpart. The `onError`
  edge is also a pure CFG edge: the recovery task is dispatched along it
  and reads its triggering context via the engine-injected `error` /
  `trigger` input fields (§3.8). The recovery task's own data
  dependencies on its surrounding scope go through ordinary `$from`
  references and contribute DDG edges like any other task.
- **Side-effecting tasks be sequenced without faking data flow.** "Run the
  migration, then run the readiness check" can be expressed as a `next` edge
  even though the readiness check does not consume the migration's output.
- **A future engine reason about ordering precisely.** The DDG is the
  _minimum_ set of ordering constraints; the CFG carries everything else.
  Whether a post-v1 engine uses the DDG to derive parallelism opportunities,
  or whether parallelism is declared explicitly in the IR, is deferred (§2.2);
  v1 takes no position. The two-graph distinction is principled on its own
  terms (validator clarity, P2 scenario 13's data/control separation) regardless
  of which way that decision goes.

##### v1 limitation: control-flow edges are ambiguous

In v1, a `next` edge with no underlying data dependency may be either:

- a **deliberate side-effect ordering** (the author wants A's side effects
  to happen before B), or
- an **accidental over-sequencing** (a leftover edge from a prior version of
  the IR).

The validator cannot distinguish these cases, because tasks in v1 are fully
opaque: they declare no side effects. Every `next` edge therefore has to be
treated as load-bearing-by-assumption. Authors and reviewers carry this
responsibility; the validator does not help.

Closing this gap is the explicit purpose of the post-v1 side-effect /
capability declaration work (see §2.2). Once tasks declare what effects they
have, a `next` edge that carries neither data nor effect-ordering becomes a
validator warning, and the two-graph model becomes fully principled.

Scenario evidence: three independent fetches forced into an arbitrary
`next` chain, and fan-out over a list that is 50x slower than parallel
dispatch. Both are existence proofs, not corner cases. See also the
§1.1.3 tension table row "Forced sequencing."

### 3.3 Common node fields

Every node carries a discriminant `kind` (P5: self-describing).

```jsonc
{
  "kind": "task" | "branch" | "loop",
  "inputs":  { /* per-kind: see below */ },
  "next":    /* per-kind: see below */,
  "onError": "<nodeId>",          // optional; absent = propagate
  "bind":    "<scopeVarName>"     // optional; absent = unbound (hidden)
}
```

`inputs` is always a map of named fields whose values are **reference objects**
(section 3.4). The shape of `inputs` is part of the node's typed input
schema (section 3.5). `onError`, when present, must point to a `task` node
in the same scope; the engine dispatches that task with two injected input
fields (`error` and `trigger`) per §3.8. `onError` applies to `task`,
`loop`, and `branch` nodes (and to `fork` / `forkMap` per ir-v0.2): for
branches it covers arm-scope failure (selector resolution and arm
selection remain statically proven; see §3.6 and §5.3); for loops it
covers body or state-transition failure that escapes the body
(§5.4).

**Absent fields, no `null`.** Optional fields throughout the IR
(`onError`, `bind`, `next` for terminals, `path` and `optional` on
references) are written by **omission**. Explicit `null` is not a
second legal spelling. The §1.3 consistency clause is what rules this
out: one rule ("field unset → default behavior") must have one
surface form. Validators that encounter `null` in any of these
positions reject the IR.

**`bind`** publishes the node's output as a scope variable, addressable by
other nodes via `$from: "scope"`. The value of `bind` may be:

- A non-empty string: the bound name.
- Absent: the node's output is **not** addressable by other nodes.
  The node may still execute, sequence successors via `next`, and have side
  effects, but no reference can read its value.

There is no boolean shorthand (the earlier `bind: true` form was removed
under the §1.3 variance lens; see §8.15 "Removed sugar"). Authors who
want to publish under the node id write the id explicitly: `bind: "<nodeId>"`.

**Multiple binders, one name (SSA-style merge).** A single bound name may be
produced by more than one node in the same scope **if no two such binders
can co-occur on a single execution path** (i.e., the binders sit on
mutually exclusive branch arms). At a join point downstream of the branch,
a consumer's reference `{ "$from": "scope", "name": X }` resolves to
whichever binder ran on the actual path, exactly like a phi node at a
control-flow join. The validator checks both the no-co-occurrence rule and
that every binder's output type is compatible with each consumer's expected
type (see validation passes 6 and 7). This is v1's first-class diamond-
merge mechanism.

Not every node kind produces a value worth binding:

- `task` nodes produce values; `bind` is the publishing switch. A task
  reached via an `onError` edge is still a task: it produces a value the
  same way and may be `bind`ed.
- `branch` nodes may produce a value when `bind` is declared: the selected
  arm's `scope.output` becomes the branch's output, validated against the
  branch's `outputSchema` ([decision 0010](decisions/0010-finish-workflow-scope-unification.md);
  §3.6). When `bind` is omitted, the branch is pure control flow and
  publishes nothing.
- `loop` nodes produce a value (`body.output` resolved at the terminating
  iteration's body completion); `bind` works on the loop node like any
  other value-producing node.

### 3.4 Reference positions (template model)

Every `inputs.<field>` and every `output` position in the IR holds a
**JSON template**: an arbitrary JSON value that the engine evaluates by
walking its structure, resolving engine-recognized forms, and returning
the composed result.

**Engine-recognized forms.** An object whose top-level key is
`$`-prefixed is engine-recognized. v1 defines two recognized forms:

1. **`$from` (reference).** Resolves a named value from a declared
   namespace and optionally projects into it.

   ```jsonc
   {
     "$from": "input" | "constant" | "scope" | "state",
     "name":  "<name>",            // input field, constant name, scope variable, or state var
     "path":  ["a", "b", 0, "c"],  // optional; omit (do not write []) when no projection is needed
     "optional": true              // optional; include only when true (absent = required)
   }
   ```

   - `$from: "input"` - read from the enclosing scope's declared input. On a
     task node dispatched via an `onError` edge, the engine-injected `error`
     and `trigger` fields are part of that node's `inputs` and are read with
     `$from: "input"` like any other input field (§3.8).
   - `$from: "constant"` - read a declared constant in the enclosing workflow.
     (Constants are workflow-global; readable from any scope. They are values
     declared in the IR, so this does not violate P4.)
   - `$from: "scope"` - read a scope variable (a value bound by some node via
     `bind`). The named bound value must exist in the enclosing scope.
     Validated by dominance + type compatibility (P1).
   - `$from: "state"` - read a loop-scoped state variable. Only legal inside a
     loop body.

   `optional: true` declares the reference may not be satisfied on every path
   (P1 scenarios 4, 5, 7). When unsatisfied, the consumer receives JSON `null`.
   The consumer's input schema must permit `null` in that position; the validator
   checks this.

   No other keys may appear as siblings of `$from` at the same object level.
   `{ "$from": "scope", "name": "x", "extra": 1 }` is rejected by the
   validator. Object templates and references are disjoint at any given
   level: an object either _is_ a reference (top-level key is `$from`) or
   it _is not_ (no `$from` key). Mixing is rejected. This keeps the
   disambiguation rule strictly local.

2. **`$literal` (escape).** Returns its argument verbatim without
   template evaluation.

   ```jsonc
   { "$literal": <any JSON value> }
   ```

   `$literal` short-circuits template walking: its argument is returned
   as-is, even if it contains `$from` subtrees or other `$`-prefixed keys.
   This is the only way to pass a literal `{ "$from": ... }` value through
   a template position. Nested `$literal` is also verbatim:
   `{ "$literal": { "$literal": 1 } }` evaluates to `{ "$literal": 1 }`,
   not `1`. There is no way to "unescape" inside a `$literal` body, by
   design.

**Reservation rule (P3 representation-surface axis, §1.3.2).** All
`$`-prefixed object keys at the top level of a template subtree are
reserved for the engine. v1 recognizes only `$from` and `$literal`;
future IR extensions may add new `$X` forms without
re-disambiguation. An object with an unrecognized `$`-prefixed
top-level key is rejected by the validator (forward-compatible:
old validators reject new forms rather than silently misinterpreting
them).

**Literal values.** Any JSON value that is not an engine-recognized
object evaluates to itself:

- Strings, numbers, booleans, `null`: evaluate to themselves.
- Arrays: each element is evaluated as a template; the result is the
  array of evaluated elements.
- Objects without a `$`-prefixed top-level key: each property value
  is evaluated as a template; the result is the object with evaluated
  values and unchanged keys.

**Examples.**

A pure reference (the only form available before this decision):

```jsonc
{ "$from": "scope", "name": "summary" }
```

A literal string:

```jsonc
"hello"
```

An object template mixing literals and references:

```jsonc
{
  "subject": { "$from": "scope", "name": "subject" },
  "body": { "$from": "scope", "name": "draft" },
  "priority": "normal",
}
```

A literal value that happens to contain a `$from` key (escaped):

```jsonc
{ "$literal": { "$from": "scope", "name": "x" } }
```

See [decisions/0007-value-construction-in-references.md](decisions/0007-value-construction-in-references.md)
for the full decision record, alternatives considered, and lens
analysis.

#### 3.4.1 Path projection semantics

`path` follows JSON Pointer semantics (RFC 6901) over the resolved value:
string elements address object fields, integer elements address array
indices. The projection is applied after the source is resolved, before
the value is handed to the consumer.

The canonical encoding of "no projection" is to **omit `path`**.
The empty array `[]` is not an accepted spelling of the same thing
(per the absent-fields-no-null rule in §3.3).

- If every path element resolves, the projected value is what the consumer
  sees, and the consumer's `inputSchema` checks against the projected type.
- If any path element cannot be resolved (missing field, out-of-range index,
  type mismatch such as indexing a string with a field name), the
  projection yields JSON `null`. The consumer's `inputSchema` must permit
  `null` at that position; if it does not, the validator's type
  compatibility pass (§4.1 pass 7) flags the reference.
- An optional reference (`optional: true`) that resolves to `null` short-
  circuits the path: applying `path` to `null` yields `null` regardless of
  the remaining elements.

This matches the rule for unsatisfied references and keeps engines, the
validator, and analyzers in agreement on a single observable behavior
(P5: predict behavior; §1.1 audience lens).

### 3.5 Task node

```jsonc
{
  "kind": "task",
  "task": "<task type identifier>", // names a registered task implementation
  "inputSchema": {
    /* JSON Schema */
  },
  "outputSchema": {
    /* JSON Schema */
  },
  "inputs": {
    "<fieldName>": {
      /* reference object */
    },
  },
  "next": "<nodeId>", // optional; absent = terminal (top-level only)
  "onError": "<nodeId>", // optional; see section 3.3
  "bind": "<scopeVarName>", // optional; see section 3.3
}
```

- The shape of `inputs` (the set of fields and their types) must satisfy
  `inputSchema`.
- The task's output is described by `outputSchema`. Other nodes' references
  to this task's output via `$from: "scope"` are checked against
  `outputSchema`. A task whose `bind` is absent has no addressable output,
  but `outputSchema` is still required (it documents the contract and is
  used by the runtime to validate the task implementation's return value).
  A special case: `outputSchema: { "not": {} }` declares that the task
  always fails (see v2 §3.4, "Never-output convention").
- An absent `next` (terminal node) is legal **only** in a value-producing
  scope: at the top level it terminates the workflow, and inside any
  `WorkflowScope` (loop body, branch arm, fork branch, forkMap body) it
  marks natural completion of that scope. There are no reserved CFG
  target tokens in v1 ([decision 0010](decisions/0010-finish-workflow-scope-unification.md)
  retired the `@iterate` / `@exit` sentinels in favour of body natural
  completion + `continueWhen`; see §8.4 Alt D).
- A task node may be the target of one or more `next`/`cases`/`default`
  edges (its normal dispatch paths) **or** the target of an `onError` edge
  from exactly one trigger T (the recovery dispatch path), but not both.
  A node reached via an `onError` edge receives two engine-injected input
  fields (`error` and `trigger`) before its `inputs` are resolved; the
  dispatch rules and dominator semantics for that case are in §3.8.

### 3.6 Branch node

```jsonc
{
  "kind": "branch",
  "selector": {
    /* reference object yielding a discriminant value */
  },
  "selectorSchema": {
    /* JSON Schema with "enum" or string-typed discriminant */
  },
  "cases": {
    "<caseValue>": {
      "inputs": {
        /* outer -> arm-scope wiring; reference objects resolved in
           the branch's outer scope */
      },
      "scope": {
        /* WorkflowScope: inputSchema, entry, nodes, output, outputSchema */
      },
    },
  },
  "default": {
    // optional; see exhaustiveness contract
    "inputs": {
      /* ... */
    },
    "scope": {
      /* WorkflowScope */
    },
  },
  "outputSchema": {
    // optional; required iff `bind` is declared
    /* JSON Schema. Every arm's scope.outputSchema must be assignable
       to it. MUST NOT be declared without `bind`. */
  },
  "next": "<nodeId>", // optional
  "onError": "<nodeId>", // optional; covers arm-scope failure
  "bind": "<scopeVarName>", // optional; hide-by-default per §8.15
}
```

- `selectorSchema` declares the legal set of discriminant values and must
  be string-typed: either `{ "type": "string" }` or `{ "enum": [...] }`
  with all-string members. Non-string discriminants (e.g., booleans from
  `int.lessThan`) require an explicit conversion task such as `bool.toLabel`
  ([decision 0008](decisions/0008-discriminant-key-encoding.md)).
- **Arms are `WorkflowScope`s.** `cases[<caseValue>]` and `default` are
  `{ inputs, scope }` wrappers around a [`WorkflowScope`](workflow-scope-proposal.md),
  identical in shape to fork branches (ir-v0.2 §2.1). `inputs` wires
  outer-scope values into the arm; `scope` declares the arm's
  `inputSchema`, `entry`, `nodes`, `output`, and `outputSchema`. The
  arm's `output` template is resolved in the arm-scope binding context
  at arm-scope natural completion (any body node with `next: null`),
  exactly like fork branch outputs.
- **Branch output is the selected arm's output.** Unlike fork (which
  combines all branches into one object), branch executes exactly one
  arm and its `output` becomes the branch node's output value. The
  branch's `outputSchema`, if declared, types that single value; every
  arm's `scope.outputSchema` must be assignable to it (selection
  semantics, not combination).
- **`bind` follows §8.15** (hide-by-default). If `bind` is declared,
  `outputSchema` must also be declared (the bound name needs a
  declared type). When `bind` is omitted, the branch's output value is
  not published into the outer scope; the branch is then a pure
  control-flow construct just like a v0.1 branch was.
- **`onError` covers arm-scope failure.** Selector resolution failure
  remains statically unreachable (§5.8.3 dominator + path-projection
  passes still apply, and the exhaustiveness contract below still
  rules out `BranchSelectorUnmatched`). Arm-scope failure is, however,
  a real runtime failure mode under v1: an arm's `scope` may contain
  arbitrary tasks. `onError` on the branch routes arm-scope failures
  to a recovery task in the branch's outer scope, parallel to fork's
  `onError` semantics (§3.8). Cross-arm error semantics are
  unambiguous because at most one arm executes per dispatch.
- **Exhaustiveness contract** (unchanged from v0.1). Either `default`
  is present, **or** the branch is statically exhaustive. A branch is
  statically exhaustive when:
  1. `selectorSchema` declares an `enum` (or is `{ "type": "boolean" }`,
     which is treated as the implicit enum `[true, false]`), AND
  2. `cases` contains a key for every enum member, AND
  3. The discriminant's resolved producer type is provably narrowed to a
     subset of the declared enum (the producer carries a matching `const`,
     `enum`, or `boolean` type - see [§3.6.1](#361-discriminant-narrowing)).
     When all three hold, omitting `default` is legal and
     `BranchSelectorUnmatched` is statically unreachable. Otherwise `default`
     is required (P5: no implicit fall-through).
- **No raw nodeId targets.** Branch arms do not target nodes in the
  branch's outer scope. Each arm is a closed sub-scope. Data that
  must outlive a single arm flows out via the arm's `scope.output`;
  control after the branch flows through the branch node's own
  `next`.
- **`cases[k]` arms differ from fork branches in one respect** -
  exactly one arm executes per dispatch, selected by `selector`. Fork
  executes all branches; the WorkflowScope contract is otherwise
  identical.

The choice to model a branch as a **discriminant switch** (rather than a
predicate `if/else`) is deliberate: a discriminant is a value computed by an
upstream task, which keeps decision logic inside a task (P3 boundary) and
keeps the branch node a pure structural dispatcher. The arm-as-`WorkflowScope`
shape preserves this property: the branch still does not evaluate
expressions; it dispatches to a sub-scope and resolves a reference at
sub-scope completion ([decision 0010](decisions/0010-finish-workflow-scope-unification.md);
[decision 0006](decisions/0006-no-expressions-in-ir.md) is unaffected).

### 3.7 Loop node

```jsonc
{
  "kind": "loop",
  "inputs": {
    "<boundaryInputName>": {
      /* reference from outer scope */
    },
  },
  "state": {
    "<stateVarName>": {
      "schema": {
        /* JSON Schema */
      },
      "initial": {
        /* reference object resolved at loop entry, in outer scope */
      },
    },
  },
  "body": {
    /* WorkflowScope: inputSchema, entry, nodes, output, outputSchema.
       The loop's `inputs` and `state[*].initial` together must satisfy
       body.inputSchema; see "Body scope contract" below. */
  },
  "continueWhen": {
    /* reference object resolved in body scope at body completion.
       Must resolve to a boolean. `true` -> next iteration; `false` -> exit. */
  },
  "iterateState": {
    "<stateVarName>": {
      /* reference object resolved in body scope at body completion */
    },
  },
  "maxIterations": 1000, // optional; engine default 10,000
  "next": "<nodeId>", // optional; see section 3.3
  "onError": "<nodeId>", // optional; see section 3.3
  "bind": "<scopeVarName>", // optional; loop output is body.output
}
```

Key points:

- **Body is a plain [`WorkflowScope`](workflow-scope-proposal.md)**, the
  same shape used by the top-level workflow, fork branches (ir-v0.2 §2.1),
  forkMap bodies, and branch arms ([decision 0010](decisions/0010-finish-workflow-scope-unification.md)).
  Body nodes cannot reference outer-scope variables directly; they reach
  outer data only through `state` (initialized from outer refs) and the
  loop's declared `inputs` (which body nodes read via `$from: "input"`).
- **Body scope contract.** `body.inputSchema` declares what the body
  scope expects. At loop dispatch the engine constructs the body scope's
  input value from two sources: the loop's `inputs` (values threaded from
  the outer scope, constant across iterations) and `state` (current
  iteration's values). The validator checks that the union of these two
  satisfies `body.inputSchema` ([§4.1 pass 7](#41-validation-passes)).
- `state` declares cross-iteration variables (P2 scenario 15). Each
  state variable has a schema and an initial value (resolved once at
  loop entry from the outer scope).
- **`continueWhen` decides each iteration's fate at body completion.**
  After the body reaches natural completion (its `body.output` template
  is resolved), the engine resolves `continueWhen` in the same body
  binding context. If it resolves to `true`, the engine evaluates
  `iterateState`, increments the iteration counter, and re-enters at
  `body.entry`. If it resolves to `false`, the loop exits and the body's
  resolved `body.output` value becomes the loop node's output. The body
  must reach natural completion every iteration (a body node with
  `next: null`); there are no sentinels. Loops that previously used
  `@iterate` / `@exit` from inside a body branch now have each arm bind
  the continuation discriminant under a shared scope name, and the loop
  reads that name as `continueWhen`. See [decision 0010 §3.6](decisions/0010-finish-workflow-scope-unification.md)
  for the lowering pattern.
- `iterateState` declares how each state variable is computed for the
  **next** iteration ([§3.7.1](#371-iterate-state)). It is the symmetric
  companion of `state[*].initial`: `initial` builds iteration 0's state
  from the outer scope; `iterateState` builds iteration N+1's state from
  the body scope at body completion when `continueWhen` is true. There
  is no implicit "node output overwrites state" rule and no per-node
  write declaration; every cross-iteration value flows through
  `iterateState`.
- **Loop output is `body.output`.** The body's `output` template, resolved
  at body completion of the **final** iteration (the one where
  `continueWhen` is `false`), is the loop node's output value. The
  loop's external output type is `body.outputSchema`. For
  accumulator-pattern loops the body typically reads from `state`; for
  retry-pattern loops it reads directly from a body-scoped binding
  ([decision 0009](decisions/0009-loop-output-source.md)). Loops that
  need to publish more than one value have a tail body node assemble
  them into a single object and the body's `output` references that
  one name.
- `maxIterations` is optional. If present, must be a positive integer;
  if exceeded, the loop fails with a well-known error type (consumable
  by `onError`). If omitted, the engine applies a default safety cap
  (10,000).
- `bind` on the loop publishes the loop's output value as a scope
  variable in the **outer** scope, just like any other value-producing
  node (§8.15).

#### 3.7.1 Iterate state

`iterateState` lives on the loop node and declares the **complete** state
for the next iteration. It is structurally parallel to `state[*].initial`:

| Site               | Computes              | References resolved in        |
| ------------------ | --------------------- | ----------------------------- |
| `state[*].initial` | iteration 0's state   | outer scope                   |
| `iterateState[*]`  | iteration N+1's state | body scope at body completion |

Rules:

- `iterateState` MUST contain an entry for every state variable declared in
  `state`. There is no implicit carry-forward; a variable that should keep
  its current value writes `{ "$from": "state", "name": "<S>" }` (P5: no
  surprise defaults).
- Each entry is a normal reference object resolved in the body scope at
  body completion (the same binding context in which `body.output` and
  `continueWhen` resolve). References to bound producers (`$from:
"scope"`) must be satisfied on every body-CFG path that reaches body
  completion, using the standard dominator + multiple-binders (phi)
  rules of §3.3 and §4.1 pass 6.
- Each entry's resolved value must be type-compatible with the corresponding
  `state[*].schema` (§4.1 pass 7).
- `iterateState` is evaluated only when `continueWhen` resolves to `true`.
  On the terminating iteration its templates are not resolved; if a
  template were to fail there, that failure is statically unreachable
  for the terminating iteration by construction.

State reads (`$from: "state"`) inside iteration `i` always see the values
computed by iteration `i-1`'s `iterateState` evaluation (or by
`state[*].initial` for `i = 0`). They never see partial mid-iteration
values because there are none: state only changes at the iteration
boundary (post-`continueWhen=true`).

**Why this shape.** Centralizing next-iteration state on the loop node
(rather than scattering writes across body nodes) means:

- The phi structure of state values is the same SSA mechanism as for bound
  scope variables (§3.3): different body paths may bind a name like
  `newDraft`, and `iterateState.draft = { "$from": "scope", "name":
"newDraft" }` resolves via the standard phi at body completion. No
  separate "no-race" rule for state writes is needed.
- Branches inside the body remain pure dispatchers over `WorkflowScope`
  arms; they do not carry state-write declarations.
- Reasoning about "what changes per iteration" is local to the loop node;
  reviewers do not have to scan every body node looking for writers.

**Path-dependent next state.** When different body paths produce the next
value differently, have each arm `bind` its result under the **same** scope
name (the standard §3.3 phi); `iterateState` then reads that one name and
the dominator pass (§4.1 pass 6) verifies coverage. If the arms produce
differently shaped values, normalize at the join: each arm's tail task
emits the canonical state shape and binds it under the shared name. Do not
try to encode per-arm conditionals inside an `iterateState` entry; it is
just a reference object.

**Failure semantics.** If the body fails before reaching natural
completion, neither `continueWhen` nor `iterateState` are evaluated;
state stays at the current iteration's values and the failure
propagates per §5.4.

### 3.8 onError dispatch

v1 has no separate handler node kind. Error recovery is expressed by
pointing a node's `onError` field at a `task` node N in the same scope.
When the trigger T fails, the engine dispatches N as the recovery task,
and injects two fields into N's `inputs` before resolving the rest of
N's references:

- `error` - the failure value, a structured object whose shape is fixed
  by §3.8.1 (the `Error` type).
- `trigger` - an object whose fields are T's resolved `inputs` (the
  values T was about to consume when it failed). This avoids forcing T to
  bind upstream values purely so the recovery can inspect them.

N's `inputSchema` MUST declare both fields (typed against
`#/types/Error` and against an object schema describing T's inputs,
respectively); the validator checks this when N is the target of an
`onError` edge. N reads them with `$from: "input"` like any other input
field.

**Rules for an `onError` recovery target N (with trigger T).** All four
are validator obligations and follow from the single "recovery task per
trigger" model:

1. **Reached only via T's `onError` edge.** N MUST NOT be the target of
   `next`, branch `cases` / `default`, or its scope's `entry`. The
   recovery dispatch path is exclusive.
2. **Single trigger.** At most one `onError` edge in the scope points at
   N. (Shared-handler reuse across triggers is post-v1; see §2.2 and
   §8.7.)
3. **Dominator scope.** N's reference legality uses
   `dominators(T) ∪ {T}`: every node that dominates T (including T's
   own predecessors) is referenceable from N, subject to the
   bind-to-share rule. T itself is treated as having executed for the
   purpose of dominance, even though N runs _because_ T failed; this is
   the P1 scenario 2 semantics.
4. **No recursive recovery.** N MUST NOT itself declare `onError`.
   Recovery chains (recovery-of-recovery) are not a v1 mechanism: they
   raise the question of when the chain terminates and how a recovery
   that itself keeps failing is observable, and the answer in v1 is the
   simple one - the recovery task is the last chance, and if it fails,
   the failure propagates. If a recovery needs to retry the work that
   originally failed, it does so by reaching the loop's body natural
   completion with `continueWhen` resolving to `true` (the bounded-retry
   pattern, P3 scenario 27), not by attaching another `onError` to itself.

A recovery node's `next` follows the same rules as any task's `next`
(terminal in top-level, must lead somewhere in a loop body), and a
recovery node may be `bind`-ed like any other task; it is a task in
every structural respect.

**Recovery failure semantics.** When the recovery task N fails (its
implementation throws, or its return value violates `outputSchema`), the
failure propagates to the enclosing scope of the _trigger_ T, exactly
as if T had failed with no `onError`. Inside a loop body this means
the recovery's failure fails the loop node; at top level it fails the
workflow. The original triggering error is not recoverable from the
propagated error in v1; the recovery's failure is what surfaces. (A
post-v1 error-chain mechanism could change this, but v1 keeps the
propagation single-valued for predictability.)

**Bind-name sharing across `onError`.** A trigger T with both
`next: A` and `onError: N` produces two mutually exclusive outcomes on
any single execution path: either T succeeds and control flows to A
(and through whatever chain A heads), or T fails and control flows to
N. A scope variable name X may therefore be bound on the success side
(by some node dominated by A, or by A itself) and also by N without
violating the phi-soundness rule of §3.3, because no path through T
reaches both sides. The dominator pass (§4.1 pass 6) treats T as a
splitting node for this purpose, analogous to a branch with `cases:
{ ok: A }, default: N`. This is what allows the §6.2 pattern of
`format` and `classifyError` both binding `final` to be valid.

#### 3.8.1 Error value shape

The value the engine injects as the recovery task's `error` input field
is a JSON object with this fixed schema, available as the built-in
`#/types/Error`:

```jsonc
{
  "kind":      "<string>",        // machine-readable error kind
  "message":   "<string>",        // human-readable summary
  "source":    "task" | "runtime", // where the failure originated
  "task":      "<string>",        // task type id from the failing node, optional
  "node":      "<string>",        // failing node id within its scope, optional
  "scopePath": ["<string>", ...],  // path to the failing node's scope, optional
  "data":      <any>              // task- or runtime-specific payload, optional
}
```

`Error` is a built-in type name reserved by v1: every conforming engine
provides `#/types/Error` implicitly, and a workflow's `types` block
MUST NOT redefine it. A recovery task's `inputSchema` references it as
`{ "$ref": "#/types/Error" }` for the `error` field without having to
declare it. (Codegen cannot reasonably synthesize this shape from a
workflow's own type catalog; making it built-in lets every recovery
node opt into the canonical envelope by reference.)

Required fields: `kind`, `message`, `source`. The remaining fields are
optional and may be absent. An engine MAY include additional fields
beyond those listed; consumers MUST treat unknown fields as opaque.

**`source` and `kind` discriminate the failure origin.**

- `"task"` — the registered task implementation returned `{ kind: "fail" }`
  or threw. `kind` is `"TaskError"`. `task` and `node` SHOULD be
  populated; `data` carries any additional payload the task returned.
- `"runtime"` — the engine raised a **recoverable** runtime condition.
  `kind` further discriminates the case:
  - `"RuntimeError"` — general engine failure (task timeout, policy
    denial, cancellation, etc.).
  - `"LoopMaxIterationsExceeded"` — the loop hit its `maxIterations`
    cap. Authors may want to catch this and return a partial result.
  - `"OutputSchemaViolation"` — the task returned a value that failed
    its declared `outputSchema`. This indicates a buggy or drifted task
    implementation; authors may want to log or fall back.
    All `"runtime"` errors are routed to `onError` handlers.
- `"runtime"` with `kind: "UnrecoverableError"` — the engine raised a
  condition that is **statically unreachable** after validation
  (e.g., `ReferenceUnresolved`, `BranchSelectorUnmatched`, unknown `$from`
  namespace, missing node). These indicate the IR bypassed the static
  validator. They are **not** routed to `onError` handlers — the run
  fails immediately regardless of any `onError` edge. Authors MUST NOT
  write workflows that depend on catching these; they should instead
  ensure the IR passes static validation.

An engine MAY use additional `kind` values for finer-grained
discrimination; consumers MUST treat unknown `kind` values as opaque
and fall back to inspecting `source`.

A recovery task that wants to be type-strict about the error it
consumes can narrow the schema for its `error` input field below
`#/types/Error` (e.g., requiring `data` to match a specific schema for
a known task failure). One that only needs the message can declare just
`{ "message": { "type": "string" } }` and rely on structural subtyping
(§4.2). Path projection (§3.4.1) on the `error` input works the same
as on any other input field, so a recovery can read just `error.kind`
or `error.data.foo` without binding the whole object.

The `trigger` field's schema mirrors the trigger T's `inputs` map: an
object whose properties are the field names T declares in its own
`inputSchema`. The validator can derive this shape from T directly; the
recovery node restates it (or a narrowing of it) the same way it
restates `Error`, for IR self-containment.

The shape is fixed in v1 to keep recoveries writable without needing to
look up the failing task. Per-task or per-error-kind typed payloads
belong in `data` and are out-of-band of v1's contract: a recovery that
cares unpacks `data` with a runtime check, exactly as it would for any
open-world JSON. A future error-taxonomy mechanism could lift `data`
into a discriminated union; that work is post-v1.

### 3.9 The full node grammar

```
Node     := TaskNode | BranchNode | LoopNode
Scope    := WorkflowScope  // see workflow-scope-proposal.md
Workflow := { name, version, inputSchema, outputSchema, constants?, ...Scope }
```

Three node kinds, one scope shape ([`WorkflowScope`](workflow-scope-proposal.md):
`inputSchema`, `entry`, `nodes`, `output`, `outputSchema`), one template
model (§3.4: JSON templates with `$from` references and `$literal`
escape), one `bind` switch, one `output` template shape shared by every
value-producing scope (workflow root, loop body, branch arm). This is
the entire v1 surface. Error recovery is an `onError` edge to a task
node (§3.8); it adds no node kind.

---

## 4. Validation

Validation is **static**: it runs against an IR without any task being
invoked. An IR that passes validation is guaranteed to satisfy P1 (every
reference will resolve) for any execution path.

### 4.1 Validation passes (in order)

1. **Schema syntax pass.** The document conforms to the JSON schema of the
   IR (correct fields, correct types of fields).
2. **Type resolution pass.** Every `$ref` in a JSON Schema position has the
   form `"#/types/<typeName>"` and resolves to a defined entry in `types`.
   The graph of refs between `types` entries is acyclic. After this pass,
   subsequent passes may treat any schema position as either an inline schema
   or an opaque reference to a named type.
3. **IR/task drift pass (registry-required for engines, optional for offline tools).** Every `task` node's `inputSchema` is checked
   to be a subtype of the registered task's declared input schema, and
   the registered task's declared output schema is checked to be a
   subtype of the node's `outputSchema` (the §4.2 subtype relation).
   The task's declared contract is the authoritative envelope; the
   IR's schemas are either a verbatim restatement (the common case)
   or a narrowing of that envelope (specialization). An IR that
   contradicts its task is rejected. This is the static equivalent of
   the runtime check in §5.2, applied symmetrically to both sides of
   the IR/task seam.
   - **Engine audience.** The engine MUST run this pass at load time
     with the registry available; v1 assumes the task registry is
     static across a single engine load (§5.7 MUST 7). The runtime
     case where a registry mutates after load (dynamic registry) is
     deferred to post-v1 (§2.2).
   - **Offline tooling audience.** Standalone validators (CLI lint,
     archival validation) without a registry skip this pass and
     report the IR as standalone-valid. They surface this skip in
     their output so the operator knows pass 3 has not been
     performed.
     See §8.16.
4. **Name resolution pass.** Within each scope: walk every template
   position (`inputs.<field>`, `output`, `iterateState[*]`,
   `selector`). At each `$from` subtree (at any nesting depth within
   the template), verify the target name exists. `$literal` subtrees
   are skipped (no resolution inside them). Objects with unrecognized
   `$`-prefixed top-level keys are rejected.
   Additionally: there are no reserved CFG target tokens in v1
   (§3.2.1 "No sentinels"); `onError` targets a `task` node in the
   same scope; `entry` names an existing node. `bind`, when present,
   is a non-empty string (no boolean shorthand in v1; see §8.15). A
   branch node MAY declare `bind` ([decision 0010](decisions/0010-finish-workflow-scope-unification.md));
   when it does, the branch's `outputSchema` MUST be present and
   every arm's `scope.outputSchema` MUST be assignable to it. A branch
   node MUST NOT declare `outputSchema` unless it also declares `bind`
   (an unbound branch is pure control-flow and has no outer-visible
   value to type). Each arm's `scope` MUST itself satisfy the
   `WorkflowScope` validation passes (this section, recursively): name
   resolution, scope closure, dominator, type compatibility,
   termination, and acyclicity all apply within the arm scope, taking
   the arm's `inputs` as its boundary input binding. Each loop node's
   `body` MUST likewise satisfy the `WorkflowScope` validation passes
   recursively, taking the loop's `inputs` and `state` as its boundary
   input binding (see §3.7).
   A node N that is the target of an `onError` edge from a trigger T:
   MUST NOT itself declare `onError`; MUST NOT be the target of any
   `next`, branch `cases` / `default`, or scope `entry` (the recovery
   dispatch path is exclusive); and MUST be the target of at most one
   `onError` edge in its scope (no shared recoveries in v1; see §3.8).
   References with `$from: "scope"` resolve to at least one binder of that
   name in scope.
5. **Scope closure pass (P4).** Body nodes do not reference outer-scope scope
   variables. The only outer data visible in a body is via `$from: "input"`
   (loop boundary inputs), `$from: "state"` (loop state), and
   `$from: "constant"` (workflow constants).
6. **Dominator pass (P1).** Walk each template position; for every
   `$from` subtree (at any nesting depth) of the form
   `$from: "scope", name: X` inside a node Y, and for the
   set of binders B(X) = { nodes in scope with `bind: X` }:
   (a) **Phi soundness:** no two binders in B(X) lie on the same path from
   scope entry to Y (i.e., no binder dominates another binder of the
   same name; the binders are pairwise on mutually exclusive branch
   arms).
   (b) **Coverage:** every path from scope entry to Y passes through at
   least one binder in B(X) (some binder of X dominates Y on every
   path). For optional references, coverage is not required, but the
   consumer's schema must accept `null` at that field.
   When Y is the target of an `onError` edge from a trigger T,
   dominator semantics use `dominators(T) ∪ {T}` for Y's `$from:
"scope"` references; the engine-injected `error` and `trigger`
   input fields are part of Y's own `inputs` and do not participate in
   dominator reasoning.

   For phi soundness (a) on a name X bound by both a node R reached only
   via `T.onError` (the recovery task) and a node S on T's success side
   (S is T itself, T's `next`, or any node dominated by them), R and S
   are treated as on mutually exclusive paths even though both are
   dominated by T. The intuition is that T splits its outgoing control
   flow into a success continuation (`next`) and a failure continuation
   (`onError`), and no single execution reaches both. Coverage (b) for a
   downstream consumer that depends on X must be satisfied by binders on
   each of T's two outcomes - if only the success side binds X, a path
   through `onError` leaves X unbound and the reference must be
   `optional` (or the consumer is not a dominator of both outcomes).

   References inside `iterateState` (loop node, §3.7.1) participate in
   this pass like any other reference, but their dominance question is
   asked against the body CFG joined at body natural completion: every
   body-CFG path from `body.entry` to any natural-completion node (a
   body node with `next: null`) must satisfy each `iterateState[*]`
   reference (a binder of the named value dominates that path's
   completion site, or the reference is `optional` and the target
   schema admits `null`). The same coverage condition applies to
   `body.output` and to the loop's `continueWhen`. Multiple-binder phi
   (§3.3) is the mechanism for path-dependent next-iteration values:
   different arms may bind the same name, and `iterateState` resolves
   to whichever binder ran on the path that reached body completion.

7. **Type compatibility pass (P1).** Compute each template position's
   **resolved type** compositionally:

   - Literal values (strings, numbers, booleans, `null`): their
     JSON-Schema-derived type.
   - `$from` subtrees: the producer's declared output type with
     `path` projection applied.
   - `$literal` subtrees: the JSON-Schema-derived type of the
     argument (no template evaluation).
   - Objects (non-`$`-prefixed): property-wise composition of each
     value's resolved type.
   - Arrays: element-wise composition.

   The resolved type must be a structural subtype of the field type
   at the consumer's `inputSchema`. When multiple binders contribute
   to the same name (phi merge), every binder's `outputSchema` must
   be a structural subtype of the consumer's expected type.
   `output`'s resolved type is checked against the enclosing scope's
   `outputSchema` (workflow root, every fork branch's `scope`, every
   forkMap body, every loop body, and every branch arm's `scope`).
   Branch `selectorSchema` checks against the selector's resolved
   type; `cases` keys must be valid values in `selectorSchema`.
   **Boundary checks introduced by [decision 0010](decisions/0010-finish-workflow-scope-unification.md):**
   for each branch node, each arm's resolved `inputs` map (per-field
   types composed in the branch's outer scope) must be a structural
   subtype of the arm's `scope.inputSchema`, and -- when the branch
   declares `bind` -- every arm's `scope.outputSchema` must be a
   structural subtype of the branch's `outputSchema`. For each loop
   node, the union of the loop's `inputs` (typed in outer scope) and
   the loop's `state[*].schema` must satisfy `body.inputSchema`; the
   loop's `continueWhen` resolved type must be a structural subtype
   of `{ "type": "boolean" }`; and `body.outputSchema` types the
   loop's output value (and -- when the loop declares `bind` --
   `body.outputSchema` is what the bound name carries in the outer
   scope). Fast path: if all producer and consumer positions are the
   same `"#/types/<typeName>"` reference, compatibility holds by
   identity without structural walking.

8. **Exhaustiveness pass.** Every branch has either an exhaustive `cases`
   over an enum-typed selector or a `default`. v1 requires `default`
   regardless.
9. **Termination pass.** Every node in any scope can reach the scope's
   natural completion (a node with `next` absent, or a branch all of
   whose arms transitively terminate). Pure cycles are rejected
   (P3 scenario 26); iteration is expressed only at the loop boundary
   via `continueWhen` (§3.7), never as a back-edge inside a scope.
10. **Acyclicity within scope (P3 + P4).** The intra-scope control-flow graph
    is acyclic. Iteration is expressed only by the enclosing loop's
    `continueWhen` re-entering `body.entry` at body completion (§3.7).
    This makes the dominator computation a standard DAG analysis and prevents
    "accidental loops" (P3 scenario 26).
11. **State soundness pass.** Every loop state variable declared in `state`
    has a corresponding entry in `iterateState`, and every read
    (`$from: "state"`) is type-compatible with the variable's schema. A
    state variable whose `iterateState` entry is just
    `{ "$from": "state", "name": "<self>" }` for every iteration is a
    candidate to be a workflow `constant` instead; the validator MAY warn
    but does not reject.
12. **Output binding pass.** Every `output` reference (the workflow
    root's, and each loop node's) must resolve to a bound producer or to a
    state value: a `$from: "scope"` reference targets a node with `bind`
    set; a `$from: "state"` reference (legal only for a loop's
    `output`) targets a declared state variable. The reference's
    resolved type must be compatible with the scope's `outputSchema`
    (the workflow root's `outputSchema` for the workflow `output`; the
    loop's `outputSchema` for a loop's `output`) via the §4.2 subtype
    relation.

### 4.2 Compatibility (the type relation)

A producer type `P` is **compatible** with a consumer field type `C` iff `P`
is a structural subtype of `C`:

- Primitive: same primitive type, with consumer's enum/format constraints
  being a superset of the producer's.
- Object: every required property of `C` is present in `P` with a compatible
  type; extra properties in `P` are ignored.
- Array: producer's element type is compatible with consumer's element type;
  length constraints on `C` are a superset of `P`'s.
- Union: `P` is compatible with `C` iff every variant of `P` is compatible
  with some variant of `C`.
- `null` is only compatible with a consumer that explicitly allows `null`.

Structural subtyping was chosen (vs nominal exact match) because it lets
recovery tasks and downstream tasks accept "at least these fields" without
forcing upstream tasks to know every consumer's exact shape.

### 4.3 Error model for the validator

Validation produces a list of errors, each carrying:

- A scope path (e.g., `top.nodes.writeLoop.body.nodes.evaluate`).
- A field path within the node.
- A machine-readable error code.
- A human-readable message.

This makes errors localizable (P4 scenario 30).

---

## 5. Execution semantics

The execution model is described abstractly. v1 specifies sequential
execution along `next` chains (see §5.7 MUST 2); the engine is free to
optimize within that bound (batching, fusion, memory liveness) as long as
it preserves these semantics. Whether parallelism is added later as a
declared IR construct or as an opportunistic engine derivation is deferred
to post-v1 (§2.2).

### 5.1 Top-level execution

1. The engine receives the workflow's typed input (validated against `inputSchema`).
2. It begins at `entry`.
3. For each visited node N:
   a. Resolve `inputs` from references (in N's scope).
   b. Execute N (kind-specific, see below).
   c. If N succeeds: if N is a loop with no `next` and we are top-level,
   finish; else proceed to the node named by `next` (or by branch `cases`).
   d. If N fails: if `onError` is set, dispatch the recovery task R per
   §3.8 (the engine injects R's `error` and `trigger` input fields
   before resolving R's other references); otherwise propagate failure
   to the enclosing scope. A loop body propagating failure fails the
   loop node itself.
4. When a top-level terminal is reached, resolve `output` and return
   its value as the workflow output.

### 5.2 Task execution

The engine calls the registered task implementation with the resolved
`inputs`. The implementation returns a value validated against `outputSchema`.
A schema-violating return is a task failure. This runtime check guards
against the task implementation drifting from its declared `outputSchema`
between the load-time drift check (§4.1 pass 3) and the actual call (e.g.,
the registered implementation was redeployed). v1 assumes the registry is
otherwise static for the lifetime of an engine load; dynamic-registry
semantics are post-v1 (§2.2).

### 5.3 Branch execution

1. Resolve `selector` against the branch's outer scope.
2. Look up the arm: `cases[value]`, else `default`. If no case matches and
   no `default` is declared, the branch is statically exhaustive (§3.6);
   reaching this step at runtime is unreachable by validator construction
   (§5.8.3).
3. Resolve the arm's `inputs` against the branch's outer scope, producing
   the arm scope's boundary input value; validate against
   `arm.scope.inputSchema`.
4. Execute the arm scope: begin at `arm.scope.entry` and run its nodes by
   the same rules as the top-level scope (§5.1). Body nodes read the
   boundary value via `$from: "input"`. The arm scope's own scope and
   input namespaces are private to the arm; the branch's outer scope is
   not visible inside.
5. When the arm scope reaches natural completion (a body node with
   `next: null`), resolve `arm.scope.output` in the arm-scope binding
   context; validate against `arm.scope.outputSchema`. That value is
   the branch node's output.
6. If `bind` is declared on the branch, publish the resolved output
   under that name in the branch's outer scope (§8.15); validate
   against the branch's `outputSchema`. Otherwise the value is not
   published.
7. Proceed to the branch node's outer `next`.
8. Failure during arm-scope execution that is not caught inside the arm
   propagates to the branch node, which routes to its own `onError` (if
   any) or fails its outer scope. Recovery task injection follows §3.8
   with the branch as trigger.

### 5.4 Loop execution

1. Resolve loop `inputs` from outer scope.
2. Initialize each `state` variable from its `initial` reference (resolved
   in outer scope), validating against the variable's schema.
3. Set iteration counter `i = 0`.
4. Begin iteration:
   - If `i >= maxIterations` (or the engine default when omitted), fail
     with `LoopMaxIterationsExceeded`.
   - Compose the body scope's boundary input value from the loop's
     `inputs` (constant across iterations) and the current iteration's
     `state`; validate against `body.inputSchema`.
   - Execute the body scope starting at `body.entry`, by the same rules
     as the top-level scope (§5.1). Inside the body, `$from: "state"`
     reads see the values established at the start of this iteration;
     state does not change during a body iteration.
   - When the body reaches natural completion (a body node with
     `next: null`), resolve `body.output` in the body-scope binding
     context; validate against `body.outputSchema`. Call the resolved
     value `Y_i`.
   - Resolve `continueWhen` in the same body-scope binding context.
     - If `false`: the loop exits. `Y_i` is the loop node's output
       value; if `bind` is declared, publish it under that name in the
       loop's outer scope. Proceed to the loop node's outer `next`.
     - If `true`: evaluate the loop's `iterateState` against the body
       scope to produce the next iteration's state; validate each
       resolved value against its `state[*].schema`; increment `i`;
       restart at body initialization with the new state. `Y_i` is
       discarded.
5. Failure inside the body that is not caught by a body-scope `onError`
   edge propagates to the loop node, which then routes to its own
   `onError` (if any) or fails its outer scope.

### 5.5 onError dispatch

When a trigger node T fails and T declares `onError: R`, the engine
dispatches R as the recovery task. T may be a task, a loop, a branch
(arm-scope failure), a fork, or a forkMap. Failure of T is whichever
failure mode applies to its kind: for `task`, the implementation throws
or returns a value that violates `outputSchema`; for `loop`, body or
state failure that escapes the body (§5.4 step 5); for `branch`,
arm-scope failure that escapes the arm (§5.3 step 8); for `fork` /
`forkMap`, sub-scope failure per ir-v0.2 §2. The dispatch shape is the
same in every case:

1. Build R's `inputs` map: inject `error` (the structured failure value
   per §3.8.1) and `trigger` (an object whose fields are T's resolved
   inputs) as input fields, then resolve R's other declared `inputs`
   references against R's scope using `dominators(T) ∪ {T}` for `$from:
"scope"` reads.
2. Validate the assembled inputs against R's `inputSchema`.
3. Execute R as an ordinary task (§5.2).
4. On success, follow R's `next` (or terminate, if R is a top-level
   terminal). On failure, propagate per the rule below.

If the recovery task R itself fails, the failure propagates to T's
enclosing scope as if T had failed with no `onError` (§3.8 "Recovery
failure semantics"). The original triggering error is dropped; the
recovery's failure is what surfaces. R does not itself carry `onError`
(§3.8 rule 4), so there is no recursive recovery chain to walk.

### 5.6 Observability

Per P3, the engine emits an event stream that mirrors the IR structure:

- `nodeStarted(scopePath, nodeId, iteration?)`
- `nodeCompleted(scopePath, nodeId, iteration?, output)`
- `nodeFailed(scopePath, nodeId, iteration?, error)`
- `loopIterationStarted(scopePath, loopNodeId, iteration)`
- `loopExited(scopePath, loopNodeId, iteration, output)`

Iterations are addressable; the consumer of these events can map every event
back to an IR coordinate (P3 scenario 21).

### 5.7 Conformance bar (MUST / SHOULD / MAY)

The IR is declarative; some quality-of-implementation choices (memory
liveness, retry granularity) are left to the engine. The conformance bar
serves two audiences: it ensures any IR running on one v1 engine runs on
all v1 engines, and it keeps the bar narrow enough that a future engine
or downstream consumer can implement just the MUST list and remain
interoperable (§1.1 door-keeping). v1 distinguishes the conformance bar
from recommended optimizations on that basis. Concurrency is not in either
bar: v1 specifies sequential execution along `next` chains and defers the
parallelism question (declared vs. opportunistic) to post-v1 (§2.2).

**A conforming v1 engine MUST:**

1. Run the validation passes in section 4.1 and reject any IR that fails
   them.
2. Execute the CFG sequentially: dispatch each node when its `inputs` are
   resolvable per the dominator rules in section 3.2, and complete each
   node before dispatching its `next` successor. v1 does not specify
   concurrent execution of independent nodes; the parallelism question is
   deferred to post-v1 (§2.2).
3. Compute next-iteration `state` per section 3.7.1 (after `body.output`
   resolves at body completion, resolve `continueWhen`; when it is
   `true`, evaluate `iterateState` against the body scope; failure
   before body completion leaves state unchanged and propagates per
   section 5.4 step 5).
4. Route failures via `onError` per section 5.5; propagate uncaught
   failures to the enclosing scope per section 5.4 step 5.
5. Execute branch arms as `WorkflowScope`s per section 5.3 (resolve
   `selector`, dispatch the matching arm, run the arm's scope to
   natural completion, resolve `arm.scope.output` as the branch's
   output value; bind only when the branch declares `bind`).
6. Emit the observability events listed in section 5.6.
7. Run §4.1 pass 3 (IR/task drift) at engine load time with the
   registry available, and reject any IR whose `task`
   nodes name a missing task or whose declared `inputSchema` /
   `outputSchema` contradict the registered task's contract per the
   §4.2 subtype relation. v1 assumes the registry is static across
   a single engine load: there is no `TaskNotFound` or
   `TaskContractDrift` failure path during execution because the
   load-time check has already ruled both out. Dynamic-registry
   semantics (where a task can disappear or change contract under a
   running workflow) are post-v1 and own the question of how those
   failures should be surfaced (§2.2 row "Dynamic task registry").
8. When dispatching a task R via an `onError` edge from a trigger T,
   inject `error` and `trigger` into R's `inputs` per §3.8 before
   resolving R's declared references and validating against R's
   `inputSchema`.

**A conforming v1 engine SHOULD:**

- **Free unbound outputs immediately.** A node without `bind` cannot be
  referenced by any other node, so its output value may be released the
  moment the node completes (after `outputSchema` validation and after
  observability emission). This is a static property of the IR; no
  analysis required.
- **Free bound outputs after their last reader.** For nodes with `bind`,
  the DDG is fully static; a one-pass liveness analysis at validation time
  identifies, for each bound output, the set of dominated descendants that
  reference it. Once every such descendant has run (or been pruned by branch
  selection), the bound value may be released. The liveness set MUST include
  every loop's `state.<var>.initial` reference: loop initialization (§5.4
  step 2) is the last reader of any bound output named in a loop init, so
  freeing such an output before the loop entry is observed would break the
  loop. (Bound outputs only referenced by `state.initial` are dropped
  immediately after loop initialization.)
- **Retry without restarting the workflow.** When a recovery task
  resumes via `next`, the engine should not recompute upstream nodes
  whose outputs are still live.

**A conforming v1 engine MAY:**

- Cache, memoize, or persist node outputs across runs.
- Inline successive single-task nodes into a fused execution unit.
- Anything else not constrained by MUST or SHOULD.

The MUST list is the portability bar - any IR that runs on one
conforming engine runs on all of them. The SHOULD list is the quality
bar - engines that skip these will produce correct results but with
poor memory or latency profiles on realistic workflows.

### 5.8 Runtime checks and defense-in-depth

The engine performs two categories of runtime checks during execution.
**Essential checks** catch errors that cannot be detected statically
because they depend on runtime values. **Defense-in-depth checks**
re-verify invariants already proven by the static validator (§4.1) and
are redundant when static validation has run against the same IR and
registry.

A conforming engine MUST support a `defenseInDepth` flag (or
equivalent) that controls whether the second category runs. The flag
defaults to **on** when static validation is skipped, and **off** when
static validation has run; callers MAY override explicitly.

#### 5.8.1 Essential runtime checks

These checks MUST always run because they validate runtime values that
the static validator has no visibility into.

**Schema validation (runtime values)**

| Check                     | Trigger                                     | Rationale                                                                      |
| ------------------------- | ------------------------------------------- | ------------------------------------------------------------------------------ |
| **Workflow input schema** | Caller provides `input`                     | Input is external to the IR; no static knowledge of actual values              |
| **Task output schema**    | Task implementation returns                 | Catches buggy or drifted task implementations returning wrong types (§5.2)     |
| **Never-output contract** | Task with `{ "not": {} }` output returns ok | Task declared it always fails; returning success means a broken implementation |

**Security / policy**

| Check                                | Trigger                                         | Rationale                            |
| ------------------------------------ | ----------------------------------------------- | ------------------------------------ |
| **Side-effect policy deny**          | Policy map says `"deny"`                        | Runtime configuration, not in the IR |
| **Side-effect prompt / no callback** | Policy says `"prompt"` but no approval callback | Runtime configuration                |
| **Approval rejected**                | Approval callback returns non-approved          | User decision at runtime             |

**Execution control**

| Check                           | Trigger                           | Rationale                                                           |
| ------------------------------- | --------------------------------- | ------------------------------------------------------------------- |
| **Run cancelled**               | `AbortSignal` fires               | External cancellation at runtime                                    |
| **Task timeout**                | Execution exceeds `timeoutMs`     | Runtime duration is unpredictable                                   |
| **Loop maxIterations exceeded** | Iteration count ≥ `maxIterations` | Runtime convergence; static analysis cannot predict iteration count |

**Task contract**

| Check                     | Trigger                                   | Rationale                                                      |
| ------------------------- | ----------------------------------------- | -------------------------------------------------------------- |
| **Task failure**          | Task throws or returns `{ kind: "fail" }` | External services fail; legitimate runtime error               |
| **Unrecoverable failure** | Task fails with no `onError`              | Failure propagation; the task threw and no handler is declared |

#### 5.8.2 Defense-in-depth runtime checks (gated)

These checks MAY be skipped when static validation has passed. Each
re-verifies an invariant that the static validator already proves
(column "Static guarantee"). They are controlled by the
`defenseInDepth` flag described above.

**Structural (static IR properties)**

| Check                     | Static guarantee                                               | Reasoning                                                                                   |
| ------------------------- | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| **Constant value schema** | `jsonValueToSchema` + `isStructuralSubtype` (§4.1 type compat) | Constant values are in the IR; static validator derives their type and checks compatibility |

**Propagation (static type compat + essential task output check)**

These are redundant because the essential **task output schema** check
(§5.8.1) ensures every task implementation's actual return value
conforms to its declared `outputSchema`, and the static validator
proves every template's resolved type is structurally compatible with
its target schema (§4.2). Together, types are proven compatible
statically and values are proven conformant at each task boundary.

| Check                         | Static guarantee                                           | Reasoning                                                                                                   |
| ----------------------------- | ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| **Workflow output schema**    | §4.1 type-compatibility pass + essential task output check | Static proves template type fits schema; task output check ensures upstream values match declared types     |
| **Loop input schema**         | §4.1 type-compatibility pass + essential task output check | Static proves input template types match `inputSchema`; task output check validates actual upstream values  |
| **Loop state initial schema** | §4.1 type-compatibility pass + essential task output check | Static proves initial-value template types match state schemas; task output check validates upstream values |
| **Loop output schema**        | §4.1 type-compatibility pass + essential task output check | Static proves output template types match `outputSchema`; task output check validates body bindings         |
| **Loop iterateState schema**  | §4.1 type-compatibility pass + essential task output check | Static proves iterateState template types match state schemas; task output check validates body bindings    |

#### 5.8.3 Statically proven but unconditional checks

The checks in this section are all proven unreachable after static
validation, but are kept **unconditional** (not gated by
`defenseInDepth`) because they are cheap and provide clear diagnostics
if an IR somehow bypasses static validation.

**Structural / integrity**

| Check                            | Static guarantee                                           | Reasoning                                                                                                                                                                                                                                                                                             |
| -------------------------------- | ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Node not found**               | §4.1 name-resolution pass                                  | Null check; all node references are verified statically                                                                                                                                                                                                                                               |
| **Unregistered task**            | §4.1 IR/task drift pass                                    | Null check; all task names are checked against the registry at validation time                                                                                                                                                                                                                        |
| **Fork min-2 branches**          | §4.1 structural check                                      | Comparison; branch count is a static IR property                                                                                                                                                                                                                                                      |
| **forkMap collection not array** | §4.1 type-compatibility pass + essential task output check | `Array.isArray` check; static proves collection resolves to array type                                                                                                                                                                                                                                |
| **Branch selector unmatched**    | §3.6 exhaustiveness contract + §4.1 type-compatibility     | When `default` is absent the validator proves the branch is exhaustive (selectorSchema has enum, all enum values appear as cases, and selector producer is provably narrowed). When `default` is present, unmatched values route to it. Either way, raising `BranchSelectorUnmatched` is unreachable. |

**Template resolution (dominator analysis + type checking)**

The static validator's dominator analysis with onError-split awareness
(§4.1 scope-closure and dominator passes) proves that every non-optional
`$from: "scope"` reference is bound on all execution paths, including
error-recovery paths. Path projections are verified by
`checkSchemaCompat` which rejects paths into undeclared schema
properties. Combined with the essential task output check (§5.8.1),
which ensures actual values match declared schemas, path projection
type errors at runtime are unreachable.

| Check                                  | Static guarantee                                | Reasoning                                                                                                        |
| -------------------------------------- | ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| **Unknown `$from` namespace**          | §4.1 schema-syntax pass                         | Only valid namespaces (`input`, `constant`, `scope`, `state`) are accepted                                       |
| **Unresolved reference**               | §4.1 dominator pass with onError-split coverage | Binding coverage is proven on all paths including error-recovery paths; uncovered non-optional refs are rejected |
| **Path projection on null/wrong type** | §4.1 type-compatibility + `resolveSchemaPath`   | Path segments are checked against declared schema structure; task output check ensures actual values match       |

---

## 6. Worked examples

### 6.1 Linear two-step workflow

```jsonc
{
  "kind": "workflow",
  "name": "fetchAndSummarize",
  "version": "1",
  "types": {
    "Url": {
      "type": "object",
      "properties": { "url": { "type": "string" } },
      "required": ["url"],
    },
    "Body": {
      "type": "object",
      "properties": { "body": { "type": "string" } },
      "required": ["body"],
    },
    "Summary": {
      "type": "object",
      "properties": { "summary": { "type": "string" } },
      "required": ["summary"],
    },
  },
  "inputSchema": { "$ref": "#/types/Url" },
  "outputSchema": { "$ref": "#/types/Summary" },
  "entry": "fetch",
  "nodes": {
    "fetch": {
      "kind": "task",
      "task": "http.get",
      "inputSchema": { "$ref": "#/types/Url" },
      "outputSchema": { "$ref": "#/types/Body" },
      "inputs": { "url": { "$from": "input", "name": "url" } },
      "next": "summarize",
      "bind": "page",
    },
    "summarize": {
      "kind": "task",
      "task": "llm.summarize",
      "inputSchema": {
        "type": "object",
        "properties": { "text": { "type": "string" } },
        "required": ["text"],
      },
      "outputSchema": { "$ref": "#/types/Summary" },
      "inputs": {
        "text": { "$from": "scope", "name": "page", "path": ["body"] },
      },
      "bind": "result",
    },
  },
  "output": { "$from": "scope", "name": "result" },
}
```

Note how `Url` is shared between the workflow `inputSchema` and the `fetch` task's
`inputSchema`, and `Summary` is shared between the workflow `outputSchema`, the
`summarize` task's `outputSchema`, and (transitively, via `output`)
the workflow result. The compatibility pass collapses each ref-equal pair to
an identity check.

### 6.2 Branch with task-level `onError` recovery

```jsonc
{
  "kind": "workflow",
  "name": "classifyAndRoute",
  "version": "1",
  "types": {
    "Doc": {
      "type": "object",
      "properties": { "doc": { "type": "string" } },
      "required": ["doc"],
    },
    "Result": {
      "type": "object",
      "properties": { "result": { "type": "string" } },
      "required": ["result"],
    },
    "ClassifyLabel": { "type": "string", "enum": ["news", "code", "other"] },
    "Classified": {
      "type": "object",
      "properties": { "label": { "$ref": "#/types/ClassifyLabel" } },
      "required": ["label"],
    },
  },
  "inputSchema": { "$ref": "#/types/Doc" },
  "outputSchema": { "$ref": "#/types/Result" },
  "entry": "classify",
  "nodes": {
    "classify": {
      "kind": "task",
      "task": "llm.classify",
      "inputSchema": { "$ref": "#/types/Doc" },
      "outputSchema": { "$ref": "#/types/Classified" },
      "inputs": { "doc": { "$from": "input", "name": "doc" } },
      "next": "route",
      "onError": "classifyError",
      "bind": "classified",
    },
    "route": {
      "kind": "branch",
      "selector": { "$from": "scope", "name": "classified", "path": ["label"] },
      "selectorSchema": { "$ref": "#/types/ClassifyLabel" },
      "cases": {
        "news": {
          "inputs": { "doc": { "$from": "input", "name": "doc" } },
          "scope": {
            "inputSchema": { "$ref": "#/types/Doc" },
            "outputSchema": { "$ref": "#/types/Result" },
            "entry": "summarizeNews",
            "nodes": {
              "summarizeNews": {
                /* task ... outputSchema: { "$ref": "#/types/Result" }
                   ... bind: "armOut" (terminal: next omitted) */
              },
            },
            "output": { "$from": "scope", "name": "armOut" },
          },
        },
        "code": {
          "inputs": { "doc": { "$from": "input", "name": "doc" } },
          "scope": {
            "inputSchema": { "$ref": "#/types/Doc" },
            "outputSchema": { "$ref": "#/types/Result" },
            "entry": "explainCode",
            "nodes": {
              "explainCode": {
                /* task ... outputSchema: { "$ref": "#/types/Result" }
                   ... bind: "armOut" (terminal: next omitted) */
              },
            },
            "output": { "$from": "scope", "name": "armOut" },
          },
        },
      },
      "default": {
        "inputs": { "doc": { "$from": "input", "name": "doc" } },
        "scope": {
          "inputSchema": { "$ref": "#/types/Doc" },
          "outputSchema": { "$ref": "#/types/Result" },
          "entry": "fallback",
          "nodes": {
            "fallback": {
              /* task ... outputSchema: { "$ref": "#/types/Result" }
                 ... bind: "armOut" (terminal: next omitted) */
            },
          },
          "output": { "$from": "scope", "name": "armOut" },
        },
      },
      "outputSchema": { "$ref": "#/types/Result" },
      "bind": "routed",
      "next": "format",
    },
    "format": {
      /* task ... inputs: { result: { "$from": "scope", "name": "routed" } }
         ... outputSchema: { "$ref": "#/types/Result" }
         ... bind: "final" (terminal: next omitted) */
    },
    "classifyError": {
      "kind": "task",
      "task": "errors.report",
      "inputSchema": {
        "type": "object",
        "properties": {
          "error": { "$ref": "#/types/Error" },
          "trigger": {
            "type": "object",
            "properties": { "doc": { "type": "string" } },
            "required": ["doc"],
          },
        },
        "required": ["error", "trigger"],
      },
      "outputSchema": { "$ref": "#/types/Result" },
      "inputs": {}, // `error` and `trigger` are engine-injected per §3.8
      "bind": "final",
    },
  },
  "output": { "$from": "scope", "name": "final" },
}
```

`ClassifyLabel` is the canonical enum: it appears once in `types`, is reused
by `classify.outputSchema` (nested) and by `route.selectorSchema`, and the
exhaustiveness pass reads its `enum` from there. `Result` is shared by every
arm's `scope.outputSchema` and by the branch's `outputSchema`, so the
boundary check (§4.1 pass 7) that "every arm's `scope.outputSchema` is
assignable to the branch's `outputSchema`" collapses to an identity check.

Each branch arm is its own `WorkflowScope` ([decision 0010](decisions/0010-finish-workflow-scope-unification.md)):
the arm declares `inputs` that wire the outer `doc` into the arm boundary,
and the arm's body produces its result under `armOut`, exposed as the
arm's `scope.output`. The branch selects exactly one arm; the selected
arm's `output` becomes the branch's output value, which is published into
the outer scope under `bind: "routed"`. The downstream `format` task
reads `{ "$from": "scope", "name": "routed" }` once - no diamond merge
is needed because the branch itself reifies the selection into a single
binder.

The `classifyError` recovery task receives the original `doc` via the
engine-injected `trigger` field (whose value is `classify`'s resolved
`inputs`), and the failure value via the engine-injected `error` field
(typed against the built-in `#/types/Error`). Neither field has to be
threaded through `classify`'s bound output, so the recovery's needs do
not leak into `classify`'s contract. Both `format` and `classifyError`
bind the workflow result as `final`; only one of them runs in any given
execution, so the bind names do not collide at runtime, and the
validator accepts the shared name under the `onError`-mutual-exclusion
clause of the dominator pass (§4.1 pass 6, §3.8 "Bind-name sharing
across `onError`"): `classify` splits into a success continuation that
reaches `format` and a failure continuation that reaches
`classifyError`, and no path through `classify` reaches both.

### 6.3 Loop with state and bounded retry

The loop node below is shown in isolation. `$ref`s point at types that would
be declared in the enclosing workflow's `types` block, e.g.:

```jsonc
"types": {
  "Topic":   { "type": "object", "properties": { "topic":   { "type": "string" } }, "required": ["topic"] },
  "Article": { "type": "object", "properties": { "article": { "type": "string" } }, "required": ["article"] },
  "Verdict": { "type": "string", "enum": ["accept", "revise"] },
  "Evaluation": {
    "type": "object",
    "properties": {
      "verdict":  { "$ref": "#/types/Verdict" },
      "feedback": { "type": "string" },
    },
    "required": ["verdict", "feedback"],
  },
}
```

```jsonc
{
  "kind": "loop",
  "inputs": { "topic": { "$from": "input", "name": "topic" } },
  "state": {
    "draft": {
      "schema": { "type": "string" },
      "initial": { "$from": "constant", "name": "emptyString" },
    },
    "feedback": {
      "schema": { "type": "string" },
      "initial": { "$from": "constant", "name": "emptyString" },
    },
  },
  "body": {
    "inputSchema": { "$ref": "#/types/Topic" },
    "entry": "write",
    "nodes": {
      "write": {
        "kind": "task",
        "task": "llm.draft",
        "inputSchema": {
          "type": "object",
          "properties": {
            "topic": { "type": "string" },
            "previous": { "type": "string" },
            "feedback": { "type": "string" },
          },
        },
        "outputSchema": {
          "type": "object",
          "properties": { "text": { "type": "string" } },
          "required": ["text"],
        },
        "inputs": {
          "topic": { "$from": "input", "name": "topic" },
          "previous": { "$from": "state", "name": "draft" },
          "feedback": { "$from": "state", "name": "feedback" },
        },
        "next": "evaluate",
        "bind": "write",
      },
      "evaluate": {
        "kind": "task",
        "task": "llm.evaluate",
        "inputSchema": {
          "type": "object",
          "properties": { "text": { "type": "string" } },
          "required": ["text"],
        },
        "outputSchema": { "$ref": "#/types/Evaluation" },
        "inputs": {
          "text": { "$from": "scope", "name": "write", "path": ["text"] },
        },
        "next": null,
        "bind": "evaluate",
      },
    },
    "output": { "$from": "scope", "name": "write", "path": ["text"] },
    "outputSchema": { "type": "string" },
  },
  "continueWhen": {
    "$from": "scope",
    "name": "evaluate",
    "path": ["verdict_isRevise"],
  },
  "iterateState": {
    "draft": { "$from": "scope", "name": "write", "path": ["text"] },
    "feedback": { "$from": "scope", "name": "evaluate", "path": ["feedback"] },
  },
  "maxIterations": 5,
}
```

(For brevity, the example assumes `llm.evaluate` returns
`{ verdict, feedback, verdict_isRevise: boolean }`; in practice a
small `string.equals` task lowering of `verdict === "revise"` would
sit between `evaluate` and the body's natural completion, binding
`verdict_isRevise`. The loop's `continueWhen` then reads that
boolean.)

This demonstrates: loop construct (P3), declared cross-iteration state (P2),
explicit `continueWhen` termination (P5; no implicit re-entry), boundary-closed body (P4), bounded
iteration (P5 universally-unsurprising default with explicit cap).

### 6.4 Optional reference at a merge

```jsonc
"merge": {
  "kind": "task",
  "task": "merge.combine",
  "inputSchema": {
    "type": "object",
    "properties": {
      "primary":   { "type": "string" },
      "enriched":  { "type": ["string", "null"] }
    },
    "required": ["primary"]
  },
  "outputSchema": { /* ... */ },
  "inputs": {
    "primary":  { "$from": "scope", "name": "fetch" },
    "enriched": { "$from": "scope", "name": "enrich", "optional": true }
  },
  "bind": "merged"
}
```

Here `enrich` is behind a branch and does not dominate `merge`. The optional
reference makes the partial dependency explicit (P1 scenario 7), the
consumer's schema admits `null`, and the merge task itself decides what to do
when enrichment is absent (boundary choice). Both `fetch` and `enrich` must
be bound (assume `bind: "fetch"` and `bind: "enrich"`) for `merge` to
reference them.

---

## 7. How the design satisfies each principle

| Principle | Design feature(s) that satisfy it                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| P1        | **Intra-IR axis:** template model with `$from` references and named source (§3.4); static dominator pass over an acyclic intra-scope CFG; compositional type compatibility pass (resolved template types); `optional` flag for declared partial deps; finite `cases`+`default`; SSA-style phi soundness on shared bound names. **External-contract axis:** registry-gated IR/task drift pass (§4.1 pass 3) checks each task node's `inputSchema`/`outputSchema` against the registered task's contract using the §4.2 subtype relation; runtime output validation (§5.2) is the defense-in-depth layer when the registry is absent at validation time. |
| P2        | Only four declared `$from` sources (input, constant, scope, state); error recovery dispatches a task via `onError` and injects `error` / `trigger` as ordinary input fields, not as additional `$from` discriminants; no ambient/global state; cross-iteration data is a declared `state` variable with declared writes; outputs flow via `output`; bound outputs make the data-flow contract explicit per node                                                                                                                                                                                                                                        |
| P3        | Distinct node `kind`s for `task`/`branch`/`loop`; error recovery is an `onError` edge to a task node, not a fourth kind; loop bodies, branch arms, and fork branches are structural `WorkflowScope`s, not flat regions; iteration is the loop's `continueWhen` re-entering `body.entry` at body completion ([decision 0010](decisions/0010-finish-workflow-scope-unification.md)), not a back-edge; pure cycles are rejected; `bind` mirrors "some steps publish, some don't" from real programs                                                                                                                                                       |
| P4        | Body scope closure (no cross-scope name reach); declared loop `inputs`/`output`/`state`; per-scope `onError` recovery tasks; localizable validation errors with scope paths; hide-by-default `bind` keeps internal computations out of the scope's contract                                                                                                                                                                                                                                                                                                                                                                                            |
| P5        | Required `kind` discriminant; required explicit `next` in body scopes (no implicit re-entry; `next: null` marks natural completion); explicit `continueWhen` for loop termination ([decision 0010](decisions/0010-finish-workflow-scope-unification.md)); required `default` in branches; template model with `$`-prefix reservation (no shorthand/inference; `$literal` escape for collisions); optional `maxIterations` with engine default; explicit `bind` makes value lifetime statically predictable                                                                                                                                             |

---

## 8. Design choices considered (open for review)

For each area where multiple designs satisfy the principles, the chosen option
is listed first with its rationale, followed by alternatives.

### 8.1 Type system: structural subtyping over JSON Schema

- **Chosen:** structural subtyping; producer must be a subtype of consumer.
- Alt A: nominal/exact match (named types). Rejected: forces upstream task
  authors to know every downstream consumer's exact shape.
- Alt B: TypeScript types as the surface. Rejected for v1 to avoid coupling
  the IR to a specific language toolchain; JSON Schema is language-neutral.
- Alt C: Schema **intersection** (consumer requires any superset). Equivalent
  to structural subtyping for object types; structural subtyping is the more
  general framing.

Notes (post-v1):

1. The IR is a compile target. A DSL is expected to sit on top, where
   authors can write types in TypeScript that compile to JSON Schema (the
   "Option D" pattern in the original analysis). The engine itself never
   needs to know about TypeScript - the compiled JSON Schema is what flows
   into the IR.
2. If JSON Schema verbosity becomes a real problem (IR size, author
   friction at scale), a compact custom type IR (the "Option C" pattern)
   could be introduced as an alternative encoding that lowers to JSON Schema
   for runtime validation. Additive only; not part of v1.

### 8.2 Reference syntax: object form, no shorthand

- **Chosen:** one explicit object form `{ "$from": ..., "name": ..., "path": ... }`.
  Under the template model (§3.4, decision 0007), `$from` objects
  appear at any nesting depth within a JSON template; the object-form
  rationale applies unchanged.
- Alt A: string form `"node:fetch.body"`. Rejected: needs a parser, hides
  source kind, harder to extend with `optional`.
- Alt B: JSONPath/JMESPath. Rejected: too expressive (computed indirection
  conflicts with P1 scenario 8).

### 8.3 Branching: discriminant switch with required `default`; arms are `WorkflowScope`s

- **Chosen:** switch on a discriminant value with `cases` map and required
  `default`. Each `cases[k]` and `default` arm is `{ inputs, scope }`
  where `scope` is a [`WorkflowScope`](workflow-scope-proposal.md)
  ([decision 0010](decisions/0010-finish-workflow-scope-unification.md)).
- Alt A: predicate-based `if/else` with an embedded expression language.
  Rejected: introduces an expression language (more concepts, P5 surprise
  surface) and pushes decision logic out of tasks. See also
  [decision 0006](decisions/0006-no-expressions-in-ir.md) (no expressions
  in the IR; standard-library tasks are the answer).
- Alt B: exhaustive switch with no `default`. Rejected for v1: simpler to
  always require `default`; can be relaxed later when enum exhaustiveness is
  trusted.
- Alt C: arm targets node ids in the branch's outer scope (the v0.1
  shape, "no inputs, no outputs, no bind"). Rejected by
  [decision 0010](decisions/0010-finish-workflow-scope-unification.md):
  the carve-out forced the DSL to lower arm bodies to a chain of
  outer-scope nodes and synthesize an identity-noop at the join (DSL
  gap G5/G6), and it left branch as the only structured kind without
  `WorkflowScope` while fork, forkMap, and loop bodies already used
  it. The arm-as-scope shape removes that asymmetry and lets the
  branch optionally publish its selected arm's output via `bind`,
  keeping the discriminant-switch / no-expression contract intact.

Note (post-v1): the discriminant-switch model assumes the cost of an extra
classifier task is negligible. If profiling shows that per-decision task
dispatch is a hot path (e.g., very tight branches inside large loops), a
restricted predicate form (Alt A) may be reintroduced as a performance escape
hatch. It would be additive, not a replacement, and would have to carry its
own design review against P5.

### 8.4 Loop termination: `continueWhen` reference, no sentinels

- **Chosen:** the loop body is a plain [`WorkflowScope`](workflow-scope-proposal.md);
  each iteration runs the body to natural completion (a body node with
  `next: null`), then the loop's `continueWhen` reference is resolved
  in the body-scope binding context. `true` continues to the next
  iteration; `false` exits with the body's resolved `body.output` as
  the loop's output ([decision 0010](decisions/0010-finish-workflow-scope-unification.md)).
- Alt A: distinct node kinds (`iterateNode`, `exitNode`). Rejected:
  unnecessary node kinds; the sentinel was purely a transition target.
- Alt B: boolean flags on the body node (e.g., `terminal: true`). Rejected:
  P5 - reader has to learn that `terminal: true` means "exit the loop".
- Alt C: implicit re-entry when `next` is omitted. Rejected by P5 scenario 37.
- Alt D (v0.1 chosen, now retracted): explicit string sentinels
  `@iterate` / `@exit` in `next` / branch case targets. Retracted by
  [decision 0010](decisions/0010-finish-workflow-scope-unification.md):
  the sentinels were the carve-out that kept the loop body different
  from every other `WorkflowScope`. They were also the reason the v0.1
  branch carve-out had to be preserved (a branch inside a loop body
  needed to target `@iterate` / `@exit` from inside an arm, which is
  not expressible once arms become scopes). `continueWhen` makes both
  carve-outs disappear: the body terminates the same way every other
  scope does, and termination is a value computed in the body scope
  rather than a special target string. The P5 "no implicit re-entry"
  property is preserved because `continueWhen` is required and is just
  a reference object (no defaults).

### 8.5 Next-iteration state: declared centrally on the loop (`iterateState`)

- **Chosen:** the loop node carries an `iterateState` block that, at every
  iteration boundary (after body completion when `continueWhen` is
  `true`), computes the complete next-iteration state from the body
  scope. Symmetric with `state[*].initial`.[^iterate-boundary]

[^iterate-boundary]:
    Before [decision 0010](decisions/0010-finish-workflow-scope-unification.md)
    the iteration boundary was the `@iterate` sentinel transition. The
    boundary is now body natural completion gated by `continueWhen`;
    the centralizing rationale, the reuse of the §3.3 phi for
    path-dependent next state, and the rejection of per-node
    `stateWrites` (Alt A) are all unchanged.

- Alt A: per-body-node `stateWrites` map (the original v1 design). Rejected:
  forced a no-race validation rule across multiple writers, admitted
  dominance-ordered "dead writes" that are unobservable under snapshot
  reads (§3.7.1's "reads see start-of-iteration values"), and required
  branches that target `@iterate` directly to either disallow that or carry
  state-write declarations (a concern dissolved when sentinels themselves
  were retired by [decision 0010](decisions/0010-finish-workflow-scope-unification.md):
  branches no longer target iteration boundaries). Centralizing on the loop removes all three problems and reuses
  the existing multiple-binders phi (§3.3) for path-dependent next state.
- Alt B: implicit "node output of name X overwrites state X". Rejected by
  P2 scenario 15 and P5.

### 8.6 State commit timing: at the iteration boundary, visible next iteration

- **Chosen:** state changes only at the iteration boundary (body
  natural completion when `continueWhen` resolves to `true`), by
  evaluating the loop's `iterateState` against the body scope. Reads
  in iteration `i` see state as of iteration-`i` start; there is no
  intra-iteration state mutation. The boundary itself was retimed
  from "the `@iterate` sentinel transition" to "body completion gated
  by `continueWhen`" by [decision 0010](decisions/0010-finish-workflow-scope-unification.md);
  the snapshot-read semantics and the rejection of intra-iteration
  visibility (Alt A) are unchanged.
- Alt A: writes visible immediately within the same iteration. Rejected:
  reads would depend on the order of writes; harder to reason about
  locally (P4, P5).
- Alt B: per-node writes that buffer and commit on node success (the
  original v1 design). Rejected together with the per-node write site
  itself in §8.5.

### 8.7 Recovery model: task dispatched via `onError` with engine-injected fields

- **Chosen:** error recovery is an `onError` edge to an ordinary `task`
  node in the same scope; the engine injects two input fields (`error`
  per §3.8.1 and `trigger`, an object whose fields are the trigger's
  resolved inputs) before resolving the recovery task's other inputs.
  The recovery node is a task in every structural respect (it has
  `inputs`, `inputSchema`, `outputSchema`, `next`, optional `bind`,
  and supports the bounded-retry pattern by routing back through a
  body node whose completion lets the loop's `continueWhen` re-fire). The validator
  enforces four edge-role rules (§3.8): reached only via T's `onError`
  edge, single trigger, dominator scope `dominators(T) ∪ {T}`, no
  recursive `onError` on the recovery itself.
- **Antecedent in pre-revision v1.** An earlier draft introduced a
  separate `kind: "handler"` node together with two pseudo-`$from`
  discriminants (`"error"` and `"trigger"`) and a per-kind
  trigger-input read mechanism. The variance lens (§1.3) flagged this
  as one behavioral concept ("task dispatched on a recovery edge with
  two extra inputs") wearing two surface labels: a node kind whose
  rules differed from `task` only because of the edge that reaches it,
  plus a pair of `$from` namespaces whose visibility was scoped to that
  one node kind. Collapsing the kind into `task` and the pseudo-sources
  into engine-injected input fields removes one node kind, two `$from`
  discriminants, and three validator special cases without changing
  any expressible workflow.
- Alt A: keep the dedicated `kind: "handler"` and the `error` /
  `trigger` `$from` namespaces (the antecedent). Rejected by the
  variance lens above: one rule, three surface forms.
- Alt B: shared recovery nodes (one recovery task reachable from
  triggers in different scopes). Deferred (P4 scenario 35 / out of v1
  scope; §2.2 "Reusable recovery tasks across scopes"). Also fails the
  variance lens for v1: a shared recovery's dominator set becomes the
  intersection of its triggers' dominators, so the recovery declaration
  carries different reference legality depending on which triggers
  point at it - one label, context-dependent rule. Most "same recovery
  over several nodes" scenarios are addressed post-v1 by **block
  scope** ([future/block-scope.md](future/block-scope.md)).
- Alt C: handlers as fields on the failing task (no separate node).
  Rejected: loses the ability to give the recovery its own `next`
  chain, its own `bind`, its own loop-body retry, and its own
  participation in the IR graph (visualization, observability events).
  The collapse in Alt A's rejection is to a _task_ node, not to an
  inline field.
- Alt D: merge `onError` into a node-level trigger declaration on the
  recovery side (the recovery node names its triggers instead of each
  trigger naming its recovery). Rejected: would remove the recovery
  task's independent `next`, `outputSchema`, and `bind` (the trigger
  would carry a single shared continuation), break the §3.8 retry
  pattern, and force the §6.2 worked example into a different shape.
  The chosen design preserves all of these.

### 8.8 Loop body: closed sub-scope, DAG only

- **Chosen:** body is a [`WorkflowScope`](workflow-scope-proposal.md)
  with the same shape as the workflow, acyclic; iteration happens only
  at the loop boundary (body natural completion gated by `continueWhen`
  per [decision 0010](decisions/0010-finish-workflow-scope-unification.md);
  retired sentinel form was `@iterate` per §8.4 Alt D).
- Alt A: body is a flat region of the parent graph. Rejected by P4 (no
  composability) and P3 (loop pattern hidden in topology).
- Alt B: body may contain its own cycles. Rejected by P3 scenario 26 - any
  cycle should be its own loop construct.

### 8.9 Constants: workflow-global, declared values

- **Chosen:** `constants` block at the workflow root, readable from every
  scope.
- Alt A: per-scope constants. Rejected for v1 on §1.3 minimalism plus the
  staging lens (§1.1) revisit-asymmetry: workflow-global is the strictly
  additive baseline because a global constant is equivalent to a per-scope
  constant declared at the workflow root and visible by closure. Per-scope
  can be added later without breaking any v1 IR (the scoping rule narrows,
  not widens). Going the other direction (per-scope first, then having to
  introduce closure semantics for global lookup) is breaking.
- Alt B: no constants; require literal values inline. Rejected: makes
  state initial values awkward (every loop needs an inline literal).

Interaction with post-v1 block scope ([future/block-scope.md](future/block-scope.md)):
that sketch keeps constants workflow-global; blocks and loops both reach
constants through the same root closure, so adding blocks does not require
revisiting this decision. If block-scoped constants ever become motivated,
they land as the additive per-scope extension above.

### 8.10 Scope output: explicit `output`

- **Chosen:** every value-producing scope (workflow root, loop) names its
  exit value with a single `output` reference resolved at scope
  termination, validated against the scope's `outputSchema`. The shape is
  identical for both scopes. A scope that needs to publish multiple values
  wraps them in an object built by a tail node and bound under one name;
  `output` then references that single name.
- Alt A: implicit "the last node's output". Rejected by P5: which node is
  "last" when there are multiple terminals?
- Alt B: a designated `output` node kind. Rejected: extra kind for what is
  effectively one reference.
- Alt C: loops carry an `outputs: { fieldName: ref, ... }` map (the
  pre-revision shape) while workflows use a single reference. Rejected
  under the §1.3 variance lens: the rule ("resolve a reference at scope
  exit, validate against the scope's output schema") is the same on both
  scopes; the asymmetric _shape_ (map vs single ref) was variance with no
  rule difference behind it. Loops that genuinely produce multiple values
  pay the same wrap-in-an-object cost as a workflow that needs to do the
  same.

### 8.11 Error edge dominator semantics

- **Chosen:** in v1, a recovery task is reached from exactly one trigger
  T, so its dominator set is `dominators(T) ∪ {T}` and any node in that
  set is referenceable (P1 scenario 2 directly).
- Alt A: shared recoveries with intersection-of-dominators semantics.
  Sound but more complex; deferred with shared-recovery support (§8.7
  Alt B).

### 8.13 Shared schemas: named `types` with restricted `$ref`

- **Chosen:** an optional `types` block at the workflow root; any JSON Schema
  position may use `{ "$ref": "#/types/<typeName>" }`. No other `$ref` form
  is allowed.
- Alt A: inline every schema (no sharing). Rejected: forces the validator to
  do structural subtyping where identity would suffice, and spreads the
  single source of truth across many sites (P4 friction when shapes change).
- Alt B: full JSON Schema `$ref` including remote URIs. Rejected: brings in
  network/identity issues and breaks the "IR is one self-contained
  document" property.
- Alt C: fold `types` into `constants` (a constant with `schema` only and no
  `value` would act as a type). Rejected: the two are conceptually distinct
  (constants are read at runtime via `$from: "constant"`; types are resolved
  at validation time via `$ref`) and conflating them costs more in reader
  confusion than the extra field saves.
- Alt D: a separate type-definition language. Rejected by 8.1 (stay on JSON
  Schema).

### 8.14 Naming the IR encoding format: JSON

- **Chosen:** JSON. Predictable, language-neutral, easy to validate; also
  keeps the IR usable as a portable artifact for any future downstream
  consumer (different engine, native compiler, transpiler, distribution
  artifact - §1.1 door-keeping) without locking it into a single parsing
  ecosystem.
- Alt A: YAML. More readable but adds parser ambiguity (anchors, types). Can
  be supported as an authoring convenience without changing the IR.
- Alt B: A custom textual IR. Rejected: more tooling to build, no benefit
  given the compile-target framing in §1.2.

### 8.15 Bound outputs (hide-by-default node values)

- **Chosen:** a node's output is **not** addressable by other nodes unless
  the node declares `bind`. References to bound values use
  `$from: "scope"`. Multiple binders may share a name on mutually exclusive
  paths (SSA-style phi at branch joins). `bind`, when present, is a
  non-empty string; the bound name is always written explicitly.
- Alt A: every node id is implicitly a name (the previous draft). Rejected:
  no data hiding, refactor fragility (CFG changes silently invalidate
  references), no clean DSL `let`-with-limited-scope target, weak engine
  liveness story (every output potentially live until scope end). Variance
  lens (§10): the node id would carry both CFG identity and DDG
  publication - one label, two rules, two concepts wearing one name.
- Alt B: per-node `private: true` opt-in flag. Rejected: hide should be the
  default, not the opt-in. Wrong polarity yields the same problems as Alt A
  in practice.
- Alt C: phi merges via shared bind names disallowed; require an explicit
  join construct (post-v1 block scope) for diamond merges. Rejected:
  unnecessary friction for the common case where branch arms produce a
  uniform output type. The validator's phi-soundness check is cheap.
- Alt D: edge-scoped reads (a `$from: "edge"` namespace resolving
  against the unique CFG predecessor) for one-step producer/consumer
  handoffs. Deferred to post-v1: the bind-vs-no-bind axis is settled
  for v1; this is an additive read-granularity refinement on the
  orthogonal axis. Sketch in
  [future/edge-scoped-bind.md](future/edge-scoped-bind.md).
- Recovery convenience: when a task is dispatched via an `onError` edge,
  the engine injects the trigger's resolved inputs as a `trigger` input
  field on the recovery (§3.8). This avoids forcing the trigger to bind
  upstream values purely so the recovery can read them, keeping each
  node's bind contract focused on its own consumers.

**Removed sugar (`bind: true`).** An earlier v1 draft accepted
`bind: true` as shorthand for "bind under my own node id" alongside
`bind: "<name>"`. The variance lens (§1.3 / §10) caught it on a second
review pass: the two writing forms carry one publication rule, the
boolean saves a few characters, and §1.2 is explicit that the IR has
no sugar. The boolean form was removed; `bind`, when present, is now
always a non-empty string. Authors who want "publish under the node id"
write the id explicitly. Codegen pays the few-character cost; readers
get one writing form. This is a worked example of the variance lens
applied to a surface choice rather than to a behavioral one. See
[decisions/0001-bound-outputs.md](decisions/0001-bound-outputs.md)
"Update (v1, post-revision)" for the original (c)-then-(b) reasoning.

Full analysis: [decisions/0001-bound-outputs.md](decisions/0001-bound-outputs.md).

### 8.16 Task schema source of truth

- **Chosen (v1):** the registered task's declared contract is the
  authoritative envelope; each `task` node's
  `inputSchema`/`outputSchema` is either a verbatim restatement of that
  contract (the common case) or a **narrowing** of it (the
  specialization case), and never a contradiction. Concretely, the
  validator checks - whenever the registry is available - that the
  IR's `inputSchema` is a subtype of the task's declared input (the
  IR promises at most what the task accepts) and that the task's
  declared output is a subtype of the IR's `outputSchema` (the task
  promises at least what the IR consumes), using the §4.2 subtype
  relation. The schemas live on the node so the IR remains
  self-contained (P2/P4) and so specialization is expressible; the task
  remains the source of truth for what the IR is allowed to say. The
  runtime output check (§5.2) remains as defense in depth for the
  registry-absent case.
- Alt A: IR authoritative, no static drift check (the original
  Option 1). Rejected: leaves the IR/task seam to runtime - a
  too-strict IR `inputSchema`, a too-loose IR `outputSchema`, or any
  input-side disagreement is invisible until a workflow runs and a value
  happens to expose it. The chosen variant closes this seam at no IR
  cost.
- Alt B: registry is the source of truth (the node omits its schemas;
  validator and runtime look them up). Rejected: IR is no longer
  self-contained, no specialization at the call site, schema evolution
  in the implementation silently changes IR semantics. Variance lens
  (§10): the same `inputSchema` field would mean "authoritative contract"
  in some IRs and "look elsewhere" in others - one label, context-
  dependent rule.
- Alt C: hybrid sugar. Schemas are optional on the node; if absent, the
  loader fills them in from the registry before validation, then the
  drift check runs as usual. Deferred: attractive as a v1.1 or DSL-layer
  feature once authors have data on how often they narrow vs. mirror,
  but starting at the chosen variant keeps the IR canonical form
  schema-complete and leaves the door open. **Trigger to revisit:** if
  IR size becomes a pain point (most nodes restating their task's
  schemas verbatim and no DSL absorbing the cost), Alt C is the
  pressure-relief valve - it reuses the chosen drift check unchanged
  and only adds the omission-as-sugar feature on top. See
  [decisions/0003-task-schema-source.md](decisions/0003-task-schema-source.md)
  "Triggers to revisit Option 3".
- Author convenience (DSL layer): repeated schemas are the IR's "verbose
  by design" tax (§1.2). Codegen absorbs the tax by populating
  `inputSchema`/`outputSchema` from a typed task signature in a single
  pass; the IR remains the canonical form, not a hand-authoring
  surface.

Full analysis: [decisions/0003-task-schema-source.md](decisions/0003-task-schema-source.md).

### 8.17 Pure SSA per namespace

The "v1 is pure SSA" property asserted at the top of §3.2.1 is not a
description after the fact; it is a design constraint that drove several
of the decisions in this section. This entry consolidates the rationale
so the property has one canonical justification.

- **Chosen:** every `$from` namespace is single-assignment within its
  frame. There is no in-place mutation anywhere in v1; every apparent
  update (re-running a binding node on the next iteration, advancing
  `state` across the iteration boundary, a recovery task firing) is the entry into a new
  frame that re-binds the name.

Why this matters:

- **Validator falls out of textbook SSA.** The dominator pass (§4.1
  pass 6) and the multiple-binders join (§3.3) are the standard SSA
  dominance and phi rules, applied per namespace. No bespoke
  "no-race", "last-writer-wins", or write-ordering rules are needed.
  §8.5 records what happens when this invariant is broken: the
  per-node `stateWrites` design forced a dedicated no-race rule and
  still admitted unobservable dead writes under snapshot reads. Pure
  SSA removes the whole class of question.
- **No observable mid-frame state.** A reader at any program point
  sees one value per name in scope. The §3.7.1 snapshot rule for
  `state` ("reads in iteration `i` see iteration-`i-1`'s
  `iterateState` result") is then a consequence of the property, not
  a special case to remember.
- **Engine implementation latitude (§1.1).** With no in-place
  mutation, an engine may re-execute, memoize, persist per-frame
  snapshots, or schedule independent DDG branches in parallel
  without changing program meaning. The IR makes no commitment to
  which strategy an engine picks; the parallelism question is
  deferred to post-v1 (§2.2) precisely because the SSA shape leaves
  the door open without prescribing.
- **Splice safety (P4).** Inserting or removing a node never
  silently overwrites someone else's value. The worst case is a
  missing binder, which the dominator pass catches statically. This
  is the property that makes DSL fragments compose without rename
  passes (§1.2 splice safety).
- **Hide-by-default `bind` (§8.15) is the matching half.** Pure SSA
  is "single def"; hide-by-default is "addressable only when the
  author opts in". Together they give the author full control over
  both _when_ a name is bound and _whether_ it is visible at all.

Costs accepted:

- **Verbosity at frame boundaries.** `iterateState` must restate
  every state variable on every iteration boundary (§3.7.1, no
  implicit carry-forward). The §3.3 phi requires a binder of the
  shared name on every reaching path. These are P5 (no surprise
  defaults) and land on codegen per §1.1, not on the IR's
  one-time-author cost story.
- **No "natural" mutable accumulator.** Patterns that read like
  "update X each iteration" must be expressed as "compute next-X
  from current X in `iterateState`." The trade is local readability
  for a globally simpler validator and engine model. §6.3 is the
  worked example of how the resulting shape reads.

Alternatives considered: per-node `stateWrites` (§8.5), implicit
node-id naming (§8.15), an explicit rebind/update form, and a
pure-functional model with no named bindings. Each is rejected
against the same single criterion above. Full walk-through with
their rejection arguments lives in
[decisions/0004-pure-ssa.md](decisions/0004-pure-ssa.md) §7; this
entry's job is the short rationale.

The pure-SSA framing is what allows the §8 alternatives to be
analyzed by a single criterion ("does it preserve single assignment
within a frame?") rather than by ad-hoc weighing of each mechanism.

Full case for the choice, including what the property does not buy
and the v2 reopening conditions: [decisions/0004-pure-ssa.md](decisions/0004-pure-ssa.md).

---

## 9. Review checklist (consistency self-check)

- [x] Every node kind has explicit `kind` (P5).
- [x] Every reference uses one form, with explicit source (P2, P5).
- [x] No node can reference a name (scope variable, input, state) declared
      outside its own scope (P4); only workflow-root constants cross scopes.
- [x] Node outputs are hidden by default; sharing requires explicit `bind`
      (P4 data hiding, P5 lifetime predictability).
- [x] No implicit "missing field" behavior except those P5 calls universally
      unsurprising (`onError` absent => propagate; top-level `next` absent =>
      terminal).
- [x] Loops cannot exist as topology accidents (P3, validation pass 9).
- [x] Branches are exhaustive (P5, validation pass 8).
- [x] Cross-iteration data flow is declared (P2 scenario 15).
- [x] Optional references are first-class with schema implications (P1
      scenarios 4-7).
- [x] Validation errors are localizable (P4 scenario 30).
- [x] Observability surface mirrors IR structure (P3 scenario 21).
- [x] Every v1 concept appears in at least one principle scenario; no
      concept introduced "just in case" (minimization discipline).

---

## 10. Areas flagged for reviewer adjustment

Three lenses close the items previously flagged here:

- **Audience lens (§1.1)**: which reader or writer population pays or
  benefits from the choice. Dominant when reader and writer pull in
  different directions.
- **Staging lens** (v1 commits to the compile-target role; other
  downstream consumers are door-kept): which direction of change is
  additive vs. breaking. Used to break ties when the audience lens is
  neutral.
- **Variance lens (§1.3.2 / P3 representation-surface axis)**: keep
  surface variance equal to behavioral variance. Two directions:
  - _Split direction._ When two alternatives are audience- and
    staging-comparable but one introduces a dedicated rule (no-race,
    last-writer-wins, ordering, drift) the other does not need, reject
    the extra rule. The pure-SSA decision (§8.17) is the v1 example:
    per-node `stateWrites` (§8.5) and centralized `iterateState` are
    audience- and staging-comparable, but `stateWrites` adds a
    dedicated no-race rule that `iterateState` does not need.
  - _Collapse direction._ When two surface forms obey one behavioral
    rule, collapse them to one form. The loop `outputs` map vs.
    workflow `output` reference (§8.10 Alt C, rejected) and the
    `bind: true` shorthand (§8.15 "Removed sugar") are the v1
    examples; both wrote one rule two ways.
    Reach for the lens when audience and staging are tied or quiet.

The closures below are listed for traceability; full per-decision
rationale lives in §8.

| Topic                               | Status under the lens                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Branch model (§8.3)                 | Closed: discriminant + total `default` is engine-cheap and codegen-neutral.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Type system surface (§8.1)          | Closed: JSON Schema is language-neutral and serves codegen, engine, and door-kept downstream consumers; TypeScript surfaces belong in the DSL.                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| Default branch requirement (§8.3)   | Closed: engine wants total dispatch with no exhaustiveness analysis on the hot path; codegen can synthesize a `default`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Reference form (§8.2)               | Closed: object form is parser-free for engine and analyzers; codegen has no preference between forms.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| State commit timing (§8.6)          | Closed by P4/P5 (lens-neutral): inter-iteration commit makes per-iteration reads independent of write order.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| Pure SSA per namespace (§8.17)      | Closed: every reader population is a net win (validator gets textbook dominance + phi; humans get one-value-per-name locality; analyzers get standard SSA tooling). Codegen pays verbosity (§3.7.1 no-implicit-carry-forward, §3.3 phi coverage) and gets back splice safety and validator precision. Engine latitude (re-execute / memoize / per-frame snapshot / future parallelism) is preserved without being IR-observable, which is why §2.2 can defer parallelism without prescribing.                                                                                                                              |
| Recovery-task reuse (§8.7, §3.8)    | Closed for v1: one-trigger recovery tasks keep dominator analysis trivial. Most "same recovery over several nodes" scenarios are addressed post-v1 by **block scope** (a single `onError` over a region of nodes within one scope; sketch in [future/block-scope.md](future/block-scope.md)). Cross-scope shared recoveries (same task reachable from triggers in different scopes) remain a separate question with its own trigger in [revisit-triggers.md](revisit-triggers.md) row 4. Codegen can also duplicate a logical recovery into per-trigger copies if neither mechanism is available.                          |
| Shared schemas (§8.13)              | Closed: validator identity-checks (§1.1 acceptable performance), codegen single emission, and reviewer locality (P4) all favor named `types`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| IR encoding (§8.14)                 | Closed: JSON serves engine parsing, the LLM-direct fallback, and the door-kept distribution role (§1.1).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Task schema source of truth (§8.16) | Closed for v1: IR self-containment serves both engine sufficiency and door-keeping; hybrid sugar (loader-filled omissions) belongs in the DSL. Reopening trigger in [revisit-triggers.md](revisit-triggers.md) row 6.                                                                                                                                                                                                                                                                                                                                                                                                      |
| Constants scoping (§8.9)            | Closed for v1 under the staging lens. Audience lens is neutral (codegen and engine handle either at equal cost; reviewers gain marginal P4 locality from per-scope, analyzers gain marginal "one place to look" from global). Staging lens is asymmetric: per-scope is an additive future extension (a global is a per-scope at the workflow root, visible by closure), while shipping per-scope first and retreating to global is breaking. v1 picks global on §1.3 minimalism + this asymmetry; per-scope can land later, possibly as part of [future/block-scope.md](future/block-scope.md), without disturbing v1 IRs. |

All items above are closed under the combined lens (audience + staging).
The constants-scoping closure is the only one that depended on the
staging lens to break a tie the audience lens left open; reviewers who
want to reopen it should engage the asymmetry argument, not just the
P4 vs. §1.3 trade-off.

For decisions whose v1 position is closed but carries an explicit
reopening condition (e.g., "revisit Option 3 if IR size becomes a pain
point"), see [revisit-triggers.md](revisit-triggers.md). Some entries
appear in both this section and that index - here as the v1 closure
under the lens, there as a longer-term trigger.

### 10.1 Open under the consistency clause (\u00a71.3.2 / P3)

Survey items surfaced after the variance lens was made
bidirectional (\u00a71.3.2, derived from P3's representation-surface
axis). Each is one surface form
encoding what may be one rule, or vice versa. Listed for a future
pass; none are blockers for v1.

- **Loop `state` shape vs. workflow root.** The loop carries
  `state[*].schema` and `state[*].initial` nested per variable, then
  `iterateState[*]` as a sibling field. The workflow root and task
  nodes carry the same value/type/name triple flat:
  `inputSchema`/`inputs`, `outputSchema`/`output`. Proposed rename:
  `stateSchema` (the type, mirrors `inputSchema`), `initialState`
  (the value-into-frame, mirrors `inputs`), `iterateState` (already
  the right shape). Makes the loop boundary look exactly like the
  workflow boundary and the task boundary - one rule, one surface.
  Worth doing at the same time as any future loop-shape work.
- **Branch `selector`/`selectorSchema` vs. `inputs`/`inputSchema`.**
  Branches encode "typed data into a node" with a different field
  pair than every other node kind. One rule (typed inputs), two
  surface forms. Defensible (a branch has structurally one input,
  not a map) but worth recording as an open question.
- **Error object location fields (\u00a73.8.1).** `task`, `node`, and
  `scopePath` are three optional fields all addressing "where did
  the failure originate". Could collapse to a single optional
  `location` sub-object. Cosmetic; low-priority.
