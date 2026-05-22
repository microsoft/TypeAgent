# DSL Implementation Gaps

Tracked items where the DSL spec (dsl-v0.1.md) describes features that are
not yet fully wired end-to-end.

## G1: Sub-workflow calls ✅ Resolved

**Status:** Resolved as of the workflow-composition implementation plan
(Phases 1–7). Multiple workflows in one file _and_ across multiple files
now compose end-to-end through compiler, engine, and CLI. Cross-workflow
calls emit `WorkflowCallNode` (not inlined) and the engine resolves the
target via the IR's `workflows` table.

**What landed:**

- Parser: `export workflow`, `import { … } from "./other.wf"` (with
  optional aliases), default-expression parameters, named-record args.
- Type checker: takes the full flat workflow list; resolves single-
  segment names to either workflow or task (workflow shadows task), and
  rejects call-graph cycles (across files too).
- Emitter: emits one `WorkflowBody` per workflow into
  `WorkflowIR.workflows[name]` and emits `WorkflowCallNode` (kind
  `"workflowCall"`) at each call site. Default arguments are inlined
  at the call site per design §4.3.
- Engine: `WorkflowCallNode` handler creates an isolated child frame,
  propagates errors out to the caller's `onError`, and honors
  `timeoutMs`. A concurrent-run guard rejects re-entrancy on the same
  engine instance.
- CLI (`wfc`): `--entry <name>` selects the program entry from the
  entry file's workflows; `--workspace-root <dir>` opts into
  containment for cross-file imports (otherwise `tsc`-style trust).
- File loader: BFS-loads `.wf` files, detects duplicate workflow names
  across files, rejects non-exported / missing imports, rewrites
  aliased call sites to canonical names before type-check, and uses
  `realpathSync` for symlink-safe containment.

**References:**

- Design: [`workflow-composition.md`](./workflow-composition.md)
- Plan: [`workflow-composition-impl-plan.md`](./workflow-composition-impl-plan.md)
- Decisions: [`workflow-composition-decision-log.md`](./workflow-composition-decision-log.md)
- IR additions folded into [`../ir/ir-v0.2.md`](../ir/ir-v0.2.md)
  (no version bump).

## G2: Parallel branches missing IR schema fields

**Spec:** ir-v0.2.md specifies fork branches have the same sub-scope
contract as loop bodies: `inputs`, `inputSchema`, `entry`, `nodes`,
`output`, `outputSchema`.

**Current state:** The emitter only generates `{ entry, nodes }` per
branch, omitting the schema and I/O fields. The IR validator may reject
this if it enforces the full branch sub-scope contract.

**What needs to happen:**

1. Emit `inputSchema`, `outputSchema`, `inputs`, and `output` for each
   fork branch.
2. Validate that emitted fork IR passes the IR validator.

**Related decision:** The emitter currently generates minimal branch
scopes (`{ entry, nodes }`) and optionally `{ inputs, scope: { ... } }`
for branches that need outer references. The full sub-scope contract
(matching loop bodies) has not been enforced yet. This is a
spec/implementation mismatch that needs the emitter to populate the
missing fields.

## G3: TypeScript-style type definitions

**Spec:** TypeScript allows named type aliases (`type Foo = { ... }`) and
interfaces that can be referenced by name in annotations.

**Current state:** The DSL has no `type` or `interface` keyword. All
object types must be written inline as `{ field: type, ... }` in every
annotation where they appear. The type checker recognizes primitive
keywords (`string`, `number`, `integer`, `boolean`, `never`, `unknown`)
and inline object literals, but rejects any other identifier as
"Unknown type".

**What needs to happen:**

1. Add `type` declarations to the parser grammar (e.g.,
   `type Message = { role: string, content: string }`).
2. Store named types in a type environment that the type checker consults
   when resolving type expressions.
3. Report an error when a type annotation references an undefined type
   name (already works via the "Unknown type" error, but the message
   should distinguish "did you mean to define a type?" from a typo).
4. Consider whether types should be exportable across workflows.

## G4: `llm.generateJson` needs generics for output typing

**Spec:** `llm.generateJson` produces structured output, but its JSON
schema is only known at the call site, not from the task's static
signature.

