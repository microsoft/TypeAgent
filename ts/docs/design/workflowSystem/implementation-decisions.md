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

| Item | Review as                                                                                                                                            | Outcome                                                                                                                                                                              |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0.1  | Specify current runtime semantics in main spec docs.                                                                                                 | Keep current behavior. Make the main spec explicit that parallel/fork scheduling order is undefined when `maxConcurrency > 1`.                                                       |
| 0.2  | Decide whether this heuristic should be part of the runtime contract or replaced with explicit output rules.                                         | Replace stale heuristic note with the current explicit-output contract: fork branch output is resolved from `branch.scope.output` in branch scope.                                   |
| 0.3  | Review as an implementation gap against the plan/spec. Decide whether to fix behavior or reduce the documented contract.                             | Option D: reduce spec to match current code (error only). Planned future: partial + trigger + abort signal + wait/fail-fast policy. See `ir/future/fork-error-partial-injection.md`. |
| 0.4  | Specify the runtime error contract for divide-by-zero.                                                                                               | All math uses JS number semantics. Division/modulo by zero returns Infinity/NaN, not a task failure. `int.*` deprecated. Added `math.floor/round/ceil` for integer conversion.       |
| 0.5  | Decide whether comparison semantics should intentionally follow JavaScript or become stricter/more explicit.                                         | Keep JS semantics. Ordering operators already restrict inputs to `number`, so string coercion is a non-issue. NaN/Infinity behavior documented in spec section 3.1.                  |
| 0.6  | Decide whether non-short-circuit boolean tasks are an acceptable language limitation or need a separate control-flow form.                           | Lower `&&`/`                                                                                                                                                                         |     | `to branch nodes for short-circuit evaluation. Remove`bool.and`/`bool.or` builtins. Validator extended with split-point phi coverage to accept bindings on all branch arms. |
| 1.1  | Specify parser precedence and associativity in the language docs.                                                                                    | Documented. 9 precedence levels (ternary lowest, member/call highest), all left-associative except ternary (right) and unary prefix (right). Only `===`/`!==` (no loose `==`/`!=`).  |
| 1.2  | Decide whether parse-time builtin reservation is the intended language rule or whether naming should be made more explicit/less ambiguous.           | Keep parse-time detection. Reservation is narrow (only `name(` triggers it). Builtins need custom syntax parsing. Documented the scope of reservation.                               |
| 1.3  | Specify the arrow-body disambiguation rule.                                                                                                          | Keep as-is. Standard JS/TS rule: `{` means block body, otherwise expression body (wrapped in synthetic ReturnStatement). No ambiguity.                                               |
| 1.4  | Specify the restriction and confirm the error behavior is the one we want.                                                                           | Gap: parser accepts `break` anywhere (no `inSwitch` check). Emitter silently ignores it. Should add a diagnostic rejecting `break` outside switch arms.                              |
| 1.5  | Specify the error strategy for banned operators and confirm the diagnostic wording approach.                                                         | Keep as-is. Lexer rejects `==`/`!=` with clear diagnostic suggesting `===`/`!==`. No token emitted, so parser never sees them. Earliest-possible error.                              |
| 2.1  | Decide whether `unknown` should remain universally compatible or become stricter.                                                                    | Strongly typed. `unknown` is an internal recovery sentinel only: producers emit errors, consumers may continue, and compilation fails if any unknowns are produced.                  |
| 2.2  | Specify numeric compatibility rules.                                                                                                                 | TBD                                                                                                                                                                                  |
| 2.3  | Review as an unsupported/runtime gap. Decide whether to detect this statically or document it as unsupported.                                        | TBD                                                                                                                                                                                  |
| 2.4  | Specify array-element type propagation rules.                                                                                                        | TBD                                                                                                                                                                                  |
| 2.5  | Decide whether ternary mismatches should stay as errors or grow into a union-type feature later.                                                     | TBD                                                                                                                                                                                  |
| 3.1  | Review as a real implementation bug to fix, not a behavior to bless.                                                                                 | TBD                                                                                                                                                                                  |
| 3.2  | Decide whether hard-coded iteration limits are acceptable and, if so, where they should be documented/configured.                                    | TBD                                                                                                                                                                                  |
| 3.3  | Verify current status, since later work may already have resolved this. Then either remove it, rewrite it, or fold the final contract into the spec. | TBD                                                                                                                                                                                  |
| 3.4  | Decide whether sub-workflows should inline or execute through an explicit runtime call contract.                                                     | TBD                                                                                                                                                                                  |
| 3.5  | Decide whether branch naming is an internal detail or a user-visible contract that should match destructuring/source order semantics.                | TBD                                                                                                                                                                                  |
| 3.6  | Review as a spec/implementation mismatch. Decide whether to expand emitted branch shape or relax the documented contract.                            | TBD                                                                                                                                                                                  |
| 3.7  | Decide whether the in-place rewrite is an acceptable implementation detail or should be refactored before being relied on.                           | TBD                                                                                                                                                                                  |
| 3.8  | Verify current status against the latest emitter changes, then decide whether this remains a real issue or should be rewritten/removed.              | TBD                                                                                                                                                                                  |
| 3.9  | Decide whether identity-wrapping is the intended lowering pattern for literal arms or whether the IR should grow a cleaner representation.           | TBD                                                                                                                                                                                  |
| 3.10 | Specify whether implicit termination via missing `next` is the intended node contract.                                                               | TBD                                                                                                                                                                                  |
| 3.11 | Decide whether root-level identity wrapping is canonical lowering that belongs in the spec.                                                          | TBD                                                                                                                                                                                  |
| 3.12 | Decide whether shared-bind normalization is the standard lowering rule for branch-produced values.                                                   | TBD                                                                                                                                                                                  |
| 3.13 | Specify loop semantics for `map`/`filter` as part of the emitted/runtime contract.                                                                   | TBD                                                                                                                                                                                  |
| 3.14 | Decide whether integer builtins are the intentional long-term infrastructure for iteration.                                                          | TBD                                                                                                                                                                                  |
| 3.15 | Specify that output projection comes from canonical scope-ref lowering, not ad hoc ref construction.                                                 | TBD                                                                                                                                                                                  |
| 3.16 | Decide whether `noop` / `identity` should be documented as required lowering primitives in the compiler/runtime contract.                            | TBD                                                                                                                                                                                  |
| 3.17 | Review as temporary technical debt. Keep coverage, but track validator work needed to remove the bypass.                                             | TBD                                                                                                                                                                                  |
| 3.18 | Review as an explicit scope boundary. Decide whether to preserve current limits or plan later language expansion.                                    | TBD                                                                                                                                                                                  |
| 4.1  | Decide whether color choices belong in durable documentation or should stay as implementation/theme details.                                         | TBD                                                                                                                                                                                  |
| 4.2  | Decide whether this visual convention is part of the product language or just local styling.                                                         | TBD                                                                                                                                                                                  |
| 4.3  | Decide whether groups-as-edge-sources is the intended graph model contract.                                                                          | TBD                                                                                                                                                                                  |
| 4.4  | Decide whether extraction order matters semantically or should remain an internal implementation detail.                                             | TBD                                                                                                                                                                                  |
| 4.5  | Specify destructuring/binding lookup behavior in the graph extractor if it is meant to be stable.                                                    | TBD                                                                                                                                                                                  |
| 5.1  | Review as a migration behavior change. Decide whether to accept it, mitigate it, or document it prominently.                                         | TBD                                                                                                                                                                                  |
| 5.2  | Revisit after retry semantics are fixed, then document the final migration story.                                                                    | TBD                                                                                                                                                                                  |
| 5.3  | Confirm this is just a correctness fix and capture it in migration notes if needed.                                                                  | TBD                                                                                                                                                                                  |
| 5.4  | Decide on the deprecation signaling policy (`console.warn`, debug tracing, structured diagnostics, etc.).                                            | TBD                                                                                                                                                                                  |
| 5.5  | Decide whether equivalent v2 coverage is sufficient or whether some removed edge cases need to be restored explicitly.                               | TBD                                                                                                                                                                                  |
| 5.6  | Review as test scaffolding cleanup/documentation, not core language design.                                                                          | TBD                                                                                                                                                                                  |
| 5.7  | Decide whether to fix test schemas so validation can run, or explicitly accept this as a temporary validation gap.                                   | TBD                                                                                                                                                                                  |

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

