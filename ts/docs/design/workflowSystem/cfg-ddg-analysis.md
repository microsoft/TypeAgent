# CFG vs DDG: graph-model analysis

Status: Draft, iterating

This document captures the in-flight analysis of how the workflow spec
encodes data dependencies and control flow, the alternative graph models
considered, and how each model scores against the broader workflow vision.
It is a working document, not a finished design proposal. Decisions
recorded here either flow back into
[spec-design-cleanroom.md](spec-design-cleanroom.md) or get parked as
explicit follow-ups.

The discussion built up incrementally; this file preserves that order so
later decisions can be re-derived from earlier observations.

---

## 1. What is a "data dependency" in the spec?

A **data dependency** is a statement of the form:

> Position **C** (a _consumer site_) gets its value from position **P** (a
> _producer site_), possibly with a path projection.

The consumer cannot run until the producer has produced. The validator must
prove this _statically_ (P1: existence + compatibility).

In the v1 spec, every data dependency is encoded by exactly one mechanism:
a **reference object** (`{ "$from": ..., "name": ..., "path": ... }`)
sitting in a consumer slot. So the question "what data dependencies does
the spec encode?" reduces to: **where can a reference object appear, and
what are its consumer/producer semantics at each site?**

### 1.1 The catalogue of reference-object positions

Walking the schema yields nine consumer-site classes. Every data
dependency in any spec is an instance of one of these.

