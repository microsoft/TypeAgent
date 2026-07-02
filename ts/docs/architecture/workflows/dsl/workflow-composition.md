# Workflow Composition

**Status:** Open

## Context

The DSL spec (`dsl/dsl-v0.1.md` §4) permits multiple workflows per file and
sub-workflow calls. Earlier the implementation lowered those calls by
emitting an unregistered `workflow.<name>` task node as a placeholder: the
type checker only saw one workflow at a time, the emitter did not inline,
and the engine had no resolution path for the synthetic task name.

That narrow gap has since been closed end-to-end (parser, type checker,
emitter, engine, CLI; see commits landing the `WorkflowCallNode` and
cross-file bundler). The question underneath it remains broader and worth
answering on its own terms: **how should workflows compose, principally?**
This document records that answer, ignoring migration and implementation
cost. It is not (yet) the authoritative spec; it is the target the IR and
DSL should evolve toward.

This doc is **cross-cutting**: it lives under `dsl/` because the
originating gap was a DSL gap and §4 ("DSL ergonomics") is
the bulk of the content, but §2 specifies the supporting IR changes
(new node kind, workflow table). The two co-evolve and are not split.

## Principled position

> **A workflow call is a node in the IR with the same shape as a task
> call, resolved against a registry that the engine treats uniformly.
> Inlining, if it happens, is an engine-level optimization, never a
> compiler-level semantics.**

Everything below follows from that single assertion.

## 1. What a workflow is

A workflow is a **typed, named, observable computation**:
`(input: I) → output: O` with a declared (transitively derivable) effect
set. That is the only honest semantic unit the system has.

Tasks are the _same_ shape, with three differences and only three:

|                     | Task                   | Workflow                          |
| ------------------- | ---------------------- | --------------------------------- |
| Implementation      | Opaque (external code) | Transparent (declared as a graph) |
| Schema source       | Externally registered  | Derivable from the body           |
| Composition surface | Black-box reference    | Inspectable graph                 |

Everything else &mdash; calling convention, type contract, error model,
where the unit can appear in a graph &mdash; is identical. If a
workflow cannot appear wherever a task can be called (fork branch, map
body, inside `attempts`), composition is broken. (Tasks are not
first-class values in v1; neither are workflows. See §4.2.)

**Workflows are tasks whose body the compiler can see.** Hold that
framing and most other choices follow.

## 2. IR shape

### 2.1 A new node kind: `workflow`

Add a node kind alongside `task`, `loop`, `fork`:

```
WorkflowCallNode {
  kind: "workflow"
  workflowRef: WorkflowRef     // see §2.3
  inputSchema, outputSchema    // mirrors the referenced body's contract
  inputs                       // same shape as task inputs
  bind                         // same as task bind
  next, onError                // identical CFG edges
}
```

The node is **task-shaped at every edge**: one input set in, one bound
output, ordinary `next` / `onError`. No new CFG primitive, no new
dominance rule, no new validator. The existing CFG/DDG model already
admits it.

**Engine lifecycle.** When the engine reaches a `WorkflowCallNode`,
it (a) evaluates the node's `inputs` like any task call, (b) pushes a
sub-scope frame for the referenced `WorkflowBody`, (c) runs the body
from `entry` to `output` using the same sub-scope contract as loop
bodies and fork branches, (d) pops the frame, and (e) binds the body's
`output` per the call node's `bind`. Sub-workflow nodes are visible
in traces/observability as their own frames (P2, P4); inlining is an
optimization that may collapse this frame at execution time without
changing the IR or the trace contract.

### 2.2 Workflow bodies live in a workflow table

Workflow bodies are addressed by reference, not embedded at the call
site:

```
WorkflowBody {
  inputSchema, outputSchema
  entry, nodes, output         // same sub-scope contract as loop bodies
                               // and fork branches
}
```

For v1, the IR carries a **workflow table** &mdash; a `workflows` map
inside the calling IR &mdash; populated by the compiler with the
transitive closure of every referenced workflow body (in-file or
imported, see §4.4). The artifact is self-contained. We reserve the
word **registry** for the future engine-side resolution surface;
the in-IR structure is the workflow table.

