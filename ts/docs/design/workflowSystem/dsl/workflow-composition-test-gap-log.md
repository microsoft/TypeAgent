# Workflow composition — test gap log

Per impl plan §4, this file captures test gaps that were identified
during the per-phase gap analyses and **not** filled, with reason and
(where relevant) a pointer to the future doc or phase that would
address them. Filled gaps are tracked by the test diff itself.

## Phase 3 — Type checker

(No unactioned gaps.)

## Phase 5 — Engine

### P5-T1. Caller-side `onError` _recovery_ path for `workflowCall`

- **Gap:** A test that compiles a workflow where the caller installs
  an `onError` recovery edge on a `WorkflowCallNode`, the callee
  throws, and the caller routes to its recovery target rather than
  failing.
- **Reason not filled:** The DSL surface has no syntax for attaching
  `onError` to a workflow-call site; today such an IR can only be
  hand-written. The engine path itself is exercised indirectly by
  task-error recovery tests, which share the same dispatch.
- **Re-trigger:** Add when the DSL gains `try/catch`-style sugar
  for sub-workflow calls.

### P5-T2. Named-record argument shape (`helper({a: 1, b: 2})`)

- **Gap:** Dedicated end-to-end test using object-literal arguments
  rather than positional.
- **Reason not filled:** The compiler routes object-literal args
  through the same lowered call shape as positional args; the
  existing positional-arg engine tests cover the lowered form. The
  parser/typechecker paths are covered by the dsl-package tests.

### P5-T3. Constants visible inside sub-workflow body

- **Gap:** A test that defines a top-level constant in the source and
  verifies it is readable from a sub-workflow body via `$from`.
- **Reason not filled:** The DSL has no `const`-at-module-level
  syntax today, so the case cannot be expressed against the surface.
  The engine's per-frame value resolution path is already exercised
  by other tests.

## Phase 7 — Imports

### P7-T1. Same canonical workflow imported under two different aliases

- **Gap:** `import { foo } from "./a.wf"; import { foo as bar } from "./a.wf";`
  is legal per the loader (different local names, same canonical
  target). No test verifies that both aliases lower to the same
  workflow body in the IR.
- **Reason not filled:** Low-value variant — the rewriter treats
  each local-name entry independently and the canonical-name path is
  already covered by the alias-canonicalization test.

### P7-T2. Nested transitive imported defaults

- **Gap:** Workflow `B` is imported by main and has param
  `x = C()` where `C` is itself imported by `B` from a third file.
  The rewriter walks param defaults (covered by single-hop test),
  but the transitive multi-file case is not directly exercised.
- **Reason not filled:** The rewriter operates per-file with the
  file's local-name map; transitive correctness reduces to single-
  hop correctness because each file is rewritten independently
  before merging. Adding the test would not exercise additional code
  paths.

### P7-T3. Multi-error compilation (e.g., missing import _and_ duplicate name in the same compile)

- **Gap:** No test that verifies the loader reports both errors at
  once with stable ordering.
- **Reason not filled:** The loader emits errors as it walks files
  and the error array preserves insertion order, but no behavioral
  contract on ordering exists yet. Add a contract test if the CLI
  starts dedup-or-sorting errors.

### P7-T4. Entry file outside `workspaceRoot`

- **Gap:** Does `compileFile("/outside/main.wf", …, { workspaceRoot: "/workspace" })`
  fail with a containment error, or succeed with all its imports
  blocked individually?
- **Reason not filled:** Current `realpathSync` containment is
  applied only at `resolve()` time for import statements; the entry
  file is not subject to it. This is a deliberate carve-out (the
  caller chose to point `compileFile` at this file), but it is also
  unexercised. Add when the policy is firmed up — see
  workflow-composition-decision-log.md P7-D6.

### P7-T5. Relative `workspaceRoot` path

- **Gap:** Tests pass absolute roots from `mkdtempSync`. Behavior
  with `workspaceRoot: "."` or `workspaceRoot: "./src"` is unverified.
- **Reason not filled:** `compiler.ts` calls
  `path.resolve(workspaceRoot)` so the behavior is well-defined, and
  the CLI accepts whatever the user types verbatim. Add only if a
  user reports surprising CWD-dependence.

### P7-T6. Empty import list `import { } from "./foo.wf"`

- **Gap:** Whether parser accepts, and whether the loader still
  pulls the file into the module graph.
- **Reason not filled:** No clear use case; behavior is whatever the
  parser produces. Add a test once the parser specifies a rule.

### P7-T7. Re-export through an import (`export { foo } from "./bar.wf"`)

- **Gap:** Verify the parser rejects this construct cleanly.
- **Reason not filled:** Already explicitly out of scope per the
  design (workflow-composition.md §3.4). The parser will produce a
  syntax error; the exact phrasing is not under test.

### P7-T8. Imported workflow call inside other AST shapes (attempts, parallel branches, switch arms, ternary)

- **Gap:** Test #15 covers the `map` body; analogous coverage for
  `attempts`/`parallel`/`switch`/ternary is missing.
- **Reason not filled:** `rewriteExpr`/`rewriteStmt` use uniform
  recursive descent and the `map` case exercises the same code
  paths. The risk is one of regression-detection breadth, not
  current correctness. Add if the rewriter is ever rewritten to use
  per-kind handlers rather than uniform descent.