The plan says `break` is only valid in switch arms (not loops, since v2 has
no loops). However, the parser accepts `break` anywhere - there is no
`inSwitch` context flag. The emitter silently ignores it (returns `undefined`),
so a stray `break` at workflow top level compiles without error and produces
no IR node. This is a minor gap: ideally the compiler should reject `break`
outside switch arms with a diagnostic.

### 1.5 `==` and `!=` produce errors, not silent fallback

The lexer recognizes `==` and `!=` and pushes an error diagnostic:
"Use === instead of == (no implicit coercion)" / "Use !== instead of !=
(no implicit coercion)". No token is emitted, so the parser never sees
them. This was listed in the plan but the approach (reject during lexing
vs. lex then reject in parser) was a choice. The current approach gives
clear diagnostics at the earliest possible point.

---

## Phase 2: Type Checker

### 2.1 `unknown` is an internal error-recovery sentinel, not a language type

The DSL is strongly typed. When the checker cannot determine a type because
the source is invalid or incomplete - for example an unknown reference,
unknown field, or unknown named type in an annotation - it emits a type error
at the producer site and returns `{ kind: "unknown" }` so later checks can
continue without producing a cascade of follow-on errors.

`unknown` is not a successful type result and is not exposed as a valid DSL
type. A value that has already been reported as unknown may flow through later
checks for recovery purposes, but compilation still fails because the producer
already emitted an error. The plan mentioned `TypeInfo` with an `unknown` kind
but didn't specify this error-recovery behavior.

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

