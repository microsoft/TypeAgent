# Workflow IR - v2

Status: **Design (planned).** Co-developed with [DSL v2](../dsl/dsl-v2.md).

Extends [ir-v1.md](ir-v1.md). All v1 concepts, validation rules, and
execution semantics remain unchanged. v2 adds new node kinds and built-in
tasks required by the DSL v2 compile target.

---

## 1. Scope of changes

v1 has 3 node kinds: `task`, `branch`, `loop`.
v2 adds 2 node kinds: `fork`, `forkMap`.
v2 adds built-in task namespaces: `compare`, `bool`, `math`, `error`, `list`.
No new `$from` namespaces (forkMap element is injected via `$from: "input"`).

No v1 schema, validation rule, or execution semantic is modified.

### 1.2 Version field

The top-level `version` field remains `"1"`. The v2 node kinds (`fork`,
`forkMap`) are additive: a v1-only engine that encounters them can reject
the IR at validation time (unrecognized `kind` value), which is the
correct failure mode. Bumping `version` to `"2"` would force v1 engines
to reject the entire IR even when it contains no v2 constructs. Since
the DSL emitter may produce v1-only IR for workflows that don't use
`parallel`/`parallelMap`, keeping `version: "1"` preserves compatibility.
If a future change modifies v1 semantics (rather than adding to them),
that change bumps the version.

### 1.1 Why two node kinds, not one

