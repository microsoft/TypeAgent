# Implementation Decisions - DSL v2 / IR v2

Decisions made during implementation that were not explicitly specified in
[dsl-v2.md](dsl/dsl-v2.md), [ir-v2.md](ir/ir-v2.md), or
[implementation-plan.md](implementation-plan.md). Organized by phase.

This is a temporary reconciliation document. Once the relevant decisions are
folded back into the main spec and plan docs, this file should be deleted.

## Review Procedure

For each item in this file, review it in the following order:

1. Confirm the current reality: verify whether the item still matches the
   current code and tests, or whether later changes have already made it
   stale.
2. Classify the item: decide whether it is primarily:

- intended behavior that should be made explicit in the main spec/docs
- a bug or implementation gap that should be fixed in code
- a spec/implementation mismatch that needs a decision
- an intentional limitation or scope boundary to document
- technical debt or future work to track elsewhere

3. Consider alternatives: list the plausible options, including keeping the
   current behavior, changing implementation, or changing the spec.
4. Compare pros and cons: evaluate semantics, implementation complexity,
   user clarity, compatibility, and testing impact.
5. Decide the disposition: record what we want to do with the item in the
   Review Tracking table.
6. Capture the destination:

- if it is the intended long-term behavior, fold it into the main spec or
  plan docs
- if it is a bug or gap, create a fix task or issue
- if it is future work, track it outside this file
- if it is obsolete, remove it from this file

Goal for each item: end with a clear outcome, not just a description.

## Review Tracking

Use this table to record both how each item should be reviewed and what we
decide to do with it. The goal is to avoid losing track of whether an item
should become spec text, a code fix, a cleanup task, or an explicit open
question.

