# Workflow composition — decision log

Per impl plan §3.1, this file logs design decisions made during implementation
that were either non-obvious or differed from the first assumption in the
design doc. Each entry is dated and tagged to the phase that produced it.

## Phase 1 — IR model

### P1-D1. WorkflowCallNode discriminant: `"workflowCall"` not `"workflow"`

The design doc (workflow-composition.md §2) describes the new node with
discriminant `kind: "workflow"`. The artifact's top-level discriminant is
also `kind: "workflow"`. Although the two namespaces (artifact and node)
are distinct in JSON, the shared discriminant value creates ambiguity in
TypeScript discriminated-union checks and in human reading.

Chose `kind: "workflowCall"` for the node. The artifact remains
`kind: "workflow"`. Impact on the spec: a one-word change to be folded into
ir-v0.2.md in Phase 8.

### P1-D2. `constants` and `types` remain top-level, not per-workflow

The design doc does not specify whether the constants/types tables move
inside each `WorkflowBody` or stay at the artifact level. Kept them at the
artifact level for IR v1: simpler semantics, single namespace, matches the
existing fixture style. Per-workflow visibility is deferred to a future IR
revision if needed (no current use case requires private constants).

### P1-D3. Dropped legacy `name` field at the artifact level

The pre-change `WorkflowIR.name` was the single workflow's name. In the new
shape the workflow name is the key in `workflows`, and the artifact carries
`entry: string` naming the entry workflow. The artifact-level `name` was
removed entirely (rather than retained as an alias for `entry`). Consumers
that previously read `ir.name` now read `ir.entry`. The "no back-compat"
decision from the plan-review session applies.

### P1-D4. `WorkflowBody` is an alias of `WorkflowScope`

The design uses the name `WorkflowBody` for top-level workflow bodies and
notes they are structurally identical to loop/fork scopes (which the code
already calls `WorkflowScope`). Rather than renaming the existing
`WorkflowScope` everywhere (touching loop, fork, forkMap node types and all
their validation/runtime code), `WorkflowBody` is exported as a `type` alias
of `WorkflowScope`. The API surface uses `WorkflowBody` for the workflows
table; internal helpers continue to use `WorkflowScope`. This avoids
churning unrelated code while keeping the design's vocabulary visible at the
public API.

### P1-D5. Validator schema-match check uses `JSON.stringify` equality

For `WorkflowCallNode.inputSchema`/`outputSchema` matching the referenced
body, the implementation compares with `JSON.stringify(a) === JSON.stringify(b)`.
This is *order-sensitive* and stricter than the eventual semantic check.
For Phase 1 the emitter (Phase 4) is expected to copy the body's schemas
verbatim, so strict equality is sound. A deep-equal helper or structural
subtyping comparison may be substituted later if emitter behavior diverges.
Logged here so Phase 4 can verify the emitter-side contract.

### P1-D6. Engine resolves entry body up-front

`runner.ts` resolves `ir.workflows[ir.entry]` at the top of `run()` and
threads `entryBody` through downstream calls. Returns an `error` result if
the entry workflow is missing (defense-in-depth — the static validator
already rejects this case). This keeps the engine surface minimal in
Phase 1 and avoids adding a `WorkflowCallNode` execution handler until
Phase 5.

### P1-D7. Test fixtures use a wrapping helper rather than literal migration

`validate.spec.ts` introduced an `IROverrides` type that accepts legacy
single-workflow field names (`nodes`, `entry`, `output`, `inputSchema`,
`outputSchema`) and routes them into the synthetic body. This avoided
rewriting 100+ inline `makeMinimalIR({ ... })` call sites. Tests that
exercise the new artifact shape directly (multiple workflows in one IR)
can still pass a `workflows:` override.

For `engine.spec.ts` and `compiler.spec.ts`, inline `const ir: WorkflowIR = { ... }`
literals were rewritten programmatically (brace-counting Python script) to
the new wrapped shape. Tests assert behavior unchanged.