**Current state:** The builtin's output schema is `{}` (empty object),
so the type checker infers `unknown` for its return value. Callers
cannot access fields on the result without a type error ("Cannot access
property on unknown type"). The only workaround is to assign the result
to a variable and pass it opaquely to another task.

**What needs to happen:**

1. Add generic type parameter support so callers can write something like
   `llm.generateJson<{ summary: string }>(prompt)` and the checker
   infers the return type from the type argument.
2. The emitter should use the type argument to populate the task node's
   `outputSchema` in the IR, replacing the `{}` default.
3. This requires parser support for `<Type>` syntax on call expressions,
   type checker support for resolving generic instantiations, and emitter
   support for threading the resolved type into the schema.

## G5: `identity` is covering two distinct IR gaps

**Context:** The current emitter uses builtin `identity` nodes in several
places where the DSL produces a value but the IR only allows control flow
to continue through executable node IDs. The principle question is not just
"can we remove `identity`?" but which uses reflect a real missing IR
concept versus a reasonable lowering to existing task semantics.

**Current state:** `identity` is doing two different jobs:

- **Literal materialization:** turning a literal/template value into a
  node result so the workflow or a branch arm can continue through a real
  node.
- **Shared-bind normalization:** ensuring both sides of a split publish the
  same bound name before converging.

In current emitter/runtime terms, that means four concrete behaviors:

1. **Literal branch arms normalize through `identity`.**
   Branch targets in the IR are node IDs, not inline values. When a DSL
   branch arm computes a literal/template value instead of calling a task,
   the emitter wraps that value in an `identity` node, binds the common
   result name there, and then converges through a merge node.

2. **Literal-only workflows normalize through `identity`.**
   A workflow that returns a literal and would otherwise emit no executable
   nodes still gets a real entry node. The emitter inserts an `identity`
   node and returns its `result` field rather than emitting a zero-node
   workflow. This keeps the runtime model uniform: executable workflows
   start at an entry node.

3. **Branch-returning control flow normalizes through a shared bind.**
   When both sides of an `if/else` or ternary produce a value, the emitter
   does not rely on branch-local bind names matching by accident. Instead,
   each side writes through an `identity` node to the same post-merge bind
   name, which downstream consumers read after control flow converges.

4. **`noop` and `identity` are part of the compiler/runtime contract.**
   The current lowering depends on these builtins existing in the runtime.
   `identity` materializes values into ordinary node outputs; `noop` serves
   as the convergence point after split control flow. They are not just
   incidental implementation details if the emitter continues to generate
   them.

These are related in the emitter, but they are not the same design problem.

**Design-principles analysis:**

1. **Keep `identity` as a lowering primitive.**

   - Strong on minimization: no new IR concept is added.
   - Clean under P1/P2/P4: the value still crosses a normal task boundary,
     remains traceable, and preserves local contracts.
   - Slightly weak under P3/P5: some nodes exist only as compiler shims,
     so IR structure does not always correspond to meaningful computation.

2. **Add a dedicated `ConstNode` for literal materialization.**

   - Best small IR improvement for literal-only cases.
   - Improves P3/P5 by making "this path yields a value" structurally
     visible instead of disguising it as a generic task call.
   - Compatible with P1/P2/P4 if it keeps explicit schemas, output, and
     control flow.
   - Does **not** solve shared-bind normalization; it only replaces the
     literal-materialization subset of current `identity` usage.

3. **Add explicit merge / phi semantics for shared-bind normalization.**
   - Best fit for the normalization subset of `identity` usage.
   - Potentially strong under P3/P4/P5 because branch convergence would
     explicitly describe how a common post-branch name is produced.
   - Expensive under the minimization discipline: this adds a real new IR
     behavioral concept with validator and runtime implications.

**Conclusion:**

- Keeping `identity` is acceptable under the current principles because it
  preserves the existing task-centered computation boundary and avoids new
  IR concepts.
- The current lowering should be treated as intentional
  compiler/runtime contract, not as an accidental workaround:
  - literal branch arms lower through `identity`
  - literal-only workflows lower through an `identity` entry node
  - branch-produced values lower through shared-bind normalization
  - `noop` and `identity` must exist as runtime builtins if the emitter
    continues to generate them
- If the IR is refined later, the problem should be split rather than
  solved with one broad mechanism:
  1.  `ConstNode` is the clean candidate for literal materialization.
  2.  Explicit merge / phi semantics are the clean candidate for shared-bind
      normalization.

**What needs to happen:**

1. Decide whether the spec should explicitly document `identity` as an
   accepted compiler/runtime lowering primitive for these cases. The
   explicit lowering rules above should be carried into the main spec
   docs or kept here as the durable reference.
2. If a later cleanup is desired, evaluate `ConstNode` and merge / phi
   support separately rather than treating all `identity` uses as one
   problem.

## G6: Validator does not handle branch-return convergence patterns

**Context:** The IR validator's domination analysis rejects some
emitter-produced workflows that execute correctly in the runner. Four
DSL-integration tests and several hand-built engine tests bypass
validation to preserve behavioral coverage.

**Current state:** The validator has three binding-coverage strategies
in `isBindingCoveredAtNode`:

- (a) Direct dominator coverage
- (b) Joint coverage across onError splits
- (c) Split-point phi coverage for branch nodes where both arms bind
  the same name

Strategy (c) was added for ternary and short-circuit `&&`/`||` patterns
and works for those. But the emitter's branch-return lowering produces
prefixed nodes (e.g. `then_taskCall_3`, `else_taskCall_5`) that converge
through a merge `noop`, and the current phi check does not trace through
the prefix-based convergence pattern.

**Patterns that fail validation:**

1. if/else where both arms return (branch-return with shared-bind
   normalization through prefixed nodes converging at merge noop)
2. switch where all arms return (multi-arm shared-bind convergence)
3. if/else with arithmetic (mixed binary-op + branch lowering)
4. task call + binary op + ternary (mixed lowering with multiple splits)

**What needs to happen:**

1. Extend the validator's CFG traversal to recognize the prefix-based
   convergence shape the emitter produces for branch-return patterns.
   The fix belongs in the validator, not the emitter.
2. Once the validator handles these patterns, remove `NO_VALIDATE` from
   the four DSL-integration tests and `skipValidation` from their
   corresponding engine runs.
3. The hand-built engine tests that use `skipValidation` for
   error-handling paths are a separate concern and can stay as-is.

## G7: Composition patterns outside current scope

**Context:** The DSL parser and type checker intentionally do not support
certain expression-composition patterns that would be natural in a
general-purpose language. An integration test that combined a task call,
binary operator, and ternary was rewritten to stay within current limits
rather than expanding the parser.

**Current limitations:**

- Property access on task call results (e.g. `task.call(args).field`)
- Chaining task calls as arguments (e.g. `a.call(b.call(x))`)
- Ternary arms with mismatched types

These are reasonable boundaries for a structured workflow language where
every line should map to a visual node. Property-access chaining would
create implicit intermediate values with no visual representation, and
nested calls would obscure the step-by-step execution model.

**What needs to happen:**

1. If any of these patterns become needed, they would require separate
   parser and/or type-checker expansions.
2. Property access on task results is the most likely future need. It
   would require the parser to handle `expr.field` after call expressions
   and the emitter to produce an intermediate projection node.
3. Nested task calls would need the emitter to linearize them into
   sequential nodes with implicit bindings.
4. Mixed-arm typing would need union types in the type system. The
   current design requires ternary/if-else arms to have matching types
   (error if not). There are no union types. This was an intentional
   simplification: returns the consequent type, rejects mismatches at
   compile time.

## G8: Comments not preserved in AST

**Spec:** dsl-v0.1.md section 6 states "The AST preserves comments.
Each node has an optional `leadingComments` array of `Comment { text, pos }`
attached to the following AST node." It also claims round-trip fidelity
between source and AST.

**Status: Resolved.**

- The lexer (`lexer.ts`) now collects `//` and `/* */` comments into a
  `comments: LexComment[]` side channel returned alongside tokens. The
  full comment lexeme (including delimiters) is preserved.
- The parser (`parser.ts`) accepts the comments list and attaches any
  comment whose offset precedes a statement's (or workflow's) first
  token as a `leadingComments` entry on that AST node.