> = count) -> branch(true: @exit, false: @iterate). There is no early-exit
> on first success. If `retry(3, ...)` and the body succeeds on attempt 0,
> the loop increments attempt to 1, checks 1 >= 3 (false), and iterates
> again. The body runs exactly `count` times before exiting on success.

Intended semantics: try once, retry up to N times on failure, exit on first
success. Actual semantics: run body N times regardless. On failure, the
loop's `onError` triggers and re-enters, but the attempt counter only
increments on the success path, so error retries don't consume attempts.

This means:

- Success path: body runs `count` times (wasteful, possibly wrong)
- Failure path: body retries indefinitely (attempt never increments on error),
  up to `maxIterations: 100` safety limit

### 3.2 maxIterations values are hard-coded

| Built-in | maxIterations | Rationale                    |
| -------- | ------------- | ---------------------------- |
| retry    | 100           | Safety limit for retry loops |
| map      | 10,000        | Allow large collections      |
| filter   | 10,000        | Same as map                  |

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

### 3.11 Pure-literal workflows are normalized through identity

When a workflow returns a literal and otherwise emits no executable nodes,
the emitter now inserts an `identity` node and returns its `result` field
instead of emitting a zero-node workflow. This gives the engine a concrete
entry point for literal-only programs and makes their IR shape match normal
workflow execution.

This is more than a bug fix: it establishes that executable workflows
should have a real starting node even when the source program is only a
literal return.

### 3.12 Branch-returning control flow normalizes through a shared bind

When both branches of an `if/else` return values, the emitter does not
propagate branch-local bind names directly. Instead, each branch now writes
through an `identity` node to a common bind name before control flow
merges. Ternary lowering already used the same pattern.

This defines a canonical lowering rule for "a value produced by divergent
control flow": normalize branch-local outputs into one shared post-merge
binding rather than depending on matching branch internals.

### 3.13 Map/filter loops use pre-check semantics

The original emitted loop shape effectively behaved like a post-check loop,
which caused the last iteration's state update to be lost. The emitter now
structures `map` and `filter` as pre-check loops: test the index against
the collection length first, then run the body, then advance state.

This means `map` and `filter` now have an explicit while-style execution
model in the emitted IR. That semantic choice matters for empty collections,
final-state commits, and any future loop-like built-ins that want to follow
the same pattern.