| Item | Review as                                                                                                                                            | Outcome                                                                                                                                                                                                                                                             |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0.1  | Specify current runtime semantics in main spec docs.                                                                                                 | Keep current behavior. Make the main spec explicit that parallel/fork scheduling order is undefined when `maxConcurrency > 1`.                                                                                                                                      |
| 0.2  | Decide whether this heuristic should be part of the runtime contract or replaced with explicit output rules.                                         | Replace stale heuristic note with the current explicit-output contract: fork branch output is resolved from `branch.scope.output` in branch scope.                                                                                                                  |
| 0.3  | Review as an implementation gap against the plan/spec. Decide whether to fix behavior or reduce the documented contract.                             | Option D: reduce spec to match current code (error only). Planned future: partial + trigger + abort signal + wait/fail-fast policy. See `ir/future/fork-error-partial-injection.md`.                                                                                |
| 0.4  | Specify the runtime error contract for divide-by-zero.                                                                                               | All math uses JS number semantics. Division/modulo by zero returns Infinity/NaN, not a task failure. `int.*` deprecated. Added `math.floor/round/ceil` for integer conversion.                                                                                      |
| 0.5  | Decide whether comparison semantics should intentionally follow JavaScript or become stricter/more explicit.                                         | Keep JS semantics. Ordering operators already restrict inputs to `number`, so string coercion is a non-issue. NaN/Infinity behavior documented in spec section 3.1.                                                                                                 |
| 0.6  | Decide whether non-short-circuit boolean tasks are an acceptable language limitation or need a separate control-flow form.                           | Lower `&&`/`                                                                                                                                                                                                                                                        |     | `to branch nodes for short-circuit evaluation. Remove`bool.and`/`bool.or` builtins. Validator extended with split-point phi coverage to accept bindings on all branch arms. |
| 1.1  | Specify parser precedence and associativity in the language docs.                                                                                    | Documented. 9 precedence levels (ternary lowest, member/call highest), all left-associative except ternary (right) and unary prefix (right). Only `===`/`!==` (no loose `==`/`!=`).                                                                                 |
| 1.2  | Decide whether parse-time builtin reservation is the intended language rule or whether naming should be made more explicit/less ambiguous.           | Keep parse-time detection. Reservation is narrow (only `name(` triggers it). Builtins need custom syntax parsing. Documented the scope of reservation.                                                                                                              |
| 1.3  | Specify the arrow-body disambiguation rule.                                                                                                          | Keep as-is. Standard JS/TS rule: `{` means block body, otherwise expression body (wrapped in synthetic ReturnStatement). No ambiguity.                                                                                                                              |
| 1.4  | Specify the restriction and confirm the error behavior is the one we want.                                                                           | Fixed. Parser tracks `inSwitchDepth` and rejects `break` outside switch arms with a diagnostic.                                                                                                                                                                     |
| 1.5  | Specify the error strategy for banned operators and confirm the diagnostic wording approach.                                                         | Keep as-is. Lexer rejects `==`/`!=` with clear diagnostic suggesting `===`/`!==`. No token emitted, so parser never sees them. Earliest-possible error.                                                                                                             |
| 2.1  | Decide the type system's treatment of `any`, `unknown`, and error recovery.                                                                          | Removed `any` from the DSL. `unknown` is the top type (TS semantics) for `{}` schemas. Error recovery uses internal `unresolved` type (not exposed). See dsl-v2.md section 2.14.                                                                                    |
| 2.2  | Specify numeric compatibility rules.                                                                                                                 | Keep as-is. `integer` and `number` are bidirectionally compatible (JS has one numeric type). `integer` preserved for JSON Schema fidelity. Document `integer` in dsl-v2 type table.                                                                                 |
| 2.3  | Review as an unsupported/runtime gap. Decide whether to detect this statically or document it as unsupported.                                        | Document as limitation. Recursion is unsupported (sub-workflows emit as unregistered tasks). No static cycle check needed now; once inlining lands, recursion is structurally blocked.                                                                              |
| 2.4  | Specify array-element type propagation rules.                                                                                                        | Keep as-is. Element types fully propagate: `map`/`parallelMap` extract element from collection, bind to callback param, return `array<body-type>`. `filter` preserves collection type.                                                                              |
| 2.5  | Decide whether ternary mismatches should stay as errors or grow into a union-type feature later.                                                     | Keep as-is. Arms must match types (error if not). No union types. Returns consequent type. Correct and intentional.                                                                                                                                                 |
| 3.1  | Review as a real implementation bug to fix, not a behavior to bless.                                                                                 | Fixed. Retry now exits on first success. Bug was already addressed before this review.                                                                                                                                                                              |
| 3.2  | Decide whether hard-coded iteration limits are acceptable and, if so, where they should be documented/configured.                                    | Removed from emitter. Engine provides default (10,000). IR `maxIterations` is optional; workflows can override per-node.                                                                                                                                            |
| 3.3  | Verify current status, since later work may already have resolved this. Then either remove it, rewrite it, or fold the final contract into the spec. | Fixed. Both `noop` and `identity` are now registered in `builtinTasks.ts` and exported in `allBuiltinTasks`.                                                                                                                                                        |
| 3.4  | Decide whether sub-workflows should inline or execute through an explicit runtime call contract.                                                     | Tracked in `dsl-v2-implementation-gap.md`. Removed from this doc.                                                                                                                                                                                                   |
| 3.5  | Decide whether branch naming is an internal detail or a user-visible contract that should match destructuring/source order semantics.                | Tracked in `dsl-v2-implementation-gap.md`. Removed from this doc.                                                                                                                                                                                                   |
| 3.6  | Review as a spec/implementation mismatch. Decide whether to expand emitted branch shape or relax the documented contract.                            | Tracked in `dsl-v2-implementation-gap.md`. Removed from this doc.                                                                                                                                                                                                   |
| 3.7  | Decide whether the in-place rewrite is an acceptable implementation detail or should be refactored before being relied on.                           | Keep as-is. Localized mutation in a single helper, runs before nodes are consumed. Internal lowering detail, not a spec concern.                                                                                                                                    |
| 3.8  | Verify current status against the latest emitter changes, then decide whether this remains a real issue or should be rewritten/removed.              | Rewritten. Description was stale. Both branches now normalize through identity nodes to a shared `updated_results` bind, using the same pattern as 3.12.                                                                                                            |
| 3.9  | Decide whether identity-wrapping is the intended lowering pattern for literal arms or whether the IR should grow a cleaner representation.           | Keep as-is. Branch targets must be node IDs; identity wrapping is the only correct lowering for literal arms. Both arms bind a shared result name and converge at a noop merge node.                                                                                |
| 3.10 | Specify whether implicit termination via missing `next` is the intended node contract.                                                               | Implemented never-output convention. `outputSchema: { "not": {} }` marks always-fail tasks. Validator rejects `next`/`bind`/`onError`. Runner asserts `kind: "fail"` at runtime.                                                                                    |
| 3.11 | Decide whether root-level identity wrapping is canonical lowering that belongs in the spec.                                                          | Keep as-is. This is canonical emitter lowering for literal-only workflows so the IR always has an executable entry node. Document as compiler/runtime contract, not user-facing syntax.                                                                             |
| 3.12 | Decide whether shared-bind normalization is the standard lowering rule for branch-produced values.                                                   | Keep as-is for v2. Shared-bind normalization is the current canonical lowering for branch-produced values. See `dsl-v2-implementation-gap.md` for the design-principles analysis and future merge / phi alternative.                                                |
| 3.13 | Specify loop semantics for `map`/`filter` as part of the emitted/runtime contract.                                                                   | Keep as-is. `map` and `filter` lower as pre-check loops: compare index vs length before entering the body, exit immediately on false, then increment and iterate after body work. This is the intended emitted/runtime contract for these builtins in v2.           |
| 3.14 | Decide whether integer builtins are the intentional long-term infrastructure for iteration.                                                          | Rewritten as stale. Current lowering uses `math.add` and `compare.lessThan`, not deprecated `int.*` builtins. Keep numeric loop infrastructure aligned with JS-number semantics; `integer` remains a type-level/schema distinction, not a separate arithmetic path. |
| 3.15 | Specify that output projection comes from canonical scope-ref lowering, not ad hoc ref construction.                                                 | Resolved. All scope-level output refs now derive single-property projection through the canonical `getAutoProjectPath` helper, including `scopeRef`, fork branch output, forkMap body output, and binding resolution for node refs. No ad hoc bypass remains.       |
| 3.16 | Decide whether `noop` / `identity` should be documented as required lowering primitives in the compiler/runtime contract.                            | Refer to `dsl-v2-implementation-gap.md` for the design-principles analysis. Current direction: keep `identity` as an accepted lowering primitive; if refined later, split literal materialization from merge normalization.                                         |
| 3.17 | Review as temporary technical debt. Keep coverage, but track validator work needed to remove the bypass.                                             | Confirmed as temporary technical debt. See `dsl-v2-implementation-gap.md` for the full analysis of which patterns fail and what the validator needs. Keep tests; fix validator.                                                                                     |
| 3.18 | Review as an explicit scope boundary. Decide whether to preserve current limits or plan later language expansion.                                    | Keep as intentional v2 scope boundary. See `dsl-v2-implementation-gap.md` for the specific limitations and potential future expansions. Tests were rewritten to stay within current limits.                                                                         |
| 5.1  | Review as a migration behavior change. Decide whether to accept it, mitigate it, or document it prominently.                                         | Accepted. v2 `retry(n, ...)` with no fallback throws on exhaustion. This is intentional and correct per dsl-v2.md section 3.1. The v1 silent-break behavior was a bug.                                                                                              |
| 5.2  | Revisit after retry semantics are fixed, then document the final migration story.                                                                    | No discrepancy. `retry(n, ...)` gives n total attempts; v1 `maxRetries = 2` with `nextAttempt < maxRetries` also gave 2 total attempts. The d8 `.wf` correctly uses `retry(2, ...)`. Integration tests confirm `retry(3, ...)` gives 3 attempts.                    |
| 5.3  | Confirm this is just a correctness fix and capture it in migration notes if needed.                                                                  | Confirmed as correctness fix. `return joined.text` narrows the output to match the declared `string` return type. No behavioral change; the v1 code was returning a wrapped object where a string was intended.                                                     |
| 5.4  | Decide on the deprecation signaling policy (`console.warn`, debug tracing, structured diagnostics, etc.).                                            | Stale. `int.add` and `int.lessThan` have been fully removed from the codebase. No deprecation signaling is needed because the deprecated tasks no longer exist.                                                                                                     |
| 5.5  | Decide whether equivalent v2 coverage is sufficient or whether some removed edge cases need to be restored explicitly.                               | Accepted. v2 test suite covers the same semantics through map/retry/branch tests. The removed v1 tests targeted `for..of` and try/catch patterns that no longer exist in the language.                                                                              |
| 5.6  | Review as test scaffolding cleanup/documentation, not core language design.                                                                          | Accepted. Adding `web.fetch` to test schemas is normal test scaffolding. Not a design concern.                                                                                                                                                                      |
| 5.7  | Decide whether to fix test schemas so validation can run, or explicitly accept this as a temporary validation gap.                                   | Accept as temporary gap. Adding infrastructure task schemas to the test setup would fix this. Related to G7 in `dsl-v2-implementation-gap.md` (validator convergence patterns).                                                                                     |

