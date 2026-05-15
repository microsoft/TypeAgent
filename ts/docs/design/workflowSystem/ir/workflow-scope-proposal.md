# Proposal: WorkflowScope - unified sub-workflow type

Status: **Accepted.**

## Problem

The IR has four places that embed a "sub-workflow" (a sequence of nodes with
inputs and an output):

| Site                   | `entry`    | `nodes`    | `inputSchema` | `inputs`              | `output`    | `outputSchema` |
| ---------------------- | ---------- | ---------- | ------------- | --------------------- | ----------- | -------------- |
| WorkflowIR (top-level) | yes        | yes        | yes           | no (runtime-provided) | yes         | yes            |
| LoopNode               | body.entry | body.nodes | on LoopNode   | on LoopNode           | on LoopNode | on LoopNode    |
| ForkNode branches      | yes        | yes        | **missing**   | **missing**           | **missing** | **missing**    |
| ForkMapNode body       | yes        | yes        | **missing**   | **missing**           | **missing** | **missing**    |

Three problems:

1. **Fork branches have no declared output.** The runner uses a heuristic
   (find terminal node, fall back to collecting all new bindings). This makes
   the output shape dependent on implementation details and runtime branch
   execution. (Fork branch output is now resolved from explicit
   `branch.scope.output`; see ir-v2.md section 2.1.)

2. **LoopNode mixes scope fields with loop-specific fields.** `inputs`,
   `inputSchema`, `output`, `outputSchema` sit alongside `state`,
   `iterateState`, `maxIterations` on the same object. The scope contract
   and the loop machinery are tangled.

3. **ForkMap bodies have no declared inputs or output.** The runner infers
   the output the same way as fork branches. Input injection (element via
   `elementParam`) is implicit.

## Proposal

Extract a `WorkflowScope` interface that captures the common contract: what
a sub-workflow expects, what it contains, and what it produces.

```typescript
/**
 * A self-contained execution scope: a sequence of nodes with declared
 * inputs and a declared output. Used for loop bodies, fork branches,
 * forkMap bodies, and the top-level workflow.
 */
export interface WorkflowScope {
  /** Schema describing what this scope expects as input. */
  inputSchema: JSONSchema;

  /** First node to execute. */
  entry: string;

  /** The nodes in this scope. */
  nodes: Record<string, WorkflowNode>;

  /** Template that produces this scope's output value. Resolved in
   *  the scope's own binding context after execution completes. */
  output: Template;

  /** Schema of the output value. */
  outputSchema: JSONSchema;
}
```

`inputs` (the wiring from outer scope to inner scope) is deliberately NOT
part of `WorkflowScope`. It is the embedding site's concern: how values
from outside are threaded into the scope. The scope itself only declares
what it expects (`inputSchema`) and what it produces (`output` + `outputSchema`).

### Updated types

```typescript
// Top-level: a scope with metadata
export interface WorkflowIR extends WorkflowScope {
  kind: "workflow";
  name: string;
  description?: string;
  version: string;
  types?: Record<string, JSONSchema>;
  constants?: Record<string, ConstantDef>;
}

// Loop: inputs + body scope + loop-specific fields
export interface LoopNode {
  kind: "loop";
  inputs: Record<string, Template>; // wiring: outer -> body
  body: WorkflowScope; // the scope
  state: Record<string, LoopStateVar>; // loop-specific
  iterateState: Record<string, Template>; // loop-specific
  maxIterations: number;
  next?: string;
  onError?: string;
  bind?: string;
  timeoutMs?: number;
}

// Fork: each branch is inputs + scope
export interface ForkNode {
  kind: "fork";
  branches: Record<
    string,
    {
      inputs: Record<string, Template>; // wiring: outer -> branch
      scope: WorkflowScope; // the scope
    }
  >;
  outputSchema: JSONSchema; // combined: { branchName: branchOutputSchema }
  maxConcurrency?: number;
  next?: string;
  onError?: string;
  bind?: string;
}

// ForkMap: inputs + body scope + collection fields
export interface ForkMapNode {
  kind: "forkMap";
  collection: Template;
  collectionSchema: JSONSchema;
  elementParam: string;
  inputs?: Record<string, Template>; // wiring: outer -> body (optional)
  body: WorkflowScope; // the scope
  outputSchema: JSONSchema; // array of body outputs
  maxIterations?: number;
  maxConcurrency?: number;
  next?: string;
  onError?: string;
  bind?: string;
}
```

### What changes per type

**WorkflowIR** - `extends WorkflowScope`. No field changes. Existing JSON
is already valid: it has `inputSchema`, `entry`, `nodes`, `output`,
`outputSchema`. The `kind`, `name`, `version`, etc. are additive.

