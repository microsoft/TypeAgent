# Workflow IR - v0.2

Status: **Implemented.** ForkNode, ForkMapNode, and built-in tasks are live.

Extends [ir-v0.1.md](ir-v0.1.md). All v0.1 concepts, validation rules, and
execution semantics remain unchanged. v0.2 adds new node kinds and built-in
tasks required by the DSL compile target.

---

## 1. Scope of changes

v0.1 has 3 node kinds: `task`, `branch`, `loop`.
v0.2 adds 3 node kinds: `fork`, `forkMap`, `workflowCall`.
v0.2 adds built-in task namespaces: `compare`, `bool`, `math`, `error`, `list`.
v0.2 promotes the artifact to a multi-workflow shape: a top-level
`workflows: { [name]: WorkflowBody }` table and an `entry: string` field
naming the program entry. v0.1 single-workflow artifacts become
multi-workflow artifacts with one body keyed under the workflow's name.
No new `$from` namespaces (forkMap element is injected via `$from: "input"`).

No v0.1 schema, validation rule, or execution semantic is modified.

### 1.2 Version field

The top-level `version` field remains `"1"`. The v0.2 node kinds (`fork`,
`forkMap`) are additive: a v0.1-only engine that encounters them can reject
the IR at validation time (unrecognized `kind` value), which is the
correct failure mode. Bumping `version` to `"2"` would force v0.1 engines
to reject the entire IR even when it contains no v0.2 constructs. Since
the DSL emitter may produce v0.1-only IR for workflows that don't use
`parallel`/`parallelMap`, keeping `version: "1"` preserves compatibility.
If a future change modifies v0.1 semantics (rather than adding to them),
that change bumps the version.

### 1.1 Why two node kinds, not one

The original proposal was a single `fork` kind with two structural
shapes (fixed branches vs. collection-based), discriminated by which
sibling fields are present. This fails the §1.3.2 (uniformity) test:
`kind` is the IR's discriminant key, and overloading a single `kind`
value with two shapes depending on context is the same pattern the IR
spec rejects (see §1.3.2's split-candidate rule and the `stateWrites`
worked example in ir-v0.1.md).

The `$from` precedent does not apply. `$from` is a **key** whose
**value** discriminates; all values obey one behavioral rule
(single-assignment-per-frame, path-projected reads) parameterized by
frame lifetime. Fork's two shapes differ in fan-out structure (static
named branches vs. dynamic collection iteration), which are genuinely
different behavioral rules.

Two node kinds, each with one unambiguous shape, satisfy both §1.3.1
(each is justified by a scenario the other 4 kinds cannot express) and
§1.3.2 (one surface form per behavioral rule).

---

## 2. New node kinds

### 2.1 `fork` - fixed concurrent branches

Execute a fixed set of named branches concurrently. All branches must
complete before control advances to `next`. Each branch is a closed
sub-scope (same contract as loop bodies in v1).

```jsonc
{
  "kind": "fork",
  "branches": {
    "textAnalysis": {
      "inputs": {
        "doc": { "$from": "scope", "name": "document" },
      },
      "scope": {
        "inputSchema": {
          "type": "object",
          "properties": { "doc": { "type": "string" } },
          "required": ["doc"],
        },
        "entry": "analyze",
        "nodes": {
          "analyze": {
            "kind": "task",
            "task": "text.analyze",
            "inputs": { "text": { "$from": "input", "name": "doc" } },
            "inputSchema": {
              "type": "object",
              "properties": { "text": { "type": "string" } },
              "required": ["text"],
            },
            "outputSchema": { "$ref": "#/types/TextResult" },
            "next": null,
          },
        },
        "output": { "$from": "scope", "name": "analyze" },
        "outputSchema": { "$ref": "#/types/TextResult" },
      },
    },
    "imageAnalysis": {
      "inputs": {
        "doc": { "$from": "scope", "name": "document" },
      },
      "scope": {
        "inputSchema": {
          "type": "object",
          "properties": { "doc": { "type": "string" } },
          "required": ["doc"],
        },
        "entry": "analyze",
        "nodes": {
          "analyze": {
            "kind": "task",
            "task": "image.analyze",
            "inputs": { "text": { "$from": "input", "name": "doc" } },
            "inputSchema": {
              "type": "object",
              "properties": { "text": { "type": "string" } },
              "required": ["text"],
            },
            "outputSchema": { "$ref": "#/types/ImageResult" },
            "next": null,
          },
        },
        "output": { "$from": "scope", "name": "analyze" },
        "outputSchema": { "$ref": "#/types/ImageResult" },
      },
    },
  },
  "outputSchema": {
    "type": "object",
    "properties": {
      "textAnalysis": { "$ref": "#/types/TextResult" },
      "imageAnalysis": { "$ref": "#/types/ImageResult" },
    },
    "required": ["textAnalysis", "imageAnalysis"],
  },
  "next": "notify",
  "bind": "analysisResults",
}
```