---

## Phase 0: IR Model + Engine

### 0.1 Fork execution uses real Promise concurrency

The plan said "start all branches (up to maxConcurrency), collect outputs
into keyed object, cancel-on-first-failure." The implementation uses
`Promise.race()` with a sliding window over a `Set<Promise<void>>`. This
means branches actually execute concurrently (interleaved at `await`
boundaries), not sequentially. We are keeping this behavior as the intended
default semantics.

Decision: fork/parallel branch scheduling order is intentionally undefined
when `maxConcurrency > 1`. Output association is deterministic, but branch
start/completion order is not. Users should not rely on relative timing of
side effects across parallel branches.

### 0.2 Fork branch output collection fallback

Current state: the old fallback heuristic is stale. The runner now resolves
fork branch output directly from each branch's explicit output template
(`branch.scope.output`) against the branch scope after execution.

Decision: keep explicit branch output resolution as the runtime contract.
Do not infer branch outputs from terminal bind names or from "new bindings"
discovery. This keeps branch output shape predictable and aligned with
branch scope declarations.

### 0.3 ForkMap error handling has no `partial` injection

The plan said error handlers receive `error`, `trigger`, and `partial`
(completed iterations' outputs). The fork implementation passes `error`
into onError but does not inject `partial` (the array of completed results
so far). ForkMap similarly does not pass `partial`. Only the basic
`buildErrorObject()` is used.

Decision: reduce spec to match current code. Error handlers currently
receive only the `error` object. Partial results, trigger context, abort
signals, and wait/fail-fast policies are deferred to a future iteration.
When a fork branch fails, the entire fork fails; partial results from
successful branches are not preserved or surfaced.

### 0.4 Arithmetic tasks use JavaScript number semantics

All `math.*` tasks use JavaScript number semantics. `NaN` and `Infinity`
are valid output values. Division and modulo by zero produce `Infinity`
or `NaN` respectively, not task failures.

`int.add` and `int.lessThan` are deprecated (retained temporarily for
emitter loop counter compatibility). Integer conversion is available via
`math.floor`, `math.round`, and `math.ceil`.

### 0.5 Comparison operators use JavaScript semantics

`compare.equals` uses strict equality (`===`), `compare.lessThan` uses `<`,
etc. Ordering operators restrict inputs to `number`, so JavaScript's
string-to-number coercion for `<` / `>` never applies. `NaN` comparisons
follow IEEE 754 (all return `false`). `Infinity` comparisons work as
expected. Equality operators accept any type and use strict comparison
(no coercion). This is consistent with the 0.4 JS-number-semantics
decision.

### 0.6 Short-circuit &&/|| via branch nodes

The DSL operators `&&` and `||` now lower to **branch nodes** that
implement short-circuit evaluation:

- `a && b`: branch on `a`; true arm evaluates `b`, false arm returns `false`
- `a || b`: branch on `a`; true arm returns `true`, false arm evaluates `b`

Both operands must be `boolean` (type error otherwise), and the result
type is `boolean`. This is stricter than JavaScript/TypeScript: `&&`/`||`
are pure boolean logic operators, not value-producing short-circuit
operators. See dsl-v2.md section 2.6 for the full type-rule table.

Both arms bind the same name and merge through a noop node, using the same
pattern as ternary expressions. The `bool.and` and `bool.or` builtin tasks
have been removed since they are no longer needed.

The validator was extended with a "split-point phi coverage" check (case c
in `isBindingCoveredAtNode`) that accepts bindings that appear on all arms
of a branch or other multi-successor node. This also allows ternary
expressions to pass validation without `skipValidation`.

---

## Phase 1: Lexer + Parser

### 1.1 Operator precedence and associativity

The plan said "precedence climbing" but did not specify levels or
associativity. The implementation uses recursive descent with one
function per level (lowest to highest):

| Level | Operators            | Associativity  |
| ----- | -------------------- | -------------- |
| 0     | `?:` (ternary)       | right          |
| 1     | `\|\|`               | left           |
| 2     | `&&`                 | left           |
| 3     | `===`, `!==`         | left           |
| 4     | `<`, `>`, `<=`, `>=` | left           |
| 5     | `+`, `-`             | left           |
| 6     | `*`, `/`, `%`        | left           |
| 7     | `!`, unary `-`       | right (prefix) |
| 8     | `.` (member), `()`   | left           |

This matches the JavaScript/TypeScript subset the DSL supports. Loose
equality (`==`, `!=`) is intentionally excluded; the lexer rejects them
with a diagnostic suggesting `===`/`!==` instead (see 1.5).

The ternary operator uses `parseExpression()` for both the consequent
and alternate branches, making it right-associative: `a ? b : c ? d : e`
parses as `a ? b : (c ? d : e)`, matching JS.

### 1.2 Built-in name detection happens at parse time

When the parser encounters a call expression, it checks the callee name
against a hard-coded set `{ retry, map, filter, parallel, parallelMap }`
(`BUILTIN_NAMES` in parser.ts line 65). If the name matches **and** the
next token is `(`, the parser dispatches to a dedicated parsing function
that understands the builtin's custom syntax (e.g., arrow-function
arguments). Otherwise the identifier falls through to the normal
identifier/dotted-name path.