- A new formatter (`formatter.ts`, exported as `format`) lowers a
  `WorkflowDecl` back to DSL source and emits `leadingComments` in
  attached positions, completing the round trip.
- See `formatter-design.md` for design notes (e.g., the full-text
  comment representation, trailing-comment handling).

## G9: Bare task calls wrapped as synthetic ConstStatement

**Context:** The parser allows bare task calls in statement position
(e.g., `audit.log(data)` inside an if body). It wraps them as
`ConstStatement` with a synthetic name `_<line>_<col>`.

**Current state:** This works end-to-end: the emitter generates a task
node with the synthetic bind name, and `stripUnreferencedBinds` removes
the unused `bind` field. The behavior is now documented in dsl-v0.1.md
section 2.3.

**Question:** Should bare task calls get a dedicated AST node
(e.g., `ExpressionStatement`) instead of being disguised as const
bindings with synthetic names? The current approach works but:

- Synthetic names like `_12_5` leak into IR node IDs.
- A dedicated node would make the AST more honest about intent
  (side-effect call vs. value-producing binding).
- The emitter already strips the bind, so the IR impact is minimal.

**What needs to happen:**

1. Decide whether to keep the current synthetic-const approach or add
   an `ExpressionStatement` AST node.
2. If keeping current approach: no code change needed, already documented.
3. If adding `ExpressionStatement`: update parser, ast.ts, emitter, and
   graph extractor.

