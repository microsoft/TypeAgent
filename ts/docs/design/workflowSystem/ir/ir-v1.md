# Workflow IR - v1

Status: Adopted (v1). Authoritative.

**Terminology.** Throughout this document, the **workflow IR** (or just
"the IR") is the JSON workflow artifact that the engine consumes. Earlier
drafts use "spec" for the same thing; the rename separates the artifact
from this design document, which is _about_ the IR but is not itself an
IR. See §1.4 for the audience consequences.

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

The design is shaped by three style choices that fall out of the principles
themselves. They are listed up front so reviewers can see the lens used to make
every concrete decision below.

### 1.1 Explicit IR, no sugar

The IR is exactly that - an **intermediate representation**, not an
authoring format. Every node type, every edge, every reference is written
out. Authoring sugar (DSLs, templates, generated IRs) is out of scope and
lives at a different layer.

- Drives: P2 (no hidden flow), P3 (no inferred structure), P5 (no surprise
  defaults).
- Consequence: the IR will look verbose. That is intentional.

### 1.2 Structural minimalism

The schema introduces the **fewest concepts** that satisfy P1-P5. New node
types, fields, and constructs only appear when there is a scenario in
design-principles.md that none of the existing concepts can express without
violating a principle. This is the discipline noted at the top of
design-principles.md (the unnumbered minimization rule).

- Concrete consequence: v1 has exactly four node kinds (`task`, `branch`,
  `loop`, `handler`) and one reference form. Every additional concept proposed
  during the design review will be measured against this rule.

### 1.3 Boundary closure

Each scope (the workflow itself, each loop body) is **closed**: it declares its
inputs, its outputs, and the set of names visible inside. No name inside a
scope refers to anything outside it except through that scope's declared
inputs.

- Drives: P4 (parts understood without the whole).
- Concrete consequence: loop bodies are sub-IRs with the same shape as the
  top-level workflow. The validator and executor treat them uniformly.

### 1.4 Intended audience for the IR

Decisions throughout this document (verbosity, explicitness, schema
redundancy, the conformance bar in §5.7) are calibrated for the
populations that interact with the **IR artifact**, not for whoever
happens to read this design document. Keeping those two audiences
straight is why the artifact is called "the IR" everywhere below.

The IR has four interaction populations:

| Population                          | Reads or writes the IR? | What they need from the IR                                                                                                               |
| ----------------------------------- | ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Engine, validator, runtime          | Reads (every IR)        | Every field present, every edge stated, no inference required. Drives the explicitness in §3-§5 and the MUST list in §5.7.               |
| Debugger, reviewer, auditor (human) | Reads (specific IRs)    | Locality, navigability, error coordinates that map back to IR positions. Drives §4.3 (localizable errors) and §5.6 (observability).      |
| Visualizer, linter, static analyzer | Reads (programmatic)    | Self-describing structure, named types, predictable schema. Drives the `kind` discriminant (P5), `types`/`$ref` sharing (§3.1.1).        |
| DSL or codegen tool                 | **Writes** the IR       | Coverage of the lowering targets it needs (§3 schema, §3.9 grammar) and stability of the surface it lowers into (§10, revisit-triggers). |

Hand-authoring an IR by writing JSON directly is **not** a primary use
case. It is acknowledged as an edge case (small fixes, demos, no DSL
handy), and §1.1's "verbose by design" tax is paid because the DSL or
codegen layer is expected to absorb the authoring cost. If a DSL never
materializes and hand-authoring becomes the dominant write path, several
trade-offs in this document - schema repetition (§8.16), object-form
references (§8.2), JSON over YAML (§8.14) - become candidates for
revisiting (see [revisit-triggers.md](revisit-triggers.md)).

This design document itself targets a narrower audience: engine
implementers building one of the reader populations above, design
reviewers checking the IR against the principles, and DSL or codegen
authors deciding what to lower to. They are not the audience for the IR;
they are the audience for the design that produced it.

---

## 2. v1 scope

### 2.1 In scope for v1

| Area                  | v1 covers                                                                                  |
| --------------------- | ------------------------------------------------------------------------------------------ |
| Node kinds            | `task`, `branch`, `loop`, `handler` (error)                                                |
| Data references       | Static refs to: workflow inputs, declared constants, node outputs, loop state              |
| Reference modality    | Required and optional references                                                           |
| Type compatibility    | Structural subtyping over JSON Schema-described types                                      |
| Control flow          | Explicit `next` per node; sentinel `@iterate` and `@exit` inside loop bodies               |
| Branching             | Discriminant-based switch with exhaustive cases and required `default`                     |
| Loops                 | Single-entry loop construct with declared state, declared boundary I/O, max-iteration cap  |
| Error handling        | Per-node `onError` edge to a `handler` node; uncaught errors propagate and fail the run    |
| Validation            | Static: dominator, type compatibility, scope closure, exhaustiveness, sentinel correctness |
| Observability surface | `nodeStarted` / `nodeCompleted` / `nodeFailed` events per node, including loop iterations  |

### 2.2 Out of scope for v1 (post-v1)

