# DSL Implementation Gaps

Tracked items where the DSL spec (dsl-v0.1.md) describes features that are
not yet fully wired end-to-end.

## Recommended implementation sequence

Address the gaps in dependency order, with correctness and validation before
new surface area:

1. **G16: Fix `throw` message propagation.** This is a direct user-visible
   correctness issue in already-supported error semantics.
2. **G2: Complete fork branch IR schema fields.** Bring emitted fork branch IR
   into the full sub-scope contract before improving fork runtime behavior.
3. **G17: Cancel in-flight fork/forkMap branches on failure.** After fork IR is
   structurally valid, align fork execution with the spec's failure and cleanup
   semantics.
4. **G22: Improve object/array diagnostics.** Now that G13 (resolved)
   surfaces real structural mismatches, switch error messages from the
   collapsed `'object'` rendering to the existing `formatType` output so
   users can see which fields differ.
5. **G10: Fix `integer`/`number` assignability.** Make numeric compatibility
   one-way before adding more type-system expressiveness.
6. **G3: Add TypeScript-style named type aliases.** Once structural
   assignability is sound, add named type declarations and a type environment.
7. **G4: Add generics for `llm.generateJson<T>`.** This depends on richer type
   parsing and checking, and becomes more ergonomic once named aliases exist.
8. **G18: Add union/literal types.** This is the broadest type-system expansion
   and should come after type soundness and named types.
9. **G11: Decide/document bind stripping for explicit user names.** This is
   primarily debuggability and spec clarity.
10. **G9: Decide whether bare task calls need `ExpressionStatement`.** This is
    AST honesty and visual-editor clarity, but current behavior works.
11. **G12: Decide `list.append` naming/semantics.** This is naming/API
    consistency with coordinated emitter, engine, and snapshot churn.
12. **G20: Audit remaining `identity` / `noop` usage in the emitter.**
    Decision 0010 removed `identity` / `noop` as load-bearing at branch
    convergence, but the emitter still synthesizes them in several other
    places. Classify each remaining usage as (a) reducible after 0010,
    (b) forced by an IR shape that could be relaxed additively, or (c)
    inherent to decision 0006 (no expressions). Pure audit; only
    schedules follow-up work.
13. **G7: Revisit composition patterns only when concrete workflow needs appear.**
    These patterns push against the visual-node discipline and should stay out
    of scope until justified.
14. ~~**G29 + G30: `if`/`switch` as value producers.**~~ G30 (mixed-return errors) **DONE**; G29 (deprecate value-producing if/switch?) deferred pending `.wf` survey + G18.

G1 (sub-workflow calls and cross-file composition) is now resolved; see its
section below for the landed surface. G24-G28 capture follow-up design
questions raised during the G1 implementation that have not yet been
scheduled. G29 and G30 are treated as a unified gap (see §G29+G30 below):
both arise from the same root cause — `if`/`switch` statements trying to
act as value-producing expressions in an SSA compiler without a CFG pass.
G30 (mixed-return errors) is resolved; G29's open question (whether to
deprecate value-producing `if`/`switch` in favour of ternary) is deferred
pending a `.wf` survey and G18 (union types).

Dependency spine:

- `G2 -> G17` brings fork/forkMap IR and runtime behavior into spec alignment.
- `G10 -> G3 -> G4 -> G18` builds type-system features on sound
  assignability (G13 resolved the structural-comparison prerequisite).

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

## G20: Remaining `identity` / `noop` usage in the emitter

**Context:** [Decision 0010](../ir/decisions/0010-finish-workflow-scope-unification.md)
removed `identity` + shared-bind + `noop` as the load-bearing lowering
for value-producing branches: with branch arms as `WorkflowScope`s,
each arm's `output` is a normal reference and convergence does not
need a carrier node. Resolved item G5 covered that specific pattern.

The emitter still synthesizes `identity` and `noop` nodes in several
other places. Whether each one is benign "DSL convenience" or evidence
of a remaining IR friction is not yet decided.

