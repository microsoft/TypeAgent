# Workflow Recursion

## Status

Future. v1 statically rejects cycles in the workflow call graph.

## Context

`dsl/workflow-composition.md` makes workflow calls IR nodes shaped like
task calls. Once that lands, recursive composition becomes structurally
expressible: workflow A calls workflow B which (directly or
transitively) calls A.

For v1 we deliberately reject any such cycle at compile time. The
compiler builds the workflow call graph from the bundled `workflows`
table and errors if a strongly-connected component contains more than
one node, or any node has a self-edge. This keeps v1 closer to the
inlining-era guarantee (graphs are acyclic) without re-introducing
inlining as semantics.

The question deferred here is what to do when recursion is _wanted_.

## Candidate options

### A. Engine-side depth cap (per call or per workflow)

`WorkflowCallNode` (or `WorkflowBody`) carries a `maxDepth`. The engine
tracks the call stack depth per execution; exceeding the cap raises
through the call node's `onError` like any other runtime error.

- Mirrors `loop.maxIterations` exactly.
- No new validator: cycles are allowed; the runtime bounds them.
- Cost: every call site (or every workflow) must declare a number, and
  the IR carries it.

### B. Validator-permitted cycles, runtime-bounded by engine default

Same as (A) but the cap is engine-configured, not IR-declared. The IR
just permits cycles; the engine refuses to call past its configured
depth.

- Lightest IR change (none, beyond removing the cycle check).
- Cost: behavior depends on engine config, not artifact &mdash;
  weakens P5 unless the cap is part of the contract.

### C. Explicit recursion marker on the workflow declaration

`recursive workflow factorial(n: number): number { ... }` &mdash; the
compiler only permits cycles through workflows declared `recursive`.
Authoring intent is explicit; non-recursive workflows still benefit
from the v1 acyclic guarantee.

- Strongest P3 (structure mirrors intent).
- Cost: DSL surface change; doesn't cover mutual recursion cleanly
  unless both participants are marked.

### D. Lower recursion to a bounded loop

The DSL accepts a recursion-shaped declaration but the compiler lowers
it to an iterative form (loop + explicit stack). The IR stays acyclic.

- Preserves the acyclic invariant.
- Cost: only works for tail recursion / pattern-restricted forms;
  general recursion is hard to mechanically transform.

## Why consider this

- Algorithms whose natural expression is recursive (tree walks,
  iterative deepening, retries with structural decisions) require
  awkward encodings as bounded loops.
- Once workflows compose freely across files, mutual recursion between
  unrelated workflows is easy to introduce accidentally. A clear policy
  beats a stack overflow.

## Risks and costs

- Without an explicit cap, recursive workflows are a denial-of-service
  vector for any engine running untrusted IR.
- Visualization and debugging tooling has to handle cycles in the call
  graph, not just trees.
- Effect inference (see `ir/future/effect-inference.md`) over a
  cyclic graph needs a fixpoint, not a simple traversal.

## Open questions

- Should the cap be per-call (each call site picks its budget) or
  per-workflow (the callee declares its self-cap)?
- Does exceeding the cap raise to the call node's `onError`, or fail
  the whole execution?
- Does mutual recursion require both participants opted in (option C)
  or just one?

## Revisit triggers

- A real use case lands that is awkward to express as a bounded loop.
- A second composition feature (e.g. dynamic dispatch by name) makes
  cycles emerge implicitly even without the author writing one.
- The acyclic-graph guarantee starts buying less than it costs.

## Non-goal

- Reintroducing inlining as the semantic model for recursion.
- Unbounded recursion. Whatever shape recursion takes, it is bounded.