| Area                                   | Why deferred                                                                                                                                                                                                                                                                                      |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Sub-workflow calls                     | P3 scenario 24 explicitly marks this "future". Adds a node kind; defer until v1 stabilizes.                                                                                                                                                                                                       |
| Side-effect / capability declarations  | Called out as "expanding the boundary" in the principles; useful but additive. v1 keeps tasks fully opaque. **Planned closure of the v1 control-flow ambiguity** noted in §3.2.2: once tasks declare effects, the validator can warn on `next` edges that carry neither data nor effect-ordering. |
| Parallelism / concurrency annotations  | P2 scenario 13 says the IR carries enough info to derive parallelism. v1 leaves the engine free; no IR surface.                                                                                                                                                                                   |
| IR versioning, checkpointing, resume   | Explicitly out of scope per design-principles.md ("Out of scope for v1" section).                                                                                                                                                                                                                 |
| Authoring sugar / DSL                  | Per the IR principle. Belongs in a separate layer.                                                                                                                                                                                                                                                |
| Schema migration / evolution           | Same rationale as versioning.                                                                                                                                                                                                                                                                     |
| Computed / dynamic reference targets   | P1 scenario 8: ruled out by design; expressed via branch + decision tree.                                                                                                                                                                                                                         |
| External-state side channels           | P2 scenarios 16-17: deliberately invisible to the IR in v1.                                                                                                                                                                                                                                       |
| Cross-loop shared mutable state        | P4 scenario 34: forced into explicit boundary wiring; no global state.                                                                                                                                                                                                                            |
| Reusable handler nodes across scopes   | P4 scenario 35: each scope owns its handlers in v1.                                                                                                                                                                                                                                               |
| Explicit `block` scope                 | A run-once scope kind (sibling of loop body) that can carry a single `onError` over a region of nodes. Closes the "multi-statement try" gap cheaply by reusing the existing scope contract. Sketch in [post-v1/block-scope.md](post-v1/block-scope.md).                                           |
| Streaming / partial outputs from tasks | Tasks are "input in, output out" per the principles' boundary statement.                                                                                                                                                                                                                          |
| User-interaction / suspend-resume      | Not mentioned in principles; out of v1.                                                                                                                                                                                                                                                           |

---

## 3. IR schema

The IR is a JSON document. Every example in this document is JSON.

### 3.1 Top-level workflow

```jsonc
{
  "kind": "workflow",
  "name": "string identifier",
  "version": "1",                 // IR schema version, not workflow version
  "input":  { /* JSON Schema for workflow input */ },
  "output": { /* JSON Schema for workflow output */ },
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
  "outputBinding": { /* reference object that yields workflow output */ }
}
```

Required fields: `kind`, `name`, `version`, `input`, `output`, `nodes`,
`entry`, `outputBinding`. `types` and `constants` are optional.

#### 3.1.1 Shared schemas (`types`)

Any JSON Schema field in the IR (`input`, `output`, `inputSchema`,
`outputSchema`, `selectorSchema`, `state[*].schema`, `constants[*].schema`,
and nested positions inside any of these) may be replaced by a reference to a
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
field) are currently authored by hand in two or more places. Naming them once
lets the validator treat ref-equal positions as compatible by identity (a
fast path for pass 4.2) and gives authors a single edit site when a shape
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

**Namespaces.** Within a scope, names are partitioned into four disjoint
namespaces, one per `$from` discriminant:

| Namespace  | `$from` value | Declared at                                                           | Visible in                   |
| ---------- | ------------- | --------------------------------------------------------------------- | ---------------------------- |
| `input`    | `"input"`     | The enclosing scope's `input` (workflow) or the loop's `inputs` block | Only the scope it belongs to |
| `constant` | `"constant"`  | Workflow root `constants`                                             | Every scope                  |
| `scope`    | `"scope"`     | A node's `bind` field publishes a value into this namespace           | Only the scope it belongs to |
| `state`    | `"state"`     | The enclosing loop's `state` block                                    | Only that loop's body scope  |

Because the namespaces are disjoint, the same name may appear in more than one
of them without conflict. For example, a workflow may have an input field
`x`, a constant `x`, and a node that binds its output as `x` in the same
scope; a reference always names which namespace it reads from via `$from`.
The validator does not warn on cross-namespace name reuse, but tools may.

**The `scope` namespace is hide-by-default.** A node's output is **not**
addressable from other nodes unless the node declares `bind: "<name>"` (or
`bind: true`, which uses the node id as the bound name; see section 3.3).
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

**Sentinels and pseudo-sources.** `@iterate` and `@exit` are reserved
tokens, not names, scoped to where they are legal (only inside a loop body
as `next` or branch case targets). `$from: "error"` and `$from: "trigger"`
are pseudo-sources legal only on a `handler` node's `inputs`: `error` reads
the failure value, `trigger` reads an input field of the triggering node
(see section 3.8). Neither pseudo-source participates in the four-namespace
table above; they are handler-local and do not name scope-wide values.

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

1. The **control-flow graph (CFG).** Edges come from `next` (task, handler,
   loop), branch `cases` and `default`, `onError`, and the loop sentinels
   `@iterate` and `@exit`. The CFG says _when_ a node runs.
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

- **Branches and handlers stay pure control-flow constructs.** A branch
  produces no value; a handler consumes only the failure (`$from: "error"`).
  Both contribute CFG edges with no DDG counterpart.
- **Side-effecting tasks be sequenced without faking data flow.** "Run the
  migration, then run the readiness check" can be expressed as a `next` edge
  even though the readiness check does not consume the migration's output.
- **The engine optimize.** The DDG is the _minimum_ set of ordering
  constraints; an effect-aware engine (post-v1) can use it to derive
  parallelism opportunities the CFG alone would not reveal.

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

### 3.3 Common node fields

Every node carries a discriminant `kind` (P5: self-describing).

```jsonc
{
  "kind": "task" | "branch" | "loop" | "handler",
  "inputs":  { /* per-kind: see below */ },
  "next":    /* per-kind: see below */,
  "onError": "<nodeId>" | null,   // optional; null/absent = propagate
  "bind":    "<scopeVarName>" | true | null   // optional; default null/absent = unbound (hidden)
}
```

`inputs` is always a map of named fields whose values are **reference objects**
(section 3.4). The shape of `inputs` is part of the node's typed input
schema (section 3.5). `onError`, when present, must point to a `handler` node
in the same scope.

**`bind`** publishes the node's output as a scope variable, addressable by
other nodes via `$from: "scope"`. The value of `bind` may be:

- A non-empty string: the bound name.
- `true`: a shorthand for "bind under my own node id".
- Absent or `null`: the node's output is **not** addressable by other nodes.
  The node may still execute, sequence successors via `next`, and have side
  effects, but no reference can read its value.

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

- `task` and `handler` nodes produce values; `bind` is the publishing switch.
- `branch` nodes produce no value (they are pure control flow); `bind` is
  not allowed on a branch.
- `loop` nodes produce a value (the resolved `outputs` block); `bind` works
  on the loop node like any other value-producing node.

### 3.4 Reference objects

References are the only way data crosses node boundaries. There is exactly one
reference form (minimalism):

```jsonc
{
  "$from": "input" | "constant" | "scope" | "state" | "error" | "trigger",
  "name":  "<name>",            // input field, constant name, scope variable, or state var
  "path":  ["a", "b", 0, "c"],  // optional JSON-pointer-style path into the value
  "optional": true              // optional; default false
}
```

- `$from: "input"` - read from the enclosing scope's declared input.
- `$from: "constant"` - read a declared constant in the enclosing workflow.
  (Constants are workflow-global; readable from any scope. They are values
  declared in the IR, so this does not violate P4.)
- `$from: "scope"` - read a scope variable (a value bound by some node via
  `bind`). The named bound value must exist in the enclosing scope.
  Validated by dominance + type compatibility (P1).
- `$from: "state"` - read a loop-scoped state variable. Only legal inside a
  loop body.
- `$from: "error"` - read the triggering error value. Only legal inside a
  `handler` node's `inputs` (see section 3.8). `name` and `path` are
  optional and default to reading the entire error object.
- `$from: "trigger"` - read an input field of the handler's triggering node.
  Only legal inside a `handler` node's `inputs`. `name` is the field name in
  the trigger's `inputs` map (see section 3.8).

`optional: true` declares the reference may not be satisfied on every path
(P1 scenarios 4, 5, 7). When unsatisfied, the consumer receives JSON `null`.
The consumer's input schema must permit `null` in that position; the validator
checks this.

There is no string-shorthand form for references in v1. Every reference is the
object above. (Minimalism + P5: one form, no parsing rules to learn.)

### 3.5 Task node

```jsonc
{
  "kind": "task",
  "task": "<task type identifier>",   // names a registered task implementation
  "inputSchema":  { /* JSON Schema */ },
  "outputSchema": { /* JSON Schema */ },
  "inputs": {
    "<fieldName>": { /* reference object */ }
  },
  "next": "<nodeId>" | null,          // null => terminal (top-level only)
  "onError": "<nodeId>" | null,
  "bind": "<scopeVarName>" | true | null    // optional; see section 3.3
}
```

- The shape of `inputs` (the set of fields and their types) must satisfy
  `inputSchema`.
- The task's output is described by `outputSchema`. Other nodes' references
  to this task's output via `$from: "scope"` are checked against
  `outputSchema`. A task whose `bind` is absent has no addressable output,
  but `outputSchema` is still required (it documents the contract and is
  used by the runtime to validate the task implementation's return value).
- `next: null` is legal **only** in the top-level scope. In a loop body, every
  task must have `next` set to another body node, `@iterate`, or `@exit`
  (P5 scenario 39).

### 3.6 Branch node

```jsonc
{
  "kind": "branch",
  "selector": { /* reference object yielding a discriminant value */ },
  "selectorSchema": { /* JSON Schema with "enum" or string-typed discriminant */ },
  "cases": {
    "<caseValue>": "<nodeId>"
  },
  "default": "<nodeId>",
  "onError": "<nodeId>" | null
}
```

- `selectorSchema` declares the legal set of discriminant values. The
  validator requires `cases` to be exhaustive over the declared enum **or**
  for `default` to be present. v1 requires both: `default` is mandatory
  (P5: no implicit fall-through).
- A branch has no `inputs` other than `selector`, no `outputs`, and no
  `bind` (it produces no value). It is pure control flow. Data needed
  downstream of the branch must already be available via dominator
  references from before the branch (or threaded through tasks in each case
  path - P1 scenarios 3, 6).
- `cases` and `default` target node ids in the same scope. In a loop body,
  the targets may also be `@iterate` or `@exit`.

The choice to model a branch as a **discriminant switch** (rather than a
predicate `if/else`) is deliberate: a discriminant is a value computed by an
upstream task, which keeps decision logic inside a task (P3 boundary) and
keeps the branch node a pure structural construct.

### 3.7 Loop node

```jsonc
{
  "kind": "loop",
  "inputs": {
    "<boundaryInputName>": { /* reference from outer scope */ }
  },
  "inputSchema":  { /* JSON Schema for the boundary inputs */ },
  "state": {
    "<stateVarName>": {
      "schema": { /* JSON Schema */ },
      "initial": { /* reference object resolved at loop entry, in outer scope */ }
    }
  },
  "body": {
    "kind": "scope",
    "nodes": { "<bodyNodeId>": { /* node object */ } },
    "entry": "<bodyNodeId>"
  },
  "outputs": {
    "<outputFieldName>": { /* reference object resolved in body scope at @exit */ }
  },
  "outputSchema": { /* JSON Schema */ },
  "maxIterations": 1000,
  "next": "<nodeId>" | null,
  "onError": "<nodeId>" | null,
  "bind": "<scopeVarName>" | true | null    // optional; loop output is the resolved `outputs` block
}
```

Key points:

- `body` is a **closed sub-scope** with the same shape as the top-level
  workflow's `nodes` + `entry` (P4). Body nodes cannot reference outer-scope
  scope variables directly; they reach outer data only through `state`
  (initialized from outer refs) and the loop's declared `inputs` (which body
  nodes read via `$from: "input"`).
