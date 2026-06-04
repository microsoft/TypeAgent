# Post-v1: explicit `block` node

Status: **Post-v1 sketch.** Listed in [../ir-v0.1.md](../ir-v0.1.md) §2.2.

Reframed after [../workflow-scope-proposal.md](../workflow-scope-proposal.md)
(Accepted) and [../decisions/0010-finish-workflow-scope-unification.md](../decisions/0010-finish-workflow-scope-unification.md):
this is no longer "a new scope kind" but "a new structured node whose body
is a `WorkflowScope`", parallel to fork branches, branch arms, forkMap
bodies, and loop bodies.

## 1. Motivation

The post-0010 IR has one scope abstraction (`WorkflowScope`) used at every
embedding site: top-level workflow, loop body, fork branches, forkMap body,
branch arms. What it does **not** have is a way to wrap a linear region of
sibling nodes inside an enclosing scope under a single boundary.

The `block` node is the post-v1 closure for the gaps that remain after
0010:

- **Multi-statement `try`.** A single `onError` on the block catches any
  failure that propagates out of the body. Without blocks, the only ways
  to cover several nodes with one handler are (a) duplicate `onError` per
  node and accept duplicate handlers (which v1 forbids: one trigger per
  handler), or (b) let failures bubble to the surrounding loop, branch
  arm, or workflow scope and lose locality. Decision 0010 gave branch arms
  their own `onError`, but that only protects the arm-as-a-whole; it does
  not let you wrap an arbitrary contiguous region of siblings in one
  handler.
- **Regional grouping with localized error handling.** When a join is
  itself a region (each branch arm is several steps that together need
  their own try / their own intermediate hiding), today the choices are a
  full branch arm (heavyweight, requires a selector and sibling arms) or
  inlining the steps directly. A block makes the region first-class
  without inventing dispatch.
- **Inline sub-workflow precursor.** A block is a `WorkflowScope` embedded
  at a use site. Promoting it to a separately-stored sub-workflow becomes
  a mechanical refactor: lift the `scope` to its own document, replace the
  inline `scope` with a reference.

Per-node hiding is **already handled** by bound outputs (hide-by-default
`bind`); blocks are not needed for that case. See
[../decisions/0001-bound-outputs.md](../decisions/0001-bound-outputs.md).

## 2. Why it slots in cleanly

Under the post-0010 IR, every structured node embeds a `WorkflowScope` via
the same `{ inputs, scope, ... }` shape. A block is one more embedding
site with the same contract:

| Embedding site                | Outer wiring           | Body            | Dispatch                  | May `bind` / `onError` / `next` |
| ----------------------------- | ---------------------- | --------------- | ------------------------- | ------------------------------- |
| top-level workflow            | n/a (runtime-provided) | `WorkflowScope` | runs once                 | n/a                             |
| `loop.body`                   | `loop.inputs`          | `WorkflowScope` | runs until `continueWhen` | yes                             |
| `fork.branches[k]`            | `branch.inputs`        | `branch.scope`  | all run concurrently      | yes                             |
| `forkMap.body`                | `forkMap.inputs`       | `WorkflowScope` | one run per element       | yes                             |
| `branch.cases[k]` / `default` | `arm.inputs`           | `arm.scope`     | exactly one arm runs      | yes                             |
| **`block` (this doc)**        | `block.inputs`         | `block.scope`   | runs once                 | yes                             |

Blocks are the degenerate case: no dispatch, no fan-out, no iteration.
Just "run this `WorkflowScope` once at this point."

Implementation cost is roughly: add the node kind, route it through the
existing `WorkflowScope` validation and execution paths, document. No new
scope abstraction, no new dominator math, no changes to handler
semantics, no changes to the reference model.

## 3. Sketch

Shape mirrors fork branches and branch arms: `{ inputs, scope, ... }`,
where `scope` is a `WorkflowScope` (per
[../workflow-scope-proposal.md](../workflow-scope-proposal.md): declared
`inputSchema`, `entry`, `nodes`, `output`, `outputSchema`).

