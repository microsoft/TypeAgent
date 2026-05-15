# DSL v2 Implementation Gaps

Tracked items where the DSL spec (dsl-v2.md) describes features that are
not yet fully wired end-to-end.

## Sub-workflow calls

**Spec:** dsl-v2.md section 4. Multiple workflows in a single file;
sub-workflows are called by name and inlined at compile time.

**Current state:**

- Parser: works. Single-segment calls (`sendEmail(message)`) produce
  `WorkflowCallExpr` AST nodes.
- Type checker: partially works. Resolves return type from the called
  workflow's declaration, but `compile()` only passes a single workflow
  to the checker (`TypeChecker` constructor defaults `workflows` to `[]`).
  Cross-workflow calls produce "Unknown workflow" unless the caller
  explicitly provides sibling workflows.
- Emitter: does not inline. Emits a `TaskNode` with
  `task: "workflow.<name>"` and empty schemas (see implementation-decisions
  3.4).
- Runtime: fails. `workflow.<name>` tasks are not registered in the
  engine.

**What needs to happen:**

1. `compile()` should pass all parsed workflows to the type checker so
   cross-workflow references resolve.
2. The emitter should inline sub-workflow bodies into the calling
   workflow's IR (as the spec says), or alternatively, register
   `workflow.<name>` tasks in the engine at runtime.
3. Add integration tests that compile and execute a multi-workflow file.

**Related items:** implementation-decisions.md 2.3 (recursive calls),
3.4 (sub-workflow emit strategy).

## Parallel branch names are synthetic

**Spec:** dsl-v2.md section 3.4. Destructuring bindings become branch
names: `const [text, image] = parallel(...)` should produce branches
named `text` and `image`.

**Current state:** The emitter uses `branch_0`, `branch_1`, etc. The
fork node's output is keyed by these positional names, not the
user-visible destructuring variable names.

**What needs to happen:**

1. Pass destructuring names from `DestructuringConst` through to the
   fork branch emitter so branches are named after the user's bindings.
2. Update fork output resolution to use these names.

**Related items:** implementation-decisions.md 3.5.

## Parallel branches missing IR schema fields

**Spec:** ir-v2.md specifies fork branches have the same sub-scope
contract as loop bodies: `inputs`, `inputSchema`, `entry`, `nodes`,
`output`, `outputSchema`.

**Current state:** The emitter only generates `{ entry, nodes }` per
branch, omitting the schema and I/O fields. The IR validator may reject
this if it enforces the full branch sub-scope contract.

**What needs to happen:**

1. Emit `inputSchema`, `outputSchema`, `inputs`, and `output` for each
   fork branch.
2. Validate that emitted fork IR passes the IR validator.

**Related items:** implementation-decisions.md 3.6.

## TypeScript-style type definitions

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

## `llm.generateJson` needs generics for output typing

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

## `identity` is covering two distinct IR gaps

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
- In v2 terms, the current lowering should be treated as intentional
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

1. Decide whether v2 should explicitly document `identity` as an accepted
   compiler/runtime lowering primitive for these cases. If the main docs
   absorb this section, they should carry the explicit lowering rules above
   rather than relying on the temporary implementation-decisions file.
2. If a later cleanup is desired, evaluate `ConstNode` and merge / phi
   support separately rather than treating all `identity` uses as one
   problem.