- `state` declares cross-iteration variables (P2 scenario 15). Each state
  variable has a schema and an initial value (resolved once at loop entry from
  the outer scope).
- A body node writes to state by declaring `stateWrites` (section 3.7.1).
  There is no implicit "node output overwrites state" rule. Every cross-
  iteration write is declared. A body node's `stateWrites` reference to its
  own output value works without requiring a `bind` (the writing node and
  the value source are the same node; see section 3.7.1).
- `outputs` is resolved when the body reaches `@exit`. Each field is a
  reference resolved in the body scope (typically against `state`, since
  per-iteration scope variables do not survive across iterations).
- `maxIterations` is required and bounded; if exceeded, the loop fails with
  a well-known error type (consumable by `onError`).
- `bind` on the loop publishes the resolved `outputs` value as a scope
  variable in the **outer** scope, just like any other value-producing node.

#### 3.7.1 State writes

Writes are explicit and attached to the body node that produces the value:

```jsonc
{
  "kind": "task",
  /* ... */
  "stateWrites": {
    "<stateVarName>": {
      /* reference object resolved in body scope */
    },
  },
}
```

The reference inside `stateWrites` follows the normal reference rules with
one allowance: a node's `stateWrites` may reference its own output as if
the node had `bind: true`, without requiring an explicit `bind`. (The
writer and the value source are the same node; the reference cannot escape
to other nodes.) Any other producer named in `stateWrites` must be a bound
dominator like normal.

State writes are committed when the writing node completes successfully. If a
node's `next` is `@iterate`, the next iteration sees the new values. State
reads (`$from: "state"`) inside an iteration always see the value as of loop
entry for that iteration, not partial mid-iteration writes. This makes
iteration semantics deterministic and predictable (P5).

#### 3.7.2 Sentinels

`@iterate` and `@exit` are reserved values legal only as `next` (or branch
case targets) **inside a loop body**. They are explicit because P5 scenario
37 says implicit re-entry is surprising.

- `@iterate` - increment the iteration counter and re-enter at `body.entry`,
  using the post-write state.
- `@exit` - leave the loop; resolve `outputs` against the final state and
  body-scope values, then continue at the loop's outer `next`.

There are no other sentinels in v1.

### 3.8 Handler node

```jsonc
{
  "kind": "handler",
  "inputSchema":  { /* JSON Schema */ },
  "outputSchema": { /* JSON Schema */ },
  "task": "<task type identifier>",
  "inputs": {
    "<fieldName>": { /* reference object */ },
    "error":      { "$from": "error" }   // see below
  },
  "next": "<nodeId>" | null,
  "bind": "<scopeVarName>" | true | null   // optional; handler is a value-producing node
}
```

A `handler` is structurally a task with two extra capabilities:

1. It can read the triggering error via the special reference
   `{ "$from": "error" }`.
2. It can read inputs of its triggering node directly via
   `{ "$from": "trigger", "name": "<inputFieldName>" }`. This avoids forcing
   the trigger to bind upstream values purely so the handler can inspect
   them, which would leak the handler's needs into the trigger's contract.
   The named field must exist in the trigger's `inputs`.

Its **dominator scope** is the activation point: every node `T` that has
`onError: H` contributes to H's dominator set as the intersection of dominators
of all such `T`s (P1 scenario 2). Concretely: if H is reached only via `T`'s
error edge, then everything that dominates `T` (including `T`'s own
predecessors) is referenceable from H, subject to the bind-to-share rule
(those dominators must have `bind` set).

In v1 a handler is referenced by exactly **one** triggering node (the
"shared handler" pattern is P4 scenario 35 / out of scope). This keeps the
dominator analysis trivial and the handler testable in isolation.

A handler's `next` follows the same rules as a task's `next` (terminal in
top-level, must lead somewhere in a loop body). A handler can also have
`next: "@iterate"` inside a loop body to implement bounded retry (P3
scenario 27 - the explicit retry-loop alternative).

### 3.9 The full node grammar

```
Node     := TaskNode | BranchNode | LoopNode | HandlerNode
Scope    := { nodes: Map<Id, Node>, entry: Id }
Workflow := { name, version, input, output, constants?, ...Scope, outputBinding }
```

Four node kinds, one scope shape, one reference form, two sentinels, one
bind switch. This is the entire v1 surface.

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
3. **IR/task drift pass (registry-gated).** When the task registry is
   available, every `task` and `handler` node's `inputSchema` is checked
   to be a subtype of the registered task's declared input schema, and
   the registered task's declared output schema is checked to be a
   subtype of the node's `outputSchema` (the §4.2 subtype relation).
   The task's declared contract is the authoritative envelope; the
   IR's schemas are either a verbatim restatement (the common case)
   or a narrowing of that envelope (specialization). An IR that
   contradicts its task is rejected. This is the static equivalent of
   the runtime check in §5.2, applied symmetrically to both sides of
   the IR/task seam. When the registry is unavailable (offline
   tooling, archival validation), this pass is skipped and the IR
   still validates standalone. See §8.16.
4. **Name resolution pass.** Within each scope: every reference's target name
   exists; sentinels are only used inside loop bodies; `onError` targets a
   `handler` in the same scope; `entry` names an existing node. `bind: true`
   resolves to the node id. `branch` nodes do not declare `bind`.
   References with `$from: "scope"` resolve to at least one binder of that
   name in scope. References with `$from: "error"` or `$from: "trigger"`
   appear only inside a `handler` node's `inputs`, and `$from: "trigger"`
   names an input field present in the triggering node's `inputs`.
5. **Scope closure pass (P4).** Body nodes do not reference outer-scope scope
   variables. The only outer data visible in a body is via `$from: "input"`
   (loop boundary inputs), `$from: "state"` (loop state), and
   `$from: "constant"` (workflow constants).