```jsonc
"buildAndShip": {
  "kind": "block",
  "inputs": {
    "version": { "$from": "node", "name": "computeVersion" }
  },
  "scope": {
    "inputSchema": { /* shape of values the block receives */ },
    "entry": "build",
    "nodes": {
      "build": { "kind": "task", "task": "build.run", /* ... */, "next": "test" },
      "test":  { "kind": "task", "task": "test.run",  /* ... */, "next": "ship" },
      "ship":  { "kind": "task", "task": "ship.run",  /* ... */, "next": null }
    },
    "output": { "$from": "scope", "name": "ship" },
    "outputSchema": { /* shape of the block's output */ }
  },
  "next": "notify",
  "onError": "buildShipError",
  "bind": "shipResult"
}
```

`buildShipError` is a handler in the **outer** scope. It catches any
failure inside `scope` that wasn't caught by an inner body-scope handler,
plus any failure of the block's own `inputs` resolution or `scope.output`
resolution.

Inside the block, individual nodes can still carry their own `onError`
pointing to body-scope handlers, exactly like fork branches and branch
arms. Nested catch behavior falls out of the existing rules.

## 4. Design choices specific to `block`

Most of what earlier drafts of this doc listed (state, constants,
sentinels) is now subsumed by "it's a `WorkflowScope`": the rules for
those are defined once in [../workflow-scope-proposal.md](../workflow-scope-proposal.md)
and applied uniformly. The only block-specific knobs are below.

### 4.1 Outer-to-inner wiring

Same as every other `WorkflowScope` embedding site since the unification:
all scopes start clean and receive only what they declare. The block has
an `inputs` map at the embedding site that resolves templates in the
outer scope; the body reads them via `$from: "input"`. Workflow-root
constants remain visible per the standard reference-namespace rules.

This gives P4 composability for free: "lift this block into a stored
sub-workflow" is a mechanical refactor because the block already declares
everything it consumes and produces.

### 4.2 Termination

A block runs once. Body completion follows the same "runs to natural end"
rule as fork branches and forkMap bodies after decision 0010: terminal
nodes use `next: null`, and `scope.output` is resolved in the body
context at completion. No sentinels; nothing block-specific.

### 4.3 Block-level `onError`, `next`, `bind`

This is the whole point. The block, like any other structured node in
its enclosing scope, carries optional `onError`, `next`, and `bind`
fields with the standard semantics. No new mechanism.

## 5. What this does NOT buy

- Not **typed errors**. The block-level handler is still one handler that
  internally discriminates on the error structure.
- Not **`finally`**. The diamond pattern (success-`next` and handler-`next`
  both pointing at the same cleanup node) remains the way.
- Not **shared handlers**. Each protected region (block or single node)
  still has exactly one handler.

These remain separate post-v1 items.

## 6. Relationship to sub-workflows

Under the post-0010 IR, a block **is** a `WorkflowScope` inlined at a use
site. A stored sub-workflow is the same `WorkflowScope` lifted into its
own document and referenced. Two coherent end states:

- **Coexist:** sub-workflow is a separate document referenced by id; block
  is the same `WorkflowScope` inlined.
- **Unified:** the inline form is a block; the document-reference form is
  a "block call". Reference vs. inline is a packaging choice over the
  same `WorkflowScope`.

Adding **block first** and treating sub-workflow as "block in a separate
file" later is the easier path: it doesn't require multi-document
machinery (id resolution across files, versioning, packaging) up front,
yet it pays off the multi-statement-try use case immediately, and it
reuses the `WorkflowScope` plumbing that already exists.

## 7. Why record this now

Three near-term design conversations are influenced by knowing this
exists in the post-v1 backlog:

- **Error-routing design** can rest the multi-statement-try concern on
  "this is the planned closure" rather than re-litigating shared handlers.
- **Sub-workflow design** can be framed as "block + document boundary"
  rather than as a from-scratch construct.
- **Validator and runner architecture** already iterate over
  `WorkflowScope` embedding sites; adding `block` is one more site, not
  a new branch in the architecture.

## 8. Open questions

- Is there ever a reason for a block to _omit_ `scope.output` (a
  side-effect-only region)? Other `WorkflowScope` embedding sites all
  require it; consistency argues for required here too, with `output:
{ "$literal": null }` as the explicit "no value" form.
- If a block fails before any body node runs (its own `inputs`
  resolution fails), is that a block failure that the outer `onError`
  catches? Most likely yes, by analogy with fork branch and loop init
  failures.
- Should `block` and the post-v1 sub-workflow call share a single node
  kind that discriminates on inline vs. referenced `scope`, or stay as
  two kinds? Resolve when sub-workflow lands.