**Remaining categories** (snapshot of
[emitter.ts](../../../examples/workflow/dsl/src/emitter.ts)):

1. **Top-level / scope `output` materialization.** `output` must be a
   `$from` reference; literal or computed return values get wrapped in
   an `identity` node so they can be named. Affects `workflow.output`
   for literal returns and several lowering paths (short-circuit RHS,
   ternary literal consequents, etc.).
2. **`makeNoopArm` placeholder.** A `WorkflowScope` requires `entry`,
   `nodes`, and (in practice) something to reference from `output`.
   The "missing else" of an `if` without `else`, and other defaulted
   arms, emit a single `noop` whose bound output is the arm's value.
3. **Loop "retry" arm body.** The `attempts(...)` lowering emits a
   `noop` whose output (literal `true`) is the value `continueWhen`
   reads. Same shape as item 2 specialized for loop termination.
4. **Post-branch merge / continuation nodes.** Several lowering paths
   still emit a trailing `noop` as a join point even though arms now
   carry their own outputs. May be vestigial from the pre-0010 emitter.

**Why this might point at an IR problem:**

Each remaining usage is a place where the DSL has a _value_ but the
IR rules ("every value is a node output" + `WorkflowScope` must
declare `entry` / `nodes` / `output`, per
[workflow-scope-proposal.md](../ir/workflow-scope-proposal.md)) force
the emitter to invent a carrier node. The cost is real: synthetic IDs
leak into IR (compare G9), execution traces include nodes the author
never wrote, and node counts overstate the workflow's conceptual size.

Three plausible end states, one per category:

- **Reducible after 0010.** Category 4 (post-branch merge) may be
  outright dead code now that branch arms have outputs. Removing it
  costs nothing if true.
- **Additive IR relaxation.** Categories 1, 2, and 3 could be
  addressed by an additive IR change: allow `scope.output` (or
  `WorkflowIR.output`) to be a literal-or-reference template rather
  than strictly a reference, and treat "arm with no body" as a
  syntactic shorthand. This trades one validator rule for a smaller
  emitted IR. Needs an IR decision; the variance lens of
  [revisit-triggers.md](../ir/revisit-triggers.md) applies (separate
  concept vs. broadening an existing one).
- **Inherent to decision 0006.** If the audit finds the remaining
  carriers are the natural cost of "no expressions in the IR," then
  G20 closes as "working as intended" and the row in
  [revisit-triggers.md](../ir/revisit-triggers.md) for decision 0006
  becomes the place to track if pressure grows.

**What needs to happen:**

1. Enumerate every remaining `identity` / `noop` emit site in
   [emitter.ts](../../../examples/workflow/dsl/src/emitter.ts) and
   tag each with its category above.
2. For category 4, write the test that would fail if the node were
   removed; if no such test exists, remove the node - if tests stay
   green that confirms vestigial.
3. For categories 1-3, draft the minimal IR relaxation that would
   eliminate each, and decide per-category whether the relaxation is
   worth the validator-rule cost or whether to accept the carrier
   nodes as the cost of decision 0006.
4. If any category triggers an IR relaxation, update
   [revisit-triggers.md](../ir/revisit-triggers.md) and either
   [ir-v0.1.md](../ir/ir-v0.1.md) or a new decision record.
5. If all categories close as "working as intended," remove this gap.

## G21: Inferred return type and typed lambda parameters

**Status:** deferred - parser and type checker changes needed.

**Problem 1 - inferred workflow return type:**
The workflow declaration currently requires an explicit return type:

```
workflow summarize(repos: string[]): string { ... }
```

TypeScript allows omitting the annotation when the return type can be
inferred from the body. The DSL type checker already infers the return
type during `check()` (it computes `returnType` from `checkStatements`
and validates it against the declared type). The parser and emitter
would need changes to make the annotation optional and fall back to the
inferred type when absent.

**Problem 2 - typed lambda parameters:**
Lambda parameters in `map`, `filter`, `parallelMap`, and
`attempts.fallback` currently have no syntax for an explicit type
annotation:

```
map(repos, (repo) => { ... })          // repo inferred as string
```

TypeScript allows writing `(repo: string) =>` to be explicit and get
an error if the inferred type does not match. The DSL parser would need
to accept an optional `: TypeExpr` after the param name in arrow
expressions, and the type checker would need to validate the annotation
against the inferred element type.

**What needs to happen:**

1. Update the parser to make the workflow return type annotation
   optional (produce a sentinel `TypeExpr` such as `{ kind: "NamedType",
name: "_infer" }`) and emit the inferred type in the emitter.
2. Update the type checker to skip the return-type compatibility check
   when the annotation is the sentinel, and instead use the inferred
   type as the declared return type for downstream validation.
3. Update the parser to accept `(param: TypeExpr) =>` in arrow
   expressions, store the annotation on `MapNode`/`FilterNode`/etc.,
   and have the type checker emit an error when the annotation does not
   match the inferred element type.
4. Add LSP hover and inlay-hint support that shows the inferred return
   type next to the workflow name when the annotation is omitted.

## G22: Type error messages collapse objects to `'object'`

**Status:** UX gap surfaced by the G13 implementation. Pure diagnostic
improvement; no semantic change to type checking.

**Context:** When the type checker reports an assignability error, it
formats both sides with `typeName(t)`. For object types this function
returns the literal string `"object"`, discarding all field information.
This makes object-vs-object mismatches indistinguishable to users.

**Current state:**

- `typeName` in `typeChecker.ts` returns `"object"` for any `ObjectTypeInfo`,
  regardless of fields.
- Arrays partially benefit from recursion (`string[]`) but their element
  type collapses to `"object"` when it's an object.
- Tuples also collapse to `"object"` for each object element.
- A `formatType` function already exists in `typeChecker.ts` that produces
  a full TypeScript-style rendering (e.g. `{ name: string, tag?: string }`,
  `{ x: string }[]`), used today only for LSP hover text.
- Affected diagnostics include (non-exhaustive):
  - `Workflow return type 'object' is not assignable to declared type 'object'`
  - `Type 'object' is not assignable to type 'object'` (const annotations)
  - `Ternary arms must have the same type: 'object' vs 'object'`
  - `Operator '===' requires same types on both sides: 'object' vs 'object'`
- After G13 added structural object/array assignability checks, mismatches
  between objects are now reported as errors, so the volume of
  object-vs-object messages users see has grown.

**Reproduction:**

```
workflow test(x: { name: string, tag: number }): { name: string, tag?: string } {
    return x;
}
```

Currently reports: `Workflow return type 'object' is not assignable to
declared type 'object'`. Users cannot tell which field mismatches without
manually walking both type expressions.

**What needs to happen:**

1. Switch the structural error messages (return-type, const-annotation,
   ternary-arm, and `===`/`!==`) to use `formatType` instead of
   `typeName`, or introduce a single shared diagnostic formatter.
2. Decide whether `typeName` should be removed in favor of `formatType`,
   or kept for short contexts (e.g. operator operand kind in
   `must be numeric, got 'string'`). If kept, document the contract.
3. Consider augmenting object-mismatch messages with the specific
   offending field path (e.g. `field 'tag' has type 'number' but
expected 'string'`), reusing the recursion already done inside
   `isAssignableTo`. This may require threading an error-reason result
   out of `isAssignableTo` instead of a bare boolean.
4. Update existing type-checker tests whose substring assertions rely on
   the collapsed `'object'` rendering, and add tests asserting the
   richer field-level wording.

## G24: Named-record call syntax diverges from TypeScript

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

**Raised during:** G1 workflow composition implementation (designing workflow
call syntax).

## G25: `export` conflates entry-point selection with cross-file importability; no library compile mode

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

**Raised during:** G1 workflow composition implementation (designing
export / entry-point semantics).

## G26: No DSL syntax for `timeoutMs` on workflow calls

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

**Raised during:** G1 workflow composition implementation (designing
sub-workflow call nodes in the IR).

## G27: No per-file namespacing for exported workflows in IR

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