6. **Dominator pass (P1).** For every reference of the form
   `$from: "scope", name: X` inside a node Y (or its handler), and for the
   set of binders B(X) = { nodes in scope with `bind: X` }:
   (a) **Phi soundness:** no two binders in B(X) lie on the same path from
   scope entry to Y (i.e., no binder dominates another binder of the
   same name; the binders are pairwise on mutually exclusive branch
   arms).
   (b) **Coverage:** every path from scope entry to Y passes through at
   least one binder in B(X) (some binder of X dominates Y on every
   path). For optional references, coverage is not required, but the
   consumer's schema must accept `null` at that field.
   Inside a handler, dominator semantics use `dominators(T) ∪ {T}` for the
   trigger T; references using `$from: "trigger"` always resolve and do not
   require T to bind.
7. **Type compatibility pass (P1).** For every reference, the producer's
   declared type is a structural subtype of the field type at the consumer's
   `inputSchema`. When multiple binders contribute to the same name (phi
   merge), every binder's `outputSchema` must be a structural subtype of the
   consumer's expected type. `outputBinding`'s reference type is checked
   against the workflow's `output` schema. Branch `selectorSchema` checks
   against the reference type; `cases` keys must be valid values in
   `selectorSchema`. Fast path: if all producer and consumer positions are
   the same `"#/types/<typeName>"` reference, compatibility holds by
   identity without structural walking.
8. **Exhaustiveness pass.** Every branch has either an exhaustive `cases`
   over an enum-typed selector or a `default`. v1 requires `default`
   regardless.
9. **Termination pass.** Every node in the top-level scope can reach a
   terminal (`next: null` task/handler, or a branch all of whose targets
   transitively terminate). Every body node can reach `@exit` or `@iterate`.
   Pure cycles without `@iterate`/`@exit` are rejected (P3 scenario 26).
10. **Acyclicity within scope (P3 + P4).** The intra-scope control-flow graph
    is acyclic. Iteration is expressed only via `@iterate` inside a loop body.
    This makes the dominator computation a standard DAG analysis and prevents
    "accidental loops" (P3 scenario 26).
11. **State soundness pass.** Every loop state variable has at least one
    write path (else it is constant and should be a constant) and every read
    is type-compatible with its schema.
12. **Output binding pass.** `outputBinding` (workflow root) and each loop's
    `outputs` field references must resolve to bound producers (the writer
    of a state value bound by `bind` is fine; for `outputBinding`, the
    target node must have `bind` set).

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
handlers and downstream tasks accept "at least these fields" without forcing
upstream tasks to know every consumer's exact shape.

### 4.3 Error model for the validator

Validation produces a list of errors, each carrying:

- A scope path (e.g., `top.nodes.writeLoop.body.nodes.evaluate`).
- A field path within the node.
- A machine-readable error code.
- A human-readable message.

This makes errors localizable (P4 scenario 30).

---

## 5. Execution semantics

The execution model is described abstractly. The engine is free to optimize
(parallelism, batching) as long as it preserves these semantics.

### 5.1 Top-level execution

1. The engine receives the workflow's typed input (validated against `input`).
2. It begins at `entry`.
3. For each visited node N:
   a. Resolve `inputs` from references (in N's scope).
   b. Execute N (kind-specific, see below).
   c. If N succeeds: if N is a loop with `next: null` and we are top-level,
   finish; else proceed to the node named by `next` (or by branch `cases`).
   d. If N fails: if `onError` is set, route to that handler with the error
   bound to `$from: "error"`; otherwise propagate failure to the enclosing
   scope. A loop body propagating failure fails the loop node itself.
4. When a top-level terminal is reached, resolve `outputBinding` and return
   its value as the workflow output.

### 5.2 Task execution

The engine calls the registered task implementation with the resolved
`inputs`. The implementation returns a value validated against `outputSchema`.
A schema-violating return is a task failure. This runtime check is the
defense-in-depth layer for cases where the static IR/task drift check
(§4.1 pass 3) was skipped because the registry was unavailable at
validation time.

### 5.3 Branch execution

The engine resolves `selector`, looks up `cases[value]`, and proceeds to that
node. If no case matches, proceeds to `default`. Branches do not produce
output, and other nodes never reference a branch as a data source.

### 5.4 Loop execution

1. Resolve loop `inputs` from outer scope; validate against `inputSchema`.
2. Initialize each `state` variable from its `initial` reference (resolved in
   outer scope), validating against the variable's schema.
3. Set iteration counter `i = 0`.
4. Begin iteration:
   - If `i >= maxIterations`, fail with `LoopMaxIterationsExceeded`.
   - Execute body starting at `body.entry`. Inside the body:
     - `$from: "state"` reads see the values committed at the start of this
       iteration.
     - `stateWrites` are buffered; they commit when the writing node
       successfully completes.
     - The body terminates when a body node's `next` is `@iterate` or
       `@exit`.
   - On `@iterate`: increment `i`; restart at `body.entry` with the latest
     committed state.
   - On `@exit`: resolve `outputs` against the final body scope (state +
     last-iteration node values), validate against `outputSchema`, and
     proceed to the loop node's outer `next`.
5. Failure inside the body that is not caught by a body-scope handler
   propagates to the loop node, which then routes to its own `onError` (if
   any) or fails its outer scope.

### 5.5 Handler execution

A handler is executed when the triggering node (`T` such that `T.onError = H`)
fails. The handler's input `error` is the failure value (a structured error
object). All other handler `inputs` resolve against H's scope using the
dominator semantics described in 3.8. The handler's `next` then drives the
rest of the run.

### 5.6 Observability

Per P3, the engine emits an event stream that mirrors the IR structure:

