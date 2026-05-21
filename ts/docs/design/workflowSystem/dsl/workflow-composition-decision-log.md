# Workflow composition — decision log

Per impl plan §3.1, this file logs design decisions made during implementation
that were either non-obvious or differed from the first assumption in the
design doc. Each entry is dated and tagged to the phase that produced it.

## Phase 1 — IR model

### P1-D1. ✅ WorkflowCallNode discriminant: `"workflowCall"` not `"workflow"`

The design doc (workflow-composition.md §2) describes the new node with
discriminant `kind: "workflow"`. The artifact's top-level discriminant is
also `kind: "workflow"`. Although the two namespaces (artifact and node)
are distinct in JSON, the shared discriminant value creates ambiguity in
TypeScript discriminated-union checks and in human reading.

Chose `kind: "workflowCall"` for the node. The artifact remains
`kind: "workflow"`. Impact on the spec: a one-word change to be folded into
ir-v0.2.md in Phase 8.

### P1-D2. ✅ `constants` and `types` remain top-level, not per-workflow

The design doc does not specify whether the constants/types tables move
inside each `WorkflowBody` or stay at the artifact level. Kept them at the
artifact level for IR v1: simpler semantics, single namespace, matches the
existing fixture style. Per-workflow visibility is deferred to a future IR
revision if needed (no current use case requires private constants).

### P1-D3. ✅ Dropped legacy `name` field at the artifact level

The pre-change `WorkflowIR.name` was the single workflow's name. In the new
shape the workflow name is the key in `workflows`, and the artifact carries
`entry: string` naming the entry workflow. The artifact-level `name` was
removed entirely (rather than retained as an alias for `entry`). Consumers
that previously read `ir.name` now read `ir.entry`. The "no back-compat"
decision from the plan-review session applies.

### P1-D4. ✅ `WorkflowBody` is an alias of `WorkflowScope`

The design uses the name `WorkflowBody` for top-level workflow bodies and
notes they are structurally identical to loop/fork scopes (which the code
already calls `WorkflowScope`). Rather than renaming the existing
`WorkflowScope` everywhere (touching loop, fork, forkMap node types and all
their validation/runtime code), `WorkflowBody` is exported as a `type` alias
of `WorkflowScope`. The API surface uses `WorkflowBody` for the workflows
table; internal helpers continue to use `WorkflowScope`. This avoids
churning unrelated code while keeping the design's vocabulary visible at the
public API.

### P1-D5. ✅ Validator schema-match check uses `canonicalStringify` (key-order-independent)

For `WorkflowCallNode.inputSchema`/`outputSchema` matching the referenced
body, the implementation compares using `canonicalStringify` — an existing
helper in `validate.ts` (line ~1934) that serializes objects with
recursively sorted keys, making the comparison order-insensitive.

Initial implementation used plain `JSON.stringify` (order-sensitive). During
the decision-log review it was noted that `canonicalStringify` already existed
for exactly this purpose and is used throughout the validator for display/debug
stringification. Switched to `canonicalStringify` for consistency. The
validator remains structural (not semantic) — two schemas that are logically
equivalent but structurally different (e.g. inline `$ref` vs resolved) will
still differ; this is acceptable because the emitter copies schemas verbatim
from the body.

### P1-D6. ✅ Engine resolves entry body up-front

`runner.ts` resolves `ir.workflows[ir.entry]` at the top of `run()` and
threads `entryBody` through downstream calls. Returns an `error` result if
the entry workflow is missing (defense-in-depth — the static validator
already rejects this case). This keeps the engine surface minimal in
Phase 1 and avoids adding a `WorkflowCallNode` execution handler until
Phase 5.

### P1-D7. ✅ Test fixtures use a wrapping helper rather than literal migration

`validate.spec.ts` introduced an `IROverrides` type that accepts legacy
single-workflow field names (`nodes`, `entry`, `output`, `inputSchema`,
`outputSchema`) and routes them into the synthetic body. This avoided
rewriting 100+ inline `makeMinimalIR({ ... })` call sites. Tests that
exercise the new artifact shape directly (multiple workflows in one IR)
can still pass a `workflows:` override.

For `engine.spec.ts` and `compiler.spec.ts`, inline `const ir: WorkflowIR = { ... }`
literals were rewritten programmatically (brace-counting Python script) to
the new wrapped shape. Tests assert behavior unchanged.

### P1-D8. ✅ Adapter + CLI fixture migration missed in Phase 1; caught in post-P8 sweep

The Phase 1 fixture-migration pass updated `workflow-dsl`, `workflow-engine`,
`workflow-model`, and `workflow-compiler` test fixtures, but missed two
downstream packages:

- `examples/workflow/adapter/test/discovery.spec.ts` — its
  `validWorkflowJson()` helper still emitted the legacy single-workflow IR
  shape (`name`, top-level `nodes`/`entry`/`output`), causing
  `validateWorkflowIR` to reject every fixture after P1's shape change.
  4 of 18 tests failed.
- `examples/workflow/cli/test/cli.spec.ts` — (a) used the legacy
  `compile(source)` API on every `.wf` in `workflows/dsl/`, which broke
  when `pipeline.wf` (cross-file import) was added in P8; (b) the
  `rejects invalid workflow file` test wrote a legacy-shape IR literal.

Fix: rewrote both helpers/fixtures to the new multi-workflow shape and
switched the CLI test to `compileFile` (skipping `writing.wf` as a
library-only file). All 18 adapter tests and 11 CLI tests now pass.

Lesson for future IR-shape changes: the fixture-migration checklist must
enumerate **every** package that constructs `WorkflowIR` literals, not
just the core compiler/engine packages.

## Phase 2 — DSL parser

### P2-D1. ✅ `as` for import alias is a contextual identifier, not a keyword

The plan describes `import { a as b } from "./m.wf"`. Promoting `as` to a
reserved keyword would unnecessarily break any existing `.wf` source that
uses `as` as an identifier (e.g. a variable named `as`). The parser
recognizes the literal text "as" at the alias position only — it remains a
plain identifier everywhere else. This mirrors TypeScript's handling.

### P2-D2. ✅ Object-literal shorthand was already supported

The design's named-record call form (`summarize({ text, maxLen: 200 })`)
requires `{ text }` to mean `{ text: text }`. The existing object-literal
parser (`parseObjectLiteral`) already implements this shorthand, so no new
parser code was needed for the named-record argument syntax — call sites
already accept a single object-literal argument. Semantic destructuring
against the callee's parameter names is a Phase 3 (type checker) concern.

### P2-D3. ✅ New `Module` AST + `parseModule()`, existing `parse()` kept

To house import declarations, introduced a `Module` AST node (kind:
`"Module"`) wrapping `imports: ImportDecl[]` and `workflows: WorkflowDecl[]`.
Rather than break the existing `parse(): { workflows, errors }` API, added
`parseModule(): { module, errors }` as the new top-level entry point, and
extended `parse()` to also return `imports: ImportDecl[]` for callers that
want both. `parseSingle()` (single-workflow back-compat) is unchanged and
does not accept imports.

### P2-D4. ✅ Import source string is decoded, not raw

The parser decodes the import path string through `decodeStringLiteral`
(same path as `StringLiteralExpr`) so escape sequences (`"\u002f"` etc.)
work consistently. The raw token text is also preserved on the underlying
StringToken for round-trip emission in Phase 4.

## Phase 3 — Type checker

### P3-D1. ✅ New `checkAll(workflows)` API; existing `check(wf)` preserved

Phase 3 needs cross-workflow concerns (shadow detection, recursion, full
workflowMap). Rather than overload `check()`, added `checkAll(workflows):
TypeError[]` as the multi-workflow entry. The single-workflow `check(wf)`
is still used directly by some adjacent test helpers (e.g.,
`commentNeutrality.spec.ts`) and is preserved unchanged behaviorally. The
compiler now calls `checkAll`.

### P3-D2. ✅ `checkAll` accumulates errors across all workflows

The original `check(wf)` resets `this.errors`. `checkAll` was designed to
not short-circuit on the first workflow's errors — it accumulates errors
from every workflow plus the shadow / duplicate-name checks at the start
and the recursion check at the end. Accumulation goes via a local
`allErrors: TypeError[]` because `check(w)` resets `this.errors` each
call. Order: shadow → duplicate → per-workflow → recursion.

### P3-D3. ✅ Task/workflow shadow is an error, not silent precedence