The original proposal was a single `fork` kind with two structural
shapes (fixed branches vs. collection-based), discriminated by which
sibling fields are present. This fails the §1.3.2 (uniformity) test:
`kind` is the IR's discriminant key, and overloading a single `kind`
value with two shapes depending on context is the same pattern the IR
spec rejects (see §1.3.2's split-candidate rule and the `stateWrites`
worked example in ir-v1.md).

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
    "imageAnalysis": {
      "inputs": {
        "doc": { "$from": "scope", "name": "document" },
      },
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

| Field            | Required | Description                                                                                                                                                   |
| ---------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `kind`           | yes      | `"fork"`                                                                                                                                                      |
| `branches`       | yes      | Map of branch name to sub-scope. Each sub-scope has the same contract as v1 loop bodies: `inputs`, `inputSchema`, `entry`, `nodes`, `output`, `outputSchema`. |
| `outputSchema`   | yes      | Schema of the fork's combined output. Object with one property per branch name.                                                                               |
| `maxConcurrency` | no       | Max concurrent branches. Engine queues excess in declaration order. Defaults to unbounded.                                                                    |
| `next`           | no       | Next node ID, or `null` / sentinel.                                                                                                                           |
| `onError`        | no       | Error handler node ID. Triggered if any branch fails. Handler receives `error`, `trigger`, and `partial` (completed branches' outputs).                       |
| `bind`           | no       | Bound output name for scope visibility.                                                                                                                       |

**Execution semantics:**

1. All branches start concurrently (up to `maxConcurrency` if specified;
   excess branches are queued and started as running branches complete).
2. Each branch executes its sub-scope independently (no data flow between branches).
3. The fork completes when all branches complete.
4. The fork's output is an object keyed by branch name, each value being that branch's output.
5. If any branch fails, the engine cancels remaining running branches.
6. If `onError` is specified, the error handler runs. The engine injects
   three fields into the handler's inputs (extending v1's `error` +
   `trigger` pattern): `error` (the failure value, same as v1 §3.8.1),
   `trigger` (the failing branch's inputs), and `partial` (an object
   keyed by branch name, containing completed branches' outputs; failed
   or cancelled branches are absent). The handler can return a
   substitute value or propagate the error.
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
  "maxIterations": 1000,
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
| `maxIterations`    | no       | Safety cap (same semantics as v1 loop's `maxIterations`).                                                                                                                   |
| `maxConcurrency`   | no       | Max concurrent iterations. Engine queues excess. Defaults to unbounded.                                                                                                     |
| `next`             | no       | Next node ID, or `null` / sentinel.                                                                                                                                         |
| `onError`          | no       | Error handler node ID. Handler receives `error`, `trigger`, and `partial` (completed iterations' outputs).                                                                  |
| `bind`             | no       | Bound output name for scope visibility.                                                                                                                                     |

**Execution semantics:**

1. The engine reads the collection and determines iteration count N.
2. N body instances start concurrently, each receiving one element.
3. The forkMap completes when all N instances complete.
4. The forkMap's output is an array of body outputs, preserving the order of the input collection.
5. If any iteration fails, the engine cancels remaining running
   iterations. Error handling follows the same rules as `fork`:
   `onError` handler receives `error`, `trigger`, and `partial` (an
   array of completed iterations' outputs, with `null` entries for
   failed/cancelled iterations, preserving index correspondence with
   the input collection).

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

## 3. New built-in tasks

DSL v2 operators lower to task nodes. These task namespaces are
standard-library tasks available to the engine.

### 3.1 `compare` namespace

| Task                     | Input schema                      | Output schema         | Notes                                  |
| ------------------------ | --------------------------------- | --------------------- | -------------------------------------- |
| `compare.equals`         | `{ left: T, right: T }`           | `{ result: boolean }` | `===` in DSL                           |
| `compare.notEquals`      | `{ left: T, right: T }`           | `{ result: boolean }` | `!==` in DSL                           |
| `compare.greaterThan`    | `{ left: number, right: number }` | `{ result: boolean }` | `>` in DSL                             |
| `compare.lessThan`       | `{ left: number, right: number }` | `{ result: boolean }` | `<` in DSL. Overlaps v1 `int.lessThan` |
| `compare.greaterOrEqual` | `{ left: number, right: number }` | `{ result: boolean }` | `>=` in DSL                            |
| `compare.lessOrEqual`    | `{ left: number, right: number }` | `{ result: boolean }` | `<=` in DSL                            |

### 3.2 `bool` namespace

| Task       | Input schema                        | Output schema         | Notes         |
| ---------- | ----------------------------------- | --------------------- | ------------- |
| `bool.and` | `{ left: boolean, right: boolean }` | `{ result: boolean }` | `&&` in DSL   |
| `bool.or`  | `{ left: boolean, right: boolean }` | `{ result: boolean }` | `\|\|` in DSL |
| `bool.not` | `{ value: boolean }`                | `{ result: boolean }` | `!` in DSL    |

### 3.3 `math` namespace

| Task            | Input schema                      | Output schema        | Notes                             |
| --------------- | --------------------------------- | -------------------- | --------------------------------- |
| `math.add`      | `{ left: number, right: number }` | `{ result: number }` | `+` in DSL. Overlaps v1 `int.add` |
| `math.subtract` | `{ left: number, right: number }` | `{ result: number }` | `-` in DSL                        |
| `math.multiply` | `{ left: number, right: number }` | `{ result: number }` | `*` in DSL                        |
| `math.divide`   | `{ left: number, right: number }` | `{ result: number }` | `/` in DSL                        |
| `math.modulo`   | `{ left: number, right: number }` | `{ result: number }` | `%` in DSL                        |

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

### 3.5 `list` namespace

| Task          | Input schema                 | Output schema     | Notes                                      |
| ------------- | ---------------------------- | ----------------- | ------------------------------------------ |
| `list.append` | `{ array: T[], element: T }` | `{ result: T[] }` | Returns a new array with element appended. |

`list.append` is used by the `filter` built-in's IR lowering. Inside
the loop body, a branch node checks the predicate result: the true
branch calls `list.append` to add the element to the output array;
the false branch skips. The accumulator is carried via `iterateState`
on the enclosing loop node.

### 3.6 Overlap with v1 standard library

v1 defines `int.lessThan` and `int.add`. These overlap with
`compare.lessThan` and `math.add`. Options:

1. **Deprecate `int.*` in favor of `compare.*` / `math.*`.** Cleaner namespacing.
2. **Keep both as aliases.** No breaking change, but two names for one thing (violates §1.2).
3. **Keep `int.*` for v1 IR, use `compare.*` / `math.*` for v2 IR.** Version-scoped.

Recommendation: option 1. The v1 emitter already generates these; updating
it to emit `compare.lessThan` and `math.add` instead is mechanical. The
engine registers both names during the transition period.

---

## 4. Relationship to post-v1 sketches

The [post-v1/](post-v1/) directory contains sketches for future IR
extensions. Their status relative to v2:

| Sketch                                             | v2 status                                                                                                                                           |
| -------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| [foreach.md](post-v1/foreach.md)                   | Superseded by `forkMap` for the parallel case. Sequential foreach remains a separate post-v2 concern (v2's `map` DSL built-in lowers to v1 `loop`). |
| [block-scope.md](post-v1/block-scope.md)           | Independent of v2. Still planned for post-v1/v2.                                                                                                    |
| [edge-scoped-bind.md](post-v1/edge-scoped-bind.md) | Independent of v2. Still planned for post-v1/v2.                                                                                                    |

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

## 6. Open questions

1. ~~**Cancellation policy.** When one fork/forkMap branch fails, what happens
   to running branches?~~
   **Resolved:** Cancel remaining branches/iterations on first failure.
   The `onError` handler determines what to do with partial results. The
   engine injects a `partial` field alongside `error` and `trigger`
   (extending v1's §3.8 pattern). For `fork`, `partial` is an object
   keyed by branch name (only completed branches present). For `forkMap`,
   `partial` is an array with `null` for failed/cancelled entries. If no
   `onError`, the error propagates and partial results are discarded.

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