- `nodeStarted(scopePath, nodeId, iteration?)`
- `nodeCompleted(scopePath, nodeId, iteration?, output)`
- `nodeFailed(scopePath, nodeId, iteration?, error)`
- `loopIterationStarted(scopePath, loopNodeId, iteration)`
- `loopExited(scopePath, loopNodeId, iteration, outputs)`

Iterations are addressable; the consumer of these events can map every event
back to an IR coordinate (P3 scenario 21).

### 5.7 Conformance bar (MUST / SHOULD / MAY)

The IR is declarative; many quality-of-implementation choices (parallelism,
memory liveness, retry granularity) are left to the engine. To make
portability predictable, v1 distinguishes a conformance bar from
recommended optimizations.

**A conforming v1 engine MUST:**

1. Run the validation passes in section 4.1 and reject any IR that fails
   them.
2. Execute the CFG, dispatching each node when its `inputs` are
   resolvable per the dominator rules in section 3.2.
3. Commit `state` writes per the transactional rules in section 3.7.1
   (writes commit on iteration success; failure during the iteration
   discards the iteration's writes).
4. Route failures via `onError` per section 5.5; propagate uncaught
   failures to the enclosing scope per section 5.4 step 5.
5. Resolve sentinels (`@iterate`, `@exit`) per loop semantics in
   section 5.4.
6. Emit the observability events listed in section 5.6.

**A conforming v1 engine SHOULD:**

- **Free unbound outputs immediately.** A node without `bind` cannot be
  referenced by any other node, so its output value may be released the
  moment the node completes (after `outputSchema` validation, after
  `stateWrites` evaluation, and after observability emission). This is a
  static property of the IR; no analysis required.
- **Free bound outputs after their last reader.** For nodes with `bind`,
  the DDG is fully static; a one-pass liveness analysis at validation time
  identifies, for each bound output, the set of dominated descendants that
  reference it. Once every such descendant has run (or been pruned by branch
  selection), the bound value may be released.
- **Parallelize independent nodes.** Two nodes with no DDG path between
  them and no `next` chain ordering them may execute concurrently.
  The IR carries enough information to derive this safely
  (P2 scenario 13).
- **Retry without restarting the workflow.** When a handler resumes
  via `next`, the engine should not recompute upstream nodes whose
  outputs are still live.

**A conforming v1 engine MAY:**

- Cache, memoize, or persist node outputs across runs.
- Inline successive single-task nodes into a fused execution unit.
- Anything else not constrained by MUST or SHOULD.

The MUST list is the portability bar - any IR that runs on one
conforming engine runs on all of them. The SHOULD list is the quality
bar - engines that skip these will produce correct results but with
poor memory or latency profiles on realistic workflows.

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
  "input": { "$ref": "#/types/Url" },
  "output": { "$ref": "#/types/Summary" },
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
      "next": null,
      "bind": "result",
    },
  },
  "outputBinding": { "$from": "scope", "name": "result" },
}
```

Note how `Url` is shared between the workflow `input` and the `fetch` task's
`inputSchema`, and `Summary` is shared between the workflow `output`, the
`summarize` task's `outputSchema`, and (transitively, via `outputBinding`)
the workflow result. The compatibility pass collapses each ref-equal pair to
an identity check.

### 6.2 Branch with handler

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
  "input": { "$ref": "#/types/Doc" },
  "output": { "$ref": "#/types/Result" },
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
      "cases": { "news": "summarizeNews", "code": "explainCode" },
      "default": "fallback",
    },
    "summarizeNews": {
      /* task ... outputSchema: { "$ref": "#/types/Result" } ... bind: "output" ... next: "format" */
    },
    "explainCode": {
      /* task ... outputSchema: { "$ref": "#/types/Result" } ... bind: "output" ... next: "format" */
    },
    "fallback": {
      /* task ... outputSchema: { "$ref": "#/types/Result" } ... bind: "output" ... next: "format" */
    },
    "format": {
      /* task ... outputSchema: { "$ref": "#/types/Result" } ... bind: "final" ... next: null */
    },
    "classifyError": {
      "kind": "handler",
      "task": "errors.report",
      "inputSchema": {
        "type": "object",
        "properties": { "error": {}, "doc": { "type": "string" } },
      },
      "outputSchema": { "$ref": "#/types/Result" },
      "inputs": {
        "error": { "$from": "error" },
        "doc": { "$from": "trigger", "name": "doc" },
      },
      "next": null,
      "bind": "final",
    },
  },
  "outputBinding": { "$from": "scope", "name": "final" },
}
```

`ClassifyLabel` is the canonical enum: it appears once in `types`, is reused
by `classify.outputSchema` (nested) and by `route.selectorSchema`, and the
exhaustiveness pass reads its `enum` from there. `Result` is shared by every
path that reaches `format`, so the diamond merge (P1 scenario 3) is checked
by identity rather than by structural walking.

`format` is reachable from `summarizeNews`/`explainCode`/`fallback` because
each path makes one of them dominate `format`. Each branch arm binds its
output under the same scope variable name (`output`), so `format` reads
`{ "$from": "scope", "name": "output" }` once and the dominator pass checks
that exactly one of the three binders dominates `format` in every
branch-selected path. The author must arrange that all three produce a
compatible output that `format` can consume - this is P1 scenario 3 (diamond
merge).