**LoopNode** - The `body` field gains `inputSchema`, `output`, `outputSchema`.
These move from the LoopNode top level into `body`. The `inputs` field stays
on LoopNode (it's the outer -> inner wiring). Net change:

```
Before:                          After:
LoopNode.inputSchema      ->     LoopNode.body.inputSchema
LoopNode.body.entry       ->     LoopNode.body.entry        (same)
LoopNode.body.nodes       ->     LoopNode.body.nodes        (same)
LoopNode.output           ->     LoopNode.body.output
LoopNode.outputSchema     ->     LoopNode.body.outputSchema
LoopNode.inputs           ->     LoopNode.inputs             (same)
```

**ForkNode** - Branches gain `inputs` and `scope` (a WorkflowScope). Branch
output is now explicit via `scope.output`. The runner's heuristic goes away.

```
Before:                                   After:
branch.entry                ->            branch.scope.entry
branch.nodes                ->            branch.scope.nodes
(missing)                   ->            branch.scope.inputSchema
(missing)                   ->            branch.scope.output
(missing)                   ->            branch.scope.outputSchema
(missing)                   ->            branch.inputs
```

**ForkMapNode** - Body gains full `WorkflowScope`. Optional `inputs` on
the ForkMapNode for outer-scope wiring (beyond the element).

```
Before:                          After:
body.entry                ->     body.entry              (same)
body.nodes                ->     body.nodes              (same)
(missing)                 ->     body.inputSchema
(missing)                 ->     body.output
(missing)                 ->     body.outputSchema
(missing)                 ->     ForkMapNode.inputs
```

## Impact on runner

### Output resolution becomes uniform

Before (three different strategies):

```typescript
// Loop: explicit template
const output = resolveTemplate(node.output, bodyScope);

// Fork: heuristic (findTerminalNode + fallback)
const terminalId = findTerminalNode(branch.nodes, branch.entry);
// ... 15 lines of heuristic ...

// ForkMap: same heuristic
const terminalId = findTerminalNode(node.body.nodes, node.body.entry);
// ... same heuristic ...
```

After (one strategy):

```typescript
// All scope types:
const output = resolveTemplate(scope.output, scopeContext);
```

The `executeFork` and `executeForkMap` methods each lose ~15 lines of
heuristic code and gain one `resolveTemplate` call.

### Scope setup becomes more explicit

Before, fork branches copy `outerScope.input` directly. After, they
resolve `branch.inputs` (like loops do today):

```typescript
// Before (fork branch):
const branchScope: ScopeContext = {
  input: outerScope.input, // direct passthrough
  constants: outerScope.constants,
  bindings: new Map(outerScope.bindings),
};

// After (fork branch):
const branchInput = resolveInputs(branch.inputs, outerScope);
const branchScope: ScopeContext = {
  input: branchInput, // explicit wiring
  constants: outerScope.constants,
  bindings: new Map(), // clean scope
};
```

This also fixes a current inconsistency: loop bodies start with empty
bindings (clean scope), but fork branches copy parent bindings. With
explicit `inputs`, all scopes start clean and receive only what they
declare.

## Impact on validator

The validator already has `validateScopeCFG()` as a shared function. A
new `validateWorkflowScope(scope: WorkflowScope, ...)` can wrap it with
additional checks:

- `scope.entry` exists in `scope.nodes`
- `scope.output` template references resolve within the scope
- `scope.outputSchema` is compatible with the resolved output type

Currently these checks are done ad-hoc at the top level and for loops.
With `WorkflowScope`, they apply uniformly to all scope types.

## Impact on emitter

The emitter's `childScope()` already builds something scope-like. The
change is that when emitting loop bodies, fork branches, and forkMap
bodies, the emitter must produce a complete `WorkflowScope` (including
`inputSchema`, `output`, `outputSchema`). Currently:

- Loop bodies: already produce these fields (they're on LoopNode, but
  the emitter generates them). Move into `body`.
- Fork branches: must add `output`, `outputSchema`, `inputSchema`.
  The output is the terminal node's bind reference. The emitter knows
  this at emit time.
- ForkMap bodies: same as fork branches.

## Impact on JSON format

This is a **breaking change** to the JSON IR format for loops, forks,
and forkMap nodes. Existing serialized IR will not match the new types.
Since the workflow system is pre-release, this is acceptable.

The top-level `WorkflowIR` format does not change (it already has all
the WorkflowScope fields).

## What this resolves

From the original implementation review:

| #   | Decision                                | Resolution                                                                                                                    |
| --- | --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| 0.2 | Fork branch output collection fallback  | Eliminated. Branches have explicit `output`.                                                                                  |
| 3.5 | Parallel branch names are synthetic     | Partially. Branch names still come from the emitter, but each branch now declares its output explicitly regardless of naming. |
| 3.6 | Parallel branches missing schema fields | Resolved. Branches must have full WorkflowScope.                                                                              |

## Design decisions

### 1. `inputs` is NOT part of WorkflowScope

**Decided.** The scope declares what it needs (`inputSchema`); the
embedding site provides values (`inputs`). WorkflowScope is a "function
definition"; inputs is "arguments at the call site."

### 2. ForkNode.branches uses wrapped `{ inputs, scope }` form

**Decided.** `branches: Record<string, { inputs, scope: WorkflowScope }>`.
The scope boundary is visible in JSON and `branch.scope` can be passed
directly to validation functions.

### 3. `captureOuterRefs` extends to all scope types

**Decided.** The emitter populates `branch.inputs` or `forkMapNode.inputs`
with captured outer references. Scope nodes use `$from: "input"` to
access them, matching how loops work today.