**Fields:**

| Field            | Required | Description                                                                                                                                                                                                                                                                                                                                                                         |
| ---------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `kind`           | yes      | `"fork"`                                                                                                                                                                                                                                                                                                                                                                            |
| `branches`       | yes      | Map of branch name to branch object. Each branch object has `inputs` (templates resolved in the outer scope) and `scope` (a `WorkflowScope` with `inputSchema`, `entry`, `nodes`, `output`, `outputSchema` — the same contract as v1 loop bodies). The `scope` nesting is intentional: `WorkflowScope` is shared with loop bodies and the top-level workflow for type-system reuse. |
| `outputSchema`   | yes      | Schema of the fork's combined output. Object with one property per branch name.                                                                                                                                                                                                                                                                                                     |
| `maxConcurrency` | no       | Positive integer. Max concurrent branches. Engine queues excess in declaration order. Defaults to unbounded.                                                                                                                                                                                                                                                                        |
| `next`           | no       | Next node ID, or `null` / sentinel.                                                                                                                                                                                                                                                                                                                                                 |
| `onError`        | no       | Error handler node ID. Triggered if any branch fails. Handler receives `error` and empty `trigger`.                                                                                                                                                                                                                                                                                 |
| `bind`           | no       | Bound output name for scope visibility.                                                                                                                                                                                                                                                                                                                                             |

**Execution semantics:**

1. All branches start concurrently (up to `maxConcurrency` if specified;
   excess branches are queued and started as running branches complete).
   When `maxConcurrency > 1`, branch scheduling and completion order are
   intentionally undefined.
2. Each branch executes its sub-scope independently (no data flow between branches).
3. The fork completes when all branches complete.
4. The fork's output is an object keyed by branch name, each value resolved
   from that branch sub-scope's explicit `output` template.
   Branch outputs are not inferred from terminal bind names or by scanning
   branch-local bindings.
5. If any branch fails, remaining in-flight branches are cancelled and
   the error propagates immediately.
