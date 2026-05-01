# Workflow Engine Design: Loops, Data Flow, and Control Flow

Status: Draft v0.1 (iterating)

This document refines the workflow spec design (see [plan.md](plan.md)) for loops, data flow, and control flow, driven by the principles in [design-principles.md](design-principles.md). The current prototype allows flat-graph cycles but lacks static guarantees around data flow. This design replaces that approach with explicit loop constructs, scoped variables, and dominator-based validation.

## 1. Problem Statement

The current spec allows cycles in the flat node graph, but the data-flow model creates three classes of bugs:

1. **Forward references to unexecuted branches.** Node C references `nodes.B.output.x`, but B was on a branch that wasn't taken. Runtime throw.
2. **Backward references in loops (first iteration).** In a cycle `A -> B -> decide -> A`, if A references `nodes.B.output.x`, it fails on iteration 1 because B hasn't run yet.
3. **Stale cross-iteration reads.** Same scenario on iteration 2+: A silently reads B's previous-iteration output. This works but the intent is invisible and unverifiable.

Pipeline mode (omitting `inputMap`) adds further problems: ambiguous data flow after branch merges, inability to validate statically, and dual input patterns that reduce LLM authorability.

## 2. Design Goals (Priority Order)

1. **Static verifiability** - catch LLM-authored errors at load time. Schema validation for all data flow. Prove that every path reference will resolve at runtime.
2. **LLM authorability** - uniform patterns. The DSL authors the IR, so the IR optimizes for machine verifiability over human readability. Fewer special cases = fewer generation errors.
3. **Determinism** - given the same inputs and task implementations, execution and data flow are fully determined.
4. **Expressiveness** - encode retry loops, accumulator patterns, nested iteration, fan-in, conditional state.
5. **Debuggability** - explicit intent, clear data provenance, per-loop tracing.
6. **Composability / Testability** - loop bodies testable in isolation, reusable across workflows.
7. **Implementation complexity** - only matters relative to what it buys.
8. **Authoring simplicity** - DSL handles ergonomics; IR can be verbose.

## 3. Design Dimensions and Decisions