## G10: integer/number bidirectional compatibility

**Context:** JSON Schema defines `integer` as a subtype of `number`
(one-way: integer values satisfy a number schema, but not vice versa).
The DSL type checker treats them as bidirectionally compatible.

**Current state:**

- The type checker's `isAssignable` function treats `integer` and
  `number` as interchangeable in both directions
  (typeChecker.ts ~line 99-104).
- You can pass a `number` value where `integer` is expected without a
  type error, which is a silent precision-loss bug.
- Additionally, arithmetic on two `integer` operands always returns
  `number` (typeChecker.ts ~line 713), even though the result could
  safely remain `integer` for `+`, `-`, `*`.

**What needs to happen:**

1. Make assignability one-way: `integer` assignable to `number`, but
   `number` NOT assignable to `integer` without an explicit conversion.
2. Consider returning `integer` from integer-only arithmetic (`+`, `-`,
   `*`) and `number` only when a `number` operand is involved or for
   division.
3. Add type error tests for cases like passing a `number` variable to
   an input that expects `integer`.
4. Audit existing task schemas: some tasks (e.g., `math.floor`,
   `math.round`, `math.ceil`) correctly return `integer`; verify that
   their results can still flow into `number`-typed inputs after the
   one-way fix.

## G11: Bind stripping removes names from side-effect tasks

**Context:** After emission, the emitter runs `stripUnreferencedBinds`
which removes the `bind` field from any node whose bound name is never
referenced by another expression.

**Current state:**

- If a user writes `const result = sideEffect.call(x)` but never
  references `result`, the emitted node loses its `bind` field.
- The task still executes (node ordering and `next` edges are
  unaffected), but the output value has no name in the IR.
- This is correct optimization for most cases, but can surprise users
  inspecting IR output or debugging, because the `const` binding they
  wrote has no trace in the compiled IR.
- G9 covers the specific case of bare task calls (`audit.log(x)`)
  which get synthetic names that are always stripped. This gap covers
  the general case of explicit user-written names being stripped.

**What needs to happen:**

1. Decide whether this is acceptable behavior (likely yes for
   optimization) or whether user-written names should always be
   preserved even when unreferenced.
2. If preserving: only strip synthetic names (those matching the
   `_<line>_<col>` pattern from G9), keep user-written ones.
3. If current behavior is fine: document it explicitly in the spec
   (dsl-v0.1.md section on compilation semantics) so users know that
   unused bindings are elided.

## G12: `list.append` semantics and naming

**Context:** The `list.append` builtin task returns a new array with the
item appended (immutable, functional semantics). The name "append"
suggests mutation in many languages (Python `list.append`, JS
`Array.push`).

**Current state:**

