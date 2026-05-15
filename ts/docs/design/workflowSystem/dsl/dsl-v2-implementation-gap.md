# DSL v2 Implementation Gaps

Tracked items where the DSL spec (dsl-v2.md) describes features that are
not yet fully wired end-to-end.

## Sub-workflow calls

**Spec:** dsl-v2.md section 4. Multiple workflows in a single file;
sub-workflows are called by name and inlined at compile time.

**Current state:**

- Parser: works. Single-segment calls (`sendEmail(message)`) produce
  `WorkflowCallExpr` AST nodes.
- Type checker: partially works. Resolves return type from the called
  workflow's declaration, but `compile()` only passes a single workflow
  to the checker (`TypeChecker` constructor defaults `workflows` to `[]`).
  Cross-workflow calls produce "Unknown workflow" unless the caller
  explicitly provides sibling workflows.
- Emitter: does not inline. Emits a `TaskNode` with
  `task: "workflow.<name>"` and empty schemas (see implementation-decisions
  3.4).
- Runtime: fails. `workflow.<name>` tasks are not registered in the
  engine.

**What needs to happen:**

1. `compile()` should pass all parsed workflows to the type checker so
   cross-workflow references resolve.
2. The emitter should inline sub-workflow bodies into the calling
   workflow's IR (as the spec says), or alternatively, register
   `workflow.<name>` tasks in the engine at runtime.
3. Add integration tests that compile and execute a multi-workflow file.

**Related items:** implementation-decisions.md 2.3 (recursive calls),
3.4 (sub-workflow emit strategy).

## Retry exits on count, not on first success (Bug)

**Spec:** dsl-v2.md section 3.1. Try body once, retry up to N times on
failure, exit on first success.

**Current state:** The emitter produces a loop that runs the body exactly
`count` times on the success path (no early exit on first success). On
the failure path, the attempt counter never increments (it only advances
on success), so error retries can loop up to the `maxIterations` safety
limit (100).

**What needs to happen:**

1. Restructure the emitted loop so the success path exits immediately
   after the first successful body execution.
2. The failure/onError path should increment the attempt counter and
   re-enter the loop.
3. Add integration tests for retry-on-first-success and
   retry-exhaustion semantics.

**Related items:** implementation-decisions.md 3.1.

## `noop` and `identity` tasks not registered in engine

**Spec:** These are synthetic tasks the emitter produces for merge points
(switch/branch convergence) and literal-arm passthrough (ternary with
literal values). They are part of the compiler's lowering strategy.

**Current state:** Neither `noop` nor `identity` is in `builtinTasks.ts`.
Any workflow whose IR contains these nodes crashes at runtime with
"Task not found in registry."

**Impact:** Switch statements and ternary expressions with literal arms
compile but cannot execute.

**What needs to happen:**

1. Register `noop` and `identity` as builtin tasks in the engine.
   `noop` is a no-op (returns empty). `identity` passes its input
   through as output.
2. Add integration tests that execute switch and ternary-with-literal
   workflows end-to-end.

**Related items:** implementation-decisions.md 3.3, 3.16.

## Parallel branch names are synthetic

**Spec:** dsl-v2.md section 3.4. Destructuring bindings become branch
names: `const [text, image] = parallel(...)` should produce branches
named `text` and `image`.

**Current state:** The emitter uses `branch_0`, `branch_1`, etc. The
fork node's output is keyed by these positional names, not the
user-visible destructuring variable names.

**What needs to happen:**

1. Pass destructuring names from `DestructuringConst` through to the
   fork branch emitter so branches are named after the user's bindings.
2. Update fork output resolution to use these names.

**Related items:** implementation-decisions.md 3.5.

## Parallel branches missing IR schema fields

**Spec:** ir-v2.md specifies fork branches have the same sub-scope
contract as loop bodies: `inputs`, `inputSchema`, `entry`, `nodes`,
`output`, `outputSchema`.

**Current state:** The emitter only generates `{ entry, nodes }` per
branch, omitting the schema and I/O fields. The IR validator may reject
this if it enforces the full branch sub-scope contract.

**What needs to happen:**

1. Emit `inputSchema`, `outputSchema`, `inputs`, and `output` for each
   fork branch.
2. Validate that emitted fork IR passes the IR validator.

**Related items:** implementation-decisions.md 3.6.