The design ("workflows shadow tasks of the same name. Ambiguity is a
compile error") reads as both "shadow" and "error". Implementation
chooses: any name registered as both a task and a workflow in the same
translation unit is an error. This avoids the design's tension and gives
users an immediate fix-it message.

### P3-D4. ✅ Single-arg object literal triggers named-record form

A workflow call form `helper({ n: 1, m: 2 })` is detected as a
named-record call when (and only when) the call has exactly one
positional argument whose value is an `ObjectLiteralExpr`. Any other
shape (e.g., variable holding an object) is treated as a positional
argument with object type. This matches the design's intent: the
named-record form is a syntactic alternative, not a runtime
destructuring of object values.

### P3-D5. Multi-workflow compile() requires an entry workflow ✅

`compile()` accepts multi-workflow files but must pick exactly one entry
to emit (until Phase 4 rewires the emitter to produce a workflow table).
Selection rule:

- single workflow → that one;
- multiple workflows + exactly one `export workflow` → that one;
- otherwise → compile error directing the user to mark one `export` or
  pass `--entry` (the latter wired in Phase 6).

### P3-D6. Duplicate parameter names are an error (gap-analysis finding) ✅

Caught by the second test-gap pass: the original `check()` happily set
both params in the same scope (later overwriting the first). Added a
seen-set check at the top of `check()`. Reported at the second
parameter's location.

### P3-D7. Recursion message includes the full cycle path ✅

`checkRecursion()` reports cycles in the form
`a -> b -> c -> a`, with the trailing node repeated for legibility. The
DFS dedups cycles by the sorted set of nodes (`a|b|c` key) so mutual
recursion between A and B reports once, not at every visit.

## Phase 4 — Emitter

### P4-D1. New `emitAll(workflows, entryName)` API; old `emit(ast)` kept as shim ✅

`Emitter.emit(workflow)` used to be the only entry point. Multi-workflow
emission needs the full set of workflows visible at emit time so that a
`workflowCall` node can resolve the callee's input/output schemas and
parameter list (used by default-arg inlining).

Added `emitAll(workflows: WorkflowDecl[], entryName: string)` and made
`emit(ast)` delegate to `emitAll([ast], ast.name)`. This preserves all
existing single-workflow tests with no migration and gives the compiler
a clean multi-workflow path.

### P4-D2. Default-arg inlining via `kind: "literal"` scope bindings ✅

Callee defaults can reference earlier callee params (e.g.
`workflow f(a, b = a) { ... }`). At emit time, the caller has already
resolved templates for explicitly-supplied args (and for earlier
defaults). The cleanest way to substitute callee-param references inside
a default expression is to run `emitExpr` in a synthetic scope where
each earlier callee param name binds to the caller-resolved template.

We piggy-back on the existing `kind: "literal"` binding shape: the
binding's `value` field carries the caller template; `resolveDottedName`
already returns `binding.value` for literal bindings (emitter.ts:2103).
No new binding kind required.

~~Limitation: defaults of the form `a.foo` (path access on a literal-kind
binding) currently fail with "Cannot access path on literal value". This
limits defaults to identifier references and pure constants for now.
Logged as a deferred enhancement; the type checker forbids the broken
forms by typing the default expression in a partial scope.~~
**Fixed:** `resolveDottedName` now spreads the existing template and appends
the path segments, so `b = a.foo` works correctly (emitter.ts, `case "literal"`).

### P4-D3. Cache callee schemas in `workflowSchemas` ✅

`emitWorkflowCall` populates the workflowCall node's `inputSchema` and
`outputSchema` from the callee's `WorkflowBody`. To avoid re-deriving
schemas for every call site, the emitter caches them keyed by callee
name during `emitAll` (computed once as each body is emitted; lookups
inside `emitWorkflowCall` are cheap).

### P4-D4. No emitter-side recursion check ✅

The type checker (`checkAll`) is responsible for cycle detection.
Emitter trusts type-checker output and walks workflows in declaration
order. If the type-check pass is bypassed (e.g. ad-hoc tests calling
`emitAll` directly), recursion would manifest as caller schemas
referencing a callee that has not yet been emitted; we tolerate this
because the only consumer of `workflowSchemas` is the call-site node
construction, which uses by-name lookup at runtime (post emit-all).

### P4-D5. Test helper now picks first `export` workflow as entry ✅

`emitter.spec.ts` compiles a single source string with multiple
workflows in some new tests. To keep the helper minimal we mirror the
compiler's behavior: prefer the first exported workflow, fall back to
the first workflow if none are exported. This avoids requiring tests to
pass an explicit `--entry` analog and matches the user-facing default.

## Phase 5 — Engine (runner)

### P5-D1. `currentWorkflows` field with explicit re-entrancy guard ✅

`executeWorkflowCall` needs read access to the IR's workflows table to
resolve a sub-workflow body, but threading that through every internal
method (`executeScope`, `executeTask`, `executeLoop`, `executeFork`,
`executeForkMap`, `executeBranch`) would be invasive. We instead stash
`ir.workflows` on a private engine field `currentWorkflows` for the
lifetime of a run, set just before the try block and cleared in
`finally`.

The trade-off is that a single `WorkflowEngine` instance is no longer
safe for concurrent runs. To prevent silent corruption, the top of
`run()` returns an explicit failure result if `currentWorkflows` is
already set when a new call starts (covered by test
"concurrent run() on same engine is rejected").

Reviewed in code-review pass 1 (MAJOR) and pass 2 (CRITICAL — early
returns above the try-block bypassed the finally cleanup); both
addressed by moving the field assignment below all early-return
validations.

### P5-D2. Sub-workflow inherits `constants`, fresh `bindings`, no `state` ✅

A workflowCall executes the callee body in a new `ScopeContext` with:

- `input`: the resolved call inputs (templates already evaluated in
  the caller scope).
- `constants`: a direct reference to the caller's constants map.
  Constants are program-wide and should be the same in every workflow.
- `bindings`: a fresh `Map`. Sub-workflow node binds (`const x = …`)
  never leak into the caller, and the caller's binds are never
  visible inside the callee.
- `state`: deliberately omitted. State is loop-body-local and must not
  flow across workflow boundaries.

This matches the existing fork/forkMap semantics for `bindings` and
deviates only on `constants` (forks isolate; sub-workflows share).

### P5-D3. Sub-workflow `output` is resolved in the callee scope ✅

After `executeScope` returns, the callee's `output: Template` is
resolved against the sub-scope (which contains the callee's bindings).
That value — not the raw sub-scope — is what bind/onError see. Output
schema (callee.outputSchema) is then re-validated by the engine even
though the static validator has already proven type compatibility, to
preserve the "defense-in-depth" posture of the rest of the runtime.

### P5-D4. Timeout enforcement at the call site (`node.timeoutMs`) ✅

The runner honors a per-call `timeoutMs` on a workflowCall node by
composing an AbortSignal: the sub-scope's `signal` aborts on parent
abort _or_ timeout. On timeout, the runner throws a clear
`EngineError("Sub-workflow … timed out after Nms")`. The DSL does
not currently expose a syntax for setting `timeoutMs` on a workflow
call; the field is reachable by tools that build IR directly. The
DSL-side ergonomic is logged as a future enhancement.

### P5-D5. onError dispatch parity with executeTask ✅

Sub-workflow failures recover into the caller's scope via
`onErrorDispatch`/`node.onError`, with the same `pendingError`
threading the executeScope loop already uses for task and loop
errors. Unrecoverable EngineErrors bypass onError, matching the
existing executeTask convention. The `kind: "TaskError"` errorObj's
`task` field is set to `workflow:<calleeName>` so handlers can
distinguish a sub-workflow failure from a task failure if needed.

### P5-D6. Code-review and test-gap rounds (per implementation plan) ✅

Two code-review passes were run on the engine changes:

- Pass 1 surfaced (a) MAJOR concurrent-run safety, (b) MINOR wrong
  EngineErrorKind on input schema violation, (c) MINOR `timeoutMs`
  declared but not honored. All three were addressed.
- Pass 2 surfaced (CRITICAL) early-return paths above the try block
  bypassing the `finally` cleanup of `currentWorkflows`. Addressed by
  moving the field assignment below the early-return validations.

Two test-gap passes were run:

- Pass 1 added: failure propagation without onError, isolated bindings
  across repeat calls, concurrent-run guard, sub-workflow timeout
  (5 tests). Skipped: "constants visible inside sub-workflow" —
  the DSL currently has no syntax for top-level `const`, so the test
  could not be expressed against the DSL surface; the engine path is
  exercised indirectly when other tests use constants.
- Pass 2 added: complex (record) sub-workflow output, sub-workflow
  events carry the call-site nodeId (2 tests).

Total new engine tests for P5: 9. Not acted upon:

- Caller-side onError _recovery_ path (variant of #6 where caller has
  an onError target). Left for a future test-coverage pass once the
  DSL exposes onError syntax for workflowCall sites; today the DSL
  does not, so the test would require manual IR construction.
- Named-record arg shape (`helper({a: 1, b: 2})`): the DSL already
  routes object-literal args through the same path as positional;
  the existing tests cover the lowered form.

## Phase 6 — Entry workflow rule and CLI

### P6-D1. `selectEntry` rule: explicit > single > single-export > error ✅

`compiler.ts:selectEntry()` applies a four-step cascade:

1. **Explicit `--entry <name>`** — caller-supplied name wins; error if not found.
2. **Single workflow** — a file with exactly one workflow always selects it, regardless of whether it is exported.
3. **Single `export workflow`** — if exactly one workflow is exported, it wins.
4. **Error** — multiple exports with no explicit entry, or multiple workflows with none exported, both produce a clear diagnostic.

The original design doc §4.6 described a `main`-name fallback that was never implemented. The actual rule (single-export wins) is more flexible and does not require a conventional name. Design doc updated to match.

### P6-D2. Only exported workflows are eligible entries (rule 3 onward) ✅

Private (non-exported) workflows are never candidates in the multi-workflow selection rules. A lone non-exported workflow still selects via rule 2 (single-workflow shortcut). Imported workflows from other files are added to the `workflows[]` table but are not eligible as entries of the importing file.

## Phase 7 — Imports (cross-file composition)

### P7-D1. Alias resolution via pre-typecheck AST rewrite

Local-import aliases (`import { foo as bar }`) could be resolved either by
threading a per-file local-name table through the type checker, or by
rewriting the AST in the loader so that every `WorkflowCallExpr.name`
holds the canonical declared name before type-check runs. Picked the AST
rewrite path: it keeps the existing single-namespace `TypeChecker.checkAll`
untouched, and the rewrite is a small recursive descent over the AST
shapes that can contain a workflow call (statements, expressions, AND
parameter-default expressions — see P7-D5).

### P7-D2. ✅ All non-entry-file workflows mangled; collision checked at import site only

After import resolution the IR `workflows[name]` map is name-keyed and the
engine resolves `WorkflowCallNode.workflowRef.name` by exact lookup. To keep
all names globally unique without imposing a global-uniqueness constraint on
workflow authors, the loader mangles **all** workflows from non-entry files
(exported and private alike) to `__f{fileIndex}_{name}` in Phase 4. Entry-file
workflows keep their original names.

Each file's local-name map (built in Phase 3) maps every name—own declarations
and imports alike—to its mangled canonical form, so the Phase 4 AST rewriter
transparently rewrites all call references. From within a file, developers
always write the declared or imported name; the mangling is invisible.

**Collision detection** is scoped to the per-file import namespace: if an
`import { x }` statement would bind a name that is already occupied by a local
declaration or an earlier import in the same file, that is a compile error.
There is no global check over the transitive import graph; authors in different
files are free to declare workflows with the same name.

**Bugs fixed during review:**
1. Original Phase 2 checked ALL workflows (including private) for cross-file
   name collisions — wrong for private workflows, which are file-scoped.
2. Private same-named helpers in two dependency files would silently overwrite
   each other in the IR. Both issues were resolved by the full-mangle approach.

Per-file namespacing for exported workflows is deferred to a future IR revision.

### P7-D3. LoadError `"load"` phase maps to `"typecheck"` in CompileError

`CompileError.phase` is the union `"lex" | "parse" | "typecheck" | "emit"
| "validate"`. Rather than extend it with a new `"load"` value (which
would ripple to every consumer of CompileError), the loader's `"load"`
phase (name lookup, visibility, collision errors) reports under
`"typecheck"` — these are name-resolution / scoping errors and are
diagnostically equivalent to the in-file unknown-name errors the
type checker already emits.

### P7-D4. `selectEntry` runs against entry-file workflows only

The compiler restricts entry-point selection to workflows declared in
the entry file. This avoids the surprise of an imported library's
`export workflow` being silently picked as the program entry. Imports
are an inclusion mechanism, not an entry-point publication mechanism.

### P7-D5. AST rewrite must cover parameter defaults

The first pass of the rewriter only visited workflow bodies. Code
review surfaced that a parameter default expression
(`workflow foo(x: number = imported()): number`) can also contain a
workflow call, and would otherwise be left referencing the local
alias. Fixed by walking `param.default` for every parameter before
descending into the workflow body.

### P7-D6. Optional `workspaceRoot` containment, off by default

The default Node `FileResolver` allows imports to resolve anywhere on
the filesystem (subject to the developer-supplied source tree). This
matches the convention of `tsc`, esbuild, swc, etc., which trust the
input source tree. An opt-in `workspaceRoot` option (and `wfc
--workspace-root` flag) rejects imports whose realpath escapes the
declared root. The realpath check (`fs.realpathSync`) is intentional:
without it, a symlink inside the workspace can smuggle in any file on
disk while still passing a purely lexical containment check.

### P7-D7. File-level cycles permitted; call-graph cycles caught by TypeChecker

The BFS loader allows mutually-importing files (A imports B, B imports
A) — file-level cycles are common when two libraries share types or
small helpers. Call-graph cycles (`a()` calls `b()` calls `a()`) remain
rejected by the existing `TypeChecker.checkRecursion`, now operating
on the merged flat workflow list, so they continue to be caught
whether the cycle is within a file or spans imports.