- `list.append` takes `{ list, item }` and returns `[...list, item]`.
  It does not mutate the input array.
- The `list.*` namespace is inconsistent with JSON Schema (`"type":
"array"`) and DSL syntax (`string[]`). `array.*` would align better.
- The emitter generates `list.append` nodes inside `filter` lowering.
  Renaming requires coordinated changes across emitter + engine + test
  fixtures.

**What needs to happen:**

1. Decide whether to rename `list.*` to `array.*` for consistency with
   JSON Schema and DSL syntax.
2. If renaming: update builtinTasks.ts, emitter.ts (filter lowering,
   loop machinery), and all IR snapshot tests.
3. Regardless of naming: consider whether the immutable semantics should
   be made explicit in the task name (e.g., `array.appended` or
   `array.concat`) to avoid confusion with mutable append/push.

## G13: `typeEq` skips structural comparison for objects and arrays

**Context:** The type checker's `typeEq(target, source)` function is used
for return type validation, const annotation checking, and ternary arm
compatibility. It skips structural comparison for object and array kinds.

**Current state:**

- `typeEq` checks primitive kinds by name, handles `unknown`/`never`
  correctly, and handles `integer`/`number` compatibility.
- For objects and arrays it falls through to `return true` without
  comparing fields or element types.
- This means `{ a: string }` is considered compatible with
  `{ x: number, y: number }` in all contexts where `typeEq` is called.
- Affected call sites: return type vs declared type (line ~263), const
  annotation vs inferred type (line ~308), ternary arm compatibility
  (line ~549).

**What needs to happen:**

1. Add structural comparison for object types: check that all required
   fields in the target exist in the source with compatible types.
2. Add element-type comparison for array types.
3. Consider splitting into two functions: `typeEq` for operator checks
   (where the current loose behavior is fine) and `isAssignableTo` for
   the structural contexts.
4. Add tests for mismatched object types in return position and ternary
   arms.

## G14: Switch lowering always takes first case

**Spec:** dsl-v0.1.md section 7.4. Switch emits a chain of
condition-check nodes, each comparing the discriminant to the arm's
value.

**Current state:** The emitted IR always evaluates to the first case's
body regardless of the discriminant's runtime value. Likely the
branch condition for the compare.equals node is not wired to the
actual discriminant input, or the branch edges (true/false) are
reversed.

**Reproduction:** Compile a switch with string cases, run with a value
matching the second case. Output is always from the first case.

## G15: Branch/ternary inside loop body fails at runtime

**Spec:** dsl-v0.1.md sections 2.7, 3.2. Branches and ternary
expressions should work inside map/filter/attempts bodies.

**Current state:** A ternary expression inside a map body compiles
without errors but fails at runtime. The branch condition evaluation
inside a loop body scope does not resolve correctly, possibly due to
scope nesting issues in $from reference resolution.

**Reproduction:** `map(nums, (n) => { const r = n > 10 ? "big" : "small"; return r })`
compiles but the engine fails to execute the workflow.

## G16: `throw` produces empty error message

**Spec:** dsl-v0.1.md section 2.11. `throw "message"` should emit an
`error.fail` task node that produces a failure with the thrown value
as the message.

**Current state:** The error.fail task is emitted, but the error
message that propagates to the RunResult is empty. The thrown string
value is not correctly threaded into the error.fail task's input, or
the error propagation loses the message field.

## G17: Fork/forkMap does not cancel in-flight branches on failure

**Spec:** ir-v0.2.md §2.1 rule 5 and §2.2 rule 5. "If any branch fails,
remaining in-flight branches are cancelled and the error propagates
immediately."

**Current state:** The engine's `executeFork` and `executeForkMap` use
`Promise.race` for concurrency limiting but do not cancel in-flight
branches/iterations when one fails. Errors from `Promise.race` propagate,
but other running branches continue executing in the background. This
wastes resources and may cause side effects from branches that should have
been cancelled.

**What needs to happen:**

1. When any branch/iteration rejects, signal cancellation to all other
   in-flight branches via `AbortController`.
2. `await` all in-flight promises before propagating the error (to avoid
   unhandled rejection warnings and ensure cleanup).