6. If `onError` is specified, the error handler runs. The handler receives
   a structured `error` object (code, message, source, task, node,
   scopePath) and an empty `trigger` (unlike task/loop error handlers,
   fork does not yet populate trigger with the failing branch's inputs).
7. If no `onError`, the error propagates to the enclosing scope.

**Validation rules (additive to v1):**

- Each branch sub-scope passes the same validation as v1 loop bodies (dominator, type compatibility, scope closure).
- `branches` must have at least 2 entries (single-branch fork is pointless; use a block scope or inline the nodes).
- Branch names must be valid identifiers and unique within the fork.
- `outputSchema` must have a property for every branch name, each compatible with that branch's `outputSchema`.
- No data references between branches (enforced by scope closure: each branch is a closed sub-scope).

### 2.2 `forkMap` - collection-based concurrent iteration

Execute a body concurrently for each element in a collection. All
iterations must complete before control advances to `next`. The body
is a closed sub-scope. Unlike `loop`, there is no `iterateState`
(iterations are independent by construction).

```jsonc
{
  "kind": "forkMap",
  "collection": { "$from": "scope", "name": "items" },
  "collectionSchema": {
    "type": "array",
    "items": { "$ref": "#/types/Item" },
  },
  "elementParam": "item",
  "body": {
    "inputs": {
      "item": { "$from": "input", "name": "item" },
    },
    "inputSchema": {
      "type": "object",
      "properties": { "item": { "$ref": "#/types/Item" } },
      "required": ["item"],
    },
    "entry": "process",
    "nodes": {
      "process": {
        "kind": "task",
        "task": "text.process",
        "inputs": { "text": { "$from": "input", "name": "item" } },
        "inputSchema": {
          "type": "object",
          "properties": { "text": { "$ref": "#/types/Item" } },
          "required": ["text"],
        },
        "outputSchema": { "$ref": "#/types/ProcessedItem" },
        "next": null,
      },
    },
    "output": { "$from": "scope", "name": "process" },
    "outputSchema": { "$ref": "#/types/ProcessedItem" },
  },
  "outputSchema": {
    "type": "array",
    "items": { "$ref": "#/types/ProcessedItem" },
  },
  "maxIterations": 1000, // optional; engine default 10,000
  "maxConcurrency": 5,
  "next": "aggregate",
  "bind": "processedItems",
}
```

**Fields:**

| Field              | Required | Description                                                                                                                                                                 |
| ------------------ | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `kind`             | yes      | `"forkMap"`                                                                                                                                                                 |
| `collection`       | yes      | Reference to the input collection (array).                                                                                                                                  |
| `collectionSchema` | yes      | JSON Schema for the collection. Must be `type: "array"`.                                                                                                                    |
| `elementParam`     | yes      | Name of the element input injected into each body instance. The engine binds the current element as an input field with this name; body nodes read it via `$from: "input"`. |
| `body`             | yes      | Sub-scope with the same contract as v1 loop bodies.                                                                                                                         |
| `outputSchema`     | yes      | Schema of the forkMap's output. Array whose items match the body's output schema.                                                                                           |
| `maxIterations`    | no       | Safety cap (same semantics as v1 loop's `maxIterations`). Engine default: 10,000.                                                                                           |
| `maxConcurrency`   | no       | Positive integer. Max concurrent iterations. Engine queues excess. Defaults to unbounded.                                                                                   |
| `next`             | no       | Next node ID, or `null` / sentinel.                                                                                                                                         |
| `onError`          | no       | Error handler node ID. Handler receives `error` and empty `trigger` (same contract as fork).                                                                                |
| `bind`             | no       | Bound output name for scope visibility.                                                                                                                                     |

**Execution semantics:**

1. The engine reads the collection and determines iteration count N.
2. N body instances start concurrently, each receiving one element.
3. The forkMap completes when all N instances complete.
4. The forkMap's output is an array of body outputs, preserving the order of the input collection.
5. If any iteration fails, remaining in-flight iterations are cancelled
   and the error propagates immediately. Error handling follows the same
   contract as `fork`: the `onError` handler receives a structured
   `error` object and an empty `trigger`.

**Key difference from `loop`:** No `iterateState`. Loop carries state from
iteration N to iteration N+1, which forces sequential execution. ForkMap
iterations are independent by construction, enabling true parallelism.

**Key difference from `fork`:** Fan-out is dynamic (determined by collection
length at runtime), not static (fixed branch names known at compile time).

**Validation rules (additive to v1):**

- `collectionSchema` must have `type: "array"`.
- Body sub-scope passes the same validation as v1 loop bodies.
- `elementParam` must be a valid identifier.
- `outputSchema` must have `type: "array"` with `items` compatible with the body's `outputSchema`.
- Body sub-scope must not reference `$from: "state"` (there is no state; this is not a loop).

---

### 2.3 `workflowCall` — sub-workflow invocation

Calls a workflow declared in the artifact's top-level `workflows` table.
Each call executes in an isolated child frame; errors propagate to the
calling node's `onError` target (if any) the same way task errors do.

**Shape:**

```json
{
    "kind": "workflowCall",
    "workflowRef": { "name": "<workflowName>", "source": "<optional file>" },
    "inputs": { "<paramName>": <ValueRef>, ... },
    "inputSchema": { ... },
    "outputSchema": { ... },
    "bind": "<optional binding name>",
    "next": "<optional node id>",
    "onError": "<optional node id>",
    "timeoutMs": <optional positive integer>
}
```

**Semantics:**

- `workflowRef.name` must reference an existing key in the artifact's
  top-level `workflows` table. `workflowRef.source` is an optional
  human-readable hint pointing to the source file the body came from;
  it is **not** used for resolution at runtime.
- A new frame is pushed for the call. The frame's input bindings are
  exactly the `inputs` map. The frame's output is the called workflow's
  return value, bound under `bind` in the caller's frame.
- The called workflow body is a `WorkflowBody` (see §2.4). It does not
  inherit visibility into the caller's locals; the only data crossing
  the frame boundary is `inputs` (in) and the body's return value (out).
- Errors thrown inside the body propagate to `onError` on the
  `workflowCall` node itself. If no `onError` is set, the error
  escapes to the caller's `onError`, and so on.
- `timeoutMs`, when set, aborts the call if its wall-clock duration
  exceeds the limit and triggers `onError` (or escapes if absent).

**Validation rules:**

- `workflowRef.name` must resolve in `workflows`.
- `inputs` must satisfy `inputSchema`; `inputSchema` must equal the
  target body's input schema.
- `outputSchema` must equal the target body's output schema.
- The call graph (workflows referencing workflows via `workflowCall`)
  must be acyclic. Recursion is statically rejected in v1; bounded
  recursion is captured in
  [`future/workflow-recursion.md`](./future/workflow-recursion.md).

### 2.4 `WorkflowBody` — artifact-level workflow definitions

The artifact gains a top-level `workflows: { [name]: WorkflowBody }`
table and an `entry: string` field naming the program-entry workflow.

```json
{
    "version": "1",
    "kind": "workflow",
    "entry": "main",
    "workflows": {
        "main": {
            "inputSchema": { ... },
            "outputSchema": { ... },
            "inputs": { ... },
            "nodes": { "n1": { ... }, ... },
            "entry": "n1",
            "output": { "$from": "n1" }
        },
        "helper": { ... }
    }
}
```

A `WorkflowBody` is the v0.1 sub-scope contract (`inputs`,
`inputSchema`, `entry`, `nodes`, `output`, `outputSchema`) — the same
shape used by loop bodies, fork branches, etc. The artifact-level
`entry` field names which workflow in the `workflows` table runs when
the artifact is executed.

**Validation rules:**

- `entry` must resolve in `workflows`.
- Every `workflowCall` node in every body must reference a key in
  `workflows`.
- Call graph must be acyclic (DFS over `workflowCall` nodes from
  `entry`).

---

## 3. New built-in tasks

DSL operators lower to task nodes. These task namespaces are
standard-library tasks available to the engine.

### 3.1 `compare` namespace

Equality tasks (`equals`, `notEquals`) accept any type and use JavaScript
strict equality (`===` / `!==`). No coercion occurs.

Ordering tasks (`lessThan`, `greaterThan`, `lessOrEqual`, `greaterOrEqual`)
accept `number` inputs and use the corresponding JavaScript operator.
Because inputs are restricted to `number`, string-to-number coercion
never applies. `NaN` comparisons follow IEEE 754: all ordering
comparisons involving `NaN` return `false` (including `NaN < NaN`).
`Infinity` comparisons work as expected (`Infinity > 5` is `true`).

| Task                     | Input schema                      | Output schema | Notes |
| ------------------------ | --------------------------------- | ------------- | ----- |
| `compare.equals`         | `{ left: T, right: T }`           | `boolean`     | `===` |
| `compare.notEquals`      | `{ left: T, right: T }`           | `boolean`     | `!==` |
| `compare.greaterThan`    | `{ left: number, right: number }` | `boolean`     | `>`   |
| `compare.lessThan`       | `{ left: number, right: number }` | `boolean`     | `<`   |
| `compare.greaterOrEqual` | `{ left: number, right: number }` | `boolean`     | `>=`  |
| `compare.lessOrEqual`    | `{ left: number, right: number }` | `boolean`     | `<=`  |

### 3.2 `bool` namespace

| Task       | Input schema         | Output schema | Notes      |
| ---------- | -------------------- | ------------- | ---------- |
| `bool.not` | `{ value: boolean }` | `boolean`     | `!` in DSL |

The DSL operators `&&` and `||` lower to **branch nodes** that implement
short-circuit evaluation. There are no `bool.and` or `bool.or` builtin
tasks: the branch structure ensures the right operand is only evaluated
when the left operand does not determine the result.

### 3.3 `math` namespace

All `math.*` tasks use JavaScript number semantics. `NaN` and `Infinity`
are valid output values. Division and modulo by zero produce `Infinity` or
`NaN` respectively, not task failures.

| Task            | Input schema                      | Output schema | Notes                                                   |
| --------------- | --------------------------------- | ------------- | ------------------------------------------------------- |
| `math.add`      | `{ left: number, right: number }` | `number`      | `+` in DSL                                              |
| `math.subtract` | `{ left: number, right: number }` | `number`      | `-` in DSL                                              |
| `math.multiply` | `{ left: number, right: number }` | `number`      | `*` in DSL                                              |
| `math.divide`   | `{ left: number, right: number }` | `number`      | `/` in DSL. Returns `Infinity` or `NaN` on zero divisor |
| `math.modulo`   | `{ left: number, right: number }` | `number`      | `%` in DSL. Returns `NaN` on zero divisor               |
| `math.negate`   | `{ value: number }`               | `number`      | Unary `-` in DSL                                        |
| `math.floor`    | `{ value: number }`               | `integer`     | `Math.floor()`. Use for integer conversion              |
| `math.round`    | `{ value: number }`               | `integer`     | `Math.round()`                                          |
| `math.ceil`     | `{ value: number }`               | `integer`     | `Math.ceil()`                                           |

### 3.4 `error` namespace

| Task         | Input schema     | Output schema | Notes                                           |
| ------------ | ---------------- | ------------- | ----------------------------------------------- |
| `error.fail` | `{ value: any }` | never         | Always fails with the input value as the error. |

`error.fail` is the IR representation of DSL `throw`. The engine
executes the task and produces a failure result containing `value`.
This triggers the enclosing scope's error propagation (v1 §3.8).
Primary use case: cleanup-then-rethrow in a retry fallback, where
the preceding cleanup task succeeds and the author wants to
explicitly fail with the original error.

#### Never-output convention

A task whose output schema is `{ "not": {} }` (the JSON Schema equivalent
of `never`) declares that it always fails and never produces a successful
output. The IR toolchain enforces this in two places:

1. **Validator (static):** A task node with `outputSchema: { "not": {} }`
   must not have a `next` field, a `bind` field, or an `onError` field.
   There is no successful path to follow, no output to bind, and no
   recovery to attempt (the failure is intentional).
2. **Runner (runtime):** If a task with `outputSchema: { "not": {} }`
   returns `kind: "ok"` instead of `kind: "fail"`, the engine throws an
   `EngineError`. This guards against a task implementation that violates
   its declared contract.

### 3.5 `list` namespace

| Task             | Input schema                    | Output schema | Notes                                                           |
| ---------------- | ------------------------------- | ------------- | --------------------------------------------------------------- |
| `list.length`    | `{ list: T[] }`                 | `integer`     | Returns the length of the list.                                 |
| `list.elementAt` | `{ list: T[], index: integer }` | `T`           | Returns the element at the given index. Fails if out of bounds. |
| `list.append`    | `{ list: T[], item: T }`        | `T[]`         | Returns a new array with item appended.                         |

`list.append` is used by the `filter` built-in's IR lowering. Inside
the loop body, a branch node checks the predicate result: the true
branch calls `list.append` to add the item to the output array;
the false branch skips. The accumulator is carried via `iterateState`
on the enclosing loop node.

### 3.6 Overlap with v1 standard library

v1 defined `int.lessThan` and `int.add`. These overlapped with
`compare.lessThan` and `math.add`.

Decision: `int.*` tasks have been fully removed from the codebase. The
emitter uses `math.add` and `compare.lessThan` for loop counter
infrastructure. The engine no longer registers `int.*` names. For integer
conversion, use `math.floor`, `math.round`, or `math.ceil`.

---

## 4. Relationship to post-v0.1 sketches

The [future/](future/) directory contains sketches for future IR
extensions. Their status relative to v0.2:

| Sketch                                            | v0.2 status                                                                                                                                            |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [foreach.md](future/foreach.md)                   | Superseded by `forkMap` for the parallel case. Sequential foreach remains a separate post-v0.2 concern (the `map` DSL built-in lowers to v0.1 `loop`). |
| [block-scope.md](future/block-scope.md)           | Independent of v0.2. Still planned for the future.                                                                                                     |
| [edge-scoped-bind.md](future/edge-scoped-bind.md) | Independent of v0.2. Still planned for the future.                                                                                                     |

---

## 5. Principle compliance summary

| Principle / lens            | fork      | forkMap   | Notes                                                                                                  |
| --------------------------- | --------- | --------- | ------------------------------------------------------------------------------------------------------ |
| §1.2 Explicit, no sugar     | Pass      | Pass      | Each declares exactly what runs in parallel. One way to express each construct.                        |
| §1.3.1 Minimization         | Justified | Justified | Neither can be expressed by existing 3 kinds without hiding parallelism (violating P3).                |
| §1.3.2 Uniformity           | Pass      | Pass      | Two kinds, two shapes, two behavioral rules. No overloading of `kind` values.                          |
| §1.4 Boundary closure       | Pass      | Pass      | Sub-scopes use same closed-scope contract as v1 loop bodies.                                           |
| P1 Static provability       | Pass      | Pass      | Schemas on all boundaries. References resolve statically within sub-scopes.                            |
| P2 Traceable data flow      | Pass      | Pass      | Data enters sub-scopes through declared inputs, exits through declared output.                         |
| P3 Structure = computation  | Strong    | Strong    | IR explicitly declares parallelism. Closes the v1 gap noted in §1.1.3 tensions table.                  |
| P4 Part without whole       | Pass      | Pass      | Each sub-scope validatable independently given boundary contract.                                      |
| P5 Reader predicts behavior | Strong    | Strong    | Reader sees `kind: "fork"` / `"forkMap"` and knows concurrent execution. No engine conventions needed. |

---

## 5.1 Observability

v0.2 extends the v0.1 event stream (§5.6) with fork/forkMap events:

- `forkStarted(scopePath, nodeId, branchNames)` - emitted when a fork node begins execution
- `forkCompleted(scopePath, nodeId, output)` - all branches finished successfully
- `forkFailed(scopePath, nodeId, error)` - a branch failed (after cancellation of remaining branches)
- `forkMapIterationStarted(scopePath, nodeId, index)` - one iteration begins
- `forkMapIterationCompleted(scopePath, nodeId, index, output)` - one iteration finished

ForkMap failure reuses `forkFailed`. All events include `runId` and `timestamp`
(same envelope as v0.1 events).

---

## 6. Open questions

1. ~~**Cancellation policy.** When one fork/forkMap branch fails, what happens
   to running branches?~~
   **Resolved:** Cancel remaining branches/iterations on first failure.
   Error handlers currently receive only the `error` object. `partial`
   (completed results from successful branches/iterations), `trigger`
   context, abort signals, and wait/fail-fast policies are not yet
   implemented and are deferred to a future iteration. If no `onError`,
   the error propagates. In either case, partial results from successful
   branches are discarded: the entire fork/forkMap fails.

2. ~~**Concurrency limits for forkMap.** Should the IR declare a max-concurrency
   hint (e.g., `"maxConcurrency": 5`)? Useful for rate-limited APIs.~~
   **Resolved:** `maxConcurrency` is an optional field on `forkMap`. Same
   pattern as `maxIterations`: a safety/resource limit declared in the IR,
   enforced by the engine. Defaults to unbounded if omitted.

3. ~~**`$from: "element"` vs. injecting into `input`.**~~
   **Resolved:** Use `$from: "input"`. The element is a read-only value
   injected once before the body executes, with no mutation or cross-iteration
   carry-forward. This is behaviorally identical to `$from: "input"`, unlike
   `$from: "state"` which has genuinely different rules (writable via
   `iterateState`, changes per iteration). Adding a dedicated namespace
   would be two surface forms for one behavioral rule (§1.3.2 collapse
   candidate). The engine injects the element as a field named by
   `elementParam` into the body's `inputs`; body nodes read it with
   `$from: "input"` like any other input.