We evaluated 9 design dimensions with multiple options each. The chosen configuration optimizes for static verifiability, expressiveness, and uniform structure. Full analysis is in [Appendix A](#appendix-a-design-dimension-analysis).

| Dimension                       | Decision                                                                                | Rationale                                                                    |
| ------------------------------- | --------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| 1. Loop representation          | **Explicit `LoopNode`** wrapping a subgraph                                             | Enables scope-based validation; eliminates cycle-detection heuristics        |
| 2. Data flow mechanism          | **Explicit `inputMap` only** (no pipeline mode)                                         | One mechanism, fully validatable. Pipeline mode is ambiguous at merge points |
| 3. Loop exit mechanism          | **`@exit` sentinel** in `next`                                                          | Lightweight, no phantom nodes, validates like any edge target                |
| 4. Iteration decision           | **Task-driven branching** (`"done" -> @exit`, `"improve" -> body`)                      | Consistent with existing decision model; no new constructs                   |
| 5. Mutable state scope          | **Per-loop `loopVars`** with declared schemas and initial values                        | Statically verifiable, scoped, explicit intent                               |
| 6. Inter-iteration data passing | **`outputMap`** writes task outputs into loop variables                                 | Declarative, schema-checked, no mutation inside tasks                        |
| 7. Node reference validity      | **Dominator validation** (referenced node must dominate referencing node in same scope) | Proves reference will resolve on every path, not just some                   |
| 8. Cross-scope visibility       | **Loop body sees outer data only via `LoopNode.inputMap`**                              | Clean scope boundary; testable in isolation                                  |
| 9. Loop output mechanism        | **`outputMap`** maps loop variables to loop node output fields                          | Uniform with body outputMap; outer scope sees loop as a regular node         |

## 4. Spec Types

### 4.1 WorkflowSpec

```typescript
export interface WorkflowSpec {
  specVersion: number; // 1
  name: string;
  version: string;
  input: JSONSchema;
  output: JSONSchema;
  variables?: Record<string, unknown>; // read-only constants
  maxIterations?: number; // global safety limit (default: 1000)
  entry: string;
  nodes: Record<string, WorkflowNode>;
}
```

### 4.2 WorkflowNode (discriminated union)

```typescript
export type WorkflowNode = TaskNode | LoopNode;
```

### 4.3 TaskNode

```typescript
export interface TaskNode {
  kind: "task";
  task: string; // registered task name
  inputMap: Record<string, string>; // REQUIRED (no pipeline mode)
  next?: string | Record<string, string>; // linear or decision
  onError?: string;
}
```

### 4.4 LoopNode

```typescript
export interface LoopNode {
  kind: "loop";
  loopVars: Record<string, LoopVariable>; // scoped mutable state
  maxIterations?: number; // per-loop limit
  entry: string; // first node in loop body
  nodes: Record<string, LoopBodyNode>; // the loop subgraph
  inputMap: Record<string, string>; // resolves in OUTER scope
  outputMap: Record<string, string>; // maps loopVars -> loop node output fields
  next?: string | Record<string, string>; // where to go after loop exits
  onError?: string; // handles loop-level failures
}
```

### 4.5 LoopBodyNode

```typescript
export interface LoopBodyNode {
  kind: "task";
  task: string;
  inputMap: Record<string, string>;
  next?: string | Record<string, string> | "@exit";
  onError?: string | "@exit";
  outputMap?: Record<string, string>; // write task output fields to loopVars
}
```

### 4.6 LoopVariable

```typescript
export interface LoopVariable {
  initial: unknown; // value for first iteration
  schema: JSONSchema; // validates reads and writes
}
```

### 4.7 JSONSchema (unchanged)

```typescript
export type JSONSchema = Record<string, unknown>;
```

## 5. Path Resolution

All data flow uses `inputMap`: a flat dictionary mapping input field names to dot-path strings. The available path prefixes depend on the node's scope.

### 5.1 Top-level nodes (in `WorkflowSpec.nodes`)

| Prefix                | Source             | Mutable | Example                   |
| --------------------- | ------------------ | ------- | ------------------------- |
| `input.*`             | Workflow input     | No      | `input.topic`             |
| `variables.*`         | Workflow constants | No      | `variables.maxRetries`    |
| `nodes.<id>.output.*` | Prior node output  | No      | `nodes.fetch.output.body` |

A `nodes.<id>.output.*` reference is valid only if node `<id>` **dominates** the referencing node in the control-flow graph of the same scope. This guarantees the referenced node has executed on every possible path to the referencing node.

### 5.2 Loop body nodes (in `LoopNode.nodes`)

| Prefix                | Source                         | Mutable             | Example                   |
| --------------------- | ------------------------------ | ------------------- | ------------------------- |
| `input.*`             | Loop's resolved inputMap       | No                  | `input.topic`             |
| `variables.*`         | Workflow constants (inherited) | No                  | `variables.style`         |
| `nodes.<id>.output.*` | Prior node in loop body        | No                  | `nodes.write.output.text` |
| `loopVars.*`          | Loop-scoped variables          | Yes (via outputMap) | `loopVars.draft`          |

The loop body's `input.*` namespace is populated by resolving the `LoopNode.inputMap` in the outer scope. This is the only channel for outer data into the loop body.

### 5.3 LoopNode.inputMap

Resolves in the **outer** scope. Same rules as top-level nodes: `input.*`, `variables.*`, `nodes.<id>.output.*`.

### 5.4 LoopNode.outputMap

Maps output field names to `loopVars.<name>` paths. These define what the loop node "returns" to the outer scope.

```json
"outputMap": {
    "article": "loopVars.draft",
    "attempts": "loopVars.attempt"
}
```

### 5.5 LoopBodyNode.outputMap

Maps task output field names to `loopVars.<name>` paths. Executed after each task, writes results into loop variables for the next iteration.

```json
"outputMap": {
    "text": "loopVars.draft",
    "feedback": "loopVars.feedback"
}
```

## 6. Control Flow

### 6.1 Linear flow

A `TaskNode` with `next: "someNode"` proceeds unconditionally to `someNode`.

### 6.2 Decision branching

A `TaskNode` with `next: { "high": "publish", "low": "retry" }` uses the task's returned branch label to select the next node. The task must declare `branchLabels` and every label must appear in `next`.

### 6.3 Loop entry and iteration

A `LoopNode` is entered like any other node. On entry:

1. Resolve `LoopNode.inputMap` in the outer scope. This becomes the loop body's `input.*` namespace.
2. Initialize all loop variables from their `initial` values.
3. Begin executing at `LoopNode.entry`.
4. Execute body nodes following `next` edges.
5. After each successful body task:
   - If the node has `outputMap`, extract named fields from task output and write to corresponding loop variables. Validate each write against the variable's schema.
   - Store the node's output in the body's `nodeOutputs` map.
6. When iteration completes (reaches the end of a body path without `@exit`), the body re-enters at `LoopNode.entry` for the next iteration.

Wait - this is wrong. There's no implicit re-entry. See section 6.4.

### 6.4 Loop exit (`@exit`)

The **only** way to exit a loop is via `@exit`:

- A body node's `next` resolves to `"@exit"` (linear or decision branch target).
- A body node's `onError` is `"@exit"`.

On `@exit`:

1. Resolve `LoopNode.outputMap` from current loop variable values.
2. This becomes the loop node's "output" (accessible as `nodes.<loopId>.output.*` in the outer scope).
3. Proceed to `LoopNode.next` in the outer scope.

**There is no implicit iteration.** Every path through the loop body must either:

- Circle back to a previously-visited body node (explicit back-edge creating the loop), OR
- Reach `@exit` to leave.

This means iteration happens because body nodes form a cycle (e.g., `write -> evaluate -> write`), with a decision node branching to `@exit` when done. The cycle is within the body's flat graph, not implicit.

### 6.5 Loop termination safety

- **`maxIterations`** on the `LoopNode` (or the global `WorkflowSpec.maxIterations`) caps total body node executions. Exceeding it fails the loop.
- **Exit-path validation** (static): every path from the loop entry must be able to reach `@exit`. A body graph with no path to `@exit` is rejected at validation time.

### 6.6 Error handling in loops

| Scenario                                       | Behavior                                                                    |
| ---------------------------------------------- | --------------------------------------------------------------------------- |
| Body node fails, has `onError: "recoveryNode"` | Execution continues at `recoveryNode` within the loop body                  |
| Body node fails, has `onError: "@exit"`        | Loop exits with failure; triggers `LoopNode.onError` in outer scope         |
| Body node fails, no `onError`                  | Error bubbles up; triggers `LoopNode.onError` in outer scope (or run fails) |
| `maxIterations` exceeded                       | Loop fails; triggers `LoopNode.onError` in outer scope (or run fails)       |

### 6.7 Terminal nodes

A node with no `next` (and not inside a loop body that needs to cycle) is a terminal node. In the top-level scope, this means the workflow ends. In a loop body, a terminal node without `@exit` would be a validation error (unreachable `@exit`... but actually, let's think about this more carefully).

**Clarification needed:** In a loop body, can a node omit `next`? If so, what happens? Options:

- **(a)** Validation error: every body node must have `next` (or be `@exit`).
- **(b)** Implicit `@exit`: omitting `next` in a body node means exit the loop.
- **(c)** Implicit re-entry: omitting `next` in a body node means go back to `entry`.

Proposed: **(a)** - validation error. Explicit is better. The node must declare either `next: "someNode"`, `next: { ... }`, or `next: "@exit"`.

## 7. Example: Retry-with-Feedback Loop

```json
{
  "specVersion": 1,
  "name": "write-with-feedback",
  "version": "1",
  "input": {
    "type": "object",
    "properties": { "topic": { "type": "string" } },
    "required": ["topic"]
  },
  "output": {
    "type": "object",
    "properties": { "article": { "type": "string" } }
  },
  "variables": { "style": "concise" },
  "entry": "writeLoop",
  "nodes": {
    "writeLoop": {
      "kind": "loop",
      "loopVars": {
        "draft": { "initial": "", "schema": { "type": "string" } },
        "feedback": {
          "initial": "Write a first draft.",
          "schema": { "type": "string" }
        },
        "attempt": { "initial": 0, "schema": { "type": "number" } }
      },
      "maxIterations": 5,
      "entry": "write",
      "inputMap": {
        "topic": "input.topic",
        "style": "variables.style"
      },
      "nodes": {
        "write": {
          "kind": "task",
          "task": "llm.generate",
          "inputMap": {
            "prompt": "loopVars.feedback",
            "topic": "input.topic",
            "style": "input.style",
            "priorDraft": "loopVars.draft"
          },
          "outputMap": { "text": "loopVars.draft" },
          "next": "evaluate"
        },
        "evaluate": {
          "kind": "task",
          "task": "llm.evaluate",
          "inputMap": {
            "draft": "nodes.write.output.text",
            "topic": "input.topic"
          },
          "outputMap": { "feedback": "loopVars.feedback" },
          "next": { "improve": "increment", "done": "@exit" }
        },
        "increment": {
          "kind": "task",
          "task": "counter.increment",
          "inputMap": { "value": "loopVars.attempt" },
          "outputMap": { "value": "loopVars.attempt" },
          "next": "write"
        }
      },
      "outputMap": {
        "article": "loopVars.draft"
      },
      "next": "publish"
    },
    "publish": {
      "kind": "task",
      "task": "publish",
      "inputMap": {
        "article": "nodes.writeLoop.output.article"
      }
    }
  }
}
```

**Data flow trace (iteration 1):**

1. `writeLoop` entered. `inputMap` resolved: `topic` from workflow input, `style` from variables.
2. `loopVars` initialized: `draft=""`, `feedback="Write a first draft."`, `attempt=0`.
3. `write` executes with `prompt=loopVars.feedback`, `topic=input.topic`, etc.
4. `write.outputMap` fires: `loopVars.draft = write.output.text`.
5. `evaluate` executes with `draft=nodes.write.output.text` (dominator-valid: `write` dominates `evaluate`).
6. `evaluate.outputMap` fires: `loopVars.feedback = evaluate.output.feedback`.
7. `evaluate` returns `branch: "improve"` -> next is `increment`.
8. `increment` executes, `outputMap` writes `loopVars.attempt = 1`.
9. `increment.next` is `write` -> back to step 3 (iteration 2).

**Data flow trace (final iteration):** 10. `evaluate` returns `branch: "done"` -> next is `@exit`. 11. `writeLoop.outputMap` resolves: `article = loopVars.draft`. 12. Outer scope: `publish` reads `nodes.writeLoop.output.article`.

## 8. Validation Rules

### 8.1 Structural validation

| #   | Rule                                                                                                    |
| --- | ------------------------------------------------------------------------------------------------------- |
| S1  | `specVersion` must be 1.                                                                                |
| S2  | `entry` must exist in top-level `nodes`.                                                                |
| S3  | Every `LoopNode.entry` must exist in its `LoopNode.nodes`.                                              |
| S4  | All `next` string targets must reference existing sibling nodes (or `"@exit"` inside loop bodies).      |
| S5  | All decision `next` map values must reference existing sibling nodes (or `"@exit"` inside loop bodies). |
| S6  | All `onError` targets must reference existing sibling nodes (or `"@exit"` inside loop bodies).          |
| S7  | Every node must have `kind: "task"` or `kind: "loop"`.                                                  |
| S8  | Every `TaskNode` and `LoopBodyNode` must have `inputMap`.                                               |
| S9  | In loop bodies, every node must have `next` (no implicit terminal nodes).                               |

### 8.2 Data-flow validation

| #   | Rule                                                                                                                                   |
| --- | -------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | All `inputMap` path values must have valid prefixes for their scope.                                                                   |
| D2  | `input.*` paths must be traversable against the applicable input schema (workflow input for top-level; loop inputMap output for body). |
| D3  | `variables.*` paths must be traversable against `spec.variables`.                                                                      |
| D4  | `nodes.<id>.output.*` paths: referenced node must exist in the same scope AND dominate the referencing node.                           |
| D5  | `loopVars.*` paths: only valid inside loop body nodes. Referenced variable must exist in the containing loop's `loopVars`.             |
| D6  | `LoopBodyNode.outputMap` keys must be valid task output fields; values must be `loopVars.<name>`.                                      |
| D7  | `LoopNode.outputMap` values must be `loopVars.<name>` in the loop's own variables.                                                     |
| D8  | `LoopNode.inputMap` paths resolve in outer scope (same rules as top-level nodes).                                                      |

### 8.3 Schema validation

| #   | Rule                                                              |
| --- | ----------------------------------------------------------------- |
| V1  | Workflow `input` and `output` must be valid JSON Schema.          |
| V2  | Each `LoopVariable.initial` must validate against its `schema`.   |
| V3  | Each `LoopVariable.schema` must be valid JSON Schema.             |
| V4  | Task `inputSchema`/`outputSchema` validated at registration time. |

### 8.4 Graph validation

| #   | Rule                                                                                                                           |
| --- | ------------------------------------------------------------------------------------------------------------------------------ |
| G1  | **Reachability:** every node must be reachable from its scope's entry (via `next` and `onError` edges; `@exit` is a terminal). |
| G2  | **Exit-path:** within a loop body, every node must have a path to `@exit` (ensures the loop can terminate).                    |
| G3  | **Dominator computation:** per-scope (top-level and each loop body independently).                                             |

### 8.5 Branch validation (requires task registry)

| #   | Rule                                                                                                                       |
| --- | -------------------------------------------------------------------------------------------------------------------------- |
| B1  | Decision nodes: task's `branchLabels` must have matching keys in `next`.                                                   |
| B2  | Non-decision tasks must have linear `next` (string, `"@exit"`, or omitted in top-level; string or `"@exit"` in loop body). |
| B3  | `@exit` as a branch target is only valid in loop body nodes.                                                               |

## 9. Dominator Computation

Dominators determine which nodes are guaranteed to have executed before a given node, on every possible execution path. This is the foundation for validating `nodes.<id>.output.*` references.

### 9.1 Algorithm

For each scope (top-level and each loop body), compute immediate dominators using the iterative algorithm:

1. Build predecessor map from `next` edges only (exclude `onError` - error paths are exceptional, not guaranteed).
2. For decision nodes, all branch targets get the decision node as a predecessor.
3. Initialize: `dom(entry) = {entry}`, `dom(n) = all_nodes` for all other nodes.
4. Iterate until fixed point:
   ```
   for each node n != entry:
       dom(n) = {n} ∪ ⋂{ dom(p) | p ∈ predecessors(n) }
   ```
5. Extract immediate dominator: `idom(n) = dom(n) \ {n}` (the closest strict dominator).

### 9.2 Usage in validation

For rule D4: `nodes.X.output.*` in node Y's `inputMap` is valid if and only if X is in `dom(Y)` (i.e., X dominates Y in the same scope).

### 9.3 Why exclude `onError` from dominators

`onError` edges represent exceptional control flow. A node reached only via `onError` is not guaranteed to execute on the normal path. Including `onError` edges would weaken dominator guarantees (a node that dominates via error path doesn't dominate via normal path). Error handler nodes can still reference other nodes, but their references are validated against the dominator tree that excludes error edges.

**Open question:** Should error handler nodes have their own dominator scope, or share the same scope but with relaxed constraints? For now, they share the scope and references are validated normally (the error handler must be dominated by the nodes it references, which may limit what it can access).

## 10. Execution Semantics (Engine)

### 10.1 Top-level execution

1. Validate workflow input against `spec.input` schema.
2. Start at `spec.entry`.
3. For each node: resolve `inputMap`, validate input, execute task, validate output, store in `nodeOutputs`, follow `next`.
4. Terminal node (no `next`): run completes.

### 10.2 Loop execution

When the engine encounters a `LoopNode`:

1. **Resolve inputMap** in the outer scope. Result becomes the body's `input.*` namespace.
2. **Initialize loopVars** from each variable's `initial` value.
3. **Clear body nodeOutputs** (fresh scope).
4. **Execute body** starting at `LoopNode.entry`:
   - For each body node: resolve `inputMap` (in body scope), execute task, apply `outputMap` if present (validate writes against variable schemas), store output in body `nodeOutputs`, follow `next`.
   - If `next` resolves to a body node, continue.
   - If `next` resolves to `"@exit"`, go to step 5.
   - If a body node fails:
     - `onError: "bodyNode"` -> continue at that body node.
     - `onError: "@exit"` -> go to step 6.
     - No `onError` -> go to step 6.
5. **Normal exit:** resolve `LoopNode.outputMap` from loopVars. Store as loop node's output in outer `nodeOutputs`. Follow `LoopNode.next`.
6. **Error exit:** the loop node fails. If `LoopNode.onError` exists, continue there in the outer scope. Otherwise, run fails.

### 10.3 Iteration counting

Each body node execution increments a per-loop iteration counter. When the counter exceeds `LoopNode.maxIterations` (or `spec.maxIterations` if not set on the loop), the loop fails (step 6).

### 10.4 Body nodeOutputs across iterations

When a body node re-executes (due to back-edge), its output **overwrites** the previous value in the body's `nodeOutputs`. Combined with dominator validation, this is safe: if node Y references `nodes.X.output.*` and X dominates Y, then X has executed before Y in the current iteration.

**Note:** On iteration 2+, a node at the loop entry will execute with the body's `nodeOutputs` still containing values from the previous iteration for nodes that haven't re-executed yet. But dominator validation ensures Y only references nodes that dominate it - which means those nodes execute before Y in every iteration. So stale reads cannot occur.

Wait - this needs more careful analysis for body graphs with branches. Consider:

```
entry: A
A -> decide -> {left: B, right: C}
B -> merge
C -> merge
merge -> A  (back-edge)
```

On iteration 1, if `decide` goes left, only A, decide, B, merge execute. C never runs. On iteration 2, if `decide` goes right, C runs and might reference `nodes.B.output.*`. B doesn't dominate C (they're siblings after a branch), so this reference would be rejected by D4. Good - the dominator check prevents this.

But what about `merge` referencing `nodes.B.output.*`? B doesn't dominate `merge` either (because C also flows into merge). So this would also be rejected. To use B's output at merge, B would need to write to a `loopVar` via `outputMap`, and merge reads from `loopVars.*`.

This is the correct behavior: **branches must communicate via loopVars, not via node output references.** Dominator validation enforces this naturally.

## 11. Event Extensions

New events for loop observability:

```typescript
| { kind: "loopStarted"; runId: string; nodeId: string; loopVars: Record<string, unknown> }
| { kind: "loopIterationCompleted"; runId: string; nodeId: string; iteration: number; loopVars: Record<string, unknown> }
| { kind: "loopExited"; runId: string; nodeId: string; iteration: number; loopVars: Record<string, unknown>; output: unknown }
| { kind: "loopFailed"; runId: string; nodeId: string; iteration: number; error: { message: string } }
```

Body nodes still emit `nodeStarted`/`nodeCompleted`/`nodeFailed` with the loop node id as a prefix (e.g., `writeLoop.write`).

## 12. Changes from Current Prototype

The current prototype (on the `workfloweng` branch) implements a flat-graph model with SCC-based cycle detection. This design replaces that approach:

- **`kind` discriminant** added to all nodes (`"task"` or `"loop"`).
- **`inputMap` required** on all task nodes (pipeline mode removed).
- **Flat-graph cycles replaced** by explicit `LoopNode` constructs.
- **Dominator validation** replaces the current "any prior node" reference model.
- **`loopVars` and `outputMap`** replace implicit `nodeOutputs` overwrite for cross-iteration data.

Existing tests for acyclic workflows will need `kind: "task"` and explicit `inputMap` added to each node. Tests for cyclic workflows will need to be restructured around `LoopNode`.

## 13. Implementation Phases

### Phase 1: Type changes

- Add `kind` discriminant to node types.
- Add `LoopNode`, `LoopBodyNode`, `LoopVariable` types to `workflowSpec.ts`.
- Make `inputMap` required on `TaskNode` and `LoopBodyNode`.
- Add `outputMap` to `LoopBodyNode` and `LoopNode`.
- Update exports.

**Files:** `workflowSpec.ts`, `index.ts`

### Phase 2: Validation

- Scope-aware validation (top-level vs loop body).
- Validate `loopVars.*` paths, `outputMap` targets, `@exit` references.
- Validate `LoopVariable.initial` against its schema.
- Implement `computeDominators()`.
- Add dominator check to `nodes.*` path validation (rule D4).
- Validate reachability and exit-paths within loop bodies (rules G1, G2).
- Remove pipeline-mode acceptance (require `inputMap`).

**Files:** `validate.ts`, new `dominators.ts`, `validate.spec.ts`

### Phase 3: Engine loop execution

- Handle `LoopNode` in runner's main loop.
- Scoped `nodeOutputs` and path resolution for loop bodies.
- Loop variable initialization, `outputMap` writes with schema validation.
- `@exit` handling (normal and error).
- Per-loop `maxIterations` enforcement.
- Emit loop events.

**Files:** `runner.ts`, `events.ts`, `engine.spec.ts`

### Phase 4: Nested loops (deferred)

- Allow `LoopNode` inside `LoopNode.nodes`.
- Recursive validation and execution.
- Scope chain for `variables.*` (inherited from outer scopes).
- Not needed for initial ship.

## 14. Open Questions

### Q1: Back-edges within loop body

A loop body can contain internal cycles (e.g., `A -> B -> A` inside a loop body). Should Phase 1-3 reject these and require flat loop bodies? Supporting them is equivalent to ad-hoc nested loops without the explicit `LoopNode` structure.

**Proposal:** Reject in Phase 1-3. Require that loop body subgraphs are DAGs (plus the implicit back-edge from iteration). This simplifies dominator computation and exit-path analysis. Phase 4 adds nested `LoopNode`s for cases that need inner loops.

### Q2: Loop variable nested access

Should `loopVars.config.retryCount` work (traversing into a JSON object stored in a loop variable)? Yes, for consistency with other path prefixes. But this means `outputMap` writes to `loopVars.config` replace the entire object, not merge. Deep-path writes (`loopVars.config.retryCount = 5`) would require a different mechanism.

**Proposal:** Support read traversal (`loopVars.config.retryCount` in `inputMap`). `outputMap` writes to the top-level variable name only (`loopVars.config`). Deep writes deferred.

### Q3: Loop output schema

The `outputMap` maps field names to `loopVars.*`. The effective output schema is derivable from the variable schemas. Should we require an explicit `outputSchema` on the loop node?

**Proposal:** Infer from `outputMap` + variable schemas for now. This avoids redundancy. Add explicit `outputSchema` later if inference proves insufficient.

### Q4: `onError: "@exit"` semantics

When a body node fails with `onError: "@exit"`, should the loop's `outputMap` still resolve (partial results), or should the loop output be empty/error-only?

**Proposal:** The loop fails (no output). `outputMap` is not resolved. The outer scope's `onError` handler receives the error. If the user wants partial results on error, they should catch the error within the loop body and branch to `@exit` normally.

### Q5: Body node omitting `next` vs explicit `@exit`

Section 6.7 proposes that every body node must have `next`. Should we allow `next` to be omitted as shorthand for `"@exit"`?

**Proposal:** No. Explicit is better. Require `next: "@exit"` to exit. This makes the exit intent visible and greppable.

### Q6: Decision node with all branches to `@exit`

```json
"next": { "done": "@exit", "abort": "@exit" }
```

Is this valid? Technically yes (both branches exit), but it's unusual. The loop would always exit after this node.

**Proposal:** Valid. No reason to reject it. The node is effectively a terminal node that always exits.

### Q7: LoopNode as a decision node

Can a `LoopNode` itself have `next` as a decision map? This would mean the loop's exit somehow produces a branch label.

**Proposal:** No. `LoopNode.next` is always a string (linear) or omitted (terminal). Decision semantics require a task returning a branch label, and loop nodes don't execute tasks directly. If you need branching after a loop, add a decision task node after the loop.

---

## Appendix A: Design Dimension Analysis

### Dimension 1: Loop Representation

| Option                           | Description                                  | Static Verifiability         | Complexity |
| -------------------------------- | -------------------------------------------- | ---------------------------- | ---------- |
| **(a) Flat graph + SCC**         | Current approach: cycles detected, validated | Weak (heuristic exit checks) | Low        |
| **(b) Explicit LoopNode** ✓      | Loop is a declared construct with scope      | Strong (scoped validation)   | Medium     |
| **(c) Implicit loop annotation** | Mark back-edges as "loop"                    | Moderate                     | Low-Medium |

**Chosen: (b).** Explicit structure enables scope-based validation, clean variable scoping, and testable loop bodies.

### Dimension 2: Data Flow Mechanism

| Option                      | Description        | Static Verifiability |
| --------------------------- | ------------------ | -------------------- |
| **(a) inputMap + pipeline** | Current: dual mode | Weak at merge points |
| **(b) inputMap only** ✓     | Single mechanism   | Strong               |
| **(c) Expression language** | Rich but complex   | Depends on language  |

**Chosen: (b).** One mechanism, fully validatable. Pipeline mode is ambiguous when branches merge.

### Dimension 3: Loop Exit Mechanism

| Option                            | Description                    |
| --------------------------------- | ------------------------------ |
| **(a) Phantom "exit" node**       | Explicit exit node in body     |
| **(b) `@exit` sentinel** ✓        | Special string value in `next` |
| **(c) Separate `exitWhen` field** | Declarative condition on loop  |

**Chosen: (b).** Lightweight, no phantom nodes. Validates like any edge target but recognized by the engine.

### Dimension 4: Iteration Decision Mechanism

| Option                            | Description                                      |
| --------------------------------- | ------------------------------------------------ |
| **(a) Task-driven branching** ✓   | Task returns branch label; one branch is `@exit` |
| **(b) Dedicated `loopCondition`** | Separate condition field on loop                 |
| **(c) Counter-based**             | Iterate N times                                  |

**Chosen: (a).** Consistent with existing decision model. No new constructs. The condition is encoded in a task.

### Dimension 5: Mutable State Scope

| Option                           | Description                        | Static Verifiability   |
| -------------------------------- | ---------------------------------- | ---------------------- |
| **(a) Global nodeOutputs**       | Current: overwrite on re-execution | Weak                   |
| **(b) Per-node accumulators**    | Each node has mutable slot         | Medium                 |
| **(c) Workflow-level variables** | Global mutables                    | Weak (scope too broad) |
| **(d) Per-loop `loopVars`** ✓    | Scoped, declared, schema'd         | Strong                 |

**Chosen: (d).** Scope matches lifetime. Schema validates reads and writes. Not visible outside the loop.

### Dimension 6: Inter-iteration Data Passing

| Option                          | Description                                 |
| ------------------------------- | ------------------------------------------- |
| **(a) `outputMap`** ✓           | Declarative: task output fields -> loopVars |
| **(b) Task writes directly**    | Task API mutation                           |
| **(c) Accumulator expressions** | Expression in spec                          |

**Chosen: (a).** Declarative, schema-checked, no mutation inside tasks. Tasks remain pure functions.

### Dimension 7: Node Reference Validity

| Option                    | Description                          | Guarantee                    |
| ------------------------- | ------------------------------------ | ---------------------------- |
| **(a) Any prior node**    | Current: hope it executed            | None                         |
| **(b) Predecessor check** | Must be on a path before             | Necessary but not sufficient |
| **(c) Dominator check** ✓ | Must dominate (execute on ALL paths) | Sufficient                   |

**Chosen: (c).** Guarantees the referenced node has executed regardless of which branch was taken.

### Dimension 8: Cross-scope Visibility

| Option                                   | Description                                               |
| ---------------------------------------- | --------------------------------------------------------- |
| **(a) Full visibility**                  | Body sees all outer nodes                                 |
| **(b) Explicit boundary**                | Body sees outer via `LoopNode.inputMap` only              |
| **(c) Inherited read-only + explicit** ✓ | Body inherits `variables.*`, gets outer data via inputMap |

**Chosen: (c).** Clean scope boundary. Constants are inherited (read-only). Dynamic data requires explicit wiring. Loop bodies are testable in isolation.

### Dimension 9: Loop Output

| Option                                    | Description                              |
| ----------------------------------------- | ---------------------------------------- |
| **(a) Last node output**                  | Loop output = last body node's output    |
| **(b) `outputMap`** ✓                     | Maps loopVars to loop node output fields |
| **(c) Explicit `outputSchema` + binding** | Declared schema + expression             |

**Chosen: (b).** Uniform with body `outputMap`. Outer scope sees the loop as a regular node with typed output.