The reservation is narrow: only `name(...)` triggers the builtin path.
Using the name as a variable reference (`name` alone) or as a dotted
segment (`obj.name(...)`) is unaffected. You cannot, however, define a
task or workflow with one of these names and call it - the parser will
always interpret `map(...)` as the builtin map, not a task call.

This is the right design: builtins have custom argument syntax (arrow
functions, count expressions) that generic call parsing cannot handle.
Parse-time detection is the simplest correct approach.

### 1.3 Arrow function body: block vs expression

Arrow functions with `{ }` produce a block body (statements). Without `{ }`
they produce a single expression body, which the parser wraps in a synthetic
`ReturnStatement`. The parser decides based on whether the next token is `{`.
Both forms are accepted for all built-ins. This is standard JS/TS arrow
function semantics, no ambiguity.

### 1.4 `break` is only allowed in switch arms

The parser tracks `inSwitchDepth` and rejects `break` outside switch arms
with a diagnostic: "'break' is only allowed inside switch arms". This was
originally a gap (parser accepted `break` anywhere) but has been fixed.

### 1.5 `==` and `!=` produce errors, not silent fallback

The lexer recognizes `==` and `!=` and pushes an error diagnostic:
"Use === instead of == (no implicit coercion)" / "Use !== instead of !=
(no implicit coercion)". No token is emitted, so the parser never sees
them. This was listed in the plan but the approach (reject during lexing
vs. lex then reject in parser) was a choice. The current approach gives
clear diagnostics at the earliest possible point.

---

## Phase 2: Type Checker

### 2.1 Type system: `unknown`, `never`, `unresolved`, and removal of `any`

The type system has three special types with distinct roles:

**`unknown` (top type)** - A real language type exposed as a DSL keyword.
Follows TypeScript semantics: any type is assignable to `unknown`, but
`unknown` is not assignable to concrete types. Field access on `unknown`
is a compile error. Corresponds to `{}` (empty schema) in JSON Schema.
Primary use case: tasks like `llm.generateJson` whose output structure is
not statically known. Emits as `{}` in IR outputSchema.