3. Add tests verifying that in-flight branches are cancelled on first
   failure.

## G18: No union types in the DSL type system

**Spec/intent:** The DSL currently has no union types. This was an
intentional v0.1 simplification (see G7 note 4: ternary/if-else
mismatched arms are rejected at compile time rather than widened to a
union). The underlying IR/JSON Schema layer fully supports unions via
`anyOf` / `oneOf` / `enum`, so the gap is purely in the DSL surface.

**Why it now matters:** Two concrete v0.1 features are weaker than they
should be without union types:

1. **Mixed-arm ternary/if-else expressions.** Authors must contort
   expressions or duplicate code when natural arms have different types
   (e.g. `cond ? "x" : 0`).

2. **Statically exhaustive `switch` over a narrowed discriminant.**
   The IR validator's exhaustiveness contract (ir-v0.1.md §3.6) lets a
   `switch` omit `default` when the discriminant's resolved schema is
   provably narrowed to a subset of the case keys (e.g. `enum` or
   `const`). The DSL emitter already emits the exhaustive form when
   source omits `default` (selectorSchema carries `enum: [...case keys]`
   and inferred type), but the only DSL types that satisfy the
   narrowing rule today are `boolean` (implicit `{true,false}` enum).
   For a `switch(x: string)`, there is no way in the DSL surface to
   declare `x` as `"a" | "b"`, so non-boolean exhaustive switches
   always fail IR validation unless authors:

   - add a `default:` arm, or
   - narrow `x` upstream via a task whose `outputSchema` carries an
     `enum` declared at the IR level.

   With string/number literal union types in the DSL, an author could
   write `switch(label: "news" | "code") { case "news": ... case "code":
... }` and have it compile + statically validate as exhaustive.

**Sub-issue: case-literal vs discriminant type mismatch is not caught.**
`typeChecker.ts` `case "SwitchStatement"` infers the discriminant and
each arm value but never checks assignability. Mixed types like
`switch(x: string) { case 1: ... }` slip through typecheck and only
fail later at IR-validation time (or worse, only at runtime if
`compile({validate:false})`). When union types are introduced, the
case-literal check should land at the same time:

- Each `case <literal>:` literal must be assignable to the discriminant
  type.
- For a union discriminant, the union of all case literals must equal
  the discriminant type (otherwise require `default:`).

**What needs to happen:**

1. Add string-literal and number-literal types to the DSL surface, plus
   union types over them (and possibly `boolean` literals).
2. Update `typeChecker.ts` to:
   a. Assign literal types to literal expressions where contextually
   useful (e.g. arm values in a `switch`).
   b. Reject `case` literals not assignable to the discriminant type.
   c. Widen mixed-arm ternary/if-else results to a union (replacing the
   "must match" rule).
3. Map DSL unions to JSON Schema `enum` (for literal-only unions) or
   `anyOf` (general case) in the emitter.
4. Verify the exhaustive switch emission (Phase 5 work in `emitSwitch`)
   composes correctly: a `switch(x: "a" | "b")` source with both arms
   and no `default:` should emit a branch whose `selectorSchema`
   declares `enum: ["a", "b"]` and whose discriminant resolves to a
   producer type with matching `enum` — passing the IR validator's
   exhaustiveness check.
5. Add tests for: union type parsing, case-literal type mismatch error,
   mixed-arm ternary returning a union, exhaustive non-boolean switch
   compiling without `default:`.

## G19: IR features the emitter does not produce

Surfaced when the hand-written IR for `d1-standup-prep` and
`d8-summarize-url` was retired in favor of compiling the corresponding
`.wf` sources. The DSL-compiled IR is functionally equivalent for the
existing test cases, but several IR-level features the hand-written
JSON exercised are no longer emitted by the DSL compiler.

**Items the emitter does not produce today:**

1. **`workflow.description`** &mdash; The IR allows a top-level
   `description` string on a workflow. There is no DSL surface for it
   (e.g. a doc-comment or attribute) and the emitter never sets it.
2. **`loop.maxIterations`** &mdash; The IR loop node supports a
   `maxIterations` safety cap (the hand-written d1 used `100`, d8 used
   `3`). The DSL has no syntax for it and the emitter never sets it,
   so DSL-authored loops run with no compile-time-declared cap.
