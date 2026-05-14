# Implementation Decisions - DSL v2 / IR v2

Decisions made during implementation that were not explicitly specified in
[dsl-v2.md](dsl/dsl-v2.md), [ir-v2.md](ir/ir-v2.md), or
[implementation-plan.md](implementation-plan.md). Organized by phase.

---

## Phase 0: IR Model + Engine

### 0.1 Fork execution uses real Promise concurrency

The plan said "start all branches (up to maxConcurrency), collect outputs
into keyed object, cancel-on-first-failure." The implementation uses
`Promise.race()` with a sliding window over a `Set<Promise<void>>`. This
means branches actually execute concurrently (interleaved at `await`
boundaries), not sequentially. This is correct behavior, but means task
execution ordering is non-deterministic when `maxConcurrency > 1`.

### 0.2 Fork branch output collection fallback

When a fork branch's terminal node has `bind`, the runner uses that binding
as the branch output. When it doesn't, the runner falls back to collecting
all new bindings the branch produced (bindings not in the outer scope). If
exactly one new binding exists, it unwraps it; otherwise it returns an object
of all new bindings. This heuristic was not specified.

### 0.3 ForkMap error handling has no `partial` injection

The plan said error handlers receive `error`, `trigger`, and `partial`
(completed iterations' outputs). The fork implementation passes `error`
into onError but does not inject `partial` (the array of completed results
so far). ForkMap similarly does not pass `partial`. Only the basic
`buildErrorObject()` is used.

### 0.4 Division by zero in math.divide

`math.divide` throws `EngineError("Division by zero")` when the right
operand is zero. This is a runtime error, not a special return value. The
plan just said `left / right (error on zero)` without specifying the
mechanism.

### 0.5 Comparison operators use JavaScript semantics

`compare.equals` uses strict equality (`===`), `compare.lessThan` uses `<`,
etc. This means comparisons follow JavaScript coercion rules for `<` / `>`
(which do coerce strings to numbers in some cases). The plan listed
implementations without specifying strictness for ordering operators.

### 0.6 bool.and / bool.or are not short-circuit

Both operands are resolved before the task executes (template resolution
happens at the IR level). This means `bool.and(expensive(), fallback())`
always evaluates both sides. True short-circuit would require a branch node,
not a task node. The plan didn't address this.

---

## Phase 1: Lexer + Parser

### 1.1 Operator precedence levels

The plan said "precedence climbing" but did not specify levels. The
implementation uses (lowest to highest):

1. `||` (logical or)
2. `&&` (logical and)
3. `==`, `!=`, `===`, `!==` (equality)
4. `<`, `>`, `<=`, `>=` (comparison)
5. `+`, `-` (additive)
6. `*`, `/`, `%` (multiplicative)
7. `!`, unary `-` (unary)
8. `.` (member access), `()` (call)

This matches JavaScript/TypeScript precedence. `?:` (ternary) is parsed as
a suffix of binary expressions at the lowest precedence level.

### 1.2 Built-in name detection happens at parse time

When the parser encounters a call expression, it checks the callee name
against a hard-coded set `{ retry, map, filter, parallel, parallelMap }`.
If matched, it produces the corresponding dedicated AST node (RetryNode,
MapNode, etc.) instead of a generic CallExpr. This means these names are
reserved - you cannot have a task called `retry` or `map`. The plan said
"built-ins are compiler directives" but didn't specify how ambiguity was
resolved.

### 1.3 Arrow function body: block vs expression

Arrow functions with `{ }` produce a block body (statements). Without `{ }`
they produce a single expression body. The parser decides based on whether
the next token is `{`. Both forms are accepted for all built-ins. The plan
mentioned `() => { body }` and `() => expr` but didn't specify disambiguation.

### 1.4 `break` is only allowed in switch arms

The parser rejects `break` outside of switch arms. It is not a general-purpose
statement. The plan mentioned this rule but the error message and detection
mechanism were implementation choices.

### 1.5 `==` and `!=` produce errors, not silent fallback

The lexer recognizes `==` and `!=` as tokens, then the parser rejects them
with an explicit error: "Use === instead of ==" / "Use !== instead of !=".
This was listed in the plan but the approach (lex then reject vs. reject
during lexing) was a choice. The current approach gives better error messages.

---

## Phase 2: Type Checker

### 2.1 `unknown` type is a universal compatible type

When the type checker cannot determine a type (e.g., a task with no output
schema, or an unresolvable dotted access), it produces `{ kind: "unknown" }`.
Unknown is compatible with all other types in assignments and operator checks.
This prevents cascading errors but means some type mismatches may slip through.
The plan mentioned `TypeInfo` with an `unknown` kind but didn't specify its
compatibility rules.

### 2.2 Integer vs number

The type checker treats `integer` and `number` as compatible (both are
numeric). A value declared as `integer` can be passed where `number` is
expected and vice versa. The type system does not track integer vs float
distinction beyond what JSON Schema provides.

### 2.3 Recursive workflow calls are not explicitly checked

When workflow A calls workflow B which calls workflow A, the type checker
does not detect infinite recursion. It resolves the return type by looking
up the called workflow's declared return type, not by analyzing the call
graph. Mutual recursion would type-check fine but would fail at runtime
(the emitter produces `workflow.<name>` task nodes, which would need to
be registered in the engine).

### 2.4 Array element type tracking

The type checker infers array element types from context:
- `map(coll, (item) => { ... })` - `item` gets the element type of `coll`
- `filter(coll, (item) => { ... })` - same
- Array literals are not supported in the DSL, so there's no array literal
  type inference

The plan listed "map/filter -> array<body type>" for return types but didn't
specify how element types propagate into the body scope.

### 2.5 Ternary arm type mismatch is an error

If the consequent and alternate of a ternary have different types, it's a
compile error. The plan listed this as a type error but didn't specify
whether a union type or an error was the right response. An error was chosen
for simplicity (no union types in the type system).

---

## Phase 3: Emitter

### 3.1 Retry runs body N times even on success (BUG)

The retry emitter produces: body tasks -> step_attempt -> compare(attempt
>= count) -> branch(true: @exit, false: @iterate). There is no early-exit
on first success. If `retry(3, ...)` and the body succeeds on attempt 0,
the loop increments attempt to 1, checks 1 >= 3 (false), and iterates
again. The body runs exactly `count` times before exiting on success.

Intended semantics: try once, retry up to N times on failure, exit on first
success. Actual semantics: run body N times regardless. On failure, the
loop's `onError` triggers and re-enters, but the attempt counter only
increments on the success path, so error retries don't consume attempts.

This means:
- Success path: body runs `count` times (wasteful, possibly wrong)
- Failure path: body retries indefinitely (attempt never increments on error),
  up to `maxIterations: 100` safety limit

### 3.2 maxIterations values are hard-coded

| Built-in | maxIterations | Rationale |
|----------|--------------|-----------|
| retry    | 100          | Safety limit for retry loops |
| map      | 10,000       | Allow large collections |
| filter   | 10,000       | Same as map |

The plan and spec did not specify these values. They are safety limits to
prevent infinite loops. If a workflow operates on a collection with 10,001
elements, the map silently stops at 10,000.

### 3.3 `noop` and `identity` tasks are not registered in the engine

The emitter produces two synthetic task types:

- **`noop`**: Used as merge nodes after switch/branch (a no-op convergence
  point). Emitted by `emitSwitch()`.
- **`identity`**: Used as passthrough nodes in ternary expressions when an
  arm is a literal value (wraps `{ value: literal }`). Emitted by
  `emitTernary()`.

Neither `noop` nor `identity` is registered in `builtinTasks.ts`. Any
workflow whose IR contains these nodes will fail at runtime with
`Task "noop" not found in registry` or `Task "identity" not found`.

This means: switch statements and ternary expressions with literal arms
currently compile but cannot execute. They would need `noop` and `identity`
to be registered as built-in tasks, or the emitter needs to avoid generating
them.

### 3.4 Sub-workflow calls emit as task nodes, not inlined

The plan (section 3.2) said `emitWorkflowCall(): inline the sub-workflow
body into the current scope.` The implementation does not inline. It emits
a `TaskNode` with `task: "workflow.<name>"` and empty schemas. The engine
would need a registered task (or a special case in the runner) to execute it.

This means sub-workflow calls currently compile but cannot execute without
engine support for `workflow.*` task resolution.

### 3.5 Parallel branch names are synthetic

The plan said "Names from destructuring bindings." The implementation uses
`branch_0`, `branch_1`, etc. (indexed by position), not the destructuring
variable names from `const [a, b] = parallel(...)`.

This means the fork node's output is keyed by `branch_0`, `branch_1`,
not by the user-visible variable names. The engine's fork output collection
uses these keys, so downstream code referencing `a` or `b` must map from
the destructuring position to the branch index.

### 3.6 Parallel branches don't have inputSchema/outputSchema/output/inputs

The plan references ir-v2.md which specifies that fork branches have the
same contract as loop bodies (inputs, inputSchema, entry, nodes, output,
outputSchema). The emitter only generates `{ entry, nodes }` for each
branch, omitting the schema and I/O fields. Validation may reject this if
it enforces the full branch sub-scope contract.

### 3.7 `captureOuterRefs` in-place rewrite

When a loop body (map, filter, retry, parallelMap) references an
outer-scope binding, the `captureOuterRefs` helper:
1. Scans all nodes in the body for `$from: "scope"` templates
2. Checks if the referenced name exists as a node in the body scope
3. If not (it's an outer reference), rewrites `$from` from `"scope"` to
   `"input"` in-place on the node object
4. Adds the reference as a loop input with its template value from the
   outer scope

This is a mutation-based approach. Alternative: create wrapper nodes or
use a separate reference resolution pass.

### 3.8 Filter uses a two-branch pattern

The filter emitter creates a branch node inside the loop body. The `true`
case appends the item to the accumulator; the `false` case uses a separate
`keep_results` identity node that passes the current results through
unchanged. Both branches write to different bind names, then `iterateState`
picks the appropriate one.

Actually: the filter's iterateState references the append node's bind name.
On the false branch (item filtered out), the results state variable doesn't
get updated because the append node doesn't execute. The state variable
retains its previous value via the loop's `iterateState` mechanism.

### 3.9 Ternary creates synthetic identity tasks for literals

When a ternary arm is a literal (e.g., `cond ? 42 : 0`), the emitter wraps
it in an `identity` task node because the branch node's `cases` and
`default` fields point to node IDs, not to literal values. A simpler
approach would be to emit a constant task or use the value directly, but
the IR's branch structure requires node references.

### 3.10 Throw emits error.fail with `next: undefined`

The `emitThrow` method creates an `error.fail` task node but does not
explicitly set `next: null`. The node's `next` is simply absent (undefined
in JS). This means the runner will stop execution at this node (no next
node to follow), which is correct behavior, but different from explicitly
signaling "this path terminates."

---

## Phase 4: Graph Extractor + Visualizer

### 4.1 Color assignments

| Group/Node kind | Color | Justification |
|----------------|-------|---------------|
| retry          | orange | "warning/retry" association |
| map            | indigo | Arbitrary |
| filter         | purple | Arbitrary |
| parallel       | teal | Arbitrary |
| parallelMap    | green-teal | Arbitrary |
| switch         | deep purple | Arbitrary |
| switch-case    | light gray | Subordinate to switch |
| switch-default | lighter gray | Subordinate to switch |
| operator       | light blue | Computation |
| branch         | yellow | Decision point |
| error          | red | Error/danger |
| workflowCall   | cyan | External reference |

No design spec for colors. These are aesthetic choices.

### 4.2 Dashed stroke for retry groups

The v1 visualizer used dashed borders for `catch` groups. Since v2 replaces
try/catch with retry, the dashed border was reassigned to retry groups.
This is a visual continuity choice, not specified.

### 4.3 Groups serve as edge sources

When `return retry(...)` or `const x = parallel(...)` produces a value,
the group ID appears as `edge.from` in the graph model. This means groups
and nodes share the same edge namespace. An alternative would be to create
an explicit "output" node for each group.

### 4.4 `extractReturn` calls `extractExprAsNode` before creating the return node

When a return statement wraps a built-in (e.g., `return retry(...)`), the
extractor first processes the expression as a node/group, then creates
the return node with an edge from the group. This means the built-in gets
its own visual group even when it's the only expression in the workflow.

### 4.5 Destructuring resolves via binding lookup

For `const [a, b] = parallel(...)`, the graph extractor looks up bindings
for dotted name expressions rather than calling `extractExprAsNode` (which
returns undefined for simple names). This avoids creating phantom nodes for
destructured variables.

---

## Phase 5: Migration + Cleanup

### 5.1 d8 retry exhaustion behavior changed

The v1 `d8-summarize-url.wf` had while/try/catch/if/continue/break with
`maxRetries = 2`. On exhaustion, it silently broke out of the loop, leaving
`pageContent` potentially unset. The v2 `retry(2, ...)` with no fallback
will throw a runtime error on exhaustion. This is a **behavioral change**.

### 5.2 d8 retry count may differ

The v1 had `maxRetries = 2` used in a manual retry loop with `attempt < maxRetries`
as the continue condition. This allowed 3 total attempts (initial + 2 retries).
The v2 `retry(2, ...)` has different semantics due to the bug in 3.1 above:
on success it runs the body exactly 2 times; on failure the behavior depends
on how onError interacts with the counter.

### 5.3 d1 return type narrowed

The v1 `d1-standup-prep.wf` had `return joined` where `joined` was the result
of `string.join()`. Since `string.join` returns `{text: string}`, not `string`,
the v2 uses `return joined.text` to match the declared `string` return type.
This is a correctness fix, not a semantic change.

### 5.4 Deprecation uses console.warn

`int.add` and `int.lessThan` log deprecation warnings via `console.warn`.
Could have used the `debug` package (project convention for tracing) or a
structured deprecation mechanism. `console.warn` was chosen for visibility.

### 5.5 Removed v1-only compiler tests entirely

Tests for `for..of` lowering and try/catch single-trigger compliance were
removed rather than rewritten as v2 equivalents. The v2 test suite has
equivalent coverage through map lowering and retry tests, but the specific
edge cases those v1 tests covered may not have direct v2 counterparts.

### 5.6 Added web.fetch to compiler test schemas

The v2 compiler tests needed a `web.fetch` schema for retry/if-else/parallel
test cases. This was added to the test's `TASK_SCHEMAS` map. Not part of
the plan.

### 5.7 Map compiler test skips validation

The "lowers map to a loop node" test compiles without the `VALIDATE` flag
because the test schemas don't include the infrastructure tasks (`list.elementAt`,
`list.append`, `math.add`, `compare.lessThan`, `list.length`) that the map
emitter generates. A proper test would include these schemas and validate.

---

## Summary of items that may need action

| # | Issue | Severity | Phase |
|---|-------|----------|-------|
| 1 | Retry runs body N times on success (3.1) | Bug | 3 |
| 2 | `noop` and `identity` not registered in engine (3.3) | Bug | 3 |
| 3 | Sub-workflow calls don't inline, need engine support (3.4) | Incomplete | 3 |
| 4 | Parallel branch names are synthetic, not from destructuring (3.5) | Design gap | 3 |
| 5 | Parallel branches missing inputSchema/outputSchema/inputs/output (3.6) | Possible validation failure | 3 |
| 6 | bool.and/bool.or not short-circuit (0.6) | Design limitation | 0 |
| 7 | Fork/ForkMap onError lacks `partial` injection (0.3) | Incomplete | 0 |
| 8 | d8 retry exhaustion now throws instead of silent fallthrough (5.1) | Behavioral change | 5 |