**Raised during:** G1 workflow composition implementation (building the
cross-file bundler and name mangling strategy).

## G28: `maxConcurrency` only accepts literal integers

**Spec/intent:** `parallel(...)` and `parallelMap(...)` accept an options
object with a `maxConcurrency` field that caps in-flight branches /
iterations. The AST already types `maxConcurrency` as an arbitrary `Expr`
(see `ParallelNode.maxConcurrency` and `ParallelMapNode.maxConcurrency` in
`ast.ts`), and the type checker only requires it to be numeric, so the
surface syntax accepts any numeric expression.

**The gap:** The emitter's `constExprToValue` only handles literal
expressions (`StringLiteralExpr`, `NumberLiteralExpr`, `BooleanLiteralExpr`,
`NullLiteralExpr`, `ArrayLiteralExpr`, `ObjectLiteralExpr`). Anything else

- a parameter reference, a const reference, an arithmetic expression, a
  task call, a workflow call - is rejected at emit time with
  `"Expression must be a literal value"`. That diagnostic is also generic
  (it points at "literal value" without naming the option), so the failure
  mode for a user who writes `{ maxConcurrency: n }` where `n` is a workflow
  param is unhelpful.

This also means the static recursion check's descent into `maxConcurrency`
(`walkExpr` in `typeChecker.ts`) is defense-in-depth only: any cycle
routed through `maxConcurrency` is independently rejected by the emitter
with the literal-only error before the recursion diagnostic could matter
at runtime.

**Desired behavior:** `maxConcurrency` should accept any expression whose
runtime value is an integer ≥ 1 (the same constraint
`validateWorkflowIR` already enforces on the literal form). Concretely:

- A workflow param (`workflow run(parallelism: integer) { ... parallel(..., { maxConcurrency: parallelism }) }`).
- A `const` binding (`const N = computeParallelism(); ... { maxConcurrency: N }`).
- An arithmetic expression over the above.
- The result of a task or sub-workflow call returning an integer.

**Required changes:**

- IR: extend `ForkNode.maxConcurrency` / `ForkMapNode.maxConcurrency`
  from `number | undefined` to accept either a literal integer or a
  reference / template that resolves to one at run time (mirroring how
  other dynamic numeric fields are represented).
- Emitter: instead of `constExprToValue`, emit `maxConcurrency` through
  the standard expression-lowering path used for other numeric values
  (binding references via `Template`, generating intermediate bind
  nodes as needed for complex sub-expressions).
- Engine: resolve the IR field to an integer at fork/forkMap entry,
  validate `>= 1`, and surface a clear runtime error if the resolved
  value is non-integer, non-positive, or otherwise invalid.
- Validator (`validate.ts`): relax the literal-integer requirement to
  accept the new dynamic forms and validate them structurally; keep the
  `>= 1` and integer constraints for the literal case.
- Type checker: keep the existing numeric requirement; once the engine
  can validate the runtime value, the type checker does not need a
  separate integer check (the existing `isNumeric` check is sufficient).
- Tests: add an end-to-end DSL → IR → engine test for each accepted
  shape (param ref, const, arithmetic, task call) and a runtime test
  that asserts `maxConcurrency: 0` and `maxConcurrency: 1.5` fail at
  fork entry with a useful error pointing at the option name.

## G29 + G30: value-producing `if`/`switch` — restricted symmetry

**Status:** Mechanically sound; design open.

### The gap

In TypeScript, `if`/`switch` produce values implicitly through control flow.
The two most common patterns are:

```typescript
// early-return style — TypeScript: fine; DSL: hard error
if (flag) {
  return r;
}
return null;

// full-symmetry style — both legal in TypeScript and DSL
if (flag) {
  return r;
} else {
  return null;
}
```

The DSL rejects the early-return style. It also rejects any switch where
returning and non-returning arms are mixed. Both are hard errors.