3. **Named numeric constants &rarr; `constants` + `$from: "constant"`**
   &mdash; String `const` bindings round-trip through the
   `constants` block as `$from constant` references, but numeric
   literals (e.g. the `2` in `attempts(2, ...)`) are inlined into the
   loop input rather than lifted to `constants.<name>` with a
   `$from constant` reference. This loses the named-constant indirection
   the hand-written d8 used for `maxRetries`.
4. **Tight inner `outputSchema`s** &mdash; The emitter often produces
   `{}` or generic `array` for task and loop-body output schemas where
   the hand-written IR declared `{type: "string"}`, `{type: "integer"}`,
   or typed `items`. The DSL has the type information at compile time
   (since type-checking succeeds); the emitter could carry it through
   to the emitted JSON Schema.

**Behavioral divergence worth flagging (not strictly an emitter gap):**

When a `attempts(N, ...)` loop in the DSL exhausts its retries, the
emitter inserts an explicit `error.fail` task ("Attempts exhausted")
that aborts the workflow. The hand-written d8 instead exited the loop
silently and continued downstream with `undefined` along the optional
path. The DSL behavior is arguably more correct, but it is a real
semantic change &mdash; current tests do not exercise the exhaustion
path either way.

**Why this matters:** these are the only IR features no longer
exercised end-to-end now that the hand-written d1/d8 are gone. d4, d5,
and branch-reorganize still exercise some of them (verify which), but
addressing items 1&ndash;4 would close the gap between what the IR
model supports and what the DSL can actually produce.

**What needs to happen:**

1. Decide a DSL surface for `description` (doc-comment attaching to a
   `workflow` declaration is the natural fit) and emit it.
2. Decide a DSL surface for `loop.maxIterations` (e.g. an attribute on
   `loop`/`for`/`attempts`, or a builtin parameter) and emit it.
3. Lift numeric literals used as named `const` bindings into the
   `constants` block, mirroring the existing string-constant path.
4. Carry compile-time inferred types into emitted `outputSchema` /
   `items` schemas for tasks and loop bodies.
5. Decide and document the canonical retry-exhaustion semantics for
   `attempts(...)` (silent exit vs. explicit fail) and add a test that
   pins it down.

## G20: Named-record call syntax diverges from TypeScript

**Spec/intent:** The DSL supports a "named-record" call form where a
workflow with positional params can be called with a single object
literal: `summarize({ text: "hello", maxLen: 100 })`. This is a DSL
convenience that maps object keys to the callee's named params.

**The gap:** In TypeScript, `f({ a, b })` only works if `f` is declared
with a destructured parameter (`f({ a, b }: T)`). Positional-param
functions (`f(a: string, b: number)`) cannot be called with an object
— TypeScript produces a type error. The DSL's named-record form is
therefore a non-standard extension with no TypeScript precedent.

**Consequences:**

1. `summarize(myObj)` where `myObj` is a variable (not an inline literal)
   is treated as a single positional arg in the DSL today — it does NOT
   trigger named-record matching. This means named-record semantics are
   only available via inline object literals, limiting use in `map`
   bodies and other computed-argument contexts.

2. There is a semantic gap: DSL callers can write
   `summarize({ text: "x", maxLen: 1 })` but TypeScript callers of the
   same interface would not be able to. If the DSL ever emits TypeScript
   stubs, this call form has no direct equivalent.

**Options for alignment:**

- **Drop named-record syntax** and require callers to pass positional
  args (`summarize("hello", 100)`). Aligns with TypeScript exactly.
- **Adopt TypeScript destructuring convention**: a workflow declared
  as `workflow summarize({ text, maxLen }: SummarizeArgs)` takes a
  single object param — then both inline literals and variables work,
  matching TypeScript exactly.
- **Keep named-record as DSL sugar** (current) but document it as a
  DSL-only convenience that does not map to TypeScript call semantics.

**Decision needed:** Should DSL workflow call syntax align with
TypeScript (positional only, or explicit destructuring) or keep the
named-record convenience syntax as a DSL-specific ergonomic feature?