The `classifyError` handler reads the original `doc` via `$from: "trigger"`
rather than requiring the workflow `input` to be threaded through `classify`'s
bound output - the handler's needs do not leak into `classify`'s contract.
Both `format` and `classifyError` bind the workflow result as `final`; only
one of them runs in any given execution, so the bind names do not collide at
runtime, and the validator accepts the shared name because they are on
mutually exclusive control-flow paths.

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
  "inputSchema": { "$ref": "#/types/Topic" },
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
        "stateWrites": {
          "draft": { "$from": "scope", "name": "write", "path": ["text"] },
        },
        "next": "evaluate",
        "bind": true,
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
        "inputs": { "text": { "$from": "state", "name": "draft" } },
        "stateWrites": {
          "feedback": {
            "$from": "scope",
            "name": "evaluate",
            "path": ["feedback"],
          },
        },
        "next": "decide",
        "bind": true,
      },
      "decide": {
        "kind": "branch",
        "selector": {
          "$from": "scope",
          "name": "evaluate",
          "path": ["verdict"],
        },
        "selectorSchema": { "$ref": "#/types/Verdict" },
        "cases": { "accept": "@exit", "revise": "@iterate" },
        "default": "@exit",
      },
    },
  },
  "outputs": { "article": { "$from": "state", "name": "draft" } },
  "outputSchema": { "$ref": "#/types/Article" },
  "maxIterations": 5,
  "next": null,
}
```

This demonstrates: loop construct (P3), declared cross-iteration state (P2),
explicit `@iterate`/`@exit` (P5), boundary-closed body (P4), bounded
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
  "next": null,
  "bind": "merged"
}
```

Here `enrich` is behind a branch and does not dominate `merge`. The optional
reference makes the partial dependency explicit (P1 scenario 7), the
consumer's schema admits `null`, and the merge task itself decides what to do
when enrichment is absent (boundary choice). Both `fetch` and `enrich` must
be bound (assume `bind: true` on each) for `merge` to reference them.

---

## 7. How the design satisfies each principle

| Principle | Design feature(s) that satisfy it                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P1        | **Intra-IR axis:** single reference form with named source; static dominator pass over an acyclic intra-scope CFG; structural type compatibility pass; `optional` flag for declared partial deps; finite `cases`+`default`; SSA-style phi soundness on shared bound names. **External-contract axis:** registry-gated IR/task drift pass (§4.1 pass 3) checks each task node's `inputSchema`/`outputSchema` against the registered task's contract using the §4.2 subtype relation; runtime output validation (§5.2) is the defense-in-depth layer when the registry is absent at validation time. |
| P2        | Only six declared `$from` sources (input, constant, scope, state, error, trigger); no ambient/global state; cross-iteration data is a declared `state` variable with declared writes; outputs flow via `outputBinding`; bound outputs make the data-flow contract explicit per node                                                                                                                                                                                                                                                                                                                |
| P3        | Distinct node `kind`s for `task`/`branch`/`loop`/`handler`; loop bodies are a structural sub-scope, not a flat cycle; iteration is `@iterate`, not a back-edge; pure cycles are rejected; `bind` mirrors "some steps publish, some don't" from real programs                                                                                                                                                                                                                                                                                                                                       |
| P4        | Body scope closure (no cross-scope name reach); declared loop `inputs`/`outputs`/`state`; per-scope handlers; localizable validation errors with scope paths; hide-by-default `bind` keeps internal computations out of the scope's contract                                                                                                                                                                                                                                                                                                                                                       |
| P5        | Required `kind` discriminant; required explicit `next` in loop bodies; explicit sentinels; required `default` in branches; one reference form (no shorthand/inference); declared `maxIterations`; explicit `bind` makes value lifetime statically predictable                                                                                                                                                                                                                                                                                                                                      |

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
- Alt A: string form `"node:fetch.body"`. Rejected: needs a parser, hides
  source kind, harder to extend with `optional`.
- Alt B: JSONPath/JMESPath. Rejected: too expressive (computed indirection
  conflicts with P1 scenario 8).

### 8.3 Branching: discriminant switch with required `default`

- **Chosen:** switch on a discriminant value with `cases` map and required
  `default`.
- Alt A: predicate-based `if/else` with an embedded expression language.
  Rejected: introduces an expression language (more concepts, P5 surprise
  surface) and pushes decision logic out of tasks.
- Alt B: exhaustive switch with no `default`. Rejected for v1: simpler to
  always require `default`; can be relaxed later when enum exhaustiveness is
  trusted.

Note (post-v1): the discriminant-switch model assumes the cost of an extra
classifier task is negligible. If profiling shows that per-decision task
dispatch is a hot path (e.g., very tight branches inside large loops), a
restricted predicate form (Alt A) may be reintroduced as a performance escape
hatch. It would be additive, not a replacement, and would have to carry its
own design review against P5.

### 8.4 Loop sentinels: `@iterate` and `@exit`

- **Chosen:** explicit string sentinels in `next` / branch case targets.
- Alt A: distinct node kinds (`iterateNode`, `exitNode`). Rejected:
  unnecessary node kinds; the sentinel is purely a transition target.
- Alt B: boolean flags on the body node (e.g., `terminal: true`). Rejected:
  P5 - reader has to learn that `terminal: true` means "exit the loop".
- Alt C: implicit re-entry when `next` is omitted. Rejected by P5 scenario 37.

### 8.5 State writes: declared on the writing node

- **Chosen:** each body node declares its `stateWrites` map.
- Alt A: state writes declared centrally on the loop. Rejected: separates the
  write from the value-producing node, harder to read locally (P4).
- Alt B: implicit "node output of name X overwrites state X". Rejected by P2
  scenario 15.

### 8.6 State commit timing: at successful node completion, visible next iteration

- **Chosen:** writes commit on success; reads in iteration `i` see state as of
  iteration-`i` start.
- Alt A: writes visible immediately within the same iteration. Rejected:
  reads now depend on the order of writes; harder to reason about locally
  (P4, P5).

### 8.7 Handler model: per-trigger node, structurally a task

- **Chosen:** handler is a task-like node attached to exactly one trigger via
  `onError`.
- Alt A: shared handler nodes. Deferred (P4 scenario 35 / out of v1 scope).
- Alt B: handlers as fields on the failing task (no separate node). Rejected:
  loses the ability to give the handler its own `next` and to participate in
  the IR graph (visualization, observability events).