**`never` (bottom type)** - Exposed as a DSL keyword. Represents
computations that never produce a value (always throw). Assignable to any
type. Corresponds to `{ "not": {} }` in JSON Schema. In ternary
expressions, if one arm is `never`, the result is the other arm's type.

**`unresolved` (internal error recovery)** - Not exposed in DSL syntax.
When the type checker encounters an unknown reference, unknown field, or
unrecognized type name, it emits a type error at the producer site and
returns `{ kind: "unresolved" }`. This type is compatible with everything
to prevent cascading errors. Compilation still fails because the producer
already emitted an error.

**`any` removed** - The `any` keyword was removed from the DSL. Using
`any` as a type annotation produces an "Unknown type" error. `unknown`
replaces `any` for cases where the type is genuinely unconstrained.

`typeEq(target, source)` evaluation order: unresolved (compatible with
all) -> never (bottom: source=never assignable to any target) -> unknown
(top: anything assignable to target=unknown, source=unknown not assignable
to concrete) -> kind/primitive checks.

See [dsl-v2.md section 2.14](dsl/dsl-v2.md) for the full type system
specification.

### 2.2 Integer vs number

The type checker treats `integer` and `number` as bidirectionally
compatible. A value declared as `integer` can be passed where `number` is
expected and vice versa. This is correct: JavaScript has a single numeric
type at runtime, so enforcing a distinction would create friction with no
safety benefit.

`integer` enters the type system from three sources: (a) JSON Schema
`{ "type": "integer" }` in task output schemas, (b) explicit `integer`
type annotations in DSL source, and (c) integer number literals (`42`
inferred as `integer`, `3.14` as `number`). The distinction is preserved
for JSON Schema fidelity and documentation, but the checker's `isNumeric()`
and `typeEq()` treat them interchangeably.

`integer` is documented in the dsl-v2.md type table (section 2.14).

### 2.3 Recursive workflow calls are not explicitly checked

When workflow A calls workflow B which calls workflow A, the type checker
does not detect the cycle. It resolves the return type by looking up the
called workflow's declared return type, so type checking does not diverge.
However, recursive workflows would fail at runtime because sub-workflow
calls emit as `workflow.<name>` task nodes that are not registered in the
engine (see 3.4).

This is an explicit limitation, not a bug. Recursion is uncommon in
workflow graphs, and once sub-workflow inlining is implemented (3.4),
true recursion would be structurally impossible (infinite inlining). A
static cycle check in the type checker would give a better error message
but is low priority.

### 2.4 Array element type tracking

The type checker infers array element types from context:

- `map(coll, (item) => { ... })` - `item` gets the element type of `coll`;
  return type is `array<body-return-type>`