**Raised during:** review of `workflow-composition-decision-log.md`
P3-D4, post-G1 implementation.

## G21: `export` conflates entry-point selection with cross-file importability; no library compile mode

**Spec/intent:** `export workflow` was introduced to (1) allow a workflow to
be imported by other `.wf` files and (2) act as the tiebreaker for which
workflow is the entry point when a file contains multiple workflows.

**The gap:** These are two distinct concerns collapsed onto one keyword:

- **Importability** — whether other files can `import { foo } from "./m.wf"`.
  This is a module-visibility concern, analogous to TypeScript `export`.
- **Entry selection** — which workflow `compile()` / `compileFile()` treats
  as the root to execute. This is a bundler/runner concern with no TypeScript
  equivalent.

Because they share one keyword, a workflow marked `export` for importability
automatically becomes an entry candidate, and vice versa. This causes two
concrete problems:

1. A file intended as a pure library (multiple exported helpers, no single
   entry) cannot be compiled today — the compiler requires exactly one entry,
   so two `export workflow` declarations are an error unless `--entry` is
   passed. There is no "library mode" that skips entry resolution and emits
   all exported workflows.

2. A single-purpose helper marked `export` just to be importable raises
   ambiguity if a second `export workflow` exists in the same file, even
   though neither was intended as the entry.

**Options:**

- **Separate keywords / annotations**: e.g., `export workflow` for
  importability only, and a separate marker (`@entry`, `main workflow`, etc.)
  for entry selection. Matches TypeScript's model more closely.
- **Library compile mode**: keep one keyword but add a `--library` flag to
  `compile()`/`compileFile()` that skips entry resolution and emits all
  exported workflows as a `WorkflowIR[]` or a named map. Entry-selection
  behavior is unchanged for non-library builds.
- **Implicit entry by name**: treat a workflow named `main` (or the file
  stem) as the entry when no explicit `--entry` is given, making `export`
  purely a visibility qualifier.

**Raised during:** P3-D5 decision log review; related IR future work
would be a multi-workflow / library IR shape.

## G22: No DSL syntax for `timeoutMs` on workflow calls

**Spec/intent:** The IR `WorkflowCallNode` has an optional `timeoutMs` field.
When set, the engine enforces it by composing an `AbortSignal` that fires
after the deadline, aborting the sub-workflow with a clear
`"Sub-workflow … timed out after Nms"` error.

**The gap:** The DSL compiler never emits `timeoutMs` on a `workflowCall`
node. There is no syntax for a caller to declare a per-call timeout. The
field is only reachable by tools that build IR directly.

**Options:**

- **Call-site annotation**: `const r = helper(x) timeout 5000;` — reads
  naturally, consistent with task-level timeout style.
- **Named argument**: `const r = helper(x, @timeout: 5000);` — uses a
  special reserved keyword argument, similar to how some languages
  handle call-site options.
- **Workflow-level declaration**: `workflow helper(…) timeout 5000 { … }`
  — declares max runtime on the callee declaration rather than each call
  site. Simpler but less flexible (no per-call override).

**Raised during:** P5-D4 decision log review.

## G23: No per-file namespacing for exported workflows in IR

**Spec/intent:** The IR `workflows` map is a flat name-keyed table. Callee
resolution is by exact name. In the current implementation, all non-entry-file
workflows are mangled to `__f{N}_{name}` to avoid collisions, but this mangling
is opaque to IR consumers (debuggers, tooling, introspection).

**The gap:** There is no structured way in the IR to represent which file a
workflow originated from, or to resolve name conflicts without mangling. A
`WorkflowRef` could carry an optional `source` field (already reserved in the
schema for registry-style resolution) but it is not used by the bundler today.

**Options:**

- **Structured source field**: populate `WorkflowRef.source` with the originating
  file path; resolve by `(source, name)` pair in the engine.
- **Per-file workflow namespaces**: nest workflows under a file key in the IR,
  e.g. `ir.files[path].workflows[name]`.
- **Accept mangling**: keep `__f{N}_{name}` as the implementation detail and
  expose a `workflowOrigins` side-table mapping mangled name → original path + name.

**Raised during:** P7-D2 decision log review.