The restrictions exist because the DSL has no control-flow graph pass. It
processes statements in order without look-ahead, so it cannot see that
`if (flag) { return r; }` followed by `return null;` are meant to produce
a single conditional value. Without that analysis, the then-arm's return
would be silently dropped — a correctness bug. Rejecting the pattern is
the only sound fix under the current architecture.

### What is allowed

Value-producing `if`/`switch` is legal when:

1. **All arms return the same type.** Returning and non-returning arms
   cannot be mixed; arm types cannot differ.

2. **Coverage is complete.**
   - `if`/`else`: both branches must return.
   - `switch` with `default`: always covered.
   - `switch` without `default`: discriminant must be an `EnumType` (from a
     JSON Schema `enum` field) and every enum value must appear as a literal
     case arm.

### Error diagnostics

| Pattern                             | Error                                                                            |
| ----------------------------------- | -------------------------------------------------------------------------------- |
| Then-arm returns, no else arm       | `Then-arm returns a value of type X but there is no else-arm.`                   |
| Then-arm returns, else does not     | `Then-arm returns a value … but the else-arm does not return.`                   |
| Else-arm returns, then does not     | `Else-arm returns a value … but the then-arm does not return.`                   |
| Switch: any arm returns but not all | `Switch has arms that return a value but not all arms return.`                   |
| Switch arms return different types  | `switch arms must return the same type: arm N returns 'X' but arm 1 returns 'Y'` |

### Examples

**Exhaustive enum switch without `default` (Q4).** When the task output
constrains a field with a JSON Schema `enum`, the type checker exposes
that as an `EnumType` and treats the switch as value-producing without a
`default`:

```ts
// test.classify returns { label: "low" | "medium" | "high" }
workflow priority(text: string): string {
    const c = test.classify(text: text);
    switch (c.label) {       // enum discriminant
        case "low":    return "L";
        case "medium": return "M";
        case "high":   return "H";
    }
}
```

**What does NOT count as exhaustive:**

```ts
// ❌ Missing enum value — `default` would be required.
switch (c.label) {
    case "low":    return "L";
    case "medium": return "M";
    // "high" is missing → switch is not exhaustive
}

// ❌ Non-literal arm — coverage cannot be proven statically.
const target = "low";
switch (c.label) {
    case target:   return "L";   // variable, not literal
    case "medium": return "M";
    case "high":   return "H";
}

// ❌ Plain `string` discriminant — no enum constraint to exhaust.
workflow test(x: string): string {
    switch (x) {
        case "a": return "A";
        case "b": return "B";
    }   // → not value-producing
}
```

In each rejected case the switch is silently treated as non-value-producing
(no error today). Attempting to bind its result downstream surfaces the
missing schema. A future tightening may add an "expected exhaustive"
warning surface backed by the structured `EnumExhaustivenessResult`
returned by `isEnumExhaustive` (it distinguishes "missing value X" from
"arm K is non-literal").

### Design examination

Three directions, each with a different tradeoff:

**A — Keep current restrictions.**
Simple invariant: value-producing `if`/`switch` requires full explicit
symmetry. Users who want early-return style use ternary instead. The cost
is that idiomatic TypeScript patterns become errors at the DSL boundary.

**B — Pre-pass if-return fusion.**
Before type-checking, fuse `if (cond) { …; return x; }` + `return y;`
into a synthetic `if … else`. This restores the early-return idiom without
a full CFG pass — only the narrow pattern of a bare `if` (no `else`)
immediately followed by a `return` at the same scope level. Cost: a
special-case pre-pass and more complex error attribution.

**C — Remove value-producing `if`/`switch` entirely.**
Make `return` inside an `if`/`switch` a type error. All conditional value
production moves to ternary (`?:`). The language invariant becomes clean:
expressions produce values, statements produce side effects. Cost: awkward
when arms need multiple `const` bindings before returning (ternary can't
span statements). Viable if a survey of `.wf` files shows no such patterns
in practice. Also blocked on G18 (union types) — once arms can return
different types, `if`/`switch` becomes strictly more expressive than ternary.

**Current choice:** A, with C as the intended long-term direction.

Related: G7 (branch arm covariance), G18 (union types).