### 3.14 Loop indices lower through integer builtins

The emitter now uses `int.add` and `int.lessThan` for loop counters, with
their native `a` / `b` input names, instead of `math.add` and
`compare.lessThan`. The type checker already treats `integer` and `number`
as compatible, but emitted collection loops now deliberately model indices
as integer operations.

This makes integer builtins part of the emitter's expected lowering path
for iteration infrastructure, even though those tasks are marked deprecated
elsewhere.

### 3.15 Output projection must use canonical scope refs

The `parallel` and `parallelMap` fixes showed that manually constructing
`{ $from: "scope", name }` references is not equivalent to using the
emitter's normal scope-ref path derivation. Single-property output
projection only happens when references are built through the canonical
lowering helpers.

This is an implementation decision about ownership of output shaping: the
emitter should derive projection paths centrally rather than having each
construct rebuild them by hand.

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

This is a temporary implementation decision: runtime behavior is treated as
authoritative for these cases until the validator is brought in line.

### 3.18 Composition coverage stays within current parser/type-checker limits

One integration test that combined a task call, binary operator, and ternary
was rewritten to avoid unsupported chained/property-composition and mixed-arm
typing patterns instead of expanding the parser or type checker in the same
commit.

That means the current language boundary was intentionally preserved here.
The commit improves emitter/runtime correctness without broadening DSL
expression semantics.

---

## Phase 4: Graph Extractor + Visualizer

### 4.1 Color assignments

| Group/Node kind | Color        | Justification               |
| --------------- | ------------ | --------------------------- |
| retry           | orange       | "warning/retry" association |
| map             | indigo       | Arbitrary                   |
| filter          | purple       | Arbitrary                   |
| parallel        | teal         | Arbitrary                   |
| parallelMap     | green-teal   | Arbitrary                   |
| switch          | deep purple  | Arbitrary                   |
| switch-case     | light gray   | Subordinate to switch       |
| switch-default  | lighter gray | Subordinate to switch       |
| operator        | light blue   | Computation                 |
| branch          | yellow       | Decision point              |
| error           | red          | Error/danger                |
| workflowCall    | cyan         | External reference          |

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

| #   | Issue                                                                  | Severity                    | Phase                                |
| --- | ---------------------------------------------------------------------- | --------------------------- | ------------------------------------ | -------- | --- |
| 1   | Retry runs body N times on success (3.1)                               | Bug                         | 3                                    |
| 2   | `noop` and `identity` not registered in engine (3.3)                   | Bug                         | 3                                    |
| 3   | Sub-workflow calls don't inline, need engine support (3.4)             | Incomplete                  | 3                                    |
| 4   | Parallel branch names are synthetic, not from destructuring (3.5)      | Design gap                  | 3                                    |
| 5   | Parallel branches missing inputSchema/outputSchema/inputs/output (3.6) | Possible validation failure | 3                                    |
| 6   | &&/                                                                    |                             | short-circuit via branch nodes (0.6) | Resolved | 0   |
| 7   | Fork/ForkMap onError lacks `partial` injection (0.3)                   | Incomplete                  | 0                                    |
| 8   | d8 retry exhaustion now throws instead of silent fallthrough (5.1)     | Behavioral change           | 5                                    |
| 9   | Pure-literal workflows require identity entry node (3.11)              | Design choice               | 3                                    |
| 10  | Branch-returning control flow uses shared-bind normalization (3.12)    | Design choice               | 3                                    |
| 11  | Map/filter semantics are pre-check loops (3.13)                        | Behavioral choice           | 3                                    |
| 12  | Loop indices lower through integer builtins (3.14)                     | Design choice               | 3                                    |
| 13  | Output projection must use canonical scope refs (3.15)                 | Design choice               | 3                                    |
| 14  | `noop` / `identity` are required lowering primitives (3.16)            | Design choice               | 3                                    |
| 15  | Some emitter coverage intentionally bypasses IR validation (3.17)      | Technical debt              | 3                                    |
| 16  | Composition coverage preserves current language limits (3.18)          | Scope boundary              | 3                                    |