| #   | Consumer site                                 | Resolved in scope                    | Legal `$from` values                     | Producer site                                                                     | Type-checked against               | Resolution timing                        |
| --- | --------------------------------------------- | ------------------------------------ | ---------------------------------------- | --------------------------------------------------------------------------------- | ---------------------------------- | ---------------------------------------- |
| 1   | `task.inputs[k]`                              | enclosing scope                      | input, constant, scope, state\*          | bound upstream node / declared input / constant value / loop state                | field `k` of `task.inputSchema`    | when the task is about to execute        |
| 2   | `handler.inputs[k]` (k != "error", "trigger") | enclosing scope                      | input, constant, scope, state\*, trigger | bound dominator of the trigger node, or trigger's own input field                 | field `k` of `handler.inputSchema` | when the handler is about to execute     |
| 3   | `handler.inputs.error`                        | (special)                            | `"error"` only                           | the failure value of the trigger node                                             | implicit error type                | when the handler is about to execute     |
| 4   | `branch.selector`                             | enclosing scope                      | input, constant, scope, state\*          | a discriminant value (must come from a bound producer if `$from: "scope"`)        | `branch.selectorSchema`            | when the branch is reached               |
| 5   | `loop.inputs[k]`                              | the **outer** scope of the loop node | input, constant, scope, state\* of outer | bound producer in outer scope / outer state / outer input / constant              | field `k` of `loop.inputSchema`    | when the loop is entered (once)          |
| 6   | `loop.state[v].initial`                       | the **outer** scope of the loop node | input, constant, scope, state\* of outer | bound producer in outer scope                                                     | schema of state variable `v`       | when the loop is entered (once)          |
| 7   | `task.stateWrites[v]` (inside a body)         | the **body** scope                   | input (loop's), constant, scope, state   | bound producer in body scope (own-output reference allowed without `bind`)        | schema of state variable `v`       | when the writing task succeeds           |
| 8   | `loop.outputs[k]`                             | the **body** scope at `@exit`        | input (loop's), constant, scope, state   | bound producer in body scope (must dominate every path that reaches `@exit`)      | field `k` of `loop.outputSchema`   | when the body reaches `@exit`            |
| 9   | `workflow.outputBinding`                      | the **workflow** scope               | input, constant, scope                   | bound producer in workflow scope (must dominate every reached top-level terminal) | `workflow.output`                  | when the workflow reaches a top terminal |

(\*"state" is only legal when the enclosing scope is a body scope. The `scope`
namespace was renamed from `node` when bound outputs landed; see
[bound-outputs.md](bound-outputs.md). `trigger` is a handler-only pseudo-source
that reads an input field of the failing node, sidestepping the need for the
trigger to bind upstream values for the handler's benefit.)

### 1.2 What the spec does NOT encode as data dependencies

Equally important: things that travel along edges or appear in the spec
but are **not** data dependencies.

- **Control-flow `next` edges** (sequence nodes; carry no value).
- **`onError` edges** (route control on failure; the only carried data is
  the implicit `$from: "error"` available to the handler).
- **Branch case targets** (`cases[k]`, `default`) - control flow.
- **Sentinels (`@iterate`, `@exit`)** - control transitions.
- **Type schemas** (`inputSchema`, `outputSchema`, `selectorSchema`,
  `state[*].schema`, `constants[*].schema`,
  `workflow.input`/`output`) - the type half of dependencies that
  reference objects encode elsewhere.
- **`types` and `constants` declarations themselves** - declarations,
  not dependencies.

### 1.3 Structural observations

**(a) Cross-scope data movement is never one reference; it is always a
pair.** Outer data only enters a body via the loop's `inputs[k]` (one
reference, resolved in outer scope) plus, inside the body, one or more
`$from: "input"` reads (resolved in body scope) that consume the loop's
named input. Same for `state[v].initial` (outer ref, resolved outer) +
body `$from: "state", name: "v"` reads (resolved in body). Boundary
closure (\u00a71.3 of the spec) is exactly this: data crosses scope only
at declared boundaries, and crossing always takes two reference sites.

**(b) The dependency graph is directed and acyclic, per scope.** Within
any scope, a `$from: "scope"` reference resolves to one or more **binders**
(nodes whose `bind` field publishes the named value). Some binder must
dominate the consumer on every path; when several binders share a name,
they must lie on mutually exclusive control-flow paths (SSA-style phi
merge). Validation pass 5 checks both. Combined with intra-scope
acyclicity (pass 9), each scope's dependency graph is a DAG whose sources
are exactly the bound nodes - unbound nodes contribute to the CFG only.
State writes/reads create a _new_ edge kind that is not part of this
DAG; they connect iteration _i_'s writes to iteration _i+1_'s reads.

**(c) State is the only producer site that lives across iterations.**
Every other producer (node output, input, constant) produces its value
once per evaluation of the consumer's enclosing scope. State persists
from one iteration to the next.

**(d) Constants and inputs look the same to the consumer.** Both produce
a value that's available the moment the consumer's scope begins
executing. The validator treats them identically in the dominator pass
(they trivially dominate everything in their scope).

**(e) Optionality is a property of the reference, not the producer.** A
reference is either required (validator must prove the producer ran) or
optional (validator must prove the consumer schema accepts `null`). The
producer doesn't know whether downstream consumers consider it optional.
This is what makes optional references composable.

**(f) `path` is a projection, not a new dependency.** `"path": [...]` is
still one dependency on the producer; the path narrows the type that
flows. The compatibility pass walks the path through the producer's
`outputSchema`.

### 1.4 A worry worth surfacing

Row 8 (`loop.outputs[k]`, "body that dominates `@exit`") is subtler than
the others. If the body has multiple `@exit` targets (several branches
that go to `@exit`), then "dominates `@exit`" really means "dominates
_every_ path that reaches an `@exit`" - the standard post-dominator
notion in reverse. Worth being explicit in \u00a73.7 and validation pass 5
of the spec doc. Currently the design says "body scope at `@exit`"
without nailing down "what if there are several?".

---

## 2. Two graphs, one validator

The catalogue in \u00a71 makes a structural fact unavoidable: the spec
encodes **two distinct graphs over the same node set**.

1. **Control-flow graph (CFG).** Edges from `next` (task, handler,
   loop), branch `cases`/`default`, `onError`, and the loop sentinels
   `@iterate` / `@exit`. Says _when_ a node runs.
2. **Data-dependency graph (DDG).** Edges from reference objects
   (`$from: "scope"` and, transitively, `$from: "state"`). Says
   _which values a node consumes from where_. Only nodes that `bind`
   their output appear as DDG sources.

Neither is a subset of the other. The validator enforces a single
directional invariant: for every DDG edge `A -> B`, A must dominate B in
the CFG of B's scope. **Every declared data dependency implies a
control-flow constraint, but the CFG may carry additional `next` edges
that no data dependency requires.**

### 2.1 "Useless" sequencing is expressible

```jsonc
"a": { "kind": "task", "inputs": { "x": { "$from": "input", "name": "x" } },
       "next": "b" },
"b": { "kind": "task", "inputs": { "y": { "$from": "input", "name": "y" } },
       "next": null }
```

`a` runs before `b`, but `b` ignores `a`'s output. The validator accepts
this:

1. `b`'s declared dependencies all resolve.
2. `a`'s output isn't required anywhere.
3. The control flow is a valid sequence.

The spec is **strictly more informative on the data side than on the
control side**: data side states the irreducible dependencies; control
side adds a sequencing on top that may or may not be tighter than the
data alone would require.

### 2.2 Why the separation is on purpose

- **Side-effecting tasks need sequencing without data flow.** "Run the
  migration, then run the readiness check" - the readiness check doesn't
  consume the migration's output but should come after. Without
  independent control flow, you'd need a synthetic data dependency
  (return a dummy token).
- **The branch node has no data outputs.** A branch is _pure_ control
  flow. Only works if the two graphs are independent concepts.
- **`onError` is control flow.** The handler depends on the error, not on
  the failed task's output. CFG carries "go here on failure"; DDG carries
  `$from: "error"` separately.
- **The engine gets to optimize.** Per P2 scenario 13, parallelism
  analysis uses data dependencies as the _minimum_ set of ordering
  constraints; the CFG narrows what _will_ run when. If CFG = DDG, the
  engine couldn't sequence side-effects independently.

### 2.3 Engine execution

- Engine follows the **CFG** to decide which node runs next.
- At each node, engine consults the **DDG** (the node's `inputs`) to
  gather values.
- A node not on any CFG path never runs (even if it would satisfy a data
  dep that's never consumed).
- A node consumed only optionally still runs if the CFG reaches it.
- A useless-looking `a -> b` `next` edge does cause `a` to run, even if
  `b` doesn't use it.

### 2.4 v1 limitation: control-flow edges are ambiguous

A `next` edge with no underlying data dependency may be either:

- a **deliberate side-effect ordering** (author wants A's effects before
  B), or
- an **accidental over-sequencing** (leftover edge).

The validator cannot distinguish these because tasks in v1 declare no
side effects. Every `next` edge is treated as load-bearing-by-assumption.
Closing this gap is the explicit purpose of the post-v1 side-effect /
capability declaration work.

---

## 3. Pros and cons of the two-graph approach

### 3.1 Pros

1. **Side effects can be sequenced without faking data flow.** Avoids
   synthetic dummy outputs/inputs that lie about what's flowing.
2. **Branches and handlers stay pure.** A branch produces no value; a
   handler consumes only the failure. Both contribute CFG edges with no
   DDG counterpart.
3. **The engine has room to optimize.** DDG = minimum ordering; CFG can
   loosen for effect-aware engines (post-v1).
4. **Authors can express intent precisely.** "Uses A's output" and "must
   come after A" are different statements; two graphs let you make
   exactly the one you mean.
5. **The validator stays small.** Each pass operates on one graph;
   relationships are explicit.
6. **Refactoring is local.** Adding/removing a `next` edge doesn't change
   any node's input wiring, and vice versa.
7. **Matches the principles cleanly.** P1 lives primarily in the DDG; P3,
   P4, and P5 each have control-side and data-side readings (per the
   sharpened principles): control-flow shape lives in the CFG, data
   publication / intra-scope namespace contribution / value lifetime live
   in the DDG via `bind`. Splitting the two graphs lets each principle
   speak to the right artifact for each axis.

### 3.2 Cons

1. **v1 information loss.** Cannot tell deliberate side-effect ordering
   from accidental over-sequencing.
2. **Two graphs to keep in sync mentally.** Reader must look at two
   pieces of every node and combine them. Mitigated by visualization.
3. **CFG-superset-of-DDG-dominance is a non-obvious invariant.** Casual
   author can write an unreachable reference; only the validator catches
   it.
4. **Subtle bugs around dead nodes.** Mostly closed by bound outputs:
   an unbound CFG-reachable node is an explicit "I am not contributing
   a value" (side effect / sequencing only) - no signal needed. A bound
   node with no `$from: "scope"` consumer is a clean lint signal
   ("`bind` declared but nothing reads it"). The remaining ambiguity is
   the v1 con #5 / con #1 case: a `next` edge with no DDG counterpart
   and no declared effect.
5. **CFG carries hidden semantics in v1.** Sequencing may be doing real
   work (effect ordering) without saying so. P2 satisfied for _data_
   flow; _effect_ flow is not declared.
6. **Larger surface for authoring sugar to cover.** A DSL must compile to
   both graphs correctly.
7. **P5 cost.** Reader needs to know two rules for "what runs next":
   `next`/cases/onError, _plus_ the dominator invariant.

### 3.3 Tradeoff summary

The two-graph model trades a small comprehension cost (learn two things
instead of one) and a real v1 gap (no way to tell intentional from
accidental sequencing) for substantial expressiveness wins (side effects,
pure control nodes, parallelism analysis, principled separation of
concerns). The con list reveals where v1 has an honest hole:
**side-effect declarations**. Out of scope for v1, but the two-graph
model is _only fully principled_ once they exist.

---

## 4. Alternatives considered

### 4.1 Alt 1 - One graph, edges carry data

#### Model

One graph. Every edge from A -> B is annotated with a (possibly empty)
**data payload**: a map of named fields whose values are projected from
A's output. The edge is the _only_ way data and control travel.

A node's input is the **union of all incoming edge payloads** plus the
node's own constant/state reads.

```jsonc
"edges": [
  { "from": "fetch", "to": "summarize",
    "carry": { "text": { "path": ["body"] } } },

  { "from": "migrate", "to": "check",
    "carry": {} }                          // sequencing-only edge
]
```

Branches are "many edges out of one node, each guarded by a case value":

```jsonc
{
  "from": "route",
  "to": "summarizeNews",
  "guard": "news",
  "carry": { "doc": { "path": ["doc"] } },
}
```

#### Gains

- Single source of truth: every edge tells you both ordering and data.
- No DDG-subset-of-CFG-dominance invariant (structurally impossible to
  reference what didn't flow).
- Sequencing-only edges are explicit (`"carry": {}`).
- Parallelism analysis is direct.

#### Breaks / gets harder

- **Diamond merges become messy.** Two predecessors A1 and A2 both
  contributing field `x` to B - per-edge field-by-field merging rules.
- **References to non-immediate ancestors disappear.** Either A
  explicitly carries the value through every intermediate edge
  (verbose), or implicit forwarding reintroduces the dominator-based
  reference model under another name.
- **Loop state has to be modeled as self-edges.** Multigraph keyed by
  iteration.
- **Optional references become "edges that may not fire".** Per-case
  payload split.
- **Constants and inputs need pseudo-source nodes.** A `__constants__`
  node, a `__workflow_input__` node with edges to every consumer.
- **Branch-as-pure-control story dies.** Either branches carry data on
  outgoing edges or downstream nodes can't reference its inputs.

#### Principle scorecard

- **P1**: Strong; refs can't fail because every value travels along a
  declared edge.
- **P2**: Strong; data on the edge.
- **P3**: **Weaker.** Loops, branches, handlers all encoded in edge
  structure rather than as distinct constructs.
- **P4**: Weaker. Edge payloads couple producer/consumer shapes.
- **P5**: Mixed. Single-thing-per-edge is good; field merging at
  multi-predecessor joins is bad.

#### Verdict

Closer to **dataflow languages** (StreamIt, FBP, certain visual
programming). Right when most workflows are linear pipelines with data
on every edge. Less right when workflows have control structure
independent of data structure - which is exactly v1.

### 4.2 Alt 2 - One graph, `next` derived from `inputs`

#### Model

No `next` field. CFG is _computed_: predecessors = producers of input
references. Execution order is any topological sort of the resulting
DDG.

```jsonc
"summarize": {
  "kind": "task",
  "inputs": { "text": { "$from": "node", "name": "fetch", "path": ["body"] } }
  // no "next"; predecessors derived from inputs
}
```

Author writes only data dependencies. Engine schedules.

#### Gains

- Smallest possible spec for pure data pipelines.
- Maximum freedom for the engine; trivially parallelizable.
- No CFG-vs-DDG invariant.
- Refactoring = single edit.
- Matches how most "DAG executors" work (Airflow's older API, Make,
  Bazel, Dask, Prefect 2.0).

#### Breaks / gets harder

- **Side-effect ordering is gone.** Either fake outputs (lie), a new
  "happens-before" edge (= `next` renamed), or capability annotations
  (post-v1).
- **Branches awkward.** Selector is data; outgoing targets are control,
  with no good way to encode them. Either reintroduce `cases`/`default`
  as control edges (= two graphs again) or push branching into a data
  union with downstream "not selected" handling.
- **Error handlers awkward.** Handler depends on failure, not output. No
  DDG edge for that. Either new edge kind or first-class
  Promise/Either-style data values.
- **Loops invisible.** State writes/reads create cycles in the DDG.
  Pure-DDG can't have cycles. Loops have to be re-introduced as a node
  kind anyway, with internal CFG vs DDG separation - so "one graph"
  holds only at the top level.
- **P5 regression.** "What runs after X?" requires scanning the whole
  spec for nodes referencing X.
- **Topological-sort tiebreaker.** Engine must commit to a rule;
  becomes engine convention.

#### Principle scorecard

- **P1**: Strong.
- **P2**: Strong.
- **P3**: **Severely weaker.** Loops/branches lose structural
  distinction.
- **P4**: Weaker. Body scopes still exist (loops are a node kind), but
  boundaries fuzzier.
- **P5**: **Severely weaker.** Predecessor inference is the canonical
  example P5 cites against (scenario 38).

#### Verdict

Purest model in some sense; most natural for linear data pipelines.
Pays for purity by either dropping or awkwardly re-encoding everything
that isn't a data dependency. After workarounds, ends up _more_ complex
than the two-graph model.

Right for build systems, ML/data pipelines, ETL. Wrong for v1.

### 4.3 Alt 3 - Two graphs + side-effect annotations on tasks (planned post-v1 closure)

#### Model

Today's two-graph model, plus an additional declaration on each task:

```jsonc
"task": "shell.run",
"effects": ["filesystem.write", "process.spawn"]
```

Engine and validator gain:

- **Effect-ordering edges.** `next` edge whose source has effect S that
  the target reads (or vice versa) is _justified_ by effect ordering.
  Validator computes "data-justified, effect-justified, or neither" and
  warns on the third.
- **Parallelism analysis becomes precise.** Two nodes with no DDG path
  _and_ no overlapping effect domains can be run concurrently.
- **Sandboxing/capability gates.** A workflow declared as
  no-filesystem-write fails validation if any task has
  `filesystem.write`.

#### Gains over today

- The v1 gap closes. Useless `next` edges become detectable.
- Real parallelism.
- Security/audit story.
- **No spec-shape change for v1.** Purely additive.

#### What's hard

- **Defining the effect ontology.** Open-but-named set; small fixed core
  (read/write/network/spawn/random/time) + open extension points.
- **Tasks must declare honestly.** Sandboxing for enforcement is real
  engineering.
- **Effect inference vs. annotation.** Mandatory vs. optional needs its
  own mini-design.
- **Composability.** Sub-workflow effects = union of body's effects,
  modulo state operations.
- **Loop bodies.** Effect set = union of body's effects modulo
  loop-internal state.

#### What this does NOT change

- The two-graph model itself.
- Reference object form, four `$from` sources, scoping rules.
- Anything in v1 today.

Strict superset of today.

#### Principle scorecard

- **P1**: Unchanged.
- **P2**: **Stronger.** Effect flow becomes traceable.
- **P3**: Unchanged or slightly stronger.
- **P4**: Unchanged.
- **P5**: **Stronger.** Unjustified `next` edges get flagged; reader
  knows why an edge exists.

#### Verdict

Planned evolution the principles point toward. Closes the one real gap
in today's two-graph model without revisiting any v1 commitment. The
right v1 move is to keep the door open - which the design currently
does, by leaving `task` an opaque identifier.

---

## 5. Use-case-driven evaluation

The right way to choose between models is by what we plan to _do_ with
the graphs, not abstract elegance. This section catalogues the uses,
then scores each model.

### 5.1 Inventory of uses

#### Category A - Static analysis at authoring time

- **A1.** Reference validity (P1). DDG + CFG dominance.
- **A2.** Type compatibility (P1). DDG + type relation.
- **A3.** Branch exhaustiveness (P5). CFG (branch fan-out).
- **A4.** Termination (P3). CFG.
- **A5.** Acyclicity per scope (P3). CFG.
- **A6.** Scope closure (P4). DDG + scope info.
- **A7.** Dead code detection. CFG.
- **A8.** Unused output detection. DDG. Now actionable: a node with
  `bind` but no `$from: "scope"` reader is a real authoring lint;
  unbound nodes are not candidates by construction.
- **A9.** Unjustified `next` edges. CFG + DDG + (post-v1) effects.

#### Category B - Engine execution

- **B1.** Sequencing. CFG.
- **B2.** Input resolution. DDG.
- **B3.** Iteration semantics. CFG (loop entry) + DDG (state reads) +
  state write commits.
- **B4.** Error routing. CFG (`onError`) + DDG (`$from: "error"`).
- **B5.** Output assembly. DDG (`outputBinding`) + CFG (which terminal
  reached).

#### Category C - Performance and parallelism

- **C1.** Concurrent execution analysis. DDG + CFG (state-shared scopes)
  - (post-v1) effects.
- **C2.** Speculative / eager execution. DDG (data ready?) + CFG
  (control ordering, possibly loosened by effects).
- **C3.** Caching / memoization. Cache key = task identity + resolved
  DDG inputs. Pure DDG.
- **C4.** Incremental re-execution. Forward DDG closure from changed
  input.
- **C5.** Resource scheduling. Effect declarations (post-v1).

#### Category D - Observability and debugging

- **D1.** Event mapping (P3 scenario 21). CFG (which node, which
  iteration).
- **D2.** Lineage / provenance (P2 scenario 10). Backward DDG traversal.
- **D3.** Why-did-this-run (control lineage). Backward CFG traversal,
  gathering branch decisions.
- **D4.** Why-didn't-this-run. Forward CFG traversal from `entry`.
- **D5.** Step debugger / replay. Both graphs.
- **D6.** Time-travel debugging. CFG (which iteration, which body node)
  - DDG (which state values were live).
- **D7.** Live execution view. CFG for layout, DDG for "what data is
  flowing right now".

#### Category E - Tooling / authoring assistance

- **E1.** Visualization. CFG = natural skeleton; DDG overlaid.
- **E2.** Refactoring (extract sub-workflow, inline loop, rename). Both
  graphs.
- **E3.** Diff / review. Both graphs change independently.
- **E4.** LLM generation guardrails. Structural distinctness of
  constructs (loop, branch, handler) helps LLM produce correct shapes
  (P3 scenario 22). LLM mostly produces inputs (DDG); CFG is sometimes
  implicit and easy to forget.
- **E5.** Auto-completion. DDG-style scope info + CFG dominator info.
- **E6.** Sub-workflow extraction (post-v1). Both graphs to compute the
  boundary.

#### Category F - Security, audit, governance

- **F1.** Sensitive-data tracking (P2 scenario 12). DDG + type/tag
  annotations.
- **F2.** Capability auditing. Effect declarations (post-v1).
- **F3.** Compliance review (consent step on every path that touches
  user data). CFG dominance check.
- **F4.** Sandbox enforcement. Effect declarations + runtime policy.

#### Category G - Future evolution

- **G1.** Sub-workflow calls (P3 scenario 24). New node kind; both
  graphs.
- **G2.** Side-effect / capability declarations (the \u00a73.2.2
  closure). Third declared dimension.
- **G3.** Streaming / partial outputs. Stretches both graphs.
- **G4.** User-interaction / suspend-resume. CFG-prominent; DDG mostly
  unchanged.
- **G5.** Distributed execution. DDG ships inputs across the wire;
  effects declare what can move.

### 5.2 Scoring

Scale:

- 🟢 model handles naturally
- 🟡 same effort as today / works with awkwardness
- 🔴 model makes harder or requires re-introducing the discarded structure
- ⚪ not applicable in this model

#### A. Static analysis at authoring time

| Use                               | Two graphs (today, +effects post-v1) | Alt 1 (edges carry data)    | Alt 2 (`next` derived)                  |
| --------------------------------- | ------------------------------------ | --------------------------- | --------------------------------------- |
| **A1** Reference validity         | 🟢                                   | 🟢 (trivial)                | 🟢 (trivial)                            |
| **A2** Type compatibility         | 🟢                                   | 🟢                          | 🟢                                      |
| **A3** Branch exhaustiveness      | 🟢                                   | 🟡 (per-edge guards)        | 🔴 (branches re-encoded)                |
| **A4** Termination                | 🟢                                   | 🟢                          | 🔴 (no explicit terminals)              |
| **A5** Acyclicity                 | 🟢                                   | 🟢                          | 🔴 (DDG must be acyclic; loops special) |
| **A6** Scope closure              | 🟢                                   | 🟢                          | 🟡                                      |
| **A7** Dead-node detection        | 🟢                                   | 🟢                          | 🟢                                      |
| **A8** Unused-output detection    | 🟢                                   | 🟢 (empty payload edges)    | ⚪ (every output consumed or dead)      |
| **A9** Unjustified-edge detection | 🔴 in v1, 🟢 post-v1 with effects    | 🟢 (edge has empty payload) | ⚪ (no `next` edges to be unjustified)  |

#### B. Engine execution

| Use                        | Two graphs (today, +effects post-v1) | Alt 1 (edges carry data)    | Alt 2 (`next` derived)                    |
| -------------------------- | ------------------------------------ | --------------------------- | ----------------------------------------- |
| **B1** Sequencing          | 🟢                                   | 🟢                          | 🔴 (engine derives; reader can't predict) |
| **B2** Input resolution    | 🟢                                   | 🟢                          | 🟢                                        |
| **B3** Iteration semantics | 🟢                                   | 🔴 (state needs self-edges) | 🔴 (loops special-cased)                  |
| **B4** Error routing       | 🟢                                   | 🔴 (special edge kind)      | 🔴 (special data kind)                    |
| **B5** Output assembly     | 🟢                                   | 🟢                          | 🟢                                        |

#### C. Performance and parallelism

| Use                          | Two graphs (today, +effects post-v1) | Alt 1 (edges carry data) | Alt 2 (`next` derived) |
| ---------------------------- | ------------------------------------ | ------------------------ | ---------------------- |
| **C1** Concurrency analysis  | 🟢 with effects, 🟡 without          | 🟢                       | 🟢                     |
| **C2** Speculative execution | 🟢 with effects                      | 🟢                       | 🟢                     |
| **C3** Caching               | 🟢 (DDG drives cache key)            | 🟢                       | 🟢                     |
| **C4** Incremental re-exec   | 🟢                                   | 🟢                       | 🟢                     |
| **C5** Resource scheduling   | 🟢 with effects                      | 🟡                       | 🟡                     |

#### D. Observability and debugging

| Use                        | Two graphs (today, +effects post-v1) | Alt 1 (edges carry data) | Alt 2 (`next` derived)          |
| -------------------------- | ------------------------------------ | ------------------------ | ------------------------------- |
| **D1** Event mapping       | 🟢                                   | 🟢                       | 🟡                              |
| **D2** Data lineage        | 🟢                                   | 🟢                       | 🟢                              |
| **D3** Control lineage     | 🟢                                   | 🟢 (edges carry both)    | 🔴 (no CFG to walk)             |
| **D4** Why-didn't-this-run | 🟢                                   | 🟢                       | 🔴                              |
| **D5** Step debugger       | 🟢                                   | 🟢                       | 🔴 (next-step is engine choice) |
| **D6** Time-travel         | 🟢                                   | 🟢                       | 🟡                              |
| **D7** Live execution view | 🟢                                   | 🟢                       | 🔴 (no canonical layout)        |

#### E. Tooling and authoring assistance

| Use                            | Two graphs (today, +effects post-v1) | Alt 1 (edges carry data)   | Alt 2 (`next` derived)                |
| ------------------------------ | ------------------------------------ | -------------------------- | ------------------------------------- |
| **E1** Visualization           | 🟢 (CFG skeleton)                    | 🟡 (one graph, busy edges) | 🔴 (must derive structure)            |
| **E2** Refactoring             | 🟢                                   | 🟡 (edge merging at joins) | 🔴 (input change = scheduling change) |
| **E3** Diff / review           | 🟢                                   | 🟡                         | 🟢 (smaller diffs but harder to read) |
| **E4** LLM guardrails          | 🟢 (constructs scaffold the LLM)     | 🟡                         | 🔴 (LLM must reason about scheduling) |
| **E5** Auto-completion         | 🟢                                   | 🟢                         | 🟢                                    |
| **E6** Sub-workflow extraction | 🟢                                   | 🟡                         | 🔴 (boundary implicit)                |

#### F. Security, audit, governance

| Use                               | Two graphs (today, +effects post-v1) | Alt 1 (edges carry data) | Alt 2 (`next` derived) |
| --------------------------------- | ------------------------------------ | ------------------------ | ---------------------- |
| **F1** Sensitive-data tracking    | 🟢                                   | 🟢                       | 🟢                     |
| **F2** Capability auditing        | 🟢 with effects                      | 🟢 with effects          | 🟢 with effects        |
| **F3** Compliance dominance check | 🟢 (CFG dominance direct)            | 🟡                       | 🔴 (no CFG to check)   |
| **F4** Sandbox enforcement        | 🟢 with effects                      | 🟢 with effects          | 🟢 with effects        |

#### G. Future evolution

| Use                          | Two graphs (today, +effects post-v1)  | Alt 1 (edges carry data) | Alt 2 (`next` derived)              |
| ---------------------------- | ------------------------------------- | ------------------------ | ----------------------------------- |
| **G1** Sub-workflow calls    | 🟢 (new node kind, both graphs adapt) | 🟡 (new edge guards)     | 🟡 (new node kind anyway)           |
| **G2** Effect declarations   | 🟢 (additive)                         | 🟢 (additive)            | 🟢 (becomes a sequencing mechanism) |
| **G3** Streaming             | 🟡 (open question)                    | 🟡                       | 🟡                                  |
| **G4** Suspend/resume        | 🟢 (CFG pause point natural)          | 🟡                       | 🔴 (no CFG to pause)                |
| **G5** Distributed execution | 🟢 with effects                       | 🟢 with effects          | 🟢 with effects                     |

### 5.3 Patterns in the table

#### Pattern 1 - The DDG is universal; the CFG is what differs

Every model handles **A1, A2, B2, C3, C4, D2, F1** (purely about
declared data). Models diverge on _control_: branches, errors, loops,
sequencing, debuggability.

If the workflow vision were _only_ data pipelines, Alt 2 would be
defensible. But the catalogue includes:

- Error handling with sibling-output access (D3, D4)
- Suspend/resume for user interaction (G4)
- Compliance dominance checks (F3)
- LLM generation that benefits from control structure (E4)
- Live execution views (D7)

These need the CFG as a first-class artifact, not derived. Alt 2 takes
the biggest hit on the dimensions the vision cares most about.

#### Pattern 2 - Alt 1's costs are concentrated in error handling and loops

Alt 1 handles linear data pipelines beautifully. But:

- Error routing needs a new edge kind (reintroduces `onError`).
- Loops need self-edges with state-as-payload (multigraph keyed by
  iteration).
- Branches need per-case guards on every outgoing edge (decision spread
  across edges).

Trades clarity of _control_ for clarity of _data on edges_. Whether
that's a good trade depends on read-frequency: "what happens" vs. "what
flows".

For LLM-generated workflows (E4), reading frequency is high and "what
happens" is the natural mental model. Alt 1 inverts the natural
authoring order.

#### Pattern 3 - Two graphs + effects (Alt 3) wins on the dimensions where everyone wants to grow

The **+** cells in the post-v1 column for the two-graph model (A9, C1,
C2, C5, F2, F4, G2, G5) all unlock once effect declarations exist.
None require revisiting v1 - they're additive.

Alt 1/Alt 2 give many of these wins _now_ but at the cost of reshaping
the spec model. The question: **do we get enough value in v1 from those
early wins to justify the redesign, knowing the same wins arrive
post-v1 anyway?**

Looking at v1 use cases that drive value:

- Authoring + LLM generation (E4): today's structured constructs help;
  alternatives hurt.
- Debugging (D1-D7): today's CFG is what makes most natural;
  alternatives hurt several.
- Visualization (E1): today's CFG is the natural skeleton;
  alternatives weaken it.
- Validation (A1-A6): today's two-graph model already gets these.

Early-wins the alternatives offer (cleaner concurrency without effects
in C1) come "for free" because they elide control sequencing. But
target workflows _have_ legitimate sequencing needs, so that "freedom"
becomes "we can't express side-effect ordering at all".

### 5.4 Where each model genuinely shines

**Two graphs (today + Alt 3 evolution)**

- Workflows with mixed control + data (most LLM-orchestration scenarios)
- Workflows with rich error handling
- Workflows that need to be visualized as flowcharts
- Long-running, debuggable, observable systems
- Anywhere CFG dominance is a useful proof obligation (compliance,
  security)

**Alt 1 (edges carry data)**

- Streaming dataflow systems
- Visual programming (LabVIEW, Max/MSP, Houdini SOPs)
- Audio/video pipelines
- Hardware description (Verilog wires)
- Anywhere the dominant question is "where does this value come from
  along this exact wire"

**Alt 2 (`next` derived)**

- Pure functional pipelines
- Build systems (Bazel, Make)
- ML/data pipelines (Airflow, Prefect, Dask)
- Anywhere all tasks are pure functions and ordering is irrelevant
  beyond data dependency

The TypeAgent workflow vision is firmly in the **two-graph** camp:
orchestrating LLM calls, side-effecting tools, retries, branches, error
recovery, suspend/resume.

### 5.5 Conclusion through the use-case lens

The two-graph model is not just the path of least resistance for v1 -
it is the model whose strengths align with the workflow uses we
actually need:

- Every C/D/E/F/G case that gives a strong **+** today, the
  alternatives give a **-** or **0** on.
- The cases where the alternatives shine (clean concurrency without
  effects, smaller specs for pure pipelines) are not where TypeAgent
  workflow value comes from.
- The one v1 weakness of the two-graph model (A9) is closed by a
  planned additive change (Alt 3 / effects), not a redesign.

The decision as written is correct, and the side-effect declaration
roadmap is what makes it durably correct.

---

## 6. Open follow-ups

### 6.1 Suggested next steps surfaced by this analysis

1. **Pick "killer" uses to validate the design against early.**
   Suggested candidates that exercise CFG, DDG, and their relationship
   in different ways:

   - **D5** (step debugger)
   - **E1** (visualization)
   - **F3** (compliance dominance check)

2. **Sketch the effect-declaration shape just enough to confirm it's
   additive.** Not designing it - confirming that adding `effects: [...]`
   to a task and a corresponding validation pass doesn't require
   reshaping anything.

### 6.2 Decisions already folded back into the spec doc

- \u00a73.2.1 Scoping rules (consolidates the four-namespace model).
- \u00a73.2.2 Two graphs, one validator (names CFG/DDG separation, the
  dominator invariant, and the v1 limitation).
- \u00a72.2 row update: side-effect declarations explicitly identified
  as the planned closure of the \u00a73.2.2 gap.

### 6.3 Decisions still owed back to the spec doc

- Clarify in \u00a73.7 / validation pass 5 the post-dominator
  treatment of `loop.outputs[k]` when the body has multiple `@exit`
  targets.
- Confirm which scope each reference position resolves in via a small
  table in \u00a73.2.1 (covers the loop `state[*].initial` outer-scope
  resolution case explicitly).

### 6.4 Questions parked for later

- Cross-namespace name reuse: silently allowed today; should the
  validator emit a soft warning?
- Loop's `inputs` block uses the same word "input" as the workflow's
  top-level `input` schema. Worth a rename for clarity?
- For nested loops (post-v1), confirm the boundary-closure rule
  recorded in \u00a73.2.1 forward note.