### 8.8 Loop body: closed sub-scope, DAG only

- **Chosen:** body is a sub-scope with the same shape as the workflow,
  acyclic, iteration only via `@iterate`.
- Alt A: body is a flat region of the parent graph. Rejected by P4 (no
  composability) and P3 (loop pattern hidden in topology).
- Alt B: body may contain its own cycles. Rejected by P3 scenario 26 - any
  cycle should be its own loop construct.

### 8.9 Constants: workflow-global, declared values

- **Chosen:** `constants` block at the workflow root, readable from every
  scope.
- Alt A: per-scope constants. Rejected for v1 minimalism; not motivated by
  any principle scenario.
- Alt B: no constants; require literal values inline. Rejected: makes
  state initial values awkward (every loop needs an inline literal).

### 8.10 Workflow output: explicit `outputBinding`

- **Chosen:** the workflow's output is a single reference resolved at
  termination.
- Alt A: implicit "the last node's output". Rejected by P5: which node is
  "last" when there are multiple terminals?
- Alt B: a designated `output` node kind. Rejected: extra kind for what is
  effectively one reference.

### 8.11 Error edge dominator semantics

- **Chosen:** in v1, a handler is reachable from exactly one triggering node,
  so its dominator set is `dominators(T) ∪ {T}` and any node in that set is
  referenceable (P1 scenario 2 directly).
- Alt A: shared handlers with intersection-of-dominators semantics. Sound but
  more complex; deferred with shared-handler support.

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

- **Chosen:** JSON. Predictable, language-neutral, easy to validate.
- Alt A: YAML. More readable but adds parser ambiguity (anchors, types). Can
  be supported as an authoring convenience without changing the IR.
- Alt B: A custom textual IR. Rejected: more tooling to build, no benefit
  given the compile-target framing in §1.1.

### 8.15 Bound outputs (hide-by-default node values)

- **Chosen:** a node's output is **not** addressable by other nodes unless
  the node declares `bind`. References to bound values use
  `$from: "scope"`. Multiple binders may share a name on mutually exclusive
  paths (SSA-style phi at branch joins).
- Alt A: every node id is implicitly a name (the previous draft). Rejected:
  no data hiding, refactor fragility (CFG changes silently invalidate
  references), no clean DSL `let`-with-limited-scope target, weak engine
  liveness story (every output potentially live until scope end).
- Alt B: per-node `private: true` opt-in flag. Rejected: hide should be the
  default, not the opt-in. Wrong polarity yields the same problems as Alt A
  in practice.
- Alt C: phi merges via shared bind names disallowed; require an explicit
  join construct (post-v1 block scope) for diamond merges. Rejected:
  unnecessary friction for the common case where branch arms produce a
  uniform output type. The validator's phi-soundness check is cheap.
- Handler convenience: `$from: "trigger"` exposes the triggering node's
  inputs to the handler without forcing the trigger to bind upstream values
  for the handler's benefit. Keeps each node's bind contract focused on its
  own consumers.

Full analysis: [decisions/0001-bound-outputs.md](decisions/0001-bound-outputs.md).

### 8.16 Task schema source of truth

- **Chosen (v1):** the registered task's declared contract is the
  authoritative envelope; each `task` and `handler` node's
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
  in the implementation silently changes IR semantics.
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
  by design" tax (§1.1). A DSL or codegen step is expected to populate
  `inputSchema`/`outputSchema` from a typed task signature, so authors do
  not write them by hand at scale. The IR remains the canonical form.

Full analysis: [decisions/0003-task-schema-source.md](decisions/0003-task-schema-source.md).

---

## 9. Review checklist (consistency self-check)

- [x] Every node kind has explicit `kind` (P5).
- [x] Every reference uses one form, with explicit source (P2, P5).
- [x] No node can reference a name (scope variable, input, state) declared
      outside its own scope (P4); only workflow-root constants cross scopes.
- [x] Node outputs are hidden by default; sharing requires explicit `bind`
      (P4 data hiding, P5 lifetime predictability).
- [x] No implicit "missing field" behavior except those P5 calls universally
      unsurprising (`onError` absent => propagate; top-level `next: null` =>
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

## 10. Areas explicitly flagged for reviewer adjustment

These are the spots most likely to need your input. They are the points where
the principles permit more than one reasonable choice and the design picked
one for the sake of having a complete v1.

1. **Branch model** (8.3): switch-on-discriminant vs. predicate `if/else`.
2. **Type system surface** (8.1): JSON Schema vs. TypeScript types.
3. **Constants scoping** (8.9): global vs. per-scope.
4. **Default branch requirement** (8.3): always required vs. allowed when
   `cases` is exhaustive over an enum.
5. **Reference form** (8.2): single object form vs. allowing a string
   shorthand for the common case.
6. **State commit timing** (8.6): inter-iteration only vs. intra-iteration.
7. **Handler reuse** (8.7 / 3.8): keep "exactly one trigger" in v1, or admit
   shared handlers with documented intersection semantics.
8. **Shared schemas** (8.13): named `types` with `$ref` vs. inline-only.
9. **IR encoding format** (8.14): JSON vs. YAML vs. a typed IR.
10. **Task schema source of truth** (8.16): IR, registry, or hybrid; and
    whether the validator statically checks IR-vs-task drift. Currently
    IR-authoritative with a registry-gated drift check; revisit hybrid
    sugar (omitted schemas filled in by the loader) once a DSL exists.

After your review of these, the design can be tightened (or the alternatives
folded back in) without disturbing the rest of the document.

For decisions whose v1 position is closed but carries an explicit
reopening condition (e.g., "revisit Option 3 if IR size becomes a pain
point"), see [revisit-triggers.md](revisit-triggers.md). Some entries
appear in both this section and that index - here as an immediate
reviewer question, there as a longer-term trigger.