- `filter(coll, (item) => { ... })` - `item` gets element type; return type
  is the original collection type (filtering doesn't change element type)
- `parallelMap` follows the same pattern as `map`
- When collection type is `unknown`, callback param is `unknown`

**Classification:** Correct implementation. Matches spec. No changes needed.

Minor note: `filter` does not check that its body returns `boolean`. This is
a validation gap but separate from element-type propagation.

### 2.5 Ternary arm type mismatch is an error

If the consequent and alternate of a ternary have different types, it's a
compile error. The plan listed this as a type error but didn't specify
whether a union type or an error was the right response. An error was chosen
for simplicity (no union types in the type system).

**Classification:** Correct design choice. The type system has no unions, so
requiring matching arms is the right constraint. Returns the consequent type.

---

## Phase 3: Emitter

### 3.1 Retry runs body N times even on success (BUG)

Originally the retry emitter ran the body `count` times on success (no
early exit) and retried indefinitely on failure (attempt counter only
incremented on success path).

**Classification:** Bug, already fixed before this review.

### 3.2 maxIterations values are hard-coded

| Built-in | maxIterations | Rationale                    |
| -------- | ------------- | ---------------------------- |
| retry    | 100           | Safety limit for retry loops |
| map      | 10,000        | Allow large collections      |
| filter   | 10,000        | Same as map                  |

**Classification:** Removed from emitter. The emitter no longer emits
`maxIterations`. The engine defaults to 10,000 when omitted. The IR type
makes `maxIterations` optional on both `LoopNode` and `ForkMapNode`, so
workflows can still override per-node if needed.

### 3.3 `noop` and `identity` tasks are not registered in the engine

The emitter produces two synthetic task types:

- **`noop`**: Used as merge nodes after switch/branch (a no-op convergence
  point). Emitted by `emitSwitch()`.
- **`identity`**: Used as passthrough nodes in ternary expressions when an
  arm is a literal value (wraps `{ value: literal }`). Emitted by
  `emitTernary()`.

**Classification:** Fixed. Both `noop` and `identity` are now registered in
`builtinTasks.ts` and included in the `allBuiltinTasks` export. Switch
statements and ternary expressions with literal arms execute correctly.

### 3.7 `captureOuterRefs` in-place rewrite

When a loop body (map, filter, retry, parallelMap) references an
outer-scope binding, the `captureOuterRefs` helper:

1. Scans all nodes in the body for `$from: "scope"` templates
2. Checks if the referenced name exists as a node in the body scope
3. If not (it's an outer reference), rewrites `$from` from `"scope"` to
   `"input"` in-place on the node object
4. Adds the reference as a loop input with its template value from the
   outer scope
5. Also handles `$from: "input"` (workflow-level params) by threading
   them into the loop's input map without rewriting

**Classification:** Acceptable implementation detail. The mutation is
localized to a single helper, runs once per loop body, and the nodes
have not been consumed at the point of rewrite. Not a spec concern.

### 3.8 Filter uses a two-branch pattern

The filter emitter creates a branch node inside the loop body. The `true`
case appends the item to the accumulator via `list.append`, then wraps the
result through an `identity` node (`wrap_append`) that binds
`updated_results`. The `false` case uses a `keep_results` identity node
that passes the current `results` state through, also binding
`updated_results`. Both branches converge at `step_i` (the index
increment). The loop's `iterateState` reads from `updated_results` to
update the `results` state variable.

**Classification:** Correct implementation. Uses the same shared-bind
normalization pattern as 3.12. Both branches produce the same bind name
so the merge point has a single, unambiguous source for the next state.

### 3.9 Ternary creates synthetic identity tasks for literals

When a ternary arm is a literal (e.g., `cond ? 42 : 0`), the emitter wraps
it in an `identity` task node because the branch node's `cases` and
`default` fields point to node IDs, not to literal values. When an arm is
an expression that emits nodes, the last node in that sub-scope gets the
shared result bind name directly (no identity wrapper needed). Both paths
converge at a `noop` merge node.

**Classification:** Correct and necessary lowering. The IR's branch
structure requires node references as targets; identity wrapping is the
only way to represent literal values in that model. This also follows the
shared-bind normalization pattern from 3.12.

### 3.10 Throw emits error.fail with never-output schema

The `emitThrow` method creates an `error.fail` task node with
`outputSchema: { "not": {} }` (the JSON Schema equivalent of `never`).
This declares that the task always fails and never produces output.

The IR toolchain enforces this convention in two places:

1. **Validator (static):** Rejects `next`, `bind`, or `onError` on a
   node whose `outputSchema` is `{ "not": {} }`. There is no successful
   path to follow, no output to bind, and no recovery to attempt.
2. **Runner (runtime):** If a task with never-output schema returns
   `kind: "ok"` instead of `kind: "fail"`, the engine throws an
   `EngineError` to guard against a broken task implementation.

The `error.fail` builtin's `outputSchema` was updated from
`{ type: "object" }` to `{ not: {} }` to match this convention.

**Classification:** Contract improvement. The original question was
whether missing `next` adequately signals termination. The answer is
that `next?: string` with `undefined` = terminal is the universal IR
convention (correct for all nodes), but `error.fail` additionally needs
the never-output contract to encode that it _must_ fail.

### 3.11 Pure-literal workflows are normalized through identity

When a workflow returns a literal and otherwise emits no executable nodes,
the emitter now inserts an `identity` node and returns its `result` field
instead of emitting a zero-node workflow. This gives the engine a concrete
entry point for literal-only programs and makes their IR shape match normal
workflow execution.

This is more than a bug fix: it establishes that executable workflows
should have a real starting node even when the source program is only a
literal return.

**Classification:** Intended lowering rule. Keep as-is.

Alternatives considered:

- Allow zero-node workflows and teach the engine to execute `workflow.output`
  without an entry node.
- Introduce a dedicated constant/return IR node for literal-only workflows.
- Keep the current identity wrapping.

Decision: keep identity wrapping as the canonical lowering. It reuses an
existing primitive, keeps the runner model simple (workflows still start at
an entry node), and is already covered by emitter tests. This belongs in the
compiler/runtime contract, but does not need surface-level DSL spec text
beyond any emitter-lowering notes we keep for IR generation.

### 3.12 Branch-returning control flow normalizes through a shared bind

When both branches of an `if/else` return values, the emitter does not
propagate branch-local bind names directly. Instead, each branch now writes
through an `identity` node to a common bind name before control flow
merges. Ternary lowering already used the same pattern.

This defines a canonical lowering rule for "a value produced by divergent
control flow": normalize branch-local outputs into one shared post-merge
binding rather than depending on matching branch internals.

Decision: keep shared-bind normalization as the canonical v2 lowering for
branch-produced values. It matches the current task-centered IR model,
keeps post-branch consumers simple, and avoids introducing a separate
merge-value concept into the IR.

This should be read together with the `identity` gap analysis in
`dsl/dsl-v2-implementation-gap.md`. That analysis separates two concerns
that currently share the same lowering primitive:

- literal materialization, where a future `ConstNode` could be a cleaner IR
  representation
- branch merge normalization, where a future explicit merge / phi concept
  would be the principled alternative

For v2, we are not taking on the merge / phi design. The shared-bind
pattern remains the intended lowering rule and part of the compiler/runtime
contract.

### 3.13 Map/filter loops use pre-check semantics

The original emitted loop shape effectively behaved like a post-check loop,
which caused the last iteration's state update to be lost. The emitter now
structures `map` and `filter` as pre-check loops: test the index against
the collection length first, then run the body, then advance state.

This means `map` and `filter` now have an explicit while-style execution
model in the emitted IR. That semantic choice matters for empty collections,
final-state commits, and any future loop-like built-ins that want to follow
the same pattern.

Decision: keep pre-check semantics as the canonical v2 lowering for `map`
and `filter`. This is not just emitter plumbing. It is the observable loop
contract for these builtins:

- empty collections skip the body entirely
- the exit decision happens before element fetch/body execution
- successful body work commits before the increment-and-iterate step

The current emitter structure and tests should be treated as documenting
that contract.

### 3.14 Loop indices lower through numeric builtins, not `int.*`

The earlier `int.add` / `int.lessThan` note is stale. The current emitter
uses `math.add` to increment loop counters and `compare.lessThan` to test
them against collection length or retry bounds. This matches the broader
runtime decision in 0.4: arithmetic follows JavaScript number semantics,
and `int.*` is not the intended long-term computation path.

The important semantic point is not that iteration has a special integer
execution model, but that loop infrastructure uses ordinary numeric tasks
while the type system still preserves `integer` as a schema/type fidelity
distinction. In other words:

- emitted loop counters run through the normal numeric builtin path
- `integer` remains meaningful in types and emitted schemas
- there is no separate long-term "integer arithmetic" lowering contract for
  loops

Decision: keep the current numeric lowering. Treat the old integer-builtin
path as obsolete implementation history, not a design commitment.

### 3.15 Output projection must use canonical scope refs

The `parallel` and `parallelMap` fixes showed that manually constructing
`{ $from: "scope", name }` references is not equivalent to using the
emitter's normal scope-ref path derivation. Single-property output
projection only happens when references are built through the canonical
lowering helpers.

Decision: resolved. All scope-level output references now derive
single-property projection through the canonical `getAutoProjectPath`
helper. The four construction sites are:

1. `scopeRef` (general node-to-scope reference)
2. Fork branch output (parallel construct)
3. ForkMap body output (parallelMap construct)
4. Binding resolution for `"node"` bindings in `resolveIdent`

Each site calls `getAutoProjectPath`, which inspects the node's
`outputSchema` and emits a `path: [key]` projection when the schema has
exactly one property. No ad hoc `{ $from: "scope", name }` construction
bypasses this logic.

### 3.16 `noop` and `identity` are required lowering primitives

`noop` and `identity` were originally emitted as synthetic helper tasks, but
the latest changes make them part of the normal lowering strategy for merge
points, branch normalization, ternary literals, filter state normalization,
and pure-literal workflows. They are no longer incidental helpers.

In practice, this means these tasks are part of the compiler/runtime
contract. Changing their availability or signature would break emitted IR.

### 3.17 Some emitter coverage intentionally bypasses IR validation

The integration tests for certain branch-return patterns compile with
`NO_VALIDATE` and run with `skipValidation: true` because the current IR
validator's domination analysis rejects workflows that execute correctly in
the runner. The tests were kept to preserve behavioral coverage while
accepting the validator gap.

Decision: confirmed as temporary technical debt. The tests are correct and
should be kept. The validator needs to be improved.

**Where the bypasses are:**

1. `dsl-integration.spec.ts`: four tests use `NO_VALIDATE` + `skipValidation`.
   The patterns that fail validation are:

   - if/else where both arms return (branch-return with shared-bind
     normalization through prefixed nodes converging at merge noop)
   - switch where all arms return (multi-arm shared-bind convergence)
   - if/else with arithmetic (mixed binary-op + branch lowering)
   - task call + binary op + ternary (mixed lowering with multiple splits)

2. `engine.spec.ts`: many hand-built IR tests use `skipValidation` for
   error-handling paths (onError, retry exhaustion, etc.). These are a
   separate concern: the hand-built IR intentionally exercises edge cases
   that may not match what the emitter produces.

**What the validator needs:**

The split-point phi check (case c in `isBindingCoveredAtNode`) was added
for ternary and short-circuit `&&`/`||` patterns and works for those. But
the emitter's branch-return lowering produces prefixed nodes (e.g.
`then_taskCall_3`, `else_taskCall_5`) that converge through a merge noop,
and the current phi check does not trace through the prefix-based
convergence pattern. The fix is to extend the validator's CFG traversal
to recognize these convergence shapes, not to change the emitter's output.

### 3.18 Composition coverage stays within current parser/type-checker limits

One integration test that combined a task call, binary operator, and ternary
was rewritten to avoid unsupported chained/property-composition and mixed-arm
typing patterns instead of expanding the parser or type checker in the same
commit.

Decision: keep as intentional v2 scope boundary. The DSL does not support:

- Property access on task call results (e.g. `task.call(args).field`)
- Chaining task calls (e.g. `a.call(b.call(x))`)
- Ternary arms with mismatched types

These are reasonable limitations for a structured workflow language. If any
of them are needed later, they would be separate parser/type-checker
expansions, not corrections to current behavior.

---

## Phase 5: Migration + Cleanup

### 5.1 d8 retry exhaustion behavior changed

The v1 `d8-summarize-url.wf` had while/try/catch/if/continue/break with
`maxRetries = 2`. On exhaustion, it silently broke out of the loop, leaving
`pageContent` potentially unset. The v2 `retry(2, ...)` with no fallback
will throw a runtime error on exhaustion.

Decision: accepted as intentional. The v2 behavior is correct per
dsl-v2.md section 3.1. The v1 silent-break was a bug, not a feature.
Callers that need graceful degradation should provide a fallback argument.

### 5.2 d8 retry count may differ

The v1 had `maxRetries = 2` with `nextAttempt < maxRetries` as the
continue condition, where `nextAttempt = attempt + 1`. Tracing the v1 IR:
attempt=0 fails, nextAttempt=1, `1 < 2` true, iterate; attempt=1 fails,
nextAttempt=2, `2 < 2` false, exit. That is **2 total attempts**.

The v2 `retry(n, ...)` emitter initializes `attempt = 0`, increments on
error, and compares with `greaterOrEqual` against count. For `retry(2, ...)`:
body fails, attempt=1, `1 >= 2` false, iterate; body fails, attempt=2,
`2 >= 2` true, exhausted. That is also **2 total attempts**.

Decision: no discrepancy. Both v1 and v2 give 2 total attempts for
count=2. The d8 `.wf` correctly uses `retry(2, ...)`. The comment
"Retries fetch once on failure" is accurate (1 initial + 1 retry).
Integration tests confirm `retry(3, ...)` gives 3 total attempts
(`callCount === 3`).

Note: the original 5.2 text incorrectly claimed v1 gave "3 total attempts
(initial + 2 retries)" for `maxRetries = 2`. That was a miscount.

### 5.3 d1 return type narrowed

The v1 `d1-standup-prep.wf` had `return joined` where `joined` was the result
of `string.join()`. Since `string.join` returns `{text: string}`, not `string`,
the v2 uses `return joined.text` to match the declared `string` return type.

Decision: confirmed as correctness fix. No behavioral change.

### 5.4 Deprecation uses console.warn

Decision: stale. `int.add` and `int.lessThan` have been fully removed from
the codebase (builtinTasks.ts no longer contains them). The deprecation
warnings went away with the tasks themselves. No policy decision needed.

### 5.5 Removed v1-only compiler tests entirely

Tests for `for..of` lowering and try/catch single-trigger compliance were
removed rather than rewritten as v2 equivalents. The v2 test suite has
equivalent coverage through map lowering and retry tests.

Decision: accepted. The removed tests targeted language constructs that
no longer exist in v2 (`for..of`, try/catch). v2 coverage supersedes them.

### 5.6 Added web.fetch to compiler test schemas

The v2 compiler tests needed a `web.fetch` schema for retry/if-else/parallel
test cases. This was added to the test's `TASK_SCHEMAS` map.

Decision: accepted. Normal test scaffolding. Not a design concern.

### 5.7 Map compiler test skips validation

The "lowers map to a loop node" test compiles without the `VALIDATE` flag
because the test schemas don't include the infrastructure tasks (`list.elementAt`,
`list.append`, `math.add`, `compare.lessThan`, `list.length`) that the map
emitter generates.