A `WorkflowRef` carries an optional `source` field reserving the
extension point for an engine-side registry without changing the IR
shape: `source: "bundle"` (the default today, meaning "look in the
calling IR's workflow table") vs. future values like `"registry"`. The
resolver gains a branch when a real registry is built; the IR contract
does not change.

Whether a particular body was bundled with the calling IR or loaded
from elsewhere is **not visible at the IR call site** &mdash; exactly
the property the task registry already has. That uniformity is what
makes composition portable across files, packages, and (eventually)
agents.

The workflow table is a flat map keyed by name, not a tree. In v1 the
table contains no cycles (the compiler statically rejects cycles in
the workflow call graph &mdash; see §2.4); the closure is therefore
a DAG, but the table data structure does not depend on that.

### 2.3 Identity

A `WorkflowRef` carries `{ name, source }` for v1:

- `name` &mdash; the workflow's declared name, qualified by import
  scope (see §4.4).
- `source` &mdash; reserved extension point (default `"bundle"`),
  matching the same hook used for the future registry path. See §2.2.

`WorkflowRef` is an **IR-internal value** &mdash; the thing the call
node consumes to identify its callee. It is **not** a DSL surface
value type in v1; workflows cannot be bound to variables or passed as
arguments (see §4.2). The shape is preserved so that if and when
anonymous workflow values arrive, the IR contract does not change.

**No versioning, no digest, no compatibility range in v1.** This is
deliberate and aligns with the broader v1 deferral of deployment and
evolution concerns (see `principles/design-principles.md` "Out of
scope for v1" and `ir/ir-v0.1.md` "Out of scope" table). Within a
single bundled artifact, identity by name is unambiguous: the
compiler resolved the call against a specific `WorkflowBody` and
embedded that body in the same IR.

Versioning becomes load-bearing only when workflows can be authored,
shipped, and resolved independently of the calling IR &mdash; i.e.
when a real registry or cross-bundle composition arrives. At that
point, the existing principle-gaps follow-on ("Sub-workflow
evolution: does P4's boundary contract need strengthening for
versioning?") is the trigger to extend `WorkflowRef`. See
`ir/future/workflow-versioning.md` for the design space and revisit
conditions.

### 2.4 Recursion is rejected in v1

The compiler builds the workflow call graph from the workflow table
and statically rejects any cycle (self-call or mutual recursion).
This preserves the acyclic-graph property the inlining-era spec
relied on, without re-introducing inlining as semantics.

Allowing bounded recursion is a real design space (depth caps,
explicit `recursive` markers, lowering to bounded loops) and is
deferred. See `ir/future/workflow-recursion.md` for the candidate
options and the revisit triggers.

### 2.5 Error propagation across composition boundaries

A workflow call is task-shaped at its error edge: an uncaught error
that reaches the `WorkflowBody`'s exit propagates to the
`WorkflowCallNode`'s `onError`, just as a task throwing an error
follows the task call's `onError`. The body's own `onError` edges may
catch and handle errors internally before they reach the body
boundary; the caller only observes errors that escape the body. This
is the direct generalization of the existing task-call error contract
(`ir-v0.1.md` §3.8); no new error semantics are introduced.

### 2.6 What this is not

- Not a new control-flow primitive.
- Not a new edge kind.
- Not a new scope rule (a `WorkflowBody` is structurally identical to a
  loop body / fork branch).
- Not a new validator.
- Not a new semantic concept at all. A workflow call is a node that
  consumes inputs and produces a bound output; engine evaluation order
  is unchanged. No monad, no continuation, no coroutine.

If composition needed any of those, the design would be wrong.

## 3. How the principles apply

- **P1 (statically provable boundaries).** Every call carries an input
  and output schema; the bundle resolves to a body whose declared
  contract must match. Identical to task-call provability. Once
  workflow versioning lands (deferred &mdash; see §2.3), this property
  extends across independent callee evolution.
- **P2 (traceable data flow).** Inputs and `bind` make data flow into
  and out of the call node visible in the IR alone. The body's internal
  flow is itself an IR sub-scope &mdash; recursively traceable.
- **P3 (IR structure mirrors computational structure).** One source
  call is one IR node. Authoring intent survives lowering. Inlining
  would violate this directly: a single `process(x)` becoming N nodes
  in the IR is operational expansion, not structural correspondence.
- **P4 (parts understandable without the whole).** Each `WorkflowBody`
  is a stand-alone sub-scope with full schema and I/O. It can be
  validated, tested, visualized, and replayed independently &mdash;
  exactly like a loop body today.
- **P5 (predictable from the IR alone).** A reader sees
  `kind: "workflow", workflowRef: ...` and predicts: "run that
  named body with these inputs and bind the result." No conventions
  required.

The contrary position (inlining as semantics) is internally consistent
but quietly weakens P3, P4, and P5 at every composition point.

## 4. DSL ergonomics

The DSL surface should make §1's symmetry visible.

### 4.1 One call syntax

`name(args)` means "invoke the named computation." Whether `name`
resolves to a task or a workflow is a **name-resolution concern**, not
a syntactic one. The current `dotted = task, single-segment = workflow`
rule is an implementation leak.

Resolution:

1. A workflow name that collides with a registered task name is a **compile
   error**. The user must rename one or the other. (A workflow silently
   shadowing a task would be difficult to debug and is almost certainly a
   mistake — see `workflow-composition-decision-log.md` P3-D3.)
2. Promoting an inline block into a named workflow does not change
   call syntax at any call site.

### 4.2 Workflows are named callable computations

`workflow summarize(x: string): string { ... }` introduces a named
callable computation. It is invoked by name (`summarize(x)`), exactly
like a task call (§4.1).

**Workflows are not first-class values in v1.** They cannot be bound
to variables, returned from other workflows, or passed as arguments.
Higher-order positions (`map`, `filter`, `fork`, `attempts`, ...)
take their existing **block-body** form &mdash; an inline computation,
not a value &mdash; and that block body may call named workflows or
tasks like any other body. There is no surface lambda type, no
function/workflow type in the DSL type system, and no closure
mechanics over outer scope beyond what loop bodies and fork branches
already permit.

This is the minimum-symmetric position with the task model: tasks are
not first-class values today either; both tasks and workflows are
referenced by name from inline contexts. Promoting workflows to
first-class values goes beyond the task model and pulls in real
surface complexity (lambda types, closure capture, escape rules,
partial application). Those are deferred.

The IR contract above is **not** weakened by this: `WorkflowRef`
remains the value-shaped thing the call node consumes. When anonymous
workflow values come back in a later version, the IR shape does not
change &mdash; only the DSL grammar does. See
`dsl/future/anonymous-workflow-values.md` for the design space, the
closure question, and the conditions under which to revisit.

### 4.3 Inputs are records, by name

Calls bind arguments by name (`summarize({ text, maxLen: 200 })`).
Positional calls desugar to named via declared order. Workflows tend
to grow their input surface; named records survive that evolution in a
way positional arity does not.

Parameters may declare **default values** that are arbitrary
expressions, not just literals:

```
workflow summarize(text: string, maxLen: number = text.length / 10): string { ... }
```

A default expression may reference earlier parameters, call tasks, or
call other workflows. When a caller omits an argument, the compiler
**inlines the default's expression tree into the calling scope** just
before the workflow call &mdash; producing the same IR as if the
caller had written the expression themselves. This adds no IR concept
beyond the existing node model; the cost is that the default's nodes
appear once per defaulted call site (call it N times with the argument
omitted, get N copies of the default's expression in the IR).

This is the deliberate v1 trade: zero new IR machinery, in exchange
for some structural duplication. If the duplication becomes a real
problem (large defaults, many defaulted call sites), the IR can grow
a first-class optional-input concept (or a wrapper-workflow lowering)
without breaking existing call sites. See
`ir/future/workflow-default-arguments.md` for the design space and
revisit triggers.

Partial application (`summarize.partial({ maxLen: 200 })`) is not
included in v1 and has no proposed design yet; it is parked alongside
defaults for future consideration.

### 4.4 Imports and namespacing

Visibility is **private by default**. A `workflow` declaration is
callable only within its declaring file unless prefixed with `export`:

```
export workflow summarize(x: string): string { ... }
workflow helper(x: string): string { ... }   // private to this file
```

Cross-file composition requires a name-resolution story but **not** a
new call form:

```
import { summarize } from "./writing.wf"
```

Imports may only name `export`ed workflows. After import, `summarize`
is in scope and behaves identically to a locally-declared workflow.
Every call site &mdash; in-file or imported &mdash; lowers to the same
`WorkflowRef` node; the surface is uniform.

Resolution today is by file path (relative or workspace-rooted) and
the compiler transitively bundles every referenced body into the
calling IR's workflow table (see §2.2). Package-style imports
(`from "@org/pkg"`) and engine-side registry resolution are deferred;
the `WorkflowRef.source` field reserves the extension point.

**Name conflict rules.** Two workflow authors are free to declare
workflows with the same name in different files — there is no
global uniqueness requirement. Conflicts are checked only within a
single file's local import namespace:

- Importing a name that is already occupied by a local declaration
  or an earlier import in the same file is a compile error.
- Two or more dependency files may each export a workflow named
  `helper` without conflict, even if both are imported into the
  same entry file — as long as each import is given a distinct
  local alias (`import { helper as aHelper } from "./a.wf"`).

Internally, the compiler mangles all non-entry-file workflow names
to `__f{N}_{name}` to ensure unique keys in the flat IR map; this
is an implementation detail invisible to DSL authors.

**Emit is non-tree-shaking.** Every workflow declared in every
loaded file is emitted into the merged IR, whether or not any
entry-file workflow calls it. Two consequences worth knowing:

- `import { } from "./foo.wf"` is accepted; it pulls `foo.wf` into
  the module graph but binds no local names, so nothing in the entry
  can call the imported bodies. They still appear (mangled) in the
  IR.
- Importing one helper from a library file drags every other
  workflow in that file into the artifact.

This mirrors TypeScript's per-file emit model. A future
reachability prune (especially for bundle mode) is tracked in
`dsl/future/tree-shaking.md`.

**Resolver scope (`workspaceRoot`).** The default Node file resolver
restricts imports to the directory of the entry file. Any `import`
path that resolves outside this root — including via `../` or
symlinks (containment is enforced after `fs.realpathSync`) — is a
compile error. This is a safe-by-default posture; accidental
traversal outside the project tree is blocked without configuration.
Callers that need to import across sibling packages can pass an
explicit `workspaceRoot` to a common parent directory.

### 4.5 Higher-order positions take block bodies, not values

`map`, `filter`, `fork`, `attempts`, and similar higher-order forms
take **block bodies** &mdash; inline computations &mdash; not value
expressions. The body may call named workflows and tasks, but it is
not itself a value:

```
const doubled = map(nums, (n) => n * 2)
const summaries = map(articles, (a) => summarize(a))
const result = fork(
  () => use(serviceA),
  () => use(serviceB)
)
```

The arrow-looking syntax above is **block syntax** (the same syntax
loop bodies use today), not a lambda value. There is no value-binding
form for blocks &mdash; they only appear in higher-order call argument
positions:

```
const help = ...                                // no DSL form binds a block to a name
const doubled = map(nums, help)                  // not allowed: help is not a value
```

Reuse requires a named workflow:

```
workflow double(n: number): number { return n * 2 }
const doubled = map(nums, (n) => double(n))   // block calls named workflow
```

Closure-over-outer-scope inside a block body works exactly as it does
today for loop bodies and fork branches: outer names referenced inside
the block are lifted into the higher-order call's `inputs` and become
`$from outer` references in the IR. No new mechanism is introduced.

When anonymous workflow values (and the closure semantics that go with
them) come back, this section is what changes. The IR call-node shape
does not.

### 4.6 Entry workflow

A file may export multiple workflows. The engine needs to know which
one to invoke when the file is run as an entry point. The rule:

1. If an explicit entry name is supplied at invocation time
   (`--entry <name>` flag or equivalent API parameter), that workflow
   is used (it must exist and be exported).
2. If the file contains exactly one workflow (exported or not), it is
   the entry automatically.
3. Otherwise, if exactly one `export workflow` is declared, it is the
   entry.
4. If neither is satisfied (multiple exports without an explicit entry,
   or multiple workflows with none exported), loading the file as an
   entry point is a compile/load error with a clear message.

The entry workflow must be `export`ed (except in rule 2 where a lone
workflow is always the entry). Private workflows are never callable as
entries from outside the file. There is no special `entry` keyword in
v1; `export` combined with uniqueness is the signal.

### 4.7 Effects stay implicit

Tempting to surface `pure` vs `effectful` for caching/memoization.
Resist: a workflow's effect set is statically derivable from the tasks
it calls (transitively). The compiler and engine can compute it; the
author should not have to declare it. P1 and P5 want the boundary, not
author bookkeeping.

## 5. End-to-end example

A small two-file composition, showing exports, imports, named-record
inputs, defaults, and a higher-order block-body call.

`writing.wf`:

```
// Private helper: not callable from other files.
workflow trim(text: string): string {
  return text.trimStart().trimEnd()
}

export workflow summarize(
  text: string,
  maxLen: number = text.length / 10
): string {
  const cleaned = trim(text)
  return llm.summarize({ input: cleaned, maxLen })
}
```

`pipeline.wf`:

```
import { summarize } from "./writing.wf"

export workflow main(articles: string[]): string[] {
  return map(articles, (a) => summarize(a))
}
```

Lowered IR (sketch):

- Workflow table: `{ summarize, trim, main }` (transitive closure;
  `trim` is private to `writing.wf` but bundled because `summarize`
  calls it).
- `main`'s body contains one `map` node whose block-body calls
  `summarize` with the loop variable; the call lowers to a
  `WorkflowCallNode { workflowRef: { name: "summarize",
source: "bundle" }, inputs: { text: $loopVar }, ... }`.
- `summarize`'s body contains: one task call (`llm.summarize`), one
  workflow call to `trim`, and the inlined default expression
  `text.length / 10` for the omitted `maxLen` argument at the call
  from `main` (per §4.3).
- The call graph (`main → summarize → trim`) is acyclic; the
  compiler accepts it (per §2.4).

## 6. Follow-on capabilities

If §§2&ndash;4 land, several follow-on features stop needing dedicated
designs:

- **Higher-order composition by name** &mdash; block bodies in
  `map` / `fork` / `attempts` can call any named workflow or task;
  value-passing of workflows is deferred (see §4.5 and
  `dsl/future/anonymous-workflow-values.md`).
- **Cross-file reuse** &mdash; `export` + `import` resolves to a
  uniform `WorkflowRef` regardless of where the body lives.
- **Visualization-by-reference** &mdash; shared sub-workflows render
  as one node with a drill-down. (Defaulted arguments are an
  exception: their expression trees are duplicated per call site
  per §4.3; the call node itself is still one node.)
- **Recursion becomes structurally expressible** (cycles in the
  workflow call graph) once the v1 cycle rejection is relaxed. v1
  itself does not enable this &mdash; see
  `ir/future/workflow-recursion.md`.

Inlining, if profitable for execution, remains available **as an engine
optimization**. It is decoupled from semantics and applied where it
helps without changing what the IR (or the source) means.

## 7. Departures from prior framing

- The dsl-v0.1 spec §4 wording "sub-workflows are inlined at compile
  time" is no longer the semantic model. The semantic model is the
  workflow-call node; inlining is permitted but not required, and is
  an engine-level optimization.
- The current syntactic call classification (single-segment vs
  dotted) is dropped in favor of name resolution (§4.1).
- The implicit acyclic-graph guarantee that inlining used to provide
  is preserved in v1 by static cycle rejection (§2.4) rather than by
  forbidding the language construct.

Follow-up edits implied by adoption (not part of this doc's scope):
the dsl-v0.1 spec §4 wording and the IR spec's node-kind table need
updating when this lands. (The original sub-workflow-call gap entry in
`dsl-v0.1-gap.md` has already been removed now that the narrow fix
shipped.)

## 8. Decisions

| #   | Topic                               | Decision                                                                                                                                                                                                     | Section    | Future doc                                                                                |
| --- | ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------- | ----------------------------------------------------------------------------------------- |
| Q1  | Registry / cross-file boundary      | Bundle-only in v1: `export` + path-based `import`; compiler bundles transitive closure into the workflow table. `WorkflowRef.source` reserves the engine-side registry hook. Package-style imports deferred. | §2.2, §4.4 | &mdash;                                                                                   |
| Q2  | Effect inference granularity        | Deferred. No IR effect annotation in v1; consumers walk the graph.                                                                                                                                           | §4.7       | `ir/future/effect-inference.md`                                                           |
| Q3  | Versioning policy                   | Deferred. `WorkflowRef` is name-only in v1 (plus reserved `source`).                                                                                                                                         | §2.3       | `ir/future/workflow-versioning.md`                                                        |
| Q4  | Anonymous workflow values / lambdas | Deferred. Workflows are named callable computations only; not first-class values. Higher-order positions take block bodies.                                                                                  | §4.2, §4.5 | `dsl/future/anonymous-workflow-values.md`                                                 |
| Q5  | Default argument values             | Arbitrary-expression defaults, inlined at every defaulted call site. No new IR concept; some IR duplication.                                                                                                 | §4.3       | `ir/future/workflow-default-arguments.md` (alternatives if duplication becomes a problem) |
| Q6  | Recursion / call-graph cycles       | Statically rejected in v1. Bounded recursion deferred.                                                                                                                                                       | §2.4       | `ir/future/workflow-recursion.md`                                                         |
| Q7  | Entry workflow identification       | Explicit `--entry` > single workflow > single `export workflow` > error.                                                                                                                                     | §4.6       | &mdash;                                                                                   |

## 9. Non-goals

- A concrete migration plan from the current `workflow.<name>` placeholder.
- Edits to the existing IR spec or DSL spec.
- A decision about whether to inline as an engine optimization, and
  when. (That belongs in engine design, not here.)
- Versioning policy details (deferred &mdash; see §2.3 and
  `ir/future/workflow-versioning.md`).

## 10. Relationship to current docs

- Replaces, in spirit, the §4 wording of `dsl/dsl-v0.1.md` (inlining as
  semantics).
- Subsumes the framing question behind the (now-resolved) sub-workflow-call
  gap; that narrow fix was chosen with this target in mind, even though
  full adoption of the principled position is later work.
- Touches the same surface as `ir/workflow-scope-proposal.md` (sub-scope
  contracts); a workflow body is structurally another sub-scope.
- Should be cross-referenced from `principles/principle-gaps.md`.