Decision: accept as temporary gap. Two independent issues prevent this
test from running with validation: (1) missing infrastructure task schemas
in the test setup, and (2) G7 - the validator does not yet handle the
convergence patterns that map lowering produces. Fixing (1) alone would
still fail; both must be addressed.

---

## Summary of items that may need action

Items tracked in `dsl/dsl-v2-implementation-gap.md` are omitted here.

| #   | Issue                                                                  | Severity                    | Phase                                |
| --- | ---------------------------------------------------------------------- | --------------------------- | ------------------------------------ | -------- | --- |
| 1   | Parallel branch names are synthetic, not from destructuring (3.5)      | Design gap                  | 3                                    |
| 2   | Parallel branches missing inputSchema/outputSchema/inputs/output (3.6) | Possible validation failure | 3                                    |
| 3   | &&/                                                                    |                             | short-circuit via branch nodes (0.6) | Resolved | 0   |
| 4   | Fork/ForkMap onError lacks `partial` injection (0.3)                   | Incomplete                  | 0                                    |
| 5   | d8 retry exhaustion now throws instead of silent fallthrough (5.1)     | Behavioral change           | 5                                    |
| 6   | Pure-literal workflows require identity entry node (3.11)              | Design choice               | 3                                    |
| 7   | Branch-returning control flow uses shared-bind normalization (3.12)    | Design choice               | 3                                    |
| 8   | Map/filter semantics are pre-check loops (3.13)                        | Behavioral choice           | 3                                    |
| 9   | Loop indices lower through integer builtins (3.14)                     | Design choice               | 3                                    |
| 10  | Output projection must use canonical scope refs (3.15)                 | Design choice               | 3                                    |
| 11  | `noop` / `identity` are required lowering primitives (3.16)            | Design choice               | 3                                    |
| 12  | Some emitter coverage intentionally bypasses IR validation (3.17)      | Technical debt              | 3                                    |
| 13  | Composition coverage preserves current language limits (3.18)          | Scope boundary              | 3                                    |
